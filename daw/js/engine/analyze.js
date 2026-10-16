/*
 * かなでる：音の解析（音を「見える化」する）。
 * 耳で聞けなくても、数値と図で音の状態を確かめられるようにする。
 *   ラウドネス（LUFS）・ピーク・トゥルーピーク・音割れ・直流
 *   周波数バランス（1/3 オクターブ）・スペクトログラム
 *   和音（小節ごと）・調・音の立ち上がり（オンセット）・テンポ
 *   ステレオの広がり・位相・クリックノイズの疑い
 *   トラックどうしの帯域のかぶり（マスキング）
 */
import { pcName, midiToName } from './dsp.js';

/* ---------------- FFT ---------------- */

const fftCache = new Map();
function fftTables(n) {
  if (fftCache.has(n)) return fftCache.get(n);
  const rev = new Uint32Array(n);
  const bits = Math.log2(n);
  for (let i = 0; i < n; i++) { let r = 0; for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b); rev[i] = r; }
  const cos = new Float64Array(n / 2), sin = new Float64Array(n / 2);
  for (let i = 0; i < n / 2; i++) { cos[i] = Math.cos((2 * Math.PI * i) / n); sin[i] = -Math.sin((2 * Math.PI * i) / n); }
  const win = new Float64Array(n);
  for (let i = 0; i < n; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
  const t = { rev, cos, sin, win };
  fftCache.set(n, t);
  return t;
}

/** 実数入力の FFT（ハン窓つき）→ 振幅スペクトル（n/2 本） */
export function magnitude(x, off, n, out) {
  const { rev, cos, sin, win } = fftTables(n);
  const re = new Float64Array(n), im = new Float64Array(n);
  for (let i = 0; i < n; i++) { const v = x[off + i] || 0; re[rev[i]] = v * win[i]; }
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1, step = n / size;
    for (let i = 0; i < n; i += size) {
      for (let j = 0; j < half; j++) {
        const k = j * step;
        const tr = re[i + j + half] * cos[k] - im[i + j + half] * sin[k];
        const ti = re[i + j + half] * sin[k] + im[i + j + half] * cos[k];
        re[i + j + half] = re[i + j] - tr; im[i + j + half] = im[i + j] - ti;
        re[i + j] += tr; im[i + j] += ti;
      }
    }
  }
  out = out || new Float32Array(n / 2);
  const norm = 4 / n; // ハン窓の補正込みで、振幅 1 の正弦波が約 1 になる
  for (let i = 0; i < n / 2; i++) out[i] = Math.sqrt(re[i] * re[i] + im[i] * im[i]) * norm;
  return out;
}

/* ---------------- ラウドネス ---------------- */

function kFilters(fs) {
  let f0 = 1681.974450955533, G = 3.999843853973347, Q = 0.7071752369554196;
  let K = Math.tan((Math.PI * f0) / fs);
  const Vh = Math.pow(10, G / 20), Vb = Math.pow(Vh, 0.4996667741545416);
  let a0 = 1 + K / Q + K * K;
  const s1 = [(Vh + (Vb * K) / Q + K * K) / a0, (2 * (K * K - Vh)) / a0, (Vh - (Vb * K) / Q + K * K) / a0, (2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0];
  f0 = 38.13547087602444; Q = 0.5003270373238773;
  K = Math.tan((Math.PI * f0) / fs);
  a0 = 1 + K / Q + K * K;
  const s2 = [1, -2, 1, (2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0];
  return [s1, s2];
}

/** 100ms ごとの K 特性パワー（左右の合計） */
function kPower(chs, fs) {
  const [s1, s2] = kFilters(fs);
  const n = chs[0].length, seg = Math.round(fs * 0.1), nSeg = Math.max(1, Math.ceil(n / seg));
  const pow = new Float64Array(nSeg);
  for (const x of chs) {
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0, z1 = 0, z2 = 0;
    for (let k = 0; k < nSeg; k++) {
      const end = Math.min(n, (k + 1) * seg);
      let acc = 0;
      for (let i = k * seg; i < end; i++) {
        const xi = x[i];
        const y = s1[0] * xi + s1[1] * x1 + s1[2] * x2 - s1[3] * y1 - s1[4] * y2;
        x2 = x1; x1 = xi;
        const z = s2[0] * y + s2[1] * y1 + s2[2] * y2 - s2[3] * z1 - s2[4] * z2;
        y2 = y1; y1 = y; z2 = z1; z1 = z;
        acc += z * z;
      }
      pow[k] += acc / seg;
    }
  }
  return pow;
}

const lk = (p) => (p > 0 ? -0.691 + 10 * Math.log10(p) : -Infinity);

/** 統合ラウドネス（ITU-R BS.1770-4 / EBU R128） */
export function loudness(L, R, fs) {
  const pow = kPower([L, R], fs);
  return integrate(pow);
}

function integrate(pow) {
  const blocks = [];
  if (pow.length < 4) blocks.push(pow.reduce((a, b) => a + b, 0) / Math.max(1, pow.length));
  else for (let k = 0; k + 3 < pow.length; k++) blocks.push((pow[k] + pow[k + 1] + pow[k + 2] + pow[k + 3]) / 4);
  const abs = blocks.filter((z) => lk(z) > -70);
  if (!abs.length) return -Infinity;
  const rel = lk(abs.reduce((a, b) => a + b, 0) / abs.length) - 10;
  const g = abs.filter((z) => lk(z) > rel);
  return g.length ? lk(g.reduce((a, b) => a + b, 0) / g.length) : -Infinity;
}

/** 短時間ラウドネス（3 秒窓）の推移と、ラウドネスレンジ（LRA） */
function shortTerm(pow) {
  const st = [];
  for (let k = 0; k < pow.length; k++) {
    let s = 0, c = 0;
    for (let j = Math.max(0, k - 29); j <= k; j++) { s += pow[j]; c++; }
    st.push(lk(s / c));
  }
  const valid = st.filter((v) => v > -70).sort((a, b) => a - b);
  let lra = 0;
  if (valid.length > 10) {
    const rel = lk(valid.map((v) => Math.pow(10, (v + 0.691) / 10)).reduce((a, b) => a + b, 0) / valid.length) - 20;
    const g = valid.filter((v) => v > rel);
    if (g.length > 10) lra = g[Math.floor(g.length * 0.95)] - g[Math.floor(g.length * 0.1)];
  }
  return { st, lra };
}

/**
 * スマホのスピーカーで鳴らしたときのラウドネスの減り（dB）。
 * 小さなスピーカーは 250Hz 付近から下がほとんど出ないので、24dB/oct のハイパスで近似する。
 * 減りが大きい音は「スマホだと小さく、迫力がない」。
 */
export function phoneLoss(L, R, fs) {
  const full = loudness(L, R, fs);
  const k = (sr) => {
    const w = Math.tan((Math.PI * 250) / sr);
    // 2 次ハイパス（バターワース）を 2 段
    const q = Math.SQRT1_2, norm = 1 / (1 + w / q + w * w);
    return { b0: norm, b1: -2 * norm, b2: norm, a1: 2 * (w * w - 1) * norm, a2: (1 - w / q + w * w) * norm };
  };
  const c = k(fs);
  const run = (x) => {
    const y = new Float32Array(x.length);
    let s = [0, 0, 0, 0, 0, 0, 0, 0];
    for (let i = 0; i < x.length; i++) {
      let v = x[i];
      for (let st = 0; st < 2; st++) {
        const o = st * 4;
        const out = c.b0 * v + c.b1 * s[o] + c.b2 * s[o + 1] - c.a1 * s[o + 2] - c.a2 * s[o + 3];
        s[o + 1] = s[o]; s[o] = v; s[o + 3] = s[o + 2]; s[o + 2] = out;
        v = out;
      }
      y[i] = v;
    }
    return y;
  };
  const ph = loudness(run(L), run(R), fs);
  return Number.isFinite(full) && Number.isFinite(ph) ? Math.round((full - ph) * 10) / 10 : null;
}

/** トゥルーピーク（4 倍オーバーサンプリングで推定） */
export function truePeak(L, R) {
  // 4 倍補間用の窓つき sinc（位相 1/4, 2/4, 3/4）
  const taps = 12;
  const kern = [1, 2, 3].map((ph) => {
    const k = [];
    for (let j = -taps / 2 + 1; j <= taps / 2; j++) {
      const x = j - ph / 4;
      const s = x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
      const w = 0.5 + 0.5 * Math.cos((Math.PI * x) / (taps / 2));
      k.push(s * w);
    }
    return k;
  });
  let pk = 0;
  for (const x of [L, R]) {
    for (let i = 0; i < x.length; i++) {
      const a = Math.abs(x[i]);
      if (a > pk) pk = a;
      // 0.5 を超える付近だけ細かく調べる（速さのため）
      if (a > 0.5 * pk && a > 0.3) {
        for (const k of kern) {
          let s = 0;
          for (let j = 0; j < taps; j++) s += (x[i + j - taps / 2 + 1] || 0) * k[j];
          if (Math.abs(s) > pk) pk = Math.abs(s);
        }
      }
    }
  }
  return pk;
}

const db = (v) => (v > 0 ? 20 * Math.log10(v) : -Infinity);
const r1 = (v) => (Number.isFinite(v) ? Math.round(v * 10) / 10 : v);

/* ---------------- 周波数 ---------------- */

export const THIRD_OCT = [25, 31.5, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 500, 630, 800, 1000, 1250, 1600, 2000, 2500, 3150, 4000, 5000, 6300, 8000, 10000, 12500, 16000, 20000];

export const BANDS = [
  { id: 'sub', label: '超低域', lo: 20, hi: 60 },
  { id: 'bass', label: '低域', lo: 60, hi: 250 },
  { id: 'lowmid', label: '中低域', lo: 250, hi: 500 },
  { id: 'mid', label: '中域', lo: 500, hi: 2000 },
  { id: 'himid', label: '中高域', lo: 2000, hi: 6000 },
  { id: 'air', label: '高域', lo: 6000, hi: 20000 },
];

/**
 * スペクトルの時間変化を計算する。
 * 戻り値：frames（各フレームの対数周波数ビン dB）、平均スペクトル、1/3 オクターブ、クロマ（音名ごとの強さ）
 */
function spectral(mono, sr, { n = 4096, hop = 2048, bins = 160, fmin = 30, fmax = 18000 } = {}) {
  const frames = [];
  const chroma = [];
  const bass = [];
  const flux = [];
  const third = new Float64Array(THIRD_OCT.length);
  const mag = new Float32Array(n / 2);
  let prev = null;
  const binHz = sr / n;
  // 対数周波数ビンの境界
  const edges = Array.from({ length: bins + 1 }, (_, k) => fmin * Math.pow(fmax / fmin, k / bins));
  const avg = new Float64Array(bins);
  let count = 0;
  for (let off = 0; off + n <= mono.length || (off === 0 && mono.length > 0); off += hop) {
    magnitude(mono, off, n, mag);
    // 対数ビンへ
    const fr = new Float32Array(bins);
    for (let b = 0; b < bins; b++) {
      const lo = Math.max(1, Math.floor(edges[b] / binHz)), hi = Math.max(lo + 1, Math.ceil(edges[b + 1] / binHz));
      let m = 0;
      for (let i = lo; i < hi && i < mag.length; i++) m = Math.max(m, mag[i]);
      fr[b] = m;
      avg[b] += m * m;
    }
    frames.push(fr);
    // 1/3 オクターブ（パワー）
    for (let k = 0; k < THIRD_OCT.length; k++) {
      const c = THIRD_OCT[k], lo = c / Math.pow(2, 1 / 6), hi = c * Math.pow(2, 1 / 6);
      let p = 0;
      for (let i = Math.max(1, Math.floor(lo / binHz)); i < Math.ceil(hi / binHz) && i < mag.length; i++) p += mag[i] * mag[i];
      third[k] += p;
    }
    // スペクトルフラックス（音の立ち上がり検出用）
    let fl = 0;
    if (prev) for (let b = 0; b < bins; b++) { const d = Math.log1p(fr[b] * 100) - Math.log1p(prev[b] * 100); if (d > 0) fl += d; }
    flux.push(fl);
    prev = fr;
    count++;
    if (off + n > mono.length) break;
  }
  // クロマ：低い音まで半音を区別できるよう、細かい FFT（16384 点 ≒ 2.9Hz 刻み）で別に計算する
  const cn = 16384, cmag = new Float32Array(cn / 2), cHz = sr / cn;
  const pcOf = new Int8Array(cn / 2).fill(-1), wOf = new Float32Array(cn / 2);
  for (let i = 1; i < cn / 2; i++) {
    const f = i * cHz;
    if (f < 32 || f > 4200) continue;
    const midi = 69 + 12 * Math.log2(f / 440);
    pcOf[i] = ((Math.round(midi) % 12) + 12) % 12;
    wOf[i] = Math.max(0, 1 - Math.abs(midi - Math.round(midi)) * 2.5);
  }
  for (let k = 0; k < frames.length; k++) {
    const ch = new Float32Array(12), bs = new Float32Array(12);
    const off = Math.round(k * hop + n / 2 - cn / 2);
    if (off >= 0 && off + cn <= mono.length) {
      magnitude(mono, off, cn, cmag);
      for (let i = 1; i < cn / 2; i++) {
        if (pcOf[i] < 0) continue;
        const f = i * cHz;
        const m = Math.sqrt(cmag[i]) * wOf[i]; // 平方根で、大きい音（ベース）が支配しすぎないように
        if (f >= 90) ch[pcOf[i]] += m;
        if (f < 260) bs[pcOf[i]] += m * m;
      }
    }
    chroma.push(ch);
    bass.push(bs);
  }
  for (let b = 0; b < bins; b++) avg[b] = db(Math.sqrt(avg[b] / Math.max(1, count)));
  const thirdDb = Array.from(third, (p) => r1(10 * Math.log10(p / Math.max(1, count) + 1e-20)));
  return { frames, edges, avg: Array.from(avg), thirdDb, chroma, bass, flux, hopSec: hop / sr, n };
}

/* ---------------- 和音・調 ---------------- */

const TEMPLATES = [
  ['', [0, 4, 7]], ['m', [0, 3, 7]], ['7', [0, 4, 7, 10]], ['M7', [0, 4, 7, 11]], ['m7', [0, 3, 7, 10]],
  ['sus4', [0, 5, 7]], ['sus2', [0, 2, 7]], ['dim', [0, 3, 6]], ['add9', [0, 2, 4, 7]], ['m9', [0, 2, 3, 7, 10]], ['M9', [0, 2, 4, 7, 11]], ['6', [0, 4, 7, 9]], ['5', [0, 7]],
];

/** クロマ（12 次元）から最も近い和音を推定 */
export function guessChord(ch, bassCh) {
  const norm = Math.hypot(...ch) || 1;
  const v = Array.from(ch, (x) => x / norm);
  let best = { name: '—', score: 0 };
  const bsum = bassCh ? bassCh.reduce((a, c) => a + c, 0) : 0;
  const bassShare = bsum > 0 ? Array.from(bassCh, (v) => v / bsum) : null;
  for (let root = 0; root < 12; root++) {
    for (const [q, iv] of TEMPLATES) {
      const t = new Array(12).fill(0);
      for (const i of iv) t[(root + i) % 12] = 1;
      t[root] = 1.3; // ルートを少し重視
      const tn = Math.hypot(...t);
      let s = 0;
      for (let k = 0; k < 12; k++) s += v[k] * (t[k] / tn);
      s -= Math.max(0, iv.length - 3) * 0.035; // 構成音が多い和音ほど当てはまりやすいので割り引く
      if (bassShare) s += 0.12 * bassShare[root]; // 低音がその音なら、それをルートとみなしやすく
      if (s > best.score) best = { name: pcName(root) + q, score: s, root };
    }
  }
  if (bassCh) {
    const mx = Math.max(...bassCh), sum = bassCh.reduce((a, c) => a + c, 0);
    const b = bassCh.indexOf(mx);
    // 低音がはっきりしていて（全体の 40% 以上）、ルートと違うときだけ分数コードにする
    if (mx > 0 && mx / sum > 0.4 && b !== best.root) best.name += '/' + pcName(b);
  }
  best.score = Math.round(best.score * 100) / 100;
  return best;
}

const MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

/** 調の推定（Krumhansl-Schmuckler） */
export function guessKey(ch) {
  const corr = (a, b) => {
    const ma = a.reduce((x, y) => x + y, 0) / 12, mb = b.reduce((x, y) => x + y, 0) / 12;
    let n = 0, da = 0, dbb = 0;
    for (let i = 0; i < 12; i++) { n += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; dbb += (b[i] - mb) ** 2; }
    return n / Math.sqrt(da * dbb || 1);
  };
  let best = { name: '?', score: -2 };
  for (let k = 0; k < 12; k++) {
    for (const [mode, prof] of [['major', MAJOR], ['minor', MINOR]]) {
      const rot = Array.from({ length: 12 }, (_, i) => prof[(i - k + 12) % 12]);
      const s = corr(Array.from(ch), rot);
      if (s > best.score) best = { name: `${pcName(k)} ${mode === 'major' ? 'メジャー' : 'マイナー'}`, score: Math.round(s * 100) / 100 };
    }
  }
  return best;
}

/* ---------------- 立ち上がり・テンポ ---------------- */

function onsets(flux, hopSec) {
  const out = [];
  const w = 6;
  for (let i = 1; i < flux.length - 1; i++) {
    let m = 0;
    for (let j = Math.max(0, i - w); j <= Math.min(flux.length - 1, i + w); j++) m += flux[j];
    m /= 2 * w + 1;
    if (flux[i] > flux[i - 1] && flux[i] >= flux[i + 1] && flux[i] > m * 1.5 + 0.5) out.push(Math.round(i * hopSec * 1000) / 1000);
  }
  return out;
}

function tempo(flux, hopSec) {
  // フラックスの自己相関から 60〜180 BPM の中で最も周期的なもの
  const n = flux.length;
  if (n < 50) return null;
  const mean = flux.reduce((a, b) => a + b, 0) / n;
  const x = flux.map((v) => v - mean);
  let best = null;
  for (let bpm = 60; bpm <= 180; bpm += 0.5) {
    const lag = 60 / bpm / hopSec;
    const l0 = Math.floor(lag), f = lag - l0;
    let s = 0;
    for (let i = 0; i + l0 + 1 < n; i++) s += x[i] * (x[i + l0] * (1 - f) + x[i + l0 + 1] * f);
    // 人がよく使うテンポ（110 前後）を少し優先して、倍・半分の取り違えを減らす
    const prior = Math.exp(-0.5 * Math.pow(Math.log2(bpm / 110) / 0.8, 2));
    if (!best || s * prior > best.s) best = { bpm, s: s * prior };
  }
  return best.bpm;
}

/* ---------------- クリック・ステレオ ---------------- */

/**
 * プチッというノイズ（波形の不連続）の疑いがある時刻。
 * 2階差分が、前後 5ms の平均より飛び抜けて大きい「孤立した」点を探す
 * （明るい音の立ち上がりは、その後も差分が大きいので除外される）。
 */
function clicks(x, sr) {
  const n = x.length;
  const d = new Float32Array(n);
  for (let i = 2; i < n; i++) d[i] = Math.abs(x[i] - 2 * x[i - 1] + x[i - 2]);
  const pre = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) pre[i + 1] = pre[i] + d[i];
  const w = Math.round(sr * 0.005), ex = 3;
  const out = [];
  for (let i = w; i < n - w; i++) {
    const v = d[i];
    if (v < 0.15) continue;
    const before = (pre[i - ex] - pre[i - w]) / (w - ex);
    const after = (pre[i + w] - pre[i + ex]) / (w - ex);
    if (v > 15 * Math.max(before, after, 1e-4) && isolated(d, i, w, ex, v)) {
      const t = Math.round((i / sr) * 1000) / 1000;
      if (!out.length || t - out[out.length - 1] > 0.05) out.push(t);
      if (out.length > 30) break;
    }
  }
  return out;
}

/** 前後の山の中で飛び抜けているか（矩形波の角のように周期的に並ぶ山は除く） */
function isolated(d, i, w, ex, v) {
  let m = 0;
  for (let j = i - w; j < i + w; j++) if ((j < i - ex || j > i + ex) && d[j] > m) m = d[j];
  return v > 4 * m;
}

/** 400ms 窓のラウドネス（モーメンタリー）の最大値 */
export function maxMomentary(L, R, fs) {
  const pow = kPower([L, R], fs);
  if (pow.length < 4) return lk(pow.reduce((a, b) => a + b, 0) / Math.max(1, pow.length) * (pow.length / 4));
  let m = -Infinity;
  for (let k = 0; k + 3 < pow.length; k++) m = Math.max(m, lk((pow[k] + pow[k + 1] + pow[k + 2] + pow[k + 3]) / 4));
  return m;
}

function stereoInfo(L, R) {
  let lr = 0, ll = 0, rr = 0, m = 0, s = 0;
  for (let i = 0; i < L.length; i += 2) {
    lr += L[i] * R[i]; ll += L[i] * L[i]; rr += R[i] * R[i];
    const mi = (L[i] + R[i]) / 2, si = (L[i] - R[i]) / 2;
    m += mi * mi; s += si * si;
  }
  return { correlation: Math.round((lr / Math.sqrt(ll * rr || 1)) * 100) / 100, width: Math.round((Math.sqrt(s / (m || 1)) || 0) * 100) / 100 };
}

/* ---------------- まとめ ---------------- */

/**
 * 音を解析する。
 * opts: { bpm, beatsPerBar, stems: {名前: [L,R]}, expectChords: [...], sections: [{at, name}] }
 */
export function analyzeAudio(L, R, sr, opts = {}) {
  const n = L.length;
  const mono = new Float32Array(n);
  for (let i = 0; i < n; i++) mono[i] = (L[i] + R[i]) * 0.5;
  const pow = kPower([L, R], sr);
  const lufs = integrate(pow);
  const { st, lra } = shortTerm(pow);
  let peak = 0, clip = 0, dcL = 0, dcR = 0, sq = 0;
  for (let i = 0; i < n; i++) {
    const a = Math.max(Math.abs(L[i]), Math.abs(R[i]));
    if (a > peak) peak = a;
    if (a >= 0.999) clip++;
    dcL += L[i]; dcR += R[i]; sq += mono[i] * mono[i];
  }
  const tp = truePeak(L, R);
  const rms = Math.sqrt(sq / Math.max(1, n));
  const spec = spectral(mono, sr);
  const st2 = stereoInfo(L, R);
  const on = onsets(spec.flux, spec.hopSec);
  const bpmEst = tempo(spec.flux, spec.hopSec);
  const clk = clicks(L, sr).concat(clicks(R, sr)).sort((a, b) => a - b).filter((t, i, a) => !i || t - a[i - 1] > 0.05);
  // 頭とお尻の無音
  const thr = 0.001;
  let s0 = 0; while (s0 < n && Math.abs(mono[s0]) < thr) s0++;
  let s1 = n - 1; while (s1 > 0 && Math.abs(mono[s1]) < thr) s1--;

  // 帯域ごとのエネルギー（平均スペクトルから）
  const bandDb = {};
  for (const b of BANDS) {
    let p = 0;
    THIRD_OCT.forEach((c, k) => { if (c >= b.lo && c < b.hi) p += Math.pow(10, spec.thirdDb[k] / 10); });
    bandDb[b.id] = r1(10 * Math.log10(p + 1e-20));
  }

  // 小節ごとの和音
  const bars = [];
  const total = new Float32Array(12);
  for (const c of spec.chroma) for (let k = 0; k < 12; k++) total[k] += c[k];
  if (opts.bpm) {
    const barSec = ((opts.beatsPerBar || 4) * 60) / opts.bpm;
    const per = opts.chordStep ? (opts.chordStep * 60) / opts.bpm : barSec;
    const nb = Math.ceil(n / sr / per);
    for (let b = 0; b < nb; b++) {
      const ch = new Float32Array(12), bs = new Float32Array(12);
      const f0 = Math.floor((b * per) / spec.hopSec), f1 = Math.floor(((b + 1) * per) / spec.hopSec);
      for (let f = f0; f < f1 && f < spec.chroma.length; f++) for (let k = 0; k < 12; k++) { ch[k] += spec.chroma[f][k]; bs[k] += spec.bass[f][k]; }
      const energy = ch.reduce((a, c) => a + c, 0);
      bars.push(energy > 1e-6 ? { ...guessChord(ch, bs), chroma: Array.from(ch, (v) => Math.round((v / Math.max(...ch)) * 100) / 100) } : { name: '（無音）', score: 0 });
    }
  }

  const res = {
    duration: r1(n / sr * 100) / 100,
    lufs: r1(lufs),
    phoneLoss: phoneLoss(L, R, sr),
    lra: r1(lra),
    peakDb: r1(db(peak)),
    truePeakDb: r1(db(tp)),
    rmsDb: r1(db(rms)),
    crest: r1(db(peak) - db(rms)),
    clipSamples: clip,
    dc: Math.round(((dcL + dcR) / 2 / Math.max(1, n)) * 10000) / 10000,
    stereo: st2,
    bands: bandDb,
    thirdOct: Object.fromEntries(THIRD_OCT.map((c, k) => [c, spec.thirdDb[k]])),
    key: guessKey(total),
    tempo: bpmEst,
    onsets: on.length,
    clicks: clk.slice(0, 20),
    leadSilence: r1((s0 / sr) * 1000) / 1000,
    tailSilence: r1(((n - 1 - s1) / sr) * 1000) / 1000,
    shortTerm: st.filter((_, i) => i % 5 === 0).map(r1), // 0.5 秒ごと
    chords: bars.map((b) => b.name),
    chordScores: bars.map((b) => b.score),
    _spec: spec,
    _st: st,
  };
  if (opts.stems) res.stems = stemReport(opts.stems, sr);
  res.warnings = warnings(res, opts);
  return res;
}

/** トラックごとの音量と帯域、かぶり */
function stemReport(stems, sr) {
  const out = {};
  for (const [name, [L, R]] of Object.entries(stems)) {
    const lufs = loudness(L, R, sr);
    const mono = new Float32Array(L.length);
    for (let i = 0; i < L.length; i++) mono[i] = (L[i] + R[i]) * 0.5;
    const sp = spectral(mono, sr, { n: 4096, hop: 8192 });
    const bands = {};
    for (const b of BANDS) {
      let p = 0;
      THIRD_OCT.forEach((c, k) => { if (c >= b.lo && c < b.hi) p += Math.pow(10, sp.thirdDb[k] / 10); });
      bands[b.id] = r1(10 * Math.log10(p + 1e-20));
    }
    let pk = 0;
    for (let i = 0; i < L.length; i++) pk = Math.max(pk, Math.abs(L[i]), Math.abs(R[i]));
    out[name] = { lufs: r1(lufs), peakDb: r1(db(pk)), bands, stereo: stereoInfo(L, R) };
  }
  // かぶり：同じ帯域で上位2つが 3dB 以内、かつ大きい
  const clashes = [];
  for (const b of BANDS) {
    const arr = Object.entries(out).map(([k, v]) => [k, v.bands[b.id]]).filter(([, v]) => v > -60).sort((a, c) => c[1] - a[1]);
    if (arr.length >= 2 && arr[0][1] - arr[1][1] < 3 && (b.id === 'bass' || b.id === 'lowmid' || b.id === 'sub')) clashes.push(`${b.label}（${b.lo}〜${b.hi}Hz）で「${arr[0][0]}」と「${arr[1][0]}」がぶつかっています`);
  }
  out._clashes = clashes;
  return out;
}

function warnings(r, opts) {
  const w = [];
  if (r.truePeakDb > -0.5) w.push(`トゥルーピークが ${r.truePeakDb} dBTP（配信では -1 dBTP 以下が安全）`);
  if (r.clipSamples > 0) w.push(`音割れ（0dBFS 到達）が ${r.clipSamples} サンプル`);
  if (Math.abs(r.dc) > 0.002) w.push(`直流成分が残っています（${r.dc}）`);
  if (r.stereo.correlation < 0) w.push(`左右の位相が逆相ぎみ（相関 ${r.stereo.correlation}）。モノラルで消える音があるかも`);
  if (r.clicks.length) w.push(`クリックノイズの疑い：${r.clicks.slice(0, 8).join('s, ')}s`);
  const t = opts.targetLufs;
  if (t != null && Math.abs(r.lufs - t) > 1.5) w.push(`ラウドネス ${r.lufs} LUFS（目標 ${t}）`);
  if (r.phoneLoss != null && r.phoneLoss > 10) w.push(`スマホのスピーカーでは ${r.phoneLoss} dB 小さく聞こえる計算（低音に頼りすぎ。250Hz〜2kHz に倍音や胴鳴りを足すと、小さなスピーカーでも迫力が出ます）`);
  const b = r.bands;
  if (b.sub - b.mid > 6) w.push('超低域が中域より 6dB 以上大きい（スマホでは聞こえず、音圧だけを食います）');
  if (b.lowmid - b.mid > 4) w.push('中低域（250〜500Hz）が多め。こもって聞こえる可能性');
  if (b.air - b.mid < -30) w.push('高域がかなり少ない。暗く、こもった印象になりがち');
  if (b.himid - b.mid > 3) w.push('中高域（2〜6kHz）が強め。耳に痛く聞こえる可能性');
  if (r.lra > 15) w.push(`音量差（LRA ${r.lra} LU）が大きい。スマホでは小さい部分が聞こえにくい`);
  for (const c of r.stems?._clashes || []) w.push(c);
  if (opts.expectChords && r.chords.length) {
    const miss = [];
    opts.expectChords.forEach((c, i) => {
      if (!c || !r.chords[i]) return;
      // 異名同音（Bb = A#）をそろえ、分数コードの低音が予定のルートなら一致とみなす
      const FL = { Db: 'C#', Eb: 'D#', Gb: 'F#', Ab: 'G#', Bb: 'A#', Cb: 'B', Fb: 'E', 'E#': 'F', 'B#': 'C' };
      const root = (x) => { const m = /^([A-G][#b]?)/.exec(x); return m ? FL[m[1]] || m[1] : x; };
      const bass = (x) => (x.includes('/') ? root(x.split('/')[1]) : null);
      const det = r.chords[i];
      if (root(c) !== root(det) && root(c) !== bass(det)) miss.push(`${i + 1}小節目：予定 ${c} → 検出 ${det}`);
    });
    if (miss.length) w.push(`和音の検出結果が予定と違う小節：${miss.slice(0, 6).join(' / ')}`);
  }
  return w;
}

/** 解析結果を人が読める文章にする（Claude が確かめる用） */
export function reportText(r, opts = {}) {
  const lines = [];
  lines.push(`長さ ${r.duration}s ／ ラウドネス ${r.lufs} LUFS（LRA ${r.lra}）／ ピーク ${r.peakDb} dBFS ／ トゥルーピーク ${r.truePeakDb} dBTP ／ クレスト ${r.crest} dB`);
  lines.push(`スマホのスピーカー想定：${r.phoneLoss} dB 小さくなる（目安 8 以下なら良好、12 以上は低音頼み）`);
  lines.push(`ステレオ：相関 ${r.stereo.correlation}、広がり ${r.stereo.width} ／ 直流 ${r.dc} ／ 頭の無音 ${r.leadSilence}s・末尾の無音 ${r.tailSilence}s`);
  lines.push(`帯域（dB）：${BANDS.map((b) => `${b.label} ${r.bands[b.id]}`).join('、')}`);
  lines.push(`推定：調 ${r.key.name}（${r.key.score}）／ テンポ ${r.tempo ?? '—'} BPM ／ 立ち上がり ${r.onsets} 個`);
  if (r.chords.length) {
    const per = opts.chordsPerLine || 8;
    lines.push('検出した和音（小節ごと）：');
    for (let i = 0; i < r.chords.length; i += per) lines.push(`  ${String(i + 1).padStart(3)}: ${r.chords.slice(i, i + per).map((c) => c.padEnd(7)).join(' ')}`);
  }
  if (r.stems) {
    lines.push('トラック別：');
    for (const [k, v] of Object.entries(r.stems)) {
      if (k.startsWith('_')) continue;
      lines.push(`  ${k.padEnd(12)} ${String(v.lufs).padStart(6)} LUFS  ピーク ${String(v.peakDb).padStart(6)}  低域 ${v.bands.bass}  中域 ${v.bands.mid}  高域 ${v.bands.air}  幅 ${v.stereo.width}`);
    }
  }
  lines.push(r.warnings.length ? '注意：\n' + r.warnings.map((w) => '  ・' + w).join('\n') : '注意：なし');
  return lines.join('\n');
}

export { midiToName };
