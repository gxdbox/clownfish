/**
 * util.ts — 通用工具函数（无分配优先）
 * Cocos Creator 3.8.8 迁移版
 */
import { Color, Graphics, Label, Node, UITransform, Layers, Sprite, SpriteFrame, Texture2D, resources } from 'cc';

/** 限制值在 [min, max] 范围内 */
export function clamp(v: number, min: number, max: number): number {
    return v < min ? min : (v > max ? max : v);
}
/** 线性插值 */
export function lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t;
}

/** 两点距离平方（热点路径用，避免开方） */
export function dist2(x1: number, y1: number, x2: number, y2: number): number {
    const dx = x2 - x1;
    const dy = y2 - y1;
    return dx * dx + dy * dy;
}

/** 两点距离 */
export function dist(x1: number, y1: number, x2: number, y2: number): number {
    const dx = x2 - x1;
    const dy = y2 - y1;
    return Math.sqrt(dx * dx + dy * dy);
}

/** 随机浮点 [min, max) */
export function rand(min: number, max: number): number {
    return min + Math.random() * (max - min);
}

/** 随机整数 [min, max] */
export function randInt(min: number, max: number): number {
    return Math.floor(min + Math.random() * (max - min + 1));
}

/** 从数组中随机取一个 */
export function randPick<T>(arr: T[]): T {
    return arr[Math.floor(Math.random() * arr.length)];
}

/** 返回 [cos, sin]（避免分配对象，写入 out） */
export function dirVector(angle: number, out: number[]): number[] {
    out[0] = Math.cos(angle);
    out[1] = Math.sin(angle);
    return out;
}

/** 计算从 (x1,y1) 到 (x2,y2) 的角度 */
export function angleTo(x1: number, y1: number, x2: number, y2: number): number {
    return Math.atan2(y2 - y1, x2 - x1);
}

/** 角度插值（处理±π环绕） */
export function angleLerp(a: number, b: number, t: number): number {
    let diff = b - a;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    return a + diff * t;
}

/** 矩形重叠检测 */
export function rectOverlap(ax: number, ay: number, aw: number, ah: number,
    bx: number, by: number, bw: number, bh: number): boolean {
    return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

/** 保留一位小数 */
export function round1(v: number): number {
    return Math.round(v * 10) / 10;
}

/** 格式化时间 mm:ss */
export function formatTime(sec: number): string {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
}

/** easeOutBack 弹入效果 */
export function easeOutBack(t: number): number {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

/** 为节点补齐 UITransform（Graphics/Sprite 渲染的尺寸基准，锚点居中）。
 *  世界层节点挂 Graphics 时部分平台要求 UITransform 存在，否则视觉不渲染。 */
export function ensureRenderTransform(node: Node, w = 64, h = 64): UITransform {
    const t = node.getComponent(UITransform) || node.addComponent(UITransform);
    t.setAnchorPoint(0.5, 0.5);
    if (t.contentSize.width <= 0) t.setContentSize(w, h);
    return t;
}

/**
 * 从 resources 加载图片素材并挂到 host 节点的 'Sprite' 子节点上。
 * - path 形如 'sprites/enemy_crab'（不带扩展名、不带 resources/ 前缀）
 * - 加载成功：构造 SpriteFrame（从 Texture2D 运行时创建，兼容 texture 类型导入的图片）+ 隐藏 host 的 'Body' 子节点（Graphics 兜底）
 * - 加载失败：什么都不做，Graphics 兜底保持可见（零素材仍可玩）
 * - 返回 Sprite 组件（可能为 null，若 Sprite 被 treeshake）
 */
export function loadSpriteOnto(host: Node, path: string, w: number, h: number): Sprite | null {
    let sNode = host.getChildByName('Sprite');
    if (!sNode) {
        sNode = new Node('Sprite');
        sNode.setPosition(0, 0, 0);
        host.addChild(sNode);
    }
    const sprite = sNode.getComponent(Sprite) || sNode.addComponent(Sprite);
    sprite.sizeMode = Sprite.SizeMode.CUSTOM;
    sprite.trim = false;
    const tf = sNode.getComponent(UITransform) || sNode.addComponent(UITransform);
    tf.setAnchorPoint(0.5, 0.5);
    tf.setContentSize(w, h);
    sNode.active = false; // 加载完成前隐藏，避免空 Sprite 占位
    // 加载 Texture2D → 运行时构造 SpriteFrame。
    // 仓库 meta 以 texture 类型导入图片：主资源是 cc.ImageAsset，Texture2D 是其 '/texture' 子资源。
    resources.load(path + '/texture', Texture2D, (err, tex) => {
        if (err || !tex || !host || !host.isValid) return;
        const sf = new SpriteFrame();
        sf.texture = tex;
        sprite.spriteFrame = sf;
        sNode.active = true;
        const body = host.getChildByName('Body');
        if (body) body.active = false; // 隐藏 Graphics 兜底
    });
    return sprite;
}

// ===== 动态 UI 创建工具（纯代码 UI，不依赖场景节点与贴图） =====
// 坐标以父节点锚点（面板中心）为原点，所有面板在场景中位于 (0,0) 且铺满屏幕

/** 创建文本节点 */
export function createLabel(parent: Node, text: string, x: number, y: number, fontSize = 28, color?: Color): Label {
    const node = new Node('Label');
    node.layer = Layers.Enum.UI_2D;
    node.setParent(parent);
    node.setPosition(x, y, 0);
    const label = node.addComponent(Label);
    label.string = text;
    label.fontSize = fontSize;
    label.lineHeight = Math.round(fontSize * 1.25);
    label.color = color ?? new Color(255, 255, 255, 255);
    label.horizontalAlign = Label.HorizontalAlign.CENTER;
    label.verticalAlign = Label.VerticalAlign.CENTER;
    return label;
}

/** 创建圆角纯色面板 */
export function createPanel(parent: Node, x: number, y: number, w: number, h: number, color: Color, radius = 14): Node {
    const node = new Node('Panel');
    node.layer = Layers.Enum.UI_2D;
    node.setParent(parent);
    node.setPosition(x, y, 0);
    const tf = node.addComponent(UITransform);
    tf.setContentSize(w, h);
    const g = node.addComponent(Graphics);
    g.roundRect(-w / 2, -h / 2, w, h, radius);
    g.fillColor = color;
    g.fill();
    return node;
}

/** 创建按钮（圆角背景 + 居中文字 + 点击回调），返回节点和文字 */
export function createButton(parent: Node, text: string, x: number, y: number, onTap: () => void, w = 260, h = 64): { node: Node; label: Label } {
    const node = new Node('Button');
    node.layer = Layers.Enum.UI_2D;
    node.setParent(parent);
    node.setPosition(x, y, 0);
    const tf = node.addComponent(UITransform);
    tf.setContentSize(w, h);
    const g = node.addComponent(Graphics);
    g.roundRect(-w / 2, -h / 2, w, h, h / 3);
    g.fillColor = new Color(20, 110, 190, 255);
    g.fill();
    g.lineWidth = 3;
    g.strokeColor = new Color(130, 210, 255, 255);
    g.roundRect(-w / 2, -h / 2, w, h, h / 3);
    g.stroke();
    const label = createLabel(node, text, 0, 0, Math.floor(h * 0.42));
    // 用 TOUCH_START 触发：全屏摇杆层可能拦截 TOUCH_END 序列，START 更可靠
    node.on(Node.EventType.TOUCH_START, onTap);
    return { node, label };
}

/** 创建水平进度条，set(p) 更新进度 0~1 */
export function createBar(parent: Node, x: number, y: number, w: number, h: number, fgColor: Color): { set: (p: number) => void } {
    const node = new Node('Bar');
    node.layer = Layers.Enum.UI_2D;
    node.setParent(parent);
    node.setPosition(x, y, 0);
    createPanel(node, 0, 0, w, h, new Color(30, 30, 50, 200), h / 2);
    const fg = new Node('BarFill');
    fg.layer = Layers.Enum.UI_2D;
    fg.setParent(node);
    const tf = fg.addComponent(UITransform);
    tf.setContentSize(w, h);
    tf.setAnchorPoint(0, 0.5);
    const g = fg.addComponent(Graphics);
    g.roundRect(0, -h / 2, w, h, h / 2);
    g.fillColor = fgColor;
    g.fill();
    fg.setPosition(-w / 2, 0, 0);
    return {
        set(p: number) {
            const v = Math.max(0, Math.min(1, p));
            fg.active = v > 0.001;
            fg.setScale(v, 1, 1);
        }
    };
}
