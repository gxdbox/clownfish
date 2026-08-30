/**
 * upgrades.js — 升级卡池（三选一，可重复叠加）
 * 每次升级从卡池随机抽取 CHOICES 个不重复的选项。
 */
(function () {
  'use strict';

  var CF = window.CF = window.CF || {};

  // 卡池定义（apply 接收玩家对象）
  var POOL = [
    { id: 'bulletSpeed', name: '子弹速度', desc: '子弹飞行速度 +20%', icon: '➤',
      apply: function (pl) { pl.bulletSpeed *= 1.2; } },
    { id: 'bulletCount', name: '多重射击', desc: '子弹数量 +1', icon: '✦',
      apply: function (pl) { pl.bulletCount++; } },
    { id: 'fireRate', name: '急速射击', desc: '射击间隔 -15%', icon: '⚡',
      apply: function (pl) { pl.fireInterval *= 0.85; } },
    { id: 'damage', name: '强化弹头', desc: '子弹伤害 +15%', icon: '💥',
      apply: function (pl) { pl.bulletDamage *= 1.15; } },
    { id: 'pierce', name: '贯穿弹', desc: '子弹穿透 +1', icon: '🔱',
      apply: function (pl) { pl.pierce++; } },
    { id: 'moveSpeed', name: '灵巧游动', desc: '移动速度 +10%', icon: '🐟',
      apply: function (pl) { pl.speed *= 1.1; } },
    { id: 'maxHp', name: '强壮体魄', desc: '最大生命 +25 并回复', icon: '❤',
      apply: function (pl) { pl.maxHp += 25; pl.hp = Math.min(pl.maxHp, pl.hp + 25); } },
    { id: 'heal', name: '自我修复', desc: '立即回复 40 生命', icon: '💚',
      apply: function (pl) { pl.hp = Math.min(pl.maxHp, pl.hp + 40); } },
    { id: 'pickupRange', name: '磁力吸引', desc: '拾取范围 +20%', icon: '🧲',
      apply: function (pl) { pl.pickupRange *= 1.2; } },
    { id: 'regen', name: '再生', desc: '每秒回复 1 生命', icon: '🌿',
      apply: function (pl) { pl.regen += 1; } }
  ];

  CF.upgrades = {
    pool: POOL,

    /** 随机抽取 n 个不重复升级 */
    pickChoices: function (n) {
      var idx = [];
      for (var i = 0; i < POOL.length; i++) idx.push(i);
      // Fisher-Yates 部分洗牌
      for (var j = idx.length - 1; j > 0; j--) {
        var k = Math.floor(Math.random() * (j + 1));
        var t = idx[j]; idx[j] = idx[k]; idx[k] = t;
      }
      var out = [];
      for (var m = 0; m < n && m < idx.length; m++) out.push(POOL[idx[m]]);
      return out;
    },

    /** 应用升级 */
    apply: function (upgrade) {
      var pl = CF.entities.player;
      if (pl && upgrade.apply) upgrade.apply(pl);
    }
  };
})();
