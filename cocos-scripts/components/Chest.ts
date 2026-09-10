/**
 * Chest.ts — 宝箱（子弹打宝箱：打 3 下爆开，随机掉宝贝）
 * 视觉：金色宝箱（Graphics 画，带呼吸光效吸引注意），受击闪白反馈。
 * 子弹命中 → hurtChest() 扣血 → 血空 → onBreak 回调（掉落由 SpawnManager/GameManager 处理）。
 * Cocos Creator 3.8.8 迁移版
 */
import { _decorator, Component, Node, Graphics, Color } from 'cc';
import { CHEST } from '../config';
import { ensureRenderTransform } from '../util';
import type { WorldManager } from '../managers/WorldManager';
import type { SpawnManager } from '../managers/SpawnManager';
import type { GameManager } from '../managers/GameManager';
const { ccclass, property } = _decorator;

@ccclass('Chest')
export class Chest extends Component {

    worldManager: WorldManager | null = null;
    spawnManager: SpawnManager | null = null;
    gameManager: GameManager | null = null;

    hp = CHEST.HP;
    private _active = true;
    private _hitFlash = 0;
    private _gfx: Graphics | null = null;

    /** 初始化宝箱 */
    init(x: number, y: number): void {
        this._active = true;
        this.hp = CHEST.HP;
        this._hitFlash = 0;
        this.node.setPosition(x, y, 0);
        this.node.active = true;
        this._ensureVisual();
    }

    /** 宝箱视觉：金色箱体 + 呼吸光效（脉动光晕） */
    private _ensureVisual(): void {
        ensureRenderTransform(this.node, CHEST.SIZE, CHEST.SIZE);
        this._gfx = this.node.getComponent(Graphics) ?? this.node.addComponent(Graphics);
        this._draw();
    }

    private _draw(): void {
        const g = this._gfx;
        if (!g) return;
        const r = CHEST.RADIUS;
        g.clear();
        // 受击闪白：整体变亮
        const flash = this._hitFlash > 0;
        // 呼吸光晕（金色脉动）
        const pulse = 0.75 + 0.25 * Math.sin(Date.now() / 400);
        g.fillColor = new Color(255, 200, 60, Math.floor(50 * pulse));
        g.circle(0, 0, r + 8);
        g.fill();
        // 箱体（金色圆角方块：底座 + 顶盖 + 锁扣）
        const base = flash ? new Color(255, 255, 220, 255) : new Color(230, 170, 40, 255);
        const lid = flash ? new Color(255, 255, 240, 255) : new Color(255, 210, 80, 255);
        g.fillColor = base;
        g.roundRect(-r * 0.8, -r * 0.6, r * 1.6, r * 1.2, 6);
        g.fill();
        // 顶盖（半圆隆起）
        g.fillColor = lid;
        g.roundRect(-r * 0.85, r * 0.25, r * 1.7, r * 0.5, 6);
        g.fill();
        // 锁扣
        g.fillColor = new Color(255, 240, 150, 255);
        g.roundRect(-r * 0.18, -r * 0.25, r * 0.36, r * 0.5, 3);
        g.fill();
        g.fillColor = new Color(160, 100, 20, 255);
        g.circle(0, 0, r * 0.12);
        g.fill();
    }

    update(dt: number): void {
        if (!this._active) return;
        if (this._hitFlash > 0) this._hitFlash -= dt;
        // 每帧刷新呼吸光效（轻量，仅视觉）
        this._draw();
    }

    /** 子弹命中（玩家子弹调用）：扣 1 血 + 闪白 + 音效；血空爆开 */
    hurtChest(): void {
        if (!this._active) return;
        this.hp--;
        this._hitFlash = CHEST.HIT_FLASH;
        this.gameManager?.audioManager?.hit();
        if (this.hp <= 0) {
            this._break();
        }
    }

    /** 爆开：相机震动 + 掉落（回调给 GameManager 处理） + 销毁 */
    private _break(): void {
        if (!this._active) return;
        this._active = false;
        this.gameManager?.cameraFollow?.addShake(CHEST.BREAK_SHAKE);
        this.gameManager?.audioManager?.explosion();
        const pos = this.node.position;
        this.gameManager?.onChestBreak(pos.x, pos.y);
        this.node.destroy();
    }

    recycle(): void {
        this._active = false;
    }
}
