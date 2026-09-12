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
import { _decorator, Component, Node, Graphics, Color } from 'cc';
import { WORLD, BULLET, BOSS, GameState, CHEST, PLAYER, BOOMERANG } from '../config';
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

    /** 追踪弹（仅敌弹）：每帧朝玩家有限转向；默认 false 不影响现有敌弹 */
    homing = false;
    /** 追踪转向速率(弧度/秒)，越小越容易被甩开 */
    homingTurnRate = 2.4;
    /** AOE 爆炸半径（0=无爆炸；榴弹命中后对半径内所有敌人造成伤害） */
    aoeRadius = 0;

    /** 视觉自转角速度(度/秒)：双叶轮廓的回旋镖转起来才有“回旋”记忆点；0=不转 */
    spin = 0;
    private _spinBase = 0;   // 朝向基准角（init 写入，自转在其上叠加）
    private _spinT = 0;
    private _faceDeg = 0;    // 当前飞行朝向（度）；自转叠加在其上

    /** 回旋镖弹道：飞出→折返→回主人，全程可命中（由 PlayerController 注入） */
    boomerang = false;
    private _returning = false;              // 已进入折返段
    private _spent = false;                  // 来回额度用尽：不再造成伤害，继续飞回
    private _lifeT = 0;                      // 存活时长（兜底销毁）
    private _retT = 0;                       // 折返段已飞时长（超时了结）
    private _hitIds = new Set<Node>();       // 本段已结算目标（防同一敌人逐帧连续受击）

    /** 统一写朝向：飞行方向 + 自转累计（否则追踪分支会覆盖掉自转） */
    private _syncRot(): void {
        this.node.setRotationFromEuler(0, 0, this._faceDeg + (this.spin !== 0 ? this.spin * this._spinT : 0));
    }

    /** 进入折返段：提速 + 重置穿透额度与命中记录，开启朝主人的有限转向追踪 */
    private _beginReturn(): void {
        this._returning = true;
        this._retT = 0;
        this._pierce = BOOMERANG.RETURN_PIERCE;
        this._hitIds.clear();
        this.homing = true;
        this.homingTurnRate = BOOMERANG.TURN_RATE;
        // 折返段提速：既造成“被拽回手”的手感，更保证玩家全速后撤时仍追得上（否则镖永远回不来）
        const sp = Math.sqrt(this._vx * this._vx + this._vy * this._vy) * BOOMERANG.RETURN_SPEED;
        const dir = Math.atan2(this._vy, this._vx);
        this._vx = Math.cos(dir) * sp;
        this._vy = Math.sin(dir) * sp;
    }

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
        this._returning = false;
        this._spent = false;
        this._lifeT = 0;
        this._retT = 0;
        this._hitIds.clear();
        this._spinT = 0;
        this._faceDeg = -angle * 180 / Math.PI;
        this._spinBase = this._faceDeg;
        this._syncRot();
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
        if (this.boomerang) {
            // 回旋镖不看射程耗尽：飞出到达即折返，由“被接住/兜底寿命/出界”结束
            this._lifeT += dt;
            if (this._returning) this._retT += dt;
            if (this._lifeT >= BOOMERANG.MAX_LIFE || this._retT >= BOOMERANG.RETURN_MAX ||
                nx < 0 || nx > WORLD.SIZE || ny < 0 || ny > WORLD.SIZE) {
                this._deactivate();
                return;
            }
            if (!this._returning && this._traveled >= this._range * BOOMERANG.OUT_RATIO) {
                this._beginReturn();
            }
        } else if (this._traveled >= this._range ||
            nx < 0 || nx > WORLD.SIZE || ny < 0 || ny > WORLD.SIZE) {
            this._deactivate();
            return;
        }

        this.node.setPosition(nx, ny, pos.z);

        // 视觉自转（仅玩家弹）：在朝向上叠加，不改变飞行向量
        if (this.spin !== 0 && !this._hostile) {
            this._spinT += dt;
            this._syncRot();
        }

        // 追踪：敌弹朝玩家；回旋镖折返段朝主人（有限转向 → 绕出自然弧线）
        const chase = this._hostile ? this.targetPlayer
            : (this.boomerang && this._returning ? this.owner : null);
        if (this.homing && chase && chase.node && !chase.dead && this.homingTurnRate > 0) {
            const ppos = chase.node.position;
            const cur = Math.atan2(this._vy, this._vx);
            const want = Math.atan2(ppos.y - ny, ppos.x - nx);
            let diff = want - cur;
            while (diff > Math.PI) diff -= Math.PI * 2;
            while (diff < -Math.PI) diff += Math.PI * 2;
            const maxTurn = this.homingTurnRate * dt;
            const turn = diff > maxTurn ? maxTurn : (diff < -maxTurn ? -maxTurn : diff);
            const spd = Math.sqrt(this._vx * this._vx + this._vy * this._vy);
            const na = cur + turn;
            this._vx = Math.cos(na) * spd;
            this._vy = Math.sin(na) * spd;
            this._faceDeg = -na * 180 / Math.PI;
            this._syncRot();
        }

        // 折返段：飞回主人即被接住
        if (this._returning && this.owner && this.owner.node) {
            const op = this.owner.node.position;
            const dx = op.x - nx, dy = op.y - ny;
            const catchR = PLAYER.RADIUS + BOOMERANG.CATCH_EXTRA;
            if (dx * dx + dy * dy < catchR * catchR) {
                this._deactivate();
                return;
            }
        }

        if (!this._hostile) {
            this._checkHitEnemy();
        } else {
            this._checkHitPlayer();
        }
    }

    /** 玩家子弹命中敌人 */
    private _checkHitEnemy(): void {
        // 回旋镖空手折返：不再结算任何伤害
        if (this._spent) return;
        // 简化版：遍历 EntityManager 子节点
        const parent = this.node.parent;
        if (!parent) return;
        const pos = this.node.position;
        const children = parent.children;

        for (const child of children) {
            if (!child.isValid || !child.active) continue;
            // 回旋镖：同一目标每段只结算一次（弹体在命中区内会停留多帧）
            // 注：仅限回旋镖——穿透弹/激光的贴脸多段命中属现有平衡，不动
            if (this.boomerang && this._hitIds.has(child)) continue;
            // 宝箱：玩家子弹打宝箱（扣血不穿透）
            const chestComp = child.getComponent('Chest');
            if (chestComp) {
                const cpos = child.position;
                const dx = cpos.x - pos.x;
                const dy = cpos.y - pos.y;
                const d2 = dx * dx + dy * dy;
                const hitRadius = 5 + CHEST.RADIUS;
                if (d2 < hitRadius * hitRadius) {
                    (chestComp as any).hurtChest();
                    if (this.boomerang) {
                        // 回旋镖开宝箱不消失：折返飞回，但本次投掷不再二次生效
                        if (!this._returning) this._beginReturn();
                        this._spent = true;
                    } else {
                        this._deactivate();
                        return;
                    }
                }
                continue;
            }
            // BOSS 也必须可命中（此前漏检 BossAI 导致子弹穿过巨蟹等 Boss 无伤害）
            const enemyComp = child.getComponent('EnemyAI') || child.getComponent('EliteAI') || child.getComponent('BossAI');
            if (!enemyComp) continue;

            const cpos = child.position;
            const dx = cpos.x - pos.x;
            const dy = cpos.y - pos.y;
            const d2 = dx * dx + dy * dy;
            const enemyRadius = child.getComponent('EnemyAI') ? 13 : (child.getComponent('BossAI') ? BOSS.RADIUS : 22);
            const hitRadius = 5 + enemyRadius; // bullet radius + enemy radius

            if (d2 < hitRadius * hitRadius) {
                // 命中
                let killed = false;
                if ('hurtEnemy' in enemyComp) {
                    // 榴弹 AOE：命中点爆炸，对半径内所有敌人造成伤害（本次直接结算所有受波及者）
                    if (this.aoeRadius > 0) {
                        this._applyAoeDamage(pos.x, pos.y);
                        killed = true; // AOE 已在 _applyAoeDamage 处理；本发子弹消失
                    } else {
                        (enemyComp as any).hurtEnemy(this._damage, pos.x, pos.y);
                        killed = (enemyComp as any).hp <= 0;
                    }
                }
                // 命中/击杀音效（穿透多段命中时由 AudioManager 节流）
                if (this.owner) {
                    if (killed) this.owner.audioManager?.kill();
                    else this.owner.audioManager?.hit();
                }

                if (this.boomerang) this._hitIds.add(child);
                if (this._pierce > 0) {
                    this._pierce--;
                } else if (this.boomerang) {
                    // 额度耗尽：飞出段就地折返；折返段则空手飞回主人
                    if (!this._returning) this._beginReturn();
                    else this._spent = true;
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

    /** 榴弹 AOE：对爆炸半径内所有敌人造成伤害（含 BOSS/精英），并触发爆炸视觉 */
    private _applyAoeDamage(bx: number, by: number): void {
        const parent = this.node.parent;
        if (!parent) return;
        const r2 = this.aoeRadius * this.aoeRadius;
        for (const child of parent.children) {
            if (!child.isValid || !child.active) continue;
            const enemyComp = child.getComponent('EnemyAI') || child.getComponent('EliteAI') || child.getComponent('BossAI');
            if (!enemyComp) continue;
            const cpos = child.position;
            const dx = cpos.x - bx, dy = cpos.y - by;
            if (dx * dx + dy * dy < r2) {
                (enemyComp as any).hurtEnemy(this._damage, bx, by);
            }
        }
        // 爆炸视觉：小圆环扩散（轻量 Graphics，挂父节点）
        try {
            const boom = new Node('GrenadeBoom');
            boom.setPosition(bx, by, 0);
            parent.addChild(boom);
            const g = boom.addComponent(Graphics);
            g.lineWidth = 4;
            g.strokeColor = new Color(255, 200, 90, 220);
            g.circle(0, 0, this.aoeRadius * 0.5);
            g.stroke();
            boom.destroy();  // 一帧即消失（简化视觉）
        } catch { /* 视觉失败忽略 */ }
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
