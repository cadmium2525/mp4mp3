/*
 * Motion Prompt（https://github.com/showheyohtaki/motion-prompt, MIT License © 2026 Shohei Ohtaki）の
 * 要素を読み込んで描く。各要素は「時刻 u だけで絵が決まる Canvas 2D の関数」なので、
 * つなぐのプレビューと書き出しでそのまま同じ絵になる。
 */

const BASE = new URL('../../lib/motion-prompt/', import.meta.url).href;
const packs = {};       // pack 名 → { width, height, cycle, cells, palette }
const loading = {};
let catalog = null;
let catalogP = null;

/** パックの JS は MotionPrompt.pack(id, factory) を呼ぶので、その受け口を用意する */
function registry() {
  if (!globalThis.MotionPrompt) {
    globalThis.MotionPrompt = {
      packs,
      pack(id, factory) { const p = factory(); p.id = id; packs[id] = p; p.defaults = p.palette ? { ...p.palette } : {}; return p; },
    };
  }
}

export function loadCatalog() {
  if (catalog) return Promise.resolve(catalog);
  if (!catalogP) {
    catalogP = fetch(new URL('catalog.json', BASE)).then((r) => r.json()).then((c) => {
      catalog = c;
      catalog.byId = Object.fromEntries(c.elements.map((e) => [e.id, e]));
      return catalog;
    });
  }
  return catalogP;
}

export const catalogSync = () => catalog;

export function loadPack(pack) {
  if (packs[pack]) return Promise.resolve(packs[pack]);
  if (!loading[pack]) {
    registry();
    loading[pack] = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = new URL(`${pack}.js`, BASE).href;
      s.onload = () => (packs[pack] ? resolve(packs[pack]) : reject(new Error(`パック ${pack} を読み込めませんでした`)));
      s.onerror = () => { loading[pack] = null; reject(new Error(`パック ${pack} を読み込めませんでした`)); };
      document.head.append(s);
    }).then((p) => {
      if (typeof window !== 'undefined') window.dispatchEvent(new Event('motionready'));
      return p;
    });
  }
  return loading[pack];
}

/** "12" / "#012" / "012" を "012" にそろえる */
export const normRef = (ref) => String(ref ?? '').replace(/^#/, '').padStart(3, '0');

/** プロジェクトで使う要素のパックをすべて読み込む */
export async function ensureMotions(project) {
  const refs = (project.motions || []).map((m) => normRef(m.ref));
  if (!refs.length) return;
  const c = await loadCatalog();
  const need = new Set();
  for (const r of refs) {
    const e = c.byId[r];
    if (!e) throw new Error(`Motion Prompt の #${r} はありません`);
    need.add(e.pack);
  }
  await Promise.all([...need].map(loadPack));
}

/** 描画できる状態の要素（未読み込みなら null。読み込みは始める） */
export function element(ref) {
  const id = normRef(ref);
  if (!catalog) { loadCatalog().then(() => window.dispatchEvent(new Event('motionready'))).catch(() => {}); return null; }
  const e = catalog.byId[id];
  if (!e) return null;
  const p = packs[e.pack];
  if (!p) { loadPack(e.pack).catch(() => {}); return null; }
  return { meta: e, cell: p.cells[e.index], pack: p, cw: e.width, ch: e.height, cycle: e.cycle };
}

/** 表示中の時刻 t から、要素に渡す u（0 以上 1周 未満）を決める */
export function motionU(m, t, cycle) {
  const local = Math.max(0, (t - m.start) * (m.speed || 1) + (m.offset || 0));
  const eps = 1e-4;
  switch (m.mode) {
    case 'once': return Math.min(local, cycle - eps);
    case 'hold': return Math.min(local, Math.min(cycle - eps, m.hold ?? cycle / 2));
    case 'still': return Math.min(cycle - eps, Math.max(0, m.hold ?? cycle / 2));
    default: return ((local % cycle) + cycle) % cycle;
  }
}

/**
 * 要素が描く ctx を、カード座標 → 画面の配置に読み替える。
 * - setTransform / resetTransform は配置の変換を掛けた上で行う（要素がカード基準で座標をリセットしても崩れない）
 * - transparent なら、カード全体を塗りつぶす背景（stage など）だけを描かない
 */
function placed(ctx, base, cw, ch, transparent) {
  const fns = new Map();
  return new Proxy(ctx, {
    get(t, p) {
      if (p === 'setTransform') return (a, b, c, d, e, f) => {
        const m = typeof a === 'object' && a !== null ? new DOMMatrix([a.a, a.b, a.c, a.d, a.e, a.f]) : new DOMMatrix([a, b, c, d, e, f]);
        t.setTransform(base.multiply(m));
      };
      if (p === 'resetTransform') return () => t.setTransform(base);
      if (p === 'getTransform') return () => base.inverse().multiply(t.getTransform());
      if (p === 'fillRect' && transparent) return (x, y, w, h) => {
        const m = t.getTransform(), b = base;
        const full = x <= 0.5 && y <= 0.5 && x + w >= cw - 0.5 && y + h >= ch - 0.5;
        // カード座標のままで全面を塗るときだけ（要素の中で拡大縮小していない）
        if (full && Math.abs(m.a - b.a) < 1e-6 && Math.abs(m.d - b.d) < 1e-6 && Math.abs(m.e - b.e) < 1e-3 && Math.abs(m.f - b.f) < 1e-3) return;
        t.fillRect(x, y, w, h);
      };
      const v = t[p];
      if (typeof v !== 'function') return v;
      let f = fns.get(p);
      if (!f) { f = v.bind(t); fns.set(p, f); }
      return f;
    },
    set(t, p, v) { t[p] = v; return true; },
  });
}

/** 色の差し替え（パレット C）を一時的に当てて描き、元に戻す */
function withPalette(pack, colors, draw) {
  const C = pack.palette;
  if (!C || !colors || !Object.keys(colors).length) return draw();
  const keep = { ...C };
  Object.assign(C, colors);
  try { return draw(); } finally { Object.assign(C, keep); }
}

/** 配置（px）。w = カードの幅（画面の幅に対する割合）、cover なら画面を覆う */
export function motionBox(W, H, m, cw = 539, ch = 208) {
  const s = m.cover ? Math.max(W / cw, H / ch) * (m.scale ?? 1) : ((m.w ?? 1) * W / cw) * (m.scale ?? 1);
  const dw = cw * s, dh = ch * s;
  const cx = (m.cover ? 0.5 : m.x ?? 0.5) * W, cy = (m.cover ? 0.5 : m.y ?? 0.5) * H;
  return { s, dw, dh, cx, cy, box: { x: cx - dw / 2, y: cy - dh / 2, w: dw, h: dh } };
}

/**
 * ctx に要素を1つ描く（ctx は全面の下書き用）。
 * @returns {boolean} 描けたか（パック未読み込みなら false）
 */
export function drawMotionElement(ctx, W, H, m, t) {
  const el = element(m.ref);
  if (!el) return false;
  const u = motionU(m, t, el.cycle);
  const { s, cx, cy } = motionBox(W, H, m, el.cw, el.ch);
  const base = new DOMMatrix().translate(cx, cy).rotate(m.rotation || 0).scale(s).translate(-el.cw / 2, -el.ch / 2);
  ctx.save();
  ctx.setTransform(base);
  ctx.beginPath();
  ctx.rect(0, 0, el.cw, el.ch);
  ctx.clip();
  const k = placed(ctx, base, el.cw, el.ch, !!m.transparent);
  try {
    withPalette(el.pack, m.colors, () => { k.save(); el.cell(k, el.cw, el.ch, u); k.restore(); });
  } catch (err) {
    console.warn(`Motion Prompt #${el.meta.id}`, err);
  }
  ctx.restore();
  return true;
}
