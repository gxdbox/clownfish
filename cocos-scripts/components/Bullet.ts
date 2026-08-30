/**
 * Bullet.ts — 子弹行为（飞行 + 命中检测 + 穿透）
 * 挂在 Bullet 预制体上。
 * Cocos Creator 3.8.8 迁移版
 */
import { _decorator, Component, Node } from 'cc';
import { WORLD, BULLET, GameState } from '../config';
import type { PlayerController } from './PlayerController';
const { ccclass, property } = _decorator;

@ccclass('Bullet')
export class Bullet extends Component {

    /** 子弹所有者（玩家），用于区分敌我 */
    owner: PlayerController | null = null;

    private _vx = 0;
    private _vy = 0;
    private _damage = 0;
    private _range = 0;
    private _traveled = 0;
    private _hostile = false;
    private _pierce = 0;
    private _active = true;

    /** 初始化子弹参数 */
    init(angle: number, speed: number, damage: number, range: number, hostile: boolean, pierce: number): void {
        this._vx = Math.cos(angle) * speed;
        this._vy = Math.sin(angle) * speed;
        this._damage = damage;
        this._range = range;
        this._traveled = 0;
        this._hostile = hostile;
        this._pierce = pierce;
        this._active = true;
        this.node.setRotationFromEuler(0, 0, -angle * 180 / Math.PI);
    }

    update(dt: number): void {
        if (!this._active) return;
        // 暂停时冻结（引擎自动调用本方法，需自行判断状态）
        if (this.owner?.gameManager?.state !== GameState.PLAYING) return;

        const pos = this.node.position;
        const nx = pos.x + this._vx * dt;
        const ny = pos.y + this._vy * dt;
        this._traveled += Math.sqrt(this._vx * this._vx + this._vy * this._vy) * dt;

        // 生命周期终止
        if (this._traveled >= this._range ||
            nx < 0 || nx > WORLD.SIZE || ny < 0 || ny > WORLD.SIZE) {
            this._deactivate();
            return;
        }

        this.node.setPosition(nx, ny, pos.z);

        if (!this._hostile) {
            this._checkHitEnemy();
        } else {
            this._checkHitPlayer();
        }
    }

    /** 玩家子弹命中敌人 */
    private _checkHitEnemy(): void {
        // 简化版：遍历 EntityManager 子节点
        const parent = this.node.parent;
        if (!parent) return;
        const pos = this.node.position;
        const children = parent.children;

        for (const child of children) {
            if (!child.active) continue;
            const enemyAI = child.getComponent('EnemyAI') || child.getComponent('EliteAI');
            if (!enemyAI) continue;

            const cpos = child.position;
            const dx = cpos.x - pos.x;
            const dy = cpos.y - pos.y;
            const d2 = dx * dx + dy * dy;
            const enemyRadius = child.getComponent('EnemyAI') ? 13 : 22;
            const hitRadius = 5 + enemyRadius; // bullet radius + enemy radius

            if (d2 < hitRadius * hitRadius) {
                // 命中
                const enemyComp = child.getComponent('EnemyAI') || child.getComponent('EliteAI');
                if (enemyComp && 'hurtEnemy' in enemyComp) {
                    (enemyComp as any).hurtEnemy(this._damage, pos.x, pos.y);
                }

                if (this._pierce > 0) {
                    this._pierce--;
                } else {
                    this._deactivate();
                    return;
                }
            }
        }
    }

    /** 敌方子弹命中玩家 */
    private _checkHitPlayer(): void {
        // 由 GameManager 或 PlayerController 统一处理
        // 这里通过事件通知
        this.node.emit('bullet-hit-player', {
            damage: this._damage,
            x: this.node.position.x,
            y: this.node.position.y
        });
        this._deactivate();
    }

    private _deactivate(): void {
        this._active = false;
        this.node.active = false;
    }

    /** 回收子弹（由对象池调用） */
    recycle(): void {
        this._active = false;
        this.owner = null;
    }
}
