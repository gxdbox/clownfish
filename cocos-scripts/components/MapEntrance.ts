/**
 * MapEntrance.ts — 地图入口（每张图一个主题入口，轻剧情/商店/隐藏Boss 三合一）
 * 珊瑚礁=海葵洞(剧情房) / 深海=沉船残骸(商人房) / 火山=熔岩裂隙(隐藏Boss房)
 * 视觉：主题色发光旋转圆 + 名字标签；玩家接触触发 GameManager.openEntrance(type)。
 * Cocos Creator 3.8.8 迁移版
 */
import { _decorator, Component, Node, Graphics, Color, Label } from 'cc';
import { ENTRANCE, GameState } from '../config';
import { ensureRenderTransform, dist2 } from '../util';
import type { GameManager } from '../managers/GameManager';
import type { PlayerController } from './PlayerController';
const { ccclass, property } = _decorator;

@ccclass('MapEntrance')
export class MapEntrance extends Component {

    gameManager: GameManager | null = null;
    player: PlayerController | null = null;
    mapIndex = 0;

    private _active = true;
    private _used = false;         // 已触发（避免重复进入）

    /** 初始化入口（mapIndex 决定主题/位置/类型） */
    init(x: number, y: number, mapIndex: number): void {
        this._active = true;
        this._used = false;
        this.mapIndex = mapIndex % ENTRANCE.POS.length;
        this.node.setPosition(x, y, 0);
        this.node.active = true;
        this._ensureVisual();
    }

    /** 主题视觉：发光旋转圆 + 名字标签（颜色/名字随地图主题） */
    private _ensureVisual(): void {
        const theme = ENTRANCE.THEME[this.mapIndex % ENTRANCE.THEME.length];
        const c = theme.color;
        const size = ENTRANCE.SIZE;
        ensureRenderTransform(this.node, size, size);

        // 入口圆环（主题色三层发光：外亮环 + 中环 + 内核）
        const g = this.node.getComponent(Graphics) ?? this.node.addComponent(Graphics);
        g.clear();
        g.fillColor = new Color(c[0], c[1], c[2], 60);
        g.circle(0, 0, ENTRANCE.RADIUS + 10);
        g.fill();
        g.fillColor = new Color(c[0], c[1], c[2], 150);
        g.circle(0, 0, ENTRANCE.RADIUS);
        g.fill();
        g.fillColor = new Color(255, 255, 255, 230);
        g.circle(0, 0, ENTRANCE.RADIUS * 0.45);
        g.fill();
        g.fillColor = new Color(c[0], c[1], c[2], 255);
        g.circle(0, 0, ENTRANCE.RADIUS * 0.25);
        g.fill();

        // 名字标签（挂在子节点，避免影响入口旋转）
        let lblNode = this.node.getChildByName('NameLbl');
        if (!lblNode) {
            lblNode = new Node('NameLbl');
            lblNode.setPosition(0, -ENTRANCE.RADIUS - 16, 0);
            this.node.addChild(lblNode);
        }
        const label = lblNode.getComponent(Label) ?? lblNode.addComponent(Label);
        label.string = `${theme.icon} ${theme.name}`;
        label.fontSize = 20;
        label.lineHeight = 24;
        label.color = new Color(255, 255, 255, 255);
    }

    update(dt: number): void {
        if (!this._active || this._used) return;
        if (this.gameManager?.state !== GameState.PLAYING) return;
        if (!this.player || this.player.dead) return;

        // 缓慢旋转（视觉）
        const e = this.node.eulerAngles;
        this.node.setRotationFromEuler(0, 0, (e.z + 30 * dt) % 360);

        // 玩家进入触发半径 → 打开对应房间（按地图主题）
        const ppos = this.player.node.position;
        const pos = this.node.position;
        if (dist2(pos.x, pos.y, ppos.x, ppos.y) < ENTRANCE.RADIUS * ENTRANCE.RADIUS) {
            this._used = true;
            const theme = ENTRANCE.THEME[this.mapIndex % ENTRANCE.THEME.length];
            console.log(`[Clownfish] 进入入口: ${theme.name} (type=${theme.type})`);
            this.gameManager?.openEntrance(theme.type);
        }
    }

    recycle(): void {
        this._active = false;
        this._used = true;
    }
}
