/**
 * ui.js — 界面系统（全部 Canvas 绘制，无 DOM）
 * 模式：menu 开始菜单 / levelup 升级卡 / paused 暂停 / gameover 结算
 * HUD：生命条、等级、波次、计时、经验条、暂停/静音按钮
 * 按钮触控：pointerdown 记录起点，pointerup 位移 < 20px 判定为点击
 */
(function () {
  'use strict';

  var CF = window.CF = window.CF || {};

  var BTN_H = 48;              // 触控目标 ≥44px
  var TAP_TOLERANCE = 20;

  var canvas = null;
  var buttons = [];            // 当前可见按钮
  var tapX = 0, tapY = 0, tapId = -1;

  var mode = 'none';
  var levelupChoices = [];
  var levelupAnim = 0;         // 卡牌弹入动画进度 0→1
  var gameoverStats = null;

  var notifyText = '';
  var notifyTimer = 0;

  function btn(x, y, w, h, label, cb, sub) {
    buttons.push({ x: x, y: y, w: w, h: h, label: label, cb: cb, sub: sub || '' });
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawButton(ctx, b) {
    roundRect(ctx, b.x, b.y, b.w, b.h, 10);
    ctx.fillStyle = 'rgba(30,50,90,0.9)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(127,215,255,0.6)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = '#eaf6ff';
    ctx.font = 'bold 17px "PingFang SC", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(b.label, b.x + b.w / 2, b.y + b.h / 2 - 4);
    if (b.sub) {
      ctx.fillStyle = 'rgba(180,220,255,0.7)';
      ctx.font = '12px "PingFang SC", sans-serif';
      ctx.fillText(b.sub, b.x + b.w / 2, b.y + b.h / 2 + 13);
    }
  }

  function centerX(w) { return (CF.game.viewW - w) / 2; }

  CF.ui = {
    get mode() { return mode; },
    get levelupChoices() { return levelupChoices; },

    init: function (cvs) {
      canvas = cvs;
      canvas.addEventListener('pointerdown', CF.ui._onDown);
      canvas.addEventListener('pointerup', CF.ui._onUp);
      canvas.addEventListener('pointercancel', CF.ui._onUp);
    },

    _onDown: function (e) {
      if (mode === 'none') return;
      var rect = canvas.getBoundingClientRect();
      tapX = e.clientX - rect.left;
      tapY = e.clientY - rect.top;
      tapId = e.pointerId;
    },

    _onUp: function (e) {
      if (mode === 'none' || tapId !== e.pointerId) return;
      tapId = -1;
      var rect = canvas.getBoundingClientRect();
      var x = e.clientX - rect.left;
      var y = e.clientY - rect.top;
      var dx = x - tapX, dy = y - tapY;
      if (dx * dx + dy * dy > TAP_TOLERANCE * TAP_TOLERANCE) return; // 拖拽不算点击
      for (var i = 0; i < buttons.length; i++) {
        var b = buttons[i];
        if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) {
          b.cb();
          return;
        }
      }
    },

    /* ================= 界面切换 ================= */
    showMenu: function () {
      mode = 'menu';
      buttons = [];
      var vw = CF.game.viewW, vh = CF.game.viewH;
      var bw = Math.min(240, vw - 80);
      btn(centerX(bw), vh * 0.58, bw, BTN_H, '开始游戏', function () {
        CF.game.startGame();
      }, '左摇杆移动 · 自动攻击');
      btn(centerX(160), vh * 0.58 + BTN_H + 14, 160, 44, '静音开/关', function () {
        CF.audio.toggleMute();
      });
    },

    hide: function () {
      mode = 'none';
      buttons = [];
      levelupChoices = [];
    },

    /** 升级三选一 */
    showLevelUp: function (choices) {
      mode = 'levelup';
      buttons = [];
      levelupChoices = choices;
      levelupAnim = 0;
      var vw = CF.game.viewW, vh = CF.game.viewH;
      var cardW = Math.min(104, (vw - 80) / 3);
      var cardH = 148;
      var gap = 10;
      var total = cardW * 3 + gap * 2;
      var x0 = centerX(total);
      var y0 = vh * 0.42;
      for (var i = 0; i < 3; i++) {
        (function (idx) {
          var bx = x0 + idx * (cardW + gap);
          btn(bx, y0, cardW, cardH, '', function () {
            CF.game.chooseUpgrade(idx);
          });
          buttons[buttons.length - 1].cardIndex = idx;
        })(i);
      }
    },

    showPause: function () {
      mode = 'paused';
      buttons = [];
      var vw = CF.game.viewW, vh = CF.game.viewH;
      var bw = Math.min(220, vw - 80);
      btn(centerX(bw), vh * 0.45, bw, BTN_H, '继续游戏', function () {
        CF.game.resume();
      });
      btn(centerX(bw), vh * 0.45 + BTN_H + 14, bw, BTN_H, '重新开始', function () {
        CF.game.startGame();
      });
      btn(centerX(bw), vh * 0.45 + (BTN_H + 14) * 2, bw, BTN_H, '静音开/关', function () {
        CF.audio.toggleMute();
      });
    },

    showGameOver: function (stats) {
      mode = 'gameover';
      buttons = [];
      gameoverStats = stats;
      var vw = CF.game.viewW, vh = CF.game.viewH;
      var bw = Math.min(220, vw - 80);
      btn(centerX(bw), vh * 0.66, bw, BTN_H, '再来一局', function () {
        CF.game.startGame();
      });
    },

    /** 游戏内顶部提示（精英来袭/拾取加成） */
    notify: function (text) {
      notifyText = text;
      notifyTimer = 2.2;
    },

    /* ================= 更新 ================= */
    update: function (dt) {
      if (levelupAnim < 1) levelupAnim = Math.min(1, levelupAnim + dt / CF.UPGRADE.CARD_ANIM_TIME);
      if (notifyTimer > 0) notifyTimer -= dt;
    },

    /* ================= 绘制 ================= */
    draw: function (ctx) {
      if (mode === 'none' || mode === 'levelup') {
        CF.ui.drawHUD(ctx);
      }
      if (mode === 'menu') CF.ui.drawMenu(ctx);
      else if (mode === 'levelup') CF.ui.drawLevelUp(ctx);
      else if (mode === 'paused') CF.ui.drawPause(ctx);
      else if (mode === 'gameover') CF.ui.drawGameOver(ctx);
      if (notifyTimer > 0) CF.ui.drawNotify(ctx);
    },

    /* ---------- HUD ---------- */
    drawHUD: function (ctx) {
      var pl = CF.entities.player;
      var vw = CF.game.viewW;
      var pad = CF.UI.SAFE_PAD;
      if (!pl) return;

      // 生命条（左上）
      var hpW = Math.min(150, vw * 0.35);
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      roundRect(ctx, pad, pad, hpW, 14, 7);
      ctx.fill();
      var ratio = Math.max(0, pl.hp / pl.maxHp);
      ctx.fillStyle = ratio > 0.5 ? '#3ae88a' : (ratio > 0.25 ? '#ffd23a' : '#ff5a5a');
      if (ratio > 0) {
        roundRect(ctx, pad + 2, pad + 2, (hpW - 4) * ratio, 10, 5);
        ctx.fill();
      }
      ctx.fillStyle = '#fff';
      ctx.font = '10px "PingFang SC", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(Math.ceil(pl.hp) + '/' + pl.maxHp, pad + hpW / 2, pad + 7);

      // 等级徽章
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.beginPath();
      ctx.arc(pad + hpW + 22, pad + 7, 12, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffd23a';
      ctx.font = 'bold 12px "PingFang SC", sans-serif';
      ctx.fillText('Lv.' + pl.level, pad + hpW + 22, pad + 8);

      // 护盾层数（蓝色小盾，等级徽章右侧）
      if (pl.shield > 0) {
        var maxShield = CF.PICKUP.SHIELD_MAX;
        var shX = pad + hpW + 44;
        ctx.fillStyle = 'rgba(0,0,0,0.45)';
        roundRect(ctx, shX, pad, 12 * maxShield + 8, 14, 7);
        ctx.fill();
        for (var shi = 0; shi < maxShield; shi++) {
          var filled = shi < pl.shield;
          var sx2 = shX + 4 + shi * 12;
          ctx.fillStyle = filled ? '#4a8af0' : 'rgba(255,255,255,0.15)';
          ctx.beginPath();
          ctx.arc(sx2, pad + 7, 4.5, 0, Math.PI * 2);
          ctx.fill();
          if (filled) {
            ctx.fillStyle = 'rgba(255,255,255,0.5)';
            ctx.fillRect(sx2 - 1.5, pad + 5, 3, 2);
          }
        }
      }

      // 波次 + 计时（顶部居中）
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.font = '13px "PingFang SC", sans-serif';
      var waveText = '第 ' + CF.spawner.wave + ' 波';
      var timeText = CF.util.formatTime(CF.game.playTime);
      var waveW = ctx.measureText(waveText).width;
      roundRect(ctx, vw / 2 - waveW / 2 - 18, pad, waveW + 36, 22, 11);
      ctx.fill();
      ctx.fillStyle = '#eaf6ff';
      ctx.fillText(waveText, vw / 2, pad + 15);
      ctx.fillStyle = 'rgba(160,210,255,0.9)';
      ctx.font = '12px "PingFang SC", sans-serif';
      ctx.fillText(timeText, vw / 2, pad + 34);

      // 右上按钮：静音 + 暂停
      var bx = vw - pad - 44;
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.beginPath();
      ctx.arc(bx + 22, pad + 22, 22, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#eaf6ff';
      ctx.font = '18px sans-serif';
      ctx.fillText(CF.audio.muted ? '🔇' : '🔊', bx + 22, pad + 24);
      ctx.beginPath();
      ctx.arc(bx - 34, pad + 22, 22, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillText('⏸', bx - 34, pad + 24);
      // 记录 HUD 按钮（点击判定）
      if (buttons.length === 0) {
        btn(bx - 34, pad, 44, 44, '', function () { CF.game.pause(); });
        btn(bx, pad, 44, 44, '', function () { CF.audio.toggleMute(); });
      }

      // 经验条（底部）
      var exW = vw - pad * 2;
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      roundRect(ctx, pad, CF.game.viewH - pad - 10, exW, 10, 5);
      ctx.fill();
      var er = pl.exp / pl.expNext;
      if (er > 0) {
        ctx.fillStyle = '#5ae0ff';
        roundRect(ctx, pad + 2, CF.game.viewH - pad - 8, (exW - 4) * er, 6, 3);
        ctx.fill();
      }
      // 加速倒计时指示
      if (pl.boostTimer > 0) {
        ctx.fillStyle = 'rgba(255,210,58,0.9)';
        ctx.font = '12px "PingFang SC", sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText('⚡ ' + pl.boostTimer.toFixed(1) + 's', vw - pad, CF.game.viewH - pad - 22);
      }
    },

    /* ---------- 菜单 ---------- */
    drawMenu: function (ctx) {
      var vw = CF.game.viewW, vh = CF.game.viewH;
      ctx.fillStyle = 'rgba(8,14,30,0.92)';
      ctx.fillRect(0, 0, vw, vh);

      ctx.textAlign = 'center';
      ctx.fillStyle = '#ff8f45';
      ctx.font = 'bold 44px "PingFang SC", sans-serif';
      ctx.fillText('🐟 CLOWNFISH', vw / 2, vh * 0.22);
      ctx.fillStyle = '#7fd7ff';
      ctx.font = '16px "PingFang SC", sans-serif';
      ctx.fillText('像素肉鸽求生', vw / 2, vh * 0.22 + 34);

      ctx.fillStyle = 'rgba(200,230,255,0.75)';
      ctx.font = '13px "PingFang SC", sans-serif';
      var lines = [
        '· 左摇杆移动，右摇杆瞄准（可选）',
        '· 自动攻击最近敌人',
        '· 击杀获取经验宝石，升级三选一',
        '· 小心精英怪的激光与死亡弹幕！'
      ];
      for (var i = 0; i < lines.length; i++) {
        ctx.fillText(lines[i], vw / 2, vh * 0.34 + i * 24);
      }

      for (var j = 0; j < buttons.length; j++) drawButton(ctx, buttons[j]);
    },

    /* ---------- 升级卡 ---------- */
    drawLevelUp: function (ctx) {
      var vw = CF.game.viewW, vh = CF.game.viewH;
      ctx.fillStyle = 'rgba(8,14,30,0.72)';
      ctx.fillRect(0, 0, vw, vh);

      ctx.textAlign = 'center';
      ctx.fillStyle = '#ffd23a';
      ctx.font = 'bold 24px "PingFang SC", sans-serif';
      ctx.fillText('⬆ 升级！', vw / 2, vh * 0.28);
      ctx.fillStyle = 'rgba(200,230,255,0.8)';
      ctx.font = '13px "PingFang SC", sans-serif';
      ctx.fillText('选择一项强化', vw / 2, vh * 0.28 + 26);

      var t = CF.ui._easeOutBack(levelupAnim);
      for (var i = 0; i < levelupChoices.length; i++) {
        var b = buttons[i];
        if (!b) continue;
        var up = levelupChoices[i];
        var py = b.y + (1 - t) * 60; // 弹入
        var alpha = Math.min(1, levelupAnim * 2);
        ctx.globalAlpha = alpha;
        roundRect(ctx, b.x, py, b.w, b.h, 12);
        ctx.fillStyle = 'rgba(26,44,80,0.95)';
        ctx.fill();
        ctx.strokeStyle = up.id === 'bulletCount' ? 'rgba(255,210,58,0.8)' : 'rgba(127,215,255,0.5)';
        ctx.lineWidth = 2;
        ctx.stroke();
        // 图标
        ctx.font = '30px sans-serif';
        ctx.textBaseline = 'middle';
        ctx.fillText(up.icon, b.x + b.w / 2, py + 40);
        // 名称
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 15px "PingFang SC", sans-serif';
        ctx.fillText(up.name, b.x + b.w / 2, py + 76);
        // 描述（可能换行）
        ctx.fillStyle = 'rgba(190,225,255,0.85)';
        ctx.font = '11px "PingFang SC", sans-serif';
        var desc = up.desc;
        var words = desc.split(' ');
        var line = '';
        var ly = py + 98;
        for (var k = 0; k < words.length; k++) {
          var test = line ? line + ' ' + words[k] : words[k];
          if (ctx.measureText(test).width > b.w - 14 && line) {
            ctx.fillText(line, b.x + b.w / 2, ly);
            ly += 15;
            line = words[k];
          } else {
            line = test;
          }
        }
        ctx.fillText(line, b.x + b.w / 2, ly);
        ctx.globalAlpha = 1;
      }
    },

    _easeOutBack: function (t) {
      var c1 = 1.70158, c3 = c1 + 1;
      return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
    },

    /* ---------- 暂停 ---------- */
    drawPause: function (ctx) {
      var vw = CF.game.viewW, vh = CF.game.viewH;
      ctx.fillStyle = 'rgba(8,14,30,0.75)';
      ctx.fillRect(0, 0, vw, vh);
      ctx.textAlign = 'center';
      ctx.fillStyle = '#eaf6ff';
      ctx.font = 'bold 30px "PingFang SC", sans-serif';
      ctx.fillText('⏸ 已暂停', vw / 2, vh * 0.32);
      for (var i = 0; i < buttons.length; i++) drawButton(ctx, buttons[i]);
    },

    /* ---------- 结算 ---------- */
    drawGameOver: function (ctx) {
      var vw = CF.game.viewW, vh = CF.game.viewH;
      ctx.fillStyle = 'rgba(30,8,14,0.85)';
      ctx.fillRect(0, 0, vw, vh);
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ff5a5a';
      ctx.font = 'bold 34px "PingFang SC", sans-serif';
      ctx.fillText('游戏结束', vw / 2, vh * 0.22);
      ctx.fillStyle = '#eaf6ff';
      ctx.font = '15px "PingFang SC", sans-serif';
      var st = gameoverStats;
      ctx.fillText('存活 ' + CF.util.formatTime(st.time), vw / 2, vh * 0.34);
      ctx.fillStyle = '#ffd23a';
      ctx.fillText('击杀 ' + st.kills + '  到达第 ' + st.wave + ' 波', vw / 2, vh * 0.34 + 28);
      ctx.fillStyle = 'rgba(200,230,255,0.8)';
      ctx.fillText('等级 Lv.' + st.level, vw / 2, vh * 0.34 + 56);
      for (var i = 0; i < buttons.length; i++) drawButton(ctx, buttons[i]);
    },

    /* ---------- 通知 ---------- */
    drawNotify: function (ctx) {
      var vw = CF.game.viewW;
      var alpha = Math.min(1, notifyTimer);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.font = 'bold 16px "PingFang SC", sans-serif';
      var w = ctx.measureText(notifyText).width + 32;
      roundRect(ctx, (vw - w) / 2, CF.game.viewH * 0.3, w, 36, 18);
      ctx.fill();
      ctx.fillStyle = '#ffd23a';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(notifyText, vw / 2, CF.game.viewH * 0.3 + 19);
      ctx.globalAlpha = 1;
    }
  };
})();
