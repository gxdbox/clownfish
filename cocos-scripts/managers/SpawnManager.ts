/**
 * SpawnManager.ts — 波次生成器（普通敌人 + 精英调度 + 难度曲线）
 * 挂在场景管理节点上。
 * 实体生成零素材可用：无预制体时动态创建节点 + 组件 + Graphics 视觉（见各组件 _ensureVisual）。
 * Cocos Creator 3.8.8 迁移版
 */
import { _decorator, Component, Node, Prefab, instantiate, view } from 'cc';
import { rand, clamp } from '../util';
import { ENEMY, ELITE, WAVE, DROP, PICKUP, WORLD, PLAYER, BOSS, MAPS, GameState, BOMB } from '../config';
import type { WorldManager } from './WorldManager';
import type { AudioManager } from './AudioManager';
import type { GameManager } from './GameManager';
import type { PlayerController } from '../components/PlayerController';
import { EnemyAI } from '../components/EnemyAI';
import { EliteAI } from '../components/EliteAI';
import { BossAI } from '../components/BossAI';
import { Portal } from '../components/Portal';
import { Pickup } from '../components/Pickup';
const { ccclass, property } = _decorator;

@ccclass('SpawnManager')
export class SpawnManager extends Component {

    // ===== 编辑器属性 =====
    @property(Prefab) enemyPrefab: Prefab | null = null;
    @property(Prefab) elitePrefab: Prefab | null = null;
    @property(Prefab) pickupPrefab: Prefab | null = null;

    // ===== 运行时引用 =====
    worldManager: WorldManager | null = null;
    audioManager: AudioManager | null = null;
    gameManager: GameManager | null = null;

    // ===== 波次状态 =====
    wave = 1;                  // 全局波次（驱动难度曲线，跨地图持续递增）
    mapWave = 0;               // 当前地图内波次（驱动 Boss 出场，换图重置）
    waveTimer = 0;
    spawnTimer = 0;
    eliteTimer = 0;
    eliteCount = 0;
    kills = 0;
    bossActive = false;        // Boss 战中：暂停普通/精英生成，聚焦战斗
    currentBoss: BossAI | null = null;

    // ===== 炸弹绝境保底 =====
    private _desperateTimer = 0;   // 场上敌人数量持续过高的计时
    private _lastEnemyCount = 0;   // 上一秒敌人数量快照（判断"没减少"）

    private _entityManager: Node | null = null;
    private _player: PlayerController | null = null;

    /** 设置引用（由 GameManager 调用） */
    setup(entityManager: Node, player: PlayerController): void {
        this._entityManager = entityManager;
        this._player = player;
    }

    /** 重置（新游戏时调用） */
    reset(): void {
        this.wave = 1;
        this.mapWave = 0;
        this.waveTimer = 0;
        this.spawnTimer = 0;
        this.eliteTimer = 0;
        this.eliteCount = 0;
        this.kills = 0;
        this.bossActive = false;
        this.currentBoss = null;
    }

    /** 换图重置（保留全局波次难度，重置本图进度与 Boss 状态） */
    resetForNewMap(): void {
        this.mapWave = 0;
        this.waveTimer = 0;
        this.spawnTimer = 0;
        this.eliteTimer = 0;
        this.eliteCount = 0;
        this.bossActive = false;
        this.currentBoss = null;
    }

    update(dt: number): void {
        // 仅 PLAYING 状态生成（引擎自动调用本方法，需自行判断状态）
        if (this.gameManager?.state !== GameState.PLAYING) return;
        if (!this._player || this._player.dead) return;

        // Boss 战：暂停普通/精英生成（聚焦战斗，避免怪物海淹没 Boss 压迫感）
        if (this.bossActive) return;

        // 波次计时
        this.waveTimer += dt;
        if (this.waveTimer >= WAVE.DURATION) {
            this.waveTimer -= WAVE.DURATION;
            this.wave++;
            this.mapWave++;
            // 每 5 波提示
            if (this.wave % WAVE.NOTE_EVERY === 0) {
                this.gameManager?.notify(`⚠ 第 ${this.wave} 波：敌人显著增强了！`);
            }
            // 波次结算：每 N 波概率掉一个炸弹（波次奖励）
            if (this.wave % BOMB.WAVE_EVERY === 0 && Math.random() < BOMB.WAVE_CHANCE) {
                this._spawnBombNearPlayer();
            }
            // Boss 出场：本图推进到指定波次后登场
            const mapIndex = this.gameManager?.mapIndex ?? 0;
            if (this.mapWave >= MAPS[mapIndex % MAPS.length].bossWave) {
                this._spawnBoss();
                return;
            }
        }

        // 绝境保底：场上敌人 ≥ 阈值 且持续未减少 → 玩家旁刷炸弹（"天降救兵"）
        this._updateDesperateBomb(dt);

        // 普通敌人生成
        this.spawnTimer -= dt;
        if (this.spawnTimer <= 0) {
            this._spawnNormal();
            this.spawnTimer = this._getSpawnInterval();
        }

        // 精英生成
        this.eliteTimer -= dt;
        if (this.eliteTimer <= 0) {
            const maxElites = this._getMaxElites();
            if (this.eliteCount < maxElites) {
                this._spawnElite();
            }
            this.eliteTimer = this._getEliteInterval();
        }
    }

    /** 普通敌人生成间隔（指数衰减） */
    private _getSpawnInterval(): number {
        return Math.max(
            ENEMY.SPAWN_INTERVAL_MIN,
            ENEMY.SPAWN_INTERVAL * Math.pow(ENEMY.SPAWN_INTERVAL_DECAY, this.wave - 1)
        );
    }

    /** 精英生成间隔（指数衰减） */
    private _getEliteInterval(): number {
        return Math.max(
            ELITE.SPAWN_INTERVAL_MIN,
            ELITE.SPAWN_INTERVAL * Math.pow(ELITE.SPAWN_INTERVAL_DECAY, this.wave - 1)
        );
    }

    /** 精英场上上限（随波次提升） */
    private _getMaxElites(): number {
        if (this.wave >= 25) return 5;
        if (this.wave >= 15) return 4;
        if (this.wave >= 8) return 3;
        return 2;
    }

    /** 生成一个普通敌人（按当前地图过滤敌人类型 + 血量倍率） */
    private _spawnNormal(): void {
        if (!this._entityManager || !this._player) return;

        const mapIndex = this.gameManager?.mapIndex ?? 0;
        const map = MAPS[mapIndex % MAPS.length];
        const pool = map.enemies; // 该图出现的敌人类型索引
        // 从玩家四周包围生成：视野边缘一圈内随机方向（不再是 720px 外的远处单点）
        const pos = this._getEncirclementPos();
        const type = pool[Math.floor(Math.random() * pool.length)];

        const node = this._createEntityNode(this.enemyPrefab, 'Enemy');
        this._entityManager.addChild(node);
        const ai = node.getComponent(EnemyAI) ?? node.addComponent(EnemyAI);
        if (ai) {
            ai.worldManager = this.worldManager;
            ai.audioManager = this.audioManager;
            ai.gameManager = this.gameManager;
            ai.player = this._player;
            ai.init(pos.x, pos.y, this.wave, type, map.enemyHpMult);
        }
    }

    /** 生成位置：玩家视野边缘一圈内随机方向（包围感），
     *  比旧 SPAWN_DIST=720（视野外远处单点）更集中、敌人可见地从四面八方压上来。 */
    private _getEncirclementPos(): { x: number; y: number } {
        const ppos = this._player!.node.position;
        const vw = view.getVisibleSize().width;
        const vh = view.getVisibleSize().height;
        // 以视野短半轴为基准 + 偏移：敌人出生即进入/贴近玩家视野
        const dist = Math.min(vw, vh) / 2 + ENEMY.SPAWN_OFFSET;
        // 围绕玩家均匀分布角度，让多只怪从不同方向包围，而不是挤在同一个方向
        const angle = Math.random() * Math.PI * 2;
        let x = ppos.x + Math.cos(angle) * dist;
        let y = ppos.y + Math.sin(angle) * dist;
        x = clamp(x, 60, WORLD.SIZE - 60);
        y = clamp(y, 60, WORLD.SIZE - 60);
        return { x, y };
    }

    // ===== 炸弹掉落（波次奖励 / 精英掉落 / 绝境保底） =====

    /** 玩家附近生成一个炸弹拾取物 */
    private _spawnBombNearPlayer(): void {
        if (!this._entityManager || !this._player) return;
        const ppos = this._player.node.position;
        // 在玩家附近随机位置（150-320px），可见可够到
        const a = Math.random() * Math.PI * 2;
        const r = 150 + Math.random() * 170;
        const x = clamp(ppos.x + Math.cos(a) * r, 60, WORLD.SIZE - 60);
        const y = clamp(ppos.y + Math.sin(a) * r, 60, WORLD.SIZE - 60);
        this._spawnPickupAt(x, y, 'bomb', 0);
        this.gameManager?.notify('💣 炸弹出现了！捡起来轰飞全场！');
        console.log(`[Clownfish] 炸弹掉落 @(${x.toFixed(0)}, ${y.toFixed(0)})`);
    }

    /** 绝境保底检测：场上敌人数量 ≥ 阈值 且 持续超过秒数没减少 → 玩家旁刷炸弹 */
    private _updateDesperateBomb(dt: number): void {
        if (!this._entityManager || !this._player) return;
        if (this.bossActive) return; // Boss 战不打乱节奏
        const count = this._countEnemies();
        // 每秒采样一次（滚动计时），判断"持续未减少"
        this._desperateTimer += dt;
        if (this._desperateTimer >= 1.0) {
            const notReduced = count >= this._lastEnemyCount;
            this._lastEnemyCount = count;
            this._desperateTimer = 0;
            if (count >= BOMB.DESPERATE_THRESHOLD && notReduced) {
                // 已经持续过阈值 + 没减少 → 触发保底
                this._spawnBombNearPlayer();
            }
        }
    }

    /** 统计场上普通+精英敌人数量（不含 Boss） */
    private _countEnemies(): number {
        if (!this._entityManager) return 0;
        let n = 0;
        for (const c of this._entityManager.children) {
            if (c.active && (c.getComponent('EnemyAI') || c.getComponent('EliteAI'))) n++;
        }
        return n;
    }

    /** 生成一个精英敌人 */
    private _spawnElite(): void {
        if (!this._entityManager || !this._player) return;

        // 精英生成距离更近：普通怪 SPAWN_DIST=720 在视野外 + 精英移速慢(52) → 提示了却长时间看不见。
        // 用视野较小半轴的 ~1.1 倍，保证生成后立即进入玩家视野。
        const vw = view.getVisibleSize().width;
        const vh = view.getVisibleSize().height;
        const dist = Math.min(vw, vh) / 2 + ENEMY.SPAWN_OFFSET;
        const pos = this._getSpawnPos(dist);
        this.eliteCount++;

        const node = this._createEntityNode(this.elitePrefab, 'Elite');
        this._entityManager.addChild(node);
        const ai = node.getComponent(EliteAI) ?? node.addComponent(EliteAI);
        if (ai) {
            ai.worldManager = this.worldManager;
            ai.audioManager = this.audioManager;
            ai.gameManager = this.gameManager;
            ai.player = this._player;
            ai.entityManager = this._entityManager;
            ai.init(pos.x, pos.y, this.eliteCount);
        }

        console.log(`[Clownfish] 精英生成 #${this.eliteCount} @(${pos.x.toFixed(0)}, ${pos.y.toFixed(0)}) 距玩家 ${dist.toFixed(0)}px`);
        this.gameManager?.notify(' 精英敌人来袭！');
    }

    /** 生成 Boss（本图第 N 波触发；需传入当前地图下标） */
    private _spawnBoss(): void {
        if (!this._entityManager || !this._player) return;
        if (this.bossActive || this.currentBoss) return;

        const mapIndex = this.gameManager?.mapIndex ?? 0;
        const pos = this._getSpawnPos();
        this.bossActive = true;

        const node = this._createEntityNode(null, 'Boss');
        this._entityManager.addChild(node);
        const ai = node.getComponent(BossAI) ?? node.addComponent(BossAI);
        if (ai) {
            ai.worldManager = this.worldManager;
            ai.audioManager = this.audioManager;
            ai.gameManager = this.gameManager;
            ai.player = this._player;
            ai.entityManager = this._entityManager;
            ai.init(pos.x, pos.y, mapIndex);
        }
        this.currentBoss = ai;
        this.audioManager?.playBgm('boss'); // BOSS 出场切换 BOSS 战音乐
        this.gameManager?.notify(`👑 ${MAPS[mapIndex % MAPS.length].name} 的 Boss 出现了！`);
    }

    /** Boss 击杀（由 GameManager 回调）：掉落 + 生成传送门 */
    onBossKilled(boss: BossAI): void {
        this.kills++;
        this.bossActive = false;
        this.currentBoss = null;

        const pos = boss.node.position;
        // 大量经验宝石 + 大血球（传送门由 GameManager 决定是否生成）
        this._spawnGems(pos.x, pos.y, 10, 120);
        this._spawnPickupAt(pos.x, pos.y, 'hpBig', 0);
    }

    /** 生成传送门（玩家接触后 advanceMap） */
    spawnPortal(x: number, y: number): void {
        if (!this._entityManager) return;
        const node = this._createEntityNode(null, 'Portal');
        this._entityManager.addChild(node);
        const portal = node.getComponent(Portal) ?? node.addComponent(Portal);
        if (portal) {
            portal.gameManager = this.gameManager;
            portal.player = this._player;
            portal.init(x, y);
        }
    }

    /** 实体节点创建：有预制体用预制体实例化，无预制体创建裸节点（组件与视觉由目标组件自举） */
    private _createEntityNode(prefab: Prefab | null, name: string): Node {
        if (prefab) return instantiate(prefab);
        const n = new Node(name);
        n.setPosition(0, 0, 0);
        return n;
    }

    /** 获取玩家周围指定距离的生成位置（默认普通怪距离） */
    private _getSpawnPos(dist = ENEMY.SPAWN_DIST): { x: number; y: number } {
        const ppos = this._player!.node.position;
        // 随机方向
        const angle = Math.random() * Math.PI * 2;
        let x = ppos.x + Math.cos(angle) * dist;
        let y = ppos.y + Math.sin(angle) * dist;
        // 约束在世界内
        x = clamp(x, 60, WORLD.SIZE - 60);
        y = clamp(y, 60, WORLD.SIZE - 60);
        return { x, y };
    }

    // ===== 击杀回调（由 GameManager 调用） =====

    /** 普通敌人击杀 */
    onEnemyKilled(enemy: EnemyAI): void {
        this.kills++;
        this._spawnGems(enemy.node.position.x, enemy.node.position.y, enemy.xp);
        this._rollDrop(enemy.node.position.x, enemy.node.position.y);
    }

    /** 精英击杀 */
    onEliteKilled(elite: EliteAI): void {
        this.kills++;
        this.eliteCount = Math.max(0, this.eliteCount - 1);

        const pos = elite.node.position;
        // 大宝石溅射
        this._spawnGems(pos.x, pos.y, 8, 90);
        // 精英必掉大血球 + 高概率额外掉落
        this._spawnBigGem(pos.x, pos.y);
        // 精英低概率掉炸弹（惊喜感）
        if (Math.random() < BOMB.ELITE_CHANCE) {
            this._spawnPickupAt(pos.x, pos.y, 'bomb', 0);
            this.gameManager?.notify('💣 精英掉落了炸弹！');
        }
    }

    /** 补发经验宝石（炸弹秒杀敌人时的倍率差额经验；按宝石价值折算数量） */
    spawnBonusGems(x: number, y: number, xp: number): void {
        if (!this._entityManager || xp <= 0) return;
        const n = Math.max(1, Math.round(xp / PICKUP.GEM_VALUE));
        // 少量溅射在敌人周围
        for (let i = 0; i < n; i++) {
            const a = Math.random() * Math.PI * 2;
            const r = Math.random() * 40;
            const gx = clamp(x + Math.cos(a) * r, 20, WORLD.SIZE - 20);
            const gy = clamp(y + Math.sin(a) * r, 20, WORLD.SIZE - 20);
            this._spawnPickupAt(gx, gy, 'gem', PICKUP.GEM_VALUE);
        }
    }

    /** 溅射生成经验宝石（零素材兼容：无 pickupPrefab 时走自举节点，不能因缺预制体而断绝经验来源） */
    private _spawnGems(x: number, y: number, count: number, radius: number = 70): void {
        if (!this._entityManager) return;
        for (let i = 0; i < count; i++) {
            const a = Math.random() * Math.PI * 2;
            const r = Math.random() * radius;
            const gx = clamp(x + Math.cos(a) * r, 20, WORLD.SIZE - 20);
            const gy = clamp(y + Math.sin(a) * r, 20, WORLD.SIZE - 20);
            this._spawnPickupAt(gx, gy, 'gem', PICKUP.GEM_VALUE);
        }
    }

    /** 概率掉落 */
    private _rollDrop(x: number, y: number): void {
        const D = DROP;
        const r = Math.random();
        if (r < D.HP_CHANCE) {
            this._spawnPickupAt(x, y, 'hp', 0);
        } else if (r < D.HP_CHANCE + D.SHIELD_CHANCE) {
            this._spawnPickupAt(x, y, 'shield', 0);
        } else if (r < D.HP_CHANCE + D.SHIELD_CHANCE + D.BOOST_CHANCE) {
            this._spawnPickupAt(x, y, 'boost', 0);
        } else if (r < D.HP_CHANCE + D.SHIELD_CHANCE + D.BOOST_CHANCE + D.RANGE_CHANCE) {
            this._spawnPickupAt(x, y, 'range', 0);
        } else if (r < D.HP_CHANCE + D.SHIELD_CHANCE + D.BOOST_CHANCE + D.RANGE_CHANCE + D.COIN_CHANCE) {
            this._spawnPickupAt(x, y, 'coin', PICKUP.COIN_VALUE);
        }
    }

    /** 精英大宝石 + 保底大血球 + 额外掉落 */
    private _spawnBigGem(x: number, y: number): void {
        this._spawnPickupAt(x, y, 'bigGem', PICKUP.BIG_GEM_VALUE);
        if (DROP.ELITE_HP_BIG) {
            this._spawnPickupAt(x, y, 'hpBig', 0);
        }
        if (Math.random() < DROP.ELITE_BONUS_CHANCE) {
            const bonus = ['range', 'boost', 'shield'][Math.floor(Math.random() * 3)];
            this._spawnPickupAt(x, y, bonus, 0);
        }
    }

    /** 生成一个拾取物 */
    private _spawnPickupAt(x: number, y: number, type: string, value: number): void {
        if (!this._entityManager || !this._player) return;
        const node = this._createEntityNode(this.pickupPrefab, 'Pickup');
        this._entityManager.addChild(node);
        const pickup = node.getComponent(Pickup) ?? node.addComponent(Pickup);
        if (pickup) {
            pickup.player = this._player;
            pickup.init(type, x, y, value);
        }
    }
}
