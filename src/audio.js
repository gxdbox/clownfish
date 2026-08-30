/**
 * audio.js — WebAudio 合成音效（零资源，离线可用）
 * iOS 自动播放限制：首次触摸时 unlock() 创建并恢复 AudioContext。
 * 全部音效由 Oscillator + Gain 包络合成，无外部文件。
 */
(function () {
  'use strict';

  var CF = window.CF = window.CF || {};

  var ctx = null;
  var masterGain = null;
  var muted = false;
  var unlocked = false;

  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    masterGain = ctx.createGain();
    masterGain.gain.value = 0.45;
    masterGain.connect(ctx.destination);
    // 初始挂起（等待首次手势解锁）
    if (ctx.state === 'suspended') ctx.resume();
  } catch (e) {
    ctx = null; // 不支持音频时静默降级
  }

  /** 播放一个简单合成音：freq 起止、时长、音量、波形 */
  function tone(freq, endFreq, dur, vol, type, delay) {
    if (!ctx || muted) return;
    var t0 = ctx.currentTime + (delay || 0);
    var osc = ctx.createOscillator();
    var gain = ctx.createGain();
    osc.type = type || 'square';
    osc.frequency.setValueAtTime(freq, t0);
    if (endFreq && endFreq !== freq) {
      osc.frequency.exponentialRampToValueAtTime(endFreq, t0 + dur);
    }
    gain.gain.setValueAtTime(vol, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    osc.connect(gain);
    gain.connect(masterGain);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  /** 噪声音效（爆炸/命中） */
  function noise(dur, vol, delay, filterFreq) {
    if (!ctx || muted) return;
    var t0 = ctx.currentTime + (delay || 0);
    var len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    var buf = ctx.createBuffer(1, len, ctx.sampleRate);
    var data = buf.getChannelData(0);
    for (var i = 0; i < len; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    }
    var src = ctx.createBufferSource();
    src.buffer = buf;
    var filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = filterFreq || 1200;
    var gain = ctx.createGain();
    gain.gain.setValueAtTime(vol, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(masterGain);
    src.start(t0);
  }

  CF.audio = {
    get muted() { return muted; },

    /** 首次触摸解锁（iOS 必须由用户手势触发） */
    unlock: function () {
      if (!ctx || unlocked) return;
      unlocked = true;
      if (ctx.state === 'suspended') ctx.resume();
    },

    toggleMute: function () {
      muted = !muted;
      return muted;
    },

    // ===== 音效 =====
    shoot: function () { tone(880, 440, 0.08, 0.12, 'square'); },
    hit: function () { tone(220, 120, 0.06, 0.10, 'sawtooth'); },
    kill: function () { noise(0.15, 0.18, 0, 900); tone(300, 60, 0.18, 0.14, 'triangle'); },
    hurt: function () { tone(160, 70, 0.2, 0.2, 'sawtooth'); noise(0.1, 0.12, 0, 700); },
    pickup: function () { tone(660, 880, 0.07, 0.08, 'sine'); },
    levelup: function () {
      tone(523, 523, 0.1, 0.14, 'square');
      tone(659, 659, 0.1, 0.14, 'square', 0.09);
      tone(784, 784, 0.12, 0.14, 'square', 0.18);
      tone(1047, 1047, 0.22, 0.16, 'square', 0.27);
    },
    laser: function () { tone(1400, 120, 0.9, 0.10, 'sawtooth'); },
    laserWarn: function () { tone(600, 600, 0.08, 0.06, 'square'); },
    burst: function () { noise(0.4, 0.28, 0, 500); tone(200, 40, 0.4, 0.2, 'triangle'); },
    explosion: function () { noise(0.5, 0.35, 0, 400); tone(120, 30, 0.5, 0.25, 'sine'); },
    gameover: function () {
      tone(440, 440, 0.2, 0.15, 'triangle');
      tone(330, 330, 0.2, 0.15, 'triangle', 0.2);
      tone(220, 110, 0.5, 0.18, 'triangle', 0.4);
    },
    spikeHit: function () { tone(200, 90, 0.12, 0.14, 'sawtooth'); }
  };
})();
