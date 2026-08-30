/**
 * projectiles.js — 子弹系统（对象池）
 * playerBullet：玩家子弹，命中敌人造成伤害 + 击退，支持穿透
 * eliteBullet：精英爆发弹，命中玩家造成伤害
 * 池容量上限防 GC：满池时覆盖最旧活跃子弹。
 */
(function () {
  'use strict';

  var CF = window.CF = window.CF || {};

  var POOL_SIZE = 512;
  var pool = [];
  var next = 0;

  // 网格查询复用缓冲（含精英最大半径 22）
  var tmpNear = [];

  function alloc() {
    if (pool.length < POOL_SIZE) {
      var b = CF.entities.create('bullet', 0, 0, 1);
      b.hostile = false;   // true = 敌方子弹
      b.vx = 0; b.vy = 0;
      b.damage = 0;
      b.range = 0;
      b.traveled = 0;
      b.pierce = 0;
      pool.push(b);
      return b;
    }
    // 池满：复用最旧槽位
    var old = pool[next];
    next = (next + 1) % POOL_SIZE;
    return old;
  }

  function spawn(x, y, angle, speed, damage, range, hostile, pierce) {
    var b = alloc();
    b.kind = 'bullet';
    b.active = true;
    b.hostile = hostile;
    b.x = x; b.y = y;
    b.vx = Math.cos(angle) * speed;
    b.vy = Math.sin(angle) * speed;
    b.damage = damage;
    b.range = range;
    b.traveled = 0;
    b.pierce = pierce || 0;
    b.radius = hostile ? CF.PICKUP.GEM_RADIUS + 4 : CF.BULLET.RADIUS;
    return b;
  }

  CF.projectiles = {
    pool: pool,

    reset: function () {
      pool.length = 0;
      next = 0;
    },

    /** 玩家子弹 */
    spawnPlayerBullet: function (x, y, angle, damage, speed, range, pierce) {
      return spawn(x, y, angle, speed, damage, range, false, pierce);
    },

    /** 精英圆形爆发弹 */
    spawnEliteBullet: function (x, y, angle, speed, damage) {
      return spawn(x, y, angle, speed, damage, 1200, true, 0);
    },

    /** 清除全部子弹 */
    clear: function () {
      for (var i = 0; i < pool.length; i++) pool[i].active = false;
    },

    update: function (dt) {
      var e = CF.entities;
      var enemies = CF.enemies;
      var player = CF.entities.player;
      var w = CF.world;
      var s = CF.WORLD.SIZE;

      for (var i = 0; i < pool.length; i++) {
        var b = pool[i];
        if (!b.active) continue;

        b.x += b.vx * dt;
        b.y += b.vy * dt;
        b.traveled += Math.sqrt(b.vx * b.vx + b.vy * b.vy) * dt;

        // 生命周期终止
        if (b.traveled >= b.range ||
            b.x < 0 || b.x > s || b.y < 0 || b.y > s ||
            w.collideWalls(b.x, b.y, b.radius, false)) {
          b.active = false;
          continue;
        }

        if (!b.hostile) {
          // ---- 玩家子弹 vs 敌人（网格宽相位） ----
          var nearby = CF.world.queryCircleCollect(b.x, b.y, b.radius + 22, tmpNear, 16);
          var hit = false;
          for (var j = 0; j < nearby.length; j++) {
            var en = nearby[j];
            if (en.kind !== 'enemy' && en.kind !== 'elite') continue;
            var rr = en.radius + b.radius;
            if (CF.util.dist2(b.x, b.y, en.x, en.y) < rr * rr) {
              enemies.hurtEnemy(en, b.damage, b.x, b.y);
              if (CF.fx) CF.fx.spawnHit(b.x, b.y);
              hit = true;
              if (b.pierce > 0) {
                b.pierce--;
              } else {
                break;
              }
            }
          }
          if (hit && b.pierce < 0) b.active = false;
        } else {
          // ---- 敌方子弹 vs 玩家 ----
          if (player && !player.dead) {
            var rr = player.radius + b.radius;
            if (CF.util.dist2(b.x, b.y, player.x, player.y) < rr * rr) {
              CF.entities.damagePlayer(b.damage, b.x, b.y);
              b.active = false;
            }
          }
        }
      }
    },

    render: function (ctx) {
      var spr = CF.sprites.bullet;
      var sprE = CF.sprites.eliteBullet;
      for (var i = 0; i < pool.length; i++) {
        var b = pool[i];
        if (!b.active) continue;
        var sx = CF.camera.sx(b.x);
        var sy = CF.camera.sy(b.y);
        if (sx < -20 || sx > CF.game.viewW + 20 || sy < -20 || sy > CF.game.viewH + 20) continue;
        var img = b.hostile ? sprE : spr;
        var w = b.radius * 2.4;
        ctx.save();
        ctx.translate(sx, sy);
        ctx.rotate(Math.atan2(b.vy, b.vx));
        ctx.drawImage(img, -w / 2, -w / 2, w, w);
        ctx.restore();
      }
    }
  };
})();
