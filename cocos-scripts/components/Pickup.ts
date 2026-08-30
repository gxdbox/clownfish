/**
 * Pickup.ts — 拾取物行为（磁吸飞行 + 拾取效果）
 * 挂在 Pickup 预制体上。
 * Cocos Creator 3.8.8 迁移版
 */
import { _decorator, Component, Sprite, SpriteFrame, resources, Node } from 'cc';
import { dist2, clamp } from '../util';
import { PICKUP, DROP, WORLD, GameState } from '../config';
import type { PlayerController } from './PlayerController';
const { ccclass, property } = _decorator;

@ccclass('Pickup')
export class Pickup extends Component {

    /** 玩家引用（由 SpawnManager 注入） */
    player: PlayerController | null = null;

    type = 'gem'; // gem | bigGem | hp | hpBig | shield | range | boost
    value = 0;
    private _age = 0;
    private _flying = false;
    private _active = true;

    /** 初始化拾取物 */
    init(type: string, x: number, y: number, value: number): void {
        this.type = type;
        this.value = value;
        this._age = 0;
        this._flying = false;
        this._active = true;
        this.node.setPosition(x, y, 0);
        this.node.active = true;
        this._updateSprite();
    }

    /** 根据类型切换 SpriteFrame */
    private _updateSprite(): void {
        const sprite = this.node.getComponent(Sprite);
        if (!sprite) return;
        const frameMap: Record<string, string> = {
            gem: 'sprites/gem',
            bigGem: 'sprites/bigGem',
            hp: 'sprites/hpPickup',
            hpBig: 'sprites/hpBigPickup',
            shield: 'sprites/shieldPickup',
            range: 'sprites/rangePickup',
            boost: 'sprites/boostPickup',
        };
        const path = frameMap[this.type];
        if (path) {
            resources.load(path, SpriteFrame, (err, frame) => {
                if (!err && sprite) sprite.spriteFrame = frame;
            });
        }
    }

    update(dt: number): void {
        if (!this._active) return;

        const player = this.player;
        if (!player || player.dead) return;
        // 暂停/结算时冻结（引擎自动调用本方法，需自行判断状态）
        if (player.gameManager?.state !== GameState.PLAYING) return;

        this._age += dt;
        if (this._age >= PICKUP.DESPAWN_TIME) {
            this._deactivate();
            return;
        }

        const range = player.pickupRange;
        const pos = this.node.position;
        const ppos = player.node.position;

        // 磁吸飞行
        if (this._flying) {
            const dx = ppos.x - pos.x;
            const dy = ppos.y - pos.y;
            let d = Math.sqrt(dx * dx + dy * dy);
            if (d < 1) d = 1;
            const speed = PICKUP.FLY_SPEED + PICKUP.FLY_ACCEL * (1 - d / range);
            const nx = pos.x + dx / d * speed * dt;
            const ny = pos.y + dy / d * speed * dt;
            this.node.setPosition(nx, ny, pos.z);
        } else if (dist2(pos.x, pos.y, ppos.x, ppos.y) < range * range) {
            this._flying = true;
        }

        // 拾取判定
        const rr = 14 + 10; // player radius + pickup radius (approx)
        if (dist2(pos.x, pos.y, ppos.x, ppos.y) < rr * rr) {
            this._onPickedUp(player);
        }
    }

    private _onPickedUp(player: PlayerController): void {
        this._deactivate();
        player.audioManager?.pickup();

        if (this.type === 'gem' || this.type === 'bigGem') {
            player.addExp(this.value);
        } else {
            player.applyPickup(this.type);
            const msg: Record<string, string> = {
                range: '✦ 攻击范围 +25%',
                boost: '⚡ 移动速度 +20%（15秒）',
                hp: '❤ 生命 +' + PICKUP.HP_AMOUNT,
                hpBig: '❤ 生命 +' + PICKUP.HP_BIG_AMOUNT,
                shield: '🛡 获得一层护盾'
            };
            if (player.gameManager && msg[this.type]) {
                player.gameManager.notify(msg[this.type]);
            }
        }
    }

    private _deactivate(): void {
        this._active = false;
        this.node.active = false;
    }

    /** 回收（由对象池调用） */
    recycle(): void {
        this._active = false;
    }
}
