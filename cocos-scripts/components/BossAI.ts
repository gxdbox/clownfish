/**
 * BossAI.ts — 地图 Boss 行为（追逐玩家 + 交替弹幕 + 冲撞技能 + 狂暴阶段 + 召唤小怪）
 * 挂在 Boss 节点上（由 SpawnManager 动态创建）。
 *
 * 行为状态机：
 *   idle（追逐 + 环形/瞄准扇形弹幕交替 + 冲撞CD + 狂暴后召唤小怪）
 *     ↓ 冲撞CD到
 *   windup（蓄力0.7s：红圈 + 变色 + 方向线实时指向玩家，玩家可躲）
 *     ↓ 蓄力结束，锁定方向
 *   dash（高速直线冲撞 ~2.8×移速，撞墙/到最大距离停，接触伤害×1.5）
 *     ↓ 撞墙或到顶
 *   stun（硬直1s：输出窗口）
 *     ↓ 硬直结束
 *   idle（重置冲撞CD）
 *
 * 狂暴阶段（核心）：血量 <50% 一档 / <30% 二档 —
 *   移速提升、弹幕间隔缩短、弹速提升、冲撞CD缩短；
 *   二档解锁新技能：双环弹幕 + 追踪弹。
 *
 * 视觉：优先 AI 精灵素材（SPRITES.BOSSES[mapIndex]），失败回退 Graphics 大圆。
 * 死亡：由 SpawnManager 处理掉落 + 生成传送门。
 * Cocos Creator 3.8.8 迁移版
 */
import { _decorator, Component, Node, Graphics, Color, Sprite, UITransform, Vec3, tween } from 'cc';
import { BOSS, WORLD, GameState, SPRITES, MAPS, PLAYER, BOSS_SKILLS, BossSkillCfg, HIDDEN_BOSS } from '../config';
import { ensureRenderTransform, loadSpriteOnto, clamp } from '../util';
import { SwimAnim, SWIM, BOSS_SWIM } from '../swimAnim';
import type { WorldManager } from '../managers/WorldManager';
import type { AudioManager } from '../managers/AudioManager';
import type { GameManager } from '../managers/GameManager';
import type { PlayerController } from './PlayerController';
import { Bullet } from './Bullet';
import { EnemyAI } from './EnemyAI';
const { ccclass, property } = _decorator;

type ChargeState = 'idle' | 'windup' | 'dash' | 'stun';

@ccclass('BossAI')
export class BossAI extends Component {

    // ===== 运行时引用（由 SpawnManager 注入） =====
    worldManager: WorldManager | null = null;
    audioManager: AudioManager | null = null;
    gameManager: GameManager | null = null;
    player: PlayerController | null = null;
    entityManager: Node | null = null;

    // ===== Boss 属性 =====
    mapIndex = 0;
    hp = 1;
    maxHp = 1;
    speed = BOSS.RADIUS;
    damage = 20;
    xp = BOSS.XP_VALUE;
    hitFlash = 0;
    knockX = 0;
    knockY = 0;
    faceAngle = 0;
    isBoss = true;
    hidden = false;            // 隐藏Boss（火山·熔岩裂隙）：更强变体
    private _active = true;
    private _swim = new SwimAnim();
    private _swimType = 'boss';

    // ===== 攻击节奏：环形 ↔ 瞄准扇形交替 =====
    private _attackTimer = BOSS.BURST_INTERVAL * 0.6; // 首次弹幕提前一点
    private _attackAlt = false;                       // false=环形, true=瞄准扇形

    // ===== 冲撞状态机 =====
    private _chargeState: ChargeState = 'idle';
    private _chargeTimer = 0;      // 当前状态计时（windup/dash/stun 用）
    private _chargeCd = BOSS.CHARGE_INTERVAL * 0.6;   // 冲撞CD（idle 用，首次稍提前）
    private _chargeAngle = 0;      // 冲撞锁定方向
    private _chargeDist = 0;       // 已冲距离(px)
    private _baseSpeed = 40;       // 基础移速（狂暴倍率基于它）

    // ===== 狂暴阶段 =====
    private _enrageTier = 0;       // 0 / 1 / 2

    // ===== 召唤小怪 =====
    private _summonTimer = BOSS.SUMMON_INTERVAL * 0.8;

    // ===== Boss 专属技能（差异化：巨蟹王砸地 / 巨鳗王电球 / 安康鱼王分身+黑洞，见 config.BOSS_SKILLS） =====
    private _skillCfg: BossSkillCfg | null = null;
    private _skillCd = { slam: 3.5, orbs: 3.5, clones: 6.0, blackhole: 6.0 }; // 首次延迟：出场先让玩家熟悉基础循环
    private _announced = new Set<string>();

    // —— 跳跃砸地（slam）：windup 蓄力（落点红圈预警）→ airborne 抛物线飞行 → 落地冲击波 ——
    private _slamState: 'idle' | 'windup' | 'airborne' = 'idle';
    private _slamTimer = 0;
    private _slamStartX = 0;
    private _slamStartY = 0;
    private _slamTargetX = 0;
    private _slamTargetY = 0;
    private _slamWarnNode: Node | null = null;
    private _slamWarnGfx: Graphics | null = null;

    // —— 电球护体（orbs）：环绕电球封锁贴身 ——
    private _orbs: { node: Node; angle: number }[] = [];
    private _orbTimer = 0;

    // —— 幻影分身（clones）：半透明幻影移动 + 散射 ——
    private _clones: { node: Node; fireTimer: number }[] = [];
    private _cloneTimer = 0;

    // —— 引力黑洞（blackhole）：玩家脚下生成，吸附玩家，结束爆炸 ——
    private _holeNode: Node | null = null;
    private _holeGfx: Graphics | null = null;
    private _holeTimer = 0;
    private _holeCoreTick = 0;

    /** 是否处于硬控技能中（跳跃蓄力/空中）：禁止冲撞与其他技能触发 */
    private get _skillBusy(): boolean {
        return this._slamState !== 'idle';
    }

    // ===== 蓄力预警视觉（红圈 + 方向线，挂在子节点上不影响宿主） =====
    private _warnNode: Node | null = null;
    private _warnGfx: Graphics | null = null;

    /** 初始化 Boss（由 SpawnManager 调用） */
    init(x: number, y: number, mapIndex: number): void {
        const map = MAPS[mapIndex % MAPS.length];
        this.mapIndex = mapIndex % MAPS.length;
        this.hp = this.maxHp = Math.round(map.bossHp);
        this._baseSpeed = map.bossSpeed;
        this.speed = map.bossSpeed;
        this.damage = map.bossDamage;
        this.xp = BOSS.XP_VALUE;
        this.hitFlash = 0;
        this.knockX = 0;
        this.knockY = 0;
        this.faceAngle = 0;
        this._attackTimer = BOSS.BURST_INTERVAL * 0.6;
        this._attackAlt = false;
        this._chargeState = 'idle';
        this._chargeTimer = 0;
        this._chargeCd = BOSS.CHARGE_INTERVAL * 0.6;
        this._chargeAngle = 0;
        this._chargeDist = 0;
        this._enrageTier = 0;
        this._summonTimer = BOSS.SUMMON_INTERVAL * 0.8;
        this._active = true;
        this._swimType = BOSS_SWIM[this.mapIndex % BOSS_SWIM.length];
        // 专属技能重置：按地图配置技能组，清空上一场残留效果
        this._skillCfg = BOSS_SKILLS[this.mapIndex % BOSS_SKILLS.length] ?? null;
        this._skillCd = { slam: 3.5, orbs: 3.5, clones: 6.0, blackhole: 6.0 };
        this._announced.clear();
        this._slamState = 'idle';
        this._slamTimer = 0;
        this._cleanupSkills();
        // 隐藏Boss专属强化（setHidden 在 init 后调用，这里保持默认值即可）

        this.node.setPosition(x, y, 0);
        this.node.active = true;
        this._ensureVisual();
        this._ensureWarnNode();
        this._ensureSlamWarnNode();
        // Boss 战围栏：以「玩家与 Boss 中点」为中心生成 4 面围墙，把玩家和 Boss 关在同一空间，
        // 防止玩家甩开 Boss（地图 4000×4000 太大，不围栏可以跑图拖死 Boss 战）。
        const ppos = this.player ? this.player.node.position : null;
        this.worldManager?.spawnArena(x, y, ppos ? ppos.x : x, ppos ? ppos.y : y);
    }

    /** 设为隐藏Boss（火山·熔岩裂隙：深渊熔岩怪）：
     *  血量/移速/伤害更高，技能触发更频繁，视觉红黑熔岩调 */
    setHidden(): void {
        this.hidden = true;
        this.hp = this.maxHp = Math.round(this.maxHp * HIDDEN_BOSS.HP_MULT);
        this.speed = Math.round(this.speed * HIDDEN_BOSS.SPEED_MULT);
        this._baseSpeed = this.speed;
        this.damage = Math.round(this.damage * HIDDEN_BOSS.DMG_MULT);
        this.xp = Math.round(HIDDEN_BOSS.REWARD_EXP);
        // 技能 CD 更短（触发更频繁）
        this._skillCd = {
            slam: 3.5 / HIDDEN_BOSS.SKILL_SPEED_MULT,
            orbs: 3.5 / HIDDEN_BOSS.SKILL_SPEED_MULT,
            clones: 6.0 / HIDDEN_BOSS.SKILL_SPEED_MULT,
            blackhole: 6.0 / HIDDEN_BOSS.SKILL_SPEED_MULT,
        };
        this._applyHiddenVisual();
    }

    /** 隐藏Boss视觉：红色熔岩调（Graphics 兜底改色 + 顶部横幅） */
    private _applyHiddenVisual(): void {
        const body = this.node.getChildByName('Body');
        const g = body ? (body.getComponent(Graphics) ?? null) : null;
        if (g) {
            g.clear();
            g.fillColor = new Color(200, 40, 30, 255);
            g.circle(0, 0, BOSS.RADIUS + 6);
            g.fill();
            g.fillColor = new Color(255, 90, 50, 255);
            g.circle(0, 0, BOSS.RADIUS);
            g.fill();
            g.fillColor = new Color(255, 220, 120, 255);
            g.circle(-10, 8, BOSS.RADIUS * 0.3);
            g.fill();
            g.fillColor = new Color(80, 20, 10, 255);
            g.circle(10, -6, BOSS.RADIUS * 0.18);
            g.fill();
        }
        const gm = this.gameManager;
        if (gm) gm.notify(`🔥 隐藏Boss：${HIDDEN_BOSS.NAME} 出现了！`);
    }

    /** Boss 视觉：优先 AI 精灵素材，失败回退 Graphics 大圆 */
    private _ensureVisual(): void {
        const SpriteCtor = Sprite;
        if (SpriteCtor) {
            let body = this.node.getChildByName('Body');
            if (!body) {
                body = new Node('Body');
                body.setPosition(0, 0, 0);
                this.node.addChild(body);
            }
            const g = body.getComponent(Graphics) || body.addComponent(Graphics);
            g.clear();
            ensureRenderTransform(body, BOSS.RADIUS * 2 + 8, BOSS.RADIUS * 2 + 8);
            g.fillColor = new Color(180, 50, 50, 255);
            g.circle(0, 0, BOSS.RADIUS);
            g.fill();
            g.fillColor = new Color(255, 120, 120, 255);
            g.circle(-8, 8, BOSS.RADIUS * 0.28);
            g.fill();
            g.fillColor = new Color(60, 20, 20, 255);
            g.circle(10, 0, BOSS.RADIUS * 0.16);
            g.fill();
        }
        const path = SPRITES.BOSSES[this.mapIndex % SPRITES.BOSSES.length];
        loadSpriteOnto(this.node, path, BOSS.RADIUS * 2.6, BOSS.RADIUS * 2.6);
        // 附加发光部位（鮟鱇 BOSS 灯笼闪烁）
        const sNode = this.node.getChildByName('Sprite');
        if (sNode) this._swim.attachGlow(sNode, SWIM[this._swimType] || SWIM.boss);
    }

    /** 蓄力预警节点：红圈 + 方向线（子节点，只画视觉，不影响移动/碰撞） */
    private _ensureWarnNode(): void {
        if (this._warnNode) return;
        const wn = new Node('ChargeWarn');
        wn.setPosition(0, 0, 0);
        this.node.addChild(wn);
        ensureRenderTransform(wn, BOSS.RADIUS * 2 + 40, BOSS.RADIUS * 2 + 40);
        this._warnNode = wn;
        this._warnGfx = wn.getComponent(Graphics) || wn.addComponent(Graphics);
        wn.active = false;
    }

    update(dt: number): void {
        if (!this._active) return;
        if (this.gameManager?.state !== GameState.PLAYING) return;

        this._applySwim(dt);

        if (this.hitFlash > 0) this.hitFlash -= dt;

        // 击退衰减（冲撞中免疫击退，保证冲刺轨迹稳定）
        if (this._chargeState !== 'dash' && (this.knockX !== 0 || this.knockY !== 0)) {
            const pos = this.node.position;
            this.node.setPosition(pos.x + this.knockX * dt, pos.y + this.knockY * dt, pos.z);
            const damp = Math.pow(0.02, dt);
            this.knockX *= damp;
            this.knockY *= damp;
            if (Math.abs(this.knockX) + Math.abs(this.knockY) < 4) {
                this.knockX = 0;
                this.knockY = 0;
            }
        }

        if (!this.player || this.player.dead) return;

        switch (this._chargeState) {
            case 'idle': this._updateIdle(dt); break;
            case 'windup': this._updateWindup(dt); break;
            case 'dash': this._updateDash(dt); break;
            case 'stun': this._updateStun(dt); break;
        }

        // Boss 专属技能层：跳跃状态机 + 电球/分身/黑洞效果 + 技能 CD
        this._updateSkills(dt);
    }

    /** idle：追逐玩家 + 环形/瞄准扇形交替弹幕 + 冲撞CD + 狂暴后召唤小怪 */
    private _updateIdle(dt: number): void {
        // 跳跃砸地（蓄力/空中）期间：不追逐/不弹幕/不冲撞，专注跳跃与落地走位
        if (this._skillBusy) return;
        // 追逐玩家
        const ppos = this.player!.node.position;
        const pos = this.node.position;
        const a = Math.atan2(ppos.y - pos.y, ppos.x - pos.x);
        this.faceAngle = a;
        this.node.setRotationFromEuler(0, 0, -a * 180 / Math.PI);
        const nx = pos.x + Math.cos(a) * this.speed * dt;
        const ny = pos.y + Math.sin(a) * this.speed * dt;
        const resolved = this.worldManager!.moveResolve(nx, ny, BOSS.RADIUS);
        this.node.setPosition(resolved[0], resolved[1], pos.z);
        this._contactDamage(1);

        // 交替弹幕：环形 ↔ 瞄准扇形
        this._attackTimer -= dt;
        if (this._attackTimer <= 0) {
            this._attackTimer = this._attackInterval();
            this._attackAlt = !this._attackAlt;
            if (this._attackAlt) this._aimedFanBullets();
            else this._burstBullets();
        }

        // 冲撞CD（狂暴后更频繁）
        this._chargeCd -= dt;
        if (this._chargeCd <= 0) {
            this._beginCharge();
        }

        // 狂暴后周期召唤小怪
        if (this._enrageTier >= BOSS.SUMMON_ENRAGE_TIER) {
            this._summonTimer -= dt;
            if (this._summonTimer <= 0) {
                this._summonTimer = BOSS.SUMMON_INTERVAL;
                this._summonMinions();
            }
        }
    }

    /** 冲撞开始：进入蓄力状态（红圈 + 变色 + 方向线实时指向玩家） */
    private _beginCharge(): void {
        this._chargeState = 'windup';
        this._chargeTimer = BOSS.CHARGE_WINDUP;
        this._chargeDist = 0;
        // 蓄力期间方向实时锁定玩家（预警线指向玩家，玩家可提前走位躲开）
        this._chargeAngle = Math.atan2(
            this.player!.node.position.y - this.node.position.y,
            this.player!.node.position.x - this.node.position.x
        );
        this._setWarnVisible(true);
        this.audioManager?.laserWarn();
    }

    /** windup：原地蓄力，方向线跟随玩家，0.7s 后锁定方向冲刺 */
    private _updateWindup(dt: number): void {
        // 蓄力期间方向线持续指向玩家（让玩家知道会被冲，可走位）
        const ppos = this.player!.node.position;
        const pos = this.node.position;
        this._chargeAngle = Math.atan2(ppos.y - pos.y, ppos.x - pos.x);
        this.faceAngle = this._chargeAngle;
        this.node.setRotationFromEuler(0, 0, -this._chargeAngle * 180 / Math.PI);

        this._chargeTimer -= dt;
        if (this._chargeTimer <= 0) {
            this._chargeState = 'dash';
            this._setWarnVisible(false);
            this.audioManager?.burst();
        }
    }

    /** dash：朝锁定方向高速直线冲撞，撞墙/到最大距离停 → 硬直 */
    private _updateDash(dt: number): void {
        const chargeSpeed = this.speed * BOSS.CHARGE_SPEED_MULT;
        const pos = this.node.position;
        const nx = pos.x + Math.cos(this._chargeAngle) * chargeSpeed * dt;
        const ny = pos.y + Math.sin(this._chargeAngle) * chargeSpeed * dt;

        // 撞墙/出界检测（用不解析的碰撞查询；圆礁石由 moveResolve 推出也算撞到）
        const wm = this.worldManager!;
        const hitWall = wm.collideWalls(nx, ny, BOSS.RADIUS, false);
        const outOfWorld = nx < BOSS.RADIUS || nx > WORLD.SIZE - BOSS.RADIUS
            || ny < BOSS.RADIUS || ny > WORLD.SIZE - BOSS.RADIUS;
        const resolved = wm.moveResolve(nx, ny, BOSS.RADIUS);
        const moved = Math.sqrt((resolved[0] - pos.x) ** 2 + (resolved[1] - pos.y) ** 2);
        const blockedByBoulder = moved < chargeSpeed * dt * 0.6; // 实际位移远小于预期 → 撞上圆礁石

        this.node.setPosition(resolved[0], resolved[1], pos.z);
        this._chargeDist += chargeSpeed * dt;
        this._contactDamage(BOSS.CHARGE_DAMAGE_MULT);

        if (hitWall || outOfWorld || blockedByBoulder || this._chargeDist >= BOSS.CHARGE_RANGE) {
            // 撞停 → 硬直 1s（输出窗口）
            this._chargeState = 'stun';
            this._chargeTimer = BOSS.CHARGE_STUN;
        }
    }

    /** stun：硬直 1s，Boss 不移动（玩家输出窗口），结束后重置冲撞CD */
    private _updateStun(dt: number): void {
        this._chargeTimer -= dt;
        if (this._chargeTimer <= 0) {
            this._chargeState = 'idle';
            this._chargeCd = this._chargeInterval();
        }
    }

    /** 接触伤害（damagePlayer 内部有 invincible 无敌帧节流）；mult 为伤害倍率 */
    private _contactDamage(mult: number): void {
        if (!this.player || this.player.dead) return;
        const pos = this.node.position;
        const ppos = this.player.node.position;
        const r = BOSS.RADIUS + PLAYER.RADIUS;
        const dx = pos.x - ppos.x, dy = pos.y - ppos.y;
        if (dx * dx + dy * dy < r * r) {
            this.player.damagePlayer(this.damage * mult, pos.x, pos.y);
        }
    }

    /** 攻击交替间隔（狂暴后缩短） */
    private _attackInterval(): number {
        const mult = this._enrageTier >= 2 ? BOSS.ENRAGE_ATTACK_MULT_2
            : this._enrageTier >= 1 ? BOSS.ENRAGE_ATTACK_MULT_1 : 1;
        return BOSS.BURST_INTERVAL * mult;
    }

    /** 冲撞CD间隔（狂暴后缩短） */
    private _chargeInterval(): number {
        const mult = this._enrageTier >= 2 ? BOSS.ENRAGE_CHARGE_MULT_2
            : this._enrageTier >= 1 ? BOSS.ENRAGE_CHARGE_MULT_1 : 1;
        return BOSS.CHARGE_INTERVAL * mult;
    }

    /** 当前弹速（狂暴后提升） */
    private _bulletSpeed(): number {
        const mult = this._enrageTier >= 2 ? BOSS.ENRAGE_BULLET_SPEED_MULT_2
            : this._enrageTier >= 1 ? BOSS.ENRAGE_BULLET_SPEED_MULT_1 : 1;
        return BOSS.BURST_SPEED * mult;
    }

    /** 环形弹幕：向四周喷射 BURST_COUNT 发敌弹；二档狂暴升级为双环（角度错位） */
    private _burstBullets(): void {
        if (!this.entityManager) return;
        const pos = this.node.position;
        const map = MAPS[this.mapIndex % MAPS.length];
        const bulletDamage = map.bossBurstDamage;
        const speed = this._bulletSpeed();
        const rings = this._enrageTier >= 2 && BOSS.DOUBLE_RING ? 2 : 1;
        for (let ring = 0; ring < rings; ring++) {
            const offset = ring === 0 ? 0 : BOSS.DOUBLE_RING_OFFSET;
            const ringSpeed = ring === 0 ? speed : speed * BOSS.DOUBLE_RING_SPEED_MULT;
            for (let i = 0; i < BOSS.BURST_COUNT; i++) {
                const a = (i / BOSS.BURST_COUNT) * Math.PI * 2 + offset;
                this._spawnEnemyBullet(pos.x, pos.y, a, ringSpeed, bulletDamage, BOSS.BURST_RANGE, false);
            }
        }
        this.audioManager?.burst();
    }

    /** 瞄准扇形弹：朝玩家当前方向喷射 AIM_COUNT 发扇形直线弹；二档狂暴升级为追踪弹 */
    private _aimedFanBullets(): void {
        if (!this.entityManager || !this.player || this.player.dead) return;
        const pos = this.node.position;
        const ppos = this.player.node.position;
        const map = MAPS[this.mapIndex % MAPS.length];
        const bulletDamage = map.bossBurstDamage;
        const base = Math.atan2(ppos.y - pos.y, ppos.x - pos.x);
        const speed = this._bulletSpeed() * (BOSS.AIM_SPEED / BOSS.BURST_SPEED);
        const homing = this._enrageTier >= 2 && BOSS.HOMING;
        for (let i = 0; i < BOSS.AIM_COUNT; i++) {
            const t = BOSS.AIM_COUNT === 1 ? 0.5 : i / (BOSS.AIM_COUNT - 1);
            const a = base - BOSS.AIM_SPREAD / 2 + t * BOSS.AIM_SPREAD;
            const bullet = this._spawnEnemyBullet(pos.x, pos.y, a, speed, bulletDamage, BOSS.AIM_RANGE, homing);
            if (bullet && homing) {
                bullet.homing = true;
                bullet.homingTurnRate = BOSS.HOMING_TURN_RATE;
            }
        }
        this.audioManager?.burst();
    }

    /** 创建一发敌弹并挂 Bullet 组件；返回 Bullet 组件（追踪弹调用方可再设 homing 参数） */
    private _spawnEnemyBullet(x: number, y: number, angle: number, speed: number,
        damage: number, range: number, homing: boolean): Bullet | null {
        if (!this.entityManager) return null;
        const bn = new Node('BossBullet');
        this.entityManager.addChild(bn);
        bn.setPosition(x, y, 0);
        // 弹幕视觉强化：更大 + 高对比 + 白色描边（原 10px 小红圆在珊瑚背景里几乎不可见，
        // 玩家看不到 Boss 技能 → "只看到大靶子笨笨的"）
        ensureRenderTransform(bn, 36, 36);
        const g = bn.addComponent(Graphics);
        // 外圈白色描边（高对比，任何背景都醒目）
        g.fillColor = new Color(255, 255, 255, 220);
        g.circle(0, 0, 16);
        g.fill();
        // 主球体（红橙渐变感：外深内亮）
        g.fillColor = new Color(255, 80, 50, 255);
        g.circle(0, 0, 13);
        g.fill();
        g.fillColor = new Color(255, 230, 150, 255);
        g.circle(0, 0, 7);
        g.fill();
        const bullet = bn.addComponent(Bullet);
        bullet.gameManager = this.gameManager;
        bullet.targetPlayer = this.player;
        bullet.worldManager = this.worldManager;
        bullet.init(angle, speed, damage, range, true, 0);
        return bullet;
    }

    /** 召唤小怪：复用 EnemyAI（与 SpawnManager._spawnNormal 同款初始化），狂暴后周期性 1-2 只 */
    private _summonMinions(): void {
        if (!this.entityManager || !this.player) return;
        const map = MAPS[this.mapIndex % MAPS.length];
        const pool = map.enemies;
        if (!pool.length) return;
        const count = BOSS.SUMMON_MIN + Math.floor(Math.random() * (BOSS.SUMMON_MAX - BOSS.SUMMON_MIN + 1)); // 1-2 只
        const wave = this.gameManager?.spawnManager?.wave ?? BOSS.SUMMON_WAVE_FALLBACK;
        const pos = this.node.position;
        for (let i = 0; i < count; i++) {
            const type = pool[Math.floor(Math.random() * pool.length)];
            const a = Math.random() * Math.PI * 2;
            const sx = clamp(pos.x + Math.cos(a) * BOSS.SUMMON_DIST, 60, WORLD.SIZE - 60);
            const sy = clamp(pos.y + Math.sin(a) * BOSS.SUMMON_DIST, 60, WORLD.SIZE - 60);
            const node = new Node('Enemy');
            node.setPosition(sx, sy, 0);
            this.entityManager.addChild(node);
            const ai = node.getComponent(EnemyAI) ?? node.addComponent(EnemyAI);
            if (ai) {
                ai.worldManager = this.worldManager;
                ai.audioManager = this.audioManager;
                ai.gameManager = this.gameManager;
                ai.player = this.player;
                ai.init(sx, sy, wave, type, map.enemyHpMult);
            }
        }
        this.audioManager?.burst();
    }

    // ============================================================
    // ===== Boss 专属技能系统（配置见 config.BOSS_SKILLS） =====
    // ============================================================

    /** 每帧技能层：跳跃状态机 → 活跃效果（电球/分身/黑洞）→ 技能 CD */
    private _updateSkills(dt: number): void {
        this._updateSlam(dt);
        this._updateOrbs(dt);
        this._updateClones(dt);
        this._updateBlackhole(dt);
        // 硬控（跳跃）或冲撞蓄力/冲刺进行中：技能 CD 暂停，避免招式视觉叠一起
        if (!this._skillBusy && this._chargeState === 'idle') {
            this._tickSkillCds(dt);
        }
    }

    /** 技能 CD 倒计时；到点即释放（CD 在 _beginXXX 内重置） */
    private _tickSkillCds(dt: number): void {
        const cfg = this._skillCfg;
        if (!cfg) return;
        if (cfg.slam) { this._skillCd.slam -= dt; if (this._skillCd.slam <= 0) this._beginSlam(); }
        if (cfg.orbs) { this._skillCd.orbs -= dt; if (this._skillCd.orbs <= 0) this._beginOrbs(); }
        if (cfg.clones) { this._skillCd.clones -= dt; if (this._skillCd.clones <= 0) this._beginClones(); }
        if (cfg.blackhole) { this._skillCd.blackhole -= dt; if (this._skillCd.blackhole <= 0) this._beginBlackhole(); }
    }

    // -------- 跳跃砸地（巨蟹王）：蓄力红圈 → 抛物线跃向玩家 → 落地冲击波 --------

    /** 开始跳跃：锁定落点（蓄力开始时的玩家位置，红圈预警，玩家提前走开即可躲） */
    private _beginSlam(): void {
        const cfg = this._skillCfg?.slam;
        if (!cfg || !this.player || this.player.dead) return;
        const ppos = this.player.node.position;
        const pos = this.node.position;
        const dist2 = (ppos.x - pos.x) ** 2 + (ppos.y - pos.y) ** 2;
        if (dist2 < 120 * 120) {
            // 贴身时跳跃无意义（接触伤害已构成威胁），半 CD 后重试避免每帧忙循环
            this._skillCd.slam = cfg.cd * 0.5;
            return;
        }
        this._slamState = 'windup';
        this._slamTimer = cfg.windup;
        this._slamStartX = pos.x;
        this._slamStartY = pos.y;
        this._slamTargetX = ppos.x;
        this._slamTargetY = ppos.y;
        this._setSlamWarnVisible(true);
        this._skillCd.slam = cfg.cd;
        this.audioManager?.laserWarn();
        this._announceSkill('slam');
    }

    /** 跳跃状态机：蓄力静止 → 空中抛物线插值（弧顶抬升，可被子弹命中）→ 落地冲击波 */
    private _updateSlam(dt: number): void {
        if (this._slamState === 'idle') return;
        const cfg = this._skillCfg?.slam;
        if (!cfg) { this._slamState = 'idle'; return; }
        this._slamTimer -= dt;
        const pos = this.node.position;
        if (this._slamState === 'windup') {
            // 蓄力：原地待机（预警红圈锁定落点，Boss 不移动）
            if (this._slamTimer <= 0) {
                this._slamState = 'airborne';
                this._slamTimer = cfg.airTime;
                this._setSlamWarnVisible(false);
                this.audioManager?.burst();
            }
        } else if (this._slamState === 'airborne') {
            // 空中：起点 → 落点线性插值 + 正弦弧顶抬升
            const t = Math.max(0, Math.min(1, 1 - this._slamTimer / cfg.airTime));
            const lift = Math.sin(t * Math.PI) * 72;
            const x = this._slamStartX + (this._slamTargetX - this._slamStartX) * t;
            const y = this._slamStartY + (this._slamTargetY - this._slamStartY) * t;
            const fa = Math.atan2(this._slamTargetY - this._slamStartY, this._slamTargetX - this._slamStartX);
            this.faceAngle = fa;
            this.node.setRotationFromEuler(0, 0, -fa * 180 / Math.PI);
            this.node.setPosition(x, y + lift, pos.z);
            if (this._slamTimer <= 0) {
                this._slamState = 'idle';
                this.node.setPosition(this._slamTargetX, this._slamTargetY, pos.z);
                this._landSlam();
            }
        }
    }

    /** 落地：冲击波环形弹幕 + 扩散圆环视觉 */
    private _landSlam(): void {
        const cfg = this._skillCfg?.slam;
        if (!cfg || !this.entityManager) return;
        const pos = this.node.position;
        this._spawnSlamRing(pos.x, pos.y);
        for (let i = 0; i < cfg.waveCount; i++) {
            const a = (i / cfg.waveCount) * Math.PI * 2;
            this._spawnEnemyBullet(pos.x, pos.y, a, cfg.waveSpeed, cfg.damage, cfg.range, false);
        }
        this.audioManager?.explosion();
    }

    /** 砸地扩散圆环（纯视觉，0.35s 放大淡出后自毁） */
    private _spawnSlamRing(x: number, y: number): void {
        if (!this.entityManager) return;
        const rn = new Node('SlamRing');
        this.entityManager.addChild(rn);
        rn.setPosition(x, y, 0);
        ensureRenderTransform(rn, 260, 260);
        const g = rn.addComponent(Graphics);
        g.lineWidth = 6;
        g.strokeColor = new Color(255, 230, 140, 220);
        g.circle(0, 0, 36);
        g.stroke();
        g.lineWidth = 3;
        g.strokeColor = new Color(255, 120, 60, 160);
        g.circle(0, 0, 20);
        g.stroke();
        try {
            tween(rn).to(0.35, { scale: new Vec3(2.6, 2.6, 1) }).call(() => { rn.destroy(); }).start();
        } catch {
            rn.destroy();
        }
    }

    /** 跳跃落点预警节点：红圈画在落点（子节点本地偏移 = 落点 - 宿主位置） */
    private _ensureSlamWarnNode(): void {
        if (this._slamWarnNode) return;
        const wn = new Node('SlamWarn');
        wn.setPosition(0, 0, 0);
        this.node.addChild(wn);
        ensureRenderTransform(wn, 200, 200);
        this._slamWarnNode = wn;
        this._slamWarnGfx = wn.getComponent(Graphics) || wn.addComponent(Graphics);
        wn.active = false;
    }

    private _setSlamWarnVisible(show: boolean): void {
        if (!this._slamWarnNode || !this._slamWarnGfx) return;
        if (!show) { this._slamWarnNode.active = false; return; }
        const g = this._slamWarnGfx;
        g.clear();
        this._slamWarnNode.setPosition(
            this._slamTargetX - this.node.position.x,
            this._slamTargetY - this.node.position.y, 0);
        const pulse = 0.5 + 0.3 * Math.sin(Date.now() / 70);
        g.lineWidth = 5;
        g.strokeColor = new Color(255, 220, 60, Math.floor(pulse * 255));
        g.circle(0, 0, 46);
        g.stroke();
        g.lineWidth = 3;
        g.strokeColor = new Color(255, 60, 40, Math.floor(pulse * 200));
        g.circle(0, 0, 26);
        g.stroke();
        this._slamWarnNode.active = true;
    }

    // -------- 电球护体（巨鳗王）：N 个电球环绕，触碰受伤 --------

    /** 召唤环绕电球：位置跟随 Boss 每帧重算，持续 duration 后消失 */
    private _beginOrbs(): void {
        const cfg = this._skillCfg?.orbs;
        if (!cfg || !this.entityManager) return;
        this._clearOrbs();
        const pos = this.node.position;
        for (let i = 0; i < cfg.count; i++) {
            const node = new Node('BossOrb');
            this.entityManager.addChild(node);
            node.setPosition(pos.x, pos.y, 0);
            ensureRenderTransform(node, cfg.orbRadius * 4 + 14, cfg.orbRadius * 4 + 14);
            const g = node.addComponent(Graphics);
            g.fillColor = new Color(255, 200, 60, 255);
            g.circle(0, 0, cfg.orbRadius);
            g.fill();
            g.fillColor = new Color(255, 255, 220, 255);
            g.circle(0, 0, cfg.orbRadius * 0.45);
            g.fill();
            // 电光尖刺（三向，静态即可，旋转靠环绕运动带出感）
            const a0 = (i / cfg.count) * Math.PI * 2;
            g.fillColor = new Color(255, 240, 150, 210);
            for (let k = 0; k < 3; k++) {
                const a = a0 + k * Math.PI * 2 / 3;
                g.moveTo(Math.cos(a) * cfg.orbRadius * 1.35, Math.sin(a) * cfg.orbRadius * 1.35);
                g.lineTo(Math.cos(a + 0.5) * cfg.orbRadius * 0.7, Math.sin(a + 0.5) * cfg.orbRadius * 0.7);
                g.lineTo(Math.cos(a - 0.5) * cfg.orbRadius * 0.7, Math.sin(a - 0.5) * cfg.orbRadius * 0.7);
                g.close();
                g.fill();
            }
            this._orbs.push({ node, angle: a0 });
        }
        this._orbTimer = cfg.duration;
        this._skillCd.orbs = cfg.cd;
        this.audioManager?.burst();
        this._announceSkill('orbs');
    }

    /** 电球环绕旋转 + 触碰伤害（damagePlayer 内部无敌帧节流） */
    private _updateOrbs(dt: number): void {
        const cfg = this._skillCfg?.orbs;
        if (!cfg || this._orbTimer <= 0) return;
        this._orbTimer -= dt;
        const pos = this.node.position;
        for (const orb of this._orbs) {
            orb.angle += cfg.orbitSpeed * dt;
            const ox = pos.x + Math.cos(orb.angle) * cfg.radius;
            const oy = pos.y + Math.sin(orb.angle) * cfg.radius;
            orb.node.setPosition(ox, oy, 0);
            if (this.player && !this.player.dead) {
                const ppos = this.player.node.position;
                const rr = cfg.orbRadius + PLAYER.RADIUS;
                const dx = ox - ppos.x, dy = oy - ppos.y;
                if (dx * dx + dy * dy < rr * rr) {
                    this.player.damagePlayer(cfg.damage, ox, oy);
                }
            }
        }
        if (this._orbTimer <= 0) this._clearOrbs();
    }

    private _clearOrbs(): void {
        for (const orb of this._orbs) {
            if (orb.node.isValid) orb.node.destroy();
        }
        this._orbs = [];
        this._orbTimer = 0;
    }

    // -------- 幻影分身（安康鱼王）：半透明幻影缓慢追击 + 周期性散射 --------

    /** 召唤幻影分身：不可被命中（半透明幽灵），持续 duration，用弹幕制造夹击 */
    private _beginClones(): void {
        const cfg = this._skillCfg?.clones;
        if (!cfg || !this.entityManager) return;
        this._clearClones();
        const pos = this.node.position;
        for (let i = 0; i < cfg.count; i++) {
            const node = new Node('BossClone');
            this.entityManager.addChild(node);
            const a = (i / cfg.count) * Math.PI * 2 + Math.random() * 0.8;
            const d = 150 + Math.random() * 60;
            const cx = clamp(pos.x + Math.cos(a) * d, 60, WORLD.SIZE - 60);
            const cy = clamp(pos.y + Math.sin(a) * d, 60, WORLD.SIZE - 60);
            node.setPosition(cx, cy, 0);
            ensureRenderTransform(node, cfg.radius * 2 + 20, cfg.radius * 2 + 20);
            const g = node.addComponent(Graphics);
            g.fillColor = new Color(150, 60, 220, 135);
            g.circle(0, 0, cfg.radius);
            g.fill();
            g.fillColor = new Color(230, 180, 255, 120);
            g.circle(0, 10, cfg.radius * 0.3);
            g.fill();
            this._clones.push({ node, fireTimer: 1.2 + i * 0.35 });
        }
        this._cloneTimer = cfg.duration;
        this._skillCd.clones = cfg.cd;
        this.audioManager?.burst();
        this._announceSkill('clones');
    }

    /** 分身：缓慢追玩家 + 呼吸闪烁 + 周期扇形瞄准弹（伤害减倍，威慑但可躲） */
    private _updateClones(dt: number): void {
        const cfg = this._skillCfg?.clones;
        if (!cfg || this._cloneTimer <= 0) return;
        this._cloneTimer -= dt;
        if (!this.player || this.player.dead) return;
        const ppos = this.player.node.position;
        for (const c of this._clones) {
            if (!c.node.isValid) continue;
            const cpos = c.node.position;
            const a = Math.atan2(ppos.y - cpos.y, ppos.x - cpos.x);
            const nx = cpos.x + Math.cos(a) * cfg.speed * dt;
            const ny = cpos.y + Math.sin(a) * cfg.speed * dt;
            c.node.setPosition(nx, ny, cpos.z);
            c.node.setRotationFromEuler(0, 0, -a * 180 / Math.PI);
            // 幽灵呼吸闪烁（重画两个圆/帧 × 2 分身，成本可忽略）
            const alpha = Math.floor((0.35 + 0.25 * Math.sin(Date.now() / 130 + nx)) * 255);
            const g = c.node.getComponent(Graphics);
            if (g) {
                g.clear();
                g.fillColor = new Color(150, 60, 220, alpha);
                g.circle(0, 0, cfg.radius);
                g.fill();
                g.fillColor = new Color(230, 180, 255, Math.floor(alpha * 0.9));
                g.circle(0, 10, cfg.radius * 0.3);
                g.fill();
            }
            // 开火：朝玩家扇形瞄准弹
            c.fireTimer -= dt;
            if (c.fireTimer <= 0 && !this.player.dead) {
                c.fireTimer = cfg.fireInterval;
                const map = MAPS[this.mapIndex % MAPS.length];
                const base = Math.atan2(ppos.y - ny, ppos.x - nx);
                for (let i = 0; i < cfg.fireCount; i++) {
                    const t = cfg.fireCount === 1 ? 0.5 : i / (cfg.fireCount - 1);
                    const fa = base - cfg.fireSpread / 2 + t * cfg.fireSpread;
                    this._spawnEnemyBullet(nx, ny, fa, this._bulletSpeed(),
                        map.bossBurstDamage * cfg.fireDamageMult, 540, false);
                }
                this.audioManager?.burst();
            }
        }
        if (this._cloneTimer <= 0) this._clearClones();
    }

    private _clearClones(): void {
        for (const c of this._clones) {
            if (c.node.isValid) c.node.destroy();
        }
        this._clones = [];
        this._cloneTimer = 0;
    }

    // -------- 引力黑洞（安康鱼王）：玩家脚下生成，吸附 → 爆炸弹幕 --------
    
    /** 在玩家脚下生成黑洞：引力场拉扯玩家（每帧重设玩家 externalVel），结束爆炸 */
    private _beginBlackhole(): void {
        const cfg = this._skillCfg?.blackhole;
        if (!cfg || !this.entityManager || !this.player || this.player.dead) return;
        this._clearBlackhole();
        const ppos = this.player.node.position;
        const node = new Node('GravityHole');
        this.entityManager.addChild(node);
        node.setPosition(ppos.x, ppos.y, 0);
        ensureRenderTransform(node, cfg.holeRadius * 4, cfg.holeRadius * 4);
        const g = node.addComponent(Graphics);
        g.fillColor = new Color(30, 10, 60, 255);
        g.circle(0, 0, cfg.holeRadius);
        g.fill();
        g.fillColor = new Color(100, 35, 170, 255);
        g.circle(0, 0, cfg.holeRadius * 0.72);
        g.fill();
        g.fillColor = new Color(20, 5, 40, 255);
        g.circle(0, 0, cfg.holeRadius * 0.38);
        g.fill();
        g.lineWidth = 4;
        g.strokeColor = new Color(190, 90, 255, 200);
        g.circle(0, 0, cfg.holeRadius + 10);
        g.stroke();
        this._holeNode = node;
        this._holeGfx = g;
        this._holeTimer = cfg.duration;
        this._holeCoreTick = 0;
        this._skillCd.blackhole = cfg.cd;
        this.audioManager?.laserWarn();
        this._announceSkill('blackhole');
    }
    
    /** 黑洞：引力拉扯玩家 + 核心吞噬伤害；最后 0.5s 红圈闪烁预警爆炸 */
    private _updateBlackhole(dt: number): void {
        const cfg = this._skillCfg?.blackhole;
        if (!cfg || !this._holeNode || !this._holeGfx) return;
        this._holeTimer -= dt;
        const pos = this._holeNode.position;
        const g = this._holeGfx;
        // 爆炸预警：最后 0.5s 外圈红紫闪烁
        if (this._holeTimer <= 0.5 && this._holeTimer > 0) {
            const pulse = 0.4 + 0.4 * Math.sin(Date.now() / 50);
            g.lineWidth = 6;
            g.strokeColor = new Color(255, 80, 80, Math.floor(pulse * 255));
            g.circle(0, 0, cfg.holeRadius + 14);
            g.stroke();
        }
        if (this._holeTimer <= 0) {
            this._explodeBlackhole();
            return;
        }
        if (!this.player || this.player.dead) return;
        const ppos = this.player.node.position;
        const dx = pos.x - ppos.x, dy = pos.y - ppos.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        // 引力：越靠近中心拉力越强（玩家 move 会叠加该速度，冲刺无视）
        if (dist > 12 && dist < cfg.pullRadius + 60) {
            const pull = cfg.pullForce * Math.max(0, Math.min(1, 1 - dist / cfg.pullRadius + 0.15));
            this.player.externalVelX = (dx / dist) * pull * 0.7;
            this.player.externalVelY = (dy / dist) * pull * 0.7;
        }
        // 核心吞噬：中心区域持续伤害（damagePlayer 内部无敌帧节流）
        const rr = cfg.holeRadius * 0.75 + PLAYER.RADIUS;
        if (dx * dx + dy * dy < rr * rr) {
            this._holeCoreTick -= dt;
            if (this._holeCoreTick <= 0) {
                this._holeCoreTick = 0.25;
                this.player.damagePlayer(cfg.coreDamage * 0.25, pos.x, pos.y);
            }
        }
    }
    
    /** 黑洞湮灭：成环形弹幕爆炸（被吸住的玩家会吃到全部伤害，逼迫提前逃离） */
    private _explodeBlackhole(): void {
        const cfg = this._skillCfg?.blackhole;
        const pos = this._holeNode ? this._holeNode.position : this.node.position;
        this._clearBlackhole();
        if (!cfg || !this.entityManager) return;
        for (let i = 0; i < cfg.explodeCount; i++) {
            const a = (i / cfg.explodeCount) * Math.PI * 2 + Math.random() * 0.15;
            this._spawnEnemyBullet(pos.x, pos.y, a, cfg.explodeSpeed, cfg.explodeDamage, 620, false);
        }
        this.audioManager?.explosion();
    }
    
    private _clearBlackhole(): void {
        if (this._holeNode && this._holeNode.isValid) this._holeNode.destroy();
        this._holeNode = null;
        this._holeGfx = null;
        this._holeTimer = 0;
        // 黑洞消失时清掉残余引力，避免玩家位置被继续拉扯
        if (this.player) {
            this.player.externalVelX = 0;
            this.player.externalVelY = 0;
        }
    }
    
    // -------- 公共 --------
    
    /** 技能首次释放提示（后续不刷屏） */
    private _announceSkill(key: string): void {
        if (!this._skillCfg || this._announced.has(key)) return;
        this._announced.add(key);
        this.gameManager?.notify(this._skillCfg.announce);
    }
    
    /** 清理所有技能残留（Boss 死亡/回收/重用前调用） */
    private _cleanupSkills(): void {
        this._setSlamWarnVisible(false);
        this._clearOrbs();
        this._clearClones();
        this._clearBlackhole();
    }

    /** 蓄力预警视觉：红圈 + 方向线（子节点本地坐标，宿主旋转已对准玩家） */
    private _setWarnVisible(show: boolean): void {
        if (!this._warnNode || !this._warnGfx) return;
        if (!show) { this._warnNode.active = false; return; }
        const g = this._warnGfx;
        g.clear();
        const ut = this._warnNode.getComponent(UITransform);
        const size = ut ? ut.contentSize.width : BOSS.RADIUS * 2 + 40;
        ensureRenderTransform(this._warnNode, size, size);
        // 红圈预警（脉冲透明度）
        const pulse = 0.45 + 0.3 * Math.sin(Date.now() / 60);
        g.strokeColor = new Color(255, 60, 40, Math.floor(pulse * 255));
        g.lineWidth = 5;
        g.circle(0, 0, BOSS.RADIUS + 12);
        g.stroke();
        // 方向线：沿冲撞方向（子节点随宿主旋转，本地 +X 即冲撞方向）
        g.strokeColor = new Color(255, 120, 60, 220);
        g.lineWidth = 4;
        g.moveTo(0, 0);
        g.lineTo(BOSS.RADIUS + 60, 0);
        g.stroke();
        this._warnNode.active = true;
    }

    /** 程序化"活"动画：只作用于 Sprite 子节点，不影响移动/碰撞/弹幕 */
    private _applySwim(dt: number): void {
        const sNode = this.node.getChildByName('Sprite');
        if (!sNode || !sNode.active) return;
        this._swim.update(dt, sNode, SWIM[this._swimType] || SWIM.boss);
    }

    /** 受击 */
    hurtEnemy(damage: number, bx: number, by: number): void {
        if (!this._active) return;
        this.hp -= damage;
        this.hitFlash = 0.08;
        const pos = this.node.position;
        const a = Math.atan2(pos.y - by, pos.x - bx);
        // Boss 击退更弱（体型大）；冲撞/跳跃空中免疫击退（轨迹稳定）
        if (this._chargeState !== 'dash' && this._slamState === 'idle') {
            this.knockX += Math.cos(a) * 30;
            this.knockY += Math.sin(a) * 30;
        }
        this._checkEnrage();
        if (this.hp <= 0) this._kill();
    }

    /** 狂暴检测：血量跨过 <50% / <30% 阈值时升级狂暴档位并施加增益 */
    private _checkEnrage(): void {
        const ratio = this.hp / this.maxHp;
        let tier = 0;
        if (ratio < BOSS.ENRAGE_HP_2) tier = 2;
        else if (ratio < BOSS.ENRAGE_HP_1) tier = 1;
        if (tier > this._enrageTier) {
            this._enrageTier = tier;
            this.speed = this._baseSpeed * (tier >= 2 ? BOSS.ENRAGE_SPEED_MULT_2 : BOSS.ENRAGE_SPEED_MULT_1);
            if (tier >= 2) {
                this.gameManager?.notify('☠️ BOSS 彻底狂暴！双环弹幕 + 追踪弹 + 召唤小怪！');
            } else {
                this.gameManager?.notify('🔥 BOSS 狂暴了！更快更猛！');
            }
            this.audioManager?.laserWarn();
        }
    }

    private _kill(): void {
        if (!this._active) return;
        this._active = false;
        // 清理技能残留（电球/分身/黑洞节点挂在 entityManager 下，不随宿主销毁）
        this._cleanupSkills();
        // Boss 死亡：移除战斗围栏（放玩家出去，并清空 Boss 专属碰撞墙）
        this.worldManager?.removeArena();
        this.node.active = false;
        // 销毁而非仅停用：避免死节点占内存导致内存泄漏闪退
        this.node.destroy();
        this.gameManager?.onBossKilled(this);
    }

    recycle(): void {
        this._active = false;
        this.player = null;
        this._setWarnVisible(false);
        this._cleanupSkills();
    }
}
