/**
 * enemies.js — 敌人系统（对象池）
 * 普通敌人：追逐玩家 + 接触伤害，随波次缩放属性
 * 精英敌人：激光三态状态机（追踪→预警1s→光束0.8s→冷却），
 *           死亡时圆形爆发24发子弹 + 掉落大宝石 + 震屏
 */
(function () {
  'use strict';

  var CF = window.CF = window.CF || {};

  var POOL_SIZE = 320;
  var pool = [];
  var next = 0;

  // 四种敌人外观行为差异：[速度倍率, 接触伤害倍率, 半径]
  var TYPES = [
    { spd: 1.0, dmg: 1.0, r: 13 },
    { spd: 0.75, dmg: 1.2, r: 15 },
    { spd: 1.25, dmg: 0.85, r: 12 },
    { spd: 0.9, dmg: 1.1, r: 14 }
  ];

  // 网格查询复用缓冲
  var tmpNear = [];

  function alloc() {
    if (pool.length < POOL_SIZE) {
      var e = CF.entities.create('enemy', 0, 0, 13);
      e.type = 0;
      e.hp = 1; e.maxHp = 1;
      e.speed = 1;
      e.damage = 1;
      e.dead = false;
      e.hitFlash = 0;
      e.knockX = 0; e.knockY = 0;
      e.faceAngle = 0;
      // 精英字段
      e.isElite = false;
      e.laserState = 'idle';
      e.laserTimer = 0;
      e.laserAngle = 0;
      e.laserDamageTick = 0;
      pool.push(e);
      return e;
    }
    var old = pool[next];
    next = (next + 1) % POOL_SIZE;
    return old;
  }

  CF.enemies = {
    pool: pool,
    kills: 0,

    reset: function () {
      pool.length = 0;
      next = 0;
      CF.enemies.kills = 0;
    },

    /** 生成普通敌人 */
    spawnNormal: function (x, y, wave, type) {
      var E = CF.ENEMY;
      var t = TYPES[type % TYPES.length];
      var e = alloc();
      e.kind = 'enemy';
      e.active = true;
      e.dead = false;
      e.isElite = false;
      e.x = x; e.y = y;
      e.type = type % TYPES.length;
      e.radius = t.r;
      // 指数血量成长：30 * 1.16^(wave-1)
      e.maxHp = e.hp = Math.round(E.HP_BASE * Math.pow(1 + E.HP_GROWTH, wave - 1));
      // 速度线性成长 + 封顶
      e.speed = Math.min(E.SPEED_MAX, E.SPEED_BASE + E.SPEED_GROWTH * (wave - 1)) * t.spd;
      // 伤害成长 + 封顶（循序渐进，后期不秒人但持续加压）
      var dmgMult = Math.min(E.DMG_MAX_MULT, 1 + E.DMG_GROWTH * (wave - 1));
      e.damage = E.CONTACT_DAMAGE * dmgMult * t.dmg;
      // 经验随波次成长（后期升级不掉队）
      e.xp = Math.round(E.XP_VALUE + E.XP_GROWTH * (wave - 1));
      e.hitFlash = 0;
      e.knockX = 0; e.knockY = 0;
      return e;
    },

    /** 生成精英敌人 */
    spawnElite: function (x, y, eliteCount) {
      var EL = CF.ELITE;
      var e = alloc();
      e.kind = 'elite';
      e.active = true;
      e.dead = false;
      e.isElite = true;
      e.x = x; e.y = y;
      e.radius = EL.RADIUS;
      e.maxHp = e.hp = Math.round(EL.HP * Math.pow(1 + EL.HP_GROWTH, eliteCount));
      e.speed = EL.SPEED;
      var dmgMult = Math.min(EL.DMG_MAX_MULT, 1 + EL.DMG_GROWTH * eliteCount);
      e.damage = EL.CONTACT_DAMAGE * dmgMult;
      e.xp = EL.XP_VALUE;
      e.hitFlash = 0;
      e.knockX = 0; e.knockY = 0;
      e.laserState = 'idle';
      e.laserTimer = EL.LASER_COOLDOWN;
      e.laserAngle = 0;
      e.laserDamageTick = 0;
      return e;
    },

    /** 伤害敌人（子弹命中） */
    hurtEnemy: function (e, damage, bx, by) {
      if (!e.active || e.dead) return;
      e.hp -= damage;
      e.hitFlash = 0.08;
      // 击退
      var a = Math.atan2(e.y - by, e.x - bx);
      e.knockX += Math.cos(a) * CF.BULLET.KNOCKBACK;
      e.knockY += Math.sin(a) * CF.BULLET.KNOCKBACK;
      if (e.hp <= 0) CF.enemies.killEnemy(e);
    },

    /** 击杀处理：掉落 + 特效 + 计分 */
    killEnemy: function (e) {
      if (!e.active || e.dead) return;
      e.dead = true;
      e.active = false;
      CF.enemies.kills++;

      if (e.isElite) {
        CF.audio.explosion();
        CF.camera.addShake(10);
        // 圆形爆发 24 发
        var EL = CF.ELITE;
        for (var i = 0; i < EL.BURST_COUNT; i++) {
          CF.projectiles.spawnEliteBullet(e.x, e.y, (Math.PI * 2 / EL.BURST_COUNT) * i, EL.BURST_SPEED, 15);
        }
        // 大宝石溅射
        if (CF.pickups) {
          CF.pickups.spawnBigGem(e.x, e.y);
          CF.pickups.spawnGems(e.x, e.y, 8, 90);
        }
        if (CF.fx) CF.fx.spawnExplosion(e.x, e.y, 30);
      } else {
        CF.audio.kill();
        if (CF.pickups) CF.pickups.onEnemyKilled(e.x, e.y);
        if (CF.fx) CF.fx.spawnBurst(e.x, e.y, 8);
      }
    },

    /** 清除所有敌人 */
    clear: function () {
      for (var i = 0; i < pool.length; i++) pool[i].active = false;
    },

    update: function (dt) {
      var player = CF.entities.player;
      var p = player;

      // 1) 重建空间哈希网格（每帧 O(N)）
      CF.world.clearGrid();
      for (var gi = 0; gi < pool.length; gi++) {
        if (pool[gi].active && !pool[gi].dead) CF.world.insertEntity(pool[gi]);
      }

      // 2) 更新行为
      for (var i = 0; i < pool.length; i++) {
        var e = pool[i];
        if (!e.active || e.dead) continue;

        if (e.hitFlash > 0) e.hitFlash -= dt;

        // 击退衰减
        if (e.knockX !== 0 || e.knockY !== 0) {
          e.x += e.knockX * dt;
          e.y += e.knockY * dt;
          var damp = Math.pow(0.02, dt);
          e.knockX *= damp;
          e.knockY *= damp;
          if (Math.abs(e.knockX) + Math.abs(e.knockY) < 4) {
            e.knockX = 0; e.knockY = 0;
          }
          continue; // 击退期间不追玩家
        }

        if (e.isElite) {
          CF.enemies._updateElite(e, dt);
        } else {
          CF.enemies._updateNormal(e, dt);
        }
      }

      // 3) 玩家接触伤害（网格宽相位）
      if (p && !p.dead && p.invincible <= 0) {
        var nearby = CF.world.queryCircleCollect(p.x, p.y, 40, tmpNear, 24);
        for (var j = 0; j < nearby.length; j++) {
          var en = nearby[j];
          if (en.kind !== 'enemy' && en.kind !== 'elite') continue;
          var rr = en.radius + p.radius;
          if (CF.util.dist2(en.x, en.y, p.x, p.y) < rr * rr) {
            CF.entities.damagePlayer(en.damage, en.x, en.y);
          }
        }
      }
    },

    _updateNormal: function (e, dt) {
      if (!CF.entities.player || CF.entities.player.dead) return;
      var p = CF.entities.player;
      var a = Math.atan2(p.y - e.y, p.x - e.x);
      e.faceAngle = a;
      var nx = e.x + Math.cos(a) * e.speed * dt;
      var ny = e.y + Math.sin(a) * e.speed * dt;
      var pos = CF.world.moveResolve(nx, ny, e.radius);
      e.x = pos[0]; e.y = pos[1];
    },

    _updateElite: function (e, dt) {
      var EL = CF.ELITE;
      var p = CF.entities.player;
      if (!p || p.dead) return;

      if (e.laserState === 'idle') {
        // 追踪玩家
        var a = Math.atan2(p.y - e.y, p.x - e.x);
        e.faceAngle = a;
        var nx = e.x + Math.cos(a) * e.speed * dt;
        var ny = e.y + Math.sin(a) * e.speed * dt;
        var pos = CF.world.moveResolve(nx, ny, e.radius);
        e.x = pos[0]; e.y = pos[1];

        e.laserTimer -= dt;
        if (e.laserTimer <= 0) {
          // 锁定目标角度，进入预警
          e.laserState = 'windup';
          e.laserTimer = EL.LASER_WINDUP;
          e.laserAngle = Math.atan2(p.y - e.y, p.x - e.x);
          CF.audio.laserWarn();
        }
      } else if (e.laserState === 'windup') {
        // 预警：原地不动
        e.laserTimer -= dt;
        if (e.laserTimer <= 0) {
          e.laserState = 'firing';
          e.laserTimer = EL.LASER_DURATION;
          e.laserDamageTick = 0;
          CF.audio.laser();
        }
      } else if (e.laserState === 'firing') {
        // 光束：对线内玩家持续伤害
        e.laserTimer -= dt;
        if (e.laserTimer <= 0) {
          e.laserState = 'idle';
          e.laserTimer = EL.LASER_COOLDOWN;
        } else if (!p.dead) {
          var distToElite = Math.sqrt(CF.util.dist2(p.x, p.y, e.x, e.y));
          if (distToElite < EL.LASER_MAX_RANGE) {
            // 点到线段（精英→激光方向）距离
            var dx = Math.cos(e.laserAngle);
            var dy = Math.sin(e.laserAngle);
            var px = p.x - e.x, py = p.y - e.y;
            var proj = px * dx + py * dy;
            if (proj > 0) {
              var perp = Math.abs(px * dy - py * dx);
              var width = EL.LASER_WIDTH / 2 + p.radius;
              if (perp < width) {
                e.laserDamageTick -= dt;
                if (e.laserDamageTick <= 0) {
                  e.laserDamageTick = 0.1;
                  CF.entities.damagePlayer(EL.LASER_DAMAGE_PER_SEC * 0.1, e.x, e.y);
                }
              }
            }
          }
        }
      }
    },

    render: function (ctx) {
      var spr = CF.sprites.enemies;
      var sprElite = CF.sprites.elite;
      var vw = CF.game.viewW, vh = CF.game.viewH;

      for (var i = 0; i < pool.length; i++) {
        var e = pool[i];
        if (!e.active || e.dead) continue;
        var sx = CF.camera.sx(e.x);
        var sy = CF.camera.sy(e.y);
        if (sx < -60 || sx > vw + 60 || sy < -60 || sy > vh + 60) continue;

        // 精英激光预警线（在敌人下层画）
        if (e.isElite && e.laserState === 'windup') {
          ctx.strokeStyle = 'rgba(255,60,80,' + (0.35 + 0.3 * Math.sin(performance.now() / 60)) + ')';
          ctx.lineWidth = 4;
          ctx.beginPath();
          ctx.moveTo(sx, sy);
          ctx.lineTo(sx + Math.cos(e.laserAngle) * CF.ELITE.LASER_MAX_RANGE,
                      sy + Math.sin(e.laserAngle) * CF.ELITE.LASER_MAX_RANGE);
          ctx.stroke();
        }

        // 激光光束
        if (e.isElite && e.laserState === 'firing') {
          var len = CF.ELITE.LASER_MAX_RANGE;
          var ex = sx + Math.cos(e.laserAngle) * len;
          var ey = sy + Math.sin(e.laserAngle) * len;
          var grad = ctx.createLinearGradient(sx, sy, ex, ey);
          grad.addColorStop(0, 'rgba(255,80,60,0.9)');
          grad.addColorStop(1, 'rgba(255,40,80,0.15)');
          ctx.strokeStyle = grad;
          ctx.lineWidth = CF.ELITE.LASER_WIDTH;
          ctx.beginPath();
          ctx.moveTo(sx, sy);
          ctx.lineTo(ex, ey);
          ctx.stroke();
          // 白色核心
          ctx.strokeStyle = 'rgba(255,255,255,0.8)';
          ctx.lineWidth = 6;
          ctx.beginPath();
          ctx.moveTo(sx, sy);
          ctx.lineTo(ex, ey);
          ctx.stroke();
        }

        // 敌人本体
        var img = e.isElite ? sprElite : spr[e.type];
        var w = e.radius * 2.2;
        ctx.save();
        ctx.translate(sx, sy);
        ctx.rotate(e.faceAngle);
        // 受击闪烁：白闪叠加
        if (e.hitFlash > 0) {
          ctx.globalAlpha = 0.6;
          ctx.drawImage(img, -w / 2, -w / 2, w, w);
          ctx.globalAlpha = 1;
          ctx.fillStyle = 'rgba(255,255,255,' + (e.hitFlash * 8) + ')';
          ctx.fillRect(-w / 2, -w / 2, w, w);
        } else {
          ctx.drawImage(img, -w / 2, -w / 2, w, w);
        }
        ctx.restore();

        // 精英血条
        if (e.isElite && e.hp < e.maxHp) {
          var bw = 48;
          ctx.fillStyle = 'rgba(0,0,0,0.5)';
          ctx.fillRect(sx - bw / 2, sy - 34, bw, 5);
          ctx.fillStyle = '#ff5a7a';
          ctx.fillRect(sx - bw / 2, sy - 34, bw * (e.hp / e.maxHp), 5);
        }
      }
    }
  };
})();
