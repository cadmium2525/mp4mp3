/*
 * 切り抜き：グリーンバック（クロマキー）、AI による人物の切り抜き、タップした物の切り抜き。
 * AI モデル（MediaPipe）は使うときだけ読み込む。すべて端末内で処理する。
 */

const BASE = new URL('../../lib/mediapipe/', import.meta.url).href;
let mp = null;          // vision_bundle モジュール
let fileset = null;
const segs = {};        // person / object
const loading = {};

async function loadVision() {
  if (!mp) mp = await import(new URL('vision_bundle.mjs', BASE).href);
  if (!fileset) fileset = await mp.FilesetResolver.forVisionTasks(new URL('wasm', BASE).href);
  return mp;
}

async function create(kind, delegate) {
  const m = await loadVision();
  if (kind === 'person') {
    return m.ImageSegmenter.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: new URL('models/selfie_segmenter.tflite', BASE).href, delegate },
      runningMode: 'IMAGE',
      outputCategoryMask: false,
      outputConfidenceMasks: true,
    });
  }
  return m.InteractiveSegmenterLegacy.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: new URL('models/magic_touch.tflite', BASE).href, delegate },
    outputCategoryMask: false,
    outputConfidenceMasks: true,
  });
}

/** モデルを読み込む（GPU で失敗したら CPU） */
export function loadCutout(kind) {
  if (kind === 'chroma') return Promise.resolve(true);
  if (segs[kind]) return Promise.resolve(true);
  if (!loading[kind]) {
    loading[kind] = create(kind, 'GPU')
      .catch(() => create(kind, 'CPU'))
      .then((s) => {
        segs[kind] = s;
        if (typeof window !== 'undefined') window.dispatchEvent(new Event('cutoutready'));
        return true;
      })
      .catch((err) => { loading[kind] = null; throw err; });
  }
  return loading[kind];
}

export const cutoutReady = (kind) => kind === 'chroma' || !!segs[kind];

/* ---------- 一時キャンバス ---------- */

const pool = new Map();
function canvas(key, w, h) {
  let c = pool.get(key);
  if (!c) { c = document.createElement('canvas'); pool.set(key, c); }
  if (c.width !== w) c.width = w;
  if (c.height !== h) c.height = h;
  return c;
}

/**
 * 切り抜いた画像（透明部分あり）を返す。モデル未読み込みなら null（読み込みは始める）。
 * @param {{image: CanvasImageSource, width: number, height: number}} src
 * @param {{mode: 'person'|'object'|'chroma', color?: string, tolerance?: number, softness?: number, x?: number, y?: number, feather?: number, invert?: boolean}} opt
 * @param {string} key 使い回すキャンバスの識別子（同時に複数切り抜くとき用）
 */
export function applyCutout(src, opt, key, maxSide = 1280) {
  const s = Math.min(1, maxSide / Math.max(src.width, src.height));
  const w = Math.max(2, Math.round(src.width * s)), h = Math.max(2, Math.round(src.height * s));
  const out = canvas('out:' + key, w, h);
  const ctx = out.getContext('2d', { willReadFrequently: opt.mode === 'chroma' });
  ctx.globalCompositeOperation = 'source-over';
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(src.image, 0, 0, w, h);

  if (opt.mode === 'chroma') {
    chromaKey(ctx, w, h, opt);
    return { image: out, width: w, height: h };
  }

  const kind = opt.mode === 'object' ? 'object' : 'person';
  if (!segs[kind]) { loadCutout(kind).catch(() => {}); return null; }

  // AI へは縮小した画像を渡し、得たマスクを拡大して重ねる（境界はなめらかに）
  const ms = Math.min(1, 512 / Math.max(w, h));
  const mw = Math.max(2, Math.round(w * ms)), mh = Math.max(2, Math.round(h * ms));
  const small = canvas('in:' + key, mw, mh);
  small.getContext('2d').drawImage(out, 0, 0, mw, mh);
  let res;
  try {
    res = kind === 'person'
      ? segs.person.segment(small)
      : segs.object.segment(small, { keypoint: { x: opt.x ?? 0.5, y: opt.y ?? 0.5 } });
  } catch {
    return null;
  }
  const masks = res.confidenceMasks || [];
  const mask = kind === 'person' ? masks[masks.length - 1] : masks[masks.length - 1];
  if (!mask) { res.close?.(); return null; }
  const conf = mask.getAsFloat32Array();
  const mc = canvas('mask:' + key, mask.width, mask.height);
  const mctx = mc.getContext('2d');
  const img = mctx.createImageData(mask.width, mask.height);
  const lo = 0.35, hi = 0.65;
  for (let i = 0; i < conf.length; i++) {
    let v = opt.invert ? 1 - conf[i] : conf[i];
    v = v <= lo ? 0 : v >= hi ? 1 : (v - lo) / (hi - lo);
    img.data[i * 4 + 3] = v * 255;
  }
  mctx.putImageData(img, 0, 0);
  res.close?.();

  ctx.globalCompositeOperation = 'destination-in';
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(mc, 0, 0, w, h);
  ctx.globalCompositeOperation = 'source-over';
  return { image: out, width: w, height: h };
}

function hexRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  const n = m ? parseInt(m[1], 16) : 0x00b140;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** クロマキー：指定色に近い画素を透明に。緑/青かぶりも抑える */
function chromaKey(ctx, w, h, opt) {
  const [kr, kg, kb] = hexRgb(opt.color || '#00b140');
  const tol = opt.tolerance ?? 0.3, soft = opt.softness ?? 0.1;
  const id = ctx.getImageData(0, 0, w, h);
  const d = id.data;
  // 色相に近い差で判定（明るさの違いに強い YCbCr の色差）
  const cb = (r, g, b) => -0.169 * r - 0.331 * g + 0.5 * b;
  const cr = (r, g, b) => 0.5 * r - 0.419 * g - 0.081 * b;
  const kcb = cb(kr, kg, kb), kcr = cr(kr, kg, kb);
  const t0 = tol * 180, t1 = (tol + soft) * 180;
  const greenish = kg >= kr && kg >= kb;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    const dist = Math.hypot(cb(r, g, b) - kcb, cr(r, g, b) - kcr);
    let a = dist <= t0 ? 0 : dist >= t1 ? 1 : (dist - t0) / (t1 - t0);
    if (a < 1) {
      // 残った縁の色かぶりを除く
      if (greenish) { const m = (r + b) / 2; if (g > m) d[i + 1] = m + (g - m) * a; }
      else { const m = (r + g) / 2; if (b > m) d[i + 2] = m + (b - m) * a; }
    }
    d[i + 3] = d[i + 3] * a;
  }
  ctx.putImageData(id, 0, 0);
}
