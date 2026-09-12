/**
 * SlotMachine.ts — Boss 胜利战利品（跑马灯式战利品机）
 * 外圈 12 格奖品环绕 + 中心暂停按钮：高亮格沿外圈顺时针循环跑，玩家按暂停 → 逐渐减速停下，
 * 落在哪一格就得那一格的奖励。
 * 结果仍按权重后台先定，再从该奖品所占的格子里随机挑一个作为停靠位
 * （表现上是"停在哪就得哪"，概率仍精确等于配置权重，且每种奖品至少占 1 格必然可达）。
 * 计时全部走引擎调度器（Component.scheduleOnce / unscheduleAllCallbacks）：
 * 节点销毁即停，避免定时器回调访问已销毁节点（微信端 null.x 崩溃）。
 * 由 GameManager 创建并调用；结束后回调 onDone(奖品item)。
 * Cocos Creator 3.8.8 迁移版
 */
import { _decorator, Component, Node, Color, Label, Graphics, Tween, Vec3, tween, view, Layers, UIOpacity } from 'cc';
import { BOSS_REWARD, BOSS_FX } from '../config';
import { createLabel, createPanel, createButton } from '../util';
const { ccclass } = _decorator;

export interface BossRewardItem { id: string; icon: string; name: string; weight: number; effect: string; }

/** 外圈 12 格顺时针环序坐标（顶行→右列→底行→左列），高亮沿此顺序绕圈跑 */
const RING: [number, number][] = [
    [-205, 165], [-69, 165], [69, 165], [205, 165],      // 顶行 左→右
    [205, 55], [205, -55],                               // 右列 上→下
    [205, -165], [69, -165], [-69, -165], [-205, -165],  // 底行 右→左
    [-205, -55], [-205, 55],                             // 左列 下→上
];

type Phase = 'idle' | 'rolling' | 'slowing' | 'stopped';

@ccclass('SlotMachine')
export class SlotMachine extends Component {

    private _items: BossRewardItem[] = [];
    private _onDone: ((item: BossRewardItem) => void) | null = null;
    private _result: BossRewardItem | null = null;      // 权重预选结果
    private _cellItems: BossRewardItem[] = [];          // 每格绑定的奖品
    private _iconLabels: Label[] = [];
    private _hlNodes: Node[] = [];
    private _nameLbl: Label | null = null;
    private _btn: { node: Node; label: Label } | null = null;
    private _op: UIOpacity | null = null;   // 入场淡入 / 退场淡出
    private _cur = 0;                                   // 当前高亮格
    private _target = 0;                                // 停靠格（= 结果奖品所在格）
    private _phase: Phase = 'idle';
    private _rollTime = 0;                              // 已滚动时长（防刚起步误触暂停）
    private _slowLeft = 0;                              // 减速剩余步数
    private _slowTotal = 1;

    /** 启动（parent=UI 容器；items=奖品池；onDone=结束后回调） */
    startSpin(items: BossRewardItem[], onDone: (item: BossRewardItem) => void): void {
        this._items = items;
        this._onDone = onDone;
        this._result = this._pickWeighted(items);
        this._cellItems = this._layoutCells(items, RING.length);
        // 停靠格 = 结果奖品所占格子中随机一个
        const own: number[] = [];
        for (let i = 0; i < this._cellItems.length; i++) {
            if (this._cellItems[i].id === this._result.id) own.push(i);
        }
        this._target = own.length ? own[Math.floor(Math.random() * own.length)] : 0;

        this._buildUI();
        this._showCell(0);
        // 安全网（不是替玩家决定）：玩家走开或没注意到按钮时，流程仍要推进到开传送门
        this.scheduleOnce(() => {
            if (this._phase === 'idle') this._startRoll();
        }, BOSS_REWARD.AUTO_STOP + 4);
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

    /** 奖品铺到外圈格：格数按权重比例分配（最大余数法），让“格子多少”与“中奖概率”直觉一致；
     *  权重过低分到 0 格的奖品保底占 1 格（否则抽中它时没有落点可停），最后打散 */
    private _layoutCells(items: BossRewardItem[], n: number): BossRewardItem[] {
        let total = 0;
        for (const it of items) total += it.weight;
        const raw = items.map(it => it.weight / total * n);
        const alloc = raw.map(r => Math.floor(r));
        let used = alloc.reduce((a, b) => a + b, 0);
        const byFrac = raw.map((r, i) => ({ i, f: r - Math.floor(r) })).sort((a, b) => b.f - a.f);
        for (const o of byFrac) {
            if (used >= n) break;
            alloc[o.i]++; used++;
        }
        // 保底：从格数最多的奖品让出 1 格给 0 格奖品
        for (let i = 0; i < alloc.length; i++) {
            if (alloc[i] > 0) continue;
            let mi = 0;
            for (let k = 1; k < alloc.length; k++) if (alloc[k] > alloc[mi]) mi = k;
            if (alloc[mi] > 1) { alloc[mi]--; alloc[i] = 1; }
        }
        const out: BossRewardItem[] = [];
        for (let i = 0; i < items.length; i++) {
            for (let k = 0; k < alloc[i]; k++) out.push(items[i]);
        }
        while (out.length < n) out.push(items[out.length % items.length]);
        out.length = Math.min(out.length, n);
        // Fisher-Yates 打散，避免同类奖品挤在一起
        for (let i = out.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            const t = out[i]; out[i] = out[j]; out[j] = t;
        }
        return out;
    }

    /** 构建 UI：全屏遮罩 + 机身 + 外圈 12 格 + 中心标题/按钮 */
    private _buildUI(): void {
        const vs = view.getVisibleSize();
        // 全屏半透明遮罩（不随 content 缩放，保证盖满可见区）
        createPanel(this.node, 0, 0, Math.max(1280, vs.width + 8), Math.max(720, vs.height + 8),
            new Color(6, 10, 24, 205), 0);

        // 内容容器：矮屏（手机横屏可见高约 460）整体缩放兜底，防止上下格被裁
        const content = new Node('Content');
        content.layer = Layers.Enum.UI_2D;
        this.node.addChild(content);
        const s = Math.min(1, vs.height / 470);
        content.setScale(s, s, 1);

        createPanel(content, 0, 0, 620, 430, new Color(28, 16, 56, 246), 22);
        createLabel(content, '🏆 BOSS 战利品', 0, 104, 26, new Color(255, 215, 110, 255));
        this._nameLbl = createLabel(content, '按「开始」，落在哪格就得哪奖', 0, -100, 16, new Color(170, 190, 220, 255));

        // 外圈 12 格：底框 + 图标 + 奖品名 + 高亮框（默认隐藏）
        for (let i = 0; i < RING.length; i++) {
            const it = this._cellItems[i];
            const host = new Node('Cell');
            host.layer = Layers.Enum.UI_2D;
            host.setParent(content);
            host.setPosition(RING[i][0], RING[i][1], 0);
            createPanel(host, 0, 0, 122, 96, new Color(52, 28, 92, 255), 12);
            this._iconLabels.push(createLabel(host, it.icon, 0, 10, 38));
            createLabel(host, it.name, 0, -28, 12, new Color(198, 180, 228, 255));

            const hl = new Node('HL');
            hl.layer = Layers.Enum.UI_2D;
            hl.setParent(host);
            const g = hl.addComponent(Graphics);
            g.fillColor = new Color(255, 215, 90, 40);
            g.roundRect(-61, -48, 122, 96, 12);
            g.fill();
            g.lineWidth = 4;
            g.strokeColor = new Color(255, 215, 90, 255);
            g.roundRect(-61, -48, 122, 96, 12);
            g.stroke();
            hl.active = false;
            this._hlNodes.push(hl);
        }

        // 中心按钮：开始 → 暂停（同一按钮承担两个动作，玩家全程只需盯一个位置）
        this._btn = createButton(content, '▶ 开始', 0, 6, () => this._onButton(), 200, 58);

        // 入场淡入而非硬切：刚才把“我赢了”说清楚后面板再浮现，
        // 淡入过程中玩家能看见冻结的战场，知道自己已经从战斗里退出来了
        const op = this.node.addComponent(UIOpacity);
        op.opacity = 0;
        this._op = op;
        tween(op).to(BOSS_FX.PANEL_FADE, { opacity: 255 }).start();

        // 按钮呼吸引导：把“何时开抽”的选择权交给玩家，只用视觉提示，不替他决定
        if (this._btn) {
            const b = this._btn.node;
            tween(b)
                .repeatForever(
                    tween(b)
                        .to(0.44, { scale: new Vec3(1.08, 1.08, 1) }, { easing: 'sineInOut' })
                        .to(0.44, { scale: new Vec3(1, 1, 1) }, { easing: 'sineInOut' })
                )
                .start();
        }
    }

    /** 按钮：idle → 开始滚动；rolling → 请求暂停 */
    private _onButton(): void {
        if (this._phase === 'idle') this._startRoll();
        else if (this._phase === 'rolling') this._onStop(false);
    }

    private _startRoll(): void {
        this._phase = 'rolling';
        this._rollTime = 0;
        // 玩家已介入 → 停掉按钮呼吸，提示使命完成
        if (this._btn) {
            Tween.stopAllByTarget(this._btn.node);
            this._btn.node.setScale(1, 1, 1);
        }
        if (this._btn) this._btn.label.string = '⏸ 暂停';
        if (this._nameLbl) this._nameLbl.string = '落在哪格就得哪奖，看准时机！';
        // 玩家一直不按 → AUTO_STOP 后自动暂停（保证流程一定继续）
        this.scheduleOnce(() => {
            if (this._phase === 'rolling') this._onStop(true);
        }, BOSS_REWARD.AUTO_STOP);
        this.scheduleOnce(() => this._tick(), BOSS_REWARD.BASE_TICK);
    }

    /** 请求暂停：算出还要走几步才落到停靠格（太近则多跑一圈保留悬念） */
    private _onStop(force: boolean): void {
        if (this._phase !== 'rolling') return;
        if (!force && this._rollTime < BOSS_REWARD.MIN_ROLL) return;   // 刚起步，忽略误触
        const n = this._cellItems.length;
        let d = (this._target - this._cur + n) % n;
        if (d < BOSS_REWARD.SLOW_STEPS) d += n;
        this._slowLeft = d;
        this._slowTotal = Math.max(1, d);
        this._phase = 'slowing';
        if (this._btn) this._btn.label.string = '⏳ 减速中…';
        if (this._nameLbl) this._nameLbl.string = '停！';
    }

    /** 单步推进：rolling 匀速；slowing 越接近目标越慢 */
    private _tick(): void {
        if (this._phase !== 'rolling' && this._phase !== 'slowing') return;
        const n = this._cellItems.length;
        this._cur = (this._cur + 1) % n;
        this._showCell(this._cur);

        if (this._phase === 'rolling') {
            this._rollTime += BOSS_REWARD.BASE_TICK;
            this.scheduleOnce(() => this._tick(), BOSS_REWARD.BASE_TICK);
            return;
        }
        this._slowLeft--;
        if (this._slowLeft <= 0) { this._land(); return; }
        // ease-out：剩余步数越少，下一步间隔越长（最后一步最慢，营造悬念）
        const t = this._slowLeft / this._slowTotal;
        const delay = BOSS_REWARD.BASE_TICK + BOSS_REWARD.BASE_TICK * 4.2 * Math.pow(1 - t, 2.2);
        this.scheduleOnce(() => this._tick(), delay);
    }

    /** 点亮当前格高亮 + 图标脉冲 */
    private _showCell(idx: number): void {
        for (let i = 0; i < this._hlNodes.length; i++) {
            const hl = this._hlNodes[i];
            if (hl && hl.isValid) hl.active = i === idx;
        }
        const lbl = this._iconLabels[idx];
        if (!lbl || !lbl.isValid) return;
        lbl.node.setScale(new Vec3(1.18, 1.18, 1));
        tween(lbl.node).to(0.12, { scale: new Vec3(1, 1, 1) }).start();
    }

    /** 落定：显示所得奖品，稍后回调应用 */
    private _land(): void {
        this._phase = 'stopped';
        this.unscheduleAllCallbacks();     // 清掉自动暂停/兜底等全部计时
        const r = this._result!;
        this._showCell(this._target);
        const lbl = this._iconLabels[this._target];
        if (lbl && lbl.isValid) {
            lbl.color = new Color(255, 225, 100, 255);
            lbl.node.setScale(new Vec3(1.4, 1.4, 1));
            tween(lbl.node).to(0.35, { scale: new Vec3(1.1, 1.1, 1) }).start();
        }
        if (this._nameLbl && this._nameLbl.isValid) {
            this._nameLbl.string = `🎁 获得 ${r.icon} ${r.name}`;
            this._nameLbl.color = new Color(255, 232, 150, 255);
        }
        if (this._btn && this._btn.node.isValid) this._btn.node.active = false;
        const cb = this._onDone;
        this._onDone = null;
        if (cb) this.scheduleOnce(() => cb(r), 1.1);   // 让玩家看清落点与奖品名再结算
    }

    /** 关闭并销毁（先停计时与补间，避免回调访问已销毁节点） */
    close(): void {
        this._phase = 'stopped';
        this._onDone = null;
        this.unscheduleAllCallbacks();
        for (const lbl of this._iconLabels) {
            if (lbl && lbl.isValid) Tween.stopAllByTarget(lbl.node);
        }
        const nd = this.node;
        if (!nd || !nd.isValid) return;
        if (this._btn) Tween.stopAllByTarget(this._btn.node);
        // 退场同样淡出（硬消失会把玩家直接弹回战场）；
        // 逻辑已在调用方同步做完，这里的残留节点纯表现，无耦合
        const op = this._op;
        if (op && op.isValid) {
            Tween.stopAllByTarget(op);
            tween(op).to(0.16, { opacity: 0 }).call(() => { if (nd.isValid) nd.destroy(); }).start();
        } else {
            nd.destroy();
        }
    }
}
