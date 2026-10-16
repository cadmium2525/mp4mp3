/*
 * かなでる：音の見える化シート。
 * 波形・ラウドネス・スペクトログラム・クロマ（和音）・ピアノロール・周波数バランス・トラック別の音量を1枚に描く。
 * 描画先は Painter（iPhone では canvas、Node では下の Raster）なので、どちらでも同じ図になる。
 * ラベルは Node でも描けるよう英数字のみ。
 */
import { pitchesOf } from './dsp.js';
import { trackNotes, beatsPerBar, secPerBeat } from './song.js';
import { THIRD_OCT, BANDS } from './analyze.js';

/* ---------------- 5x7 のビットマップ文字 ---------------- */

const FONT_SRC = `
0 .###. #...# #..## #.#.# ##..# #...# .###.
1 ..#.. .##.. ..#.. ..#.. ..#.. ..#.. .###.
2 .###. #...# ....# ...#. ..#.. .#... #####
3 ##### ...#. ..#.. ...#. ....# #...# .###.
4 ...#. ..##. .#.#. #..#. ##### ...#. ...#.
5 ##### #.... ####. ....# ....# #...# .###.
6 ..##. .#... #.... ####. #...# #...# .###.
7 ##### ....# ...#. ..#.. .#... .#... .#...
8 .###. #...# #...# .###. #...# #...# .###.
9 .###. #...# #...# .#### ....# ...#. .##..
A .###. #...# #...# ##### #...# #...# #...#
B ####. #...# #...# ####. #...# #...# ####.
C .###. #...# #.... #.... #.... #...# .###.
D ###.. #..#. #...# #...# #...# #..#. ###..
E ##### #.... #.... ####. #.... #.... #####
F ##### #.... #.... ####. #.... #.... #....
G .###. #...# #.... #.### #...# #...# .####
H #...# #...# #...# ##### #...# #...# #...#
I .###. ..#.. ..#.. ..#.. ..#.. ..#.. .###.
J ..### ...#. ...#. ...#. ...#. #..#. .##..
K #...# #..#. #.#.. ##... #.#.. #..#. #...#
L #.... #.... #.... #.... #.... #.... #####
M #...# ##.## #.#.# #.#.# #...# #...# #...#
N #...# #...# ##..# #.#.# #..## #...# #...#
O .###. #...# #...# #...# #...# #...# .###.
P ####. #...# #...# ####. #.... #.... #....
Q .###. #...# #...# #...# #.#.# #..#. .##.#
R ####. #...# #...# ####. #.#.. #..#. #...#
S .#### #.... #.... .###. ....# ....# ####.
T ##### ..#.. ..#.. ..#.. ..#.. ..#.. ..#..
U #...# #...# #...# #...# #...# #...# .###.
V #...# #...# #...# #...# #...# .#.#. ..#..
W #...# #...# #...# #.#.# #.#.# #.#.# .#.#.
X #...# #...# .#.#. ..#.. .#.#. #...# #...#
Y #...# #...# .#.#. ..#.. ..#.. ..#.. ..#..
Z ##### ....# ...#. ..#.. .#... #.... #####
a ..... ..... .###. ....# .#### #...# .####
b #.... #.... #.##. ##..# #...# #...# ####.
c ..... ..... .###. #.... #.... #...# .###.
d ....# ....# .##.# #..## #...# #...# .####
e ..... ..... .###. #...# ##### #.... .###.
f ..##. .#..# .#... ###.. .#... .#... .#...
g ..... .#### #...# #...# .#### ....# .###.
h #.... #.... #.##. ##..# #...# #...# #...#
i ..#.. ..... .##.. ..#.. ..#.. ..#.. .###.
j ...#. ..... ..##. ...#. ...#. #..#. .##..
k #.... #.... #..#. #.#.. ##... #.#.. #..#.
l .##.. ..#.. ..#.. ..#.. ..#.. ..#.. .###.
m ..... ..... ##.#. #.#.# #.#.# #...# #...#
n ..... ..... #.##. ##..# #...# #...# #...#
o ..... ..... .###. #...# #...# #...# .###.
p ..... ..... ####. #...# ####. #.... #....
q ..... ..... .##.# #..## .#### ....# ....#
r ..... ..... #.##. ##..# #.... #.... #....
s ..... ..... .###. #.... .###. ....# ####.
t .#... .#... ###.. .#... .#... .#..# ..##.
u ..... ..... #...# #...# #...# #..## .##.#
v ..... ..... #...# #...# #...# .#.#. ..#..
w ..... ..... #...# #...# #.#.# #.#.# .#.#.
x ..... ..... #...# .#.#. ..#.. .#.#. #...#
y ..... ..... #...# #...# .#### ....# .###.
z ..... ..... ##### ...#. ..#.. .#... #####
. ..... ..... ..... ..... ..... .##.. .##..
, ..... ..... ..... ..... .##.. ..#.. .#...
: ..... .##.. .##.. ..... .##.. .##.. .....
- ..... ..... ..... ##### ..... ..... .....
+ ..... ..#.. ..#.. ##### ..#.. ..#.. .....
/ ..... ....# ...#. ..#.. .#... #.... .....
( ...#. ..#.. .#... .#... .#... ..#.. ...#.
) .#... ..#.. ...#. ...#. ...#. ..#.. .#...
% ##... ##..# ...#. ..#.. .#... #..## ...##
# .#.#. .#.#. ##### .#.#. ##### .#.#. .#.#.
_ ..... ..... ..... ..... ..... ..... #####
= ..... ..... ##### ..... ##### ..... .....
[ .###. .#... .#... .#... .#... .#... .###.
] .###. ...#. ...#. ...#. ...#. ...#. .###.
< ...#. ..#.. .#... #.... .#... ..#.. ...#.
> .#... ..#.. ...#. ....# ...#. ..#.. .#...
! ..#.. ..#.. ..#.. ..#.. ..#.. ..... ..#..
? .###. #...# ....# ...#. ..#.. ..... ..#..
' ..#.. ..#.. .#... ..... ..... ..... .....
* ..... ..#.. #.#.# .###. #.#.# ..#.. .....
| ..#.. ..#.. ..#.. ..#.. ..#.. ..#.. ..#..
~ ..... ..... .#... #.#.# ...#. ..... .....
`;
const FONT = {};
for (const line of FONT_SRC.trim().split('\n')) {
  const [ch, ...rows] = line.split(' ');
  FONT[ch] = rows.map((r) => [...r].map((c) => c === '#'));
}

/** Node 用の簡単なラスター（RGBA）。canvas と同じ Painter の形 */
export class Raster {
  constructor(w, h, bg = [12, 14, 22]) {
    this.w = w; this.h = h;
    this.px = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) { this.px[i * 4] = bg[0]; this.px[i * 4 + 1] = bg[1]; this.px[i * 4 + 2] = bg[2]; this.px[i * 4 + 3] = 255; }
  }
  rect(x, y, w, h, c) {
    const a = c[3] == null ? 1 : c[3];
    const x0 = Math.max(0, Math.round(x)), y0 = Math.max(0, Math.round(y));
    const x1 = Math.min(this.w, Math.round(x + w)), y1 = Math.min(this.h, Math.round(y + h));
    for (let yy = y0; yy < y1; yy++) {
      for (let xx = x0; xx < x1; xx++) {
        const i = (yy * this.w + xx) * 4;
        this.px[i] += (c[0] - this.px[i]) * a;
        this.px[i + 1] += (c[1] - this.px[i + 1]) * a;
        this.px[i + 2] += (c[2] - this.px[i + 2]) * a;
      }
    }
  }
  /** 小さな画像（RGBA 配列）を拡大して貼る */
  image(x, y, w, h, iw, ih, data) {
    for (let yy = 0; yy < h; yy++) {
      const sy = Math.min(ih - 1, Math.floor((yy / h) * ih));
      for (let xx = 0; xx < w; xx++) {
        const sx = Math.min(iw - 1, Math.floor((xx / w) * iw));
        const si = (sy * iw + sx) * 4, di = ((y + yy) * this.w + (x + xx)) * 4;
        if (x + xx < 0 || x + xx >= this.w || y + yy < 0 || y + yy >= this.h) continue;
        this.px[di] = data[si]; this.px[di + 1] = data[si + 1]; this.px[di + 2] = data[si + 2];
      }
    }
  }
  text(x, y, s, c, scale = 1) {
    let cx = x;
    for (const ch of String(s)) {
      if (ch === ' ') { cx += 6 * scale; continue; }
      const g = FONT[ch] || FONT['?'];
      for (let r = 0; r < 7; r++) for (let k = 0; k < 5; k++) if (g[r][k]) this.rect(cx + k * scale, y + r * scale, scale, scale, c);
      cx += 6 * scale;
    }
    return cx - x;
  }
  textWidth(s, scale = 1) { return String(s).length * 6 * scale; }
}

/** canvas 用の Painter（ブラウザ） */
export class CanvasPainter {
  constructor(ctx) { this.ctx = ctx; this.w = ctx.canvas.width; this.h = ctx.canvas.height; }
  rect(x, y, w, h, c) { this.ctx.fillStyle = `rgba(${c[0]},${c[1]},${c[2]},${c[3] == null ? 1 : c[3]})`; this.ctx.fillRect(x, y, w, h); }
  image(x, y, w, h, iw, ih, data) {
    const c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(iw, ih) : Object.assign(document.createElement('canvas'), { width: iw, height: ih });
    c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(data), iw, ih), 0, 0);
    this.ctx.imageSmoothingEnabled = false;
    this.ctx.drawImage(c, x, y, w, h);
  }
  text(x, y, s, c, scale = 1) {
    this.ctx.fillStyle = `rgba(${c[0]},${c[1]},${c[2]},${c[3] == null ? 1 : c[3]})`;
    this.ctx.font = `${8 * scale}px ui-monospace, Menlo, monospace`;
    this.ctx.textBaseline = 'top';
    this.ctx.fillText(s, x, y);
    return this.ctx.measureText(s).width;
  }
  textWidth(s, scale = 1) { return String(s).length * 6 * scale; }
}

/* ---------------- 色 ---------------- */

const MAGMA = [[0, 0, 4], [28, 16, 68], [79, 18, 123], [129, 37, 129], [181, 54, 122], [229, 80, 100], [251, 135, 97], [254, 194, 135], [252, 253, 191]];
function cmap(u) {
  u = Math.max(0, Math.min(1, u));
  const p = u * (MAGMA.length - 1), i = Math.min(MAGMA.length - 2, Math.floor(p)), f = p - i;
  return MAGMA[i].map((v, k) => v + (MAGMA[i + 1][k] - v) * f);
}
const TRACK_COLORS = [[255, 107, 92], [76, 134, 255], [46, 219, 168], [255, 200, 61], [186, 120, 255], [255, 140, 200], [100, 220, 255], [255, 160, 60], [160, 230, 90], [230, 230, 230]];
const C = { text: [220, 225, 240], dim: [130, 140, 170], grid: [60, 66, 90], panel: [20, 24, 36], warn: [255, 120, 100], ok: [90, 220, 160], accent: [255, 200, 61] };

/* ---------------- シート ---------------- */

/**
 * 解析結果のシートを描く。
 * a: analyzeAudio の結果、song: 曲（あればピアノロールと小節線）
 * 戻り値：使った高さ
 */
export function sheetHeight(a, song) {
  let h = 40 + 150 + 12 + 260 + 12 + 120 + 12;
  if (song) h += 230 + 12;
  h += 200 + 12;
  if (a.stems) h += 30 + Object.keys(a.stems).filter((k) => !k.startsWith('_')).length * 16 + 12;
  return h + 10;
}

export function drawSheet(P, a, { song = null, title = '', targetLufs = -14 } = {}) {
  const W = P.w, X0 = 70, PW = W - X0 - 20;
  const dur = a.duration;
  const xOf = (t) => X0 + (t / dur) * PW;
  let y = 8;
  // 見出し
  P.text(10, y, (title || 'ANALYSIS').slice(0, 60), C.text, 2);
  const head = `LUFS ${a.lufs}  LRA ${a.lra}  TP ${a.truePeakDb}dB  PEAK ${a.peakDb}dB  CREST ${a.crest}dB  CORR ${a.stereo.correlation}  WIDTH ${a.stereo.width}  KEY ${asciiKey(a.key.name)}  TEMPO ${a.tempo ?? '-'}  ${dur}s`;
  P.text(10, y + 18, head, C.dim, 1);
  y += 40;

  const barLines = (top, h) => {
    if (!song) return;
    const barSec = beatsPerBar(song) * secPerBeat(song);
    for (let b = 0, t = 0; t < dur; b++, t = b * barSec) {
      P.rect(xOf(t), top, 1, h, b % 4 === 0 ? [255, 255, 255, 0.22] : [255, 255, 255, 0.08]);
      if (b % 4 === 0 || barSec * PW / dur > 26) P.text(xOf(t) + 2, top + 2, String(b + 1), [255, 255, 255, 0.5]);
    }
  };

  // 1. 波形とラウドネス
  {
    const h = 150, mid = y + h / 2;
    P.rect(X0, y, PW, h, C.panel);
    label(P, 10, y, 'WAVE', 'LOUD');
    const spec = a._wave;
    if (spec) {
      for (let x = 0; x < PW; x++) {
        const mn = spec.min[x], mx = spec.max[x], rms = spec.rms[x];
        P.rect(X0 + x, mid - mx * (h / 2), 1, Math.max(1, (mx - mn) * (h / 2)), [90, 110, 170]);
        P.rect(X0 + x, mid - rms * (h / 2), 1, Math.max(1, rms * h), [150, 175, 240]);
      }
    }
    P.rect(X0, mid, PW, 1, C.grid);
    // 短時間ラウドネス（-40〜0 LUFS）
    const st = a._st || [];
    const ly = (v) => y + h - ((Math.max(-40, Math.min(0, v)) + 40) / 40) * h;
    P.rect(X0, ly(targetLufs), PW, 1, [255, 200, 61, 0.35]);
    P.text(X0 + PW - 70, ly(targetLufs) - 9, `${targetLufs} LUFS`, [255, 200, 61, 0.8]);
    for (let k = 0; k < st.length; k++) {
      const x = X0 + ((k * 0.1) / dur) * PW;
      if (st[k] > -70) P.rect(x, ly(st[k]), 2, 2, [255, 200, 61]);
    }
    // クリックの疑い
    for (const t of a.clicks || []) { P.rect(xOf(t), y, 2, h, [255, 60, 60, 0.9]); }
    barLines(y, h);
    y += h + 12;
  }

  // 2. スペクトログラム（対数周波数）
  {
    const h = 260;
    const sp = a._spec;
    label(P, 10, y, 'SPEC');
    if (sp && sp.frames.length) {
      const bins = sp.frames[0].length, nf = sp.frames.length;
      const iw = Math.min(nf, PW), ih = bins;
      const img = new Uint8ClampedArray(iw * ih * 4);
      for (let x = 0; x < iw; x++) {
        const f0 = Math.floor((x / iw) * nf), f1 = Math.max(f0 + 1, Math.floor(((x + 1) / iw) * nf));
        for (let b = 0; b < bins; b++) {
          let m = 0;
          for (let f = f0; f < f1; f++) m = Math.max(m, sp.frames[f][b]);
          const d = 20 * Math.log10(m + 1e-9);
          const c = cmap((d + 90) / 85);
          const i = ((ih - 1 - b) * iw + x) * 4;
          img[i] = c[0]; img[i + 1] = c[1]; img[i + 2] = c[2]; img[i + 3] = 255;
        }
      }
      P.image(X0, y, PW, h, iw, ih, img);
      // 周波数の目盛り
      const fmin = sp.edges[0], fmax = sp.edges[sp.edges.length - 1];
      for (const f of [50, 100, 200, 500, 1000, 2000, 5000, 10000]) {
        const yy = y + h - (Math.log(f / fmin) / Math.log(fmax / fmin)) * h;
        P.rect(X0, yy, PW, 1, [255, 255, 255, 0.12]);
        P.text(X0 - 36, yy - 3, f >= 1000 ? `${f / 1000}k` : String(f), C.dim);
      }
    }
    barLines(y, h);
    y += h + 12;
  }

  // 3. クロマ（音名ごとの強さ）と検出した和音
  {
    const h = 120, rowH = (h - 14) / 12;
    label(P, 10, y, 'CHROMA');
    P.rect(X0, y, PW, h, C.panel);
    const sp = a._spec;
    if (sp) {
      const nf = sp.chroma.length;
      const cols = Math.min(PW, nf);
      for (let x = 0; x < cols; x++) {
        const f0 = Math.floor((x / cols) * nf), f1 = Math.max(f0 + 1, Math.floor(((x + 1) / cols) * nf));
        const v = new Float32Array(12);
        for (let f = f0; f < f1; f++) for (let k = 0; k < 12; k++) v[k] += sp.chroma[f][k];
        const mx = Math.max(...v) || 1;
        for (let k = 0; k < 12; k++) {
          const u = v[k] / mx;
          if (u > 0.15) P.rect(X0 + (x / cols) * PW, y + 14 + (11 - k) * rowH, PW / cols + 1, rowH, [255, 200, 61, u * u]);
        }
      }
      ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'].forEach((nm, k) => P.text(X0 - 20, y + 14 + (11 - k) * rowH + rowH / 2 - 3, nm, C.dim));
    }
    if (song && a.chords?.length) {
      const per = (a.chordStep || beatsPerBar(song)) * secPerBeat(song);
      a.chords.forEach((c, i) => P.text(xOf(i * per) + 2, y + 3, c.replace('（無音）', '-').slice(0, 7), C.text));
    }
    barLines(y, h);
    y += h + 12;
  }

  // 4. ピアノロール（曲データから）
  if (song) {
    const h = 230;
    label(P, 10, y, 'NOTES');
    P.rect(X0, y, PW, h, C.panel);
    const spb = secPerBeat(song);
    const all = [];
    const drums = [];
    (song.tracks || []).forEach((tr, ti) => {
      const notes = trackNotes(song, tr);
      const isDrum = tr.type === 'drums' || tr.kit;
      if (tr.type === 'sfx') return;
      for (const n of notes) {
        if (isDrum) drums.push({ ...n, ti });
        else for (const m of pitchesOf(n.n)) all.push({ t: n.t, d: n.d, m: m + (tr.transpose || 0) + (n.tr || 0), ti, v: n.v });
      }
    });
    const drumH = drums.length ? 46 : 0;
    const lo = Math.min(...all.map((n) => n.m), 48) - 1, hi = Math.max(...all.map((n) => n.m), 72) + 1;
    const ph = h - drumH - 4;
    const rowH = ph / (hi - lo + 1);
    for (let m = lo; m <= hi; m++) {
      if (m % 12 === 0) { P.rect(X0, y + (hi - m) * rowH, PW, 1, [255, 255, 255, 0.1]); P.text(X0 - 24, y + (hi - m) * rowH - 3, `C${m / 12 - 1}`, C.dim); }
    }
    for (const n of all) {
      const c = TRACK_COLORS[n.ti % TRACK_COLORS.length];
      P.rect(xOf(n.t * spb), y + (hi - n.m) * rowH, Math.max(2, (n.d * spb / dur) * PW - 1), Math.max(2, rowH - 0.5), [c[0], c[1], c[2], 0.45 + n.v * 0.5]);
    }
    if (drumH) {
      const names = [...new Set(drums.map((d) => String(d.n)))];
      const dy = y + h - drumH;
      const rh = drumH / Math.max(1, names.length);
      names.forEach((nm, k) => P.text(X0 - 48, dy + k * rh, nm.slice(0, 7), C.dim));
      for (const d of drums) {
        const k = names.indexOf(String(d.n));
        const c = TRACK_COLORS[d.ti % TRACK_COLORS.length];
        P.rect(xOf(d.t * spb), dy + k * rh, 2, Math.max(2, rh - 1), [c[0], c[1], c[2], 0.4 + d.v * 0.6]);
      }
    }
    // トラックの凡例
    let lx = X0;
    (song.tracks || []).forEach((tr, ti) => {
      const c = TRACK_COLORS[ti % TRACK_COLORS.length];
      P.rect(lx, y + h + 2, 8, 8, c);
      lx += 12 + P.text(lx + 12, y + h + 3, String(tr.id || ti), C.dim) + 8;
    });
    barLines(y, h);
    y += h + 12;
  }

  // 5. 周波数バランス（1/3 オクターブ）
  {
    const h = 200;
    label(P, 10, y, 'BAL');
    const w = Math.min(PW * 0.62, 900);
    P.rect(X0, y, w, h, C.panel);
    const vals = THIRD_OCT.map((c) => a.thirdOct[c]);
    const ref = refCurve(vals);
    const top = Math.max(...vals) + 3;
    const yv = (v) => y + h - 14 - ((v - (top - 48)) / 48) * (h - 20);
    const bw = w / THIRD_OCT.length;
    THIRD_OCT.forEach((c, k) => {
      const v = vals[k];
      const yy = yv(v);
      const diff = v - ref[k];
      const col = Math.abs(diff) < 4 ? [100, 180, 255] : diff > 0 ? [255, 120, 100] : [140, 150, 190];
      P.rect(X0 + k * bw + 1, yy, bw - 2, y + h - 14 - yy, col);
      P.rect(X0 + k * bw, yv(ref[k]), bw, 2, C.accent);
      if (k % 3 === 0) P.text(X0 + k * bw, y + h - 10, c >= 1000 ? `${c / 1000}k` : String(c), C.dim);
    });
    P.text(X0 + 4, y + 3, 'BARS: MIX / YELLOW: REFERENCE (BALANCED POP MIX)', C.dim);
    // 帯域のまとめ
    const bx = X0 + w + 20;
    P.text(bx, y, 'BANDS (dB)', C.text);
    BANDS.forEach((b, k) => P.text(bx, y + 14 + k * 12, `${b.id.padEnd(7)} ${String(a.bands[b.id]).padStart(6)}`, C.dim));
    P.text(bx, y + 100, 'WARNINGS', a.warnings.length ? C.warn : C.ok);
    P.text(bx, y + 112, a.warnings.length ? `${a.warnings.length} (see text report)` : 'none', C.dim);
    if (a.clicks?.length) P.text(bx, y + 124, `CLICKS: ${a.clicks.slice(0, 5).join(' ')}`, C.warn);
    y += h + 12;
  }

  // 6. トラック別
  if (a.stems) {
    label(P, 10, y, 'STEMS');
    P.text(X0, y, 'ID            LUFS   PEAK   ' + BANDS.map((b) => b.id.padEnd(7)).join(''), C.text);
    y += 16;
    const names = Object.keys(a.stems).filter((k) => !k.startsWith('_'));
    names.forEach((k, i) => {
      const s = a.stems[k];
      const c = TRACK_COLORS[i % TRACK_COLORS.length];
      P.rect(X0 - 12, y + 1, 8, 8, k.startsWith('send') ? C.dim : c);
      P.text(X0, y + 2, `${ascii(k).slice(0, 12).padEnd(12)} ${String(s.lufs).padStart(6)} ${String(s.peakDb).padStart(6)}   `, C.dim);
      BANDS.forEach((b, j) => {
        const v = s.bands[b.id];
        const u = Math.max(0, Math.min(1, (v + 70) / 60));
        P.rect(X0 + 186 + j * 42, y + 1, 40 * u, 9, [c[0], c[1], c[2], 0.75]);
      });
      y += 16;
    });
    y += 12;
  }
  return y;
}

function label(P, x, y, a, b) {
  P.text(x, y + 2, a, C.dim);
  if (b) P.text(x, y + 12, b, [255, 200, 61, 0.8]);
}

/** バランスのよいポップスの平均的な傾き（1/3 オクターブ。低域〜中低域が平ら、1kHz から上で下がる） */
function refCurve(vals) {
  const shape = THIRD_OCT.map((c) => {
    if (c < 40) return -6 - (40 - c) * 0.25;
    if (c < 250) return 0;
    if (c < 1000) return -(Math.log2(c / 250)) * 2.5;
    return -5 - Math.log2(c / 1000) * 3.8;
  });
  // 全体の高さを実際の音に合わせる（中域の平均で）
  const idx = THIRD_OCT.map((c, k) => (c >= 100 && c <= 4000 ? k : -1)).filter((k) => k >= 0);
  const off = idx.reduce((s, k) => s + (vals[k] - shape[k]), 0) / idx.length;
  return shape.map((v) => v + off);
}

const ascii = (s) => String(s).replace(/[^\x20-\x7e]/g, '?');
const asciiKey = (s) => s.replace('メジャー', 'major').replace('マイナー', 'minor');

/** 波形の表示用（列ごとの最小・最大・RMS） */
export function waveColumns(L, R, cols) {
  const n = L.length, min = new Float32Array(cols), max = new Float32Array(cols), rms = new Float32Array(cols);
  for (let x = 0; x < cols; x++) {
    const s = Math.floor((x / cols) * n), e = Math.max(s + 1, Math.floor(((x + 1) / cols) * n));
    let mn = 0, mx = 0, sq = 0;
    for (let i = s; i < e; i++) { const v = (L[i] + R[i]) * 0.5; if (v < mn) mn = v; if (v > mx) mx = v; sq += v * v; }
    min[x] = mn; max[x] = mx; rms[x] = Math.sqrt(sq / (e - s));
  }
  return { min, max, rms };
}

/* ---------------- 効果音のシート ---------------- */

/** 効果音用：時間軸を細かく（ms）、エンベロープの数値つき */
export function sfxStats(L, R, sr) {
  const n = L.length;
  // 1ms ごとのピーク
  const step = Math.max(1, Math.round(sr / 1000));
  const env = [];
  for (let i = 0; i < n; i += step) { let m = 0; for (let j = i; j < Math.min(n, i + step); j++) m = Math.max(m, Math.abs(L[j]), Math.abs(R[j])); env.push(m); }
  const pk = Math.max(...env);
  const pkAt = env.indexOf(pk);
  const fall = (dbv) => { const th = pk * Math.pow(10, dbv / 20); for (let k = env.length - 1; k >= 0; k--) if (env[k] >= th) return k; return 0; };
  let a10 = env.findIndex((v) => v >= pk * 0.1), a90 = env.findIndex((v) => v >= pk * 0.9);
  return { attackMs: Math.max(0, a90 - a10), peakAtMs: pkAt, to20dBms: fall(-20), to40dBms: fall(-40), to60dBms: fall(-60), lengthMs: env.length };
}
