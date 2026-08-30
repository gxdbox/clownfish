/**
 * fx.js — 粒子特效系统（对象池，像素风方块粒子）
 * 命中火花 / 击杀爆发 / 精英爆炸 / 受伤红粒 / 加速拖尾 / 拾取闪光
 */
(function () {
  'use strict';

  var CF = window.CF = window.CF || {};

  var POOL_SIZE = 420;
  var pool = [];
  var next = 0;

  // 环境气泡（世界坐标，缓慢上浮，循环使用）
  var BUBBLE_COUNT = 12;
  var bubbles = [];
  var bubbleTimer = 0;
  for (var bi = 0; bi < BUBBLE_COUNT; bi++) {
    bubbles.push({ active: false, x: 0, y: 0, r: 2, life: 0, maxLife: 1, drift: 0 });
  }

  var COLORS = {
    hit: ['#ffe95a', '#ffb03a', '#fff7a8'],
    burst: ['#3ae88a', '#5af8aa', '#ffffff'],
    explosion: ['#ff5a3a', '#ffd23a', '#ff9a3a', '#ffffff'],
    hurt: ['#ff3a5a', '#ff7a8a', '#ffc0c8'],
    trail: ['#5ae0ff', '#7fd7ff', '#ffffff'],
    flash: ['#b84ae8', '#fff7a8', '#5ae0ff']
  };

  function alloc() {
    if (pool.length < POOL_SIZE) {
      var p = {
        active: false,
        x: 0, y: 0,
        vx: 0, vy: 0,
        life: 0, maxLife: 0,
        size: 2,
        color: '#fff'
      };
      pool.push(p);
      return p;
    }
    var old = pool[next];
    next = (next + 1) % POOL_SIZE;
    return old;
  }

  function emit(x, y, count, colors, speedMin, speedMax, life, size) {
    for (var i = 0; i < count; i++) {
      var p = alloc();
      p.active = true;
      p.x = x; p.y = y;
      var a = Math.random() * Math.PI * 2;
      var sp = CF.util.rand(speedMin, speedMax);
      p.vx = Math.cos(a) * sp;
      p.vy = Math.sin(a) * sp;
      p.life = p.maxLife = CF.util.rand(life * 0.6, life);
      p.size = size || 3;
      p.color = colors[Math.floor(Math.random() * colors.length)];
    }
  }

  CF.fx = {
    pool: pool,

    reset: function () {
      pool.length = 0;
      next = 0;
      for (var i = 0; i < BUBBLE_COUNT; i++) bubbles[i].active = false;
      bubbleTimer = 0;
    },

    spawnHit: function (x, y) { emit(x, y, 4, COLORS.hit, 60, 160, 0.22, 3); },
    spawnBurst: function (x, y, n) { emit(x, y, n || 8, COLORS.burst, 40, 140, 0.35, 3); },
    spawnExplosion: function (x, y, n) {
      emit(x, y, n || 30, COLORS.explosion, 80, 320, 0.6, 5);
      emit(x, y, 12, COLORS.burst, 40, 180, 0.4, 3);
    },
    spawnHurt: function (x, y) { emit(x, y, 10, COLORS.hurt, 60, 200, 0.4, 3); },
    spawnTrail: function (x, y) { emit(x, y, 2, COLORS.trail, 20, 60, 0.3, 3); },
    spawnPickupFlash: function (x, y, type) {
      emit(x, y, 14, COLORS.flash, 60, 200, 0.5, 4);
    },

    update: function (dt) {
      for (var i = 0; i < pool.length; i++) {
        var p = pool[i];
        if (!p.active) continue;
        p.life -= dt;
        if (p.life <= 0) { p.active = false; continue; }
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        // 简单阻力
        var damp = Math.pow(0.05, dt);
        p.vx *= damp;
        p.vy *= damp;
      }

      // ---- 环境气泡 ----
      bubbleTimer -= dt;
      if (bubbleTimer <= 0) {
        bubbleTimer = 0.7;
        var pl = CF.entities.player;
        if (pl && !pl.dead) {
          var bp = bubbles[Math.floor(Math.random() * BUBBLE_COUNT)];
          bp.active = true;
          bp.x = pl.x + CF.util.rand(-280, 280);
          bp.y = pl.y + CF.util.rand(-400, 280);
          bp.r = CF.util.rand(2, 4);
          bp.maxLife = CF.util.rand(1.5, 2.6);
          bp.life = bp.maxLife;
          bp.drift = CF.util.rand(-12, 12);
        }
      }
      for (var j = 0; j < BUBBLE_COUNT; j++) {
        var b = bubbles[j];
        if (!b.active) continue;
        b.life -= dt;
        if (b.life <= 0) { b.active = false; continue; }
        b.y -= 42 * dt;
        b.x += b.drift * dt;
      }
    },

    /** 海底光柱（god rays，屏幕坐标，缓慢漂移） */
    renderGodRays: function (ctx, time) {
      var vw = CF.game.viewW, vh = CF.game.viewH;
      var spr = CF.sprites.godRay;
      var h = Math.min(vh, 620);
      var xs = [
        vw * (0.16 + 0.08 * Math.sin(time * 0.11)),
        vw * (0.42 + 0.06 * Math.sin(time * 0.07 + 1.7)),
        vw * (0.74 + 0.07 * Math.sin(time * 0.09 + 3.2))
      ];
      for (var i = 0; i < 3; i++) {
        ctx.globalAlpha = 0.10 * (0.7 + 0.3 * Math.sin(time * 0.5 + i * 2.1));
        ctx.drawImage(spr, xs[i] - 70, 0, 140, h);
      }
      ctx.globalAlpha = 1;
    },

    render: function (ctx) {
      for (var i = 0; i < pool.length; i++) {
        var p = pool[i];
        if (!p.active) continue;
        var sx = CF.camera.sx(p.x);
        var sy = CF.camera.sy(p.y);
        if (sx < -20 || sx > CF.game.viewW + 20 || sy < -20 || sy > CF.game.viewH + 20) continue;
        ctx.globalAlpha = p.life / p.maxLife;
        ctx.fillStyle = p.color;
        var s = p.size * (0.5 + 0.5 * (p.life / p.maxLife));
        ctx.fillRect(sx - s / 2, sy - s / 2, s, s);
      }
      ctx.globalAlpha = 1;

      // 环境气泡（半透明蓝圈 + 高光）
      var vw = CF.game.viewW, vh = CF.game.viewH;
      for (var j = 0; j < BUBBLE_COUNT; j++) {
        var b = bubbles[j];
        if (!b.active) continue;
        var bx = CF.camera.sx(b.x);
        var by = CF.camera.sy(b.y);
        if (bx < -20 || bx > vw + 20 || by < -20 || by > vh + 20) continue;
        ctx.globalAlpha = 0.3 * (b.life / b.maxLife);
        ctx.strokeStyle = '#bfe8ff';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(bx, by, b.r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,0.7)';
        ctx.fillRect(bx - 1, by - b.r * 0.6, 2, 2);
      }
      ctx.globalAlpha = 1;
    }
  };
})();
