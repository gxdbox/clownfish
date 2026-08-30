/**
 * AudioManager.ts — 音效管理 + 程序化背景音乐
 * 12 个 AudioClip 通过编辑器拖入，运行时用 AudioSource 组件播放。
 * 背景音乐：WebAudio 程序化合成海底氛围（低频 pad + 气泡 + 旋律），无需音频资源。
 * 微信小游戏：AudioSource 自动适配 wx.createInnerAudioContext。
 */
import { _decorator, Component, AudioClip, AudioSource } from 'cc';
const { ccclass, property } = _decorator;

/** 浏览器 WebAudio 类型（Cocos 工程 lib 可能不含 DOM 类型，统一用 any 兼容） */
type AnyAudioCtx = any;
type AnyGainNode = any;
type AnyOscNode = any;

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

    private _source: AudioSource | null = null;
    private _muted = false;

    // ===== 程序化 BGM（WebAudio 合成，无需音频资源） =====
    private _bgmCtx: AnyAudioCtx | null = null;
    private _bgmGain: AnyGainNode | null = null;
    private _bgmStarted = false;
    private readonly BGM_VOLUME = 0.06;

    get muted(): boolean { return this._muted; }

    onLoad(): void {
        // Cocos 3.8 已移除全局 audioEngine，统一用 AudioSource 组件播放音效
        this._source = this.node.getComponent(AudioSource) || this.node.addComponent(AudioSource);
    }

    /** 首次用户交互时解锁音频（微信小游戏需要），并启动背景音乐 */
    unlock(): void {
        this.startBgm();
    }

    toggleMute(): boolean {
        this._muted = !this._muted;
        if (this._bgmGain && this._bgmCtx) {
            this._bgmGain.gain.setTargetAtTime(this._muted ? 0 : this.BGM_VOLUME, this._bgmCtx.currentTime, 0.3);
        }
        return this._muted;
    }

    // ===== 背景音乐：海底氛围合成 =====

    /** 启动 BGM（首次用户手势时调用，满足浏览器 AudioContext 自动播放策略） */
    startBgm(): void {
        if (this._bgmStarted) return;
        this._bgmStarted = true;
        try {
            this._buildBgm();
            if (this._bgmCtx && this._bgmCtx.state === 'suspended') this._bgmCtx.resume();
        } catch (e) {
            console.warn('[Clownfish] BGM 初始化失败:', e);
        }
    }

    private _buildBgm(): void {
        const AC = (typeof window !== 'undefined' && ((window as any).AudioContext || (window as any).webkitAudioContext)) || null;
        if (!AC) return; // 微信小游戏等环境无 WebAudio：后续可接 wx.createWebAudioContext
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

    /** 播放音效（短路：静音或无 clip 时跳过） */
    private play(clip: AudioClip | null): void {
        if (this._muted || !clip || !this._source) return;
        this._source.playOneShot(clip, 0.45);
    }

    shoot(): void { this.play(this.shootClip); }
    hit(): void { this.play(this.hitClip); }
    kill(): void { this.play(this.killClip); }
    hurt(): void { this.play(this.hurtClip); }
    pickup(): void { this.play(this.pickupClip); }
    levelup(): void { this.play(this.levelupClip); }
    explosion(): void { this.play(this.explosionClip); }
    laser(): void { this.play(this.laserClip); }
    laserWarn(): void { this.play(this.laserWarnClip); }
    burst(): void { this.play(this.burstClip); }
    gameover(): void { this.play(this.gameoverClip); }
    spikeHit(): void { this.play(this.spikeHitClip); }
}
