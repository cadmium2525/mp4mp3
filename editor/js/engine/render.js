/*
 * 1フレームを描画する。プレビューと書き出しで同じ関数を使うので、見た目が必ず一致する。
 * 重なり順：映像 → 映像エフェクト → 重ねた映像（ワイプ） → 図形 → テキスト → 上乗せエフェクト
 */
import { activeClipsAt, dipAt, mediaTime, overlayEnd } from './project.js';
import { applyEffects, drawShape, shapeBox, shapeAnim, withMotion, paint } from './fx.js';
import { applyCutout } from './cutout.js';
import { draw3D, layerCanvas } from './warp3d.js';
import { drawMotionElement, motionBox, element as motionElement } from './motionlib.js';

export const FONTS = {
  gothic: { family: '"Noto Sans JP", "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Yu Gothic", sans-serif', weight: 900 },
  rounded: { family: '"M PLUS Rounded 1c", "Hiragino Maru Gothic ProN", "Hiragino Sans", sans-serif', weight: 800 },
  mincho: { family: '"Noto Serif JP", "Hiragino Mincho ProN", "Yu Mincho", serif', weight: 700 },
};

let filterSupported = null;
function supportsFilter(ctx) {
  if (filterSupported === null) {
    try {
      ctx.save();
      ctx.filter = 'brightness(0.5)';
      filterSupported = ctx.filter === 'brightness(0.5)';
      ctx.restore();
    } catch { filterSupported = false; }
  }
  return filterSupported;
}

/* ---------- 切り抜きのキャッシュ（同じ時刻なら再計算しない） ---------- */

const cutCache = new Map();
function cutout(src, opt, key0, mt, opts) {
  const key = (opts.preview ? 'p:' : 'x:') + key0;
  const sig = JSON.stringify(opt);
  const c = cutCache.get(key);
  const now = performance.now();
  if (c && c.sig === sig && (Math.abs(c.mt - mt) < 1e-3 || (opts.preview && opts.playing && now - c.at < 70))) return c.res;
  const res = applyCutout(src, opt, key, opts.preview ? 720 : 1440);
  if (res) cutCache.set(key, { sig, mt, at: now, res });
  return res;
}

/**
 * @param {CanvasRenderingContext2D} ctx 出力サイズ（project.width × project.height）のコンテキスト
 * @param {(L, mediaT: number) => ({image: CanvasImageSource, width: number, height: number} | null)} getSource
 *   L は {clip} の形。重ねた映像は {clip: overlay, overlay: true}
 * @param {{hideTextId?: string, preview?: boolean, playing?: boolean}} [opts]
 */
export function drawFrame(ctx, project, layout, t, getSource, opts = {}) {
  const W = project.width, H = project.height;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = project.background || '#000';
  ctx.fillRect(0, 0, W, H);

  for (const item of activeClipsAt(layout, t)) {
    const { L } = item;
    const mt = mediaTime(L, t);
    let src = getSource(L, mt);
    if (!src) continue;
    const p = L.dur > 0 ? Math.min(1, Math.max(0, (t - L.start) / L.dur)) : 0;
    const cut = L.clip.cutout?.mode ? cutout(src, L.clip.cutout, L.clip.id, mt, opts) : null;
    if (item.ry) {
      // 3D トランジション：いったん下書きに描いてから回転して描く
      const { canvas, ctx: lc } = layerCanvas('clip', W, H);
      drawMedia(lc, W, H, src, cut, L.clip, p, { ...item, alpha: 1 }, project.background);
      ctx.save();
      ctx.globalAlpha = item.alpha;
      draw3D(ctx, canvas, { x: 0, y: 0, w: W, h: H }, W / 2, H / 2, { ry: item.ry, zc: item.cube ? W / 2 : 0, perspective: 1.6 }, W, H);
      ctx.restore();
    } else {
      drawMedia(ctx, W, H, src, cut, L.clip, p, item, project.background);
    }
  }

  const dip = dipAt(project, layout, t);
  if (dip) {
    ctx.globalAlpha = dip.alpha;
    ctx.fillStyle = dip.color;
    ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = 1;
  }

  const effects = project.effects || [];
  applyEffects(ctx, W, H, effects, t, 'video');
  for (const o of project.overlays || []) drawOverlay(ctx, W, H, o, t, getSource, opts);
  for (const m of project.motions || []) drawMotion(ctx, W, H, m, t);
  for (const s of project.shapes || []) with3D(ctx, W, H, s, t, (c) => drawShape(c, W, H, s, t), () => shapeBox(W, H, s, t));
  for (const tx of project.texts) {
    if (tx.id === opts.hideTextId) continue;
    with3D(ctx, W, H, tx, t, (c) => drawText(c, W, H, tx, t), () => textBounds(ctx, W, H, tx, t));
  }
  applyEffects(ctx, W, H, effects, t, 'top');
  ctx.restore();
}

/** rx / ry（3D 回転）があれば下書きに描いてから遠近変形して描く */
function with3D(ctx, W, H, item, t, draw, bounds) {
  if (t < item.start || t >= (item.end ?? overlayEnd(item))) return;
  const m = withMotion(item, t);
  if (!m.rx && !m.ry) { draw(ctx); return; }
  const b = bounds();
  const { canvas, ctx: lc } = layerCanvas('el', W, H);
  draw(lc);
  const r = Math.hypot(b.box.w, b.box.h) / 2 * 1.15;
  draw3D(ctx, canvas, { x: b.cx - r, y: b.cy - r, w: r * 2, h: r * 2 }, b.cx, b.cy, { rx: m.rx, ry: m.ry, perspective: m.perspective, backface: true }, W, H);
}

function blurDraw(ctx, src, x, y, w, h, amount) {
  if (supportsFilter(ctx)) {
    ctx.filter = `blur(${amount}px)`;
    ctx.drawImage(src.image, x, y, w, h);
    ctx.filter = 'none';
    return;
  }
  const s = 1 / Math.max(2, amount / 2);
  const c = layerCanvas('blur', Math.max(2, Math.round(src.width * s)), Math.max(2, Math.round(src.height * s)));
  c.ctx.drawImage(src.image, 0, 0, c.canvas.width, c.canvas.height);
  ctx.drawImage(c.canvas, x, y, w, h);
}

function drawMedia(ctx, W, H, src, cut, clip, p, item, bg) {
  const sw = src.width, sh = src.height;
  if (!sw || !sh) return;
  const fit = clip.fit === 'contain' ? Math.min(W / sw, H / sh) : Math.max(W / sw, H / sh);
  let s = fit * (clip.zoom || 1) * item.scale;
  if (clip.kenburns) s *= 1 + 0.12 * p;
  const dw = sw * s, dh = sh * s;
  const cx = W / 2 + (clip.x || 0) * W + item.offsetX * W;
  const cy = H / 2 + (clip.y || 0) * H;

  ctx.save();
  ctx.globalAlpha = item.alpha;
  if (item.clipRect != null) {
    ctx.beginPath();
    ctx.rect(0, 0, W * item.clipRect, H);
    ctx.clip();
  }
  if (clip.fit === 'contain' || item.offsetX || cut) {
    ctx.fillStyle = bg || '#000';
    ctx.fillRect(item.offsetX * W, 0, W, H);
  }
  const f = clip.filter || {};
  const b = f.brightness ?? 1, c = f.contrast ?? 1, sat = f.saturation ?? 1;
  const needFilter = b !== 1 || c !== 1 || sat !== 1;
  // 切り抜きの背景：ぼかした元の映像
  if (cut && clip.cutout.bg === 'blur') blurDraw(ctx, src, cx - dw / 2, cy - dh / 2, dw, dh, Math.min(W, H) * 0.035);
  if (needFilter && supportsFilter(ctx)) ctx.filter = `brightness(${b}) contrast(${c}) saturate(${sat})`;
  ctx.drawImage((cut || src).image, cx - dw / 2, cy - dh / 2, dw, dh);
  ctx.filter = 'none';
  if (needFilter && !supportsFilter(ctx)) {
    // ctx.filter 非対応ブラウザ向けの簡易版（明るさ・彩度のみ）
    const x = cx - dw / 2, y = cy - dh / 2;
    ctx.globalCompositeOperation = 'source-atop';
    if (sat < 1) {
      ctx.globalCompositeOperation = 'saturation';
      ctx.globalAlpha = item.alpha * (1 - sat);
      ctx.fillStyle = '#808080';
      ctx.fillRect(x, y, dw, dh);
    }
    if (b !== 1) {
      ctx.globalCompositeOperation = 'source-atop';
      ctx.globalAlpha = item.alpha * Math.min(1, Math.abs(b - 1));
      ctx.fillStyle = b > 1 ? '#ffffff' : '#000000';
      ctx.fillRect(x, y, dw, dh);
    }
  }
  ctx.restore();
}

/* ---------- 重ねた映像（ワイプ / PiP） ---------- */

/** 重ねた映像の表示位置・大きさ（px）。ドラッグの当たり判定にも使う */
export function overlayBox(W, H, ov0, t, srcW, srcH) {
  const ov = withMotion(ov0, t);
  const base = Math.min(W, H) * (ov.scale ?? 1);
  const dw = Math.max(2, ov.w * base);
  const aspect = srcW && srcH ? srcH / srcW : 9 / 16;
  const dh = ov.mask === 'circle' ? dw : dw * aspect;
  const cx = ov.x * W, cy = ov.y * H;
  return { ov, cx, cy, dw, dh, box: { x: cx - dw / 2, y: cy - dh / 2, w: dw, h: dh } };
}

function maskPath(ctx, ov, dw, dh) {
  ctx.beginPath();
  if (ov.mask === 'circle') ctx.ellipse(0, 0, dw / 2, dh / 2, 0, 0, Math.PI * 2);
  else if (ov.mask === 'round') roundRect(ctx, -dw / 2, -dh / 2, dw, dh, Math.min(dw, dh) * Math.min(0.5, ov.radius ?? 0.08));
  else ctx.rect(-dw / 2, -dh / 2, dw, dh);
}

function drawOverlay(ctx, W, H, ov0, t, getSource, opts) {
  if (t < ov0.start || t >= overlayEnd(ov0)) return;
  const mt = Math.min(ov0.out, ov0.in + (t - ov0.start) * (ov0.speed || 1));
  let src = getSource({ clip: ov0, overlay: true }, mt);
  if (!src || !src.width) return;
  const cut = ov0.cutout?.mode ? cutout(src, ov0.cutout, ov0.id, mt, opts) : null;
  if (cut) src = cut;
  const { ov, cx, cy, dw, dh } = overlayBox(W, H, ov0, t, src.width, src.height);
  const a = shapeAnim(ov, t);
  const alpha = (ov.opacity ?? 1) * a.alpha;
  if (alpha <= 0) return;
  const base = Math.min(W, H);
  const is3D = ov.rx || ov.ry;
  const target = is3D ? layerCanvas('ov', W, H).ctx : ctx;

  target.save();
  target.globalAlpha = alpha;
  target.translate(cx, cy + a.dy * dh);
  target.rotate(((ov.rotation || 0) + a.rot) * Math.PI / 180);
  target.scale(a.scale, a.scale);
  if (a.reveal < 1) { target.beginPath(); target.rect(-dw / 2 - 4, -dh / 2 - 4, (dw + 8) * a.reveal, dh + 8); target.clip(); }
  const shadow = () => {
    if (!ov.shadow) return;
    target.shadowColor = 'rgba(0,0,0,0.45)';
    target.shadowBlur = base * 0.03;
    target.shadowOffsetY = base * 0.01;
  };
  // 画像は枠いっぱいに（はみ出しは切る）
  const s = Math.max(dw / src.width, dh / src.height);
  const iw = src.width * s, ih = src.height * s;
  if (cut || ov.mask === 'none') {
    // 切り抜き：形の影ではなく、人物の輪郭に影を付ける
    shadow();
    if (!cut && ov.mask === 'none') { target.beginPath(); target.rect(-dw / 2, -dh / 2, dw, dh); }
    target.drawImage(src.image, -iw / 2, -ih / 2, iw, ih);
    target.shadowColor = 'transparent';
  } else {
    maskPath(target, ov, dw, dh);
    shadow();
    target.fillStyle = '#000';
    target.fill();
    target.shadowColor = 'transparent';
    target.save();
    target.clip();
    target.drawImage(src.image, -iw / 2, -ih / 2, iw, ih);
    target.restore();
  }
  if (!cut && ov.border > 0) {
    maskPath(target, ov, dw, dh);
    target.lineWidth = ov.border * base;
    target.strokeStyle = ov.borderColor || '#fff';
    target.stroke();
  }
  target.restore();

  if (is3D) {
    const r = Math.hypot(dw, dh) / 2 * Math.max(1, a.scale) * 1.2 + base * 0.05;
    draw3D(ctx, target.canvas, { x: cx - r, y: cy - r, w: r * 2, h: r * 2 }, cx, cy, { rx: ov.rx, ry: ov.ry, perspective: ov.perspective, backface: true }, W, H);
  }
}

/* ---------- Motion Prompt の要素 ---------- */

function drawMotion(ctx, W, H, m0, t) {
  if (t < m0.start || t >= m0.end) return;
  const m = withMotion(m0, t);
  const a = shapeAnim(m, t);
  const alpha = (m.opacity ?? 1) * a.alpha;
  if (alpha <= 0) return;
  const el = motionElement(m.ref);
  if (!el) return;
  const b0 = motionBox(W, H, m, el.cw, el.ch);
  const mm = { ...m, scale: (m.scale ?? 1) * a.scale, rotation: (m.rotation || 0) + a.rot, y: (m.cover ? 0.5 : m.y ?? 0.5) + (a.dy * b0.dh) / H };
  // 要素は合成モードなども使うので、専用の下書きに描いてから重ねる
  const { canvas, ctx: lc } = layerCanvas('mp', W, H);
  if (!drawMotionElement(lc, W, H, mm, t)) return;
  const b = motionBox(W, H, mm, el.cw, el.ch);
  ctx.save();
  ctx.globalAlpha = alpha;
  if (a.reveal < 1) { ctx.beginPath(); ctx.rect(b.box.x, 0, b.box.w * a.reveal, H); ctx.clip(); }
  if (m.rx || m.ry) {
    const r = Math.hypot(b.dw, b.dh) / 2 * 1.05;
    draw3D(ctx, canvas, { x: b.cx - r, y: b.cy - r, w: r * 2, h: r * 2 }, b.cx, b.cy, { rx: m.rx, ry: m.ry, perspective: m.perspective, backface: true }, W, H);
  } else {
    ctx.drawImage(canvas, 0, 0);
  }
  ctx.restore();
}

/* ---------- テキスト ---------- */

function wrapLines(ctx, text, maxW) {
  const lines = [];
  for (const para of String(text).split('\n')) {
    let line = '';
    for (const ch of para) {
      const test = line + ch;
      if (line && ctx.measureText(test).width > maxW) {
        // 英単語の途中ならスペースで折り返す
        const sp = line.lastIndexOf(' ');
        if (sp > 0 && /\w/.test(ch)) {
          lines.push(line.slice(0, sp));
          line = line.slice(sp + 1) + ch;
        } else {
          lines.push(line);
          line = ch;
        }
      } else line = test;
    }
    lines.push(line);
  }
  return lines;
}

function animState(tx, t) {
  const local = t - tx.start, remain = tx.end - t;
  const st = { alpha: 1, scale: 1, dy: 0, chars: Infinity };
  const IN = 0.3, OUT = 0.2;
  if (tx.animOut ?? tx.anim !== 'none') { if (remain < OUT) st.alpha = Math.max(0, remain / OUT); }
  if (tx.anim === 'none') return st;
  const p = Math.min(1, local / IN);
  switch (tx.anim) {
    case 'fade': st.alpha *= p; break;
    case 'pop': {
      // 0.6 → 1.08 → 1.0
      st.scale = p < 0.7 ? 0.6 + (0.48 * p) / 0.7 : 1.08 - (0.08 * (p - 0.7)) / 0.3;
      st.alpha *= Math.min(1, p * 2);
      break;
    }
    case 'slide': st.dy = (1 - (1 - (1 - p) ** 3)) * 0.4; st.alpha *= p; break;
    case 'typewriter': st.chars = Math.floor(local / 0.07) + 1; break;
  }
  return st;
}

/** ふちの一覧（太い順）。strokes 配列と、従来の stroke/strokeWidth の両方に対応 */
function strokeList(tx) {
  const list = [];
  for (const s of tx.strokes || []) if (s && s.color && s.width > 0) list.push(s);
  if (tx.stroke && tx.strokeWidth > 0) list.push({ color: tx.stroke, width: tx.strokeWidth });
  return list.sort((a, b) => b.width - a.width);
}

/** テキストのレイアウトを計算（描画とドラッグ判定の両方で使う。t を渡すと動きも反映） */
export function measureText(ctx, W, H, tx, t) {
  if (t != null) tx = withMotion(tx, t);
  const font = FONTS[tx.font] || FONTS.gothic;
  const px = Math.max(8, tx.size * Math.min(W, H) * (tx.scale ?? 1));
  ctx.font = `${font.weight} ${px}px ${font.family}`;
  const lines = wrapLines(ctx, tx.text, W * 0.9);
  const lh = px * 1.28;
  const widths = lines.map((l) => ctx.measureText(l).width);
  const bw = Math.max(1, ...widths);
  const bh = lh * lines.length;
  const maxStroke = strokeList(tx)[0]?.width || 0;
  const pad = tx.bg ? px * 0.35 : maxStroke * px;
  const cx = tx.x * W, cy = tx.y * H;
  return { px, lh, lines, widths, cx, cy, box: { x: cx - bw / 2 - pad, y: cy - bh / 2 - pad, w: bw + pad * 2, h: bh + pad * 2 } };
}

/** 3D 用：立体・光彩なども含めた外枠 */
function textBounds(ctx, W, H, tx, t) {
  const m = measureText(ctx, W, H, tx, t);
  const extra = m.px * (0.4 + (tx.extrude?.depth || 0) + (tx.glow ? tx.glow.size : 0));
  return { cx: m.cx, cy: m.cy, box: { x: m.box.x - extra, y: m.box.y - extra, w: m.box.w + extra * 2, h: m.box.h + extra * 2 } };
}

export function drawText(ctx, W, H, tx0, t) {
  if (t < tx0.start || t >= tx0.end || !String(tx0.text).trim()) return;
  const tx = withMotion(tx0, t);
  const m = measureText(ctx, W, H, tx);
  const a = animState(tx, t);
  const alpha = a.alpha * (tx.opacity ?? 1);
  if (alpha <= 0) return;

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(m.cx, m.cy + a.dy * m.px);
  if (tx.rotation) ctx.rotate(tx.rotation * Math.PI / 180);
  ctx.scale(a.scale, a.scale);
  ctx.translate(-m.cx, -m.cy);

  if (tx.bg) {
    const b = m.box;
    ctx.fillStyle = paint(ctx, tx.bg, b);
    roundRect(ctx, b.x, b.y, b.w, b.h, m.px * 0.25);
    ctx.fill();
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.miterLimit = 2;

  const strokes = strokeList(tx);
  const fill = paint(ctx, tx.color || '#fff', m.box);
  const ex = tx.extrude && tx.extrude.depth > 0 ? tx.extrude : null;

  const drawLine = (s, x, y) => {
    const dropShadow = () => {
      if (!tx.shadow) return;
      ctx.shadowColor = 'rgba(0,0,0,0.65)';
      ctx.shadowBlur = m.px * 0.18;
      ctx.shadowOffsetY = m.px * 0.05;
    };
    const noShadow = () => { ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0; };
    let shadowUsed = false;
    // 立体（押し出し）：奥から手前へ少しずつずらして重ねる
    if (ex) {
      const ang = ((ex.angle ?? 135) * Math.PI) / 180;
      const depth = ex.depth * m.px;
      const steps = Math.min(48, Math.max(2, Math.ceil(depth / 1.2)));
      const outer = strokes[0]?.width || 0;
      ctx.fillStyle = ex.color || '#333';
      ctx.strokeStyle = ex.color || '#333';
      ctx.lineWidth = outer * m.px * 2;
      for (let i = steps; i >= 1; i--) {
        const d = (depth * i) / steps;
        const ox = Math.cos(ang) * d, oy = Math.sin(ang) * d;
        if (i === steps) { dropShadow(); shadowUsed = true; } else noShadow();
        if (outer > 0) ctx.strokeText(s, x + ox, y + oy);
        ctx.fillText(s, x + ox, y + oy);
      }
      noShadow();
    }
    // ふち（太い順）
    strokes.forEach((st, i) => {
      if (i === 0 && !shadowUsed) { dropShadow(); shadowUsed = true; } else noShadow();
      ctx.strokeStyle = paint(ctx, st.color, m.box);
      ctx.lineWidth = st.width * m.px * 2;
      ctx.strokeText(s, x, y);
    });
    noShadow();
    // 光彩
    if (tx.glow && tx.glow.size > 0) {
      ctx.shadowColor = tx.glow.color || '#fff';
      ctx.shadowBlur = tx.glow.size * m.px;
      ctx.fillStyle = tx.glow.color || '#fff';
      ctx.fillText(s, x, y);
      ctx.fillText(s, x, y);
      noShadow();
    }
    if (!shadowUsed) dropShadow();
    ctx.fillStyle = fill;
    ctx.fillText(s, x, y);
    noShadow();
  };

  let remaining = a.chars;
  const top = m.cy - (m.lh * m.lines.length) / 2 + m.lh / 2;
  m.lines.forEach((line, i) => {
    if (remaining <= 0) return;
    let s = line;
    if ([...line].length > remaining) s = [...line].slice(0, remaining).join('');
    remaining -= [...line].length;
    const y = top + i * m.lh;
    // 文字送りでも位置がぶれないよう、全文の幅で左端をそろえる
    const x = s === line ? m.cx : m.cx - m.widths[i] / 2 + ctx.measureText(s).width / 2;
    drawLine(s, x, y);
  });
  ctx.restore();
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

/** 書き出し前にフォントを読み込んでおく */
export async function loadFonts(project) {
  if (!document.fonts) return;
  const jobs = [];
  for (const tx of project.texts) {
    const f = FONTS[tx.font] || FONTS.gothic;
    jobs.push(document.fonts.load(`${f.weight} 40px ${f.family}`, tx.text).catch(() => {}));
  }
  await Promise.race([Promise.all(jobs), new Promise((r) => setTimeout(r, 4000))]);
}
