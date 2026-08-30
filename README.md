# Clownfish 🐟 像素肉鸽求生

H5 像素风肉鸽生存游戏（类《吸血鬼幸存者》），**零依赖、零构建、可离线、双击即玩**。

## 快速开始

### 方式一：双击运行（推荐）
直接双击 `index.html`（`file://` 协议即可运行，无需服务器）。

### 方式二：本地服务器
```bash
./serve.command        # macOS 双击或终端运行
# 或
python3 -m http.server 8000
# 浏览器访问 http://localhost:8000
```

### 方式三：部署
整个目录静态托管即可（GitHub Pages / Nginx / 微信开发者工具等）。

## 玩法

| 操作 | 说明 |
|---|---|
| 左摇杆 / WASD·方向键 | 8 方向移动 |
| 右摇杆（可选） | 手动瞄准；不操作时自动攻击最近敌人 |
| 拾取宝石 | 积累经验升级 |
| 升级 | 三选一强化，可重复叠加 |
| 回车/空格（菜单） | 开始游戏 |

> 桌面端：键盘 **WASD / 方向键** 移动，鼠标按住屏幕拖动也可模拟摇杆；移动端使用双虚拟摇杆。

- **海底世界**：深蓝水域 + 4 种地面瓦片、摇曳光柱、上浮气泡，5 种海底装饰（珊瑚/海星/贝壳/骷髅）
- **5 类障碍物**：墙体（敌人沿墙绕行）、尖刺（接触伤害）、圆礁石（物理阻挡）、珊瑚块（阻挡）、海胆（接触伤害）
- **4 种普通敌人**：不同速度/伤害/体型，随波次指数增强
- **精英敌人**：每隔 30 秒内递减登场，激光三态攻击（1s 预警 → 0.8s 光束 → 冷却），死亡圆形爆发 24 发子弹 + 必掉大血球 + 高概率额外掉落
- **怪物掉落**（击杀概率触发）：血球（+12HP，5%）、护盾（+1 层，1.2%）、攻击范围（永久，1.6%）、加速（20 秒，1.2%），另有经验宝石必掉
- **护盾机制**：最多 3 层，受击先扣盾不掉血（短无敌），HUD 蓝点显示
- **难度曲线**：每 20 秒一波；敌人血量 +16%/波、伤害 +4.5%/波（3 倍封顶）、速度递增（150 封顶）、生成间隔指数衰减（0.26s 下限）；每 5 波提示强度跃升，精英数量随波次增多

## 项目结构

```
index.html          入口（script defer 顺序加载，顺序不可调）
src/
  config.js         所有数值配置（唯一数据源）
  util.js           数学/工具函数
  sprites.js        程序化像素精灵（启动时烘焙）
  audio.js          WebAudio 合成音效（零资源）
  input.js          双虚拟摇杆（Pointer Events 多点触控）
  camera.js         相机（Lerp 跟随 + 震屏）
  world.js          4000×4000 世界、Int32Array 空间哈希、地形
  entities.js       实体注册表 + 玩家（自动攻击/升级）
  enemies.js        敌人池 + 精英激光状态机
  projectiles.js    子弹池（穿透/击退/敌弹）
  pickups.js        拾取物池（磁吸飞行）
  fx.js             粒子特效池（像素风）
  spawner.js        波次生成器（普通/精英）
  upgrades.js       升级卡池（10 种可叠加）
  ui.js             HUD + 菜单 + 升级卡 + 结算（全 Canvas）
  game.js           状态机 + 固定 60Hz 主循环
  main.js           入口（错误浮层/启动）
```

## 技术要点

- **零构建**：经典 `<script defer>` + `CF` 全局命名空间，`file://` 双击可运行（ES Modules 会因 CORS 失败）
- **固定时间步长**：60Hz 逻辑 + 渲染钳制，120Hz 屏幕不会 2 倍速
- **性能**：对象池（敌人/子弹/拾取物/粒子）、Int32Array 空间哈希网格（128px 单元，每帧重建 O(N)）、视锥剔除、DPR 封顶 2x、Canvas2D 批量 drawImage
- **移动端适配**：`viewport-fit=cover` + 安全区、防缩放/橡皮筋、44px 触控目标、iOS 音频首触解锁、切后台自动暂停
- **兼容**：ES2017 语法（无可选链/私有字段），兼容微信 X5 内核

## 调试

- 打开 `index.html?debug=1`：显示 FPS、实体数、波次、拾取范围圈
- 运行时错误以红色浮层显示在屏幕顶部
- 帧耗时超标时自动触发视觉降级（`CF.RENDER` 可调）

## 验收自测（已通过）

无头浏览器冒烟测试 20 项全部通过：地形生成（墙/刺/礁石/珊瑚/海胆/装饰）、出生安全区、难度曲线（HP/伤害/速度/间隔/精英/经验）、掉落概率与类型生成、精英保底掉落、护盾吸收、血球回复、礁石/珊瑚阻挡、海胆伤害、渲染非黑像素、零运行时异常。

## 里程碑

| 里程碑 | 内容 | 状态 |
|---|---|---|
| M0 | 骨架（入口/配置/工具） | ✅ |
| M1 | 精灵/音频/输入/相机 | ✅ |
| M2 | 世界/空间哈希/地形 | ✅ |
| M3 | 玩家/战斗核心 | ✅ |
| M4 | 敌人/波次/精英激光 | ✅ |
| M5 | 成长系统（拾取/升级/特效） | ✅ |
| M6 | 状态机/主循环/UI | ✅ |
| M7 | 文档/启动脚本/测试 | ✅ |
| M8 | 海底世界 + 掉落系统 + 难度曲线重设计 | ✅ |
| M9 | Cocos Creator 3.8.8 迁移（微信小游戏） | ✅ |

---

## Cocos Creator 3.8.8 迁移版

`src/` 目录为原始 Canvas2D 零依赖版本，`cocos-scripts/` 为 Cocos Creator 3.8.8 迁移版，目标平台**微信小游戏**。

### cocos-scripts/ 目录结构

```
cocos-scripts/
  config.ts                  所有数值配置（唯一数据源）
  util.ts                    数学/工具函数
  managers/
    GameManager.ts           状态机 + 主循环 + 全局协调
    SpawnManager.ts          波次生成 + 难度曲线 + 掉落
    AudioManager.ts          13 个音效（AudioClip → audioEngine）
    WorldManager.ts          地形生成 + Int32Array 空间哈希 + 碰撞
  components/
    PlayerController.ts      玩家行为（移动/攻击/受击/护盾/升级）
    EnemyAI.ts               普通敌人追逐 + 接触伤害
    EliteAI.ts               精英激光三态状态机（idle→windup→firing）
    Bullet.ts                子弹飞行 + 命中检测 + 穿透
    Pickup.ts                拾取物磁吸 + 效果
    Joystick.ts              双虚拟摇杆 + 键盘 WASD
    CameraFollow.ts          Lerp 平滑跟随 + 震屏
  ui/
    HUD.ts                   生命条/等级/波次/计时/经验条/护盾
    MenuUI.ts                开始菜单
    LevelUpUI.ts             升级三选一卡牌（tween 弹入动画）
    GameOverUI.ts            结算界面
    NotifyToast.ts           顶部提示（淡入淡出）
```

### 编辑器搭建指南

#### 场景节点树

```
Canvas
├── WorldNode          ← WorldManager 挂这里，地形子节点挂下面
├── EntityManager      ← 敌人/子弹/拾取物的父节点
├── FXNode             ← 粒子特效父节点
├── UIRoot
│   ├── HUD            ← HUD.ts
│   ├── MenuPanel      ← MenuUI.ts
│   ├── LevelUpPanel   ← LevelUpUI.ts
│   ├── PausePanel     ← （暂停逻辑在 GameManager 里）
│   ├── GameOverPanel  ← GameOverUI.ts
│   └── NotifyToast    ← NotifyToast.ts
├── JoystickNode       ← Joystick.ts
└── Managers           ← GameManager/SpawnManager/AudioManager/CameraFollow
```

#### 预制体（Prefab）

```
assets/prefabs/Player.prefab       → PlayerController
assets/prefabs/Enemy.prefab        → EnemyAI
assets/prefabs/Elite.prefab        → EliteAI
assets/prefabs/Bullet.prefab       → Bullet
assets/prefabs/EliteBullet.prefab  → Bullet（hostile=true）
assets/prefabs/Pickup.prefab       → Pickup
```

#### 素材命名

```
assets/resources/sprites/gem.png, bigGem.png, hpPickup.png,
  hpBigPickup.png, shieldPickup.png, rangePickup.png, boostPickup.png
assets/resources/audio/shoot.ogg, hit.ogg, kill.ogg, hurt.ogg,
  pickup.ogg, levelup.ogg, explosion.ogg, laser.ogg, laser_warn.ogg,
  burst.ogg, gameover.ogg, spike_hit.ogg（共 13 个）
```

### 微信小游戏发布步骤

1. Cocos Creator 构建面板 → 发布平台选「微信小游戏」
2. 纹理批量设置 Filter Mode = **Point**（像素风防模糊）
3. 音效用 `.ogg` 格式，PNG 用 TinyPNG 压缩
4. 主包 4MB 限制：大素材放 `subpackages/` 分包
5. 构建 → 输出到 `build/wechatgame/`
6. 微信开发者工具导入 `build/wechatgame/` → 真机预览
7. `config.ts` 中 `DEBUG` 通过 `sys.getQueryStringParams()['debug']` 控制

### 文件功能对照表（原版 → Cocos 版）

| 原文件 | Cocos 版 | 关键改动 |
|---|---|---|
| config.js | config.ts | `location.search` → `sys.getQueryStringParams()` |
| util.js | util.ts | 直接翻译为 ES Module |
| game.js | GameManager.ts | `requestAnimationFrame` → `update(dt)`；删除 Canvas 渲染 |
| spawner.js | SpawnManager.ts | `entities.create` → `instantiate(prefab)` |
| audio.js | AudioManager.ts | WebAudio Oscillator → `audioEngine.playEffect(clip)` |
| world.js | WorldManager.ts | 空间哈希保留；删除渲染；地形改为 instantiate |
| entities.js | PlayerController.ts | 删除 `renderPlayer`；移动用 `setPosition()` |
| enemies.js | EnemyAI.ts + EliteAI.ts | 删除 render；激光用 Graphics 绘制 |
| projectiles.js | Bullet.ts | 删除 render；碰撞用 `onTriggerEnter` |
| pickups.js | Pickup.ts | 删除 render；Sprite 按 type 切换 spriteFrame |
| input.js | Joystick.ts | Pointer Events → Cocos `input.on(TOUCH_*)` |
| camera.js | CameraFollow.ts | 删除 `sx/sy` 转换；震屏偏移 `camera.node.position` |
| ui.js | HUD + MenuUI + LevelUpUI + GameOverUI + NotifyToast | Canvas 绘制 → 操作 Label/ProgressBar/Button 组件 |
| sprites.js | **删除** | 编辑器挂 Sprite 组件 |
| fx.js | **删除** | Cocos ParticleSystem2D 组件 |
| main.js | **删除** | Cocos 自动加载场景 |
