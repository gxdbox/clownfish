/**
 * EliteAI.ts — 精英敌人行为（激光三态状态机 + 死亡爆发）
 * 挂在 Elite 预制体上。
 * 状态：idle（追踪）→ windup（预警1s）→ firing（光束0.8s）→ idle
 * 死亡：圆形爆发 24 发敌弹 + 必掉大血球（掉落由 SpawnManager 处理）
 * Cocos Creator 3.8.8 迁移版
 */
import { _decorator, Component, Node, Graphics, Color, Sprite } from 'cc';
import { ELITE, WORLD, GameState } from '../config';
import { ensureRenderTransform } from '../util';
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
        this._gfx = this.node.getComponent(Graphics);
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

    /** 绘制激光（预警线 + 光束） */
    private _drawLaser(): void {
        if (!this._gfx) return;
        const g = this._gfx;
        g.clear();

        const pos = this.node.position;

        if (this.laserState === 'windup') {
            // 预警线（红色闪烁）
            const alpha = 0.35 + 0.3 * Math.sin(Date.now() / 60);
            g.strokeColor = new Color(255, 60, 80, Math.floor(alpha * 255));
            g.lineWidth = 4;
            g.moveTo(pos.x, pos.y);
            g.lineTo(
                pos.x + Math.cos(this.laserAngle) * ELITE.LASER_MAX_RANGE,
                pos.y + Math.sin(this.laserAngle) * ELITE.LASER_MAX_RANGE
            );
            g.stroke();
        } else if (this.laserState === 'firing') {
            // 光束（渐变效果用两段绘制）
            const ex = pos.x + Math.cos(this.laserAngle) * ELITE.LASER_MAX_RANGE;
            const ey = pos.y + Math.sin(this.laserAngle) * ELITE.LASER_MAX_RANGE;

            // 外层红色
            g.strokeColor = new Color(255, 80, 60, 230);
            g.lineWidth = ELITE.LASER_WIDTH;
            g.moveTo(pos.x, pos.y);
            g.lineTo(ex, ey);
            g.stroke();

            // 内层白色核心
            g.strokeColor = new Color(255, 255, 255, 204);
            g.lineWidth = 6;
            g.moveTo(pos.x, pos.y);
            g.lineTo(ex, ey);
            g.stroke();
        }
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

    /** 精英身体视觉兜底（无 Sprite 素材时用 Graphics 绘制，激光用自身 Graphics 不受影响） */
    private _ensureVisual(): void {
        // Sprite 可能被 Cocos treeshake 成 undefined，需安全检查
        const SpriteCtor = Sprite;
        if (!SpriteCtor || this.node.getComponent(Sprite)) return;
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
    }

    recycle(): void {
        this._active = false;
        this.player = null;
        if (this._gfx) this._gfx.clear();
    }
}
