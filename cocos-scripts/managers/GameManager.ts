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
import { _decorator, Component, Node, sys, view, input, Input, EventKeyboard, KeyCode, find, UITransform, Graphics, Camera, Color, Label, RenderRoot2D, Layers, Canvas as UICanvas, game, tween, Vec3, UIOpacity } from 'cc';
import { GameState, UI_CONFIG, TERRAIN, PLAYER, WORLD, MAPS, BOMB, ENTRANCE, NPC_SCRIPT, SHOP_ITEMS, PICKUP, HIDDEN_BOSS, CHEST, BOSS_REWARD, BOSS_FX } from '../config';
import { formatTime, createLabel, clamp } from '../util';
import { WorldManager } from './WorldManager';
import { SpawnManager } from './SpawnManager';
import { AudioManager } from './AudioManager';
import { CameraFollow } from '../components/CameraFollow';
import { Joystick } from '../components/Joystick';
import { PlayerController, UpgradeChoice } from '../components/PlayerController';
import { EnemyAI } from '../components/EnemyAI';
import { EliteAI } from '../components/EliteAI';
import { BossAI } from '../components/BossAI';
import { MapEntrance } from '../components/MapEntrance';
import { SlotMachine, BossRewardItem } from '../components/SlotMachine';
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
    mapIndex = 0;                    // 当前世界（0 珊瑚礁 / 1 深海 / 2 海底火山）
    private _levelUpChoices: UpgradeChoice[] = [];
    private _heartbeatAcc = 0;       // PLAYING 心跳日志计时（每秒输出实体数量）
    private _roomState: { kind: 'dialogue' | 'shop' | 'boss'; index: number; collected: boolean } | null = null;
    private _hiddenBoss: BossAI | null = null;   // 当前隐藏Boss（熔岩裂隙）
    private _slotMachine: SlotMachine | null = null; // 当前抽奖机（Boss 战利品）
    private _pendingAdvance: (() => void) | null = null; // 抽奖完成后的续接（开传送门）
    // —— Boss 胜利节拍（慢动作→冻结→横幅→面板） ——
    private _slowMoEndAt = 0;                        // 慢动作结束的真实时间戳（不用 dt：已被缩放）
    private _slowMoNext: (() => void) | null = null;  // 冻结拍要续接的下一步（开面板）
    private _bannerText = '';
    private _bannerPending = false;                  // 横幅演出中（兼作防重入标志）

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
                    console.error('[Clownfish] wx.onError:', msg);
                    this._showErrorTip('全局异常 ' + msg);
                });
            }
            // 兜底：window 级异常（微信 dev 工具/浏览器环境下 wx.onError 未必覆盖异步回调异常）
            const win = (globalThis as any).window;
            if (win) {
                if (typeof win.onerror === 'function') {
                    const prev = win.onerror;
                    win.onerror = (...args: any[]) => {
                        const msg = args.map((a) => String(a)).join(' ');
                        console.error('[Clownfish] window.onerror:', msg);
                        this._showErrorTip('JS异常 ' + msg.slice(0, 400));
                        if (typeof prev === 'function') return prev.apply(win, args);
                        return false;
                    };
                }
                if (typeof win.addEventListener === 'function') {
                    try {
                        win.addEventListener('unhandledrejection', (ev: any) => {
                            const reason = ev && ev.reason;
                            const msg = reason && reason.stack ? String(reason.stack) : (reason && reason.message ? String(reason.message) : String(reason));
                            console.error('[Clownfish] unhandledrejection:', msg);
                            this._showErrorTip('Promise异常 ' + msg.slice(0, 400));
                        });
                    } catch { /* 忽略 */ }
                }
            }
        } catch { /* 非微信环境忽略 */ }

        this.state = GameState.MENU;
        this._showUI('menu');
        // 调试句柄：微信自动化测试可直接取到 GameManager（线上无副作用）
        (globalThis as any).__cfGM = this;
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
            // 世界层节点需 RenderRoot2D 才能进入 2D 渲染树（场景根下的 Graphics 否则不绘制）
            if (!pNode.getComponent(RenderRoot2D)) pNode.addComponent(RenderRoot2D);
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
        {
            const camNode = this.cameraFollow ? this.cameraFollow.node
                : (scene.getChildByName('Main Camera')
                    ?? scene.getChildByName('main camera')
                    ?? scene.getComponentInChildren(Camera)?.node ?? null);
            if (camNode) {
                // 相机若在 Canvas 下，世界坐标会叠加 Canvas 偏移 → 移到场景根
                if (camNode.parent !== scene) scene.addChild(camNode);
                this.cameraFollow = camNode.getComponent(CameraFollow) ?? camNode.addComponent(CameraFollow);
            }
        }

        // ===== 双相机：世界相机跟随玩家，UI 相机固定叠加 =====
        // 单相机方案下相机一移动 UI 就出屏，必须拆分
        const worldCam = this.cameraFollow ? this.cameraFollow.node.getComponent(Camera) : null;
        if (worldCam) {
            worldCam.projection = Camera.ProjectionType.ORTHO;
            worldCam.orthoHeight = 360;
            worldCam.visibility = Layers.Enum.DEFAULT; // 只渲染世界层
            worldCam.clearFlags = Camera.ClearFlag.SOLID_COLOR;
            worldCam.clearColor = new Color(3, 14, 28, 255);
            worldCam.priority = 0;
        }
        let uiCamNode = canvas ? canvas.getChildByName('UICamera') : null;
        if (!uiCamNode) {
            uiCamNode = new Node('UICamera');
            // 挂在 Canvas 下：自动对齐 Canvas 中心（Canvas 位置随屏幕适配变化）
            if (canvas) canvas.addChild(uiCamNode); else scene.addChild(uiCamNode);
        }
        uiCamNode.setPosition(0, 0, 1000);
        const uiCam = uiCamNode.getComponent(Camera) ?? uiCamNode.addComponent(Camera);
        uiCam.projection = Camera.ProjectionType.ORTHO;
        uiCam.orthoHeight = 360;
        uiCam.visibility = Layers.Enum.UI_2D; // 只渲染 UI 层
        uiCam.clearFlags = Camera.ClearFlag.DEPTH_ONLY; // 保留世界相机画的颜色
        uiCam.priority = 1; // 后渲染，叠在上层
        if (canvas) {
            const canvasComp = canvas.getComponent(UICanvas);
            if (canvasComp) canvasComp.cameraComponent = uiCam;
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
            n.layer = Layers.Enum.UI_2D; // UI 面板统一 UI_2D 层，由固定 UI 相机渲染
            if (!n.getComponent(UITransform)) this._initUINode(n);
        }
        return n;
    }

    /** 初始化 UI 节点几何：锚点居中 + 铺满设计分辨率 1280x720 */
    private _initUINode(n: Node): void {
        n.layer = Layers.Enum.UI_2D;
        const t = n.getComponent(UITransform) || n.addComponent(UITransform);
        t.setAnchorPoint(0.5, 0.5);
        t.setContentSize(1280, 720);
        n.setPosition(0, 0, 0);
    }

    /** 初始化世界层节点几何：锚点左下 + 世界尺寸 */
    private _initWorldNode(n: Node): void {
        n.setPosition(0, 0, 0);
        n.layer = Layers.Enum.DEFAULT;
        if (!n.getComponent(RenderRoot2D)) n.addComponent(RenderRoot2D);
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

    /** 重玩：先弹武器选择面板再开始（GameOver"再来一局"调用，允许重新选子弹） */
    restartWithWeaponSelect(): void {
        this._showUI('menu');
        this.menuUI?.showWeaponSelect();
    }

    startGame(): void {
        // 分步执行 + try/catch：任一步失败时把异常显示在屏幕上（微信不便抓 console，便于截图定位）
        let step = 'unlock';
        console.log('[Clownfish] startGame 开始');
        try {
            // 首次用户手势（点击/空格）内解锁音频并启动背景音乐
            this.audioManager?.unlock();
            // 重置所有系统
            step = 'reset';
            console.log('[Clownfish] startGame @reset');
            this.mapIndex = 0;
            this._clearEntities();
            this.worldManager?.reset();
            this.spawnManager?.reset();
            this.playerController?.reset();

            // 生成地形（第一张地图：珊瑚礁）
            step = 'terrain';
            console.log('[Clownfish] startGame @terrain');
            this.worldManager?.setMap(0);
            this.worldManager?.generateTerrain();

            // 生成主题入口（珊瑚礁·海葵洞剧情房）
            this._spawnEntrance();
            // 生成随机宝箱
            this.spawnManager?.spawnChests();

            // 放置玩家
            step = 'player';
            console.log('[Clownfish] startGame @player');
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
            console.log('[Clownfish] startGame @camera');
            this.cameraFollow?.snap(PLAYER.START_X, PLAYER.START_Y);

            // 设置生成器
            step = 'spawn';
            console.log('[Clownfish] startGame @spawn');
            this.spawnManager?.setup(this.entityManager!, player);
            if (this.spawnManager) {
                this.spawnManager.worldManager = this.worldManager;
                this.spawnManager.audioManager = this.audioManager;
                this.spawnManager.gameManager = this;
            }

            step = 'ui';
            this.playTime = 0;
            this.state = GameState.PLAYING;
            this.audioManager?.playBgm(this._mapBgm());
            this._showUI('none');
            // 触屏操作提示（淡显，用过即淡出）
            this.joystick?.showHints();
            console.log('[Clownfish] startGame 完成，进入 PLAYING');
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
        // 基于可见区动态定位：矮屏（手机横屏可见高约 460）上固定 -300 会被裁到屏幕外
        const tipY = -(view.getVisibleSize().height / 2 - 30);
        let tip = parent.getChildByName('ErrorTip');
        if (!tip) {
            tip = createLabel(parent, '', 0, tipY, 22, new Color(255, 90, 90, 255)).node;
            tip.name = 'ErrorTip';
            tip.setPosition(0, tipY, 0);
        } else {
            tip.setPosition(0, tipY, 0);
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
        this.audioManager?.playBgm('defeat');
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

    onBossKilled(boss: BossAI): void {
        this.audioManager?.explosion();
        this.cameraFollow?.addShake(14);
        // 提前缓存 Boss 位置：Boss 的 _kill() 已 destroy 节点，
        // 抽奖回调（2-3秒后）再读 boss.node.position 会 null 崩溃 + 传送门不生成
        const bossX = boss.node?.position.x ?? 0;
        const bossY = boss.node?.position.y ?? 0;
        // 隐藏Boss击杀 → 稀有奖励 + 关房间（不走地图Boss流程）
        if (boss.hidden || this._hiddenBoss === boss) {
            this.spawnManager?.onBossKilled(boss); // 掉落
            this._onHiddenBossKilled();
            return;
        }
        this.spawnManager?.onBossKilled(boss); // 掉落
        const map = MAPS[this.mapIndex % MAPS.length];
        const name = map.bossName;
        if (this.mapIndex >= MAPS.length - 1) {
            // 最终世界 BOSS 击杀 = 通关（走完整胜利节拍 → 抽奖后结算）
            this._victoryBeats(`🏆 ${name} 被击败！`, () => this._openBossReward(() => { this._victory(); }));
        } else {
            // 胜利节拍→ 抽奖→ 抽完用缓存的位置开传送门
            this._victoryBeats(`🏆 ${name} 被击败！`, () => this._openBossReward(() => {
                this.notify(`💠 ${name} 被击败！传送门已开启，游进去进入下一世界`);
                this.spawnManager?.spawnPortal(bossX, bossY);
            }));
        }
    }

    /** 胜利节拍第一拍：慢动作凝滞（世界仍在跑，只是变慢）。
     *  下一拍才冻结——两者不能同时，否则“慢动作”无对象可慢。 */
    private _victoryBeats(bannerText: string, then: () => void): void {
        if (this._slowMoEndAt > 0 || this._bannerPending) return;   // 防重入
        this.audioManager?.playBgm(BOSS_FX.BGM_KEY);   // 音乐上“松一口气”
        this._bannerText = bannerText;
        this._slowMoNext = then;
        // 慢动作计时必须走真实时间：dt 已被 frameTimeScale 缩放，用它会把 620ms 拖成近 1.8s
        this._slowMoEndAt = Date.now() + BOSS_FX.SLOWMO_MS;
        game.frameTimeScale = BOSS_FX.SLOWMO_SCALE;
    }

    /** 第二拍：慢动作结束 → 全场冻结 + 残余弹幕消散 */
    private _enterRewardFreeze(): void {
        this._slowMoEndAt = 0;
        game.frameTimeScale = 1;                     // 最先恢复：泄漏到下一张图 = 全局变慢且难排查
        const then = this._slowMoNext;
        this._slowMoNext = null;
        // 慢动作期间玩家已死 / 已离开战斗态 → 放弃奖励流程（不能死了还抽奖）
        if (this.playerController?.dead || this.state !== GameState.PLAYING) return;
        this.state = GameState.REWARD;               // 15 个组件的 !== PLAYING 门禁同时生效
        this._clearEnemyBullets();
        this._bannerPending = true;
        this._showVictoryBanner(this._bannerText, () => {
            this._bannerPending = false;
            if (then) then();
        });
    }

    /** 只消敌方弹幕（名为 BossBullet）：不能用 _clearEntities，
     *  它会一刀切销毁 entityManager 全部子节点，把 Boss 掉的战利品与宝石一起清没 */
    private _clearEnemyBullets(): void {
        if (!this.entityManager) return;
        let n = 0;
        for (const c of this.entityManager.children.slice()) {
            if (c.name === 'BossBullet') { c.destroy(); n++; }
        }
        if (n > 0) console.log(`[Clownfish] 胜利清场：消散 ${n} 发敌方弹幕`);
    }

    /** 第三拍：胜利横幅（scale 渐入 + 停留 + 淡出），给“我赢了”一个确认时刻 */
    private _showVictoryBanner(text: string, then: () => void): void {
        const canvas = this.node.scene?.getChildByName('Canvas') ?? this.node;
        if (!canvas) { then(); return; }
        const bn = new Node('VictoryBanner');
        bn.layer = Layers.Enum.UI_2D;
        canvas.addChild(bn);
        bn.setPosition(0, 0, 0);                     // 居中：此时面板未出，中央无障碍
        const op = bn.addComponent(UIOpacity);
        op.opacity = 0;
        bn.setScale(0.6, 0.6, 1);
        // 矮屏适配：手机横屏可视高约 460，字号不能按桌面写死
        const vs = view.getVisibleSize();
        const size = Math.round(Math.min(46, vs.height * 0.11));
        const made = createLabel(bn, text, 0, 0, size, new Color(255, 226, 130, 255));
        if (made.label) made.label.isBold = true;
        tween(bn).to(BOSS_FX.BANNER_IN, { scale: new Vec3(1, 1, 1) }, { easing: 'backOut' }).start();
        // tween 走引擎缓动系统，不受 game.state 影响（REWARD 冻结下仍正常播放）
        tween(op)
            .to(BOSS_FX.BANNER_IN, { opacity: 255 })
            .delay(BOSS_FX.BANNER_HOLD)
            .to(BOSS_FX.BANNER_OUT, { opacity: 0 })
            .call(() => {
                if (bn.isValid) bn.destroy();
                if (this.isValid) then();
            })
            .start();
    }

    // ===== Boss 胜利战利品（老虎机式抽奖） =====

    /** 打开 Boss 战利品抽奖机（在 Boss 击杀后调用）：
     *  弹出老虎机 → 滚动 → 中奖应用 → 关闭（回调续接开传送门） */
    private _openBossReward(onFinish: () => void): void {
        const canvas = this.node.scene?.getChildByName('Canvas') ?? this.node;
        if (!canvas) return;
        // 抽奖期间暂停战斗节奏（暂停普通生成）
        if (this.spawnManager) this.spawnManager.bossActive = true;
        const node = new Node('SlotMachine');
        node.layer = Layers.Enum.UI_2D;
        canvas.addChild(node);
        node.setPosition(0, 0, 0);
        const sm = node.getComponent(SlotMachine) ?? node.addComponent(SlotMachine);
        this._slotMachine = sm;
        this._pendingAdvance = onFinish;
        sm.startSpin(BOSS_REWARD.ITEMS, (item) => this._applyReward(item));
    }

    /** 应用抽奖奖品效果 */
    private _applyReward(item: BossRewardItem): void {
        const p = this.playerController;
        const sp = this.spawnManager;
        if (!p) { this._finishBossReward(); return; }
        const px = p.node.position.x, py = p.node.position.y;
        switch (item.effect) {
            case 'gem20':   // 掉 20 颗经验宝石
                if (sp) for (let i = 0; i < 20; i++) {
                    const a = Math.random() * Math.PI * 2;
                    const r = Math.random() * 120;
                    sp.spawnPickupPublic(clamp(px + Math.cos(a) * r, 20, WORLD.SIZE - 20),
                        clamp(py + Math.sin(a) * r, 20, WORLD.SIZE - 20), 'gem', PICKUP.GEM_VALUE);
                }
                break;
            case 'bomb1':   // 掉 1 个炸弹
                if (sp) sp.spawnPickupPublic(px + 40, py, 'bomb', 0);
                break;
            case 'hp40':    // 回 40 血
                p.hp = Math.min(p.maxHp, p.hp + 40);
                break;
            case 'speed10': // 移速 +10%（永久）
                p.speed = Math.round(p.speed * 1.10);
                break;
            case 'damage20': // 子弹伤害 +20%（永久，跨武器保留：走升级加成层，防被 setWeapon 覆盖）
                p.addDamagePct(0.2);
                break;
            case 'shield2': // +2 层护盾
                p.shield = Math.min(PICKUP.SHIELD_MAX, p.shield + 2);
                break;
        }
        this.notify(`🎁 战利品：${item.icon} ${item.name}！`);
        // 应用后稍等 → 完成抽奖（走引擎调度器：节点失效即停，避免裸定时器访问已销毁对象）
        this.scheduleOnce(() => {
            if (this.isValid) this._finishBossReward();
        }, 0.8);
    }

    /** 完成抽奖：关闭抽奖机 + 恢复游戏 + 续接（开传送门） */
    private _finishBossReward(): void {
        this._slotMachine?.close();
        this._slotMachine = null;
        game.frameTimeScale = 1;                                            // 保底：慢动作绝不泄漏
        if (this.state === GameState.REWARD) this.state = GameState.PLAYING; // 解冻：必须在续接回调之前
        if (this.spawnManager) this.spawnManager.bossActive = false;
        const next = this._pendingAdvance;
        this._pendingAdvance = null;
        if (next) next();
    }

    /** 推进到下一张地图（玩家接触传送门触发） */
    advanceMap(): void {
        this.mapIndex++;
        if (this.mapIndex >= MAPS.length) {
            this._victory();
            return;
        }
        const map = MAPS[this.mapIndex];
        this._clearEntities();
        this.worldManager?.reset();
        this.worldManager?.setMap(this.mapIndex);
        this.worldManager?.generateTerrain();
        this.spawnManager?.resetForNewMap();
        this.playerController?.placeAtStart();
        this.cameraFollow?.snap(PLAYER.START_X, PLAYER.START_Y);
        this.audioManager?.playBgm(this._mapBgm());
        this.notify(`🌊 进入 ${map.name}（${map.subtitle}）`);
        // 生成新地图的主题入口 + 随机宝箱
        this._spawnEntrance();
        this.spawnManager?.spawnChests();
    }

    /** 宝箱爆开：随机掉宝贝（按 CHEST.DROPS 权重表） */
    onChestBreak(x: number, y: number): void {
        if (!this.spawnManager) return;
        const drops = CHEST.DROPS;
        let total = 0;
        for (const d of drops) total += d.weight;
        let roll = Math.random() * total;
        let chosen = drops[drops.length - 1];
        for (const d of drops) {
            roll -= d.weight;
            if (roll <= 0) { chosen = d; break; }
        }
        // 按 count 掉落（宝石/金币溅射，其他单点）
        if (chosen.count > 1) {
            for (let i = 0; i < chosen.count; i++) {
                const a = Math.random() * Math.PI * 2;
                const r = Math.random() * chosen.radius;
                const gx = clamp(x + Math.cos(a) * r, 20, WORLD.SIZE - 20);
                const gy = clamp(y + Math.sin(a) * r, 20, WORLD.SIZE - 20);
                this.spawnManager.spawnPickupPublic(gx, gy, chosen.type, chosen.value);
            }
        } else {
            this.spawnManager.spawnPickupPublic(x, y, chosen.type, chosen.value);
        }
        const names: Record<string, string> = {
            gem: '💎 宝石雨！', hpBig: '❤ 大血球！', shield: '🛡 护盾！',
            boost: '⚡ 加速！', coin: '🪙 金币！', bomb: '💣 炸弹！',
        };
        this.notify(`📦 宝箱爆开：${names[chosen.type] ?? '宝贝！'}`);
        console.log(`[Clownfish] 宝箱爆开 @(${x.toFixed(0)}, ${y.toFixed(0)}) → ${chosen.type}×${chosen.count}`);
    }

    // ===== 地图入口（每图一个主题入口：剧情房/商店/隐藏Boss） =====

    /** 生成当前地图的主题入口（startGame 和 advanceMap 后调用） */
    private _spawnEntrance(): void {
        if (!this.entityManager || !this.playerController) return;
        const pos = ENTRANCE.POS[this.mapIndex % ENTRANCE.POS.length];
        if (!pos) return;
        const node = new Node('MapEntrance');
        this.entityManager.addChild(node);
        const ent = node.getComponent(MapEntrance) ?? node.addComponent(MapEntrance);
        ent.gameManager = this;
        ent.player = this.playerController;
        ent.init(pos.x, pos.y, this.mapIndex);
        console.log(`[Clownfish] 地图入口生成: ${ENTRANCE.THEME[this.mapIndex % ENTRANCE.THEME.length].name}`);
    }

    /** 玩家进入入口 → 按类型打开房间（dialogue/shop/boss） */
    openEntrance(type: string): void {
        if (this.state !== GameState.PLAYING) return;
        const theme = ENTRANCE.THEME[this.mapIndex % ENTRANCE.THEME.length];
        console.log(`[Clownfish] 打开入口: ${theme.name} (${type})`);
        if (type === 'dialogue') {
            this._showDialogueRoom();
        } else if (type === 'shop') {
            this._showShopRoom();
        } else if (type === 'boss') {
            this._showHiddenBossRoom();
        }
    }

    // ===== 阶段2：剧情房（珊瑚礁·海葵洞·老海龟，轻剧情） =====
    private _showDialogueRoom(): void {
        const script = NPC_SCRIPT;
        this._roomState = { kind: 'dialogue', index: 0, collected: false };
        this.notify('🐢 你游进了海葵洞，看见一只老海龟……');
        // 进入房间模式：暂停普通生成（复用 spawnManager 的 bossActive 暂停）
        if (this.spawnManager) this.spawnManager.bossActive = true;
        this._renderDialogue();
    }

    private _renderDialogue(): void {
        const st = this._roomState;
        if (!st || st.kind !== 'dialogue') return;
        const script = NPC_SCRIPT;
        const line = script.lines[st.index];
        this.notify(`🐢 ${script.npc}：${line}`);
        // 下一句 / 完成
        if (st.index < script.lines.length - 1) {
            st.index++;
            // 延时继续下一句
            this.scheduleOnce(() => {
                if (this._roomState?.kind === 'dialogue') this._renderDialogue();
            }, 2.2);
        } else {
            // 对话完成：发奖励 + 关房间
            const p = this.playerController;
            if (p && !st.collected) {
                st.collected = true;
                p.addExp(script.reward.exp);
                p.coins += script.reward.coins;
                this.notify(`🎁 老海龟赠礼：经验 +${script.reward.exp}，金币 +${script.reward.coins}！`);
            }
            this.scheduleOnce(() => this._closeRoom(), 2.0);
        }
    }

    // ===== 阶段3：商店房（深海·沉船残骸·灯笼鱼商人） =====
    private _showShopRoom(): void {
        const p = this.playerController;
        if (!p) return;
        this._roomState = { kind: 'shop', index: 0, collected: false };
        if (this.spawnManager) this.spawnManager.bossActive = true;
        this.notify('🏪 你游进沉船残骸，灯笼鱼商人的灯笼亮了起来……');
        this.scheduleOnce(() => this._renderShop(), 1.2);
    }

    private _renderShop(): void {
        const p = this.playerController;
        if (!p || this._roomState?.kind !== 'shop') return;
        const avail = SHOP_ITEMS.filter(item => p.coins >= item.cost);
        if (avail.length === 0) {
            this.notify(`🏪 灯笼鱼商人：金币不够……（你有 ${p.coins} 金币）`);
            this.scheduleOnce(() => this._closeRoom(), 2.2);
            return;
        }
        // 显示商品列表（用 toast 依次展示，最后一个触发购买）
        const lines = avail.map((it, i) => `${it.icon} ${it.name}(${it.cost}金): ${it.desc}`);
        lines.push('点击屏幕任意处购买第一个商品');
        this.notify(`🏪 灯笼鱼商人：\n${lines.join('\n')}`);
        // 简易交互：当前只展示，购买逻辑由 HUD 按钮或触摸处理（阶段3扩展）
        // 这里先做展示 + 自动卖第一个买得起的
        const target = avail[0];
        if (target) {
            p.coins -= target.cost;
            this._applyShopEffect(target.effect);
            this.notify(`✅ 购买成功：${target.icon} ${target.name}（剩 ${p.coins} 金币）`);
        }
        this.scheduleOnce(() => this._closeRoom(), 2.5);
    }

    private _applyShopEffect(effect: string): void {
        const p = this.playerController;
        if (!p) return;
        switch (effect) {
            case 'hp25': p.hp = Math.min(p.maxHp, p.hp + 25); break;
            case 'boost15':
                p.boostMult = 1 + PICKUP.BOOST_SPEED_BONUS;
                p.boostTimer = PICKUP.BOOST_DURATION;
                break;
            case 'shield1': p.shield = Math.min(PICKUP.SHIELD_MAX, p.shield + 1); break;
            case 'damage15': p.bulletDamage = Math.round(p.bulletDamage * 1.15); break;
            case 'bomb1': this.detonateBomb(); break;
        }
    }

    // ===== 阶段4：隐藏Boss房（火山·熔岩裂隙·深渊熔岩怪） =====
    private _showHiddenBossRoom(): void {
        this.notify('💀 你踏进熔岩裂隙，深渊里的怪物苏醒了……');
        if (this.spawnManager) this.spawnManager.bossActive = true;
        this._roomState = { kind: 'boss', index: 0, collected: false };
        if (!this.entityManager || !this.playerController || !this.worldManager) {
            this._closeRoom();
            return;
        }
        // 生成隐藏Boss（复用 BossAI，setHidden 强化）
        const ppos = this.playerController.node.position;
        const node = new Node('HiddenBoss');
        this.entityManager.addChild(node);
        node.setPosition(ppos.x + 260, ppos.y + 60, 0); // 玩家附近偏右
        const ai = node.getComponent(BossAI) ?? node.addComponent(BossAI);
        if (ai) {
            ai.worldManager = this.worldManager;
            ai.audioManager = this.audioManager;
            ai.gameManager = this;
            ai.player = this.playerController;
            ai.entityManager = this.entityManager;
            // 用第三张图（火山）的技能组初始化，再套隐藏Boss强化
            ai.init(node.position.x, node.position.y, 2);
            ai.setHidden();
            this._hiddenBoss = ai;
        }
        // 紧凑围栏（半边长 500，压迫感更强）
        this.worldManager.spawnArena(ppos.x, ppos.y, ppos.x, ppos.y);
    }

    /** 隐藏Boss击杀（由 onBossKilled 分流）：发稀有奖励 + 关房间 */
    private _onHiddenBossKilled(): void {
        const p = this.playerController;
        if (p && this._roomState?.kind === 'boss' && !this._roomState.collected) {
            this._roomState.collected = true;
            p.addExp(HIDDEN_BOSS.REWARD_EXP);
            p.coins += HIDDEN_BOSS.REWARD_COINS;
            if (HIDDEN_BOSS.REWARD_BOMB && this.spawnManager) {
                this.spawnManager.spawnBonusGems(p.node.position.x, p.node.position.y, 40);
            }
            this.notify(`🏆 击败 ${HIDDEN_BOSS.NAME}！经验 +${HIDDEN_BOSS.REWARD_EXP}，金币 +${HIDDEN_BOSS.REWARD_COINS}！`);
        }
        this._hiddenBoss = null;
        this.scheduleOnce(() => this._closeRoom(), 2.5);
    }

    /** 关闭房间：恢复正常游戏 */
    private _closeRoom(): void {
        this._roomState = null;
        if (this.spawnManager) this.spawnManager.bossActive = false;
        this.notify('🌀 你游出入口，回到了海里的世界');
    }

    /** 当前地图对应的 BGM key（0珊瑚礁/1深海/2海底火山） */
    private _mapBgm(): 'map1_coral' | 'map2_deep' | 'map3_volcano' {
        return (['map1_coral', 'map2_deep', 'map3_volcano'] as const)[this.mapIndex % 3];
    }

    /** 通关结算（击败全部三个世界的 BOSS） */
    private _victory(): void {
        if (this.state !== GameState.PLAYING) return;
        this.state = GameState.GAMEOVER;
        this.audioManager?.gameover();
        this.audioManager?.playBgm('victory');
        this._showUI('gameover');
        this.node.emit('show-gameover', {
            time: this.playTime,
            kills: this.spawnManager?.kills || 0,
            wave: this.spawnManager?.wave || 1,
            level: this.playerController?.level || 1,
            victory: true,
        });
    }

    /** 清空场上实体（敌人/子弹/拾取物/传送门/残影） */
    private _clearEntities(): void {
        game.frameTimeScale = 1;   // 换图/重开必然终止慢动作，防止倍速泄漏到下一张图
        if (!this.entityManager) return;
        const children = this.entityManager.children.slice();
        for (const child of children) {
            child.destroy();
        }
    }

    // ===== 炸弹（绝境救赎：全屏清场小兵，精英/Boss 重创） =====

    /** 引爆炸弹：全屏冲击波视觉 + 秒杀普通敌人 + 重创精英/Boss + 经验雨。
     *  由 Pickup 拾取 bomb 时调用；爽点 = 压迫瞬间全屏清场 + 收割经验。 */
    detonateBomb(): void {
        if (this.state !== GameState.PLAYING) return;
        const bm = BOMB;

        // —— 视觉：全屏白光闪屏 + 冲击波圆环扩散（挂在 Canvas 下，UI 层可见）——
        this._showBombFx();

        // —— 音效 + 相机震动 ——
        this.audioManager?.explosion();
        this.cameraFollow?.addShake(16);

        // —— 伤害结算：遍历 EntityManager 下所有敌人 ——
        let killed = 0;
        let stunnedMsg = '';
        if (this.entityManager) {
            const children = this.entityManager.children.slice();
            const px = this.playerController?.node.position.x ?? 0;
            const py = this.playerController?.node.position.y ?? 0;
            for (const child of children) {
                // 普通敌人：秒杀（触发正常击杀掉落 → 经验雨）
                const enemy = child.getComponent(EnemyAI);
                if (enemy && enemy.node.active) {
                    // 炸弹秒杀补发经验：在触发正常击杀掉落之前，先记下 xp（倍率留给掉落）
                    const xpBonus = Math.round(enemy.xp * (BOMB.MINION_XP_MULT - 1));
                    enemy.hurtEnemy(999999, px, py);
                    if (xpBonus > 0 && this.spawnManager) {
                        // 补发额外经验宝石（掉落已在 onEnemyKilled 处理，这里补倍率差额）
                        this.spawnManager.spawnBonusGems(enemy.node.position.x, enemy.node.position.y, xpBonus);
                    }
                    killed++;
                    continue;
                }
                // 精英：重创 50% 最大生命
                const elite = child.getComponent(EliteAI);
                if (elite && elite.node.active) {
                    elite.hurtEnemy(Math.max(1, Math.round(elite.maxHp * bm.ELITE_DMG_RATIO)), px, py);
                    killed++;
                    continue;
                }
                // Boss：重创 10% 最大生命
                const boss = child.getComponent(BossAI);
                if (boss && boss.node.active) {
                    boss.hurtEnemy(Math.max(1, Math.round(boss.maxHp * bm.BOSS_DMG_RATIO)), px, py);
                    killed++;
                }
            }
        }

        this.notify(killed > 0
            ? `💣 轰——！全屏清场 ${killed} 个敌人！`
            : '💣 轰——！（附近没有敌人）');
        console.log(`[Clownfish] 炸弹引爆: 命中 ${killed} 个目标`);
    }

    /** 炸弹视觉：全屏白光闪屏 + 冲击波圆环扩散 + 碎片飞溅粒子（用 Graphics 在 Canvas 下画，UI 层可见） */
    private _showBombFx(): void {
        const canvas = this.node.scene?.getChildByName('Canvas') ?? this.node;
        if (!canvas) return;
        const bm = BOMB;

        // 1) 全屏白色闪屏（半透明白覆盖全屏，快速淡出）
        const flash = new Node('BombFlash');
        flash.layer = Layers.Enum.UI_2D;
        canvas.addChild(flash);
        flash.setSiblingIndex(canvas.children.length - 1);
        const fut = flash.addComponent(UITransform);
        const vs = view.getVisibleSize();
        fut.setContentSize(vs.width, vs.height);
        const fg = flash.addComponent(Graphics);
        fg.fillColor = new Color(255, 255, 255, 220);
        fg.rect(-vs.width / 2, -vs.height / 2, vs.width, vs.height);
        fg.fill();
        // 淡出动画
        let fAge = 0;
        const fTick = (dt: number): void => {
            // 防御：节点被外部销毁（场景切换等）时停止递归
            if (!flash.isValid) return;
            fAge += dt;
            const t = fAge / bm.SCREEN_FLASH;
            if (t >= 1) { flash.destroy(); return; }
            fg.fillColor = new Color(255, 255, 255, Math.floor(220 * (1 - t)));
            fg.rect(-vs.width / 2, -vs.height / 2, vs.width, vs.height);
            fg.fill();
            this.scheduleOnce(() => fTick(dt), dt);
        };
        fTick(0.016);

        // 2) 冲击波圆环：从玩家位置扩散（世界层，挂在 EntityManager 同层）
        const ppos = this.playerController?.node.position ?? new Node().position;
        const wave = new Node('BombWave');
        wave.setPosition(ppos.x, ppos.y, 0);
        if (this.entityManager) {
            this.entityManager.addChild(wave);
        } else {
            this.node.scene?.addChild(wave);
        }
        const wg = wave.addComponent(Graphics);
        let wAge = 0;
        const wTick = (dt: number): void => {
            // 防御：节点被外部销毁（实体清场等）时停止递归
            if (!wave.isValid) return;
            wAge += dt;
            const t = wAge / bm.SHOCKWAVE_TIME;
            if (t >= 1) { wave.destroy(); return; }
            const r = bm.SHOCKWAVE_MAX_R * (0.2 + 0.8 * t);
            wg.clear();
            wg.lineWidth = bm.SHOCKWAVE_WIDTH;
            wg.strokeColor = new Color(255, 200, 90, Math.floor(255 * (1 - t)));
            wg.circle(0, 0, r);
            wg.stroke();
            this.scheduleOnce(() => wTick(dt), dt);
        };
        wTick(0.016);

        // 3) 碎片飞溅粒子：从玩家位置向四周喷射彩色碎片（小矩形，带重力/衰减/旋转）
        this._spawnDebris(ppos.x, ppos.y);
    }

    /** 碎片飞溅粒子：爆炸时向四周喷几十颗彩色碎片，带重力下落 + 速度衰减 + 旋转，纯 Graphics 轻量实现 */
    private _spawnDebris(cx: number, cy: number): void {
        const parent = this.entityManager ?? this.node.scene;
        if (!parent) return;
        const COUNT = 36;
        const COLORS = [
            new Color(255, 160, 60, 255),   // 橙
            new Color(255, 220, 90, 255),   // 黄
            new Color(255, 100, 100, 255),  // 红
            new Color(255, 255, 255, 255),  // 白
        ];
        interface Debris { node: Node; g: Graphics; vx: number; vy: number; rot: number; life: number; maxLife: number; size: number; }
        const list: Debris[] = [];

        for (let i = 0; i < COUNT; i++) {
            const d = new Node('BombDebris');
            d.setPosition(cx, cy, 0);
            parent.addChild(d);
            const g = d.addComponent(Graphics);
            // 随机方向 + 速度 300-700
            const a = Math.random() * Math.PI * 2;
            const spd = 300 + Math.random() * 400;
            const size = 3 + Math.random() * 5;
            const maxLife = 0.5 + Math.random() * 0.4;
            const c = COLORS[Math.floor(Math.random() * COLORS.length)];
            g.fillColor = c;
            g.rect(-size / 2, -size / 2, size, size);
            g.fill();
            list.push({
                node: d, g,
                vx: Math.cos(a) * spd,
                vy: Math.sin(a) * spd - 120,  // 轻微上抛
                rot: (Math.random() - 0.5) * 720,
                life: 0,
                maxLife,
                size,
            });
        }

        // 每帧更新：重力下落 + 速度衰减 + 旋转 + 淡出销毁
        let age = 0;
        const tick = (dt: number): void => {
            age += dt;
            if (age >= 1.0) {  // 最长 1 秒自动清理（防残留）
                for (const d of list) { if (d.node.isValid) d.node.destroy(); }
                return;
            }
            for (const d of list) {
                // 防御：节点已被外部销毁（实体清场级联 destroy）时跳过，读 position 会崩
                if (!d.node.isValid) continue;
                d.life += dt;
                const t = d.life / d.maxLife;
                if (t >= 1) { if (d.node.isValid) d.node.destroy(); continue; }
                d.vy -= 700 * dt;             // 重力
                d.vx *= Math.pow(0.4, dt);    // 速度衰减
                d.vy *= Math.pow(0.4, dt);
                const p = d.node.position;
                d.node.setPosition(p.x + d.vx * dt, p.y + d.vy * dt, p.z);
                d.node.setRotationFromEuler(0, 0, d.node.eulerAngles.z + d.rot * dt);
                d.g.clear();
                d.g.fillColor = new Color(255, 255, 255, Math.floor(255 * (1 - t)));
                // 碎片缩小淡出
                const s = d.size * (1 - t * 0.7);
                d.g.rect(-s / 2, -s / 2, s, s);
                d.g.fill();
            }
            this.scheduleOnce(() => tick(dt), dt);
        };
        tick(0.016);
    }

    // ===== 通知 =====

    notify(text: string): void {
        this.node.emit('notify', text);
    }

    // ===== 主循环 =====

    update(dt: number): void {
        // 钳制 dt
        if (dt > 0.033) dt = 0.033;

        // 慢动作到点（真实时间）→ 进入冻结拍。必须放在 switch 之前：
        // 切到 REWARD 后本方法会于后续帧早退，漏检就把 frameTimeScale 永久留在 0.35
        if (this._slowMoEndAt > 0 && Date.now() >= this._slowMoEndAt) this._enterRewardFreeze();

        switch (this.state) {
            case GameState.PLAYING:
                this._updatePlaying(dt);
                break;
            case GameState.LEVELUP:
            case GameState.MENU:
                // UI 动画更新
                break;
            case GameState.REWARD:
            case GameState.GAMEOVER:
                // 相机震屏衰减（胜利瞬间的 shake(14) 要能自然停下）
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

        // 每秒心跳日志：崩溃定位（微信 dev 工具 webview 被杀后 console 会清空，
        // 心跳能确认"游戏活到了第几秒"以及实体数量是否失控增长）
        this._heartbeatAcc += dt;
        if (this._heartbeatAcc >= 1.0) {
            this._heartbeatAcc = 0;
            const entN = this.entityManager ? this.entityManager.children.length : -1;
            const wm = this.worldManager as any;
            const terrN = wm && wm._terrainNodes ? wm._terrainNodes.length : -1;
            // 实体分类计数：子弹/拾取物/敌人（追踪是否失控增长）
            let bullets = 0, pickups = 0, enemies = 0;
            if (this.entityManager) {
                for (const c of this.entityManager.children) {
                    if (!c.isValid) continue;
                    if (c.getComponent('Bullet')) bullets++;
                    else if (c.getComponent('Pickup')) pickups++;
                    else if (c.getComponent('EnemyAI') || c.getComponent('EliteAI') || c.getComponent('BossAI')) enemies++;
                }
            }
            const am = this.audioManager as any;
            const sfx1s = am && typeof am.oneShotPerSec === 'number' ? am.oneShotPerSec : -1;
            const sfxTot = am && typeof am.oneShotTotal === 'number' ? am.oneShotTotal : -1;
            console.log(`[Clownfish] PLAYING t=${this.playTime.toFixed(1)}s wave=${this.spawnManager?.wave ?? 0} entities=${entN}(bullets=${bullets} pickups=${pickups} enemies=${enemies}) terrainSprites=${terrN} sfx1s=${sfx1s} sfxTot=${sfxTot}`);
        }

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
                this._showDamagePopup(pos.x, pos.y, TERRAIN.SPIKE_DAMAGE, '⚠');
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
                this._showDamagePopup(pos.x, pos.y, TERRAIN.URCHIN_DAMAGE, '⚠');
            }
        }
    }

    /** 受伤飘字：在 (x,y) 处显示 "-N"（红色，上飘后消失），让玩家清楚看到"刚才扣了多少血" */
    private _showDamagePopup(x: number, y: number, dmg: number, prefix = ''): void {
        const parent = this.entityManager ?? this.node;
        if (!parent) return;
        const lblNode = new Node('DmgPopup');
        lblNode.setPosition(x, y + 24, 0);
        parent.addChild(lblNode);
        const label = lblNode.addComponent(Label);
        label.string = `${prefix}-${dmg}`;
        label.fontSize = 22;
        label.lineHeight = 26;
        label.color = new Color(255, 90, 70, 255);
        // 上飘 + 淡出 0.8s
        let t = 0;
        let yOff = 0; // 上飘累计位移（缓存，避免节点被销毁后读 position 崩溃）
        const tick = (dt: number): void => {
            // 防御：节点被外部销毁（关卡切换/实体清理级联 destroy）时立即停止递归
            if (!lblNode.isValid) return;
            t += dt;
            if (t >= 0.8) { lblNode.destroy(); return; }
            yOff += 30 * dt;
            lblNode.setPosition(x, y + 24 + yOff, 0);
            label.color = new Color(255, 90, 70, Math.floor(255 * (1 - t / 0.8)));
            this.scheduleOnce(() => tick(dt), dt);
        };
        tick(0.016);
    }

    /** 公开版受伤飘字（PlayerController 受击时调用，与尖刺/海胆反馈统一） */
    showDamagePopup(x: number, y: number, dmg: number, prefix = ''): void {
        this._showDamagePopup(x, y, dmg, prefix);
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
            // 冲刺强化（质变级，马里奥式：强化唯一核心动词）
            { id: 'dashCooldown', name: '疾风冲刺', desc: '冲刺冷却 -25%', icon: '💨' },
            { id: 'dashDamage', name: '雷霆冲刺', desc: '冲刺伤害 +15', icon: '⚡' },
            { id: 'dashMulti', name: '冲刺大师', desc: '冲刺冷却 -40% 且伤害 +10', icon: '🌀' },
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
