/**
 * entities.js — 实体注册表 + 玩家（移动/自动攻击/受击/升级）
 * 实体统一注册到 all[]，id 即数组索引；active=false 视为死亡。
 * 自动攻击：右摇杆操作时沿瞄准方向，否则攻击射程内最近敌人。
 */
(function () {
  'use strict';

  var CF = window.CF = window.CF || {};

  var player = null; // 单例

  CF.entities = {
    all: [],
    nextId: 1,

    /** 当前玩家（单例，重置后为 null） */
    get player() { return player; },

    reset: function () {
      CF.entities.all.length = 0;
      CF.entities.nextId = 1;
      player = null;
    },

    get: function (id) {
      return CF.entities.all[id];
    },

    create: function (kind, x, y, radius) {
      var e = {
        id: CF.entities.nextId++,
        kind: kind,
        x: x, y: y,
        radius: radius,
        active: true
      };
      CF.entities.all[e.id] = e;
      return e;
    },

    destroy: function (e) {
      e.active = false;
    },

    /* ================= 玩家 ================= */
    spawnPlayer: function () {
      var P = CF.PLAYER;
      player = CF.entities.create('player', P.START_X, P.START_Y, P.RADIUS);
      player.maxHp = P.MAX_HP;
      player.hp = P.MAX_HP;
      player.level = 1;
      player.exp = 0;
      player.expNext = CF.entities.expNeed(1);
      player.speed = P.SPEED;
      player.fireInterval = P.FIRE_INTERVAL;
      player.bulletSpeed = P.BULLET_SPEED;
      player.bulletCount = P.BULLET_COUNT;
      player.bulletDamage = P.BULLET_DAMAGE;
      player.bulletRange = P.BULLET_RANGE;
      player.pierce = CF.BULLET.PIERCE_DEFAULT;
      player.pickupRange = P.PICKUP_RANGE;
      player.regen = P.REGEN_PER_SEC;
      player.fireTimer = 0;
      player.invincible = 0;
      player.shield = 0;        // 护盾层数（受击先扣盾）
      player.boostTimer = 0;
      player.boostMult = 1;
      player.faceAngle = 0;
      player.dead = false;
      return player;
    },

    expNeed: function (level) {
      return 8 + level * 4;
    },

    updatePlayer: function (dt) {
      if (!player || player.dead) return;

      // ---- 移动 ----
      var ix = CF.input.moveX, iy = CF.input.moveY;
      if (ix !== 0 || iy !== 0) {
        var speed = player.speed * player.boostMult;
        var nx = player.x + ix * speed * dt;
        var ny = player.y + iy * speed * dt;
        // 墙滑动解析（圆形-AABB 推出）
        var pos = CF.world.moveResolve(nx, ny, player.radius);
        player.x = CF.util.clamp(pos[0], player.radius, CF.WORLD.SIZE - player.radius);
        player.y = CF.util.clamp(pos[1], player.radius, CF.WORLD.SIZE - player.radius);
        player.faceAngle = Math.atan2(iy, ix);
        // 加速拖尾
        if (player.boostTimer > 0 && CF.fx) CF.fx.spawnTrail(player.x, player.y);
      }

      // ---- 计时 ----
      if (player.invincible > 0) player.invincible -= dt;
      if (player.boostTimer > 0) {
        player.boostTimer -= dt;
        if (player.boostTimer <= 0) player.boostMult = 1;
      }

      // ---- 回血 ----
      if (player.regen > 0 && player.hp < player.maxHp) {
        player.hp = Math.min(player.maxHp, player.hp + player.regen * dt);
      }

      // ---- 自动攻击 ----
      player.fireTimer -= dt;
      if (player.fireTimer <= 0) CF.entities.firePlayer();
    },

    /** 开火：瞄准方向或最近敌人，扇形发射 */
    firePlayer: function () {
      var P = CF.PLAYER;
      var angle;
      if (CF.input.aimActive) {
        angle = Math.atan2(CF.input.aimY, CF.input.aimX);
        player.faceAngle = angle;
      } else {
        var target = CF.entities.findNearestEnemy(player.x, player.y, player.bulletRange * 1.2);
        if (!target) return; // 无目标不开火
        angle = Math.atan2(target.y - player.y, target.x - player.x);
        player.faceAngle = angle;
      }
      var n = player.bulletCount;
      var spread = (n - 1) * 0.12; // 扇形总角
      var base = angle - spread / 2;
      for (var i = 0; i < n; i++) {
        var a = n === 1 ? angle : base + i * (spread / Math.max(1, n - 1));
        CF.projectiles.spawnPlayerBullet(
          player.x, player.y, a,
          player.bulletDamage, player.bulletSpeed, player.bulletRange, player.pierce
        );
      }
      player.fireTimer = player.fireInterval;
      CF.audio.shoot();
    },

    /** 射程内最近敌人（自动攻击目标，网格查询） */
    findNearestEnemy: function (x, y, maxDist) {
      var tmp = [];
      CF.world.queryCircleCollect(x, y, maxDist, tmp, 64);
      var best = null;
      var bestD2 = maxDist * maxDist;
      for (var i = 0; i < tmp.length; i++) {
        var e = tmp[i];
        if (e.kind !== 'enemy' && e.kind !== 'elite') continue;
        var d2 = CF.util.dist2(x, y, e.x, e.y);
        if (d2 < bestD2) { bestD2 = d2; best = e; }
      }
      return best;
    },

    /** 玩家受击（护盾优先吸收） */
    damagePlayer: function (amount, srcX, srcY) {
      if (!player || player.dead || player.invincible > 0) return;
      if (player.shield > 0) {
        // 护盾吸收：只消耗一层，短无敌防连击
        player.shield--;
        player.invincible = 0.35;
        CF.audio.pickup();
        if (CF.fx) CF.fx.spawnHurt(player.x, player.y);
        if (CF.ui) CF.ui.notify('🛡 护盾抵挡了伤害！');
        return;
      }
      player.hp -= amount;
      player.invincible = CF.PLAYER.INVINCIBLE_TIME;
      // 击退
      var a = Math.atan2(player.y - srcY, player.x - srcX);
      var kx = Math.cos(a) * CF.PLAYER.KNOCKBACK;
      var ky = Math.sin(a) * CF.PLAYER.KNOCKBACK;
      var nx = CF.util.clamp(player.x + kx * 0.08, player.radius, CF.WORLD.SIZE - player.radius);
      var ny = CF.util.clamp(player.y + ky * 0.08, player.radius, CF.WORLD.SIZE - player.radius);
      var pos = CF.world.moveResolve(nx, ny, player.radius);
      player.x = pos[0]; player.y = pos[1];
      CF.audio.hurt();
      if (CF.fx) CF.fx.spawnHurt(player.x, player.y);
      if (player.hp <= 0) {
        player.hp = 0;
        player.dead = true;
        CF.game.onPlayerDeath();
      }
    },

    /** 增加经验，返回是否升级（由 game 处理升级弹窗） */
    addExp: function (amount) {
      if (!player || player.dead) return false;
      player.exp += amount;
      var leveled = false;
      while (player.exp >= player.expNext) {
        player.exp -= player.expNext;
        player.level++;
        player.expNext = CF.entities.expNeed(player.level);
        player.hp = Math.min(player.maxHp, player.hp + 10); // 升级小回血
        leveled = true;
      }
      if (leveled) {
        CF.audio.levelup();
        CF.game.onLevelUp();
      }
      return leveled;
    },

    /** 叠加拾取物加成 */
    applyPickup: function (type) {
      var P = CF.PICKUP;
      if (type === 'range') {
        player.bulletRange *= (1 + P.RANGE_BONUS);
        player.pickupRange *= (1 + P.RANGE_BONUS);
      } else if (type === 'boost') {
        player.boostMult = 1 + P.BOOST_SPEED_BONUS;
        player.boostTimer = P.BOOST_DURATION;
      } else if (type === 'hp') {
        player.hp = Math.min(player.maxHp, player.hp + P.HP_AMOUNT);
      } else if (type === 'hpBig') {
        player.hp = Math.min(player.maxHp, player.hp + P.HP_BIG_AMOUNT);
      } else if (type === 'shield') {
        player.shield = Math.min(P.SHIELD_MAX, player.shield + 1);
      }
    },

    renderPlayer: function (ctx) {
      if (!player) return;
      var e = player;
      // 无敌闪烁
      if (e.invincible > 0 && Math.floor(e.invincible * 12) % 2 === 0) {
        ctx.globalAlpha = 0.4;
      }
      ctx.save();
      ctx.translate(CF.camera.sx(e.x), CF.camera.sy(e.y));
      ctx.rotate(e.faceAngle);
      CF.sprites.draw32(ctx, CF.sprites.player, 0, 0, e.radius * 2.2);
      ctx.restore();
      ctx.globalAlpha = 1;
      // 护盾光环
      if (e.shield > 0) {
        ctx.save();
        ctx.strokeStyle = 'rgba(90,140,255,' + (0.35 + 0.15 * Math.sin(Date.now() / 200)) + ')';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(CF.camera.sx(e.x), CF.camera.sy(e.y), e.radius * 1.7, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
      // 拾取范围提示（调试）
      if (CF.UI.DEBUG) {
        ctx.strokeStyle = 'rgba(120,255,180,0.25)';
        ctx.beginPath();
        ctx.arc(CF.camera.sx(e.x), CF.camera.sy(e.y), e.pickupRange, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  };
})();
