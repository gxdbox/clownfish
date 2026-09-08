/**
 * AudioManager.ts — 音效管理 + 背景音乐
 * 音效：14 个 AudioClip，两种接入方式（任选其一）：
 *   1. 编辑器属性拖入（优先）；
 *   2. 自动加载：素材放入 assets/resources/audio/ 下同名文件（shoot.m4a 等），代码自动加载。
 * BGM：7 首场景曲放独立 bundle `bgm`（assets/bgm/，微信构建配置为分包，不占 4MB 主包），
 *   运行时 assetManager.loadBundle('bgm') 按需加载；素材晚到时由 _pendingBgm 补播。
 * 背景音乐：有 BGM 素材时用 AudioSource 无缝循环；无素材时回退 WebAudio 程序化合成。
 * 微信小游戏：AudioSource 自动适配 wx.createInnerAudioContext。
 */
import { _decorator, Component, AudioClip, AudioSource, Node, resources, tween, assetManager, Color, Label, Layers, sys } from 'cc';
const { ccclass, property } = _decorator;

/** 浏览器 WebAudio 类型（Cocos 工程 lib 可能不含 DOM 类型，统一用 any 兼容） */
type AnyAudioCtx = any;
type AnyGainNode = any;
type AnyOscNode = any;

/** 背景音乐场景 key（对应 bgm bundle 下的 m4a，AI 生成） */
export type BgmKey = 'menu' | 'map1_coral' | 'map2_deep' | 'map3_volcano' | 'boss' | 'victory' | 'defeat';

/** BGM key → 属性名（playBgm 用） */
const BGM_PROP: Record<BgmKey, string> = {
    menu: 'menuClip',
    map1_coral: 'map1CoralClip',
    map2_deep: 'map2DeepClip',
    map3_volcano: 'map3VolcanoClip',
    boss: 'bossClip',
    victory: 'victoryClip',
    defeat: 'defeatClip',
};

/** 自动加载表：属性名 → assets/resources/audio/ 下的文件名（编辑器拖入过的属性跳过） */
const CLIP_SOURCES: Array<[string, string]> = [
    ['shootClip', 'shoot'],
    ['hitClip', 'hit'],
    ['killClip', 'kill'],
    ['hurtClip', 'hurt'],
    ['pickupClip', 'pickup'],
    ['levelupClip', 'levelup'],
    ['explosionClip', 'explosion'],
    ['laserClip', 'laser'],
    ['laserWarnClip', 'laser_warn'],
    ['burstClip', 'burst'],
    ['gameoverClip', 'gameover'],
    ['spikeHitClip', 'spike_hit'],
    ['clickClip', 'click'],
    ['bgmClip', 'bgm'],
];

/** BGM 自动加载表：属性名 → bgm bundle 下的文件名（微信分包，运行时按需下载） */
const BGM_SOURCES: Array<[string, string]> = [
    // AI 生成的 7 首 BGM（方案A：90s 循环段 + 64k）
    ['menuClip', 'menu'],
    ['map1CoralClip', 'map1_coral'],
    ['map2DeepClip', 'map2_deep'],
    ['map3VolcanoClip', 'map3_volcano'],
    ['bossClip', 'boss'],
    ['victoryClip', 'victory'],
    ['defeatClip', 'defeat'],
];

@ccclass('AudioManager')
export class AudioManager extends Component {

    @property(AudioClip) shootClip: AudioClip | null = null;
    @property(AudioClip) hitClip: AudioClip | null = null;
    @property(AudioClip) killClip: AudioClip | null = null;
    @property(AudioClip) hurtClip: AudioClip | null = null;
    @property(AudioClip) pickupClip: AudioClip | null = null;
    @property(AudioClip) levelupClip: AudioClip | null = null;
    @property(AudioClip) explosionClip: AudioClip | null = null;
    @property(AudioClip) laserClip: AudioClip | null = null;
    @property(AudioClip) laserWarnClip: AudioClip | null = null;
    @property(AudioClip) burstClip: AudioClip | null = null;
    @property(AudioClip) gameoverClip: AudioClip | null = null;
    @property(AudioClip) spikeHitClip: AudioClip | null = null;
    @property(AudioClip) clickClip: AudioClip | null = null;
    @property(AudioClip) bgmClip: AudioClip | null = null;
    // AI 生成的 7 首 BGM
    @property(AudioClip) menuClip: AudioClip | null = null;
    @property(AudioClip) map1CoralClip: AudioClip | null = null;
    @property(AudioClip) map2DeepClip: AudioClip | null = null;
    @property(AudioClip) map3VolcanoClip: AudioClip | null = null;
    @property(AudioClip) bossClip: AudioClip | null = null;
    @property(AudioClip) victoryClip: AudioClip | null = null;
    @property(AudioClip) defeatClip: AudioClip | null = null;

    private _source: AudioSource | null = null;      // 音效播放器（低频 one-shot）
    private _bgmSource: AudioSource | null = null;   // BGM 播放器（独立子节点，循环）
    private _muted = false;
    private _hardMute = false;       // audioMute=1 查询参数硬静音（A/B 验证音频是否崩溃诱因）
    private _lastPlay: Record<string, number> = {};  // 音效节流时间戳（防连击爆音）

    // ===== 高频音效持久源池（微信端每次 playOneShot = 新建一个 innerAudioContext，
    // 玩家 0.3s 自动射击 + 命中/击杀音效 → 每分钟数百次 create/destroy context，
    // 是"玩几分钟后 webview 被静默杀掉"的头号嫌疑。持久源 = clip 只加载一次，之后
    // stop()+play() 复用同一 context，把 churn 从 O(次数) 降到 O(1)） =====
    private _persistSources: Map<string, AudioSource> = new Map();

    // ===== 音频链路诊断计数（GameManager 心跳日志输出） =====
    private _oneShotTotal = 0;        // 累计 playOneShot 次数
    private _oneShotPerSec = 0;       // 上一秒 playOneShot 次数（心跳展示）
    private _lastOneShotSnapshot = 0; // 上一秒快照（滚动计算 perSec）
    private _diagAcc = 0;             // 秒级滚动计时

    // ===== 程序化 BGM 回退（WebAudio 合成，仅无 bgm 素材时启用） =====
    private _bgmCtx: AnyAudioCtx | null = null;
    private _bgmGain: AnyGainNode | null = null;
    private _bgmStarted = false;
    private _currentBgm: BgmKey | null = null; // 当前正在播的 BGM
    private _pendingBgm: BgmKey | null = null; // 素材未加载完成时挂起的待播 BGM
    private readonly BGM_VOLUME = 0.06;

    get muted(): boolean { return this._muted; }

    /** 上一秒 playOneShot 次数（心跳诊断） */
    get oneShotPerSec(): number { return this._oneShotPerSec; }
    /** 累计 playOneShot 次数（心跳诊断） */
    get oneShotTotal(): number { return this._oneShotTotal; }

    onLoad(): void {
        // audioMute=1 硬静音开关（A/B 验证音频是否崩溃诱因：`...?audioMute=1` 启动）
        try {
            const getParam = (sys as any).getParameterByName;
            if (typeof getParam === 'function' && getParam('audioMute') === '1') {
                this._hardMute = true;
                console.warn('[Clownfish] audioMute=1 硬静音模式：全部音频链路短路，用于验证音频是否崩溃诱因');
            }
        } catch { /* 忽略 */ }

        // Cocos 3.8 已移除全局 audioEngine，统一用 AudioSource 组件播放音效
        this._source = this.node.getComponent(AudioSource) || this.node.addComponent(AudioSource);
        // BGM 专用 AudioSource（独立子节点，避免与音效 one-shot 相互干扰）
        let bgmNode = this.node.getChildByName('BGMAudio');
        if (!bgmNode) {
            bgmNode = new Node('BGMAudio');
            this.node.addChild(bgmNode);
        }
        this._bgmSource = bgmNode.getComponent(AudioSource) || bgmNode.addComponent(AudioSource);
        this._bgmSource.loop = true;
        // 自动加载音效素材（assets/resources/audio/ 同名文件，编辑器拖入过的属性优先跳过）
        for (const [key, name] of CLIP_SOURCES) {
            if ((this as any)[key]) continue;
            resources.load(`audio/${name}`, AudioClip, (err, clip) => {
                if (err || !clip) return;
                this._onClipLoaded(key, clip);
            });
        }
        // BGM 走独立 bundle：微信构建中该 bundle 配置为分包（compressionType.wechatgame=subpackage），
        // 7 首曲不进 4MB 主包，运行时先 wx.loadSubpackage 按需下载；web/编辑器下即普通 bundle。
        assetManager.loadBundle('bgm', (err, bundle) => {
            if (err || !bundle) {
                console.warn('[Clownfish] bgm bundle 加载失败，BGM 回退程序化合成/静音:', err && err.message);
                return;
            }
            let loadedCount = 0;
            const total = BGM_SOURCES.length;
            let firstErr = '';
            for (const [key, name] of BGM_SOURCES) {
                if ((this as any)[key]) { loadedCount++; continue; }
                bundle.load(name, AudioClip, (err2, clip) => {
                    if (err2 || !clip) {
                        if (!firstErr) firstErr = err2 && err2.message ? String(err2.message) : name;
                        return;
                    }
                    loadedCount++;
                    this._onClipLoaded(key, clip);
                    if (loadedCount === total) {
                        console.log(`[Clownfish] bgm 分包 7 首 BGM 全部加载成功`);
                    }
                });
            }
            // 分包加载完成回调兜底：全部失败时明确提示（用于区分"分包没放 m4a"与"加载异常"）
            const bAny = bundle as any;
            if (bAny && typeof bAny.loadSubpackage === 'function') {
                bAny.loadSubpackage(() => {
                    if (loadedCount === 0) {
                        console.error(`[Clownfish] bgm 分包加载完成但 0 首音频可用（首错=${firstErr}）——请检查构建产物 subpackages/bgm 是否含 m4a`);
                    }
                }, (e: any) => {
                    console.error('[Clownfish] bgm 分包下载失败:', e && e.message);
                });
            }
        });
    }

    /** clip 加载完成：挂到属性；若正是当前挂起的待播 BGM 立即补播 */
    private _onClipLoaded(key: string, clip: AudioClip): void {
        (this as any)[key] = clip;
        // BGM 素材晚到时补播：若正是当前挂起的待播曲，立即切换
        const bgmKey = this._bgmKeyOfProp(key);
        if (bgmKey && this._bgmStarted && this._pendingBgm === bgmKey) {
            this.playBgm(bgmKey);
        }
    }

    /** 首次用户交互时解锁音频（微信小游戏需要），并播默认主菜单 BGM */
    unlock(): void {
        if (this._hardMute) return;
        if (this._bgmStarted) return;
        this._bgmStarted = true;
        this.playBgm('menu');
    }

    /**
     * 背景音乐切换：切到指定场景曲（loop + 淡入）。
     * 素材未加载完成时挂起（_pendingBgm），加载回调会自动补播。
     * 没有任何 AI 素材且 WebAudio 可用时，回退程序化合成的氛围 BGM 兜底。
     */
    playBgm(key: BgmKey): void {
        if (!key || this._hardMute) return;
        this._bgmStarted = true;
        if (key === this._currentBgm) { this._pendingBgm = null; return; }
        this._pendingBgm = key;
        const clip = this._bgmClipOf(key);
        if (!clip) {
            // 素材未加载完成：等加载回调补播；WebAudio 可用时先合成氛围兜底
            if (!this._bgmCtx) {
                try {
                    this._buildBgm();
                    if (this._bgmCtx && this._bgmCtx.state === 'suspended') this._bgmCtx.resume();
                } catch (e) {
                    console.warn('[Clownfish] BGM 兜底初始化失败:', e);
                }
            }
            return;
        }
        this._pendingBgm = null;
        this._currentBgm = key;
        this._playBgmClip(clip);
    }

    private _bgmClipOf(key: BgmKey): AudioClip | null {
        return (this as any)[BGM_PROP[key]] ?? null;
    }

    private _bgmKeyOfProp(prop: string): BgmKey | null {
        for (const k in BGM_PROP) {
            if (BGM_PROP[k as BgmKey] === prop) return k as BgmKey;
        }
        return null;
    }

    /** 播放指定 BGM clip：loop + 淡入 */
    private _playBgmClip(clip: AudioClip): void {
        if (!clip) return;
        try {
            // 换歌 = 销毁旧 BGMAudio 节点 + 重建全新 AudioSource：
            // 1) 避免 stop() 后 m4a 触发 seek(0)（微信 dev 工具反复 stop/seek 不稳）
            // 2) 引擎 clip 切换时本来就重建 player，主动销毁更干净
            const oldNode = this.node.getChildByName('BGMAudio');
            if (oldNode) {
                tween(this._bgmSource).stop();
                oldNode.destroy(); // 引擎会在帧末释放其 innerAudioContext
            }
            const bgmNode = new Node('BGMAudio');
            this.node.addChild(bgmNode);
            const src = bgmNode.addComponent(AudioSource);
            this._bgmSource = src;
            src.clip = clip;
            src.loop = true;
            src.volume = 0;
            console.log(`[Clownfish] BGM play: ${clip.name || clip.uuid}`);
            src.play();
            tween(src)
                .to(0.6, { volume: this._muted ? 0 : 0.5 }, { easing: 'quadOut' })
                .start();
        } catch (e) {
            // 微信 dev 工具/真机 AudioSource 播放异常不应拖垮整局（静音继续）
            const msg = e instanceof Error ? e.message : String(e);
            console.error('[Clownfish] BGM 播放异常:', msg);
            this._showAudioTip('BGM播放异常 ' + msg);
        }
    }

    /** BGM 播放异常上屏提示（不打断游戏，仅提示便于截图反馈） */
    private _showAudioTip(msg: string): void {
        try {
            const scene = this.node.scene;
            const canvas = scene?.getChildByName('Canvas') ?? undefined;
            const parent = canvas ?? this.node;
            let tip = parent.getChildByName('AudioTip');
            if (!tip) {
                tip = new Node('AudioTip');
                tip.layer = Layers.Enum.UI_2D;
                tip.setPosition(0, -260, 0);
                parent.addChild(tip);
                const label = tip.addComponent(Label);
                label.fontSize = 18;
                label.color = new Color(255, 150, 90, 255);
                label.overflow = Label.Overflow.RESIZE_HEIGHT;
                label.enableWrapText = true;
            }
            const label = tip.getComponent(Label);
            if (label) label.string = msg.slice(0, 200);
        } catch { /* 提示失败忽略 */ }
    }

    toggleMute(): boolean {
        this._muted = !this._muted;
        if (this._bgmSource) {
            this._bgmSource.volume = this._muted ? 0 : 0.5;
        }
        if (this._bgmGain && this._bgmCtx) {
            this._bgmGain.gain.setTargetAtTime(this._muted ? 0 : this.BGM_VOLUME, this._bgmCtx.currentTime, 0.3);
        }
        return this._muted;
    }

    // ===== 背景音乐 =====

    private _buildBgm(): void {
        const AC = (typeof window !== 'undefined' && ((window as any).AudioContext || (window as any).webkitAudioContext)) || null;
        if (!AC) return; // 微信小游戏等环境无 WebAudio：使用 bgmClip 素材或静音
        const ctx: AnyAudioCtx = new AC();
        this._bgmCtx = ctx;

        const master: AnyGainNode = ctx.createGain();
        master.gain.value = this._muted ? 0 : this.BGM_VOLUME;
        master.connect(ctx.destination);
        this._bgmGain = master;

        this._schedulePad(ctx, master);
        this._scheduleMelody(ctx, master);
        this._scheduleBubbles(ctx, master);
    }

    /** 深海低频 pad：两个失谐正弦叠加 + 缓慢呼吸 LFO */
    private _schedulePad(ctx: AnyAudioCtx, out: AnyGainNode): void {
        const g: AnyGainNode = ctx.createGain();
        g.gain.value = 0.55;
        g.connect(out);
        const o1: AnyOscNode = ctx.createOscillator();
        o1.type = 'sine';
        o1.frequency.value = 55;
        const o2: AnyOscNode = ctx.createOscillator();
        o2.type = 'sine';
        o2.frequency.value = 55.6;
        o1.connect(g);
        o2.connect(g);
        // 呼吸感：低频 LFO 调制音量
        const lfo: AnyOscNode = ctx.createOscillator();
        lfo.frequency.value = 0.08;
        const lfoGain: AnyGainNode = ctx.createGain();
        lfoGain.gain.value = 0.22;
        lfo.connect(lfoGain);
        lfoGain.connect(g.gain);
        o1.start();
        o2.start();
        lfo.start();
    }

    /** 缓慢旋律：五声音阶长音（A3 C4 D4 E4 G4 A4）随机漫步 */
    private _scheduleMelody(ctx: AnyAudioCtx, out: AnyGainNode): void {
        const notes = [220, 261.6, 293.7, 329.6, 392, 440];
        const loop = (): void => {
            if (this._muted) { setTimeout(loop, 1000); return; }
            const t = ctx.currentTime;
            const f = notes[Math.floor(Math.random() * notes.length)];
            const dur = 3 + Math.random() * 2;
            const o: AnyOscNode = ctx.createOscillator();
            o.type = 'triangle';
            o.frequency.setValueAtTime(f, t);
            const g: AnyGainNode = ctx.createGain();
            g.gain.setValueAtTime(0, t);
            g.gain.linearRampToValueAtTime(0.045, t + 1.2);
            g.gain.linearRampToValueAtTime(0.0001, t + dur);
            o.connect(g);
            g.connect(out);
            o.start(t);
            o.stop(t + dur + 0.1);
            setTimeout(loop, dur * 1000 + 900);
        };
        loop();
    }

    /** 随机气泡：短促正弦上滑音 */
    private _scheduleBubbles(ctx: AnyAudioCtx, out: AnyGainNode): void {
        const loop = (): void => {
            if (this._muted) { setTimeout(loop, 1000); return; }
            const t = ctx.currentTime;
            const dur = 0.1 + Math.random() * 0.15;
            const base = 700 + Math.random() * 900;
            const o: AnyOscNode = ctx.createOscillator();
            o.type = 'sine';
            o.frequency.setValueAtTime(base, t);
            o.frequency.exponentialRampToValueAtTime(base * 1.8, t + dur);
            const g: AnyGainNode = ctx.createGain();
            g.gain.setValueAtTime(0, t);
            g.gain.linearRampToValueAtTime(0.035, t + 0.012);
            g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
            o.connect(g);
            g.connect(out);
            o.start(t);
            o.stop(t + dur);
            setTimeout(loop, 1500 + Math.random() * 4500);
        };
        loop();
    }

    /**
     * 播放低频音效（one-shot，走 playOneShot）。
     * 微信端每次 playOneShot 都会新建一个 innerAudioContext，
     * 仅用于低频事件（升级/爆炸/激光/点击等），高频音效走 playPersist。
     */
    private play(key: string, clip: AudioClip | null, gap = 0): void {
        if (this._muted || this._hardMute || !clip || !this._source) return;
        const now = Date.now();
        if (gap > 0 && now - (this._lastPlay[key] || 0) < gap * 1000) return;
        this._lastPlay[key] = now;
        try {
            this._oneShotTotal++;
            this._source.playOneShot(clip, 0.45);
        } catch (e) {
            console.error('[Clownfish] SFX 播放异常:', e instanceof Error ? e.message : String(e));
        }
    }

    /**
     * 播放高频音效（持久源复用）：为每个高频音效维护一个专用 AudioSource，
     * clip 只 set 一次（引擎只新建一次 innerAudioContext），之后 stop()+play() 复用同一 context。
     * 把"射击/命中/击杀/拾取"这类高频音效的 context 创建次数从 O(次数) 降到 O(1)，
     * 消除"玩几分钟后 innerAudioContext 高频 churn 拖垮微信 webview"的头号嫌疑。
     */
    private playPersist(key: string, clip: AudioClip | null, gap = 0): void {
        if (this._muted || this._hardMute || !clip) return;
        const now = Date.now();
        if (gap > 0 && now - (this._lastPlay[key] || 0) < gap * 1000) return;
        this._lastPlay[key] = now;
        try {
            let src = this._persistSources.get(key);
            if (!src) {
                const n = new Node('Sfx_' + key);
                this.node.addChild(n);
                src = n.addComponent(AudioSource);
                src.loop = false;
                src.clip = clip; // 首次 set clip → 引擎加载一次 → 一个 innerAudioContext
                this._persistSources.set(key, src);
                src.play(); // 首次：排队等 clip 加载后自动播
                return;
            }
            // 重播：仅当正在播才先 stop（复用同一 context，不新建）
            if (src.playing) src.stop();
            src.play();
        } catch (e) {
            console.error('[Clownfish] SFX 播放异常:', e instanceof Error ? e.message : String(e));
        }
    }

    /** 每帧诊断滚动：统计上一秒 playOneShot 次数（供 GameManager 心跳输出） */
    update(dt: number): void {
        if (this._hardMute) return;
        this._diagAcc += dt;
        if (this._diagAcc >= 1.0) {
            this._diagAcc = 0;
            // 从累计计数推算出"上一秒新增"量：存一个快照在字段里
            const prev = this._lastOneShotSnapshot;
            const cur = this._oneShotTotal;
            this._oneShotPerSec = cur - prev;
            this._lastOneShotSnapshot = cur;
        }
    }

    // ===== 音效 API =====
    // 高频（持久源复用，降低 innerAudioContext churn）：射击/命中/击杀/受击/拾取/尖刺/冲刺
    shoot(): void { this.playPersist('shoot', this.shootClip, 0.08); }
    hit(): void { this.playPersist('hit', this.hitClip, 0.08); }
    kill(): void { this.playPersist('kill', this.killClip, 0.12); }
    hurt(): void { this.playPersist('hurt', this.hurtClip, 0.12); }
    pickup(): void { this.playPersist('pickup', this.pickupClip, 0.08); }
    spikeHit(): void { this.playPersist('spikeHit', this.spikeHitClip, 0.12); }
    dash(): void { this.playPersist('shoot', this.shootClip, 0.08); }
    // 低频（one-shot）：升级/爆炸/激光/激光预警/爆发/结算/点击
    levelup(): void { this.play('levelup', this.levelupClip); }
    explosion(): void { this.play('explosion', this.explosionClip); }
    laser(): void { this.play('laser', this.laserClip); }
    laserWarn(): void { this.play('laserWarn', this.laserWarnClip); }
    burst(): void { this.play('burst', this.burstClip); }
    gameover(): void { this.play('gameover', this.gameoverClip); }
    click(): void { this.play('click', this.clickClip, 0.04); }
}