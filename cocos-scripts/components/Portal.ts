/**
 * Portal.ts — 传送门（击败 Boss 后生成，玩家接触后传送到下一张地图）
 * 视觉：AI 精灵素材（SPRITES.PORTAL），加载失败回退 Graphics 漩涡圆。
 * 持续缓慢旋转，玩家进入半径内触发 GameManager.advanceMap()。
 * Cocos Creator 3.8.8 迁移版
 */
import { _decorator, Component, Node, Graphics, Color, Sprite } from 'cc';
import { SPRITES, WORLD, GameState } from '../config';
import { ensureRenderTransform, loadSpriteOnto, dist2 } from '../util';
import type { GameManager } from '../managers/GameManager';
import type { PlayerController } from './PlayerController';
const { ccclass, property } = _decorator;

const PORTAL_RADIUS = 34;   // 触发半径（玩家进入即触发）
const PORTAL_SIZE = 92;     // 视觉尺寸

@ccclass('Portal')
export class Portal extends Component {

    gameManager: GameManager | null = null;
    player: PlayerController | null = null;

    private _active = true;
    private _spriteNode: Node | null = null;

    init(x: number, y: number): void {
        this._active = true;
        this.node.setPosition(x, y, 0);
        this.node.active = true;
        this._ensureVisual();
    }

    private _ensureVisual(): void {
        // Graphics 兜底：蓝色漩涡圆（素材加载成功后隐藏）
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
            ensureRenderTransform(body, PORTAL_SIZE, PORTAL_SIZE);
            g.fillColor = new Color(70, 160, 240, 200);
            g.circle(0, 0, PORTAL_RADIUS);
            g.fill();
            g.fillColor = new Color(150, 220, 255, 220);
            g.circle(0, 0, PORTAL_RADIUS * 0.55);
            g.fill();
            g.fillColor = new Color(20, 60, 120, 230);
            g.circle(0, 0, PORTAL_RADIUS * 0.3);
            g.fill();
        }
        loadSpriteOnto(this.node, SPRITES.PORTAL, PORTAL_SIZE, PORTAL_SIZE);
        this._spriteNode = this.node.getChildByName('Sprite');
    }

    update(dt: number): void {
        if (!this._active) return;
        if (this.gameManager?.state !== GameState.PLAYING) return;
        if (!this.player || this.player.dead) return;

        // 缓慢旋转（视觉）
        const e = this.node.eulerAngles;
        this.node.setRotationFromEuler(0, 0, (e.z + 40 * dt) % 360);

        // 玩家进入触发半径 → 推进到下一张地图
        const ppos = this.player.node.position;
        const pos = this.node.position;
        if (dist2(pos.x, pos.y, ppos.x, ppos.y) < PORTAL_RADIUS * PORTAL_RADIUS) {
            this._active = false;
            this.gameManager?.advanceMap();
        }
    }

    recycle(): void {
        this._active = false;
    }
}
