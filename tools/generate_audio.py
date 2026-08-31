#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
generate_audio.py — 程序化合成《小丑鱼》全部音频素材（纯 Python 标准库，零第三方依赖）

输出：13 个 WAV（44.1kHz / 16bit / 单声道）到 out_dir，供 afconvert 转码 m4a 后放入
Cocos 工程 assets/resources/audio/（AudioManager 自动加载同名资源）。

设计理念（贴合海底主题）：
- shoot      水泡射击：正弦快速上滑 + 气音，像鱼儿吐泡
- hit        命中闷响：低通噪声 + 低频衰减，水下钝感
- kill       气泡爆裂：噪声爆 + 二次上滑，清脆痛快
- hurt       受伤下沉：锯齿下滑 + 噪声，低沉紧张
- pickup     水晶叮咚：高音双连 + 泛音，明亮清脆
- levelup    升级琶音：C5-E5-G5-C6 上行，欢快明亮
- explosion  海底爆炸：低通噪声轰鸣 + 55Hz 超低频
- laser      激光充能：锯齿扫频 + 颤音，高压放电感
- laser_warn 激光预警：方波三连升调，急促警报
- burst      死亡爆发：8 连爆依次衰减，弹幕齐射
- gameover   结算下行：A4-F4-D4 三音缓慢 + 回声，收束感
- spike_hit  尖刺扎到：高频锯波短刺，尖锐
- bgm        海底氛围循环 16s：A 调五声 pad + 随机气泡 + 轻旋律 + 海浪底噪
             所有频率取 16s 整数周期（220/264/297/330/396/440...），循环点无缝
"""
import math
import os
import random
import shutil
import struct
import subprocess
import wave

SR = 44100  # 采样率
random.seed(20260831)

# WAV 中间产物放系统临时目录（避免双重同名资源被误拷入 Cocos 工程造成资源名冲突）
WAV_TMP = '/tmp/clownfish_audio_wav'
M4A_OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'assets', 'resources', 'audio')


# ==================== 基础合成组件 ====================

def _env_lin(i, n, attack, release):
    """线性包络：起音 attack 秒线性上升，末尾 release 秒线性下降到 0"""
    a = int(attack * SR)
    r = int(release * SR)
    if a > 0 and i < a:
        return i / a
    if r > 0 and n - i < r:
        return (n - i) / r
    return 1.0


def tone(shape='sine', f0=440.0, f1=None, dur=0.3, amp=0.5, attack=0.005,
         release=None, vibrato_hz=0.0, vibrato_depth=0.0):
    """通用振荡器：shape ∈ sine/triangle/saw/square；f0→f1 线性扫频"""
    if f1 is None:
        f1 = f0
    if release is None:
        release = dur * 0.4
    n = int(SR * dur)
    out = []
    phase = 0.0
    for i in range(n):
        t = i / SR
        f = f0 + (f1 - f0) * (t / dur)
        if vibrato_depth > 0:
            f *= 1.0 + vibrato_depth * math.sin(2 * math.pi * vibrato_hz * t)
        phase += 2 * math.pi * f / SR
        if shape == 'sine':
            s = math.sin(phase)
        elif shape == 'triangle':
            s = 2 / math.pi * math.asin(math.sin(phase))
        elif shape == 'saw':
            s = 2 * (phase / (2 * math.pi) - math.floor(0.5 + phase / (2 * math.pi)))
        else:  # square
            s = 1.0 if math.sin(phase) >= 0 else -1.0
        out.append(s * amp * _env_lin(i, n, attack, release))
    return out


def noise(dur=0.2, amp=0.4, cutoff=4000.0, attack=0.002, release=None):
    """低通白噪声（一阶滤波），cutoff 越低越闷"""
    if release is None:
        release = dur * 0.5
    n = int(SR * dur)
    alpha = 1.0 - math.exp(-2 * math.pi * cutoff / SR)
    out = []
    y = 0.0
    for i in range(n):
        x = random.uniform(-1, 1)
        y += alpha * (x - y)
        out.append(y * amp * _env_lin(i, n, attack, release))
    return out


def add_into(buf, offset_sec, track, gain=1.0):
    """把 track 叠加到 buf 的 offset_sec 偏移位置（带增益）"""
    off = int(offset_sec * SR)
    for i, v in enumerate(track):
        j = off + i
        if j >= len(buf):
            break
        buf[j] += v * gain


def normalize(buf, peak=0.9):
    """峰值归一化到 peak"""
    m = max(1e-9, max(abs(v) for v in buf))
    k = peak / m
    return [v * k for v in buf]


def render(buf):
    """浮点列表 → int16 采样（带软削波保护）"""
    out = []
    for v in buf:
        if v > 1.0:
            v = 1.0
        elif v < -1.0:
            v = -1.0
        out.append(int(v * 32767))
    return out


def save_wav(path, samples):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with wave.open(path, 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(struct.pack('<%dh' % len(samples), *samples))


# ==================== 音效定义 ====================

def sfx_shoot():
    dur = 0.16
    buf = [0.0] * int(SR * dur)
    add_into(buf, 0.0, tone('sine', 600, 1600, 0.12, 0.5, 0.004, 0.06))       # 气泡弹芯
    add_into(buf, 0.005, noise(0.08, 0.18, 4500, 0.004, 0.05))                 # 喷出气音
    return buf


def sfx_hit():
    dur = 0.14
    buf = [0.0] * int(SR * dur)
    add_into(buf, 0.0, noise(0.07, 0.4, 900, 0.003, 0.05))                     # 闷响
    add_into(buf, 0.0, tone('sine', 180, 90, 0.1, 0.3, 0.004, 0.08))           # 低频衰减
    return buf


def sfx_kill():
    dur = 0.32
    buf = [0.0] * int(SR * dur)
    add_into(buf, 0.0, noise(0.06, 0.5, 5000, 0.003, 0.04))                    # 爆裂起始
    add_into(buf, 0.01, tone('sine', 300, 1100, 0.2, 0.42, 0.004, 0.15))       # 上滑爆泡
    add_into(buf, 0.02, tone('sine', 900, 1800, 0.18, 0.3, 0.005, 0.14))       # 二次泛音
    add_into(buf, 0.1, noise(0.05, 0.3, 3800, 0.003, 0.04))                    # 回响小爆
    return buf


def sfx_hurt():
    dur = 0.45
    buf = [0.0] * int(SR * dur)
    add_into(buf, 0.0, tone('saw', 230, 85, 0.4, 0.32, 0.008, 0.3))            # 下滑主音
    add_into(buf, 0.02, noise(0.25, 0.2, 1200, 0.005, 0.2))                    # 低沉噪声
    add_into(buf, 0.12, tone('sine', 110, 55, 0.3, 0.3, 0.01, 0.25))           # 次低频
    return buf


def sfx_pickup():
    dur = 0.28
    buf = [0.0] * int(SR * dur)
    add_into(buf, 0.0, tone('sine', 1318, 1318, 0.09, 0.4, 0.003, 0.07))       # E6 主音
    add_into(buf, 0.0, tone('sine', 2636, 2636, 0.06, 0.14, 0.003, 0.05))      # 八度泛音
    add_into(buf, 0.06, tone('sine', 1975, 1975, 0.16, 0.42, 0.003, 0.12))     # B6 回音
    add_into(buf, 0.06, tone('sine', 3950, 3950, 0.1, 0.13, 0.003, 0.08))      # 泛音
    return buf


def sfx_levelup():
    notes = [523.25, 659.25, 783.99, 1046.5]  # C5 E5 G5 C6
    dur = 0.85
    buf = [0.0] * int(SR * dur)
    for i, f in enumerate(notes):
        t = i * 0.14
        add_into(buf, t, tone('triangle', f, f, 0.3, 0.4, 0.005, 0.2))
        add_into(buf, t, tone('sine', f * 2, f * 2, 0.22, 0.1, 0.004, 0.16))   # 泛音
    add_into(buf, 0.55, tone('sine', 1046.5, 1046.5, 0.28, 0.35, 0.01, 0.25))  # 尾音保持
    return buf


def sfx_explosion():
    dur = 0.75
    buf = [0.0] * int(SR * dur)
    add_into(buf, 0.0, noise(0.55, 0.6, 2600, 0.004, 0.5))                     # 中高频爆
    add_into(buf, 0.01, noise(0.7, 0.5, 550, 0.006, 0.65))                     # 低频轰鸣
    add_into(buf, 0.03, tone('sine', 82, 41, 0.6, 0.5, 0.008, 0.55))           # 超低频冲击
    return buf


def sfx_laser():
    dur = 0.6
    buf = [0.0] * int(SR * dur)
    add_into(buf, 0.0, tone('saw', 1500, 320, dur, 0.3, 0.01, 0.5,
                            vibrato_hz=28, vibrato_depth=0.02))                # 放电扫频
    add_into(buf, 0.0, tone('sine', 3000, 900, dur, 0.12, 0.01, 0.5,
                            vibrato_hz=28, vibrato_depth=0.03))                # 高频啸声
    add_into(buf, 0.02, noise(dur * 0.8, 0.1, 7000, 0.01, dur * 0.7))          # 嘶嘶底噪
    return buf


def sfx_laser_warn():
    dur = 0.5
    buf = [0.0] * int(SR * dur)
    for i in range(3):
        t = i * 0.15
        f = 880 + i * 110  # 880 → 990 → 1100 升调
        add_into(buf, t, tone('square', f, f, 0.07, 0.34, 0.004, 0.055))
    return buf


def sfx_burst():
    dur = 0.8
    buf = [0.0] * int(SR * dur)
    for i in range(8):
        t = i * 0.085
        amp = 0.55 - i * 0.05
        add_into(buf, t, noise(0.06, amp, 3000 - i * 250, 0.003, 0.05))        # 逐发衰减
        add_into(buf, t + 0.005, tone('sine', 250 - i * 18, 80, 0.08, amp * 0.7, 0.004, 0.07))
    return buf


def sfx_gameover():
    notes = [440.0, 349.23, 293.66, 220.0]  # A4 F4 D4 A3 下行
    dur = 2.0
    buf = [0.0] * int(SR * dur)
    for i, f in enumerate(notes):
        t = i * 0.46
        add_into(buf, t, tone('triangle', f, f, 0.85, 0.36, 0.02, 0.7))
        add_into(buf, t, tone('sine', f * 2, f * 2, 0.6, 0.09, 0.01, 0.5))     # 暗淡泛音
        add_into(buf, t + 0.3, tone('triangle', f, f, 0.7, 0.14, 0.02, 0.6))   # 回声
    return buf


def sfx_spike_hit():
    dur = 0.16
    buf = [0.0] * int(SR * dur)
    add_into(buf, 0.0, tone('saw', 2100, 1300, 0.12, 0.4, 0.003, 0.1))         # 尖锐刺声
    add_into(buf, 0.0, noise(0.09, 0.28, 6500, 0.003, 0.07))                   # 高亮噪声
    add_into(buf, 0.03, tone('sine', 900, 400, 0.1, 0.25, 0.004, 0.08))        # 收紧尾音
    return buf


def sfx_click():
    """UI 点击：短促水泡"啵"，清脆不刺耳"""
    dur = 0.1
    buf = [0.0] * int(SR * dur)
    add_into(buf, 0.0, tone('sine', 1100, 1900, 0.07, 0.32, 0.002, 0.06))     # 上滑主音
    add_into(buf, 0.002, tone('sine', 2200, 2600, 0.05, 0.1, 0.002, 0.04))     # 泛音
    add_into(buf, 0.004, noise(0.03, 0.08, 6000, 0.002, 0.025))                # 轻触感
    return buf


# ==================== BGM：海底氛围无缝循环（16s） ====================

# A 调五声音阶（A C D E G）——所有频率均为 16s 整数周期，循环点相位连续
PENTA = [220.0, 264.0, 297.0, 330.0, 396.0, 440.0, 528.0, 594.0]
BGM_DUR = 16.0


def bgm_loop():
    n = int(SR * BGM_DUR)
    buf = [0.0] * n
    t_max = BGM_DUR - 1.2  # 事件最晚起始时间（保证衰减完）

    # --- 深海 pad：A2 + E3(≈) + A3 慢起长鸣 ---
    add_into(buf, 0.0, tone('sine', 110, 110, BGM_DUR, 0.10, 3.0, 2.0))
    add_into(buf, 0.0, tone('sine', 220, 220, BGM_DUR, 0.08, 3.0, 2.0))
    add_into(buf, 0.0, tone('sine', 330, 330, BGM_DUR, 0.05, 3.0, 2.0))
    add_into(buf, 0.0, tone('triangle', 55, 55, BGM_DUR, 0.07, 3.0, 2.0))      # 极低频基底

    # --- 海浪底噪：低通噪声 + 0.0625Hz 缓慢起伏（16s 整周期） ---
    wave_track = noise(BGM_DUR, 0.10, 420, 0.5, 2.0)
    for i, v in enumerate(wave_track):
        mod = 0.55 + 0.45 * math.sin(2 * math.pi * 0.0625 * i / SR)
        buf[i] += v * mod

    # --- 轻旋律：五声音阶随机漫步（三角波 + 回声） ---
    t = 1.2
    prev = 3
    while t < t_max - 0.4:
        idx = random.choice([j for j in range(len(PENTA)) if abs(j - prev) <= 2])
        prev = idx
        f = PENTA[idx]
        note_dur = 2.0 + random.random() * 1.2
        amp = 0.16
        add_into(buf, t, tone('triangle', f, f, note_dur, amp, 0.05, note_dur * 0.65))
        add_into(buf, t + 0.02, tone('sine', f * 2, f * 2, note_dur * 0.5, amp * 0.4, 0.05, note_dur * 0.4))
        add_into(buf, t + 0.55, tone('triangle', f, f, note_dur * 0.7, amp * 0.42, 0.03, note_dur * 0.5))  # 回声
        t += note_dur + 0.7

    # --- 随机气泡：正弦上滑，海底生机 ---
    bt = 0.8
    while bt < t_max:
        bob = tone('sine', random.uniform(500, 900), random.uniform(1100, 1700),
                   0.16, random.uniform(0.05, 0.09), 0.01, 0.14)
        add_into(buf, bt, bob)
        bt += 1.4 + random.random() * 3.4

    return buf


# ==================== 主流程 ====================

def main():
    # 只输出 m4a 到 assets/resources/audio/（微信小游戏原生支持，体积小）
    shutil.rmtree(M4A_OUT, ignore_errors=True)
    shutil.rmtree(WAV_TMP, ignore_errors=True)
    os.makedirs(WAV_TMP, exist_ok=True)
    os.makedirs(M4A_OUT, exist_ok=True)
    sfxs = [
        ('shoot', sfx_shoot), ('hit', sfx_hit), ('kill', sfx_kill),
        ('hurt', sfx_hurt), ('pickup', sfx_pickup), ('levelup', sfx_levelup),
        ('explosion', sfx_explosion), ('laser', sfx_laser),
        ('laser_warn', sfx_laser_warn), ('burst', sfx_burst),
        ('gameover', sfx_gameover), ('spike_hit', sfx_spike_hit),
        ('click', sfx_click),
    ]
    names = [n for n, _ in sfxs]
    for name, fn in sfxs:
        buf = normalize(fn())
        path = os.path.join(WAV_TMP, name + '.wav')
        save_wav(path, render(buf))
        print('OK', name, '%.2fs' % (len(buf) / SR))

    buf = normalize(bgm_loop())
    path = os.path.join(WAV_TMP, 'bgm.wav')
    save_wav(path, render(buf))
    print('OK bgm %.2fs (loop)' % (len(buf) / SR))
    names.append('bgm')

    # 转码 AAC/m4a（macOS 自带 afconvert；失败则保留 wav 提示手动处理）
    ok = 0
    for name in names:
        src = os.path.join(WAV_TMP, name + '.wav')
        dst = os.path.join(M4A_OUT, name + '.m4a')
        r = subprocess.run(['afconvert', '-f', 'm4af', '-d', 'aac', '-b', '96000', src, dst],
                           capture_output=True, text=True)
        if r.returncode == 0 and os.path.exists(dst):
            ok += 1
        else:
            print('FAIL 转码', name, r.stderr.strip())
    print('转码 %d/%d m4a ->' % (ok, len(names)), M4A_OUT)
    shutil.rmtree(WAV_TMP, ignore_errors=True)


if __name__ == '__main__':
    main()