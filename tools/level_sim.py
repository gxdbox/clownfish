#!/usr/bin/env python3
"""
level_sim.py — 校准 clownfish 升级曲线的 headless 数值模拟
模拟：波次推进 → 生成间隔衰减 → 击杀率(受DPS与敌人HP限制) → 经验产出 → 升级时间
用于验证"几秒升一级"问题并给出合理曲线。
"""
import math

# ===== 当前游戏参数（config.ts） =====
WAVE_DUR = 20.0
SPAWN_INT0 = 0.9
SPAWN_DECAY = 0.976
SPAWN_MIN = 0.26
XP_VALUE = 3.0        # 每怪宝石数
XP_GROWTH = 0.5       # 每波增长
ENEMY_HP_BASE = 30
ENEMY_HP_GROWTH = 0.16
DPS = 12 / 0.30       # 初始 40 dps（后续升级会增加，这里保守估 40→?）
# 精英：每 30s 一只，经验 30+20(大宝石)
ELITE_INT0 = 30
ELITE_XP = 50

# 玩家 DPS 随等级提升的粗略模型：每级 +~12% DPS
def player_dps(level):
    return 40 * (1.12 ** (level - 1))

def enemy_hp(wave):
    return ENEMY_HP_BASE * (1 + ENEMY_HP_GROWTH) ** (wave - 1)

def spawn_interval(wave):
    return max(SPAWN_MIN, SPAWN_INT0 * (SPAWN_DECAY ** (wave - 1)))

def xp_per_kill(wave):
    return XP_VALUE + XP_GROWTH * (wave - 1)

def simulate(exp_need, total_sec=900, dt=0.05):
    """exp_need(level) -> 升到下一级所需经验。返回 {level: 达成时间秒}"""
    level = 1
    exp = 0.0
    need = exp_need(level)
    t = 0.0
    wave = 1
    wave_t = 0.0
    spawn_t = 0.0
    elite_t = ELITE_INT0
    level_times = {1: 0.0}
    while t < total_sec:
        t += dt
        wave_t += dt
        if wave_t >= WAVE_DUR:
            wave_t -= WAVE_DUR
            wave += 1
        # 击杀率 = min(生成率, dps/敌人HP)
        spawn_rate = 1.0 / spawn_interval(wave)
        kill_cap = player_dps(level) / enemy_hp(wave)
        kill_rate = min(spawn_rate, kill_cap)
        exp += kill_rate * xp_per_kill(wave) * dt
        # 精英经验
        elite_t -= dt
        if elite_t <= 0:
            elite_t = ELITE_INT0
            exp += ELITE_XP
        # 升级
        while exp >= need:
            exp -= need
            level += 1
            need = exp_need(level)
            level_times[level] = t
    return level, level_times

def report(name, fn):
    lv, times = simulate(fn)
    def t(n):
        return f"{times.get(n, float('nan')):.0f}s" if n in times else "—"
    print(f"{name:38} 终级={lv}  L1={t(2)} L3={t(4)} L5={t(6)} L8={t(9)} L10={t(11)} L15={t(16)} L20={t(21)}")

print("=== 曲线对比（900s=15分钟，模拟玩家DPS随等级增长） ===\n")
report("现状 8+4L (线性)", lambda L: 8 + L * 4)
report("10 + 8(L-1) + 4(L-1)^2", lambda L: math.floor(10 + 8*(L-1) + 4*(L-1)**2))
report("14 * L^1.45", lambda L: math.floor(14 * L**1.45))
report("12 * L^1.55", lambda L: math.floor(12 * L**1.55))
report("18 * L^1.5", lambda L: math.floor(18 * L**1.5))
report("20 * L^1.5", lambda L: math.floor(20 * L**1.5))
report("25 * L^1.5", lambda L: math.floor(25 * L**1.5))
print("\n注：L1 表示升到 2 级的时间；当前线上版本约 4-5s 升一级（L1~4s）。")
