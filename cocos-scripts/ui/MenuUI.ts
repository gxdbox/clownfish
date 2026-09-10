/**
 * MenuUI.ts — 开始菜单
 * 挂在 MenuPanel 节点上。
 * UI 全部动态创建（不依赖场景节点，避免引用缺失导致空画面）。
 * Cocos Creator 3.8.8 迁移版
 */
import { _decorator, Component, Color, Label, Node } from 'cc';
import { createLabel, createPanel, createButton, createBar } from '../util';
import { WEAPON_LIST } from '../config';
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
            this._showWeaponSelect();
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

    // ===== 武器选择面板（开局选主武器） =====

    /** 显示武器选择面板：6 种武器按钮（图标+名+说明），选中后设置武器并开始游戏 */
    private _showWeaponSelect(): void {
        // 覆盖层（深色半透明，盖住菜单）
        const overlay = new Node('WeaponSelect');
        overlay.layer = 1 << 25; // UI_2D
        this.node.addChild(overlay);
        overlay.setPosition(0, 0, 0);
        // 背景面板（比菜单大一圈）
        createPanel(overlay, 0, 0, 700, 640, new Color(6, 20, 40, 240), 20);

        createLabel(overlay, '🔫 选择你的武器', 0, 270, 34, new Color(255, 218, 110, 255));
        createLabel(overlay, '每种武器手感完全不同，选你喜欢的风格', 0, 220, 18, new Color(160, 190, 215, 255));

        // 6 种武器：2 行 × 3 列
        WEAPON_LIST.forEach((w, i) => {
            const col = i % 3;
            const row = Math.floor(i / 3);
            const x = (col - 1) * 210;
            const y = 100 - row * 160;
            this._weaponButton(overlay, w, x, y);
        });

        // 取消按钮（回到菜单）
        createButton(overlay, '✖ 返回', 0, -285, () => {
            this.audioManager?.click();
            overlay.destroy();
        }, 160, 48);
    }

    /** 单个武器按钮：图标+名称+说明，点击 → setWeapon + startGame */
    private _weaponButton(parent: Node, w: { id: string; name: string; icon: string; desc: string }, x: number, y: number): void {
        // 按钮卡片（200×130）
        const card = createButton(parent, `${w.icon} ${w.name}`, x, y + 30, () => {
            this.audioManager?.click();
            // 设置玩家武器
            const p = this.gameManager?.playerController;
            if (p && 'setWeapon' in p) (p as any).setWeapon(w.id);
            // 关闭覆盖层并开始
            const overlay = this.node.getChildByName('WeaponSelect');
            if (overlay) overlay.destroy();
            this.gameManager?.startGame();
        }, 200, 70);
        card.node.setPosition(x, y + 30, 0);
        // 说明文字（卡片下方两行）
        createLabel(parent, w.desc, x, y - 35, 13, new Color(170, 200, 220, 255));
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
