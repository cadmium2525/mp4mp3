/*
 * 3D 回転（遠近感つき）。Canvas 2D には遠近変形がないので、画像を細い帯に切って
 * 帯ごとに位置と大きさを変えて描く（縦の帯で Y 軸回転、横の帯で X 軸回転）。
 */

const STRIPS = 56;
const pool = new Map();
function temp(key, w, h) {
  let c = pool.get(key);
  if (!c) {
    c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : document.createElement('canvas');
    pool.set(key, c);
  }
  if (c.width !== w) c.width = w;
  if (c.height !== h) c.height = h;
  return c;
}

/** 描画用の全画面サイズの下書きキャンバス */
export function layerCanvas(key, W, H) {
  const c = temp('layer:' + key, W, H);
  const ctx = c.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.clearRect(0, 0, W, H);
  return { canvas: c, ctx };
}

/**
 * 軸（画面上の位置 c、奥行き zc）まわりに角度 deg 回したとき、面上の点 u（軸からの距離）がどこに見えるか。
 * 戻り値 { pos: 画面上の位置, s: 拡大率 }。
 */
function project(u, deg, zc, P) {
  const a = (deg * Math.PI) / 180;
  const x = u * Math.cos(a) - zc * Math.sin(a);
  const z = -u * Math.sin(a) - zc * Math.cos(a) + zc;
  const s = P / Math.max(P * 0.05, P + z);
  return { pos: x * s, s };
}

/**
 * src の矩形 r を、縦軸（x = cx）まわりに ry 度回して ctx に描く。
 * zc > 0 で軸が画面の奥（立方体の中心など）にある。
 * @returns 描いた範囲 {x0, x1, y0, y1}
 */
export function warpY(ctx, src, r, cx, cy, ry, zc, P, backface = false) {
  const n = STRIPS, sw = r.w / n;
  const ext = { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity };
  for (let i = 0; i < n; i++) {
    const sx = r.x + i * sw;
    const a = project(sx - cx, ry, zc, P), b = project(sx + sw - cx, ry, zc, P);
    const x0 = cx + a.pos, x1 = cx + b.pos;
    const s = (a.s + b.s) / 2;
    const y0 = cy + (r.y - cy) * s, hgt = r.h * s;
    if (x1 <= x0) {
      // 裏面：トランジションでは描かない／図形や文字は鏡写しで描く（コインが回るように）
      if (!backface || x0 - x1 < 0.01) continue;
      ctx.save();
      ctx.translate(x0, y0);
      ctx.scale(-1, 1);
      ctx.drawImage(src, sx, r.y, sw, r.h, 0, 0, x0 - x1 + 0.6, hgt);
      ctx.restore();
    } else {
      ctx.drawImage(src, sx, r.y, sw, r.h, x0, y0, x1 - x0 + 0.6, hgt);
    }
    ext.x0 = Math.min(ext.x0, x0, x1); ext.x1 = Math.max(ext.x1, x0, x1);
    ext.y0 = Math.min(ext.y0, y0); ext.y1 = Math.max(ext.y1, y0 + hgt);
  }
  return ext;
}

/** src の矩形 r を、横軸（y = cy）まわりに rx 度回して ctx に描く（正の値で上側が奥へ倒れる） */
export function warpX(ctx, src, r, cx, cy, rx, zc, P, backface = false) {
  const n = STRIPS, sh = r.h / n;
  for (let i = 0; i < n; i++) {
    const sy = r.y + i * sh;
    const a = project(-(sy - cy), rx, zc, P), b = project(-(sy + sh - cy), rx, zc, P);
    const y0 = cy - a.pos, y1 = cy - b.pos;
    const s = (a.s + b.s) / 2;
    const x0 = cx + (r.x - cx) * s;
    if (y1 <= y0) {
      if (!backface || y0 - y1 < 0.01) continue;
      ctx.save();
      ctx.translate(x0, y0);
      ctx.scale(1, -1);
      ctx.drawImage(src, r.x, sy, r.w, sh, 0, 0, r.w * s, y0 - y1 + 0.6);
      ctx.restore();
    } else {
      ctx.drawImage(src, r.x, sy, r.w, sh, x0, y0, r.w * s, y1 - y0 + 0.6);
    }
  }
}

/**
 * 下書きキャンバス src（全画面）上の矩形 r を、中心 (cx, cy) で X/Y 回転して ctx に描く。
 * @param {{rx?: number, ry?: number, zc?: number, perspective?: number}} o
 */
export function draw3D(ctx, src, r, cx, cy, o, W, H) {
  const P = (o.perspective || 1.2) * Math.max(W, H);
  const rx = o.rx || 0, ry = o.ry || 0, zc = o.zc || 0, bf = !!o.backface;
  const pad = 2;
  const R = { x: Math.max(0, Math.floor(r.x - pad)), y: Math.max(0, Math.floor(r.y - pad)) };
  R.w = Math.min(W, Math.ceil(r.x + r.w + pad)) - R.x;
  R.h = Math.min(H, Math.ceil(r.y + r.h + pad)) - R.y;
  if (R.w <= 0 || R.h <= 0) return;
  if (!rx) { warpY(ctx, src, R, cx, cy, ry, zc, P, bf); return; }
  if (!ry) { warpX(ctx, src, R, cx, cy, rx, zc, P, bf); return; }
  // 両方：まず Y 回転を中間キャンバスに描き、それを X 回転する
  const mid = temp('mid', W, H);
  const mctx = mid.getContext('2d');
  mctx.clearRect(0, 0, W, H);
  const e = warpY(mctx, src, R, cx, cy, ry, zc, P, bf);
  if (!(e.x1 > e.x0)) return;
  const R2 = { x: Math.max(0, Math.floor(e.x0)), y: Math.max(0, Math.floor(e.y0)) };
  R2.w = Math.min(W, Math.ceil(e.x1)) - R2.x;
  R2.h = Math.min(H, Math.ceil(e.y1)) - R2.y;
  if (R2.w > 0 && R2.h > 0) warpX(ctx, mid, R2, cx, cy, rx, 0, P, bf);
}
