/**
 * PlayerController.ts — 玩家行为（移动/自动攻击/冲刺/受击/护盾/升级/拾取效果）
 * 挂在 Player 预制体上。
 * 冲刺（核心动词，混合流）：手动触发 → 向移动方向高速位移 + 无敌帧 + 穿过敌人造成伤害 + 残影拖尾动画。
 * Cocos Creator 3.8.8 迁移版
 */
import { _decorator, Component, Node, Prefab, instantiate, Graphics, Color, Vec3, Sprite, SpriteFrame, UITransform } from 'cc';
import { clamp, ensureRenderTransform, loadSpriteOnto } from '../util';
import { PLAYER, BULLET, PICKUP, WORLD, GameState, DASH, SPRITES, expNeed } from '../config';
import { SwimAnim, SWIM } from '../swimAnim';
import type { WorldManager } from '../managers/WorldManager';
import type { AudioManager } from '../managers/AudioManager';
import type { GameManager } from '../managers/GameManager';
import type { Joystick } from './Joystick';
import type { CameraFollow } from './CameraFollow';
const { ccclass, property } = _decorator;

/** 升级选项 */
export interface UpgradeChoice {
    id: string;
    name: string;
    desc: string;
    icon: string;
}

/** 可受击的敌人组件（EnemyAI/EliteAI/BossAI 均实现 hurtEnemy） */
interface Hurtable {
    hurtEnemy(damage: number, bx: number, by: number): void;
}

@ccclass('PlayerController')
export class PlayerController extends Component {

    // ===== 编辑器属性 =====
    @property(Prefab) bulletPrefab: Prefab | null = null;

    // ===== 运行时引用（由 GameManager 注入） =====
    worldManager: WorldManager | null = null;
    audioManager: AudioManager | null = null;
    gameManager: GameManager | null = null;
    joystick: Joystick | null = null;
    cameraFollow: CameraFollow | null = null;
    entityManager: Node | null = null; // 子弹/特效的父节点

    // ===== 玩家属性 =====
    maxHp = PLAYER.MAX_HP;
    hp = PLAYER.MAX_HP;
    level = 1;
    exp = 0;
    expNext = 12;
    speed = PLAYER.SPEED;
    fireInterval = PLAYER.FIRE_INTERVAL;
    bulletSpeed = PLAYER.BULLET_SPEED;
    bulletCount = PLAYER.BULLET_COUNT;
    bulletDamage = PLAYER.BULLET_DAMAGE;
    bulletRange = PLAYER.BULLET_RANGE;
    pierce = BULLET.PIERCE_DEFAULT;
    pickupRange = PLAYER.PICKUP_RANGE;
    regen = PLAYER.REGEN_PER_SEC;
    fireTimer = 0;
    invincible = 0;
    hitFlash = 0;             // 受击闪红剩余时间（秒），>0 时给玩家上色
    shield = 0;
    boostTimer = 0;
    boostMult = 1;
    faceAngle = 0;
    dead = false;

    // ===== 冲刺状态 =====
    dashTimer = 0;                    // 冲刺进行中剩余时间(秒)
    dashCooldown = 0;                 // 当前冷却剩余(秒)
    dashCooldownMax = DASH.COOLDOWN;  // 冲刺冷却上限（可升级）
    dashDamage = DASH.DAMAGE;         // 冲刺撞击伤害（可升级）
    private _dashDirX = 1;
    private _dashDirY = 0;
    private _dashHitSet = new Set<object>();
    private _trailAcc = 0;
    private _ghosts: { node: Node; life: number }[] = [];

    private _pos = new Vec3();
    private _swim = new SwimAnim(); // 程序化游动动画（摆动/浮动/呼吸）

    onLoad(): void {
        this.expNext = this._expNeed(1);
        this._initVisual();
        this._loadPlayerSprite();
    }

    /** 玩家视觉：Graphics 像素风小丑鱼兜底（素材加载成功后由 loadSpriteOnto 隐藏） */
    private _initVisual(): void {
        let body = this.node.getChildByName('Body');
        if (!body) {
            body = new Node('Body');
            body.setPosition(0, 0, 0);
            this.node.addChild(body);
        }
        ensureRenderTransform(body, 64, 64);
        const g = body.getComponent(Graphics) || body.addComponent(Graphics);
        g.clear();
        // 身体（橙色圆角矩形，面向右）
        g.fillColor = new Color(255, 140, 40, 255);
        g.roundRect(-16, -10, 32, 20, 8);
        g.fill();
        // 白色竖条纹
        g.fillColor = new Color(255, 255, 255, 255);
        g.rect(0, -9, 5, 18);
        g.fill();
        // 尾鳍（三角形）
        g.fillColor = new Color(255, 100, 30, 255);
        g.moveTo(-16, 0);
        g.lineTo(-27, -9);
        g.lineTo(-27, 9);
        g.close();
        g.fill();
        // 背鳍
        g.fillColor = new Color(255, 120, 35, 255);
        g.moveTo(-4, -10);
        g.lineTo(2, -16);
        g.lineTo(8, -10);
        g.close();
        g.fill();
        // 眼睛
        g.fillColor = new Color(20, 20, 20, 255);
        g.circle(8, 4, 3);
        g.fill();
        // 强制刷新 Graphics（web-mobile 环境需要）
        try { g.flush && g.flush(); } catch {}
    }

    /** 加载 AI 小丑鱼素材（透明 PNG）；失败保持 Graphics 兜底 */
    private _loadPlayerSprite(): void {
        loadSpriteOnto(this.node, SPRITES.PLAYER, 48, 48);
    }

    /** 重置玩家属性（新游戏时调用） */
    reset(): void {
        this.maxHp = PLAYER.MAX_HP;
        this.hp = PLAYER.MAX_HP;
        this.level = 1;
        this.exp = 0;
        this.expNext = this._expNeed(1);
        this.speed = PLAYER.SPEED;
        this.fireInterval = PLAYER.FIRE_INTERVAL;
        this.bulletSpeed = PLAYER.BULLET_SPEED;
        this.bulletCount = PLAYER.BULLET_COUNT;
        this.bulletDamage = PLAYER.BULLET_DAMAGE;
        this.bulletRange = PLAYER.BULLET_RANGE;
        this.pierce = BULLET.PIERCE_DEFAULT;
        this.pickupRange = PLAYER.PICKUP_RANGE;
        this.regen = PLAYER.REGEN_PER_SEC;
        this.fireTimer = 0;
        this.invincible = 0;
        this.hitFlash = 0;
        this.shield = 0;
        this.boostTimer = 0;
        this.boostMult = 1;
        this.faceAngle = 0;
        this.dead = false;
        // 冲刺状态重置
        this.dashTimer = 0;
        this.dashCooldown = 0;
        this.dashCooldownMax = DASH.COOLDOWN;
        this.dashDamage = DASH.DAMAGE;
        this._dashHitSet.clear();
        this._trailAcc = 0;
        for (const gh of this._ghosts) gh.node.destroy();
        this._ghosts = [];
        this.node.setScale(1, 1, 1);
        this._swim.reset();
    }

    /** 放置玩家到起始位置 */
    placeAtStart(): void {
        this.node.setPosition(PLAYER.START_X, PLAYER.START_Y, 0);
    }

    private _expNeed(level: number): number {
        // 升级曲线（马里奥式：前几级快、逐级明显变慢，参考成熟游戏）
        return expNeed(level);
    }

    update(dt: number): void {
        if (this.dead) return;
        // 仅 PLAYING 状态运行（引擎自动调用本方法，需自行判断状态）
        if (this.gameManager?.state !== GameState.PLAYING) return;
        if (this.hitFlash > 0) this.hitFlash -= dt;
        this._applyHitFlash();
        this._updateTimers(dt);
        this._updateGhosts(dt);
        this._updateRegen(dt);
        this._updateFire(dt);
        if (this.dashTimer > 0) {
            this._updateDash(dt);
        } else {
            this._updateMove(dt);
        }
        this._applySwim(dt);
    }

    // ===== 移动 =====
    /** 程序化游动动画：只作用于 Sprite 子节点，让静态小丑鱼图"活"起来（摆尾/起伏） */
    private _applySwim(dt: number): void {
        const sNode = this.node.getChildByName('Sprite');
        if (!sNode || !sNode.active) return;
        this._swim.update(dt, sNode, SWIM.swimmer);
    }

    private _updateMove(dt: number): void {
        if (!this.joystick) return;
        const ix = this.joystick.moveX, iy = this.joystick.moveY;
        if (ix !== 0 || iy !== 0) {
            const speed = this.speed * this.boostMult;
            const pos = this.node.position;
            const nx = pos.x + ix * speed * dt;
            const ny = pos.y + iy * speed * dt;
            const wm = this.worldManager!;
            const resolved = wm.moveResolve(nx, ny, PLAYER.RADIUS);
            const cx = clamp(resolved[0], PLAYER.RADIUS, WORLD.SIZE - PLAYER.RADIUS);
            const cy = clamp(resolved[1], PLAYER.RADIUS, WORLD.SIZE - PLAYER.RADIUS);
            this.node.setPosition(cx, cy, pos.z);
            this.faceAngle = Math.atan2(iy, ix);
            this.node.setRotationFromEuler(0, 0, -this.faceAngle * 180 / Math.PI);
        }
    }

    // ===== 计时 =====
    private _updateTimers(dt: number): void {
        if (this.invincible > 0) this.invincible -= dt;
        if (this.dashCooldown > 0) this.dashCooldown -= dt;
        if (this.boostTimer > 0) {
            this.boostTimer -= dt;
            if (this.boostTimer <= 0) this.boostMult = 1;
        }
    }

    // ===== 回血 =====
    private _updateRegen(dt: number): void {
        if (this.regen > 0 && this.hp < this.maxHp) {
            this.hp = Math.min(this.maxHp, this.hp + this.regen * dt);
        }
    }

    // ===== 自动攻击 =====
    private _updateFire(dt: number): void {
        this.fireTimer -= dt;
        if (this.fireTimer <= 0) this._firePlayer();
    }

    private _firePlayer(): void {
        let angle: number;
        if (this.joystick && this.joystick.aimActive) {
            angle = Math.atan2(this.joystick.aimY, this.joystick.aimX);
            this.faceAngle = angle;
        } else {
            const target = this._findNearestEnemy(this.bulletRange * 1.2);
            if (!target) return;
            angle = Math.atan2(target.y - this.node.position.y, target.x - this.node.position.x);
            this.faceAngle = angle;
        }

        const n = this.bulletCount;
        const spread = (n - 1) * 0.12;
        const base = angle - spread / 2;
        const pos = this.node.position;

        for (let i = 0; i < n; i++) {
            const a = n === 1 ? angle : base + i * (spread / Math.max(1, n - 1));
            this._spawnBullet(pos.x, pos.y, a);
        }
        this.fireTimer = this.fireInterval;
        this.audioManager?.shoot();
    }

    private _spawnBullet(x: number, y: number, angle: number): void {
        if (!this.entityManager) return;
        let bulletNode: Node;
        if (this.bulletPrefab) {
            bulletNode = instantiate(this.bulletPrefab);
        } else {
            // 无 Bullet 预制体时自举：动态创建节点 + Graphics 视觉（黄色小圆，带白色高光）
            bulletNode = new Node('Bullet');
            ensureRenderTransform(bulletNode, 20, 20);
            const g = bulletNode.addComponent(Graphics);
            g.fillColor = new Color(255, 225, 90, 255);
            g.circle(0, 0, 5);
            g.fill();
            g.fillColor = new Color(255, 255, 255, 255);
            g.circle(-1, -1, 2);
            g.fill();
        }
        this.entityManager.addChild(bulletNode);
        bulletNode.setPosition(x, y, 0);
        // 自举节点无 Bullet 组件时补挂（预制体路径 getComponent 正常返回）
        const bullet = bulletNode.getComponent(BulletComponent) ?? bulletNode.addComponent(BulletComponent);
        if (bullet) {
            bullet.init(angle, this.bulletSpeed, this.bulletDamage, this.bulletRange, false, this.pierce);
            bullet.owner = this;
        }
    }

    /** 射程内最近敌人 */
    private _findNearestEnemy(maxDist: number): { x: number; y: number } | null {
        if (!this.entityManager) return null;
        const pos = this.node.position;
        let best: { x: number; y: number } | null = null;
        let bestD2 = maxDist * maxDist;
        const children = this.entityManager.children;
        for (const child of children) {
            if (!child.active) continue;
            const enemyAI = this._enemyComponent(child);
            if (!enemyAI) continue;
            const cpos = child.position;
            const d2 = (cpos.x - pos.x) ** 2 + (cpos.y - pos.y) ** 2;
            if (d2 < bestD2) {
                bestD2 = d2;
                best = { x: cpos.x, y: cpos.y };
            }
        }
        return best;
    }

    /** 取子节点上的敌人组件（EnemyAI/EliteAI/BossAI） */
    private _enemyComponent(child: Node): Hurtable | null {
        const e = child.getComponent('EnemyAI') || child.getComponent('EliteAI') || child.getComponent('BossAI');
        return (e as unknown as Hurtable) ?? null;
    }

    // ===== 冲刺 =====

    /** 尝试冲刺（由 Joystick 按钮/按键调用） */
    tryDash(): void {
        if (this.dead || this.dashCooldown > 0 || this.dashTimer > 0) return;
        // 方向：优先摇杆移动方向，否则朝 faceAngle（上次朝向）
        let dx = 0, dy = 0;
        if (this.joystick && (this.joystick.moveX !== 0 || this.joystick.moveY !== 0)) {
            dx = this.joystick.moveX;
            dy = this.joystick.moveY;
        } else {
            dx = Math.cos(this.faceAngle);
            dy = Math.sin(this.faceAngle);
        }
        const len = Math.hypot(dx, dy);
        if (len < 0.001) { dx = 1; dy = 0; }
        else { dx /= len; dy /= len; }

        this._dashDirX = dx;
        this._dashDirY = dy;
        this.faceAngle = Math.atan2(dy, dx);
        this.dashTimer = DASH.DURATION;
        this.dashCooldown = this.dashCooldownMax;
        this.invincible = Math.max(this.invincible, DASH.IFRAME);
        this._dashHitSet.clear();
        this._trailAcc = 0;
        // 冲刺拉伸动画（朝移动方向拉长）
        this.node.setScale(1.25, 0.8, 1);
        this.node.setRotationFromEuler(0, 0, -this.faceAngle * 180 / Math.PI);
        this.audioManager?.dash();
    }

    /** 冲刺进行中：高速位移 + 撞击伤害 + 残影 */
    private _updateDash(dt: number): void {
        this.dashTimer -= dt;
        const pos = this.node.position;
        const nx = pos.x + this._dashDirX * DASH.SPEED * dt;
        const ny = pos.y + this._dashDirY * DASH.SPEED * dt;
        const resolved = this.worldManager!.moveResolve(nx, ny, PLAYER.RADIUS);
        this.node.setPosition(
            clamp(resolved[0], PLAYER.RADIUS, WORLD.SIZE - PLAYER.RADIUS),
            clamp(resolved[1], PLAYER.RADIUS, WORLD.SIZE - PLAYER.RADIUS),
            pos.z
        );
        this._applyDashDamage();

        // 残影拖尾
        this._trailAcc += dt;
        const interval = DASH.DURATION / DASH.TRAIL_COUNT;
        while (this._trailAcc >= interval) {
            this._trailAcc -= interval;
            this._spawnDashGhost();
        }

        if (this.dashTimer <= 0) {
            this.node.setScale(1, 1, 1);
        }
    }

    /** 冲刺撞击：穿过敌人造成伤害（每敌每次冲刺仅一次） */
    private _applyDashDamage(): void {
        if (!this.entityManager) return;
        const pos = this.node.position;
        const r = DASH.HIT_RADIUS;
        for (const child of this.entityManager.children) {
            if (!child.active) continue;
            const e = this._enemyComponent(child);
            if (!e || this._dashHitSet.has(e as object)) continue;
            const cpos = child.position;
            const d2 = (cpos.x - pos.x) ** 2 + (cpos.y - pos.y) ** 2;
            if (d2 < r * r) {
                this._dashHitSet.add(e as object);
                e.hurtEnemy(this.dashDamage, pos.x, pos.y);
                this.audioManager?.hit();
            }
        }
    }

    /** 生成冲刺残影（复用主角 AI 素材帧，无则 Graphics 圆兜底） */
    private _spawnDashGhost(): void {
        if (!this.entityManager) return;
        const pos = this.node.position;
        const ghost = new Node('DashGhost');
        this.entityManager.addChild(ghost);
        ghost.setPosition(pos.x, pos.y, 0);
        ghost.setRotationFromEuler(0, 0, -this.faceAngle * 180 / Math.PI);

        const frame: SpriteFrame | null = this.node.getChildByName('Sprite')?.getComponent(Sprite)?.spriteFrame ?? null;
        if (frame && Sprite) {
            const sp = ghost.addComponent(Sprite);
            sp.spriteFrame = frame;
            sp.sizeMode = Sprite.SizeMode.CUSTOM;
            const ut = ghost.addComponent(UITransform);
            ut.setAnchorPoint(0.5, 0.5);
            ut.setContentSize(48, 48);
        } else {
            const g = ghost.addComponent(Graphics);
            g.fillColor = new Color(255, 140, 40, 190);
            g.circle(0, 0, PLAYER.RADIUS);
            g.fill();
        }
        this._ghosts.push({ node: ghost, life: 0.28 });
    }

    /** 残影淡出 */
    private _updateGhosts(dt: number): void {
        for (let i = this._ghosts.length - 1; i >= 0; i--) {
            const gh = this._ghosts[i];
            gh.life -= dt;
            if (gh.life <= 0) {
                gh.node.destroy();
                this._ghosts.splice(i, 1);
                continue;
            }
            const a = Math.floor(255 * (gh.life / 0.28) * 0.7);
            const sp = gh.node.getComponent(Sprite);
            if (sp) sp.color = new Color(255, 255, 255, a);
        }
    }

    // ===== 受击 =====
    /** 受击闪红：hitFlash 计时内给玩家 Sprite（或 Body Graphics 兜底）上色，恢复原色 */
    private _applyHitFlash(): void {
        const flash = this.hitFlash > 0;
        const col = flash ? new Color(255, 90, 90, 255) : new Color(255, 255, 255, 255);
        const spNode = this.node.getChildByName('Sprite');
        const sp = spNode && spNode.active ? spNode.getComponent(Sprite) : null;
        if (sp) sp.color = col;
        const body = this.node.getChildByName('Body');
        const g = body && body.active ? (body.getComponent(Graphics) as any) : null;
        if (g && g.color !== undefined) g.color = col; // Graphics.color 不存在时跳过（兜底场景）
    }

    damagePlayer(amount: number, srcX: number, srcY: number): void {
        if (this.dead || this.invincible > 0) return;

        if (this.shield > 0) {
            this.shield--;
            this.invincible = 0.35;
            this.audioManager?.pickup();
            this.gameManager?.notify('🛡 护盾抵挡了伤害！');
            return;
        }

        this.hp -= amount;
        this.invincible = PLAYER.INVINCIBLE_TIME;
        this.hitFlash = 0.12; // 受击闪红 0.12s，让玩家明确感知"被打到了"

        // 击退
        const a = Math.atan2(this.node.position.y - srcY, this.node.position.x - srcX);
        const kx = Math.cos(a) * PLAYER.KNOCKBACK;
        const ky = Math.sin(a) * PLAYER.KNOCKBACK;
        const pos = this.node.position;
        const nx = clamp(pos.x + kx * 0.08, PLAYER.RADIUS, WORLD.SIZE - PLAYER.RADIUS);
        const ny = clamp(pos.y + ky * 0.08, PLAYER.RADIUS, WORLD.SIZE - PLAYER.RADIUS);
        const resolved = this.worldManager!.moveResolve(nx, ny, PLAYER.RADIUS);
        this.node.setPosition(resolved[0], resolved[1], pos.z);

        this.audioManager?.hurt();

        if (this.hp <= 0) {
            this.hp = 0;
            this.dead = true;
            this.gameManager?.onPlayerDeath();
        }
    }

    // ===== 经验 =====
    addExp(amount: number): boolean {
        if (this.dead) return false;
        this.exp += amount;
        let leveled = false;
        while (this.exp >= this.expNext) {
            this.exp -= this.expNext;
            this.level++;
            this.expNext = this._expNeed(this.level);
            this.hp = Math.min(this.maxHp, this.hp + 10);
            leveled = true;
        }
        if (leveled) {
            this.audioManager?.levelup();
            this.gameManager?.onLevelUp();
        }
        return leveled;
    }

    // ===== 拾取效果 =====
    applyPickup(type: string): void {
        if (type === 'range') {
            this.bulletRange *= (1 + PICKUP.RANGE_BONUS);
            this.pickupRange *= (1 + PICKUP.RANGE_BONUS);
        } else if (type === 'boost') {
            this.boostMult = 1 + PICKUP.BOOST_SPEED_BONUS;
            this.boostTimer = PICKUP.BOOST_DURATION;
        } else if (type === 'hp') {
            this.hp = Math.min(this.maxHp, this.hp + PICKUP.HP_AMOUNT);
        } else if (type === 'hpBig') {
            this.hp = Math.min(this.maxHp, this.hp + PICKUP.HP_BIG_AMOUNT);
        } else if (type === 'shield') {
            this.shield = Math.min(PICKUP.SHIELD_MAX, this.shield + 1);
        }
    }

    /** 应用升级选项 */
    applyUpgrade(choice: UpgradeChoice): void {
        switch (choice.id) {
            case 'bulletCount': this.bulletCount++; break;
            case 'bulletDamage': this.bulletDamage += 5; break;
            case 'bulletSpeed': this.bulletSpeed += 40; break;
            case 'fireRate': this.fireInterval *= 0.85; break;
            case 'maxHp': this.maxHp += 20; this.hp += 20; break;
            case 'speed': this.speed += 20; break;
            case 'bulletRange': this.bulletRange += 60; break;
            case 'regen': this.regen += 0.5; break;
            case 'pierce': this.pierce++; break;
            case 'pickupRange': this.pickupRange += 30; break;
            // 冲刺强化（质变级，马里奥式：强化唯一核心动词）
            case 'dashCooldown': this.dashCooldownMax *= 0.75; break;   // 冲刺冷却 -25%
            case 'dashDamage': this.dashDamage += 15; break;            // 冲刺伤害 +15
            case 'dashMulti': this.dashCooldownMax *= 0.6; this.dashDamage += 10; break; // 冲刺大师
        }
    }
}

/** Bullet 组件（放在 Bullet.ts 文件中，这里引用） */
// 实际 Bullet 组件在 Bullet.ts 中定义，此处仅声明类型
import { Bullet as BulletComponent } from './Bullet';
