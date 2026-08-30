/**
 * camera.js — 相机（Lerp 平滑跟随 + 震屏 + 世界边界约束）
 */
(function () {
  'use strict';

  var CF = window.CF = window.CF || {};

  CF.camera = {
    x: 0, y: 0,           // 相机中心（世界坐标）
    shakeX: 0, shakeY: 0,
    shakeMag: 0,
    shakeTime: 0,

    init: function (wx, wy) {
      CF.camera.x = wx;
      CF.camera.y = wy;
      CF.camera.shakeMag = 0;
      CF.camera.shakeTime = 0;
    },

    /** 平滑跟随目标（固定时间步长内调用） */
    follow: function (tx, ty, dt) {
      var k = 1 - Math.pow(0.001, dt); // 帧率无关的指数平滑
      CF.camera.x += (tx - CF.camera.x) * k;
      CF.camera.y += (ty - CF.camera.y) * k;
      CF.camera._clamp();
    },

    /** 直接对齐（开局/重开） */
    snap: function (wx, wy) {
      CF.camera.x = wx;
      CF.camera.y = wy;
      CF.camera._clamp();
    },

    /** 震屏 */
    addShake: function (mag) {
      CF.camera.shakeMag = Math.max(CF.camera.shakeMag, mag);
      CF.camera.shakeTime = 0.3;
    },

    /** 每帧更新震屏衰减 */
    update: function (dt) {
      if (CF.camera.shakeTime > 0) {
        CF.camera.shakeTime -= dt;
        var m = CF.camera.shakeMag * (CF.camera.shakeTime / 0.3);
        CF.camera.shakeX = (Math.random() * 2 - 1) * m;
        CF.camera.shakeY = (Math.random() * 2 - 1) * m;
        if (CF.camera.shakeTime <= 0) {
          CF.camera.shakeMag = 0;
          CF.camera.shakeX = 0;
          CF.camera.shakeY = 0;
        }
      }
    },

    _clamp: function () {
      var s = CF.WORLD.SIZE;
      var halfW = CF.game.viewW / 2;
      var halfH = CF.game.viewH / 2;
      CF.camera.x = CF.util.clamp(CF.camera.x, halfW, s - halfW);
      CF.camera.y = CF.util.clamp(CF.camera.y, halfH, s - halfH);
    },

    /** 世界坐标 → 屏幕坐标（渲染时叠加震屏偏移） */
    sx: function (wx) { return wx - CF.camera.x + CF.game.viewW / 2 + CF.camera.shakeX; },
    sy: function (wy) { return wy - CF.camera.y + CF.game.viewH / 2 + CF.camera.shakeY; },

    /** 屏幕坐标 → 世界坐标（拾取判定等） */
    wx: function (sx) { return sx - CF.game.viewW / 2 + CF.camera.x; },
    wy: function (sy) { return sy - CF.game.viewH / 2 + CF.camera.y; },

    /** 当前可见世界矩形 [x0,y0,x1,y1] */
    viewRect: function () {
      var halfW = CF.game.viewW / 2;
      var halfH = CF.game.viewH / 2;
      return [
        CF.camera.x - halfW - 64, CF.camera.y - halfH - 64,
        CF.camera.x + halfW + 64, CF.camera.y + halfH + 64
      ];
    }
  };
})();
