/**
 * game.js — 游戏状态机与主循环
 * 状态：MENU → PLAYING ⇄ LEVELUP/PAUSED → GAMEOVER
 * 固定 60Hz 逻辑步长 + 渲染帧钳制，保证不同刷新率下体验一致。
 */
(function () {
  'use strict';

  var CF = window.CF = window.CF || {};

  var canvas, ctx;
  var dpr = 1;
  var state = CF.STATE.BOOT;
  var lastTime = 0;
  var acc = 0;
  var fps = 0, fpsFrames = 0, fpsTimer = 0;

  CF.game = {
    viewW: 0, viewH: 0,
    playTime: 0,

    get state() { return state; },

    /* ================= 初始化 ================= */
    boot: function () {
      canvas = document.getElementById('game-canvas');
      ctx = canvas.getContext('2d', { alpha: false });
      CF.game._resize();
      window.addEventListener('resize', CF.game._resize);

      CF.sprites.init();
      CF.input.init(canvas);
      CF.ui.init(canvas);

      // 切后台自动暂停
      document.addEventListener('visibilitychange', function () {
        if (document.hidden && state === CF.STATE.PLAYING) CF.game.pause();
      });

      // 桌面端：菜单界面按回车/空格开始
      window.addEventListener('keydown', function (e) {
        if (state === CF.STATE.MENU && (e.code === 'Enter' || e.code === 'Space')) {
          e.preventDefault();
          CF.game.startGame();
        }
      });

      state = CF.STATE.MENU;
      CF.ui.showMenu();
      lastTime = performance.now();
      requestAnimationFrame(CF.game._loop);
    },

    _resize: function () {
      var w = window.innerWidth;
      var h = window.innerHeight;
      dpr = Math.min(window.devicePixelRatio || 1, CF.RENDER.DPR_CAP);
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = w + 'px';
      canvas.style.height = h + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      CF.game.viewW = w;
      CF.game.viewH = h;
      ctx.imageSmoothingEnabled = false;
    },

    /* ================= 状态切换 ================= */
    startGame: function () {
      CF.entities.reset();
      CF.enemies.reset();
      CF.projectiles.reset();
      CF.pickups.reset();
      CF.fx.reset();
      CF.spawner.reset();
      CF.world.init();
      CF.entities.spawnPlayer();
      CF.camera.snap(CF.PLAYER.START_X, CF.PLAYER.START_Y);
      CF.game.playTime = 0;
      state = CF.STATE.PLAYING;
      CF.ui.hide();
      lastTime = performance.now();
      acc = 0;
    },

    pause: function () {
      if (state !== CF.STATE.PLAYING) return;
      state = CF.STATE.PAUSED;
      CF.ui.showPause();
    },

    resume: function () {
      if (state !== CF.STATE.PAUSED) return;
      state = CF.STATE.PLAYING;
      CF.ui.hide();
      lastTime = performance.now();
      acc = 0;
    },

    onLevelUp: function () {
      if (state !== CF.STATE.PLAYING) return;
      state = CF.STATE.LEVELUP;
      CF.ui.showLevelUp(CF.upgrades.pickChoices(CF.UPGRADE.CHOICES));
    },

    chooseUpgrade: function (idx) {
      var choices = CF.ui.levelupChoices;
      if (idx < 0 || idx >= choices.length) return;
      CF.upgrades.apply(choices[idx]);
      state = CF.STATE.PLAYING;
      CF.ui.hide();
      lastTime = performance.now();
      acc = 0;
    },

    onPlayerDeath: function () {
      if (state !== CF.STATE.PLAYING) return;
      state = CF.STATE.GAMEOVER;
      CF.audio.gameover();
      CF.camera.addShake(12);
      var p = CF.entities.player;
      if (p && CF.fx) CF.fx.spawnExplosion(p.x, p.y, 40);
      CF.ui.showGameOver({
        time: CF.game.playTime,
        kills: CF.enemies.kills,
        wave: CF.spawner.wave,
        level: p ? p.level : 1
      });
    },

    /* ================= 主循环（固定步长） ================= */
    _loop: function (t) {
      requestAnimationFrame(CF.game._loop);
      var dt = (t - lastTime) / 1000;
      lastTime = t;
      if (dt > CF.RENDER.MAX_FRAME_DT) dt = CF.RENDER.MAX_FRAME_DT;

      acc += dt;
      var n = 0;
      while (acc >= CF.RENDER.FIXED_DT && n < 5) {
        CF.game.update(CF.RENDER.FIXED_DT);
        acc -= CF.RENDER.FIXED_DT;
        n++;
      }
      if (n >= 5) acc = 0; // 防螺旋死锁

      CF.game.render();

      // 调试 FPS
      if (CF.UI.DEBUG) {
        fpsFrames++;
        fpsTimer += dt;
        if (fpsTimer >= 0.5) {
          fps = Math.round(fpsFrames / fpsTimer);
          fpsFrames = 0;
          fpsTimer = 0;
        }
      }
    },

    update: function (dt) {
      switch (state) {
        case CF.STATE.PLAYING:
          CF.game._updatePlaying(dt);
          break;
        case CF.STATE.MENU:
        case CF.STATE.LEVELUP:
          CF.ui.update(dt);
          break;
        case CF.STATE.GAMEOVER:
          CF.fx.update(dt);
          CF.camera.update(dt);
          CF.ui.update(dt);
          break;
        default:
          break; // PAUSED 全冻结
      }
    },

    _updatePlaying: function (dt) {
      CF.game.playTime += dt;

      CF.entities.updatePlayer(dt);
      CF.spawner.update(dt);
      CF.enemies.update(dt);
      CF.projectiles.update(dt);
      CF.pickups.update(dt);
      CF.fx.update(dt);
      CF.world.updateSpikes(dt);
      CF.game._checkTerrainDamage();

      var p = CF.entities.player;
      if (p && !p.dead) CF.camera.follow(p.x, p.y, dt);
      CF.camera.update(dt);
      CF.ui.update(dt);
    },

    /** 尖刺/海胆接触伤害 */
    _checkTerrainDamage: function () {
      var p = CF.entities.player;
      if (!p || p.dead || p.invincible > 0) return;
      var T = CF.TERRAIN;
      var si = CF.world.spikeAt(p.x, p.y, p.radius);
      if (si >= 0) {
        var sp = CF.world.spikes[si];
        if (sp.cd <= 0) {
          sp.cd = T.SPIKE_COOLDOWN;
          CF.entities.damagePlayer(T.SPIKE_DAMAGE, sp.x, sp.y);
          CF.audio.spikeHit();
        }
        return;
      }
      var ui = CF.world.urchinAt(p.x, p.y, p.radius);
      if (ui >= 0) {
        var ur = CF.world.urchins[ui];
        if (ur.cd <= 0) {
          ur.cd = T.URCHIN_COOLDOWN;
          CF.entities.damagePlayer(T.URCHIN_DAMAGE, ur.x, ur.y);
          CF.audio.spikeHit();
        }
      }
    },

    /* ================= 渲染（分层） ================= */
    render: function () {
      var vw = CF.game.viewW, vh = CF.game.viewH;

      // 背景（世界外虚空）
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, vw, vh);

      // 地面 + 地形
      CF.world.render(ctx, CF.camera.viewRect());

      // 海底光柱（氛围）
      CF.fx.renderGodRays(ctx, CF.game.playTime);

      // 拾取物
      CF.pickups.render(ctx);

      // 敌人（含精英激光）
      CF.enemies.render(ctx);

      // 玩家
      CF.entities.renderPlayer(ctx);

      // 子弹
      CF.projectiles.render(ctx);

      // 粒子特效
      CF.fx.render(ctx);

      // 虚拟摇杆
      CF.input.draw(ctx);

      // UI（HUD/弹窗/通知）
      CF.ui.draw(ctx);

      // 调试信息
      if (CF.UI.DEBUG) {
        ctx.fillStyle = 'rgba(255,255,255,0.8)';
        ctx.font = '12px monospace';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        var activeCount = 0;
        var all = CF.entities.all;
        for (var i = 0; i < all.length; i++) {
          if (all[i] && all[i].active) activeCount++;
        }
        ctx.fillText('FPS:' + fps + ' ENT:' + activeCount + ' WAVE:' + CF.spawner.wave +
          ' ELITES:' + CF.spawner.eliteCount, 10, CF.game.viewH - 40);
      }
    }
  };
})();
