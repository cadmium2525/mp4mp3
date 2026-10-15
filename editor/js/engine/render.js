/*
 * 1フレームを描画する。プレビューと書き出しで同じ関数を使うので、見た目が必ず一致する。
 */
import { activeClipsAt, dipAt, mediaTime } from './project.js';

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

/**
 * @param {CanvasRenderingContext2D} ctx 出力サイズ（project.width × project.height）のコンテキスト
 * @param {(L, mediaT: number) => ({image: CanvasImageSource, width: number, height: number} | null)} getSource
 * @param {{hideTextId?: string}} [opts]
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
    const src = getSource(L, mediaTime(L, t));
    if (!src) continue;
    const p = L.dur > 0 ? Math.min(1, Math.max(0, (t - L.start) / L.dur)) : 0;
    drawMedia(ctx, W, H, src, L.clip, p, item, project.background);
  }

  const dip = dipAt(project, layout, t);
  if (dip) {
    ctx.globalAlpha = dip.alpha;
    ctx.fillStyle = dip.color;
    ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = 1;
  }

  for (const tx of project.texts) {
    if (tx.id === opts.hideTextId) continue;
    drawText(ctx, W, H, tx, t);
  }
  ctx.restore();
}

function drawMedia(ctx, W, H, src, clip, p, item, bg) {
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
  if (clip.fit === 'contain' || item.offsetX) {
    ctx.fillStyle = bg || '#000';
    ctx.fillRect(item.offsetX * W, 0, W, H);
  }
  const f = clip.filter || {};
  const b = f.brightness ?? 1, c = f.contrast ?? 1, sat = f.saturation ?? 1;
  const needFilter = b !== 1 || c !== 1 || sat !== 1;
  if (needFilter && supportsFilter(ctx)) ctx.filter = `brightness(${b}) contrast(${c}) saturate(${sat})`;
  ctx.drawImage(src.image, cx - dw / 2, cy - dh / 2, dw, dh);
  ctx.filter = 'none';
  if (needFilter && !supportsFilter(ctx)) {
    // ctx.filter 非対応ブラウザ向けの簡易版（明るさ・彩度のみ）
    const x = cx - dw / 2, y = cy - dh / 2;
    if (sat < 1) {
      ctx.globalCompositeOperation = 'saturation';
      ctx.globalAlpha = item.alpha * (1 - sat);
      ctx.fillStyle = '#808080';
      ctx.fillRect(x, y, dw, dh);
    }
    if (b !== 1) {
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = item.alpha * Math.min(1, Math.abs(b - 1));
      ctx.fillStyle = b > 1 ? '#ffffff' : '#000000';
      ctx.fillRect(x, y, dw, dh);
    }
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
  if (tx.anim === 'none') return st;
  if (remain < OUT) st.alpha = Math.max(0, remain / OUT);
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

/** テキストのレイアウトを計算（描画とドラッグ判定の両方で使う） */
export function measureText(ctx, W, H, tx) {
  const font = FONTS[tx.font] || FONTS.gothic;
  const px = Math.max(8, tx.size * Math.min(W, H));
  ctx.font = `${font.weight} ${px}px ${font.family}`;
  const lines = wrapLines(ctx, tx.text, W * 0.9);
  const lh = px * 1.28;
  const widths = lines.map((l) => ctx.measureText(l).width);
  const bw = Math.max(1, ...widths);
  const bh = lh * lines.length;
  const pad = tx.bg ? px * 0.35 : (tx.strokeWidth || 0) * px;
  const cx = tx.x * W, cy = tx.y * H;
  return { px, lh, lines, widths, cx, cy, box: { x: cx - bw / 2 - pad, y: cy - bh / 2 - pad, w: bw + pad * 2, h: bh + pad * 2 } };
}

export function drawText(ctx, W, H, tx, t) {
  if (t < tx.start || t >= tx.end || !String(tx.text).trim()) return;
  const m = measureText(ctx, W, H, tx);
  const a = animState(tx, t);
  if (a.alpha <= 0) return;

  ctx.save();
  ctx.globalAlpha = a.alpha;
  ctx.translate(m.cx, m.cy + a.dy * m.px);
  ctx.scale(a.scale, a.scale);
  ctx.translate(-m.cx, -m.cy);

  if (tx.bg) {
    const b = m.box;
    ctx.fillStyle = tx.bg;
    roundRect(ctx, b.x, b.y, b.w, b.h, m.px * 0.25);
    ctx.fill();
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.miterLimit = 2;

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
    if (tx.shadow) {
      ctx.shadowColor = 'rgba(0,0,0,0.65)';
      ctx.shadowBlur = m.px * 0.18;
      ctx.shadowOffsetY = m.px * 0.05;
    }
    if (tx.stroke && tx.strokeWidth > 0) {
      ctx.strokeStyle = tx.stroke;
      ctx.lineWidth = tx.strokeWidth * m.px * 2;
      ctx.strokeText(s, x, y);
      ctx.shadowColor = 'transparent';
    }
    ctx.fillStyle = tx.color || '#fff';
    ctx.fillText(s, x, y);
    ctx.shadowColor = 'transparent';
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
