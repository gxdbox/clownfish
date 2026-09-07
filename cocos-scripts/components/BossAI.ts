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
import { _decorator, Component, Node, Graphics, Color, Sprite, UITransform } from 'cc';
import { BOSS, WORLD, GameState, SPRITES, MAPS, PLAYER } from '../config';
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

        this.node.setPosition(x, y, 0);
        this.node.active = true;
        this._ensureVisual();
        this._ensureWarnNode();
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
    }

    /** idle：追逐玩家 + 环形/瞄准扇形交替弹幕 + 冲撞CD + 狂暴后召唤小怪 */
    private _updateIdle(dt: number): void {
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
        ensureRenderTransform(bn, 22, 22);
        const g = bn.addComponent(Graphics);
        g.fillColor = new Color(255, 120, 90, 255);
        g.circle(0, 0, 10);
        g.fill();
        g.fillColor = new Color(255, 230, 200, 255);
        g.circle(0, 0, 5);
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
        // Boss 击退更弱（体型大）；冲撞中免疫击退
        if (this._chargeState !== 'dash') {
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
        this.node.active = false;
        // 销毁而非仅停用：避免死节点占内存导致内存泄漏闪退
        this.node.destroy();
        this.gameManager?.onBossKilled(this);
    }

    recycle(): void {
        this._active = false;
        this.player = null;
        this._setWarnVisible(false);
    }
}
