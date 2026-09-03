/**
 * BossAI.ts — 地图 Boss 行为（追逐玩家 + 接触伤害 + 周期性环形弹幕）
 * 挂在 Boss 节点上（由 SpawnManager 动态创建）。
 * 视觉：优先 AI 精灵素材（SPRITES.BOSSES[mapIndex]），失败回退 Graphics 大圆。
 * 死亡：由 SpawnManager 处理掉落 + 生成传送门。
 * Cocos Creator 3.8.8 迁移版
 */
import { _decorator, Component, Node, Graphics, Color, Sprite } from 'cc';
import { BOSS, WORLD, GameState, SPRITES, MAPS, PLAYER } from '../config';
import { ensureRenderTransform, loadSpriteOnto } from '../util';
import type { WorldManager } from '../managers/WorldManager';
import type { AudioManager } from '../managers/AudioManager';
import type { GameManager } from '../managers/GameManager';
import type { PlayerController } from './PlayerController';
import { Bullet } from './Bullet';
const { ccclass, property } = _decorator;

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
    burstTimer = BOSS.BURST_INTERVAL * 0.6; // 首次弹幕提前一点
    private _active = true;

    /** 初始化 Boss（由 SpawnManager 调用） */
    init(x: number, y: number, mapIndex: number): void {
        const map = MAPS[mapIndex % MAPS.length];
        this.mapIndex = mapIndex % MAPS.length;
        this.hp = this.maxHp = Math.round(map.bossHp);
        this.speed = map.bossSpeed;
        this.damage = map.bossDamage;
        this.xp = BOSS.XP_VALUE;
        this.hitFlash = 0;
        this.knockX = 0;
        this.knockY = 0;
        this.faceAngle = 0;
        this.burstTimer = BOSS.BURST_INTERVAL * 0.6;
        this._active = true;

        this.node.setPosition(x, y, 0);
        this.node.active = true;
        this._ensureVisual();
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
    }

    update(dt: number): void {
        if (!this._active) return;
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

        // 追逐玩家
        const ppos = this.player.node.position;
        const pos = this.node.position;
        const a = Math.atan2(ppos.y - pos.y, ppos.x - pos.x);
        this.faceAngle = a;
        this.node.setRotationFromEuler(0, 0, -a * 180 / Math.PI);
        const nx = pos.x + Math.cos(a) * this.speed * dt;
        const ny = pos.y + Math.sin(a) * this.speed * dt;
        const resolved = this.worldManager!.moveResolve(nx, ny, BOSS.RADIUS);
        this.node.setPosition(resolved[0], resolved[1], pos.z);

        // 接触伤害：撞到玩家立即扣血（damagePlayer 内部有 invincible 无敌帧节流）
        const r = BOSS.RADIUS + PLAYER.RADIUS;
        const dx = resolved[0] - ppos.x, dy = resolved[1] - ppos.y;
        if (dx * dx + dy * dy < r * r) {
            this.player.damagePlayer(this.damage, resolved[0], resolved[1]);
        }

        // 周期性环形弹幕
        this.burstTimer -= dt;
        if (this.burstTimer <= 0) {
            this.burstTimer = BOSS.BURST_INTERVAL;
            this._burstBullets();
        }
    }

    /** 环形弹幕：向四周喷射 BURST_COUNT 发敌弹 */
    private _burstBullets(): void {
        if (!this.entityManager) return;
        const pos = this.node.position;
        const map = MAPS[this.mapIndex % MAPS.length];
        const bulletDamage = map.bossBurstDamage;
        for (let i = 0; i < BOSS.BURST_COUNT; i++) {
            const a = (i / BOSS.BURST_COUNT) * Math.PI * 2;
            const bn = new Node('BossBullet');
            this.entityManager.addChild(bn);
            bn.setPosition(pos.x, pos.y, 0);
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
            bullet.init(a, BOSS.BURST_SPEED, bulletDamage, BOSS.BURST_RANGE, true, 0);
        }
        this.audioManager?.burst();
    }

    /** 受击 */
    hurtEnemy(damage: number, bx: number, by: number): void {
        if (!this._active) return;
        this.hp -= damage;
        this.hitFlash = 0.08;
        const pos = this.node.position;
        const a = Math.atan2(pos.y - by, pos.x - bx);
        // Boss 击退更弱（体型大）
        this.knockX += Math.cos(a) * 30;
        this.knockY += Math.sin(a) * 30;
        if (this.hp <= 0) this._kill();
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
    }
}
