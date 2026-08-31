/**
 * GameManager.ts — 游戏状态机 + 主循环 + 全局协调
 * 挂在场景 Managers 节点上。
 * 状态：MENU → PLAYING ⇄ LEVELUP/PAUSED → GAMEOVER
 * Cocos Creator 3.8.8 迁移版
 *
 * 场景搭建兜底：_ensureSceneStructure 自举缺失节点/组件，
 * 仅需「Canvas + Main Camera + 本节点」即可运行，
 * 避免升级面板等节点缺失导致弹框不显示 → 升级后卡死。
 */
import { _decorator, Component, Node, sys, view, input, Input, EventKeyboard, KeyCode, find, UITransform, Graphics, Camera, Color, Label } from 'cc';
import { GameState, UI_CONFIG, TERRAIN, PLAYER, WORLD } from '../config';
import { formatTime, createLabel } from '../util';
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
        // 场景结构自举：缺失节点/组件自动创建，错层级自动修正，最小场景即可运行
        this._ensureSceneStructure();
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

        // 全局异常上屏：微信用户不便抓 console，异常直接显示在屏幕上便于截图反馈
        try {
            const wx = (globalThis as any).wx;
            if (wx && typeof wx.onError === 'function') {
                wx.onError((err: any) => {
                    const msg = err && err.stack ? String(err.stack) : (err && err.message ? String(err.message) : String(err));
                    this._showErrorTip('全局异常 ' + msg);
                });
            }
        } catch { /* 非微信环境忽略 */ }

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

    // ===== 场景结构自举（最小场景 = Canvas + Main Camera + 本节点） =====

    /**
     * 自举全部必要节点与组件：
     * 1. 世界层节点（WorldNode/EntityManager/Player）若被搭在 Canvas（UI 层）下则移到场景根，避免相机跟随失效；
     * 2. 全部 UI 面板/管理器/相机组件缺失时自动创建；
     * 3. 这是「升级弹框找不到 → 升级后卡死」问题的根治：弹框再也不会因场景搭建不全而消失。
     */
    private _ensureSceneStructure(): void {
        const scene = this.node.scene;
        if (!scene) return;
        const canvas = scene.getChildByName('Canvas') ?? find('Canvas') ?? undefined;

        // UIRoot：UI 容器
        let uiRoot = canvas ? (canvas.getChildByName('UIRoot') ?? null) : null;
        if (!uiRoot && canvas) {
            uiRoot = new Node('UIRoot');
            this._initUINode(uiRoot);
            canvas.addChild(uiRoot);
        }

        // 世界层节点：WorldNode / EntityManager（Canvas 下的世界节点移到场景根）
        if (!this.worldNode) {
            this.worldNode = new Node('WorldNode');
            this._initWorldNode(this.worldNode);
            scene.addChild(this.worldNode);
        } else {
            if (this.worldNode.parent === canvas) scene.addChild(this.worldNode);
            this._initWorldNode(this.worldNode);
        }
        if (this.entityManager) {
            if (this.entityManager.parent === canvas) scene.addChild(this.entityManager);
            this._initWorldNode(this.entityManager);
        }
        if (!this.entityManager) {
            this.entityManager = new Node('EntityManager');
            this._initWorldNode(this.entityManager);
            scene.addChild(this.entityManager);
        }

        // 玩家节点
        if (!this.playerController) {
            let pNode = scene.getChildByName('Player') ?? null;
            if (!pNode) {
                pNode = new Node('Player');
                scene.addChild(pNode);
            } else if (pNode.parent === canvas) {
                scene.addChild(pNode);
            }
            this.playerController = pNode.getComponent(PlayerController) ?? pNode.addComponent(PlayerController);
        }

        // UI 面板（缺则创建，错层级则归位到 UIRoot）
        this.hudNode = this._ensureUIPanel(uiRoot, this.hudNode, 'HUD', false);
        this.menuNode = this._ensureUIPanel(uiRoot, this.menuNode, 'MenuPanel', true);
        this.levelUpNode = this._ensureUIPanel(uiRoot, this.levelUpNode, 'LevelUpPanel', false);
        this.pauseNode = this._ensureUIPanel(uiRoot, this.pauseNode, 'PausePanel', false);
        this.gameOverNode = this._ensureUIPanel(uiRoot, this.gameOverNode, 'GameOverPanel', false);
        let toastNode = this.notifyToast ? this.notifyToast.node : null;
        if (!toastNode) toastNode = this._ensureUIPanel(uiRoot, null, 'NotifyToast', false);
        else if (uiRoot && toastNode.parent !== uiRoot) uiRoot.addChild(toastNode);

        // 暂停面板提示文字（动态创建，不依赖 onLoad）
        if (this.pauseNode && this.pauseNode.children.length === 0) {
            createLabel(this.pauseNode, '⏸ 已暂停', 0, 40, 44);
            createLabel(this.pauseNode, '按 Esc / 回车键继续', 0, -20, 24, new Color(140, 170, 190, 255));
        }

        // UI 组件（缺则挂载；LevelUpUI/MenuUI 等均支持节点未激活时初始化）
        this.hud = this.hudNode ? (this.hudNode.getComponent(HUD) ?? this.hudNode.addComponent(HUD)) : null;
        this.menuUI = this.menuNode ? (this.menuNode.getComponent(MenuUI) ?? this.menuNode.addComponent(MenuUI)) : null;
        this.levelUpUI = this.levelUpNode ? (this.levelUpNode.getComponent(LevelUpUI) ?? this.levelUpNode.addComponent(LevelUpUI)) : null;
        this.gameOverUI = this.gameOverNode ? (this.gameOverNode.getComponent(GameOverUI) ?? this.gameOverNode.addComponent(GameOverUI)) : null;
        this.notifyToast = toastNode ? (toastNode.getComponent(NotifyToast) ?? toastNode.addComponent(NotifyToast)) : null;

        // 摇杆（UI 层最顶层；全局 input 监听，不参与 UI 触摸命中，不挡升级卡牌点击）
        if (!this.joystick) {
            let joyNode = canvas ? (canvas.getChildByName('JoystickNode') ?? null) : null;
            if (!joyNode && canvas) {
                joyNode = new Node('JoystickNode');
                this._initUINode(joyNode);
                canvas.addChild(joyNode);
            }
            if (joyNode) {
                if (!joyNode.getComponent(UITransform)) this._initUINode(joyNode);
                if (!joyNode.getComponent(Graphics)) joyNode.addComponent(Graphics);
                joyNode.setSiblingIndex(Math.max(0, (joyNode.parent?.children.length ?? 1) - 1));
                this.joystick = joyNode.getComponent(Joystick) ?? joyNode.addComponent(Joystick);
                this.joystick.gameManager = this;
            }
        }

        // 管理器组件：WorldManager 挂 WorldNode（世界层），SpawnManager/AudioManager 挂本节点
        if (!this.worldManager && this.worldNode) {
            this.worldManager = this.worldNode.getComponent(WorldManager) ?? this.worldNode.addComponent(WorldManager);
        }
        if (!this.spawnManager) {
            this.spawnManager = this.node.getComponent(SpawnManager) ?? this.node.addComponent(SpawnManager);
        }
        if (!this.audioManager) {
            this.audioManager = this.node.getComponent(AudioManager) ?? this.node.addComponent(AudioManager);
        }

        // 相机跟随（Main Camera 自动挂载）
        if (!this.cameraFollow) {
            const camNode = scene.getChildByName('Main Camera')
                ?? scene.getChildByName('main camera')
                ?? scene.getComponentInChildren(Camera)?.node ?? null;
            if (camNode) {
                this.cameraFollow = camNode.getComponent(CameraFollow) ?? camNode.addComponent(CameraFollow);
            }
        }
    }

    /** 确保 UI 面板节点存在且归属 UIRoot（缺则创建、错层级归位），返回面板节点 */
    private _ensureUIPanel(uiRoot: Node | null, node: Node | null, name: string, active: boolean): Node | null {
        let n = node ?? (uiRoot ? (uiRoot.getChildByName(name) ?? null) : null);
        if (!n && uiRoot) {
            n = new Node(name);
            this._initUINode(n);
            uiRoot.addChild(n);
        }
        if (n && uiRoot && n.parent !== uiRoot) uiRoot.addChild(n);
        if (n) {
            n.active = active;
            if (!n.getComponent(UITransform)) this._initUINode(n);
        }
        return n;
    }

    /** 初始化 UI 节点几何：锚点居中 + 铺满设计分辨率 1280x720 */
    private _initUINode(n: Node): void {
        const t = n.getComponent(UITransform) || n.addComponent(UITransform);
        t.setAnchorPoint(0.5, 0.5);
        t.setContentSize(1280, 720);
        n.setPosition(0, 0, 0);
    }

    /** 初始化世界层节点几何：锚点左下 + 世界尺寸 */
    private _initWorldNode(n: Node): void {
        n.setPosition(0, 0, 0);
        const t = n.getComponent(UITransform) || n.addComponent(UITransform);
        t.setAnchorPoint(0, 0);
        t.setContentSize(WORLD.SIZE, WORLD.SIZE);
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
        // 分步执行 + try/catch：任一步失败时把异常显示在屏幕上（微信不便抓 console，便于截图定位）
        let step = 'unlock';
        try {
            // 首次用户手势（点击/空格）内解锁音频并启动背景音乐
            this.audioManager?.unlock();
            // 重置所有系统
            step = 'reset';
            this.worldManager?.reset();
            this.spawnManager?.reset();
            this.playerController?.reset();

            // 生成地形
            step = 'terrain';
            this.worldManager?.generateTerrain();

            // 放置玩家
            step = 'player';
            const player = this.playerController;
            if (!player) { this._showErrorTip('启动失败 @player：playerController 缺失'); return; }
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
            step = 'camera';
            this.cameraFollow?.snap(PLAYER.START_X, PLAYER.START_Y);

            // 设置生成器
            step = 'spawn';
            this.spawnManager?.setup(this.entityManager!, player);
            if (this.spawnManager) {
                this.spawnManager.worldManager = this.worldManager;
                this.spawnManager.audioManager = this.audioManager;
                this.spawnManager.gameManager = this;
            }

            step = 'ui';
            this.playTime = 0;
            this.state = GameState.PLAYING;
            this._showUI('none');
        } catch (e) {
            const msg = e instanceof Error ? (e.message + '\n' + (e.stack || '')) : String(e);
            console.error('[Clownfish] startGame 失败 @' + step, e);
            this._showErrorTip('启动失败 @' + step + '：' + msg);
        }
    }

    /** 启动/全局异常上屏提示（红色文字，便于真机截图反馈） */
    private _showErrorTip(msg: string): void {
        console.error('[Clownfish] ' + msg);
        const canvas = this.node.scene?.getChildByName('Canvas') ?? find('Canvas') ?? undefined;
        const parent = canvas ?? this.node;
        let tip = parent.getChildByName('ErrorTip');
        if (!tip) {
            tip = createLabel(parent, '', 0, -300, 22, new Color(255, 90, 90, 255));
            tip.name = 'ErrorTip';
            tip.setPosition(0, -300, 0);
        }
        const label = tip.getComponent(Label) ?? tip.addComponent(Label);
        label.overflow = Label.Overflow.RESIZE_HEIGHT;
        label.enableWrapText = true;
        label.string = msg.slice(0, 300);
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
        // 兜底：升级面板异常（场景搭建不全）时自动选择第一项，避免永远卡在升级状态
        if (!this.levelUpNode || !this.levelUpUI) {
            console.warn('[Clownfish] 升级面板不可用，自动选择第一个升级项');
            this.chooseUpgrade(0);
            return;
        }
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
