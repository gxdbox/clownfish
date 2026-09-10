/**
 * SlotMachine.ts — Boss 胜利战利品（老虎机式三格滚轮抽奖）
 * 三格独立滚动 → 逐个停下 → 中间格高亮显示奖品。
 * 由 GameManager 创建并调用；结束后回调 onDone(奖品item)。
 * 视觉：Graphics 面板 + Label 图标（无需素材）。
 * Cocos Creator 3.8.8 迁移版
 */
import { _decorator, Component, Node, Color, Label, Graphics, UITransform, Layers, tween, Vec3 } from 'cc';
import { BOSS_REWARD } from '../config';
import { createLabel, createPanel, createButton } from '../util';
const { ccclass } = _decorator;

export interface BossRewardItem { id: string; icon: string; name: string; weight: number; effect: string; }

@ccclass('SlotMachine')
export class SlotMachine extends Component {

    private _items: BossRewardItem[] = [];
    private _onDone: ((item: BossRewardItem) => void) | null = null;
    private _result: BossRewardItem | null = null;   // 预选结果（权重抽取）
    private _cells: Label[] = [];                    // 三格 Label
    private _active = false;
    private _rollTimers: (() => void)[] = [];        // 每格 tick 定时器清理

    /** 启动抽奖（parent=UI 容器；items=奖品池；onDone=结束后回调） */
    startSpin(items: BossRewardItem[], onDone: (item: BossRewardItem) => void): void {
        this._items = items;
        this._onDone = onDone;
        // 权重预选结果（老虎机是"先定结果再滚动"，保证可控）
        this._result = this._pickWeighted(items);
        this._buildUI();
        this._active = true;
        this._spin();
    }

    /** 权重抽取 */
    private _pickWeighted(items: BossRewardItem[]): BossRewardItem {
        let total = 0;
        for (const it of items) total += it.weight;
        let roll = Math.random() * total;
        for (const it of items) {
            roll -= it.weight;
            if (roll <= 0) return it;
        }
        return items[items.length - 1];
    }

    /** 构建老虎机 UI（面板 + 三格 + 按钮） */
    private _buildUI(): void {
        // 根节点居中（由调用方挂到 Canvas）
        createPanel(this.node, 0, 0, 500, 300, new Color(20, 30, 60, 240), 20);
        const title = createLabel(this.node, '🏆 BOSS 战利品', 0, 110, 30, new Color(255, 215, 110, 255));
        title.node.setPosition(0, 110, 0);

        // 三格滚轮（x = -120 / 0 / 120）
        for (let i = 0; i < 3; i++) {
            const x = (i - 1) * 140;
            createPanel(this.node, x, -10, 120, 140, new Color(40, 20, 60, 230), 14);
            const lbl = createLabel(this.node, '❓', x, -10, 64, new Color(255, 255, 255, 255));
            this._cells.push(lbl);
        }

        // 开始按钮
        const btn = createButton(this.node, '🎲 开奖', 0, -118, () => {
            // 已自动开始，按钮仅作"跳过/确认"：提前结束动画
            this._finish();
        }, 180, 52);
        btn.node.setPosition(0, -118, 0);
        // 提示
        const tip = createLabel(this.node, '点击按钮跳过滚动', 0, -165, 16, new Color(160, 180, 210, 255));
        tip.node.setPosition(0, -165, 0);
    }

    /** 滚动动画：三格随机快速跳动 → 逐个停到结果格 */
    private _spin(): void {
        const R = BOSS_REWARD;
        // 每个格子：滚动 tick 随机图标，然后按 stagger 停在结果
        for (let i = 0; i < 3; i++) {
            const cell = this._cells[i];
            const stopDelay = R.SPIN_STAGGER * (i + 1);  // 0.35 / 0.7 / 1.05
            // 阶段1：快速跳动（直到 stopDelay 前）
            const tick = setInterval(() => {
                if (!this._active) { clearInterval(tick); return; }
                const rnd = this._items[Math.floor(Math.random() * this._items.length)];
                cell.string = rnd.icon;
            }, R.TICK_MS);
            // 阶段2：到 stopDelay 停止本格 → 显示结果
            setTimeout(() => {
                clearInterval(tick);
                cell.string = this._result!.icon;
                this._highlight(cell);
            }, stopDelay * 1000);
        }
        // 阶段3：全部停后，稍等 → 完成回调
        setTimeout(() => {
            this._finish();
        }, (R.SPIN_TIME) * 1000);
    }

    /** 高亮格（金色 + 放大脉冲） */
    private _highlight(lbl: Label): void {
        lbl.color = new Color(255, 225, 100, 255);
        const n = lbl.node;
        n.setScale(new Vec3(1.25, 1.25, 1));
        tween(n).to(0.25, { scale: new Vec3(1, 1, 1) }).start();
    }

    /** 完成：显示奖品名 + 回调 */
    private _finish(): void {
        if (!this._active) return;
        this._active = false;
        // 清理所有 tick
        for (const c of this._cells) {
            // 中间格显示结果名（两侧保持图标）
        }
        const result = this._result!;
        const nameLbl = createLabel(this.node, `🎁 ${result.icon} ${result.name}`, 0, 78, 24, new Color(255, 230, 150, 255));
        nameLbl.node.setPosition(0, 78, 0);
        // 通知
        if (this._onDone) {
            const cb = this._onDone;
            this._onDone = null;
            setTimeout(() => cb(result), 400);  // 让玩家看到结果名再关
        }
    }

    /** 关闭并销毁 */
    close(): void {
        this._active = false;
        this.node.destroy();
    }
}
