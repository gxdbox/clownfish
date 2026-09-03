/**
 * Bullet.ts — 子弹行为（飞行 + 命中检测 + 穿透）
 * 挂在 Bullet 预制体上。
 * Cocos Creator 3.8.8 迁移版
 *
 * 修复：敌弹（hostile，由精英爆发生成）owner 为 null，
 * 原版用可选链 owner?.gameManager?.state 判断状态，
 * 可选链结果恒不等于 PLAYING → 敌弹永不移动。
 * 现改为显式注入 gameManager/targetPlayer/worldManager 引用。
 */
import { _decorator, Component, Node } from 'cc';
import { WORLD, BULLET, GameState } from '../config';
import type { PlayerController } from './PlayerController';
import type { WorldManager } from '../managers/WorldManager';
import type { GameManager } from '../managers/GameManager';
const { ccclass, property } = _decorator;

@ccclass('Bullet')
export class Bullet extends Component {

    /** 子弹所有者（玩家），用于区分敌我 */
    owner: PlayerController | null = null;
    /** 状态机引用（敌弹由 EliteAI 注入；玩家子弹经 owner 链获取） */
    gameManager: GameManager | null = null;
    /** 敌方子弹目标（由 EliteAI 注入） */
    targetPlayer: PlayerController | null = null;
    /** 世界管理器（敌弹撞墙检测，由 EliteAI 注入） */
    worldManager: WorldManager | null = null;

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
        // 暂停时冻结：敌弹 owner 为 null，不能走 owner?.gameManager 链（可选链判空 bug 修复）
        if (this._hostile) {
            if (!this.gameManager || this.gameManager.state !== GameState.PLAYING) return;
        } else if (this.owner?.gameManager?.state !== GameState.PLAYING) {
            return;
        }

        const pos = this.node.position;
        const nx = pos.x + this._vx * dt;
        const ny = pos.y + this._vy * dt;
        this._traveled += Math.sqrt(this._vx * this._vx + this._vy * this._vy) * dt;

        // 敌弹撞墙立即消失（玩家子弹保持穿墙，与原始版本一致）
        if (this._hostile && this.worldManager && this.worldManager.collideWalls(nx, ny, BULLET.RADIUS, false)) {
            this._deactivate();
            return;
        }

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
                let killed = false;
                if (enemyComp && 'hurtEnemy' in enemyComp) {
                    (enemyComp as any).hurtEnemy(this._damage, pos.x, pos.y);
                    killed = (enemyComp as any).hp <= 0;
                }
                // 命中/击杀音效（穿透多段命中时由 AudioManager 节流）
                if (this.owner) {
                    if (killed) this.owner.audioManager?.kill();
                    else this.owner.audioManager?.hit();
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

    /** 敌方子弹命中玩家（直接伤害，原版仅 emit 无人监听的事件，修复为真实伤害） */
    private _checkHitPlayer(): void {
        const player = this.targetPlayer;
        const pos = this.node.position;
        if (player && !player.dead && player.gameManager?.state === GameState.PLAYING) {
            player.damagePlayer(this._damage, pos.x, pos.y);
        }
        this._deactivate();
    }

    private _deactivate(): void {
        this._active = false;
        this.node.active = false;
        // 销毁而非仅停用：否则节点+组件+Graphics 命令缓冲+精灵引用永久驻留 → 内存泄漏闪退
        this.node.destroy();
    }

    /** 回收子弹（由对象池调用） */
    recycle(): void {
        this._active = false;
        this.owner = null;
    }
}
