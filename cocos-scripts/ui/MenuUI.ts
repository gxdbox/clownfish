/**
 * MenuUI.ts — 开始菜单
 * 挂在 MenuPanel 节点上。
 * UI 全部动态创建（不依赖场景节点，避免引用缺失导致空画面）。
 * Cocos Creator 3.8.8 迁移版
 */
import { _decorator, Component, Color, Label, Node } from 'cc';
import { createLabel, createPanel, createButton, createBar } from '../util';
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
            this.audioManager?.click();
            this.gameManager?.startGame();
        }, 300, 68);
        this.startButton = start.node;

        const mute = createButton(this.node, '🔊 音效开', 0, -112, () => {
            this.audioManager?.click();
            this.audioManager?.toggleMute();
            this._updateMuteLabel();
        }, 220, 54);
        this.muteButton = mute.node;
        this.muteLabel = mute.label;

        // ===== 音量调节（BGM / SFX 独立，−/+ 按钮 + 进度条；触屏友好） =====
        this._buildVolumeUI();

        createLabel(this.node, 'WASD 移动 · 空格射击 · 触屏双摇杆', 0, -232, 18, new Color(140, 170, 190, 255));

        this._updateMuteLabel();
    }

    // ===== 音量调节 UI =====
    private _bgmBar: { set: (p: number) => void } | null = null;
    private _sfxBar: { set: (p: number) => void } | null = null;

    private _buildVolumeUI(): void {
        // BGM 行：标题 + 进度条 + − / +
        createLabel(this.node, '🎵 音乐', -230, -158, 20, new Color(200, 220, 240, 255));
        this._bgmBar = createBar(this.node, -60, -158, 160, 18, new Color(110, 210, 255, 255));
        createButton(this.node, '−', -185, -158, () => {
            this.audioManager?.click();
            this.audioManager?.setBgmVolume((this.audioManager?.bgmVolume ?? 1) - 0.1);
            this._refreshBars();
        }, 56, 40);
        createButton(this.node, '+', 75, -158, () => {
            this.audioManager?.click();
            this.audioManager?.setBgmVolume((this.audioManager?.bgmVolume ?? 1) + 0.1);
            this._refreshBars();
        }, 56, 40);

        // SFX 行
        createLabel(this.node, '🎯 音效', -230, -206, 20, new Color(200, 220, 240, 255));
        this._sfxBar = createBar(this.node, -60, -206, 160, 18, new Color(255, 180, 90, 255));
        createButton(this.node, '−', -185, -206, () => {
            this.audioManager?.click();
            this.audioManager?.setSfxVolume((this.audioManager?.sfxVolume ?? 1) - 0.1);
            this._refreshBars();
        }, 56, 40);
        createButton(this.node, '+', 75, -206, () => {
            this.audioManager?.click();
            this.audioManager?.setSfxVolume((this.audioManager?.sfxVolume ?? 1) + 0.1);
            this._refreshBars();
        }, 56, 40);

        this._refreshBars();
    }

    private _refreshBars(): void {
        const am = this.audioManager;
        if (!am) return;
        this._bgmBar?.set(am.bgmVolume);
        this._sfxBar?.set(am.sfxVolume);
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
