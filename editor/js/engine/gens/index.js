/*
 * つなぐ：ジェネレーター（コードで描く映像）。
 * 素材を使わず、粒子・フラクタル・流体・銀河・音の可視化・背景などを計算で描く。
 * どれも「時刻 t の関数」か、決まった刻みで進めるシミュレーションなので、プレビューと書き出しで同じ絵になる。
 *
 * 追加のしかた：registerGen('名前', { label, cat, gl, defaults, params, draw(c) }) を呼ぶ。
 *   draw(c) の c：
 *     c.ctx     2D ジェネレーターの描画先（W×H、透明でクリア済み）
 *     c.W, c.H  描く大きさ（px）
 *     c.t       開始からの秒（speed 反映済み）、c.dur 表示の長さ、c.T 動画全体の時刻
 *     c.p       パラメーター（defaults に item.params を重ねたもの）
 *     c.colors  配色（"#rrggbb" の配列）
 *     c.seed    乱数シード、c.rnd(i, k) は 0〜1 の決まった乱数
 *     c.audio   音の特徴（AudioFeatures、なければ null）
 *     c.state   この要素専用の保存場所（前計算やシミュレーションの状態）
 *     c.sim(init, step, dt)  状態つきシミュレーションを時刻 c.t まで進める
 *     c.preview プレビュー中か、c.q 品質（プレビュー再生中は 1 未満）
 *   gl: true のものは GL の共有キャンバスに描く（c.S = GL()、描画先は bind 済み・クリア済み）。
 */
import { withMotion, shapeAnim, itemEnd } from '../fx.js';
import { layerCanvas, draw3D } from '../warp3d.js';
import { GL, bind } from '../gl.js';
import { FONTS } from '../fonts.js';

export const GENS = {};
export const GEN_CATEGORIES = [
  { id: 'hero', label: '主役級（数式・物理）' },
  { id: 'text', label: '文字' },
  { id: 'audio', label: '音の可視化' },
  { id: 'bg', label: '背景・雰囲気' },
  { id: 'algo', label: 'アルゴリズム' },
];

export function registerGen(type, def) {
  GENS[type] = { type, cat: 'bg', defaults: {}, params: [], ...def };
}

/** 配色 */
export const PALETTES = {
  fire: ['#fff1c9', '#ffb347', '#ff6a3d', '#c2255c', '#3b1d5e'],
  ocean: ['#e0fbff', '#69d2ff', '#2a7fff', '#3d3dd9', '#141a4f'],
  neon: ['#00fff0', '#3d8bff', '#b14dff', '#ff3dbb', '#ffd23d'],
  sunset: ['#ffd36e', '#ff9a3d', '#ff5c5c', '#c93d9a', '#5e2d8a'],
  aurora: ['#b8ffd9', '#3ddc97', '#2ab8c9', '#4d6dff', '#8a4dff'],
  candy: ['#ff9ec7', '#ffd166', '#9be7ff', '#b79cff', '#7dffb5'],
  ember: ['#ffe9c2', '#ffb070', '#ff7a3d', '#b5462e', '#40221c'],
  ice: ['#ffffff', '#cfe9ff', '#8fc4ff', '#5a8dff', '#27408b'],
  mono: ['#ffffff', '#cfd3dc', '#8e95a5', '#555c6e', '#252a36'],
  gold: ['#fff7cc', '#ffe08a', '#ffc23d', '#c98a00', '#5a3a00'],
  forest: ['#eaffd0', '#a8e063', '#56ab2f', '#1f7a4d', '#0d3b2e'],
  duo: ['#ff7a3d', '#4c86ff'],
};

export function paletteOf(item, def) {
  const c = item.colors || item.palette || def.defaults.colors || def.defaults.palette || 'neon';
  if (Array.isArray(c) && c.length) return c;
  return PALETTES[c] || PALETTES.neon;
}

/** パレットの色を 0〜1 の位置でなめらかに取り出す → [r, g, b]（0〜1） */
export function mixColor(colors, u) {
  const n = colors.length;
  if (n === 1) return hex(colors[0]);
  const x = Math.min(0.9999, Math.max(0, u)) * (n - 1);
  const i = Math.floor(x), f = x - i;
  const a = hex(colors[i]), b = hex(colors[i + 1]);
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}
const hexCache = new Map();
export function hex(h) {
  let v = hexCache.get(h);
  if (!v) {
    const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(h || '') || [0, 'ff', 'ff', 'ff'];
    v = [parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255];
    hexCache.set(h, v);
  }
  return v;
}
export const css = (c, a = 1) => `rgba(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)},${a})`;

/** 番号から決まる乱数（0〜1） */
export function rnd(i, k = 0, seed = 0) {
  let h = (Math.imul(i | 0, 374761393) + Math.imul(k | 0, 668265263) + Math.imul(seed | 0, 2246822519)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** なめらかな 1 次元ノイズ（-1〜1） */
export function noise1(x, k = 0, seed = 0) {
  const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f);
  return (rnd(i, k, seed) * (1 - u) + rnd(i + 1, k, seed) * u) * 2 - 1;
}

/* ---------- 状態（前計算・シミュレーション） ---------- */

const states = new Map();
function stateOf(item, def) {
  const sig = JSON.stringify([item.type, item.params || null, item.seed || 0, item.colors || item.palette || null, item.text || null]);
  let s = states.get(item.id);
  if (!s || s.sig !== sig) { s = { sig, data: {}, sim: null }; states.set(item.id, s); }
  return s;
}
/** 使わなくなった要素の状態を捨てる */
export function pruneGenStates(project) {
  const ids = new Set((project.gens || []).map((g) => g.id));
  for (const k of states.keys()) if (!ids.has(k)) states.delete(k);
}

export const BLENDS = { normal: 'source-over', add: 'lighter', screen: 'screen', multiply: 'multiply', overlay: 'overlay', lighten: 'lighten', darken: 'darken', difference: 'difference', 'soft-light': 'soft-light', 'color-dodge': 'color-dodge' };

/** ジェネレーターの位置と大きさ（px）。x, y は中心、w は幅（画面幅に対する割合）、h は高さ（画面高に対する割合） */
export function genBox(W, H, g0, t) {
  const g = withMotion(g0, t);
  const s = g.scale ?? 1;
  const w = Math.max(2, (g.w ?? 1) * W * s), h = Math.max(2, (g.h ?? 1) * H * s);
  const cx = (g.x ?? 0.5) * W, cy = (g.y ?? 0.5) * H;
  return { g, cx, cy, w, h, box: { x: cx - w / 2, y: cy - h / 2, w, h } };
}

/** 切り抜き（mask）：文字や形の内側だけを残す */
function applyMask(lc, w, h, mask, t, W, H) {
  lc.save();
  lc.globalCompositeOperation = mask.invert ? 'destination-out' : 'destination-in';
  lc.fillStyle = '#000';
  if (mask.text) {
    const f = FONTS[mask.font] || FONTS.gothic;
    const px = (mask.size ?? 0.3) * Math.min(W, H);
    lc.font = `${f.weight} ${px}px ${f.family}`;
    lc.textAlign = 'center';
    lc.textBaseline = 'middle';
    const lines = String(mask.text).split('\n');
    const lh = px * 1.15;
    lines.forEach((ln, i) => lc.fillText(ln, (mask.x ?? 0.5) * w, (mask.y ?? 0.5) * h + (i - (lines.length - 1) / 2) * lh));
  } else {
    const mw = (mask.w ?? 0.8) * w, mh = (mask.h ?? 0.8) * h, mx = (mask.x ?? 0.5) * w, my = (mask.y ?? 0.5) * h;
    lc.beginPath();
    if (mask.shape === 'circle') lc.ellipse(mx, my, mw / 2, mh / 2, 0, 0, Math.PI * 2);
    else if (mask.shape === 'round') { const r = Math.min(mw, mh) * (mask.radius ?? 0.12); lc.roundRect ? lc.roundRect(mx - mw / 2, my - mh / 2, mw, mh, r) : lc.rect(mx - mw / 2, my - mh / 2, mw, mh); }
    else lc.rect(mx - mw / 2, my - mh / 2, mw, mh);
    lc.fill();
  }
  lc.restore();
}

/**
 * ジェネレーターを 1 つ描く。
 * opts: { preview, playing, audio, onPending }
 */
export function drawGen(ctx, W, H, g0, t, opts = {}) {
  if (t < g0.start || t >= g0.end) return;
  const def = GENS[g0.type];
  if (!def) return;
  const { g, cx, cy, w, h } = genBox(W, H, g0, t);
  const a = shapeAnim({ ...g, anim: g.anim ?? 'fade' }, t);
  const alpha = (g.opacity ?? 1) * a.alpha * reactValue(g, opts.audio, t, 'opacity');
  if (alpha <= 0.001) return;
  // 描く解像度（重いものはプレビュー再生中に粗くする）
  const q = opts.preview && opts.playing && def.heavy ? 0.5 : opts.preview && def.heavy ? 0.75 : 1;
  const rw = Math.max(2, Math.round(Math.min(w, W * 2) * q)), rh = Math.max(2, Math.round(Math.min(h, H * 2) * q));
  const st = stateOf(g0, def);
  const local = (t - g0.start) * (g0.speed ?? 1) + (g0.offset ?? 0);
  const seed = g0.seed ?? 1;
  const c = {
    item: g, p: { ...def.defaults, ...(g0.params || {}) }, t: local, T: t, dur: (itemEnd(g0) - g0.start) * (g0.speed ?? 1),
    W: rw, H: rh, seed, colors: paletteOf(g0, def), audio: opts.audio || null, state: st.data, preview: !!opts.preview, q,
    rnd: (i, k = 0) => rnd(i, k, seed),
    pending: false,
    /** 状態つきシミュレーションを c.t まで進める。戻り値は状態 */
    sim(init, step, dt = 1 / 60) {
      if (!st.sim || local < st.sim.time - dt * 1.5) st.sim = { time: 0, s: init() };
      const max = opts.preview ? 180 : 1e9;
      let n = 0;
      while (st.sim.time + dt <= local + 1e-9 && n < max) { step(st.sim.s, dt, st.sim.time); st.sim.time += dt; n++; }
      if (st.sim.time + dt <= local) c.pending = true; // まだ追いついていない（次の描画で続きを計算）
      return st.sim.s;
    },
  };
  const { canvas, ctx: lc } = layerCanvas('gen', rw, rh);
  try {
    if (def.gl) {
      const S = GL();
      if (!S) return;
      c.S = S;
      bind(null, rw, rh);
      S.gl.clearColor(0, 0, 0, 0);
      S.gl.clear(S.gl.COLOR_BUFFER_BIT);
      def.draw(c);
      bind(null);
      lc.drawImage(S.canvas, 0, 0, rw, rh);
    } else {
      c.ctx = lc;
      lc.save();
      def.draw(c);
      lc.restore();
    }
  } catch (err) {
    if (!def.failed) { def.failed = true; console.error(`ジェネレーター「${g0.type}」でエラー:`, err); }
    return;
  }
  if (c.pending) opts.onPending?.();
  if (g.mask) applyMask(lc, rw, rh, g.mask, t, W, H);

  const sc = a.scale * reactValue(g, opts.audio, t, 'scale');
  ctx.save();
  ctx.globalAlpha = Math.min(1, alpha);
  ctx.globalCompositeOperation = BLENDS[g.blend] || 'source-over';
  if (g.rx || g.ry) {
    const full = layerCanvas('gen3d', W, H);
    full.ctx.drawImage(canvas, cx - w / 2, cy - h / 2, w, h);
    const r = Math.hypot(w, h) / 2 * 1.05;
    draw3D(ctx, full.canvas, { x: cx - r, y: cy - r, w: r * 2, h: r * 2 }, cx, cy, { rx: g.rx, ry: g.ry, perspective: g.perspective, backface: true }, W, H);
  } else {
    ctx.translate(cx, cy + a.dy * h);
    if (g.rotation || a.rot) ctx.rotate(((g.rotation || 0) + a.rot) * Math.PI / 180);
    if (sc !== 1) ctx.scale(sc, sc);
    if (a.reveal < 1) { ctx.beginPath(); ctx.rect(-w / 2, -h / 2, w * a.reveal, h); ctx.clip(); }
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(canvas, -w / 2, -h / 2, w, h);
  }
  ctx.restore();
}

/**
 * 音に反応する量。item.react = { src: 'kick'|'bass'|'mid'|'high'|'level', prop: 'scale'|'opacity'|..., amount }
 * （配列で複数指定も可）。prop が一致したものの倍率を返す。
 */
export function reactValue(item, audio, t, prop) {
  const r = item.react;
  if (!r || !audio) return 1;
  let v = 1;
  for (const x of Array.isArray(r) ? r : [r]) {
    if ((x.prop || 'scale') !== prop) continue;
    const e = audio.band(x.src || 'kick', t);
    v *= prop === 'opacity' ? Math.max(0, 1 - (x.amount ?? 0.5) * (1 - e)) : 1 + (x.amount ?? 0.15) * e;
  }
  return v;
}

/** 文字を小さなキャンバスに描いて、不透明な画素の位置を返す（粒子文字・流体文字の元） */
export function textPoints(text, fontKey, W, H, sizeFrac, { step = 2, x = 0.5, y = 0.5, maxW = 0.92 } = {}) {
  const c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(W, H) : Object.assign(document.createElement('canvas'), { width: W, height: H });
  const g = c.getContext('2d', { willReadFrequently: true });
  const f = FONTS[fontKey] || FONTS.gothic;
  let px = sizeFrac * Math.min(W, H);
  const lines = String(text).split('\n');
  g.font = `${f.weight} ${px}px ${f.family}`;
  const widest = Math.max(...lines.map((l) => g.measureText(l).width));
  if (widest > W * maxW) { px *= (W * maxW) / widest; g.font = `${f.weight} ${px}px ${f.family}`; }
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = '#fff';
  const lh = px * 1.15;
  lines.forEach((ln, i) => g.fillText(ln, x * W, y * H + (i - (lines.length - 1) / 2) * lh));
  const d = g.getImageData(0, 0, W, H).data;
  const pts = [];
  for (let yy = 0; yy < H; yy += step) for (let xx = 0; xx < W; xx += step) if (d[(yy * W + xx) * 4 + 3] > 128) pts.push(xx / W, yy / H);
  return { pts, canvas: c, px };
}
