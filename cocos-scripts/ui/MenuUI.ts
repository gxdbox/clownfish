/**
 * MenuUI.ts — 开始菜单
 * 挂在 MenuPanel 节点上。
 * UI 全部动态创建（不依赖场景节点，避免引用缺失导致空画面）。
 * Cocos Creator 3.8.8 迁移版
 */
import { _decorator, Component, Color, Label, Node } from 'cc';
import { createLabel, createPanel, createButton } from '../util';
import type { GameManager } from '../managers/GameManager';
import type { AudioManager } from '../managers/AudioManager';
const { ccclass } = _decorator;

@ccclass('MenuUI')
export class MenuUI extends Component {

    titleLabel: Label | null = null;
    startButton: Node | null = null;
    muteButton: Node | null = null;
    muteLabel: Label | null = null;

    gameManager: GameManager | null = null;
    audioManager: AudioManager | null = null;

    onLoad(): void {
        // 动态创建菜单 UI
        createPanel(this.node, 0, 0, 540, 470, new Color(6, 28, 50, 235), 24);

        this.titleLabel = createLabel(this.node, '🐟 小丑鱼大冒险', 0, 140, 52, new Color(255, 218, 110, 255));
        createLabel(this.node, '深海生存 · 升级进化', 0, 76, 22, new Color(170, 205, 230, 255));

        const start = createButton(this.node, '▶ 点击开始', 0, -20, () => {
            this.audioManager?.unlock();
            this.gameManager?.startGame();
        }, 300, 68);
        this.startButton = start.node;

        const mute = createButton(this.node, '🔊 音效开', 0, -112, () => {
            this.audioManager?.toggleMute();
            this._updateMuteLabel();
        }, 220, 54);
        this.muteButton = mute.node;
        this.muteLabel = mute.label;

        createLabel(this.node, 'WASD 移动 · 空格射击 · 触屏双摇杆', 0, -176, 18, new Color(140, 170, 190, 255));

        this._updateMuteLabel();
    }

    /** 设置引用（由 GameManager 调用） */
    setup(gm: GameManager, am: AudioManager): void {
        this.gameManager = gm;
        this.audioManager = am;
    }

    private _updateMuteLabel(): void {
        if (this.muteLabel) {
            this.muteLabel.string = this.audioManager?.muted ? '🔇 音效关' : '🔊 音效开';
        }
    }
}
