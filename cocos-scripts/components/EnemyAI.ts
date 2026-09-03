/**
 * EnemyAI.ts — 普通敌人行为（追逐玩家 + 接触伤害）
 * 挂在 Enemy 预制体上。
 * Cocos Creator 3.8.8 迁移版
 */
import { _decorator, Component, Node, Graphics, Color, Sprite } from 'cc';
import { ENEMY, WORLD, GameState, SPRITES, PLAYER } from '../config';
import { ensureRenderTransform, loadSpriteOnto } from '../util';
import type { WorldManager } from '../managers/WorldManager';
import type { AudioManager } from '../managers/AudioManager';
import type { GameManager } from '../managers/GameManager';
import type { PlayerController } from './PlayerController';
const { ccclass, property } = _decorator;

// 五种敌人外观行为差异：[速度倍率, 接触伤害倍率, 半径]（对应 SPRITES.ENEMIES 五张素材）
const TYPES = [
    { spd: 1.0, dmg: 1.0, r: 13 },   // 水母（均衡）
    { spd: 0.75, dmg: 1.2, r: 15 },  // 螃蟹（肉盾）
    { spd: 1.25, dmg: 0.85, r: 12 }, // 电鳗（快速）
    { spd: 0.9, dmg: 1.1, r: 14 },   // 河豚（偏肉）
    { spd: 1.1, dmg: 1.0, r: 12 }    // 鮟鱇（较快）
];

// 五种敌人兜底配色（无 Sprite 素材时的 Graphics 绘制，与 TYPES 一一对应）
const TYPE_COLORS = [
    new Color(255, 160, 210, 255),  // 水母粉
    new Color(235, 90, 80, 255),    // 螃蟹红
    new Color(245, 210, 70, 255),   // 电鳗黄
    new Color(240, 170, 60, 255),   // 河豚橙黄
    new Color(70, 90, 160, 255)     // 鮟鱇深蓝
];

@ccclass('EnemyAI')
export class EnemyAI extends Component {

    // ===== 运行时引用（由 SpawnManager 注入） =====
    worldManager: WorldManager | null = null;
    audioManager: AudioManager | null = null;
    gameManager: GameManager | null = null;
    player: PlayerController | null = null;

    // ===== 敌人属性 =====
    type = 0;
    hp = 1;
    maxHp = 1;
    speed = 1;
    damage = 1;
    xp = 3;
    hitFlash = 0;
    knockX = 0;
    knockY = 0;
    faceAngle = 0;
    isElite = false;
    private _active = true;

    /** 初始化敌人（由 SpawnManager 调用）；hpMult = 当前地图血量倍率 */
    init(x: number, y: number, wave: number, type: number, hpMult = 1): void {
        const t = TYPES[type % TYPES.length];
        const E = ENEMY;

        this.type = type % TYPES.length;
        this.hp = this.maxHp = Math.round(E.HP_BASE * Math.pow(1 + E.HP_GROWTH, wave - 1) * hpMult);
        this.speed = Math.min(E.SPEED_MAX, E.SPEED_BASE + E.SPEED_GROWTH * (wave - 1)) * t.spd;
        const dmgMult = Math.min(E.DMG_MAX_MULT, 1 + E.DMG_GROWTH * (wave - 1));
        this.damage = E.CONTACT_DAMAGE * dmgMult * t.dmg;
        this.xp = Math.round(E.XP_VALUE + E.XP_GROWTH * (wave - 1));
        this.hitFlash = 0;
        this.knockX = 0;
        this.knockY = 0;
        this.faceAngle = 0;
        this.isElite = false;
        this._active = true;

        this.node.setPosition(x, y, 0);
        this.node.active = true;
        this._ensureVisual();
    }

    /** 敌人身体视觉：优先 AI 精灵素材（透明背景），加载失败回退 Graphics 圆形（零素材仍可玩） */
    private _ensureVisual(): void {
        // 1) Graphics 兜底：先画出圆形身体（素材加载成功后会被隐藏）
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
            const t = TYPES[this.type];
            ensureRenderTransform(body, t.r * 2 + 4, t.r * 2 + 4);
            g.fillColor = TYPE_COLORS[this.type % TYPE_COLORS.length];
            g.circle(0, 0, t.r);
            g.fill();
            g.fillColor = new Color(255, 255, 255, 255);
            g.circle(t.r * 0.28, t.r * 0.3, t.r * 0.22);
            g.fill();
            g.fillColor = new Color(20, 20, 20, 255);
            g.circle(t.r * 0.4, t.r * 0.32, t.r * 0.11);
            g.fill();
        }
        // 2) AI 素材：尝试加载，成功后隐藏上面的 Graphics 兜底
        const path = SPRITES.ENEMIES[this.type % SPRITES.ENEMIES.length];
        const t = TYPES[this.type];
        loadSpriteOnto(this.node, path, t.r * 2.6, t.r * 2.6);
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
            return; // 击退期间不追玩家
        }

        this._chasePlayer(dt);
    }

    private _chasePlayer(dt: number): void {
        if (!this.player || this.player.dead) return;
        const ppos = this.player.node.position;
        const pos = this.node.position;
        const a = Math.atan2(ppos.y - pos.y, ppos.x - pos.x);
        this.faceAngle = a;
        this.node.setRotationFromEuler(0, 0, -a * 180 / Math.PI);

        const nx = pos.x + Math.cos(a) * this.speed * dt;
        const ny = pos.y + Math.sin(a) * this.speed * dt;
        const wm = this.worldManager!;
        const resolved = wm.moveResolve(nx, ny, TYPES[this.type].r);
        this.node.setPosition(resolved[0], resolved[1], pos.z);

        // 接触伤害：撞到玩家立即扣血（damagePlayer 内部有 invincible 无敌帧节流，不会每帧重复扣血）
        const r = TYPES[this.type].r + PLAYER.RADIUS;
        const dx = resolved[0] - ppos.x, dy = resolved[1] - ppos.y;
        if (dx * dx + dy * dy < r * r) {
            this.player.damagePlayer(this.damage, resolved[0], resolved[1]);
        }
    }

    /** 受击（子弹命中） */
    hurtEnemy(damage: number, bx: number, by: number): void {
        if (!this._active) return;
        this.hp -= damage;
        this.hitFlash = 0.08;

        // 击退
        const pos = this.node.position;
        const a = Math.atan2(pos.y - by, pos.x - bx);
        this.knockX += Math.cos(a) * 90; // BULLET.KNOCKBACK
        this.knockY += Math.sin(a) * 90;

        if (this.hp <= 0) this._kill();
    }

    private _kill(): void {
        if (!this._active) return;
        this._active = false;
        this.node.active = false;
        // 销毁而非仅停用：避免死节点占内存导致内存泄漏闪退
        this.node.destroy();
        this.gameManager?.onEnemyKilled(this);
    }

    /** 回收 */
    recycle(): void {
        this._active = false;
        this.player = null;
    }
}
