/**
 * HUD.ts — 游戏内 HUD（生命/等级/波次/计时/经验条/护盾/加速/地图名/BOSS 血条）
 * 挂在 HUD 节点上。
 * UI 全部动态创建（不依赖场景节点，避免引用缺失导致空画面）。
 * Cocos Creator 3.8.8 迁移版
 */
import { _decorator, Component, Color, Label, Node } from 'cc';
import { createLabel, createBar } from '../util';
import { formatTime } from '../util';
import { PICKUP, MAPS } from '../config';
import type { GameManager } from '../managers/GameManager';
import type { PlayerController } from '../components/PlayerController';
import type { SpawnManager } from '../managers/SpawnManager';
const { ccclass } = _decorator;

/** 简易进度条接口（由 createBar 返回） */
interface Bar { set(p: number): void }

@ccclass('HUD')
export class HUD extends Component {

    hpLabel: Label | null = null;
    hpBar: Bar | null = null;
    levelLabel: Label | null = null;
    waveLabel: Label | null = null;
    timeLabel: Label | null = null;
    expBar: Bar | null = null;
    boostLabel: Label | null = null;
    shieldLabel: Label | null = null; // 护盾数量文字（替代蓝点子节点）
    mapLabel: Label | null = null;    // 地图名（顶部中央）
    bossNameLabel: Label | null = null;
    bossBar: Bar | null = null;

    gameManager: GameManager | null = null;
    playerController: PlayerController | null = null;
    spawnManager: SpawnManager | null = null;

    onLoad(): void {
        // 动态创建 HUD（以屏幕中心 (0,0) 为基准，设计分辨率 1280x720）
        this.hpLabel = createLabel(this.node, 'HP 100/100', -400, 300, 28, new Color(255, 100, 100, 255));
        this.hpBar = createBar(this.node, -400, 272, 240, 14, new Color(255, 90, 90, 255));
        this.levelLabel = createLabel(this.node, 'Lv.1', -400, 252, 22, new Color(255, 205, 125, 255));
        this.waveLabel = createLabel(this.node, '第 1 波', 400, 300, 24, new Color(150, 215, 255, 255));
        this.timeLabel = createLabel(this.node, '00:00', 400, 252, 24, new Color(200, 200, 220, 255));
        this.mapLabel = createLabel(this.node, '', 0, 300, 24, new Color(255, 230, 150, 255));
        this.expBar = createBar(this.node, 0, 250, 420, 14, new Color(80, 195, 255, 255));
        this.boostLabel = createLabel(this.node, '⚡ 0.0s', 0, 212, 22, new Color(120, 255, 180, 255));
        this.boostLabel.node.active = false;
        this.shieldLabel = createLabel(this.node, '🛡 ×0', -400, 204, 22, new Color(140, 190, 255, 255));
        // BOSS 血条（默认隐藏，BOSS 出现时显示）
        this.bossNameLabel = createLabel(this.node, '', 0, 224, 22, new Color(255, 130, 130, 255));
        this.bossNameLabel.node.active = false;
        this.bossBar = createBar(this.node, 0, 200, 460, 16, new Color(255, 70, 70, 255));
    }

    onDestroy(): void {
        if (this.gameManager) {
            this.gameManager.node.off('hud-update', this._onHudUpdate, this);
        }
    }

    /** 设置引用（由 GameManager 调用） */
    setup(gm: GameManager, player: PlayerController, sm: SpawnManager): void {
        this.gameManager = gm;
        this.playerController = player;
        this.spawnManager = sm;
        gm.node.on('hud-update', this._onHudUpdate, this);
    }

    private _onHudUpdate(): void {
        if (!this.playerController) return;
        const p = this.playerController;
        const sm = this.spawnManager;

        // 生命条
        if (this.hpBar) this.hpBar.set(Math.max(0, p.hp / p.maxHp));
        if (this.hpLabel) this.hpLabel.string = `HP ${Math.ceil(p.hp)}/${p.maxHp}`;

        // 等级
        if (this.levelLabel) this.levelLabel.string = `Lv.${p.level}`;

        // 波次 + 计时
        if (this.waveLabel && sm) this.waveLabel.string = `第 ${sm.wave} 波`;
        if (this.timeLabel) this.timeLabel.string = formatTime(this.gameManager?.playTime || 0);

        // 地图名
        if (this.mapLabel && this.gameManager) {
            const m = MAPS[this.gameManager.mapIndex % MAPS.length];
            this.mapLabel.string = m ? `🌊 ${m.name} · ${m.subtitle}` : '';
        }

        // 经验条
        if (this.expBar) this.expBar.set(p.exp / p.expNext);

        // BOSS 血条
        this._updateBossBar();

        // 加速倒计时
        if (this.boostLabel) {
            if (p.boostTimer > 0) {
                this.boostLabel.string = `⚡ ${p.boostTimer.toFixed(1)}s`;
                this.boostLabel.node.active = true;
            } else {
                this.boostLabel.node.active = false;
            }
        }

        // 护盾
        this._updateShieldText(p.shield);
    }

    private _updateBossBar(): void {
        const sm = this.spawnManager;
        const boss = sm ? sm.currentBoss : null;
        const hasBoss = !!boss && boss.node.active;
        if (this.bossNameLabel) this.bossNameLabel.node.active = hasBoss;
        if (!hasBoss) return;
        if (boss && this.bossNameLabel && this.gameManager) {
            const m = MAPS[this.gameManager.mapIndex % MAPS.length];
            this.bossNameLabel.string = `👑 ${m.bossName}`;
        }
        if (boss && this.bossBar) this.bossBar.set(Math.max(0, boss.hp / boss.maxHp));
    }

    private _updateShieldText(currentShield: number): void {
        if (!this.shieldLabel) return;
        const n = Math.max(0, Math.min(PICKUP.SHIELD_MAX, currentShield));
        this.shieldLabel.string = n > 0 ? `🛡 ×${n}` : '';
    }
}
