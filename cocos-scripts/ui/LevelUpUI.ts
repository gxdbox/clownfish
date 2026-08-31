/**
 * LevelUpUI.ts — 升级三选一卡牌
 * 挂在 LevelUpPanel 节点上。
 * 卡牌全部动态创建（不依赖场景节点，避免引用缺失导致空画面）。
 * 交互：点击卡牌（TOUCH_START 即选）或键盘 ←→/A D 切换、回车/空格确认、1/2/3 直选。
 * 弹入动画使用 tween + easeOutBack。
 *
 * 关键修复：UI 采用懒构建（_ensureBuilt），不依赖 onLoad 时机。
 * 面板节点在场景中默认隐藏（active=false）时 onLoad 不会执行，
 * 若等 _onShow 时才构建会导致弹框空白/找不到弹框 → 升级后卡死。
 * Cocos Creator 3.8.8 迁移版
 */
import { _decorator, Component, Color, Graphics, Label, Node, UITransform, Widget, tween, Vec3 } from 'cc';
import { createLabel, createPanel } from '../util';
import { UPGRADE } from '../config';
import type { GameManager } from '../managers/GameManager';
import type { UpgradeChoice } from '../components/PlayerController';
const { ccclass } = _decorator;

@ccclass('LevelUpUI')
export class LevelUpUI extends Component {

    /** 3 个卡牌节点（运行时动态创建） */
    cardNodes: Node[] = [];

    gameManager: GameManager | null = null;

    /** 键盘导航当前选中（-1 = 未选中） */
    private _selected = -1;

    /** 懒构建标记：面板 onLoad 未执行时由 setup/_onShow 触发构建 */
    private _built = false;

    onLoad(): void {
        this._ensureBuilt();
    }

    /** 设置引用（由 GameManager 调用） */
    setup(gm: GameManager): void {
        this.gameManager = gm;
        // 立即构建 UI：面板节点 inactive 时 onLoad 不会执行，
        // 若不提前构建，首次触发升级时弹框为空白 → 玩家找不到弹框 → 卡死
        this._ensureBuilt();
        gm.node.on('show-levelup', this._onShow, this);
    }

    /** 懒构建：无论 onLoad 是否执行过，保证面板内容完整创建（幂等） */
    private _ensureBuilt(): void {
        if (this._built) return;
        this._built = true;

        // 强制面板几何：锚点居中 + 铺满设计分辨率 1280x720。
        // 场景中 Widget/锚点配置可能漂移（锚点非中心时卡牌会挤到屏幕角落），运行时统一修正。
        const w = this.node.getComponent(Widget);
        if (w) w.enabled = false;
        const uit = this.node.getComponent(UITransform) || this.node.addComponent(UITransform);
        uit.setAnchorPoint(0.5, 0.5);
        uit.setContentSize(1280, 720);
        this.node.setPosition(0, 0, 0);

        // 清空旧子节点（重进场景时避免重复构建）
        this.node.removeAllChildren();
        this.cardNodes = [];

        // 全屏半透明遮罩（突出升级卡牌，压暗游戏画面）
        createPanel(this.node, 0, 0, 1280, 720, new Color(8, 14, 30, 184), 0);

        // 标题 + 键盘操作提示
        createLabel(this.node, '✨ 升级！选择一项', 0, 170, 38, new Color(255, 230, 150, 255));
        createLabel(this.node, '← → 切换 · 回车确认 · 1/2/3 直选', 0, 126, 18, new Color(140, 170, 190, 255));

        // 3 张卡牌（含 iconLabel / nameLabel / descLabel）
        const xs = [-280, 0, 280];
        for (let i = 0; i < 3; i++) {
            const card = createPanel(this.node, xs[i], -70, 260, 320, new Color(10, 38, 62, 245), 18);
            card.name = 'Card' + i;

            createLabel(card, '', 0, 110, 52).node.name = 'iconLabel';
            createLabel(card, '', 0, 48, 26, new Color(255, 235, 180, 255)).node.name = 'nameLabel';

            const desc = createLabel(card, '', 0, -38, 20, new Color(190, 215, 235, 255));
            desc.node.name = 'descLabel';
            const tf = desc.node.getComponent(UITransform);
            if (tf) tf.setContentSize(220, 120);
            desc.overflow = Label.Overflow.RESIZE_HEIGHT;
            desc.enableWrapText = true;

            // 点击即选（TOUCH_START 避免被全屏摇杆层拦截）
            card.on(Node.EventType.TOUCH_START, () => this._onChoose(i), this);

            // 选中高亮框（独立子节点，避免污染卡牌背景 Graphics）
            const hl = new Node('Highlight');
            hl.setParent(card);
            const hlTf = hl.addComponent(UITransform);
            hlTf.setContentSize(260, 320);
            const hlG = hl.addComponent(Graphics);
            hlG.lineWidth = 5;
            hlG.strokeColor = new Color(255, 215, 90, 255);
            hlG.roundRect(-130, -160, 260, 320, 18);
            hlG.stroke();
            hl.active = false;

            this.cardNodes.push(card);
        }
    }

    /** 键盘导航：左右移动选中 */
    moveSel(delta: number): void {
        const n = this.cardNodes.length;
        const next = this._selected < 0 ? 1 : (this._selected + delta + n) % n;
        this._setSelected(next);
    }

    /** 键盘导航：确认当前选中 */
    confirmSel(): void {
        if (this._selected >= 0 && this._selected < this.cardNodes.length) {
            this._onChoose(this._selected);
        }
    }

    private _setSelected(idx: number): void {
        if (idx === this._selected) return;
        this._selected = idx;
        for (let i = 0; i < this.cardNodes.length; i++) {
            const card = this.cardNodes[i];
            const sel = i === idx;
            // 选中：放大 + 金色描边高亮
            card.setScale(sel ? 1.07 : 1, sel ? 1.07 : 1, 1);
            const hl = card.getChildByName('Highlight');
            if (hl) hl.active = sel;
        }
    }

    private _onShow(choices: UpgradeChoice[]): void {
        this._selected = -1;

        // 兜底：确保面板内容已构建（首次触发升级前 setup 可能未执行完整）
        this._ensureBuilt();

        // 填充卡牌内容
        for (let i = 0; i < this.cardNodes.length && i < choices.length; i++) {
            const card = this.cardNodes[i];
            const choice = choices[i];

            // 查找子节点 Label（动态创建时已命名）
            const iconLabel = card.getChildByName('iconLabel')?.getComponent(Label);
            const nameLabel = card.getChildByName('nameLabel')?.getComponent(Label);
            const descLabel = card.getChildByName('descLabel')?.getComponent(Label);

            if (iconLabel) iconLabel.string = choice.icon;
            if (nameLabel) nameLabel.string = choice.name;
            if (descLabel) descLabel.string = choice.desc;

            // 弹入动画：从下方 60px 弹入，easeOutBack
            const origY = card.position.y;
            card.setPosition(card.position.x, origY - 60, 0);
            tween(card)
                .to(UPGRADE.CARD_ANIM_TIME, { position: new Vec3(card.position.x, origY, 0) },
                    { easing: 'backOut' })
                .start();
        }
    }

    private _onChoose(idx: number): void {
        this.gameManager?.audioManager?.click();
        this.gameManager?.chooseUpgrade(idx);
    }
}
