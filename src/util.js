/**
 * util.js — 通用工具函数（无分配优先）
 */
(function () {
  'use strict';

  var CF = window.CF = window.CF || {};

  CF.util = {
    clamp: function (v, min, max) {
      return v < min ? min : (v > max ? max : v);
    },

    lerp: function (a, b, t) {
      return a + (b - a) * t;
    },

    /** 两点距离平方（热点路径用，避免开方） */
    dist2: function (x1, y1, x2, y2) {
      var dx = x2 - x1;
      var dy = y2 - y1;
      return dx * dx + dy * dy;
    },

    rand: function (min, max) {
      return min + Math.random() * (max - min);
    },

    randInt: function (min, max) {
      return Math.floor(min + Math.random() * (max - min + 1));
    },

    randPick: function (arr) {
      return arr[Math.floor(Math.random() * arr.length)];
    },

    /** 返回 [cos, sin]（避免分配对象） */
    dirVector: function (angle) {
      return [Math.cos(angle), Math.sin(angle)];
    },

    angleTo: function (x1, y1, x2, y2) {
      return Math.atan2(y2 - y1, x2 - x1);
    },

    /** 角度插值（处理±π环绕） */
    angleLerp: function (a, b, t) {
      var diff = b - a;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      return a + diff * t;
    },

    /** 矩形重叠检测 */
    rectOverlap: function (ax, ay, aw, ah, bx, by, bw, bh) {
      return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
    },

    /** 保留一位小数 */
    round1: function (v) {
      return Math.round(v * 10) / 10;
    },

    /** 格式化时间 mm:ss */
    formatTime: function (sec) {
      var m = Math.floor(sec / 60);
      var s = Math.floor(sec % 60);
      return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
    }
  };
})();
