/**
 * AudioManager.ts — 音效管理 + 背景音乐
 * 14 个 AudioClip：12 个音效 + click + 1 个 BGM，两种接入方式（任选其一）：
 *   1. 编辑器属性拖入（优先）；
 *   2. 自动加载：素材放入 assets/resources/audio/ 下同名文件（shoot.m4a 等），代码自动加载。
 * 背景音乐：有 bgmClip 素材时用 AudioSource 无缝循环；无素材时回退 WebAudio 程序化合成。
 * 微信小游戏：AudioSource 自动适配 wx.createInnerAudioContext。
 */
import { _decorator, Component, AudioClip, AudioSource, Node, resources } from 'cc';
const { ccclass, property } = _decorator;

/** 浏览器 WebAudio 类型（Cocos 工程 lib 可能不含 DOM 类型，统一用 any 兼容） */
type AnyAudioCtx = any;
type AnyGainNode = any;
type AnyOscNode = any;

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

    private _source: AudioSource | null = null;      // 音效播放器
    private _bgmSource: AudioSource | null = null;   // BGM 播放器（独立子节点，循环）
    private _muted = false;
    private _lastPlay: Record<string, number> = {};  // 音效节流时间戳（防连击爆音）

    // ===== 程序化 BGM 回退（WebAudio 合成，仅无 bgm 素材时启用） =====
    private _bgmCtx: AnyAudioCtx | null = null;
    private _bgmGain: AnyGainNode | null = null;
    private _bgmStarted = false;
    private readonly BGM_VOLUME = 0.06;

    get muted(): boolean { return this._muted; }

    onLoad(): void {
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
        // 自动加载素材（assets/resources/audio/ 同名文件，编辑器拖入过的属性优先跳过）
        for (const [key, name] of CLIP_SOURCES) {
            if ((this as any)[key]) continue;
            resources.load(`audio/${name}`, AudioClip, (err, clip) => {
                if (err || !clip) return;
                (this as any)[key] = clip;
                // BGM 素材晚到时补播（玩家已解锁过音频）
                if (key === 'bgmClip' && this._bgmStarted && this._bgmSource && !this._bgmSource.playing) {
                    this._playBgmClip();
                }
            });
        }
    }

    /** 首次用户交互时解锁音频（微信小游戏需要），并启动背景音乐 */
    unlock(): void {
        this.startBgm();
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

    /** 启动 BGM：优先素材循环播放，无素材时 WebAudio 合成（首次用户手势时调用） */
    startBgm(): void {
        if (this._bgmStarted) return;
        this._bgmStarted = true;
        if (this.bgmClip) {
            this._playBgmClip();
            return;
        }
        try {
            this._buildBgm();
            if (this._bgmCtx && this._bgmCtx.state === 'suspended') this._bgmCtx.resume();
        } catch (e) {
            console.warn('[Clownfish] BGM 初始化失败:', e);
        }
    }

    private _playBgmClip(): void {
        if (!this._bgmSource || !this.bgmClip) return;
        this._bgmSource.clip = this.bgmClip;
        this._bgmSource.volume = this._muted ? 0 : 0.5;
        this._bgmSource.play();
    }

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

    /** 播放音效（短路：静音、无 clip、节流期内则跳过） */
    private play(key: string, clip: AudioClip | null, gap = 0): void {
        if (this._muted || !clip || !this._source) return;
        const now = Date.now();
        if (gap > 0 && now - (this._lastPlay[key] || 0) < gap * 1000) return;
        this._lastPlay[key] = now;
        this._source.playOneShot(clip, 0.45);
    }

    shoot(): void { this.play('shoot', this.shootClip, 0.05); }
    hit(): void { this.play('hit', this.hitClip, 0.06); }
    kill(): void { this.play('kill', this.killClip, 0.1); }
    hurt(): void { this.play('hurt', this.hurtClip, 0.12); }
    pickup(): void { this.play('pickup', this.pickupClip, 0.05); }
    levelup(): void { this.play('levelup', this.levelupClip); }
    explosion(): void { this.play('explosion', this.explosionClip); }
    laser(): void { this.play('laser', this.laserClip); }
    laserWarn(): void { this.play('laserWarn', this.laserWarnClip); }
    burst(): void { this.play('burst', this.burstClip); }
    gameover(): void { this.play('gameover', this.gameoverClip); }
    spikeHit(): void { this.play('spikeHit', this.spikeHitClip, 0.12); }
    click(): void { this.play('click', this.clickClip, 0.04); }
    dash(): void { this.play('shoot', this.shootClip, 0.02); }
}