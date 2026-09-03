/**
 * GameOverUI.ts — 结算界面（失败 + 通关两种）
 * 挂在 GameOverPanel 节点上。
 * 显示存活时间/击杀数/波次/等级 + "再来一局"按钮。
 * UI 全部动态创建（不依赖场景节点，避免引用缺失导致空画面）。
 * Cocos Creator 3.8.8 迁移版
 */
import { _decorator, Component, Color, Label, Node } from 'cc';
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
        // 动态创建结算界面
        createPanel(this.node, 0, 0, 540, 520, new Color(8, 18, 38, 240), 20);

        this.titleLabel = createLabel(this.node, '💀 游戏结束', 0, 200, 50, new Color(255, 120, 120, 255));
        this.subLabel = createLabel(this.node, '再来一次吧', 0, 150, 20, new Color(150, 190, 220, 255));
        this.timeLabel = createLabel(this.node, '存活 00:00', 0, 95, 28);
        this.killsLabel = createLabel(this.node, '击杀 0', 0, 45, 28);
        this.waveLabel = createLabel(this.node, '到达第 1 波', 0, -5, 28);
        this.levelLabel = createLabel(this.node, '等级 Lv.1', 0, -55, 28);

        const retry = createButton(this.node, '🔄 再来一局', 0, -155, () => {
            this.gameManager?.audioManager?.click();
            this.gameManager?.startGame();
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
