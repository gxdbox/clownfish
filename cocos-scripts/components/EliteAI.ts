/**
 * EliteAI.ts — 精英敌人行为（激光三态状态机 + 死亡爆发）
 * 挂在 Elite 预制体上。
 * 状态：idle（追踪）→ windup（预警1s）→ firing（光束0.8s）→ idle
 * 死亡：圆形爆发 24 发敌弹 + 必掉大血球（掉落由 SpawnManager 处理）
 * Cocos Creator 3.8.8 迁移版
 */
import { _decorator, Component, Node, Graphics, Color, Vec3, UITransform, Sprite } from 'cc';
import { ELITE, WORLD, GameState, PLAYER, SPRITES } from '../config';
import { ensureRenderTransform, loadSpriteOnto } from '../util';
import type { WorldManager } from '../managers/WorldManager';
import type { AudioManager } from '../managers/AudioManager';
import type { GameManager } from '../managers/GameManager';
import type { PlayerController } from './PlayerController';
import { Bullet } from './Bullet';
const { ccclass, property } = _decorator;

type LaserState = 'idle' | 'windup' | 'firing';

@ccclass('EliteAI')
export class EliteAI extends Component {

    // ===== 运行时引用 =====
    worldManager: WorldManager | null = null;
    audioManager: AudioManager | null = null;
    gameManager: GameManager | null = null;
    player: PlayerController | null = null;
    entityManager: Node | null = null;

    // ===== 精英属性 =====
    hp = 1;
    maxHp = 1;
    speed = ELITE.SPEED;
    damage = ELITE.CONTACT_DAMAGE;
    xp = ELITE.XP_VALUE;
    hitFlash = 0;
    knockX = 0;
    knockY = 0;
    faceAngle = 0;
    isElite = true;
    private _active = true;

    // 激光状态机
    laserState: LaserState = 'idle';
    laserTimer = ELITE.LASER_COOLDOWN;
    laserAngle = 0;
    laserDamageTick = 0;

    // 激光视觉
    private _gfx: Graphics | null = null;

    onLoad(): void {
        // 激光 Graphics 必须挂在精英节点自身；若无（Graphics 在 Body 子节点上），
        // _drawLaser 会拿到 null 直接跳过 → 激光永不绘制、精英毫无可见反馈。
        ensureRenderTransform(this.node, ELITE.RADIUS * 2 + 8, ELITE.RADIUS * 2 + 8);
        this._gfx = this.node.getComponent(Graphics) ?? this.node.addComponent(Graphics);
    }

    /** 初始化精英（由 SpawnManager 调用） */
    init(x: number, y: number, eliteCount: number): void {
        const EL = ELITE;
        this.hp = this.maxHp = Math.round(EL.HP * Math.pow(1 + EL.HP_GROWTH, eliteCount));
        this.speed = EL.SPEED;
        const dmgMult = Math.min(EL.DMG_MAX_MULT, 1 + EL.DMG_GROWTH * eliteCount);
        this.damage = EL.CONTACT_DAMAGE * dmgMult;
        this.xp = EL.XP_VALUE;
        this.hitFlash = 0;
        this.knockX = 0;
        this.knockY = 0;
        this.faceAngle = 0;
        this.laserState = 'idle';
        this.laserTimer = EL.LASER_COOLDOWN;
        this.laserAngle = 0;
        this.laserDamageTick = 0;
        this._active = true;

        this.node.setPosition(x, y, 0);
        this.node.active = true;
        this._ensureVisual();
    }

    update(dt: number): void {
        if (!this._active) return;
        // 暂停/结算时冻结（引擎自动调用本方法，需自行判断状态）
        if (this.gameManager?.state !== GameState.PLAYING) return;

        if (this.hitFlash > 0) this.hitFlash -= dt;
        this._applyHitFlash();

        // 击退衰减
        if (this.knockX !== 0 || this.knockY !== 0) {
            const pos = this.node.position;
            this.node.setPosition(pos.x + this.knockX * dt, pos.y + this.knockY * dt, pos.z);
            const damp = Math.pow(0.02, dt);
            this.knockX *= damp;
            this.knockY *= damp;
            if (Math.abs(this.knockX) + Math.abs(this.knockY) < 4) {
                this.knockX = 0;
                this.knockY = 0;
            }
            return;
        }

        if (!this.player || this.player.dead) return;

        switch (this.laserState) {
            case 'idle': this._updateIdle(dt); break;
            case 'windup': this._updateWindup(dt); break;
            case 'firing': this._updateFiring(dt); break;
        }

        this._drawLaser();
    }

    private _updateIdle(dt: number): void {
        const ppos = this.player.node.position;
        const pos = this.node.position;
        const a = Math.atan2(ppos.y - pos.y, ppos.x - pos.x);
        this.faceAngle = a;
        this.node.setRotationFromEuler(0, 0, -a * 180 / Math.PI);

        const nx = pos.x + Math.cos(a) * this.speed * dt;
        const ny = pos.y + Math.sin(a) * this.speed * dt;
        const resolved = this.worldManager!.moveResolve(nx, ny, ELITE.RADIUS);
        this.node.setPosition(resolved[0], resolved[1], pos.z);

        // 接触伤害：撞到玩家立即扣血（damagePlayer 内部有 invincible 无敌帧节流）
        const r = ELITE.RADIUS + PLAYER.RADIUS;
        const dx = resolved[0] - ppos.x, dy = resolved[1] - ppos.y;
        if (dx * dx + dy * dy < r * r) {
            this.player.damagePlayer(this.damage, resolved[0], resolved[1]);
        }

        this.laserTimer -= dt;
        if (this.laserTimer <= 0) {
            this.laserState = 'windup';
            this.laserTimer = ELITE.LASER_WINDUP;
            this.laserAngle = Math.atan2(ppos.y - pos.y, ppos.x - pos.x);
            this.audioManager?.laserWarn();
        }
    }

    private _updateWindup(dt: number): void {
        this.laserTimer -= dt;
        if (this.laserTimer <= 0) {
            this.laserState = 'firing';
            this.laserTimer = ELITE.LASER_DURATION;
            this.laserDamageTick = 0;
            this.audioManager?.laser();
        }
    }

    private _updateFiring(dt: number): void {
        this.laserTimer -= dt;
        if (this.laserTimer <= 0) {
            this.laserState = 'idle';
            this.laserTimer = ELITE.LASER_COOLDOWN;
        } else if (!this.player.dead) {
            const ppos = this.player.node.position;
            const pos = this.node.position;
            const distToElite = Math.sqrt((ppos.x - pos.x) ** 2 + (ppos.y - pos.y) ** 2);
            if (distToElite < ELITE.LASER_MAX_RANGE) {
                const dx = Math.cos(this.laserAngle);
                const dy = Math.sin(this.laserAngle);
                const px = ppos.x - pos.x, py = ppos.y - pos.y;
                const proj = px * dx + py * dy;
                if (proj > 0) {
                    const perp = Math.abs(px * dy - py * dx);
                    const width = ELITE.LASER_WIDTH / 2 + 14; // + player radius
                    if (perp < width) {
                        this.laserDamageTick -= dt;
                        if (this.laserDamageTick <= 0) {
                            this.laserDamageTick = 0.1;
                            this.player.damagePlayer(ELITE.LASER_DAMAGE_PER_SEC * 0.1, pos.x, pos.y);
                        }
                    }
                }
            }
        }
    }

    /** 绘制激光（预警线 + 光束）。Graphics 挂在精英节点自身 → 画在节点本地坐标系：
     * 起点 = (0,0)（即节点位置），终点 = 光束世界末端换算到本地（自动抵消节点旋转/缩放）。
     * 旧实现误把世界坐标当本地坐标画，激光被画到几千像素外的虚空 → 永远不可见。 */
    private _drawLaser(): void {
        if (!this._gfx) return;
        const g = this._gfx;
        g.clear();

        if (this.laserState === 'windup') {
            // 预警线（红色闪烁）
            const alpha = 0.35 + 0.3 * Math.sin(Date.now() / 60);
            g.strokeColor = new Color(255, 60, 80, Math.floor(alpha * 255));
            g.lineWidth = 4;
            this._strokeBeam(g, this.laserAngle, ELITE.LASER_MAX_RANGE);
        } else if (this.laserState === 'firing') {
            // 光束外层（红色）
            g.strokeColor = new Color(255, 80, 60, 230);
            g.lineWidth = ELITE.LASER_WIDTH;
            this._strokeBeam(g, this.laserAngle, ELITE.LASER_MAX_RANGE);
            // 光束内层（白色核心）
            g.strokeColor = new Color(255, 255, 255, 204);
            g.lineWidth = 6;
            this._strokeBeam(g, this.laserAngle, ELITE.LASER_MAX_RANGE);
        }
    }

    /** 在节点本地坐标系画一条从原点指向世界方向 angle、长 range 的线段（末端自动换算本地坐标） */
    private _strokeBeam(g: Graphics, angle: number, range: number): void {
        const pos = this.node.position;
        const ex = pos.x + Math.cos(angle) * range;
        const ey = pos.y + Math.sin(angle) * range;
        let lx = ex - pos.x;
        let ly = ey - pos.y;
        const ut = this.node.getComponent(UITransform);
        if (ut) {
            // 世界端点 → 节点本地坐标（Graphics 绘制空间），保证激光世界方向与伤害判定一致
            const lp = ut.convertToNodeSpaceAR(new Vec3(ex, ey, 0));
            lx = lp.x;
            ly = lp.y;
        }
        g.moveTo(0, 0);
        g.lineTo(lx, ly);
        g.stroke();
    }

    /** 受击闪红：hitFlash 计时内给精灵/Sprite 或 Graphics 上色，恢复原色 */
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

    /** 受击 */
    hurtEnemy(damage: number, bx: number, by: number): void {
        if (!this._active) return;
        this.hp -= damage;
        this.hitFlash = 0.08;
        const pos = this.node.position;
        const a = Math.atan2(pos.y - by, pos.x - bx);
        this.knockX += Math.cos(a) * 90;
        this.knockY += Math.sin(a) * 90;
        if (this.hp <= 0) this._kill();
    }

    private _kill(): void {
        if (!this._active) return;
        this._active = false;
        this.node.active = false;
        // 销毁而非仅停用：避免死节点占内存导致内存泄漏闪退
        this.node.destroy();
        // 死亡爆发：向四周喷射 BURST_COUNT 发敌弹（README 规格）
        this._burstBullets();
        this.gameManager?.onEliteKilled(this);
    }

    /**
     * 精英死亡爆发：N 发敌弹向全方向扩散。
     * 子弹零素材可用：无预制体时动态创建节点 + Graphics 红色弹丸视觉。
     */
    private _burstBullets(): void {
        if (!this.entityManager) return;
        const pos = this.node.position;
        const EL = ELITE;
        const bulletDamage = Math.max(6, Math.round(EL.CONTACT_DAMAGE * 0.45));
        for (let i = 0; i < EL.BURST_COUNT; i++) {
            const a = (i / EL.BURST_COUNT) * Math.PI * 2;
            const bn = new Node('EliteBullet');
            this.entityManager.addChild(bn);
            bn.setPosition(pos.x, pos.y, 0);
            // 兜底视觉：红色圆弹丸（无 Bullet 预制体/素材时保证可见）
            ensureRenderTransform(bn, 20, 20);
            const g = bn.addComponent(Graphics);
            g.fillColor = new Color(255, 80, 80, 255);
            g.circle(0, 0, 9);
            g.fill();
            g.fillColor = new Color(255, 210, 210, 255);
            g.circle(0, 0, 4);
            g.fill();
            const bullet = bn.addComponent(Bullet);
            bullet.gameManager = this.gameManager;
            bullet.targetPlayer = this.player;
            bullet.worldManager = this.worldManager;
            // 敌弹射程 620（略大于激光射程，避免弹幕瞬间穿透视野）
            bullet.init(a, EL.BURST_SPEED, bulletDamage, 620, true, 0);
        }
        this.audioManager?.burst();
    }

    /** 精英身体视觉兜底：Body 子节点 Graphics 一定绘制（无 Sprite 素材/无预制体时保证可见；激光用自身 Graphics 不受影响） */
    private _ensureVisual(): void {
        let body = this.node.getChildByName('Body');
        if (!body) {
            body = new Node('Body');
            body.setPosition(0, 0, 0);
            this.node.addChild(body);
        }
        const g = body.getComponent(Graphics) || body.addComponent(Graphics);
        g.clear();
        ensureRenderTransform(body, ELITE.RADIUS * 2 + 8, ELITE.RADIUS * 2 + 8);
        // 紫色大圆 + 白色核心（区别于普通敌人）
        g.fillColor = new Color(150, 90, 220, 255);
        g.circle(0, 0, ELITE.RADIUS);
        g.fill();
        g.fillColor = new Color(220, 180, 255, 255);
        g.circle(-4, -4, ELITE.RADIUS * 0.3);
        g.fill();
        g.fillColor = new Color(255, 80, 120, 255);
        g.circle(4, 4, ELITE.RADIUS * 0.24);
        g.fill();
        // 强制刷新 Graphics（web-mobile 环境需要，同 PlayerController 兜底）
        try { g.flush && g.flush(); } catch {}
        // 2) AI 素材：加载精英精灵图（复用 Boss 素材作精英视觉，区别于普通敌人），
        //    成功后隐藏上面的 Graphics 兜底（Graphics 在 web-mobile 下可能不渲染 → 精英不可见）
        loadSpriteOnto(this.node, SPRITES.BOSSES[0], ELITE.RADIUS * 2.4, ELITE.RADIUS * 2.4);
    }

    recycle(): void {
        this._active = false;
        this.player = null;
        if (this._gfx) this._gfx.clear();
    }
}
