/**
 * input.js — Pointer Events 双虚拟摇杆（多点触控）
 * 左半屏：移动摇杆（浮动式，按下即定位）
 * 右半屏：瞄准摇杆（可选；不操作时自动攻击最近敌人）
 * touchId 追踪保证多点触控互不干扰。
 */
(function () {
  'use strict';

  var CF = window.CF = window.CF || {};

  var JOY_RADIUS = 52;      // 摇杆基座半径
  var JOY_KNOB = 24;        // 摇杆头半径
  var DEAD_ZONE = 0.18;     // 死区

  var canvas = null;
  var keys = {};            // 键盘按键状态（桌面端）

  // 键盘方向映射（WASD + 方向键）
  var KEY_LEFT = { KeyA: 1, ArrowLeft: 1 };
  var KEY_RIGHT = { KeyD: 1, ArrowRight: 1 };
  var KEY_UP = { KeyW: 1, ArrowUp: 1 };
  var KEY_DOWN = { KeyS: 1, ArrowDown: 1 };

  /** 单个摇杆实例（对象池避免 GC） */
  function Joystick(zone) {
    this.zone = zone;       // 'move' | 'aim'
    this.pointerId = -1;
    this.baseX = 0; this.baseY = 0;
    this.dx = 0; this.dy = 0;
    this.active = false;
  }
  Joystick.prototype.start = function (id, x, y) {
    this.pointerId = id;
    this.baseX = x; this.baseY = y;
    this.dx = 0; this.dy = 0;
    this.active = true;
  };
  Joystick.prototype.update = function (x, y) {
    var dx = x - this.baseX;
    var dy = y - this.baseY;
    var len = Math.sqrt(dx * dx + dy * dy);
    if (len > JOY_RADIUS) {
      // 基座跟随手指（浮动式），限制摇杆头在半径内
      var over = len - JOY_RADIUS;
      this.baseX += dx / len * over;
      this.baseY += dy / len * over;
      dx = x - this.baseX;
      dy = y - this.baseY;
      len = JOY_RADIUS;
    }
    this.dx = dx / JOY_RADIUS;
    this.dy = dy / JOY_RADIUS;
  };
  Joystick.prototype.end = function () {
    this.pointerId = -1;
    this.dx = 0; this.dy = 0;
    this.active = false;
  };
  /** 归一化方向（带死区） */
  Joystick.prototype.normalized = function (out) {
    var len = Math.sqrt(this.dx * this.dx + this.dy * this.dy);
    if (len < DEAD_ZONE) { out[0] = 0; out[1] = 0; return out; }
    var scale = Math.min(1, (len - DEAD_ZONE) / (1 - DEAD_ZONE));
    out[0] = this.dx / len * scale;
    out[1] = this.dy / len * scale;
    return out;
  };

  CF.input = {
    moveX: 0, moveY: 0,     // 移动方向（归一化）
    aimX: 0, aimY: 0,       // 瞄准方向（归一化）
    aimActive: false,       // 是否正在手动瞄准
    joyMove: null,
    joyAim: null,

    init: function (cvs) {
      canvas = cvs;
      CF.input.joyMove = new Joystick('move');
      CF.input.joyAim = new Joystick('aim');

      canvas.addEventListener('pointerdown', CF.input._onDown);
      canvas.addEventListener('pointermove', CF.input._onMove);
      canvas.addEventListener('pointerup', CF.input._onUp);
      canvas.addEventListener('pointercancel', CF.input._onUp);

      // 桌面端键盘控制（WASD/方向键），preventDefault 防页面滚动
      window.addEventListener('keydown', function (e) {
        if (KEY_LEFT[e.code] || KEY_RIGHT[e.code] || KEY_UP[e.code] || KEY_DOWN[e.code]) {
          e.preventDefault();
          keys[e.code] = true;
          CF.input._sync();
        }
      });
      window.addEventListener('keyup', function (e) {
        keys[e.code] = false;
        CF.input._sync();
      });
      // 窗口失焦时清空按键，防止卡方向
      window.addEventListener('blur', function () {
        keys = {};
        CF.input._sync();
      });
    },

    _onDown: function (e) {
      CF.audio.unlock(); // 首次触摸解锁音频
      var rect = canvas.getBoundingClientRect();
      var x = e.clientX - rect.left;
      var y = e.clientY - rect.top;
      var joy = x < rect.width * 0.45 ? CF.input.joyMove : CF.input.joyAim;
      if (joy.active) return; // 该摇杆已被占用
      joy.start(e.pointerId, x, y);
      CF.input._sync();
    },

    _onMove: function (e) {
      var rect = canvas.getBoundingClientRect();
      var x = e.clientX - rect.left;
      var y = e.clientY - rect.top;
      var m = CF.input.joyMove, a = CF.input.joyAim;
      if (m.active && e.pointerId === m.pointerId) m.update(x, y);
      else if (a.active && e.pointerId === a.pointerId) a.update(x, y);
      CF.input._sync();
    },

    _onUp: function (e) {
      var m = CF.input.joyMove, a = CF.input.joyAim;
      if (m.active && e.pointerId === m.pointerId) m.end();
      else if (a.active && e.pointerId === a.pointerId) a.end();
      CF.input._sync();
    },

    /** 同步摇杆/键盘状态到输入向量（键盘优先，便于桌面端） */
    _sync: function () {
      // 键盘方向（归一化）
      var kx = 0, ky = 0;
      if (keys.KeyA || keys.ArrowLeft) kx -= 1;
      if (keys.KeyD || keys.ArrowRight) kx += 1;
      if (keys.KeyW || keys.ArrowUp) ky -= 1;
      if (keys.KeyS || keys.ArrowDown) ky += 1;
      if (kx !== 0 || ky !== 0) {
        var klen = Math.sqrt(kx * kx + ky * ky);
        CF.input.moveX = kx / klen;
        CF.input.moveY = ky / klen;
      } else {
        // 摇杆输入
        var m = CF.input.joyMove, a = CF.input.joyAim;
        var tmp = [0, 0];
        m.normalized(tmp);
        CF.input.moveX = tmp[0];
        CF.input.moveY = tmp[1];
        a.normalized(tmp);
        CF.input.aimX = tmp[0];
        CF.input.aimY = tmp[1];
        CF.input.aimActive = a.active && (a.dx !== 0 || a.dy !== 0);
      }
    },

    /** 任意摇杆是否在操作（用于暂停菜单判定等） */
    anyActive: function () {
      return CF.input.joyMove.active || CF.input.joyAim.active;
    },

    /** 绘制摇杆（叠加在游戏画面之上） */
    draw: function (ctx) {
      var m = CF.input.joyMove, a = CF.input.joyAim;
      if (m.active) CF.input._drawJoystick(ctx, m);
      if (a.active) CF.input._drawJoystick(ctx, a);
    },

    _drawJoystick: function (ctx, j) {
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = '#7fd7ff';
      ctx.beginPath();
      ctx.arc(j.baseX, j.baseY, JOY_RADIUS, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 0.6;
      ctx.beginPath();
      ctx.arc(j.baseX + j.dx * JOY_RADIUS, j.baseY + j.dy * JOY_RADIUS, JOY_KNOB, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  };
})();
