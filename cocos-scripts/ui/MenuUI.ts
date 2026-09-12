/**
 * MenuUI.ts — 开始菜单
 * 挂在 MenuPanel 节点上。
 * UI 全部动态创建（不依赖场景节点，避免引用缺失导致空画面）。
 * Cocos Creator 3.8.8 迁移版
 */
import { _decorator, Component, Color, Label, Node, UITransform, Widget, view } from 'cc';
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
        // 强制面板几何：锚点居中 + 归位，避免场景配置漂移导致 UI 偏移裁切
        const w = this.node.getComponent(Widget);
        if (w) w.enabled = false;
        const uit = this.node.getComponent(UITransform) || this.node.addComponent(UITransform);
        uit.setAnchorPoint(0.5, 0.5);
        this.node.setPosition(0, 0, 0);

        // 内容容器：矮屏（手机横屏可见高约 460）时整体缩放兜底，防止底部元素被裁切
        const content = new Node('Content');
        content.layer = this.node.layer;
        this.node.addChild(content);
        content.setPosition(0, 0, 0);
        const vs = view.getVisibleSize();
        const s = Math.min(1, vs.height / 500);
        content.setScale(s, s, 1);

        // 动态创建菜单 UI
        createPanel(content, 0, 0, 540, 470, new Color(6, 28, 50, 235), 24);

        this.titleLabel = createLabel(content, '🐟 小丑鱼大冒险', 0, 140, 52, new Color(255, 218, 110, 255));
        createLabel(content, '深海生存 · 升级进化', 0, 76, 22, new Color(170, 205, 230, 255));

        const start = createButton(content, '▶ 点击开始', 0, -20, () => {
            this.audioManager?.unlock();
            this.audioManager?.click();
            this.showWeaponSelect();
        }, 300, 68);
        this.startButton = start.node;

        const mute = createButton(content, '🔊 音效开', 0, -112, () => {
            this.audioManager?.click();
            this.audioManager?.toggleMute();
            this._updateMuteLabel();
        }, 220, 54);
        this.muteButton = mute.node;
        this.muteLabel = mute.label;

        createLabel(content, 'WASD 移动 · 空格射击 · 触屏双摇杆', 0, -176, 18, new Color(140, 170, 190, 255));

        this._updateMuteLabel();
    }

    // ===== 武器选择面板（开局选主武器） =====

    /** 显示武器选择面板：6 种武器按钮（图标+名+说明），选中后设置武器并开始游戏。
     *  公开方法：主菜单"开始"和 GameOver"再来一局"都走这里，保证每次游戏前都能重选武器 */
    showWeaponSelect(): void {
        // 覆盖层（深色半透明，盖住菜单）
        const overlay = new Node('WeaponSelect');
        overlay.layer = 1 << 25; // UI_2D
        this.node.addChild(overlay);
        overlay.setPosition(0, 0, 0);

        // 内容容器：布局已压缩至 ±218（460 可见高内完整显示），更矮的设备整体缩放兜底
        const content = new Node('Content');
        content.layer = overlay.layer;
        overlay.addChild(content);
        content.setPosition(0, 0, 0);
        const vs = view.getVisibleSize();
        const s = Math.min(1, vs.height / 450);
        content.setScale(s, s, 1);

        // 背景面板（紧凑布局：内容垂直范围 ±218）
        createPanel(content, 0, 0, 700, 460, new Color(6, 20, 40, 240), 20);

        createLabel(content, '🔫 选择你的武器', 0, 195, 34, new Color(255, 218, 110, 255));
        createLabel(content, '每种武器手感完全不同，选你喜欢的风格', 0, 158, 18, new Color(160, 190, 215, 255));

        // 6 种武器：2 行 × 3 列（行距 130，原 160 会撞出矮屏可视区）
        WEAPON_LIST.forEach((w, i) => {
            const col = i % 3;
            const row = Math.floor(i / 3);
            const x = (col - 1) * 210;
            const y = 50 - row * 130;
            this._weaponButton(content, w, x, y);
        });

        // 取消按钮（回到菜单）
        createButton(content, '✖ 返回', 0, -185, () => {
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
