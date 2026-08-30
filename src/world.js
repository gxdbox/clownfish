/**
 * world.js — 世界地图、空间哈希网格、地形（墙/尖刺）
 * 空间哈希：Int32Array 预分配（每帧重建，O(N) 无 GC），宽相位查询。
 * 简化寻路：实体向目标移动 + 圆形-AABB 滑动解析（沿墙滑行）。
 */
(function () {
  'use strict';

  var CF = window.CF = window.CF || {};

  var CELL = CF.WORLD.GRID_CELL;
  var GRID_N = Math.ceil(CF.WORLD.SIZE / CELL); // 32
  var CELL_COUNT = GRID_N * GRID_N;
  var MAX_PER_CELL = CF.WORLD.MAX_ENTITIES_PER_CELL;

  // 预分配网格（不可变容量）
  var gridCounts = new Int32Array(CELL_COUNT);
  var gridData = new Int32Array(CELL_COUNT * MAX_PER_CELL);

  // 地形数据
  var walls = [];     // {x,y,w,h} 长条墙（AABB 阻挡）
  var spikes = [];    // {x,y,cd} 尖刺（圆形伤害）
  var boulders = [];  // {x,y,r} 圆礁石（圆形阻挡）
  var corals = [];    // {x,y,w,h} 珊瑚块（矮AABB阻挡）
  var urchins = [];   // {x,y,cd} 海胆（圆形伤害）
  var decals = [];    // {x,y,type,color} 海底装饰（纯视觉）

  // 查询结果复用缓冲
  var queryIds = [];
  var tmpRect = [];

  function cellIndex(cx, cy) {
    return cy * GRID_N + cx;
  }

  function cellRange(x0, y0, x1, y1, out) {
    out[0] = Math.max(0, Math.floor(x0 / CELL));
    out[1] = Math.max(0, Math.floor(y0 / CELL));
    out[2] = Math.min(GRID_N - 1, Math.floor(x1 / CELL));
    out[3] = Math.min(GRID_N - 1, Math.floor(y1 / CELL));
    return out;
  }

  /** 伪随机哈希（地面瓦片变体） */
  function tileVariant(tx, ty) {
    var h = (tx * 73856093) ^ (ty * 19349663) ^ (tx * ty * 83492791);
    return (h & 0x7fffffff) % 4;
  }

  CF.world = {
    walls: walls,
    spikes: spikes,
    boulders: boulders,
    corals: corals,
    urchins: urchins,
    decals: decals,

    init: function () {
      walls.length = 0;
      spikes.length = 0;
      boulders.length = 0;
      corals.length = 0;
      urchins.length = 0;
      decals.length = 0;
      CF.world._genTerrain();
      gridCounts.fill(0);
    },

    /* ================= 地形生成 ================= */
    _genTerrain: function () {
      var T = CF.TERRAIN;
      var s = CF.WORLD.SIZE;
      var cx = CF.PLAYER.START_X, cy = CF.PLAYER.START_Y;
      var safe2 = T.SAFE_RADIUS * T.SAFE_RADIUS;
      var attempts = 0;

      /** 位置是否落在任意墙/珊瑚块内（含间距 pad） */
      function insideBlock(x, y, pad) {
        for (var i = 0; i < walls.length; i++) {
          var w = walls[i];
          if (x > w.x - pad && x < w.x + w.w + pad && y > w.y - pad && y < w.y + w.h + pad) return true;
        }
        for (var j = 0; j < corals.length; j++) {
          var c = corals[j];
          if (x > c.x - pad && x < c.x + c.w + pad && y > c.y - pad && y < c.y + c.h + pad) return true;
        }
        return false;
      }

      // 墙体
      while (walls.length < T.WALL_COUNT && attempts < 400) {
        attempts++;
        var horizontal = Math.random() < 0.5;
        var len = CF.util.rand(T.WALL_MIN_LEN, T.WALL_MAX_LEN);
        var thick = T.WALL_THICKNESS;
        var x = CF.util.rand(120, s - 120 - (horizontal ? len : thick));
        var y = CF.util.rand(120, s - 120 - (horizontal ? thick : len));
        var w = horizontal ? len : thick;
        var h = horizontal ? thick : len;
        // 避开出生安全区
        var nearestX = CF.util.clamp(cx, x, x + w);
        var nearestY = CF.util.clamp(cy, y, y + h);
        if (CF.util.dist2(nearestX, nearestY, cx, cy) < safe2) continue;
        // 不与已有墙重叠过近
        var ok = true;
        for (var i = 0; i < walls.length; i++) {
          var ww = walls[i];
          if (CF.util.rectOverlap(x - 40, y - 40, w + 80, h + 80, ww.x, ww.y, ww.w, ww.h)) {
            ok = false;
            break;
          }
        }
        if (ok) walls.push({ x: x, y: y, w: w, h: h });
      }

      // 珊瑚块（矮AABB）
      attempts = 0;
      while (corals.length < T.CORAL_COUNT && attempts < 400) {
        attempts++;
        var cw = CF.util.rand(T.CORAL_W_MIN, T.CORAL_W_MAX);
        var chh = CF.util.rand(T.CORAL_H_MIN, T.CORAL_H_MAX);
        var x2 = CF.util.rand(120, s - 120 - cw);
        var y2 = CF.util.rand(120, s - 120 - chh);
        if (CF.util.dist2(CF.util.clamp(cx, x2, x2 + cw), CF.util.clamp(cy, y2, y2 + chh), cx, cy) < safe2) continue;
        var ok2 = true;
        for (var cj = 0; cj < walls.length; cj++) {
          var wc = walls[cj];
          if (CF.util.rectOverlap(x2 - 40, y2 - 40, cw + 80, chh + 80, wc.x, wc.y, wc.w, wc.h)) { ok2 = false; break; }
        }
        if (!ok2) continue;
        for (var ck = 0; ck < corals.length; ck++) {
          var cc = corals[ck];
          if (CF.util.rectOverlap(x2 - 40, y2 - 40, cw + 80, chh + 80, cc.x, cc.y, cc.w, cc.h)) { ok2 = false; break; }
        }
        if (ok2) corals.push({ x: x2, y: y2, w: cw, h: chh });
      }

      // 尖刺
      attempts = 0;
      while (spikes.length < T.SPIKE_COUNT && attempts < 800) {
        attempts++;
        var x = CF.util.rand(60, s - 60);
        var y = CF.util.rand(60, s - 60);
        if (CF.util.dist2(x, y, cx, cy) < safe2) continue;
        if (insideBlock(x, y, 20)) continue;
        spikes.push({ x: x, y: y, cd: 0 });
      }

      // 圆礁石（圆形阻挡）
      attempts = 0;
      while (boulders.length < T.BOULDER_COUNT && attempts < 600) {
        attempts++;
        var br = CF.util.rand(T.BOULDER_RADIUS_MIN, T.BOULDER_RADIUS_MAX);
        var bx = CF.util.rand(80 + br, s - 80 - br);
        var by = CF.util.rand(80 + br, s - 80 - br);
        if (CF.util.dist2(bx, by, cx, cy) < safe2) continue;
        if (insideBlock(bx, by, br + 20)) continue;
        var ok3 = true;
        for (var bi = 0; bi < boulders.length; bi++) {
          var ob = boulders[bi];
          if (CF.util.dist2(bx, by, ob.x, ob.y) < (br + ob.r + 30) * (br + ob.r + 30)) { ok3 = false; break; }
        }
        if (ok3) boulders.push({ x: bx, y: by, r: br });
      }

      // 海胆（圆形伤害）
      attempts = 0;
      while (urchins.length < T.URCHIN_COUNT && attempts < 500) {
        attempts++;
        var ux = CF.util.rand(60, s - 60);
        var uy = CF.util.rand(60, s - 60);
        if (CF.util.dist2(ux, uy, cx, cy) < safe2) continue;
        if (insideBlock(ux, uy, 25)) continue;
        var ok4 = true;
        for (var ui = 0; ui < boulders.length; ui++) {
          var ob2 = boulders[ui];
          if (CF.util.dist2(ux, uy, ob2.x, ob2.y) < (ob2.r + T.URCHIN_RADIUS + 20) * (ob2.r + T.URCHIN_RADIUS + 20)) { ok4 = false; break; }
        }
        if (ok4) urchins.push({ x: ux, y: uy, cd: 0 });
      }

      // 海底装饰（纯视觉：0珊瑚粉/1珊瑚紫/2海星/3贝壳/4骷髅）
      attempts = 0;
      while (decals.length < T.DECAL_COUNT && attempts < 1200) {
        attempts++;
        var dx = CF.util.rand(60, s - 60);
        var dy = CF.util.rand(60, s - 60);
        if (CF.util.dist2(dx, dy, cx, cy) < safe2 - 30) continue;
        if (insideBlock(dx, dy, 12)) continue;
        var ok5 = true;
        for (var di = 0; di < boulders.length; di++) {
          var ob3 = boulders[di];
          if (CF.util.dist2(dx, dy, ob3.x, ob3.y) < (ob3.r + 14) * (ob3.r + 14)) { ok5 = false; break; }
        }
        if (ok5) decals.push({ x: dx, y: dy, type: Math.floor(Math.random() * 5) });
      }
    },

    /* ================= 空间哈希 ================= */
    /**
     * 每帧重建网格：clearGrid() 后对每个活跃实体调 insertEntity(e)
     * e 需提供 .x .y .radius，返回其网格记录索引
     */
    clearGrid: function () {
      gridCounts.fill(0);
    },

    insertEntity: function (e) {
      var cx0 = Math.max(0, Math.floor((e.x - e.radius) / CELL));
      var cy0 = Math.max(0, Math.floor((e.y - e.radius) / CELL));
      var cx1 = Math.min(GRID_N - 1, Math.floor((e.x + e.radius) / CELL));
      var cy1 = Math.min(GRID_N - 1, Math.floor((e.y + e.radius) / CELL));
      for (var cy = cy0; cy <= cy1; cy++) {
        for (var cx = cx0; cx <= cx1; cx++) {
          var idx = cellIndex(cx, cy);
          var count = gridCounts[idx];
          if (count >= MAX_PER_CELL) continue; // 超限丢弃（安全阀）
          gridData[idx * MAX_PER_CELL + count] = e.id;
          gridCounts[idx] = count + 1;
        }
      }
    },

    /** 圆范围查询，回调 cb(entity)，cb 返回 true 则提前终止 */
    queryCircle: function (x, y, r, cb) {
      var c = cellRange(x - r, y - r, x + r, y + r, tmpRect);
      var found = false;
      for (var cy = c[1]; cy <= c[3] && !found; cy++) {
        for (var cx = c[0]; cx <= c[2] && !found; cx++) {
          var idx = cellIndex(cx, cy);
          var count = gridCounts[idx];
          for (var i = 0; i < count; i++) {
            var id = gridData[idx * MAX_PER_CELL + i];
            if (cb(id)) { found = true; break; }
          }
        }
      }
    },

    /** 圆范围收集实体引用到数组（去重，上限 max），返回数组 */
    queryCircleCollect: function (x, y, r, out, max) {
      out.length = 0;
      CF.world.qTick++;
      var qTick = CF.world.qTick;
      var all = CF.entities.all;
      CF.world.queryCircle(x, y, r, function (id) {
        var e = all[id];
        if (e && e.active && e._qTick !== qTick) {
          e._qTick = qTick;
          out.push(e);
        }
        return out.length >= max;
      });
      return out;
    },

    /* ================= 地形碰撞 ================= */
    /** 圆形与所有墙/珊瑚块碰撞：返回是否碰撞；若 resolve 为 true 则把圆心推出 */
    collideWalls: function (x, y, r, resolve) {
      var hit = false;
      for (var pass = 0; pass < 2; pass++) {
        var blocks = pass === 0 ? walls : corals;
        for (var i = 0; i < blocks.length; i++) {
          var w = blocks[i];
          var nx = CF.util.clamp(x, w.x, w.x + w.w);
          var ny = CF.util.clamp(y, w.y, w.y + w.h);
          var dx = x - nx, dy = y - ny;
          var d2 = dx * dx + dy * dy;
          if (d2 < r * r) {
            hit = true;
            if (resolve) {
              if (d2 > 0.0001) {
                var d = Math.sqrt(d2);
                x = nx + dx / d * r;
                y = ny + dy / d * r;
              } else {
                // 圆心在块内：沿最近边推出
                var left = x - w.x, right = w.x + w.w - x;
                var top = y - w.y, bottom = w.y + w.h - y;
                var m = Math.min(left, right, top, bottom);
                if (m === left) x = w.x - r;
                else if (m === right) x = w.x + w.w + r;
                else if (m === top) y = w.y - r;
                else y = w.y + w.h + r;
              }
            }
          }
        }
      }
      if (resolve) { outX = x; outY = y; }
      return hit;
    },

    /** 圆形与圆礁石碰撞（圆-圆推出，写入 outX/outY） */
    collideBoulders: function (x, y, r) {
      for (var i = 0; i < boulders.length; i++) {
        var b = boulders[i];
        var dx = x - b.x, dy = y - b.y;
        var d2 = dx * dx + dy * dy;
        var minD = r + b.r;
        if (d2 < minD * minD) {
          if (d2 > 0.0001) {
            var d = Math.sqrt(d2);
            var push = (minD - d) / d;
            x += dx * push;
            y += dy * push;
          } else {
            x = b.x + minD;
          }
        }
      }
      outX = x; outY = y;
    },

    /** 移动解析：AABB 推出 → 圆礁石推出，返回 [x,y]（内部变量，勿跨帧持有） */
    moveResolve: function (x, y, r) {
      outX = x; outY = y;
      CF.world.collideWalls(x, y, r, true);
      CF.world.collideBoulders(outX, outY, r);
      tmpPos[0] = outX;
      tmpPos[1] = outY;
      return tmpPos;
    },

    /* ================= 尖刺/海胆 ================= */
    /** 查询 (x,y) 处尖刺（无则 -1） */
    spikeAt: function (x, y, r) {
      for (var i = 0; i < spikes.length; i++) {
        var sp = spikes[i];
        if (CF.util.dist2(x, y, sp.x, sp.y) < (r + T_RADIUS) * (r + T_RADIUS)) {
          return i;
        }
      }
      return -1;
    },

    /** 查询 (x,y) 处海胆（无则 -1） */
    urchinAt: function (x, y, r) {
      var ur = CF.TERRAIN.URCHIN_RADIUS;
      for (var i = 0; i < urchins.length; i++) {
        var u = urchins[i];
        if (CF.util.dist2(x, y, u.x, u.y) < (r + ur) * (r + ur)) {
          return i;
        }
      }
      return -1;
    },

    /** 更新尖刺/海胆冷却 */
    updateSpikes: function (dt) {
      for (var i = 0; i < spikes.length; i++) {
        if (spikes[i].cd > 0) spikes[i].cd -= dt;
      }
      for (var j = 0; j < urchins.length; j++) {
        if (urchins[j].cd > 0) urchins[j].cd -= dt;
      }
    },

    /* ================= 渲染 ================= */
    render: function (ctx, vr) {
      var R = CF.RENDER;
      var t = R.TILE_SIZE;
      var s = CF.WORLD.SIZE;
      // 相机偏移：世界坐标 → 屏幕坐标（与实体层一致）
      var ox = CF.game.viewW / 2 - CF.camera.x;
      var oy = CF.game.viewH / 2 - CF.camera.y;
      var i, j;

      // 地面瓦片（仅视锥内）
      var tx0 = Math.max(0, Math.floor(vr[0] / t));
      var ty0 = Math.max(0, Math.floor(vr[1] / t));
      var tx1 = Math.min(Math.floor(s / t) - 1, Math.floor(vr[2] / t));
      var ty1 = Math.min(Math.floor(s / t) - 1, Math.floor(vr[3] / t));
      var ground = CF.sprites.ground;
      for (var ty = ty0; ty <= ty1; ty++) {
        for (var tx = tx0; tx <= tx1; tx++) {
          ctx.drawImage(ground[tileVariant(tx, ty)], tx * t + ox, ty * t + oy, t, t);
        }
      }

      // 海底装饰（纯视觉，地面之上）
      var decalSpr = CF.sprites.decals;
      for (i = 0; i < decals.length; i++) {
        var dc = decals[i];
        if (dc.x < vr[0] - 20 || dc.x > vr[2] + 20 || dc.y < vr[1] - 20 || dc.y > vr[3] + 20) continue;
        ctx.drawImage(decalSpr[dc.type], dc.x - 16 + ox, dc.y - 16 + oy, 32, 32);
      }

      // 墙体
      var wallSpr = CF.sprites.wall;
      for (i = 0; i < walls.length; i++) {
        var w = walls[i];
        if (w.x > vr[2] || w.x + w.w < vr[0] || w.y > vr[3] || w.y + w.h < vr[1]) continue;
        // 用瓦片平铺（16px 精灵）
        var p = 16;
        for (var wy = w.y; wy < w.y + w.h; wy += p) {
          for (var wx = w.x; wx < w.x + w.w; wx += p) {
            ctx.drawImage(wallSpr, wx + ox, wy + oy, p, p);
          }
        }
      }

      // 珊瑚块（矮AABB，珊瑚色瓦片平铺）
      var coralSpr = CF.sprites.coral;
      for (i = 0; i < corals.length; i++) {
        var c = corals[i];
        if (c.x > vr[2] || c.x + c.w < vr[0] || c.y > vr[3] || c.y + c.h < vr[1]) continue;
        for (var cy2 = c.y; cy2 < c.y + c.h; cy2 += 16) {
          for (var cx2 = c.x; cx2 < c.x + c.w; cx2 += 16) {
            ctx.drawImage(coralSpr, cx2 + ox, cy2 + oy, 16, 16);
          }
        }
      }

      // 圆礁石
      var boulderSpr = CF.sprites.boulder;
      for (i = 0; i < boulders.length; i++) {
        var b = boulders[i];
        if (b.x < vr[0] - b.r || b.x > vr[2] + b.r || b.y < vr[1] - b.r || b.y > vr[3] + b.r) continue;
        ctx.drawImage(boulderSpr, b.x - b.r + ox, b.y - b.r + oy, b.r * 2, b.r * 2);
      }

      // 尖刺
      var spikeSpr = CF.sprites.spike;
      var sr = CF.TERRAIN.SPIKE_RADIUS;
      for (j = 0; j < spikes.length; j++) {
        var sp = spikes[j];
        if (sp.x < vr[0] || sp.x > vr[2] || sp.y < vr[1] || sp.y > vr[3]) continue;
        ctx.drawImage(spikeSpr, sp.x - sr + ox, sp.y - sr + oy, sr * 2, sr * 2);
      }

      // 海胆
      var urchinSpr = CF.sprites.urchin;
      var ur = CF.TERRAIN.URCHIN_RADIUS;
      for (j = 0; j < urchins.length; j++) {
        var u = urchins[j];
        if (u.x < vr[0] - ur || u.x > vr[2] + ur || u.y < vr[1] - ur || u.y > vr[3] + ur) continue;
        ctx.drawImage(urchinSpr, u.x - ur + ox, u.y - ur + oy, ur * 2, ur * 2);
      }

      // 世界边界黑框（视野外为虚空）
      ctx.fillStyle = '#000';
      if (vr[0] < 0) ctx.fillRect(vr[0] + ox, vr[1] + oy, -vr[0], vr[3] - vr[1]);
      if (vr[1] < 0) ctx.fillRect(Math.max(0, vr[0]) + ox, vr[1] + oy, vr[2] - Math.max(0, vr[0]), -vr[1]);
      if (vr[2] > s) ctx.fillRect(s + ox, vr[1] + oy, vr[2] - s, vr[3] - vr[1]);
      if (vr[3] > s) ctx.fillRect(Math.max(0, vr[0]) + ox, s + oy, vr[2] - Math.max(0, vr[0]), vr[3] - s);
    }
  };

  // 模块级复用变量
  var outX = 0, outY = 0;
  var tmpPos = [0, 0];
  var T_RADIUS = CF.TERRAIN.SPIKE_RADIUS;

  // 网格查询去重标记（每帧递增）
  CF.world.qTick = 0;
})();
