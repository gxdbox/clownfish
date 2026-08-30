/**
 * pickups.js — 拾取物系统（对象池 + 磁吸飞行）
 * gem/bigGem: 经验宝石（击杀掉落，磁吸拾取）
 * range: 拾取范围+25%（永久）
 * boost: 速度+20%（15秒，带拖尾）
 * hp/hpBig: 血球/大血球（回复生命）
 * shield: 护盾（抵挡一次伤害）
 */
(function () {
  'use strict';

  var CF = window.CF = window.CF || {};

  var POOL_SIZE = 240;
  var pool = [];
  var next = 0;

  function alloc() {
    if (pool.length < POOL_SIZE) {
      var p = CF.entities.create('pickup', 0, 0, 8);
      p.type = 'gem';
      p.value = 0;
      p.age = 0;
      p.flying = false;
      pool.push(p);
      return p;
    }
    var old = pool[next];
    next = (next + 1) % POOL_SIZE;
    return old;
  }

  CF.pickups = {
    pool: pool,

    reset: function () {
      pool.length = 0;
      next = 0;
    },

    /** 溅射生成 n 颗经验宝石 */
    spawnGems: function (x, y, n, radius) {
      for (var i = 0; i < n; i++) {
        var p = alloc();
        p.kind = 'pickup';
        p.active = true;
        p.type = 'gem';
        p.value = CF.PICKUP.GEM_VALUE;
        p.radius = CF.PICKUP.GEM_RADIUS;
        var a = Math.random() * Math.PI * 2;
        var r = Math.random() * radius;
        p.x = x + Math.cos(a) * r;
        p.y = y + Math.sin(a) * r;
        p.age = 0;
        p.flying = false;
        // 世界边界约束
        p.x = CF.util.clamp(p.x, 20, CF.WORLD.SIZE - 20);
        p.y = CF.util.clamp(p.y, 20, CF.WORLD.SIZE - 20);
      }
    },

    /** 大宝石（精英掉落） */
    spawnBigGem: function (x, y) {
      var p = alloc();
      p.kind = 'pickup';
      p.active = true;
      p.type = 'bigGem';
      p.value = CF.PICKUP.BIG_GEM_VALUE;
      p.radius = CF.PICKUP.BIG_GEM_RADIUS;
      p.x = x; p.y = y;
      p.age = 0;
      p.flying = false;
      // 精英必掉大血球 + 大概率额外加成拾取物
      var D = CF.DROP;
      if (D.ELITE_HP_BIG) CF.pickups.spawnPickup(x, y, 'hpBig');
      if (Math.random() < D.ELITE_BONUS_CHANCE) {
        var bonus = ['range', 'boost', 'shield'][Math.floor(Math.random() * 3)];
        CF.pickups.spawnPickup(x, y, bonus);
      }
      return p;
    },

    /** 加成拾取物 */
    spawnPickup: function (x, y, type) {
      var p = alloc();
      p.kind = 'pickup';
      p.active = true;
      p.type = type;
      p.value = 0;
      p.radius = CF.PICKUP[type === 'hpBig' ? 'HP_BIG_RADIUS' : type === 'hp' ? 'HP_RADIUS' : type === 'shield' ? 'SHIELD_RADIUS' : type === 'range' ? 'RANGE_RADIUS' : 'BOOST_RADIUS'];
      p.x = x; p.y = y;
      p.age = 0;
      p.flying = false;
      return p;
    },

    /** 击杀掉落入口：宝石 + 概率表（血球/磁铁/加速/护盾） */
    onEnemyKilled: function (x, y) {
      CF.pickups.spawnGems(x, y, CF.ENEMY.XP_VALUE, 70);
      var D = CF.DROP;
      var r = Math.random();
      // 掉落优先级：血球 > 护盾 > 加速 > 磁铁
      if (r < D.HP_CHANCE) {
        CF.pickups.spawnPickup(x, y, 'hp');
      } else if (r < D.HP_CHANCE + D.SHIELD_CHANCE) {
        CF.pickups.spawnPickup(x, y, 'shield');
      } else if (r < D.HP_CHANCE + D.SHIELD_CHANCE + D.BOOST_CHANCE) {
        CF.pickups.spawnPickup(x, y, 'boost');
      } else if (r < D.HP_CHANCE + D.SHIELD_CHANCE + D.BOOST_CHANCE + D.RANGE_CHANCE) {
        CF.pickups.spawnPickup(x, y, 'range');
      }
    },

    update: function (dt) {
      var P = CF.PICKUP;
      var player = CF.entities.player;
      var p;

      for (var i = 0; i < pool.length; i++) {
        p = pool[i];
        if (!p.active) continue;

        p.age += dt;
        if (p.age >= P.DESPAWN_TIME) {
          p.active = false;
          continue;
        }

        if (!player || player.dead) continue;
        var range = player.pickupRange;

        // 磁吸飞行
        if (p.flying) {
          var dx = player.x - p.x;
          var dy = player.y - p.y;
          var d = Math.sqrt(dx * dx + dy * dy);
          if (d < 1) d = 1;
          var speed = P.FLY_SPEED + P.FLY_ACCEL * (1 - d / range);
          p.x += dx / d * speed * dt;
          p.y += dy / d * speed * dt;
        } else if (CF.util.dist2(p.x, p.y, player.x, player.y) < range * range) {
          p.flying = true;
        }

        // 拾取判定
        var rr = player.radius + p.radius;
        if (CF.util.dist2(p.x, p.y, player.x, player.y) < rr * rr) {
          p.active = false;
          CF.audio.pickup();
          if (p.type === 'gem' || p.type === 'bigGem') {
            CF.entities.addExp(p.value);
          } else {
            CF.entities.applyPickup(p.type);
            if (CF.fx) CF.fx.spawnPickupFlash(player.x, player.y, p.type);
            var msg = {
              range: '✦ 攻击范围 +25%',
              boost: '⚡ 移动速度 +20%（15秒）',
              hp: '❤ 生命 +' + CF.PICKUP.HP_AMOUNT,
              hpBig: '❤ 生命 +' + CF.PICKUP.HP_BIG_AMOUNT,
              shield: '🛡 获得一层护盾'
            }[p.type];
            if (CF.ui && msg) CF.ui.notify(msg);
          }
        }
      }
    },

    render: function (ctx) {
      var sprGem = CF.sprites.gem;
      var sprBig = CF.sprites.bigGem;
      var sprRange = CF.sprites.rangePickup;
      var sprBoost = CF.sprites.boostPickup;
      var sprHp = CF.sprites.hpPickup;
      var sprHpBig = CF.sprites.hpBigPickup;
      var sprShield = CF.sprites.shieldPickup;
      var vw = CF.game.viewW, vh = CF.game.viewH;

      for (var i = 0; i < pool.length; i++) {
        var p = pool[i];
        if (!p.active) continue;
        var sx = CF.camera.sx(p.x);
        var sy = CF.camera.sy(p.y);
        if (sx < -30 || sx > vw + 30 || sy < -30 || sy > vh + 30) continue;

        // 消失前闪烁
        if (p.age > CF.PICKUP.DESPAWN_TIME - 5 && Math.floor(p.age * 6) % 2 === 0) continue;

        var img, w;
        if (p.type === 'gem') { img = sprGem; w = p.radius * 2; }
        else if (p.type === 'bigGem') { img = sprBig; w = p.radius * 2; }
        else if (p.type === 'range') { img = sprRange; w = p.radius * 2.2; }
        else if (p.type === 'boost') { img = sprBoost; w = p.radius * 2.2; }
        else if (p.type === 'hp') { img = sprHp; w = p.radius * 2.2; }
        else if (p.type === 'hpBig') { img = sprHpBig; w = p.radius * 2.2; }
        else { img = sprShield; w = p.radius * 2.2; }
        ctx.drawImage(img, sx - w / 2, sy - w / 2, w, w);
      }
    }
  };
})();
