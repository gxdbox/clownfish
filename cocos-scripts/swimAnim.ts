/**
 * swimAnim.ts — 程序化"活"动画：让单张静态精灵图动起来（无需逐帧素材）
 *
 * 原理：不改素材，每帧用正弦函数驱动精灵节点的三个自由度——
 *   bob   上下浮动（游泳起伏 / 漂浮）
 *   sway  绕 Z 轴左右摇摆（游泳摆尾 / 晃动 / 蛇形扭动）
 *   breath 身体缩放呼吸（水母呼吸 / 河豚鼓胀）
 *   glow  附加发光光晕（鮟鱇头顶灯笼闪烁）
 *
 * 关键约定：动画只作用于宿主节点下的 'Sprite' 子节点（rotation/scale/position），
 * 绝不碰宿主节点本身 —— 这样移动、碰撞、转向、激光（挂在宿主上的 Graphics）全部不受影响。
 *
 * Cocos Creator 3.8.8 迁移版
 */
import { Color, Graphics, Node, UITransform } from 'cc';

export interface SwimGlow {
    fx: number;       // 光晕相对精灵中心 X（-1~1，0.5 比例）
    fy: number;       // 光晕相对精灵中心 Y（正 = 头顶方向）
    rScale: number;   // 光晕半径 = 精灵宽度 * rScale
    freq: number;     // 闪烁频率（rad/s）
    intensity?: number; // 发光强度 0~1（默认 0.9）
}

export interface SwimParams {
    bobAmp: number;    // 上下浮动幅度（px）
    bobFreq: number;   // 浮动频率
    swayAmp: number;   // 摇摆幅度（度）
    swayFreq: number;  // 摇摆频率
    breathAmp: number; // 呼吸缩放幅度（0.08 = ±8%）
    breathFreq: number;// 呼吸频率
    glow?: SwimGlow;   // 可选发光部位（鮟鱇灯笼）
}

/** 各生物"活法"配置（与 demo 展示页参数对齐） */
export const SWIM: Record<string, SwimParams> = {
    // 小丑鱼玩家：游动起伏 + 摆尾
    swimmer: { bobAmp: 5, bobFreq: 1.3, swayAmp: 7, swayFreq: 2.4, breathAmp: 0.02, breathFreq: 1.8 },
    // 水母（章鱼）：慢漂浮 + 呼吸
    jelly:   { bobAmp: 8, bobFreq: 0.7, swayAmp: 5, swayFreq: 1.2, breathAmp: 0.06, breathFreq: 0.9 },
    // 螃蟹：左右晃动
    crab:    { bobAmp: 2, bobFreq: 1.5, swayAmp: 10, swayFreq: 1.6, breathAmp: 0.02, breathFreq: 2.2 },
    // 电鳗：蛇形大幅摆动
    eel:     { bobAmp: 3, bobFreq: 1.8, swayAmp: 20, swayFreq: 2.2, breathAmp: 0.02, breathFreq: 2.5 },
    // 河豚：鼓胀呼吸
    puffer:  { bobAmp: 4, bobFreq: 1.0, swayAmp: 4, swayFreq: 0.8, breathAmp: 0.08, breathFreq: 1.2 },
    // 鮟鱇：浮动 + 灯笼闪烁
    angler:  { bobAmp: 5, bobFreq: 0.9, swayAmp: 8, swayFreq: 1.3, breathAmp: 0.03, breathFreq: 1.8,
               glow: { fx: 0.0, fy: 0.40, rScale: 0.26, freq: 3.0, intensity: 0.9 } },
    // BOSS 通用：沉稳大浮动
    boss:    { bobAmp: 5, bobFreq: 0.8, swayAmp: 9, swayFreq: 1.1, breathAmp: 0.02, breathFreq: 1.5 },
    // BOSS 鮟鱇：+ 大灯笼闪烁
    bossAngler: { bobAmp: 6, bobFreq: 0.7, swayAmp: 10, swayFreq: 1.0, breathAmp: 0.03, breathFreq: 1.5,
                  glow: { fx: 0.0, fy: 0.40, rScale: 0.20, freq: 2.6, intensity: 1.0 } },
    // 传送门：脉动呼吸 + 轻微浮动（旋转已在 Portal 组件宿主上做）
    portal:  { bobAmp: 2, bobFreq: 0.9, swayAmp: 0, swayFreq: 0, breathAmp: 0.05, breathFreq: 1.0 },
};

/** 普通敌人 5 种 → SWIM 配置（顺序与 SPRITES.ENEMIES / EnemyAI.TYPES 一致） */
export const ENEMY_SWIM = ['jelly', 'crab', 'eel', 'puffer', 'angler'];

/** BOSS 3 种 → SWIM 配置（顺序与 SPRITES.BOSSES 一致） */
export const BOSS_SWIM = ['boss', 'boss', 'bossAngler'];

export class SwimAnim {
    private _t = 0;
    private _glowNode: Node | null = null;
    private _glowGfx: Graphics | null = null;
    private _glowParams: SwimGlow | null = null;

    /**
     * 附加光晕到精灵节点（鮟鱇灯笼）。精灵尺寸来自 UITransform.contentSize。
     * 在精灵图加载前后调用均可（尺寸在 loadSpriteOnto 已设置）。
     */
    attachGlow(spriteNode: Node, params: SwimParams): void {
        if (!params.glow || !spriteNode || !spriteNode.isValid) return;
        const g = params.glow;
        this._glowParams = g;
        const ut = spriteNode.getComponent(UITransform);
        const w = ut ? ut.contentSize.width : 64;
        let node = spriteNode.getChildByName('Glow');
        if (!node) {
            node = new Node('Glow');
            spriteNode.addChild(node);
        }
        this._glowNode = node;
        const gt = node.getComponent(UITransform) || node.addComponent(UITransform);
        gt.setAnchorPoint(0.5, 0.5);
        gt.setContentSize(w * g.rScale * 4, w * g.rScale * 4);
        node.setPosition(g.fx * w / 2, g.fy * w / 2, 0);
        const gfx = node.getComponent(Graphics) || node.addComponent(Graphics);
        this._glowGfx = gfx;
        this._drawGlow();
    }

    /** 重绘光晕（多层同心半透明圆模拟发光，闪烁由正弦驱动） */
    private _drawGlow(): void {
        if (!this._glowGfx || !this._glowParams) return;
        const g = this._glowGfx;
        const p = this._glowParams;
        const pulse = 0.55 + 0.45 * Math.sin(this._t * p.freq);
        const ut = this._glowNode ? this._glowNode.getComponent(UITransform) : null;
        const w = ut ? ut.contentSize.width : 64;
        const r = w / 4; // 半径 = 内容尺寸的 1/4（attachGlow 设 4r）
        const inten = p.intensity ?? 0.9;
        g.clear();
        g.fillColor = new Color(255, 235, 150, Math.floor(210 * pulse * inten));
        g.circle(0, 0, r * 0.7);
        g.fill();
        g.fillColor = new Color(255, 200, 80, Math.floor(130 * pulse * inten));
        g.circle(0, 0, r * 1.3);
        g.fill();
        g.fillColor = new Color(255, 180, 60, Math.floor(65 * pulse * inten));
        g.circle(0, 0, r * 2.0);
        g.fill();
        try { g.flush && g.flush(); } catch { /* web-mobile 无需 */ }
    }

    /**
     * 每帧应用动画到精灵子节点。只改 sprite 自身的 rotation/scale/position，
     * 不影响宿主节点（移动/碰撞/激光）。
     */
    update(dt: number, spriteNode: Node, params: SwimParams): void {
        if (!spriteNode || !spriteNode.isValid) return;
        this._t += dt;
        const t = this._t;

        // 呼吸缩放
        if (params.breathAmp > 0) {
            const b = 1 + Math.sin(t * params.breathFreq) * params.breathAmp;
            spriteNode.setScale(b, b, 1);
        }
        // 左右摇摆
        if (params.swayAmp > 0) {
            spriteNode.setRotationFromEuler(0, 0, Math.sin(t * params.swayFreq) * params.swayAmp);
        }
        // 上下浮动（sprite 本地 y；父节点朝向已由宿主控制）
        if (params.bobAmp > 0) {
            spriteNode.setPosition(0, Math.sin(t * params.bobFreq) * params.bobAmp, 0);
        }
        // 光晕闪烁
        if (this._glowGfx) this._drawGlow();
    }

    reset(): void {
        this._t = 0;
    }
}
