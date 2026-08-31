/**
 * SpawnManager.ts — 波次生成器（普通敌人 + 精英调度 + 难度曲线）
 * 挂在场景管理节点上。
 * 实体生成零素材可用：无预制体时动态创建节点 + 组件 + Graphics 视觉（见各组件 _ensureVisual）。
 * Cocos Creator 3.8.8 迁移版
 */
import { _decorator, Component, Node, Prefab, instantiate, view } from 'cc';
import { rand, clamp } from '../util';
import { ENEMY, ELITE, WAVE, DROP, PICKUP, WORLD, PLAYER, GameState } from '../config';
import type { WorldManager } from './WorldManager';
import type { AudioManager } from './AudioManager';
import type { GameManager } from './GameManager';
import type { PlayerController } from '../components/PlayerController';
import { EnemyAI } from '../components/EnemyAI';
import { EliteAI } from '../components/EliteAI';
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
    wave = 1;
    waveTimer = 0;
    spawnTimer = 0;
    eliteTimer = 0;
    eliteCount = 0;
    kills = 0;

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
        this.waveTimer = 0;
        this.spawnTimer = 0;
        this.eliteTimer = 0;
        this.eliteCount = 0;
        this.kills = 0;
    }

    update(dt: number): void {
        // 仅 PLAYING 状态生成（引擎自动调用本方法，需自行判断状态）
        if (this.gameManager?.state !== GameState.PLAYING) return;
        if (!this._player || this._player.dead) return;

        // 波次计时
        this.waveTimer += dt;
        if (this.waveTimer >= WAVE.DURATION) {
            this.waveTimer -= WAVE.DURATION;
            this.wave++;
            // 每 5 波提示
            if (this.wave % WAVE.NOTE_EVERY === 0) {
                this.gameManager?.notify(`⚠ 第 ${this.wave} 波：敌人显著增强了！`);
            }
        }

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

    /** 生成一个普通敌人 */
    private _spawnNormal(): void {
        if (!this._entityManager || !this._player) return;

        const pos = this._getSpawnPos();
        const type = Math.floor(Math.random() * 4);

        const node = this._createEntityNode(this.enemyPrefab, 'Enemy');
        this._entityManager.addChild(node);
        const ai = node.getComponent(EnemyAI) ?? node.addComponent(EnemyAI);
        if (ai) {
            ai.worldManager = this.worldManager;
            ai.audioManager = this.audioManager;
            ai.gameManager = this.gameManager;
            ai.player = this._player;
            ai.init(pos.x, pos.y, this.wave, type);
        }
    }

    /** 生成一个精英敌人 */
    private _spawnElite(): void {
        if (!this._entityManager || !this._player) return;

        const pos = this._getSpawnPos();
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

        this.gameManager?.notify(' 精英敌人来袭！');
    }

    /** 实体节点创建：有预制体用预制体实例化，无预制体创建裸节点（组件与视觉由目标组件自举） */
    private _createEntityNode(prefab: Prefab | null, name: string): Node {
        if (prefab) return instantiate(prefab);
        const n = new Node(name);
        n.setPosition(0, 0, 0);
        return n;
    }

    /** 获取屏幕边缘外的生成位置 */
    private _getSpawnPos(): { x: number; y: number } {
        const ppos = this._player!.node.position;
        const vw = view.getVisibleSize().width;
        const vh = view.getVisibleSize().height;
        const halfW = vw / 2 + ENEMY.SPAWN_OFFSET;
        const halfH = vh / 2 + ENEMY.SPAWN_OFFSET;

        // 随机方向
        const angle = Math.random() * Math.PI * 2;
        const dist = ENEMY.SPAWN_DIST;
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
    }

    /** 溅射生成经验宝石 */
    private _spawnGems(x: number, y: number, count: number, radius: number = 70): void {
        if (!this.pickupPrefab || !this._entityManager) return;
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
