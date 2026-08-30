/**
 * spawner.js — 波次与敌人生成器
 * 波次：每 WAVE.DURATION 秒一波，属性随波次缩放；
 *       生成间隔随波次衰减（上限）。
 * 精英：每 ELITE.SPAWN_INTERVAL 秒生成一只（场上上限 MAX_ELITES），
 *       生命随已生成精英数成长。
 * 生成位置：玩家屏幕外随机环绕。
 */
(function () {
  'use strict';

  var CF = window.CF = window.CF || {};

  CF.spawner = {
    wave: 1,
    waveTimer: 0,
    spawnTimer: 0,
    spawnInterval: CF.ENEMY.SPAWN_INTERVAL,
    eliteTimer: CF.ELITE.SPAWN_INTERVAL,
    eliteCount: 0,

    reset: function () {
      var s = CF.spawner;
      s.wave = 1;
      s.waveTimer = 0;
      s.spawnTimer = 0;
      s.spawnInterval = CF.ENEMY.SPAWN_INTERVAL;
      s.eliteTimer = CF.ELITE.SPAWN_INTERVAL;
      s.eliteCount = 0;
    },

    /** 屏幕外生成点（世界坐标） */
    spawnPoint: function () {
      var P = CF.ENEMY;
      var player = CF.entities.player;
      var px = player ? player.x : CF.PLAYER.START_X;
      var py = player ? player.y : CF.PLAYER.START_Y;
      var halfDiag = Math.sqrt(CF.game.viewW * CF.game.viewW + CF.game.viewH * CF.game.viewH) / 2;
      var dist = Math.max(P.SPAWN_DIST, halfDiag + P.SPAWN_OFFSET);
      var angle = Math.random() * Math.PI * 2;
      var x = CF.util.clamp(px + Math.cos(angle) * dist, 60, CF.WORLD.SIZE - 60);
      var y = CF.util.clamp(py + Math.sin(angle) * dist, 60, CF.WORLD.SIZE - 60);
      return [x, y];
    },

    update: function (dt) {
      var s = CF.spawner;
      var E = CF.ENEMY;
      var EL = CF.ELITE;
      var player = CF.entities.player;
      if (!player || player.dead) return;

      // ---- 波次计时 ----
      s.waveTimer += dt;
      if (s.waveTimer >= CF.WAVE.DURATION) {
        s.waveTimer -= CF.WAVE.DURATION;
        s.wave++;
        s.spawnInterval = Math.max(E.SPAWN_INTERVAL_MIN, s.spawnInterval * E.SPAWN_INTERVAL_DECAY);
        // 每 5 波提示难度升级
        if (CF.ui && s.wave % CF.WAVE.NOTE_EVERY === 0) {
          CF.ui.notify('⚠ 第 ' + s.wave + ' 波：敌人显著增强了！');
        }
      }

      // ---- 普通敌人 ----
      s.spawnTimer -= dt;
      if (s.spawnTimer <= 0) {
        s.spawnTimer = s.spawnInterval;
        var pt = s.spawnPoint();
        CF.enemies.spawnNormal(pt[0], pt[1], s.wave, Math.floor(Math.random() * 4));
      }

      // ---- 精英敌人（间隔随波次缩短，上限随波次提升） ----
      s.eliteTimer -= dt;
      var activeElites = 0;
      var pool = CF.enemies.pool;
      for (var i = 0; i < pool.length; i++) {
        if (pool[i].active && pool[i].isElite) activeElites++;
      }
      var maxElites = s.wave >= 25 ? 5 : s.wave >= 15 ? 4 : s.wave >= 8 ? 3 : 2;
      if (s.eliteTimer <= 0 && activeElites < maxElites) {
        s.eliteTimer = Math.max(EL.SPAWN_INTERVAL_MIN, EL.SPAWN_INTERVAL * Math.pow(EL.SPAWN_INTERVAL_DECAY, s.wave - 1));
        s.eliteCount++;
        var pt2 = s.spawnPoint();
        CF.enemies.spawnElite(pt2[0], pt2[1], s.eliteCount);
        // 精英登场提示
        if (CF.ui) CF.ui.notify('⚠ 精英敌人来袭！');
      }
    }
  };
})();
