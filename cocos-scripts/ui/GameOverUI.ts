/**
 * GameOverUI.ts — 结算界面（失败 + 通关两种）
 * 挂在 GameOverPanel 节点上。
 * 显示存活时间/击杀数/波次/等级 + "再来一局"按钮。
 * UI 全部动态创建（不依赖场景节点，避免引用缺失导致空画面）。
 * Cocos Creator 3.8.8 迁移版
 */
import { _decorator, Component, Color, Label, Node, UITransform, Widget, view } from 'cc';
import { createLabel, createPanel, createButton } from '../util';
import { formatTime } from '../util';
import type { GameManager } from '../managers/GameManager';
const { ccclass } = _decorator;

interface GameOverStats {
    time: number;
    kills: number;
    wave: number;
    level: number;
    victory?: boolean;
}

@ccclass('GameOverUI')
export class GameOverUI extends Component {

    titleLabel: Label | null = null;
    subLabel: Label | null = null;
    timeLabel: Label | null = null;
    killsLabel: Label | null = null;
    waveLabel: Label | null = null;
    levelLabel: Label | null = null;
    retryButton: Node | null = null;

    gameManager: GameManager | null = null;

    onLoad(): void {
        // 强制面板几何：锚点居中 + 归位，避免场景配置漂移导致 UI 偏移裁切
        const w = this.node.getComponent(Widget);
        if (w) w.enabled = false;
        const uit = this.node.getComponent(UITransform) || this.node.addComponent(UITransform);
        uit.setAnchorPoint(0.5, 0.5);
        this.node.setPosition(0, 0, 0);

        // 内容容器：矮屏（手机横屏可见高约 460）时整体缩放兜底，防止底部按钮被裁切
        const content = new Node('Content');
        content.layer = this.node.layer;
        this.node.addChild(content);
        content.setPosition(0, 0, 0);
        const vs = view.getVisibleSize();
        const s = Math.min(1, vs.height / 540);
        content.setScale(s, s, 1);

        // 动态创建结算界面
        createPanel(content, 0, 0, 540, 520, new Color(8, 18, 38, 240), 20);

        this.titleLabel = createLabel(content, '💀 游戏结束', 0, 200, 50, new Color(255, 120, 120, 255));
        this.subLabel = createLabel(content, '再来一次吧', 0, 150, 20, new Color(150, 190, 220, 255));
        this.timeLabel = createLabel(content, '存活 00:00', 0, 95, 28);
        this.killsLabel = createLabel(content, '击杀 0', 0, 45, 28);
        this.waveLabel = createLabel(content, '到达第 1 波', 0, -5, 28);
        this.levelLabel = createLabel(content, '等级 Lv.1', 0, -55, 28);

        const retry = createButton(content, '🔄 再来一局', 0, -155, () => {
            this.gameManager?.audioManager?.click();
            // 重玩时重新选武器（先弹武器选择，再开始新一局）
            this.gameManager?.restartWithWeaponSelect();
        }, 300, 66);
        this.retryButton = retry.node;
    }

    /** 设置引用（由 GameManager 调用） */
    setup(gm: GameManager): void {
        this.gameManager = gm;
        gm.node.on('show-gameover', this._onShow, this);
    }

    private _onShow(stats: GameOverStats): void {
        if (stats.victory) {
            if (this.titleLabel) { this.titleLabel.string = '🏆 通关！'; this.titleLabel.color = new Color(255, 220, 120, 255); }
            if (this.subLabel) this.subLabel.string = '你征服了三个世界，海洋因你而安宁！';
        } else {
            if (this.titleLabel) { this.titleLabel.string = '💀 游戏结束'; this.titleLabel.color = new Color(255, 120, 120, 255); }
            if (this.subLabel) this.subLabel.string = '再来一次吧';
        }
        if (this.timeLabel) this.timeLabel.string = `存活 ${formatTime(stats.time)}`;
        if (this.killsLabel) this.killsLabel.string = `击杀 ${stats.kills}`;
        if (this.waveLabel) this.waveLabel.string = `到达第 ${stats.wave} 波`;
        if (this.levelLabel) this.levelLabel.string = `等级 Lv.${stats.level}`;
    }
}
