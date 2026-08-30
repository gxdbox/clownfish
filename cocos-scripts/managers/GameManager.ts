/**
 * GameManager.ts — 游戏状态机 + 主循环 + 全局协调
 * 挂在场景 Managers 节点上。
 * 状态：MENU → PLAYING ⇄ LEVELUP/PAUSED → GAMEOVER
 * Cocos Creator 3.8.8 迁移版
 */
import { _decorator, Component, Node, sys, view, input, Input, EventKeyboard, KeyCode, find } from 'cc';
import { GameState, UI_CONFIG, TERRAIN, PLAYER } from '../config';
import { formatTime } from '../util';
import { WorldManager } from './WorldManager';
import { SpawnManager } from './SpawnManager';
import { AudioManager } from './AudioManager';
import { CameraFollow } from '../components/CameraFollow';
import { Joystick } from '../components/Joystick';
import { PlayerController, UpgradeChoice } from '../components/PlayerController';
import { EnemyAI } from '../components/EnemyAI';
import { EliteAI } from '../components/EliteAI';
import { HUD } from '../ui/HUD';
import { MenuUI } from '../ui/MenuUI';
import { LevelUpUI } from '../ui/LevelUpUI';
import { GameOverUI } from '../ui/GameOverUI';
import { NotifyToast } from '../ui/NotifyToast';
const { ccclass, property } = _decorator;

@ccclass('GameManager')
export class GameManager extends Component {

    // ===== 编辑器属性（拖入场景节点引用） =====
    @property(WorldManager) worldManager: WorldManager | null = null;
    @property(SpawnManager) spawnManager: SpawnManager | null = null;
    @property(AudioManager) audioManager: AudioManager | null = null;
    @property(CameraFollow) cameraFollow: CameraFollow | null = null;
    @property(Joystick) joystick: Joystick | null = null;
    @property(PlayerController) playerController: PlayerController | null = null;

    @property(Node) entityManager: Node | null = null;
    @property(Node) worldNode: Node | null = null; // 地形预制体的父节点

    // UI 节点
    @property(Node) hudNode: Node | null = null;
    @property(Node) menuNode: Node | null = null;
    @property(Node) levelUpNode: Node | null = null;
    @property(Node) pauseNode: Node | null = null;
    @property(Node) gameOverNode: Node | null = null;

    // UI 组件（挂在对应 UI 节点上）
    @property(HUD) hud: HUD | null = null;
    @property(MenuUI) menuUI: MenuUI | null = null;
    @property(LevelUpUI) levelUpUI: LevelUpUI | null = null;
    @property(GameOverUI) gameOverUI: GameOverUI | null = null;
    @property(NotifyToast) notifyToast: NotifyToast | null = null;

    // ===== 运行时状态 =====
    state: GameState = GameState.BOOT;
    playTime = 0;
    private _levelUpChoices: UpgradeChoice[] = [];

    onLoad(): void {
        console.log('[Clownfish] GameManager.onLoad 执行');
        this._resolveNodeRefs();
        // 微信小游戏查询参数检测 debug 模式
        // 注意：编辑器预览环境的 sys 可能没有 getParameterByName，需安全调用
        try {
            const getParam = (sys as any).getParameterByName;
            UI_CONFIG.DEBUG = typeof getParam === 'function' && getParam('debug') === '1';
        } catch {
            UI_CONFIG.DEBUG = false;
        }

        // 键盘事件：菜单界面按回车/空格开始
        input.on(Input.EventType.KEY_DOWN, this._onKeyDown, this);

        // 初始化 UI 组件引用（引用未拖齐时不崩溃，仅功能缺失）
        this.menuUI?.setup(this, this.audioManager!);
        if (this.playerController && this.spawnManager) {
            this.hud?.setup(this, this.playerController, this.spawnManager);
        }
        this.levelUpUI?.setup(this);
        this.gameOverUI?.setup(this);

        // 通知事件监听
        this.node.on('notify', this._onNotify, this);

        this.state = GameState.MENU;
        this._showUI('menu');
        console.log('[Clownfish] GameManager 初始化完成，进入 MENU 状态');
    }

    private _onNotify(text: string): void {
        this.notifyToast?.show(text);
    }

    /** 场景序列化引用丢失时按节点路径运行时补齐（预览/构建环境兜底） */
    private _resolveNodeRefs(): void {
        const c = (p: string) => find(`Canvas/${p}`);
        this.worldNode = this.worldNode ?? c('WorldNode');
        this.entityManager = this.entityManager ?? c('EntityManager');
        this.hudNode = this.hudNode ?? c('UIRoot/HUD');
        this.menuNode = this.menuNode ?? c('UIRoot/MenuPanel');
        this.levelUpNode = this.levelUpNode ?? c('UIRoot/LevelUpPanel');
        this.pauseNode = this.pauseNode ?? c('UIRoot/PausePanel');
        this.gameOverNode = this.gameOverNode ?? c('UIRoot/GameOverPanel');
        if (!this.entityManager) console.warn('[Clownfish] 运行时未找到 Canvas/EntityManager 节点');
    }

    onDestroy(): void {
        input.off(Input.EventType.KEY_DOWN, this._onKeyDown, this);
        this.node.off('notify', this._onNotify, this);
    }

    private _onKeyDown(e: EventKeyboard): void {
        if (this.state === GameState.MENU && (e.keyCode === KeyCode.ENTER || e.keyCode === KeyCode.SPACE)) {
            this.startGame();
        } else if (this.state === GameState.PLAYING && e.keyCode === KeyCode.ESCAPE) {
            this.pause();
        } else if (this.state === GameState.PAUSED && (e.keyCode === KeyCode.ENTER || e.keyCode === KeyCode.SPACE)) {
            this.resume();
        } else if (this.state === GameState.LEVELUP) {
            // 升级卡牌键盘导航：←→/A D 切换、回车/空格确认、1/2/3 直选
            if (e.keyCode === KeyCode.ARROW_LEFT || e.keyCode === KeyCode.KEY_A) {
                this.levelUpUI?.moveSel(-1);
            } else if (e.keyCode === KeyCode.ARROW_RIGHT || e.keyCode === KeyCode.KEY_D) {
                this.levelUpUI?.moveSel(1);
            } else if (e.keyCode === KeyCode.ENTER || e.keyCode === KeyCode.SPACE) {
                this.levelUpUI?.confirmSel();
            } else if (e.keyCode === KeyCode.DIGIT_1) {
                this.chooseUpgrade(0);
            } else if (e.keyCode === KeyCode.DIGIT_2) {
                this.chooseUpgrade(1);
            } else if (e.keyCode === KeyCode.DIGIT_3) {
                this.chooseUpgrade(2);
            }
        }
    }

    // ===== 状态切换 =====

    startGame(): void {
        // 首次用户手势（点击/空格）内解锁音频并启动背景音乐
        this.audioManager?.unlock();
        // 重置所有系统
        this.worldManager?.reset();
        this.spawnManager?.reset();
        this.playerController?.reset();

        // 生成地形
        const terrain = this.worldManager?.generateTerrain();

        // 放置玩家
        const player = this.playerController!;
        player.worldManager = this.worldManager;
        player.audioManager = this.audioManager;
        player.gameManager = this;
        player.joystick = this.joystick;
        player.cameraFollow = this.cameraFollow;
        player.entityManager = this.entityManager;
        player.placeAtStart();

        // 摇杆状态感知：非 PLAYING 状态不响应触摸（避免拦截升级卡牌点击）
        if (this.joystick) this.joystick.gameManager = this;

        // 设置相机
        this.cameraFollow?.snap(PLAYER.START_X, PLAYER.START_Y);

        // 设置生成器
        this.spawnManager?.setup(this.entityManager!, player);
        if (this.spawnManager) {
            this.spawnManager.worldManager = this.worldManager;
            this.spawnManager.audioManager = this.audioManager;
            this.spawnManager.gameManager = this;
        }

        this.playTime = 0;
        this.state = GameState.PLAYING;
        this._showUI('none');
    }

    pause(): void {
        if (this.state !== GameState.PLAYING) return;
        this.state = GameState.PAUSED;
        this._showUI('pause');
    }

    resume(): void {
        if (this.state !== GameState.PAUSED) return;
        this.state = GameState.PLAYING;
        this._showUI('none');
    }

    onLevelUp(): void {
        if (this.state !== GameState.PLAYING) return;
        this.state = GameState.LEVELUP;
        this._levelUpChoices = this._pickChoices();
        this._showUI('levelup');
        // 通知 LevelUpUI 显示选项
        this.node.emit('show-levelup', this._levelUpChoices);
    }

    chooseUpgrade(idx: number): void {
        if (idx < 0 || idx >= this._levelUpChoices.length) return;
        this.playerController?.applyUpgrade(this._levelUpChoices[idx]);
        this.state = GameState.PLAYING;
        this._showUI('none');
    }

    onPlayerDeath(): void {
        if (this.state !== GameState.PLAYING) return;
        this.state = GameState.GAMEOVER;
        this.audioManager?.gameover();
        this.cameraFollow?.addShake(12);

        this._showUI('gameover');
        this.node.emit('show-gameover', {
            time: this.playTime,
            kills: this.spawnManager?.kills || 0,
            wave: this.spawnManager?.wave || 1,
            level: this.playerController?.level || 1
        });
    }

    // ===== 击杀回调 =====

    onEnemyKilled(enemy: EnemyAI): void {
        this.spawnManager?.onEnemyKilled(enemy);
    }

    onEliteKilled(elite: EliteAI): void {
        this.spawnManager?.onEliteKilled(elite);
        this.audioManager?.explosion();
        this.cameraFollow?.addShake(10);
    }

    // ===== 通知 =====

    notify(text: string): void {
        this.node.emit('notify', text);
    }

    // ===== 主循环 =====

    update(dt: number): void {
        // 钳制 dt
        if (dt > 0.033) dt = 0.033;

        switch (this.state) {
            case GameState.PLAYING:
                this._updatePlaying(dt);
                break;
            case GameState.LEVELUP:
            case GameState.MENU:
                // UI 动画更新
                break;
            case GameState.GAMEOVER:
                // 相机震屏衰减
                this.cameraFollow?.updateShake(dt);
                break;
            case GameState.PAUSED:
                break; // 全冻结
        }
    }

    private _updatePlaying(dt: number): void {
        this.playTime += dt;

        // 注意：实体组件（PlayerController/SpawnManager/EnemyAI/EliteAI/Bullet/Pickup）
        // 均为 Cocos Component，引擎会自动调用其 update，此处不再手动调用，
        // 组件内部通过 gameManager.state === PLAYING 自行判断是否运行。

        // 更新地形冷却
        this.worldManager?.updateSpikes(dt);

        // 地形伤害检测
        this._checkTerrainDamage();

        // 相机跟随
        const player = this.playerController;
        if (player && !player.dead) {
            const ppos = player.node.position;
            this.cameraFollow?.follow(ppos.x, ppos.y, dt);
        }
        this.cameraFollow?.updateShake(dt);

        // HUD 更新
        this.node.emit('hud-update');
    }

    /** 尖刺/海胆接触伤害 */
    private _checkTerrainDamage(): void {
        const player = this.playerController;
        if (!player || player.dead || player.invincible > 0) return;

        const pos = player.node.position;
        const wm = this.worldManager!;

        // 尖刺
        const si = wm.spikeAt(pos.x, pos.y, PLAYER.RADIUS);
        if (si >= 0) {
            const spikes = wm.terrain.spikes;
            const sp = spikes[si];
            if (sp.cd <= 0) {
                sp.cd = TERRAIN.SPIKE_COOLDOWN;
                player.damagePlayer(TERRAIN.SPIKE_DAMAGE, sp.x, sp.y);
                this.audioManager?.spikeHit();
            }
            return;
        }

        // 海胆
        const ui = wm.urchinAt(pos.x, pos.y, PLAYER.RADIUS);
        if (ui >= 0) {
            const urchins = wm.terrain.urchins;
            const ur = urchins[ui];
            if (ur.cd <= 0) {
                ur.cd = TERRAIN.URCHIN_COOLDOWN;
                player.damagePlayer(TERRAIN.URCHIN_DAMAGE, ur.x, ur.y);
                this.audioManager?.spikeHit();
            }
        }
    }

    // ===== 升级选项池 =====

    private _pickChoices(): UpgradeChoice[] {
        const allUpgrades: UpgradeChoice[] = [
            { id: 'bulletCount', name: '多重射击', desc: '子弹数量 +1', icon: '🔫' },
            { id: 'bulletDamage', name: '强化弹药', desc: '子弹伤害 +5', icon: '💥' },
            { id: 'bulletSpeed', name: '高速弹道', desc: '子弹速度 +40', icon: '⚡' },
            { id: 'fireRate', name: '快速装填', desc: '射击间隔 -15%', icon: '🔄' },
            { id: 'maxHp', name: '生命强化', desc: '最大生命 +20', icon: '❤' },
            { id: 'speed', name: '迅捷步伐', desc: '移动速度 +20', icon: '' },
            { id: 'bulletRange', name: '超视距', desc: '子弹射程 +60', icon: '' },
            { id: 'regen', name: '生命恢复', desc: '每秒回血 +0.5', icon: '💚' },
            { id: 'pierce', name: '穿透弹', desc: '子弹穿透 +1', icon: '🗡' },
            { id: 'pickupRange', name: '磁铁强化', desc: '拾取范围 +30', icon: '🧲' },
        ];

        // 随机选 3 个
        const choices: UpgradeChoice[] = [];
        const pool = [...allUpgrades];
        for (let i = 0; i < 3 && pool.length > 0; i++) {
            const idx = Math.floor(Math.random() * pool.length);
            choices.push(pool.splice(idx, 1)[0]);
        }
        return choices;
    }

    // ===== UI 显示控制 =====

    private _showUI(which: 'none' | 'menu' | 'levelup' | 'pause' | 'gameover'): void {
        if (this.hudNode) this.hudNode.active = which === 'none';
        if (this.menuNode) this.menuNode.active = which === 'menu';
        if (this.levelUpNode) this.levelUpNode.active = which === 'levelup';
        if (this.pauseNode) this.pauseNode.active = which === 'pause';
        if (this.gameOverNode) this.gameOverNode.active = which === 'gameover';
    }
}
