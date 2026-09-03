/**
 * Joystick.ts — 双虚拟摇杆 + 键盘 WASD
 * 挂在 JoystickNode 上。左半屏移动摇杆，右半屏瞄准摇杆。
 * 桌面端支持 WASD / 方向键。
 */
import { _decorator, Component, input, Input, EventTouch, EventKeyboard, KeyCode, Graphics, Vec2, Vec3, view, Color, UITransform, Label, UIOpacity, sys, Node, Layers } from 'cc';
import { GameState } from '../config';
import type { GameManager } from '../managers/GameManager';
const { ccclass, property } = _decorator;

const JOY_RADIUS = 52;
const JOY_KNOB = 24;
const DEAD_ZONE = 0.18;
const DASH_BTN_R = 52; // 冲刺按钮半径（触屏，微信小游戏无键盘）

interface JoystickState {
    pointerId: number;
    baseX: number;
    baseY: number;
    dx: number;
    dy: number;
    active: boolean;
}

function createJoystick(): JoystickState {
    return { pointerId: -1, baseX: 0, baseY: 0, dx: 0, dy: 0, active: false };
}

@ccclass('Joystick')
export class Joystick extends Component {

    /** 移动方向（归一化，-1~1） */
    moveX = 0;
    moveY = 0;
    /** 瞄准方向（归一化，-1~1） */
    aimX = 0;
    aimY = 0;
    /** 是否正在手动瞄准 */
    aimActive = false;

    private _joyMove = createJoystick();
    private _joyAim = createJoystick();
    private _keys: Record<string, boolean> = {};
    private _gfx: Graphics | null = null;

    // ===== 触屏操作提示（淡显，用过即淡出） =====
    private _hintL: Node | null = null;
    private _hintR: Node | null = null;
    private _hintOpL = 0;
    private _hintOpR = 0;
    private _hintTime = 0;
    private _hintLX = 0;
    private _hintLY = 0;
    private _hintRX = 0;
    private _hintRY = 0;
    private _hintsOn = false;

    // ===== 冲刺按钮（触屏专用，微信小游戏无键盘） =====
    private _dashBtn: Node | null = null;
    private _dashBtnX = 0;   // 本地坐标（屏幕中心为原点，用于绘制与命中检测）
    private _dashBtnY = 0;

    /** 状态机引用（由 GameManager 注入），非 PLAYING 状态忽略触摸避免拦截 UI 点击 */
    gameManager: GameManager | null = null;

    onLoad(): void {
        // 触摸事件：必须注册在全局 input 上，而非节点上。
        // 本节点是位于 UIRoot 之上的全屏层，节点级监听会使其成为最上层命中目标，
        // 抢走所有触摸，导致触屏（微信小游戏）上菜单按钮/升级卡牌完全无法点击。
        // 全局 input 绕过 UI 命中检测，摇杆逻辑不受影响。
        input.on(Input.EventType.TOUCH_START, this._onTouchStart, this);
        input.on(Input.EventType.TOUCH_MOVE, this._onTouchMove, this);
        input.on(Input.EventType.TOUCH_END, this._onTouchEnd, this);
        input.on(Input.EventType.TOUCH_CANCEL, this._onTouchEnd, this);

        // 键盘事件
        input.on(Input.EventType.KEY_DOWN, this._onKeyDown, this);
        input.on(Input.EventType.KEY_UP, this._onKeyUp, this);

        // 窗口失焦清空按键
        // Cocos 小游戏环境无 window.blur，用 scene 的 hide 事件
        // input.on(Input.EventType.DEVICE_CHANGED, ...) 可选

        this._gfx = this.node.getComponent(Graphics);

        // 提示文字节点（初始隐藏）
        this._hintL = this._createHint('左侧滑动 · 移动', -380, -260);
        this._hintR = this._createHint('右侧滑动 · 瞄准', 380, -260);

        // 冲刺按钮（触屏专用）
        this._dashBtn = this._createDashButton();
    }

    /** 创建冲刺按钮文字节点（初始隐藏，由 update 按状态显示） */
    private _createDashButton(): Node {
        const n = new Node('DashBtn');
        n.layer = Layers.Enum.UI_2D;
        n.setParent(this.node);
        const label = n.addComponent(Label);
        label.string = '⚡ 冲刺';
        label.fontSize = 22;
        label.lineHeight = 28;
        label.color = new Color(255, 235, 140, 255);
        label.horizontalAlign = Label.HorizontalAlign.CENTER;
        n.addComponent(UIOpacity).opacity = 0;
        return n;
    }

    /** 创建淡显提示文字节点 */
    private _createHint(text: string, x: number, y: number): Node {
        const n = new Node('Hint');
        n.layer = Layers.Enum.UI_2D;
        n.setParent(this.node);
        n.setPosition(x, y, 0);
        const label = n.addComponent(Label);
        label.string = text;
        label.fontSize = 20;
        label.lineHeight = 26;
        label.color = new Color(170, 205, 230, 255);
        label.horizontalAlign = Label.HorizontalAlign.CENTER;
        n.addComponent(UIOpacity).opacity = 0;
        return n;
    }

    /** 开局显示操作提示（仅触屏设备；用过或超时后淡出） */
    showHints(): void {
        const isTouch = sys.isMobile || typeof (globalThis as any).wx !== 'undefined';
        if (!isTouch || !this._hintL || !this._hintR) return;
        const vs = view.getVisibleSize();
        // 屏幕两侧偏下位置（节点居中于屏幕，本地坐标即屏幕中心偏移）
        this._hintLX = -vs.width / 2 + 150;
        this._hintLY = -vs.height / 2 + 120;
        this._hintRX = vs.width / 2 - 150;
        this._hintRY = -vs.height / 2 + 120;
        this._hintL.setPosition(this._hintLX, this._hintLY - 80, 0);
        this._hintR.setPosition(this._hintRX, this._hintRY - 80, 0);
        this._hintOpL = 110;
        this._hintOpR = 110;
        this._hintTime = 0;
        this._hintsOn = true;
        this._hintL.getComponent(UIOpacity)!.opacity = this._hintOpL;
        this._hintR.getComponent(UIOpacity)!.opacity = this._hintOpR;
    }

    onDestroy(): void {
        input.off(Input.EventType.TOUCH_START, this._onTouchStart, this);
        input.off(Input.EventType.TOUCH_MOVE, this._onTouchMove, this);
        input.off(Input.EventType.TOUCH_END, this._onTouchEnd, this);
        input.off(Input.EventType.TOUCH_CANCEL, this._onTouchEnd, this);
        input.off(Input.EventType.KEY_DOWN, this._onKeyDown, this);
        input.off(Input.EventType.KEY_UP, this._onKeyUp, this);
    }

    private _onTouchStart(e: EventTouch): void {
        // 菜单/升级/结算等非战斗状态不响应触摸，避免拦截 UI 按钮/卡牌点击
        if (this.gameManager && this.gameManager.state !== GameState.PLAYING) return;
        const touch = e.touch;
        if (!touch) return;
        const loc = touch.getLocation();
        // 冲刺按钮命中（触屏；鼠标点击同样命中）——优先于摇杆
        // 命中检测必须与绘制用同一坐标系（节点本地坐标，中心原点）：
        // touch.getLocation() 是屏幕坐标（左下原点且随画布缩放），直接与绘制坐标比较永远不匹配。
        if (this._dashBtnX > 0) {
            const lp = this._toLocal(loc.x, loc.y);
            const ddx = lp.x - this._dashBtnX, ddy = lp.y - this._dashBtnY;
            if (ddx * ddx + ddy * ddy < DASH_BTN_R * DASH_BTN_R) {
                this.gameManager?.playerController?.tryDash();
                return;
            }
        }
        // 屏幕坐标（左下原点）→ 节点本地坐标（Graphics 绘制空间）
        const lp = this._toLocal(loc.x, loc.y);
        const vw = view.getVisibleSize().width;
        const joy = loc.x < vw * 0.45 ? this._joyMove : this._joyAim;
        if (joy.active) return;
        joy.pointerId = touch.getID();
        joy.baseX = lp.x;
        joy.baseY = lp.y;
        joy.dx = 0;
        joy.dy = 0;
        joy.active = true;
        this._sync();
    }

    private _onTouchMove(e: EventTouch): void {
        const touch = e.touch;
        if (!touch) return;
        const loc = touch.getLocation();
        const lp = this._toLocal(loc.x, loc.y);
        const m = this._joyMove, a = this._joyAim;
        if (m.active && touch.getID() === m.pointerId) this._updateJoystick(m, lp.x, lp.y);
        else if (a.active && touch.getID() === a.pointerId) this._updateJoystick(a, lp.x, lp.y);
        this._sync();
    }

    /** 屏幕坐标 → 本节点本地坐标 */
    private _toLocal(x: number, y: number): { x: number; y: number } {
        const uit = this.node.getComponent(UITransform);
        if (uit) {
            const p = uit.convertToNodeSpaceAR(new Vec3(x, y, 0));
            return { x: p.x, y: p.y };
        }
        return { x, y };
    }

    private _onTouchEnd(e: EventTouch): void {
        const touch = e.touch;
        if (!touch) return;
        const m = this._joyMove, a = this._joyAim;
        if (m.active && touch.getID() === m.pointerId) this._endJoystick(m);
        else if (a.active && touch.getID() === a.pointerId) this._endJoystick(a);
        this._sync();
    }

    private _updateJoystick(j: JoystickState, x: number, y: number): void {
        let dx = x - j.baseX;
        let dy = y - j.baseY;
        let len = Math.sqrt(dx * dx + dy * dy);
        if (len > JOY_RADIUS) {
            const over = len - JOY_RADIUS;
            j.baseX += dx / len * over;
            j.baseY += dy / len * over;
            dx = x - j.baseX;
            dy = y - j.baseY;
            len = JOY_RADIUS;
        }
        j.dx = dx / JOY_RADIUS;
        j.dy = dy / JOY_RADIUS;
    }

    private _endJoystick(j: JoystickState): void {
        j.pointerId = -1;
        j.dx = 0;
        j.dy = 0;
        j.active = false;
    }

    private _onKeyDown(e: EventKeyboard): void {
        const code = e.keyCode;
        if (this._isDirKey(code)) {
            this._keys[code] = true;
            this._sync();
        }
    }

    private _onKeyUp(e: EventKeyboard): void {
        const code = e.keyCode;
        if (this._isDirKey(code)) {
            this._keys[code] = false;
            this._sync();
        }
    }

    private _isDirKey(code: KeyCode): boolean {
        return code === KeyCode.KEY_A || code === KeyCode.KEY_D ||
            code === KeyCode.KEY_W || code === KeyCode.KEY_S ||
            code === KeyCode.ARROW_LEFT || code === KeyCode.ARROW_RIGHT ||
            code === KeyCode.ARROW_UP || code === KeyCode.ARROW_DOWN;
    }

    /** 同步摇杆/键盘状态到输入向量（键盘优先） */
    private _sync(): void {
        let kx = 0, ky = 0;
        if (this._keys[KeyCode.KEY_A] || this._keys[KeyCode.ARROW_LEFT]) kx -= 1;
        if (this._keys[KeyCode.KEY_D] || this._keys[KeyCode.ARROW_RIGHT]) kx += 1;
        // 屏幕坐标 Y 向上为正：W/↑ 向上移动
        if (this._keys[KeyCode.KEY_W] || this._keys[KeyCode.ARROW_UP]) ky += 1;
        if (this._keys[KeyCode.KEY_S] || this._keys[KeyCode.ARROW_DOWN]) ky -= 1;

        if (kx !== 0 || ky !== 0) {
            const klen = Math.sqrt(kx * kx + ky * ky);
            this.moveX = kx / klen;
            this.moveY = ky / klen;
        } else {
            this._normalized(this._joyMove, (nx, ny) => { this.moveX = nx; this.moveY = ny; });
            this._normalized(this._joyAim, (nx, ny) => {
                this.aimX = nx;
                this.aimY = ny;
                this.aimActive = this._joyAim.active && (this._joyAim.dx !== 0 || this._joyAim.dy !== 0);
            });
        }
    }

    private _normalized(j: JoystickState, cb: (nx: number, ny: number) => void): void {
        const len = Math.sqrt(j.dx * j.dx + j.dy * j.dy);
        if (len < DEAD_ZONE) { cb(0, 0); return; }
        const scale = Math.min(1, (len - DEAD_ZONE) / (1 - DEAD_ZONE));
        cb(j.dx / len * scale, j.dy / len * scale);
    }

    /** 任意摇杆是否在操作 */
    anyActive(): boolean {
        return this._joyMove.active || this._joyAim.active;
    }

    /** 绘制摇杆 + 冲刺按钮（叠加在游戏画面之上） */
    update(dt: number): void {
        if (!this._gfx) return;
        const g = this._gfx;
        g.clear();
        if (this._joyMove.active) this._drawJoystick(g, this._joyMove);
        if (this._joyAim.active) this._drawJoystick(g, this._joyAim);
        this._updateHints(g, dt);
        this._updateDashButton(g);
    }

    /** 绘制冲刺按钮：就绪金色亮圈，冷却中灰圈 + 显示剩余秒数 */
    private _updateDashButton(g: Graphics): void {
        const playing = this.gameManager && this.gameManager.state === GameState.PLAYING;
        if (!playing) {
            if (this._dashBtn) this._dashBtn.getComponent(UIOpacity)!.opacity = 0;
            return;
        }
        const vs = view.getVisibleSize();
        // 本地坐标（中心原点），与命中检测一致
        this._dashBtnX = vs.width / 2 - 100;
        this._dashBtnY = vs.height / 2 - 100;

        const cd = this.gameManager?.playerController?.dashCooldown ?? 0;
        const ready = cd <= 0;
        g.fillColor = ready ? new Color(255, 200, 80, 150) : new Color(90, 100, 120, 110);
        g.circle(this._dashBtnX, this._dashBtnY, DASH_BTN_R);
        g.fill();
        g.lineWidth = 4;
        g.strokeColor = ready ? new Color(255, 230, 130, 230) : new Color(140, 150, 170, 170);
        g.circle(this._dashBtnX, this._dashBtnY, DASH_BTN_R);
        g.stroke();

        if (this._dashBtn) {
            this._dashBtn.setPosition(this._dashBtnX, this._dashBtnY, 0);
            const op = this._dashBtn.getComponent(UIOpacity)!;
            op.opacity = ready ? 255 : 150;
            const lbl = this._dashBtn.getComponent(Label)!;
            lbl.string = ready ? '⚡ 冲刺' : cd.toFixed(1) + 's';
        }
    }

    /** 提示淡出逻辑 + 淡显摇杆底圈 */
    private _updateHints(g: Graphics, dt: number): void {
        if (!this._hintsOn) return;
        if (this.gameManager && this.gameManager.state !== GameState.PLAYING) return;
        this._hintTime += dt;
        // 用过对应摇杆 → 开始淡出；8 秒未用也淡出
        if (this._joyMove.active || this._hintTime > 8) this._hintOpL = Math.max(0, this._hintOpL - 120 * dt);
        if (this._joyAim.active || this._hintTime > 8) this._hintOpR = Math.max(0, this._hintOpR - 120 * dt);
        if (this._hintL) this._hintL.getComponent(UIOpacity)!.opacity = this._hintOpL;
        if (this._hintR) this._hintR.getComponent(UIOpacity)!.opacity = this._hintOpR;
        // 淡显底圈：告诉玩家在哪里按
        if (this._hintOpL > 0 && !this._joyMove.active) {
            g.fillColor = new Color(127, 215, 255, Math.floor(this._hintOpL * 0.5));
            g.circle(this._hintLX, this._hintLY, JOY_RADIUS);
            g.fill();
        }
        if (this._hintOpR > 0 && !this._joyAim.active) {
            g.fillColor = new Color(127, 215, 255, Math.floor(this._hintOpR * 0.5));
            g.circle(this._hintRX, this._hintRY, JOY_RADIUS);
            g.fill();
        }
        if (this._hintOpL <= 0 && this._hintOpR <= 0) this._hintsOn = false;
    }

    private _drawJoystick(g: Graphics, j: JoystickState): void {
        // 基座
        g.fillColor = new Color(127, 215, 255, 89); // rgba(127,215,255,0.35)
        g.circle(j.baseX, j.baseY, JOY_RADIUS);
        g.fill();
        // 摇杆头
        g.fillColor = new Color(127, 215, 255, 153); // rgba(127,215,255,0.6)
        g.circle(j.baseX + j.dx * JOY_RADIUS, j.baseY + j.dy * JOY_RADIUS, JOY_KNOB);
        g.fill();
    }
}
