/**
 * sprites.js — 程序化像素精灵生成
 * 所有精灵在启动时烘焙到离屏 canvas，运行时只做 drawImage（零分配）。
 * 像素风：小尺寸 canvas + imageSmoothingEnabled=false 放大。
 */
(function () {
  'use strict';

  var CF = window.CF = window.CF || {};

  var cache = {};

  /** 创建一个 SxS 像素画布并填充像素函数 */
  function bake(size, painter) {
    var c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    var ctx = c.getContext('2d');
    painter(ctx, size);
    cache[size + '_' + painter.name] = c;
    return c;
  }

  function px(ctx, x, y, w, h, color) {
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w, h);
  }

  /* ========== 玩家：小丑鱼（橙身 + 白条纹 + 黑鳍） ========== */
  function paintPlayer(ctx, s) {
    var u = s / 32; // 单位格
    // 尾巴
    px(ctx, 1 * u, 12 * u, 7 * u, 3 * u, '#e8632a');
    px(ctx, 1 * u, 15 * u, 7 * u, 3 * u, '#e8632a');
    px(ctx, 1 * u, 11 * u, 4 * u, 2 * u, '#b84a1e');
    px(ctx, 1 * u, 17 * u, 4 * u, 2 * u, '#b84a1e');
    // 身体
    px(ctx, 6 * u, 8 * u, 14 * u, 16 * u, '#ff7a2f');
    px(ctx, 8 * u, 6 * u, 12 * u, 20 * u, '#ff7a2f');
    px(ctx, 10 * u, 4 * u, 10 * u, 24 * u, '#ff8f45');
    // 白条纹
    px(ctx, 12 * u, 4 * u, 3 * u, 24 * u, '#ffffff');
    px(ctx, 17 * u, 6 * u, 3 * u, 20 * u, '#ffffff');
    // 背鳍
    px(ctx, 12 * u, 1 * u, 4 * u, 4 * u, '#b84a1e');
    // 眼睛
    px(ctx, 22 * u, 10 * u, 3 * u, 3 * u, '#1a1a2e');
    px(ctx, 23 * u, 9 * u, 2 * u, 2 * u, '#ffffff');
    // 嘴
    px(ctx, 25 * u, 14 * u, 3 * u, 2 * u, '#b84a1e');
  }

  /* ========== 敌人1：蓝色鲨鱼 ========== */
  function paintEnemy1(ctx, s) {
    var u = s / 32;
    px(ctx, 2 * u, 13 * u, 6 * u, 6 * u, '#2b5a8c');
    px(ctx, 7 * u, 9 * u, 15 * u, 14 * u, '#3a7bd5');
    px(ctx, 9 * u, 7 * u, 13 * u, 18 * u, '#4a8fe8');
    px(ctx, 20 * u, 10 * u, 6 * u, 4 * u, '#2b5a8c');
    px(ctx, 20 * u, 16 * u, 6 * u, 4 * u, '#2b5a8c');
    px(ctx, 22 * u, 11 * u, 3 * u, 3 * u, '#fff');
    px(ctx, 23 * u, 12 * u, 2 * u, 2 * u, '#111');
    px(ctx, 14 * u, 22 * u, 5 * u, 3 * u, '#d33'); // 腹部
  }

  /* ========== 敌人2：紫色水母 ========== */
  function paintEnemy2(ctx, s) {
    var u = s / 32;
    px(ctx, 8 * u, 8 * u, 16 * u, 12 * u, '#8a3ad5');
    px(ctx, 10 * u, 6 * u, 12 * u, 16 * u, '#a04ae8');
    px(ctx, 12 * u, 20 * u, 2 * u, 6 * u, '#c88aef');
    px(ctx, 16 * u, 20 * u, 2 * u, 7 * u, '#c88aef');
    px(ctx, 20 * u, 20 * u, 2 * u, 6 * u, '#c88aef');
    px(ctx, 14 * u, 11 * u, 2 * u, 2 * u, '#fff');
    px(ctx, 20 * u, 11 * u, 2 * u, 2 * u, '#fff');
    px(ctx, 15 * u, 12 * u, 1 * u, 1 * u, '#222');
    px(ctx, 21 * u, 12 * u, 1 * u, 1 * u, '#222');
  }

  /* ========== 敌人3：红色棘鱼 ========== */
  function paintEnemy3(ctx, s) {
    var u = s / 32;
    px(ctx, 4 * u, 10 * u, 4 * u, 12 * u, '#c23a2a');
    px(ctx, 8 * u, 6 * u, 16 * u, 20 * u, '#e8482f');
    px(ctx, 10 * u, 4 * u, 12 * u, 24 * u, '#f55a3a');
    px(ctx, 8 * u, 4 * u, 3 * u, 3 * u, '#fff');
    px(ctx, 21 * u, 4 * u, 3 * u, 3 * u, '#fff');
    px(ctx, 12 * u, 2 * u, 2 * u, 4 * u, '#e8482f');
    px(ctx, 18 * u, 2 * u, 2 * u, 4 * u, '#e8482f');
    px(ctx, 22 * u, 12 * u, 4 * u, 3 * u, '#ffd23a'); // 眼睛
    px(ctx, 23 * u, 13 * u, 2 * u, 2 * u, '#111');
  }

  /* ========== 敌人4：绿色海胆（近战滚球） ========== */
  function paintEnemy4(ctx, s) {
    var u = s / 32;
    px(ctx, 6 * u, 6 * u, 20 * u, 20 * u, '#3a9c4a');
    px(ctx, 8 * u, 4 * u, 16 * u, 24 * u, '#4ab85a');
    px(ctx, 4 * u, 8 * u, 24 * u, 16 * u, '#4ab85a');
    // 刺
    px(ctx, 2 * u, 14 * u, 4 * u, 4 * u, '#2a7a38');
    px(ctx, 26 * u, 14 * u, 4 * u, 4 * u, '#2a7a38');
    px(ctx, 14 * u, 2 * u, 4 * u, 4 * u, '#2a7a38');
    px(ctx, 14 * u, 26 * u, 4 * u, 4 * u, '#2a7a38');
    px(ctx, 5 * u, 5 * u, 5 * u, 5 * u, '#2a7a38');
    px(ctx, 22 * u, 5 * u, 5 * u, 5 * u, '#2a7a38');
    px(ctx, 5 * u, 22 * u, 5 * u, 5 * u, '#2a7a38');
    px(ctx, 22 * u, 22 * u, 5 * u, 5 * u, '#2a7a38');
    px(ctx, 12 * u, 12 * u, 4 * u, 4 * u, '#fff');
    px(ctx, 16 * u, 12 * u, 4 * u, 4 * u, '#fff');
    px(ctx, 13 * u, 13 * u, 2 * u, 2 * u, '#111');
    px(ctx, 17 * u, 13 * u, 2 * u, 2 * u, '#111');
  }

  /* ========== 精英：巨型紫光兽 ========== */
  function paintElite(ctx, s) {
    var u = s / 32;
    // 光环
    px(ctx, 2 * u, 2 * u, 28 * u, 28 * u, '#7a2ad8');
    px(ctx, 4 * u, 4 * u, 24 * u, 24 * u, '#9a4ae8');
    // 身体
    px(ctx, 6 * u, 8 * u, 20 * u, 16 * u, '#5a1a9c');
    px(ctx, 8 * u, 6 * u, 18 * u, 20 * u, '#6a2abc');
    px(ctx, 10 * u, 4 * u, 14 * u, 24 * u, '#7a3acc');
    // 眼睛（发光）
    px(ctx, 12 * u, 10 * u, 4 * u, 4 * u, '#ff5af0');
    px(ctx, 18 * u, 10 * u, 4 * u, 4 * u, '#ff5af0');
    px(ctx, 13 * u, 11 * u, 2 * u, 2 * u, '#fff');
    px(ctx, 19 * u, 11 * u, 2 * u, 2 * u, '#fff');
    // 牙齿
    px(ctx, 10 * u, 20 * u, 3 * u, 3 * u, '#fff');
    px(ctx, 16 * u, 21 * u, 3 * u, 3 * u, '#fff');
    px(ctx, 22 * u, 20 * u, 3 * u, 3 * u, '#fff');
  }

  /* ========== 子弹 ========== */
  function paintBullet(ctx, s) {
    var u = s / 16;
    px(ctx, 6 * u, 3 * u, 4 * u, 10 * u, '#ffe95a');
    px(ctx, 7 * u, 1 * u, 2 * u, 14 * u, '#fff7a8');
    px(ctx, 6 * u, 11 * u, 4 * u, 3 * u, '#ffb03a');
  }

  /* ========== 精英子弹（红色大弹） ========== */
  function paintEliteBullet(ctx, s) {
    var u = s / 16;
    px(ctx, 4 * u, 4 * u, 8 * u, 8 * u, '#ff3a5a');
    px(ctx, 6 * u, 2 * u, 4 * u, 12 * u, '#ff5a7a');
    px(ctx, 6 * u, 6 * u, 4 * u, 4 * u, '#ffd0d8');
  }

  /* ========== 经验宝石 ========== */
  function paintGem(ctx, s) {
    var u = s / 16;
    px(ctx, 4 * u, 4 * u, 8 * u, 8 * u, '#3ae88a');
    px(ctx, 6 * u, 2 * u, 4 * u, 12 * u, '#5af8aa');
    px(ctx, 8 * u, 6 * u, 4 * u, 4 * u, '#b8ffe0');
  }

  /* ========== 大宝石（精英掉落） ========== */
  function paintBigGem(ctx, s) {
    var u = s / 16;
    px(ctx, 3 * u, 3 * u, 10 * u, 10 * u, '#2ac8ff');
    px(ctx, 5 * u, 1 * u, 6 * u, 14 * u, '#5ae0ff');
    px(ctx, 9 * u, 5 * u, 4 * u, 5 * u, '#d8f8ff');
    px(ctx, 1 * u, 5 * u, 3 * u, 3 * u, '#e8c8ff');
    px(ctx, 12 * u, 8 * u, 3 * u, 3 * u, '#e8c8ff');
  }

  /* ========== 范围提升拾取物 ========== */
  function paintRangePickup(ctx, s) {
    var u = s / 16;
    px(ctx, 4 * u, 4 * u, 8 * u, 8 * u, '#b84ae8');
    px(ctx, 6 * u, 2 * u, 4 * u, 12 * u, '#d86af8');
    px(ctx, 2 * u, 6 * u, 12 * u, 4 * u, '#d86af8');
    // 中心钻石
    px(ctx, 6 * u, 6 * u, 4 * u, 4 * u, '#fff');
    px(ctx, 7 * u, 5 * u, 2 * u, 6 * u, '#ffeaff');
  }

  /* ========== 速度提升拾取物 ========== */
  function paintBoostPickup(ctx, s) {
    var u = s / 16;
    px(ctx, 5 * u, 2 * u, 6 * u, 12 * u, '#ffd23a');
    px(ctx, 3 * u, 5 * u, 10 * u, 6 * u, '#ffe97a');
    px(ctx, 7 * u, 7 * u, 2 * u, 6 * u, '#fff7c0'); // 高光
  }

  /* ========== 尖刺 ========== */
  function paintSpike(ctx, s) {
    var u = s / 16;
    px(ctx, 2 * u, 8 * u, 4 * u, 6 * u, '#9aa0b4');
    px(ctx, 6 * u, 4 * u, 4 * u, 10 * u, '#b0b6c8');
    px(ctx, 10 * u, 8 * u, 4 * u, 6 * u, '#9aa0b4');
    px(ctx, 4 * u, 10 * u, 8 * u, 4 * u, '#888ea0');
    px(ctx, 6 * u, 3 * u, 2 * u, 2 * u, '#d8dce8');
  }

  /* ========== 墙体（砖块，顶部高光便于辨识） ========== */
  function paintWall(ctx, s) {
    var u = s / 16;
    px(ctx, 0, 0, 16 * u, 16 * u, '#4a5268');
    px(ctx, 0, 0, 16 * u, 3 * u, '#7a86a8');
    px(ctx, 0, 0, 3 * u, 16 * u, '#5c6888');
    px(ctx, 0, 8 * u, 16 * u, 3 * u, '#586084');
    // 砖缝
    px(ctx, 0, 3 * u, 16 * u, 1 * u, '#2a2e3e');
    px(ctx, 0, 11 * u, 16 * u, 1 * u, '#2a2e3e');
    px(ctx, 6 * u, 0, 1 * u, 3 * u, '#2a2e3e');
    px(ctx, 12 * u, 0, 1 * u, 3 * u, '#2a2e3e');
    px(ctx, 3 * u, 8 * u, 1 * u, 3 * u, '#2a2e3e');
    px(ctx, 9 * u, 8 * u, 1 * u, 3 * u, '#2a2e3e');
  }

  /* ========== 地面瓦片A（浅沙） ========== */
  function paintGroundA(ctx, s) {
    var u = s / 16;
    px(ctx, 0, 0, 16 * u, 16 * u, '#24365a');
    px(ctx, 3 * u, 4 * u, 2 * u, 1 * u, '#30456e');
    px(ctx, 10 * u, 9 * u, 2 * u, 1 * u, '#30456e');
    px(ctx, 5 * u, 13 * u, 1 * u, 1 * u, '#30456e');
    px(ctx, 12 * u, 2 * u, 1 * u, 1 * u, '#30456e');
  }

  /* ========== 地面瓦片B（深沙） ========== */
  function paintGroundB(ctx, s) {
    var u = s / 16;
    px(ctx, 0, 0, 16 * u, 16 * u, '#1e3050');
    px(ctx, 6 * u, 6 * u, 2 * u, 2 * u, '#2c4068');
    px(ctx, 2 * u, 10 * u, 1 * u, 2 * u, '#2c4068');
    px(ctx, 11 * u, 4 * u, 2 * u, 1 * u, '#2c4068');
  }

  /* ========== 地面瓦片C（海草） ========== */
  function paintGroundC(ctx, s) {
    var u = s / 16;
    px(ctx, 0, 0, 16 * u, 16 * u, '#24365a');
    px(ctx, 4 * u, 6 * u, 2 * u, 4 * u, '#2a5a44');
    px(ctx, 5 * u, 4 * u, 2 * u, 3 * u, '#3a7a54');
    px(ctx, 11 * u, 9 * u, 1 * u, 3 * u, '#2a5a44');
  }

  /* ========== 地面瓦片D（砂砾+贝壳碎） ========== */
  function paintGroundD(ctx, s) {
    var u = s / 16;
    px(ctx, 0, 0, 16 * u, 16 * u, '#20335a');
    px(ctx, 2 * u, 3 * u, 3 * u, 1 * u, '#2c4068');
    px(ctx, 9 * u, 8 * u, 4 * u, 1 * u, '#2c4068');
    px(ctx, 4 * u, 12 * u, 2 * u, 1 * u, '#2c4068');
    // 贝壳碎（浅色点）
    px(ctx, 6 * u, 6 * u, 1 * u, 1 * u, '#5a6a90');
    px(ctx, 12 * u, 3 * u, 1 * u, 1 * u, '#4a5a80');
    px(ctx, 2 * u, 10 * u, 1 * u, 1 * u, '#5a6a90');
  }

  /* ========== 圆礁石（苔藓岩） ========== */
  function paintBoulder(ctx, s) {
    var u = s / 16;
    px(ctx, 0, 0, 16 * u, 16 * u, '#46536a');
    px(ctx, 2 * u, 2 * u, 12 * u, 10 * u, '#56657e');
    px(ctx, 3 * u, 3 * u, 10 * u, 8 * u, '#64748f');
    px(ctx, 4 * u, 4 * u, 6 * u, 3 * u, '#7a8aa6');
    // 苔藓斑
    px(ctx, 3 * u, 9 * u, 3 * u, 2 * u, '#3a6a4a');
    px(ctx, 10 * u, 8 * u, 3 * u, 2 * u, '#3a6a4a');
    px(ctx, 7 * u, 11 * u, 2 * u, 2 * u, '#4a7a5a');
    // 深色底部
    px(ctx, 4 * u, 12 * u, 8 * u, 3 * u, '#3a455a');
  }

  /* ========== 珊瑚块瓦片（平铺用） ========== */
  function paintCoral(ctx, s) {
    var u = s / 16;
    px(ctx, 0, 0, 16 * u, 16 * u, '#7a4a5e');
    px(ctx, 0, 6 * u, 16 * u, 10 * u, '#8a5a6e');
    // 珊瑚分支
    px(ctx, 2 * u, 0, 2 * u, 8 * u, '#c06a7a');
    px(ctx, 0, 0, 2 * u, 3 * u, '#d08090');
    px(ctx, 7 * u, 0, 2 * u, 10 * u, '#a86070');
    px(ctx, 9 * u, 0, 2 * u, 4 * u, '#c07080');
    px(ctx, 12 * u, 0, 2 * u, 7 * u, '#b06878');
    px(ctx, 14 * u, 0, 2 * u, 3 * u, '#c88090');
    // 亮点
    px(ctx, 2 * u, 1 * u, 1 * u, 1 * u, '#e090a0');
    px(ctx, 9 * u, 1 * u, 1 * u, 1 * u, '#d08898');
    px(ctx, 13 * u, 1 * u, 1 * u, 1 * u, '#e098a8');
  }

  /* ========== 海胆（紫黑刺球） ========== */
  function paintUrchin(ctx, s) {
    var u = s / 16;
    px(ctx, 0, 0, 16 * u, 16 * u, '#2a2236');
    // 放射状刺
    px(ctx, 1 * u, 7 * u, 2 * u, 2 * u, '#5a4a6a');
    px(ctx, 13 * u, 7 * u, 2 * u, 2 * u, '#5a4a6a');
    px(ctx, 7 * u, 1 * u, 2 * u, 2 * u, '#5a4a6a');
    px(ctx, 7 * u, 13 * u, 2 * u, 2 * u, '#5a4a6a');
    px(ctx, 3 * u, 3 * u, 2 * u, 2 * u, '#4a3a5a');
    px(ctx, 11 * u, 3 * u, 2 * u, 2 * u, '#4a3a5a');
    px(ctx, 3 * u, 11 * u, 2 * u, 2 * u, '#4a3a5a');
    px(ctx, 11 * u, 11 * u, 2 * u, 2 * u, '#4a3a5a');
    // 球体
    px(ctx, 4 * u, 4 * u, 8 * u, 8 * u, '#3a3048');
    px(ctx, 5 * u, 5 * u, 6 * u, 6 * u, '#4a3e5c');
    px(ctx, 6 * u, 6 * u, 3 * u, 2 * u, '#6a5a84');
    // 眼
    px(ctx, 6 * u, 8 * u, 1 * u, 1 * u, '#ffd0a0');
    px(ctx, 9 * u, 8 * u, 1 * u, 1 * u, '#ffd0a0');
  }

  /* ========== 血球（回复） ========== */
  function paintHpPickup(ctx, s) {
    var u = s / 16;
    px(ctx, 0, 0, 16 * u, 16 * u, '#5a1620');
    px(ctx, 4 * u, 4 * u, 8 * u, 8 * u, '#a02030');
    px(ctx, 5 * u, 3 * u, 6 * u, 6 * u, '#c03040');
    px(ctx, 6 * u, 2 * u, 4 * u, 4 * u, '#e04050');
    px(ctx, 5 * u, 8 * u, 6 * u, 3 * u, '#e04050');
    px(ctx, 7 * u, 7 * u, 2 * u, 2 * u, '#ff8090');
    // 白色十字
    px(ctx, 7 * u, 5 * u, 2 * u, 6 * u, '#ffffff');
    px(ctx, 5 * u, 7 * u, 6 * u, 2 * u, '#ffffff');
  }

  /* ========== 大血球（精英掉落） ========== */
  function paintHpBigPickup(ctx, s) {
    var u = s / 16;
    px(ctx, 0, 0, 16 * u, 16 * u, '#4a1018');
    px(ctx, 3 * u, 3 * u, 10 * u, 10 * u, '#901828');
    px(ctx, 4 * u, 2 * u, 8 * u, 8 * u, '#b82838');
    px(ctx, 5 * u, 1 * u, 6 * u, 5 * u, '#d83848');
    px(ctx, 4 * u, 9 * u, 8 * u, 4 * u, '#d83848');
    px(ctx, 6 * u, 6 * u, 4 * u, 4 * u, '#ff90a0');
    px(ctx, 6 * u, 4 * u, 4 * u, 8 * u, '#ffffff');
    px(ctx, 4 * u, 6 * u, 8 * u, 4 * u, '#ffffff');
  }

  /* ========== 护盾（蓝色泡泡） ========== */
  function paintShieldPickup(ctx, s) {
    var u = s / 16;
    px(ctx, 0, 0, 16 * u, 16 * u, '#16284a');
    // 气泡
    px(ctx, 4 * u, 4 * u, 8 * u, 8 * u, '#3a6ac8');
    px(ctx, 5 * u, 5 * u, 6 * u, 6 * u, '#4a7ae0');
    px(ctx, 6 * u, 6 * u, 4 * u, 4 * u, '#5a8af0');
    px(ctx, 6 * u, 5 * u, 2 * u, 1 * u, '#a0c0ff');
    // 盾形白色小标记
    px(ctx, 7 * u, 6 * u, 2 * u, 4 * u, '#ffffff');
    px(ctx, 6 * u, 7 * u, 4 * u, 2 * u, '#ffffff');
  }

  /* ========== 海底装饰 ========== */
  // 珊瑚（粉）
  function paintDecalCoral0(ctx, s) {
    var u = s / 16;
    px(ctx, 2 * u, 10 * u, 12 * u, 4 * u, '#6a3a3e');
    px(ctx, 3 * u, 6 * u, 3 * u, 5 * u, '#b06070');
    px(ctx, 5 * u, 2 * u, 2 * u, 9 * u, '#c87080');
    px(ctx, 9 * u, 4 * u, 2 * u, 7 * u, '#a85868');
    px(ctx, 11 * u, 6 * u, 2 * u, 5 * u, '#c06878');
    px(ctx, 6 * u, 1 * u, 2 * u, 2 * u, '#e090a0');
    px(ctx, 10 * u, 3 * u, 1 * u, 2 * u, '#d08090');
  }

  // 珊瑚（紫）
  function paintDecalCoral1(ctx, s) {
    var u = s / 16;
    px(ctx, 2 * u, 10 * u, 12 * u, 4 * u, '#4a3a5a');
    px(ctx, 4 * u, 5 * u, 2 * u, 6 * u, '#8068a0');
    px(ctx, 7 * u, 3 * u, 3 * u, 8 * u, '#9078b0');
    px(ctx, 11 * u, 6 * u, 2 * u, 5 * u, '#7858a0');
    px(ctx, 8 * u, 1 * u, 2 * u, 3 * u, '#b098c8');
  }

  // 海星（橙）
  function paintDecalStar(ctx, s) {
    var u = s / 16;
    px(ctx, 5 * u, 8 * u, 6 * u, 3 * u, '#d08030');
    px(ctx, 7 * u, 3 * u, 2 * u, 10 * u, '#e09040');
    px(ctx, 2 * u, 6 * u, 12 * u, 2 * u, '#e09040');
    px(ctx, 7 * u, 5 * u, 2 * u, 5 * u, '#f0a050');
    px(ctx, 7 * u, 7 * u, 2 * u, 2 * u, '#ffc080');
  }

  // 贝壳（白）
  function paintDecalShell(ctx, s) {
    var u = s / 16;
    px(ctx, 3 * u, 8 * u, 10 * u, 5 * u, '#a8a090');
    px(ctx, 4 * u, 5 * u, 8 * u, 4 * u, '#c8c0b0');
    px(ctx, 5 * u, 4 * u, 6 * u, 2 * u, '#e0d8c8');
    px(ctx, 5 * u, 7 * u, 6 * u, 1 * u, '#887e70');
    px(ctx, 6 * u, 9 * u, 1 * u, 3 * u, '#e0d8c8');
    px(ctx, 10 * u, 9 * u, 1 * u, 3 * u, '#e0d8c8');
  }

  // 骷髅（沉船遗骸）
  function paintDecalSkull(ctx, s) {
    var u = s / 16;
    px(ctx, 4 * u, 6 * u, 8 * u, 7 * u, '#c8c8b8');
    px(ctx, 5 * u, 4 * u, 6 * u, 5 * u, '#d8d8c8');
    px(ctx, 6 * u, 5 * u, 4 * u, 3 * u, '#e8e8d8');
    // 眼窝
    px(ctx, 5 * u, 7 * u, 2 * u, 2 * u, '#20202a');
    px(ctx, 9 * u, 7 * u, 2 * u, 2 * u, '#20202a');
    // 牙
    px(ctx, 6 * u, 10 * u, 1 * u, 2 * u, '#e8e8d8');
    px(ctx, 9 * u, 10 * u, 1 * u, 2 * u, '#e8e8d8');
  }

  /* ========== 光柱（god rays，屏幕坐标叠加） ========== */
  function paintGodRay(ctx, s) {
    var h = s;
    var g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, 'rgba(160,220,255,0.85)');
    g.addColorStop(1, 'rgba(160,220,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 140, h);
  }

  /** 初始化所有精灵（BOOT 阶段调用） */
  CF.sprites = {
    cache: cache,

    init: function () {
      var s = CF.sprites;
      s.player = bake(32, paintPlayer);
      s.enemies = [
        bake(32, paintEnemy1),
        bake(32, paintEnemy2),
        bake(32, paintEnemy3),
        bake(32, paintEnemy4)
      ];
      s.elite = bake(32, paintElite);
      s.bullet = bake(16, paintBullet);
      s.eliteBullet = bake(16, paintEliteBullet);
      s.gem = bake(16, paintGem);
      s.bigGem = bake(16, paintBigGem);
      s.rangePickup = bake(16, paintRangePickup);
      s.boostPickup = bake(16, paintBoostPickup);
      s.hpPickup = bake(16, paintHpPickup);
      s.hpBigPickup = bake(16, paintHpBigPickup);
      s.shieldPickup = bake(16, paintShieldPickup);
      s.spike = bake(16, paintSpike);
      s.wall = bake(16, paintWall);
      s.boulder = bake(32, paintBoulder);
      s.coral = bake(16, paintCoral);
      s.urchin = bake(16, paintUrchin);
      s.godRay = bake(140, paintGodRay);
      s.decals = [
        bake(16, paintDecalCoral0),
        bake(16, paintDecalCoral1),
        bake(16, paintDecalStar),
        bake(16, paintDecalShell),
        bake(16, paintDecalSkull)
      ];
      s.ground = [
        bake(32, paintGroundA),
        bake(32, paintGroundB),
        bake(32, paintGroundC),
        bake(32, paintGroundD)
      ];
    },

    /** 精灵（32px）绘制缩放辅助 */
    draw32: function (ctx, spr, x, y, w) {
      ctx.drawImage(spr, x - w / 2, y - w / 2, w, w);
    }
  };
})();
