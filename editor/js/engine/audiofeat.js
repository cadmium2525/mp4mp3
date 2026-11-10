/*
 * つなぐ：音の特徴（映像を音に連動させるためのデータ）。
 * ミックスした音声から、1/60 秒ごとの「全体の大きさ・帯域ごとの強さ・スペクトル」を前もって計算しておく。
 *   band('kick' | 'bass' | 'mid' | 'high' | 'level', t) → 0〜1
 *   spectrum(t) → 48 本の帯（0〜1、低い音 → 高い音）
 *   wave(t, n, span) → 時刻 t のまわり span 秒ぶんの波形（n 点、-1〜1）
 */

const FPS = 60, N = 1024, BANDS = 48;

function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { const a = re[i]; re[i] = re[j]; re[j] = a; const b = im[i]; im[i] = im[j]; im[j] = b; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2;
        const xr = re[b] * cr - im[b] * ci, xi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
}

export class AudioFeatures {
  /** L, R: Float32Array（R は省略可）、sr: サンプリング周波数 */
  constructor(L, R, sr) {
    const n = L.length;
    const mono = new Float32Array(n);
    for (let i = 0; i < n; i++) mono[i] = R ? (L[i] + R[i]) * 0.5 : L[i];
    this.mono = mono;
    this.sr = sr;
    this.frames = Math.max(1, Math.ceil((n / sr) * FPS));
    this.spec = new Float32Array(this.frames * BANDS);
    const env = { level: new Float32Array(this.frames), kick: new Float32Array(this.frames), bass: new Float32Array(this.frames), mid: new Float32Array(this.frames), high: new Float32Array(this.frames) };
    const re = new Float32Array(N), im = new Float32Array(N), win = new Float32Array(N);
    for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N);
    const binHz = sr / N;
    const edges = Array.from({ length: BANDS + 1 }, (_, k) => 35 * Math.pow(16000 / 35, k / BANDS));
    const range = { kick: [35, 120], bass: [120, 320], mid: [320, 3200], high: [3200, 14000] };
    for (let f = 0; f < this.frames; f++) {
      const c = Math.round((f / FPS) * sr), s = c - N / 2;
      let sq = 0;
      for (let i = 0; i < N; i++) { const v = mono[s + i] || 0; re[i] = v * win[i]; im[i] = 0; sq += v * v; }
      fft(re, im);
      env.level[f] = Math.sqrt(sq / N);
      const mag = (i) => Math.hypot(re[i], im[i]) / (N / 4);
      for (let b = 0; b < BANDS; b++) {
        const lo = Math.max(1, Math.floor(edges[b] / binHz)), hi = Math.max(lo + 1, Math.ceil(edges[b + 1] / binHz));
        let m = 0;
        for (let i = lo; i < hi && i < N / 2; i++) m = Math.max(m, mag(i));
        // dB にして 0〜1 へ（-66dB〜-6dB）。高い音ほど少し持ち上げて見やすく
        this.spec[f * BANDS + b] = Math.min(1, Math.max(0, (20 * Math.log10(m + 1e-7) + 66 + b * 0.25) / 60));
      }
      for (const [k, [a, z]] of Object.entries(range)) {
        let p = 0;
        for (let i = Math.max(1, Math.floor(a / binHz)); i < Math.ceil(z / binHz) && i < N / 2; i++) p += mag(i) ** 2;
        env[k][f] = Math.sqrt(p);
      }
    }
    // 0〜1 にそろえ、立ち上がりは速く・戻りはゆっくりにする
    this.env = {};
    for (const [k, a] of Object.entries(env)) {
      const sorted = Float32Array.from(a).sort();
      const ref = sorted[Math.floor(sorted.length * 0.97)] || 1e-6;
      const out = new Float32Array(this.frames);
      let v = 0;
      const rel = k === 'kick' ? 0.8 : 0.86;
      for (let f = 0; f < this.frames; f++) {
        const x = Math.min(1, a[f] / ref);
        const shaped = k === 'level' ? x : x * x; // 帯域は山をはっきりさせる
        v = shaped > v ? shaped : v * rel + shaped * (1 - rel);
        out[f] = v;
      }
      this.env[k] = out;
    }
    this.duration = n / sr;
  }
  band(name, t) {
    const a = this.env[name] || this.env.level;
    const x = t * FPS, i = Math.floor(x), f = x - i;
    if (i < 0 || i >= this.frames) return 0;
    const b = a[Math.min(this.frames - 1, i + 1)];
    return a[i] + (b - a[i]) * f;
  }
  spectrum(t, out = new Float32Array(BANDS)) {
    const i = Math.min(this.frames - 1, Math.max(0, Math.round(t * FPS)));
    for (let b = 0; b < BANDS; b++) out[b] = this.spec[i * BANDS + b];
    return out;
  }
  wave(t, n = 256, span = 0.04, out = new Float32Array(n)) {
    const s0 = (t - span / 2) * this.sr, step = (span * this.sr) / n;
    for (let i = 0; i < n; i++) out[i] = this.mono[Math.round(s0 + i * step)] || 0;
    return out;
  }
}
AudioFeatures.BANDS = BANDS;

/** このプロジェクトは音の特徴を必要とするか（音の可視化・音への反応があるか） */
export function needsAudio(project, GENS) {
  const react = (list) => (list || []).some((x) => x.react);
  if ((project.gens || []).some((g) => GENS?.[g.type]?.audio || g.react)) return true;
  return react(project.texts) || react(project.shapes) || react(project.overlays) || react(project.effects) || react(project.motions);
}
