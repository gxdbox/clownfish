/**
 * Joystick.ts — 双虚拟摇杆 + 键盘 WASD
 * 挂在 JoystickNode 上。左半屏移动摇杆，右半屏瞄准摇杆。
 * 桌面端支持 WASD / 方向键。
 */
import { _decorator, Component, input, Input, EventTouch, EventKeyboard, KeyCode, Graphics, Vec2, Vec3, view, Color, UITransform } from 'cc';
import { GameState } from '../config';
import type { GameManager } from '../managers/GameManager';
const { ccclass, property } = _decorator;

const JOY_RADIUS = 52;
const JOY_KNOB = 24;
const DEAD_ZONE = 0.18;

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

    /** 绘制摇杆（叠加在游戏画面之上） */
    update(): void {
        if (!this._gfx) return;
        const g = this._gfx;
        g.clear();
        if (this._joyMove.active) this._drawJoystick(g, this._joyMove);
        if (this._joyAim.active) this._drawJoystick(g, this._joyAim);
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
