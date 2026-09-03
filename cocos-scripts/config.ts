/**
 * config.ts — 全局数值配置（唯一数据源）
 * 所有数值（属性、时间、概率）集中于此，禁止散落在业务代码中。
 * Cocos Creator 3.8.8 迁移版
 */

// ===== 渲染 =====
export const RENDER = {
    TILE_SIZE: 32,            // 地面网格瓦片尺寸(px)
    FIXED_DT: 1 / 60,         // 固定逻辑时间步长(秒)
    MAX_FRAME_DT: 0.033,      // 渲染帧最大间隔(秒)，防止切后台跳变
};

// ===== 世界 =====
export const WORLD = {
    SIZE: 4000,               // 世界边长(px)
    GRID_CELL: 128,           // 空间哈希网格单元(px)
    MAX_ENTITIES_PER_CELL: 32 // 单格实体上限（预分配）
};

// ===== 玩家 =====
export const PLAYER = {
    RADIUS: 14,
    SPEED: 260,               // 基础移动速度(px/s)
    MAX_HP: 100,
    REGEN_PER_SEC: 0,         // 基础回血(每级+0.5)
    FIRE_INTERVAL: 0.30,      // 基础射击间隔(秒)
    BULLET_SPEED: 420,
    BULLET_COUNT: 1,
    BULLET_DAMAGE: 12,
    BULLET_RANGE: 480,        // 子弹最大飞行距离(px)
    PICKUP_RANGE: 90,         // 基础拾取半径(px)
    MAGNET_BOOST: 200,        // 磁铁拾取物增幅
    INVINCIBLE_TIME: 1.0,     // 受击无敌时间(秒)
    KNOCKBACK: 180,           // 受击击退速度(px/s)
    START_X: 2000,
    START_Y: 2000
};

// ===== 普通敌人 =====
export const ENEMY = {
    RADIUS: 13,
    HP_BASE: 30,
    HP_GROWTH: 0.16,          // 每波指数成长 +16%（20波≈4.5倍）
    SPEED_BASE: 70,
    SPEED_GROWTH: 2.4,        // 每波速度增量(px/s)
    SPEED_MAX: 150,           // 速度封顶
    CONTACT_DAMAGE: 10,
    DMG_GROWTH: 0.045,        // 每波伤害成长 +4.5%
    DMG_MAX_MULT: 3.0,        // 伤害封顶（基础×3）
    XP_VALUE: 3,              // 击杀经验值
    XP_GROWTH: 0.5,           // 每波经验增量（后期升级不掉队）
    SPAWN_INTERVAL: 0.9,      // 初始生成间隔(秒)
    SPAWN_INTERVAL_MIN: 0.26, // 生成间隔下限
    SPAWN_INTERVAL_DECAY: 0.976, // 每波间隔指数衰减（20波≈0.54s）
    SPAWN_OFFSET: 80,         // 生成位置距屏幕边缘的偏移
    SPAWN_DIST: 720           // 生成距玩家距离
};

// ===== 精英敌人 =====
export const ELITE = {
    RADIUS: 22,
    HP: 400,
    HP_GROWTH: 0.30,          // 每只精英生命成长 +30%
    SPEED: 52,
    CONTACT_DAMAGE: 18,
    DMG_GROWTH: 0.03,         // 每只伤害成长 +3%
    DMG_MAX_MULT: 2.5,        // 伤害封顶
    SPAWN_INTERVAL: 30,       // 初始每30秒生成一只
    SPAWN_INTERVAL_MIN: 12,   // 后期最短间隔
    SPAWN_INTERVAL_DECAY: 0.975, // 每波精英间隔衰减（20波≈18.5s）
    LASER_WINDUP: 1.0,        // 激光预警时间(秒)
    LASER_DURATION: 0.8,      // 光束持续时间(秒)
    LASER_WIDTH: 26,          // 光束宽度(px)
    LASER_DAMAGE_PER_SEC: 45,
    LASER_MAX_RANGE: 900,
    LASER_COOLDOWN: 3.2,      // 激光冷却(秒)
    BURST_COUNT: 24,          // 死亡爆发子弹数
    BURST_SPEED: 190,
    XP_VALUE: 30,
    GOLD_VALUE: 1             // 精英专属掉落（大宝石）
};

// ===== 子弹 =====
export const BULLET = {
    RADIUS: 5,
    PIERCE_DEFAULT: 0,        // 默认穿透次数
    KNOCKBACK: 90             // 命中击退
};

// ===== 拾取物 =====
export const PICKUP = {
    GEM_RADIUS: 8,
    BIG_GEM_RADIUS: 13,
    RANGE_RADIUS: 12,
    BOOST_RADIUS: 12,
    HP_RADIUS: 10,
    HP_BIG_RADIUS: 13,
    SHIELD_RADIUS: 12,
    GEM_VALUE: 1,
    BIG_GEM_VALUE: 20,
    RANGE_BONUS: 0.25,        // 范围+25%(永久)
    BOOST_SPEED_BONUS: 0.20,  // 速度+20%
    BOOST_DURATION: 15,       // 持续15秒
    HP_AMOUNT: 12,            // 血球回复量
    HP_BIG_AMOUNT: 40,        // 大血球回复量
    SHIELD_MAX: 3,            // 护盾上限（层）
    FLY_SPEED: 520,           // 磁吸飞行速度
    FLY_ACCEL: 900,
    DESPAWN_TIME: 120,        // 拾取物消失时间(秒)
    BIG_GEM_DROP_RADIUS: 140  // 精英宝石溅射半径
};

// ===== 击杀掉落概率表 =====
export const DROP = {
    HP_CHANCE: 0.05,          // 普通敌人掉血球概率
    RANGE_CHANCE: 0.012,      // 掉磁铁（范围+25%）概率
    BOOST_CHANCE: 0.016,      // 掉加速概率
    SHIELD_CHANCE: 0.012,     // 掉护盾概率
    ELITE_HP_BIG: true,       // 精英必掉大血球
    ELITE_BONUS_CHANCE: 0.8   // 精英额外掉一个加成拾取物概率
};

// ===== 升级 =====
export const UPGRADE = {
    CHOICES: 3,               // 每次三选一
    CARD_ANIM_TIME: 0.35      // 卡牌弹入动画时长
};

// ===== 波次/难度 =====
export const WAVE = {
    DURATION: 20,             // 每波时长(秒)
    ELITE_SPAWN_INTERVAL: 30, // 精英生成间隔(秒)
    MAX_ELITES: 3,            // 场上精英数量上限（随波次提升，见 spawner）
    NOTE_EVERY: 5             // 每 N 波提示难度升级
};

// ===== 环境 =====
export const TERRAIN = {
    SPIKE_COUNT: 60,          // 尖刺数量
    SPIKE_RADIUS: 15,
    SPIKE_DAMAGE: 8,
    SPIKE_COOLDOWN: 0.8,      // 尖刺单次受伤冷却(秒)
    WALL_COUNT: 26,           // 墙数量
    WALL_MIN_LEN: 160,        // 墙最小长度
    WALL_MAX_LEN: 420,        // 墙最大长度
    WALL_THICKNESS: 18,       // 墙厚度(px)
    BOULDER_COUNT: 24,        // 圆礁石数量（圆形阻挡）
    BOULDER_RADIUS_MIN: 26,   // 礁石最小半径
    BOULDER_RADIUS_MAX: 40,   // 礁石最大半径
    CORAL_COUNT: 18,          // 珊瑚块数量（矮AABB阻挡）
    CORAL_W_MIN: 70,          // 珊瑚块最小宽度
    CORAL_W_MAX: 160,         // 珊瑚块最大宽度
    CORAL_H_MIN: 22,          // 珊瑚块最小高度
    CORAL_H_MAX: 36,          // 珊瑚块最大高度
    URCHIN_COUNT: 16,         // 海胆数量（圆形伤害）
    URCHIN_RADIUS: 15,
    URCHIN_DAMAGE: 14,        // 海胆伤害（比尖刺高）
    URCHIN_COOLDOWN: 1.0,     // 海胆受伤冷却(秒)
    DECAL_COUNT: 70,          // 海底装饰数量（珊瑚/海星/贝壳/骷髅）
    SAFE_RADIUS: 220          // 出生点周围安全区半径
};

// ===== 状态机 =====
export enum GameState {
    BOOT = 'BOOT',
    MENU = 'MENU',
    PLAYING = 'PLAYING',
    PAUSED = 'PAUSED',
    LEVELUP = 'LEVELUP',
    GAMEOVER = 'GAMEOVER'
}

// ===== 界面 =====
export const UI_CONFIG = {
    SAFE_PAD: 10,             // HUD安全边距
    DEBUG: false,             // 运行时由 GameManager 根据查询参数设置
};

// ===== 升级曲线（马里奥式：前几级快、逐级明显变慢；参考成熟游戏拉长节奏） =====
// expNeed(level) = BASE + GROWTH * level^POWER
// 校准（tools/level_sim.py，900s 一局）：首级≈14s、L5≈90s、L10≈6min、一局约 13-15 级
export const LEVELING = {
    BASE: 30,
    GROWTH: 15,
    POWER: 1.5,
};
/** 升到下一级所需经验（唯一数据源） */
export function expNeed(level: number): number {
    return Math.floor(LEVELING.BASE + LEVELING.GROWTH * Math.pow(level, LEVELING.POWER));
}

// ===== 冲刺技能（主角核心动词，混合流：自动射击打底 + 冲刺高手操作） =====
export const DASH = {
    SPEED: 880,               // 冲刺速度(px/s)
    DURATION: 0.18,           // 冲刺持续时间(秒)
    COOLDOWN: 2.2,            // 冲刺冷却(秒)
    DAMAGE: 30,               // 冲刺撞击伤害（穿过敌人）
    IFRAME: 0.4,              // 冲刺无敌帧(秒)
    HIT_RADIUS: 48,           // 冲刺撞击判定半径(px)
    TRAIL_COUNT: 6,           // 残影数量
};

// ===== 多地图（3 个世界：珊瑚礁→深海→海底火山，每图一个 BOSS，击败开传送门连通） =====
export interface MapTheme {
    id: number;
    name: string;                 // 地图名
    subtitle: string;             // 世界副标题
    bossSprite: string;           // BOSS 素材名（assets/resources/sprites/）
    bossName: string;
    bossWave: number;             // 第 N 波结束后 BOSS 登场
    bossHp: number;               // BOSS 血量
    bossSpeed: number;            // BOSS 移动速度
    bossDamage: number;           // BOSS 接触伤害
    bossBurstDamage: number;      // BOSS 环形弹幕伤害
    tiles: [number, number, number][];   // 地面配色（base + 变体）
    decals: [number, number, number][]; // 海底装饰配色
    enemies: number[];            // 该图出现的敌人类型索引（EnemyAI.TYPES）
    enemyHpMult: number;          // 敌人血量倍率
}

export const MAPS: MapTheme[] = [
    {
        id: 0, name: '珊瑚礁', subtitle: '第一世界 · 浅海', bossSprite: 'boss_crab', bossName: '巨蟹王', bossWave: 5,
        bossHp: 1200, bossSpeed: 40, bossDamage: 25, bossBurstDamage: 12,
        tiles: [[18, 70, 96], [22, 82, 112], [14, 60, 84], [28, 92, 124]],
        decals: [[90, 210, 170], [235, 130, 150], [230, 200, 110], [190, 190, 210], [130, 230, 160]],
        enemies: [0, 1], enemyHpMult: 1.0,
    },
    {
        id: 1, name: '深海', subtitle: '第二世界 · 幽暗', bossSprite: 'boss_eel', bossName: '巨鳗王', bossWave: 5,
        bossHp: 2000, bossSpeed: 46, bossDamage: 32, bossBurstDamage: 16,
        tiles: [[8, 18, 44], [12, 24, 54], [6, 14, 36], [16, 30, 62]],
        decals: [[90, 180, 240], [140, 110, 220], [60, 200, 200], [110, 130, 230], [70, 160, 220]],
        enemies: [0, 1, 2, 3], enemyHpMult: 1.5,
    },
    {
        id: 2, name: '海底火山', subtitle: '最终世界 · 深渊', bossSprite: 'boss_angler', bossName: '安康鱼王', bossWave: 6,
        bossHp: 3200, bossSpeed: 52, bossDamage: 40, bossBurstDamage: 20,
        tiles: [[40, 26, 22], [50, 34, 26], [32, 20, 18], [58, 42, 30]],
        decals: [[255, 120, 60], [240, 180, 60], [255, 90, 90], [200, 130, 60], [255, 160, 80]],
        enemies: [0, 1, 2, 3, 4], enemyHpMult: 2.2,
    },
];

// ===== BOSS（每图末尾的大 BOSS：追逐 + 周期性环形弹幕） =====
export const BOSS = {
    RADIUS: 55,
    SPEED: 40,                  // 兜底速度（实际用 MAPS[].bossSpeed）
    CONTACT_DAMAGE: 25,         // 兜底接触伤害（实际用 MAPS[].bossDamage）
    BURST_INTERVAL: 3.5,        // 环形弹幕间隔(秒)
    BURST_COUNT: 36,            // 环形弹幕子弹数
    BURST_SPEED: 200,
    BURST_RANGE: 700,           // 弹幕射程(px)
    XP_VALUE: 100,
};

// ===== 精灵素材映射（assets/resources/sprites/*.png，无扩展名） =====
export const SPRITES = {
    PLAYER: 'sprites/player_clownfish',
    ENEMIES: [
        'sprites/enemy_jellyfish',
        'sprites/enemy_crab',
        'sprites/enemy_eel',
        'sprites/enemy_puffer',
        'sprites/enemy_angler',
    ],
    BOSSES: [
        'sprites/boss_crab',
        'sprites/boss_eel',
        'sprites/boss_angler',
    ],
    PORTAL: 'sprites/portal',
};
