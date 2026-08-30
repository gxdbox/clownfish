/**
 * NotifyToast.ts — 顶部提示（精英来袭/拾取加成/波次提示）
 * 挂在 NotifyToast 节点上。
 * 文字与背景动态创建（不依赖场景节点，避免引用缺失导致空画面）。
 * Cocos Creator 3.8.8 迁移版
 */
import { _decorator, Component, Color, Label, tween, UIOpacity } from 'cc';
import { createLabel, createPanel } from '../util';
import type { GameManager } from '../managers/GameManager';
const { ccclass } = _decorator;

@ccclass('NotifyToast')
export class NotifyToast extends Component {

    toastLabel: Label | null = null;

    private _timer = 0;
    private _active = false;

    onLoad(): void {
        // 动态创建提示背景 + 文字
        createPanel(this.node, 0, 0, 480, 52, new Color(0, 0, 0, 170), 26);
        this.toastLabel = createLabel(this.node, '', 0, 0, 24, new Color(255, 240, 200, 255));
        this.node.active = false;
    }

    /** 显示提示（由 GameManager.notify 触发） */
    show(text: string): void {
        if (!this.toastLabel) return;
        this.toastLabel.string = text;
        this.node.active = true;
        this._timer = 2.2;
        this._active = true;

        // 淡入
        let opacity = this.node.getComponent(UIOpacity);
        if (!opacity) {
            opacity = this.node.addComponent(UIOpacity);
        }
        opacity.opacity = 0;
        tween(opacity)
            .to(0.2, { opacity: 255 })
            .start();
    }

    update(dt: number): void {
        if (!this._active) return;

        this._timer -= dt;
        if (this._timer <= 0) {
            this._active = false;
            // 淡出
            const opacity = this.node.getComponent(UIOpacity);
            if (opacity) {
                tween(opacity)
                    .to(0.3, { opacity: 0 })
                    .call(() => { this.node.active = false; })
                    .start();
            } else {
                this.node.active = false;
            }
        }
    }
}
