/**
 * WorldManager.ts — 世界地图、空间哈希网格、地形生成、碰撞查询 + Graphics 地形渲染
 * 空间哈希：Int32Array 预分配（每帧重建，O(N) 无 GC），宽相位查询。
 * 地形生成：纯数据层，生成 {type, x, y, w, h, r} 配置，用 Graphics 一次性绘制（静态，无需预制体）。
 * Cocos Creator 3.8.8 迁移版
 */
import { _decorator, Component, Graphics, Color } from 'cc';
import { clamp, rand, dist2, rectOverlap } from '../util';
import { WORLD, PLAYER, TERRAIN, RENDER, MAPS } from '../config';
const { ccclass, property } = _decorator;

// ===== 地形渲染配色（由 config.MAPS 按地图提供） =====
const WALL_COLOR = new Color(74, 84, 100, 255);
const WALL_EDGE_COLOR = new Color(100, 112, 130, 255);
const CORAL_COLOR = new Color(214, 106, 140, 255);
const CORAL_EDGE_COLOR = new Color(235, 140, 165, 255);
const BOULDER_COLOR = new Color(52, 62, 78, 255);
const BOULDER_HL_COLOR = new Color(90, 100, 118, 255);
const SPIKE_COLOR = new Color(148, 160, 178, 255);
const URCHIN_COLOR = new Color(108, 70, 138, 255);
const URCHIN_SPIKE_COLOR = new Color(70, 44, 96, 255);

// ===== 空间哈希 =====
const CELL = WORLD.GRID_CELL;
const GRID_N = Math.ceil(WORLD.SIZE / CELL);
const CELL_COUNT = GRID_N * GRID_N;
const MAX_PER_CELL = WORLD.MAX_ENTITIES_PER_CELL;

const gridCounts = new Int32Array(CELL_COUNT);
const gridData = new Int32Array(CELL_COUNT * MAX_PER_CELL);

// ===== 地形数据（纯对象，无 Node 引用） =====
export interface WallData { x: number; y: number; w: number; h: number; }
export interface SpikeData { x: number; y: number; cd: number; }
export interface BoulderData { x: number; y: number; r: number; }
export interface CoralData { x: number; y: number; w: number; h: number; }
export interface UrchinData { x: number; y: number; cd: number; }
export interface DecalData { x: number; y: number; type: number; }

export interface TerrainData {
    walls: WallData[];
    spikes: SpikeData[];
    boulders: BoulderData[];
    corals: CoralData[];
    urchins: UrchinData[];
    decals: DecalData[];
}

// 模块级复用变量
let outX = 0, outY = 0;
const tmpPos: [number, number] = [0, 0];
const tmpRect: number[] = [0, 0, 0, 0];
const T_RADIUS = TERRAIN.SPIKE_RADIUS;

function cellIndex(cx: number, cy: number): number {
    return cy * GRID_N + cx;
}

function cellRange(x0: number, y0: number, x1: number, y1, out: number[]): number[] {
    out[0] = Math.max(0, Math.floor(x0 / CELL));
    out[1] = Math.max(0, Math.floor(y0 / CELL));
    out[2] = Math.min(GRID_N - 1, Math.floor(x1 / CELL));
    out[3] = Math.min(GRID_N - 1, Math.floor(y1 / CELL));
    return out;
}

/** 伪随机哈希（地面瓦片变体） */
export function tileVariant(tx: number, ty: number): number {
    const h = (tx * 73856093) ^ (ty * 19349663) ^ (tx * ty * 83492791);
    return (h & 0x7fffffff) % 4;
}

@ccclass('WorldManager')
export class WorldManager extends Component {

    // ===== 地形渲染 =====
    private _gfx: Graphics | null = null;

    /** 当前地图索引（决定地形配色，0 珊瑚礁 / 1 深海 / 2 海底火山） */
    mapIndex = 0;

    onLoad(): void {
        // 自动挂载 Graphics 组件（用于绘制地形，无需预制体）
        this._gfx = this.node.getComponent(Graphics) || this.node.addComponent(Graphics);
    }

    /** 当前地形数据 */
    terrain: TerrainData = {
        walls: [], spikes: [], boulders: [], corals: [], urchins: [], decals: []
    };

    /** 切换地图（重设地图索引；地形数据与绘制由 generateTerrain 重建） */
    setMap(mapIndex: number): void {
        this.mapIndex = mapIndex % MAPS.length;
    }

    /** 网格查询去重标记（每帧递增） */
    qTick = 0;

    // ===== 地形生成 =====

    /** 生成全部地形数据（纯数据，不含 Node） */
    generateTerrain(): TerrainData {
        const T = TERRAIN;
        const s = WORLD.SIZE;
        const cx = PLAYER.START_X, cy = PLAYER.START_Y;
        const safe2 = T.SAFE_RADIUS * T.SAFE_RADIUS;

        const walls: WallData[] = [];
        const corals: CoralData[] = [];
        const spikes: SpikeData[] = [];
        const boulders: BoulderData[] = [];
        const urchins: UrchinData[] = [];
        const decals: DecalData[] = [];

        /** 位置是否落在任意墙/珊瑚块内（含间距 pad） */
        function insideBlock(x: number, y: number, pad: number): boolean {
            for (const w of walls) {
                if (x > w.x - pad && x < w.x + w.w + pad && y > w.y - pad && y < w.y + w.h + pad) return true;
            }
            for (const c of corals) {
                if (x > c.x - pad && x < c.x + c.w + pad && y > c.y - pad && y < c.y + c.h + pad) return true;
            }
            return false;
        }

        // 墙体
        let attempts = 0;
        while (walls.length < T.WALL_COUNT && attempts < 400) {
            attempts++;
            const horizontal = Math.random() < 0.5;
            const len = rand(T.WALL_MIN_LEN, T.WALL_MAX_LEN);
            const thick = T.WALL_THICKNESS;
            const x = rand(120, s - 120 - (horizontal ? len : thick));
            const y = rand(120, s - 120 - (horizontal ? thick : len));
            const w = horizontal ? len : thick;
            const h = horizontal ? thick : len;
            const nearestX = clamp(cx, x, x + w);
            const nearestY = clamp(cy, y, y + h);
            if (dist2(nearestX, nearestY, cx, cy) < safe2) continue;
            let ok = true;
            for (const ww of walls) {
                if (rectOverlap(x - 40, y - 40, w + 80, h + 80, ww.x, ww.y, ww.w, ww.h)) { ok = false; break; }
            }
            if (ok) walls.push({ x, y, w, h });
        }

        // 珊瑚块
        attempts = 0;
        while (corals.length < T.CORAL_COUNT && attempts < 400) {
            attempts++;
            const cw = rand(T.CORAL_W_MIN, T.CORAL_W_MAX);
            const chh = rand(T.CORAL_H_MIN, T.CORAL_H_MAX);
            const x2 = rand(120, s - 120 - cw);
            const y2 = rand(120, s - 120 - chh);
            if (dist2(clamp(cx, x2, x2 + cw), clamp(cy, y2, y2 + chh), cx, cy) < safe2) continue;
            let ok2 = true;
            for (const wc of walls) {
                if (rectOverlap(x2 - 40, y2 - 40, cw + 80, chh + 80, wc.x, wc.y, wc.w, wc.h)) { ok2 = false; break; }
            }
            if (!ok2) continue;
            for (const cc of corals) {
                if (rectOverlap(x2 - 40, y2 - 40, cw + 80, chh + 80, cc.x, cc.y, cc.w, cc.h)) { ok2 = false; break; }
            }
            if (ok2) corals.push({ x: x2, y: y2, w: cw, h: chh });
        }

        // 尖刺
        attempts = 0;
        while (spikes.length < T.SPIKE_COUNT && attempts < 800) {
            attempts++;
            const x = rand(60, s - 60);
            const y = rand(60, s - 60);
            if (dist2(x, y, cx, cy) < safe2) continue;
            if (insideBlock(x, y, 20)) continue;
            spikes.push({ x, y, cd: 0 });
        }

        // 圆礁石
        attempts = 0;
        while (boulders.length < T.BOULDER_COUNT && attempts < 600) {
            attempts++;
            const br = rand(T.BOULDER_RADIUS_MIN, T.BOULDER_RADIUS_MAX);
            const bx = rand(80 + br, s - 80 - br);
            const by = rand(80 + br, s - 80 - br);
            if (dist2(bx, by, cx, cy) < safe2) continue;
            if (insideBlock(bx, by, br + 20)) continue;
            let ok3 = true;
            for (const ob of boulders) {
                if (dist2(bx, by, ob.x, ob.y) < (br + ob.r + 30) * (br + ob.r + 30)) { ok3 = false; break; }
            }
            if (ok3) boulders.push({ x: bx, y: by, r: br });
        }

        // 海胆
        attempts = 0;
        while (urchins.length < T.URCHIN_COUNT && attempts < 500) {
            attempts++;
            const ux = rand(60, s - 60);
            const uy = rand(60, s - 60);
            if (dist2(ux, uy, cx, cy) < safe2) continue;
            if (insideBlock(ux, uy, 25)) continue;
            let ok4 = true;
            for (const ob2 of boulders) {
                if (dist2(ux, uy, ob2.x, ob2.y) < (ob2.r + T.URCHIN_RADIUS + 20) * (ob2.r + T.URCHIN_RADIUS + 20)) { ok4 = false; break; }
            }
            if (ok4) urchins.push({ x: ux, y: uy, cd: 0 });
        }

        // 海底装饰
        attempts = 0;
        while (decals.length < T.DECAL_COUNT && attempts < 1200) {
            attempts++;
            const dx = rand(60, s - 60);
            const dy = rand(60, s - 60);
            if (dist2(dx, dy, cx, cy) < safe2 - 30) continue;
            if (insideBlock(dx, dy, 12)) continue;
            let ok5 = true;
            for (const ob3 of boulders) {
                if (dist2(dx, dy, ob3.x, ob3.y) < (ob3.r + 14) * (ob3.r + 14)) { ok5 = false; break; }
            }
            if (ok5) decals.push({ x: dx, y: dy, type: Math.floor(Math.random() * 5) });
        }

        this.terrain = { walls, spikes, boulders, corals, urchins, decals };
        // 地形数据生成后立即绘制
        this.renderTerrain();
        return this.terrain;
    }

    /** 用 Graphics 一次性绘制全部地形（静态，只绘制一次） */
    renderTerrain(): void {
        const g = this._gfx;
        if (!g) {
            console.warn('[Clownfish] WorldManager: 没有 Graphics 组件，地形无法绘制');
            return;
        }
        console.log('[Clownfish] 地形开始绘制 walls=' + this.terrain.walls.length + ' spikes=' + this.terrain.spikes.length + ' boulders=' + this.terrain.boulders.length);
        g.clear();

        const s = WORLD.SIZE;
        const t = RENDER.TILE_SIZE;
        const T = TERRAIN;

        // 地图主题配色（来自 config.MAPS）
        const map = MAPS[this.mapIndex % MAPS.length];
        const tileCols = map.tiles.map(([r, gg, b]) => new Color(r, gg, b, 255));
        const decalCols = map.decals.map(([r, gg, b]) => new Color(r, gg, b, 255));

        // 地面底色（深蓝海底，世界边界外为场景背景色 = 虚空）
        g.fillColor = tileCols[0];
        g.rect(0, 0, s, s);
        g.fill();

        // 地面瓦片变体（64px 粒度模拟贴图颗粒）
        const vt = t * 2;
        for (let ty = 0; ty < s; ty += vt) {
            for (let tx = 0; tx < s; tx += vt) {
                const v = tileVariant(tx / vt, ty / vt);
                if (v === 0) continue;
                g.fillColor = tileCols[v % tileCols.length];
                g.rect(tx, ty, vt, vt);
                g.fill();
            }
        }

        // 海底装饰（纯视觉小圆点）
        for (const d of this.terrain.decals) {
            g.fillColor = decalCols[d.type % decalCols.length];
            g.circle(d.x, d.y, 2.5 + (d.type % 3));
            g.fill();
        }

        // 墙体（灰色矩形 + 顶部高光）
        for (const w of this.terrain.walls) {
            g.fillColor = WALL_COLOR;
            g.rect(w.x, w.y, w.w, w.h);
            g.fill();
            g.fillColor = WALL_EDGE_COLOR;
            g.rect(w.x, w.y + w.h - 5, w.w, 5);
            g.fill();
        }

        // 珊瑚块（粉色矩形 + 顶部高光）
        for (const c of this.terrain.corals) {
            g.fillColor = CORAL_COLOR;
            g.rect(c.x, c.y, c.w, c.h);
            g.fill();
            g.fillColor = CORAL_EDGE_COLOR;
            g.rect(c.x, c.y + c.h - 4, c.w, 4);
            g.fill();
        }

        // 圆礁石（深灰圆 + 左上高光）
        for (const b of this.terrain.boulders) {
            g.fillColor = BOULDER_COLOR;
            g.circle(b.x, b.y, b.r);
            g.fill();
            g.fillColor = BOULDER_HL_COLOR;
            g.circle(b.x - b.r * 0.28, b.y - b.r * 0.28, b.r * 0.42);
            g.fill();
        }

        // 尖刺（三角钉）
        const sr = T.SPIKE_RADIUS;
        for (const sp of this.terrain.spikes) {
            g.fillColor = SPIKE_COLOR;
            g.moveTo(sp.x, sp.y - sr);
            g.lineTo(sp.x + sr * 0.85, sp.y + sr * 0.7);
            g.lineTo(sp.x - sr * 0.85, sp.y + sr * 0.7);
            g.close();
            g.fill();
        }

        // 海胆（紫球 + 放射刺）
        const ur = T.URCHIN_RADIUS;
        g.lineWidth = 2;
        g.strokeColor = URCHIN_SPIKE_COLOR;
        for (const u of this.terrain.urchins) {
            for (let i = 0; i < 8; i++) {
                const a = (i / 8) * Math.PI * 2;
                g.moveTo(u.x + Math.cos(a) * ur * 0.5, u.y + Math.sin(a) * ur * 0.5);
                g.lineTo(u.x + Math.cos(a) * (ur + 4), u.y + Math.sin(a) * (ur + 4));
            }
            g.fillColor = URCHIN_COLOR;
            g.circle(u.x, u.y, ur * 0.55);
            g.fill();
        }
        g.stroke();
        // 强制刷新 Graphics 命令缓冲区（web-mobile 环境需要显式 flush，否则渲染可能延迟或丢失）
        try { g.flush && g.flush(); } catch {}
    }

    // ===== 空间哈希 =====

    clearGrid(): void {
        gridCounts.fill(0);
    }

    insertEntity(id: number, x: number, y: number, radius: number): void {
        const cx0 = Math.max(0, Math.floor((x - radius) / CELL));
        const cy0 = Math.max(0, Math.floor((y - radius) / CELL));
        const cx1 = Math.min(GRID_N - 1, Math.floor((x + radius) / CELL));
        const cy1 = Math.min(GRID_N - 1, Math.floor((y + radius) / CELL));
        for (let cy = cy0; cy <= cy1; cy++) {
            for (let cx = cx0; cx <= cx1; cx++) {
                const idx = cellIndex(cx, cy);
                const count = gridCounts[idx];
                if (count >= MAX_PER_CELL) continue;
                gridData[idx * MAX_PER_CELL + count] = id;
                gridCounts[idx] = count + 1;
            }
        }
    }

    /** 圆范围查询，回调返回 true 则提前终止 */
    queryCircle(x: number, y: number, r: number, cb: (id: number) => boolean): void {
        const c = cellRange(x - r, y - r, x + r, y + r, tmpRect);
        let found = false;
        for (let cy = c[1]; cy <= c[3] && !found; cy++) {
            for (let cx = c[0]; cx <= c[2] && !found; cx++) {
                const idx = cellIndex(cx, cy);
                const count = gridCounts[idx];
                for (let i = 0; i < count; i++) {
                    const id = gridData[idx * MAX_PER_CELL + i];
                    if (cb(id)) { found = true; break; }
                }
            }
        }
    }

    // ===== 地形碰撞 =====

    /** 圆形与所有墙/珊瑚块碰撞：返回是否碰撞；若 resolve 为 true 则把圆心推出 */
    collideWalls(x: number, y: number, r: number, resolve: boolean): boolean {
        let hit = false;
        const blocksList = [this.terrain.walls, this.terrain.corals];
        for (const blocks of blocksList) {
            for (const w of blocks) {
                const nx = clamp(x, w.x, w.x + w.w);
                const ny = clamp(y, w.y, w.y + w.h);
                const dx = x - nx, dy = y - ny;
                const d2 = dx * dx + dy * dy;
                if (d2 < r * r) {
                    hit = true;
                    if (resolve) {
                        if (d2 > 0.0001) {
                            const d = Math.sqrt(d2);
                            x = nx + dx / d * r;
                            y = ny + dy / d * r;
                        } else {
                            const left = x - w.x, right = w.x + w.w - x;
                            const top = y - w.y, bottom = w.y + w.h - y;
                            const m = Math.min(left, right, top, bottom);
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
    }

    /** 圆形与圆礁石碰撞（圆-圆推出） */
    collideBoulders(x: number, y: number, r: number): void {
        for (const b of this.terrain.boulders) {
            const dx = x - b.x, dy = y - b.y;
            const d2 = dx * dx + dy * dy;
            const minD = r + b.r;
            if (d2 < minD * minD) {
                if (d2 > 0.0001) {
                    const d = Math.sqrt(d2);
                    const push = (minD - d) / d;
                    x += dx * push;
                    y += dy * push;
                } else {
                    x = b.x + minD;
                }
            }
        }
        outX = x; outY = y;
    }

    /** 移动解析：AABB 推出 → 圆礁石推出，返回 [x,y] */
    moveResolve(x: number, y: number, r: number): [number, number] {
        outX = x; outY = y;
        this.collideWalls(outX, outY, r, true);
        this.collideBoulders(outX, outY, r);
        tmpPos[0] = outX;
        tmpPos[1] = outY;
        return tmpPos;
    }

    /** 查询 (x,y) 处尖刺（无则 -1） */
    spikeAt(x: number, y: number, r: number): number {
        const spikes = this.terrain.spikes;
        for (let i = 0; i < spikes.length; i++) {
            const sp = spikes[i];
            if (dist2(x, y, sp.x, sp.y) < (r + T_RADIUS) * (r + T_RADIUS)) {
                return i;
            }
        }
        return -1;
    }

    /** 查询 (x,y) 处海胆（无则 -1） */
    urchinAt(x: number, y: number, r: number): number {
        const ur = TERRAIN.URCHIN_RADIUS;
        const urchins = this.terrain.urchins;
        for (let i = 0; i < urchins.length; i++) {
            const u = urchins[i];
            if (dist2(x, y, u.x, u.y) < (r + ur) * (r + ur)) {
                return i;
            }
        }
        return -1;
    }

    /** 更新尖刺/海胆冷却 */
    updateSpikes(dt: number): void {
        for (const sp of this.terrain.spikes) {
            if (sp.cd > 0) sp.cd -= dt;
        }
        for (const u of this.terrain.urchins) {
            if (u.cd > 0) u.cd -= dt;
        }
    }

    /** 重置（新游戏时调用） */
    reset(): void {
        this.terrain = { walls: [], spikes: [], boulders: [], corals: [], urchins: [], decals: [] };
        gridCounts.fill(0);
        this.qTick = 0;
    }
}
