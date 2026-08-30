/**
 * CameraFollow.ts — 相机平滑跟随 + 震屏
 * 挂在 Main Camera 节点上。
 * Cocos 相机自动处理世界→屏幕坐标转换，无需手动 sx/sy。
 */
import { _decorator, Component, Camera, Vec3, view } from 'cc';
import { clamp } from '../util';
import { WORLD } from '../config';
const { ccclass, property } = _decorator;

@ccclass('CameraFollow')
export class CameraFollow extends Component {

    @property target: any = null; // 跟随目标（Node），由 GameManager 设置

    private _shakeMag = 0;
    private _shakeTime = 0;
    private _basePos = new Vec3();
    private _tmpPos = new Vec3();

    /** 直接对齐到目标位置（开局/重开） */
    snap(wx: number, wy: number): void {
        this.node.setPosition(wx, wy, this.node.position.z);
        this._basePos.set(wx, wy, this.node.position.z);
        this._shakeMag = 0;
        this._shakeTime = 0;
        this._clamp();
    }

    /** 平滑跟随目标（每帧 update 调用） */
    follow(tx: number, ty: number, dt: number): void {
        const k = 1 - Math.pow(0.001, dt); // 帧率无关的指数平滑
        const pos = this.node.position;
        const nx = pos.x + (tx - pos.x) * k;
        const ny = pos.y + (ty - pos.y) * k;
        this._basePos.set(nx, ny, pos.z);
        this._clamp();
    }

    /** 触发震屏 */
    addShake(mag: number): void {
        this._shakeMag = Math.max(this._shakeMag, mag);
        this._shakeTime = 0.3;
    }

    /** 每帧更新震屏衰减 */
    updateShake(dt: number): void {
        if (this._shakeTime > 0) {
            this._shakeTime -= dt;
            const m = this._shakeMag * (this._shakeTime / 0.3);
            const ox = (Math.random() * 2 - 1) * m;
            const oy = (Math.random() * 2 - 1) * m;
            this._tmpPos.set(this._basePos.x + ox, this._basePos.y + oy, this._basePos.z);
            this.node.setPosition(this._tmpPos);
            if (this._shakeTime <= 0) {
                this._shakeMag = 0;
                this.node.setPosition(this._basePos);
            }
        }
    }

    /** 约束相机不超出世界边界 */
    private _clamp(): void {
        const s = WORLD.SIZE;
        const vw = view.getVisibleSize().width;
        const vh = view.getVisibleSize().height;
        const halfW = vw / 2;
        const halfH = vh / 2;
        const cx = clamp(this._basePos.x, halfW, s - halfW);
        const cy = clamp(this._basePos.y, halfH, s - halfH);
        this._basePos.x = cx;
        this._basePos.y = cy;
        if (this._shakeTime <= 0) {
            this.node.setPosition(this._basePos);
        }
    }

    /** 获取当前相机中心世界坐标 */
    getWorldPos(out: Vec3): Vec3 {
        out.set(this._basePos);
        return out;
    }
}
