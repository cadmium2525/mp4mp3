/*
 * かなでる：効果音エンジン。
 * 安っぽい効果音は「1つの音だけ」「立ち上がりがぼやけている」「空間がない」「毎回同じ」になりがち。
 * ここでは本物の音響デザインと同じく、
 *   立ち上がり（トランジェント）＋ 胴鳴り（ボディ）＋ 余韻（テール）＋ 空間（リバーブ）
 * の層を重ね、ピッチ・フィルター・音量をカーブで動かし、シードで毎回わずかに変化させる。
 * ドラムの音もこのエンジンで作っている。
 */
import { Osc, Noise, SVF, Biquad, rng, curve, clamp, dbToGain, softClip, stereo, TAU, curveEnd } from './dsp.js';
import { applyChain, limit } from './fx.js';
import { maxMomentary } from './analyze.js';

/* ---------------- 層（レイヤー）の描画 ---------------- */

// TR-808 のシンバル・ハイハットに使われた 6 つの矩形波の周波数比
const METAL = [1, 1.4823, 1.8018, 2.5475, 2.6316, 3.8965];

/** 音量エンベロープ：カーブ、または { a, h, d, curve } の省略形 */
function ampFn(spec) {
  if (spec == null) return { f: () => 1, end: 1 };
  if (Array.isArray(spec)) return { f: curve(spec, 'lin'), end: curveEnd(spec) };
  if (typeof spec === 'number') return { f: () => spec, end: 1 };
  const a = Math.max(0.0005, spec.a ?? 0.002), h = spec.h ?? 0, d = Math.max(0.001, spec.d ?? 0.3);
  const shape = spec.curve ?? 'exp';
  const end = a + h + d;
  return {
    f: (t) => {
      if (t < a) return t / a;
      if (t < a + h) return 1;
      const u = (t - a - h) / d;
      if (u >= 1) return 0;
      if (shape === 'lin') return 1 - u;
      // 指数減衰（終点で -60dB）。最後の 10% で 0 へなめらかに落とす
      const e = Math.exp(-6.9 * u);
      return u > 0.9 ? e * (1 - (u - 0.9) / 0.1) : e;
    },
    end,
  };
}

const num = (v, def) => (v == null ? def : v);
const fn = (spec, def, shape = 'lin') => (spec == null ? () => def : typeof spec === 'number' ? () => spec : curve(spec, shape));

/** 1つの層を L/R に足す */
function renderLayer(ly, L, R, sr, seed) {
  const r = rng(seed);
  const amp = ampFn(ly.amp);
  const len = num(ly.len, amp.end);
  const start = Math.round(num(ly.at, 0) * sr);
  const n = Math.min(Math.round(len * sr), L.length - start);
  if (n <= 0) return;
  const semi = Math.pow(2, num(ly.semi, 0) / 12);
  const freq = fn(ly.freq, 440, 'exp');
  const src = ly.src || 'sine';
  const gain = dbToGain(num(ly.gain, 0));
  const pan = fn(ly.pan, 0);
  const width = clamp(num(ly.width, 0), 0, 1);
  const wob = ly.wobble; // { rate, depth(半音), decay }
  const vib = ly.vibrato;
  const fmIdx = ly.fm ? fn(ly.fm.index, 1) : null;
  const fmRatio = ly.fm ? num(ly.fm.ratio, 1) : 1;
  const drive = ly.drive ? dbToGain(ly.drive) : 0;

  // 音源
  const nUni = Math.max(1, num(ly.voices, 1));
  const det = num(ly.detune, 15);
  const wave = src === 'supersaw' ? 'saw' : src;
  const nOsc = src === 'supersaw' ? Math.max(5, nUni) : nUni;
  const oscs = ['sine', 'tri', 'saw', 'square', 'pulse', 'supersaw'].includes(src)
    ? Array.from({ length: nOsc }, (_, k) => ({
      o: new Osc(wave, nOsc > 1 ? r() : 0),
      ratio: nOsc === 1 ? 1 : Math.pow(2, ((k / (nOsc - 1) - 0.5) * 2 * det) / 1200),
      p: nOsc === 1 ? 0 : (k / (nOsc - 1)) * 2 - 1,
    }))
    : null;
  const metal = src === 'metal' ? METAL.map(() => new Osc('square', r())) : null;
  const noises = /noise|pink|brown|crackle/.test(src) ? [new Noise(src === 'noise' || src === 'crackle' ? 'white' : src, seed + 1), new Noise(src === 'noise' || src === 'crackle' ? 'white' : src, seed + 2)] : null;
  const modes = src === 'modal' ? (ly.modes || [[1, 1, 1], [2.76, 0.5, 0.5], [5.4, 0.3, 0.3], [8.93, 0.2, 0.2]]) : null;
  const modal = modes ? modes.map(([ratio, dec, g]) => ({ ratio, dec: Math.exp(-1 / (Math.max(0.005, dec) * sr)), g, e: 1, ph: r() * 0 })) : null;
  let fmPh = 0, ph = 0, grain = 0, gpan = 0;
  const gdec = Math.exp(-1 / (num(ly.grain, 0.0015) * sr));
  const density = num(ly.density, 40);

  // フィルター（filter と filter2、hp/lp の省略形）
  const filters = [];
  const addF = (spec) => {
    if (!spec) return;
    const f = fn(spec.freq, 1000, 'exp'), q = fn(spec.q, 0.707);
    const poles = spec.poles === 4 ? 2 : 1;
    filters.push({ f, q, ch: [0, 1].map(() => Array.from({ length: poles }, () => new SVF(sr, spec.type || 'lp'))) });
  };
  addF(ly.filter);
  addF(ly.filter2);
  if (ly.hp) addF({ type: 'hp', freq: ly.hp, q: 0.707 });
  if (ly.lp) addF({ type: 'lp', freq: ly.lp, q: 0.707 });

  let fHz = 440, pl = 1, pr = 1;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    if (i % 16 === 0) {
      fHz = freq(t) * semi;
      if (wob) fHz *= Math.pow(2, (wob.depth * Math.sin(TAU * wob.rate * t) * Math.exp(-t / (wob.decay || 0.3))) / 12);
      if (vib) fHz *= Math.pow(2, (vib.depth * Math.sin(TAU * vib.rate * t)) / 12);
      for (const F of filters) { const fq = F.f(t), qq = F.q(t); for (const ch of F.ch) for (const s of ch) s.set(fq, qq); }
      const p = clamp(pan(t), -1, 1), a = ((p + 1) * Math.PI) / 4;
      pl = Math.cos(a) * Math.SQRT2; pr = Math.sin(a) * Math.SQRT2;
    }
    const dt = fHz / sr;
    let l = 0, rr = 0;
    if (oscs) {
      for (const o of oscs) {
        let y;
        if (fmIdx) {
          fmPh += (dt * fmRatio) / oscs.length;
          y = Math.sin(TAU * o.o.p + fmIdx(t) * Math.sin(TAU * fmPh));
          o.o.p = (o.o.p + dt * o.ratio) % 1;
        } else y = o.o.next(dt * o.ratio);
        const w = o.p * width;
        l += y * (1 - w); rr += y * (1 + w);
      }
      l /= Math.sqrt(oscs.length); rr /= Math.sqrt(oscs.length);
    } else if (metal) {
      for (let k = 0; k < 6; k++) { const y = metal[k].next(dt * METAL[k]); l += y; }
      l /= 3; rr = l;
    } else if (noises) {
      const a = noises[0].next(), b = noises[1].next();
      if (src === 'crackle') {
        // ランダムな粒（数 ms で減衰するノイズの粒。1サンプルの「プチッ」より自然）
        if (r() < density / sr) { grain = 0.3 + r() * 0.7; gpan = (r() - 0.5) * width * 2; }
        grain *= gdec;
        l = a * grain * (1 - gpan); rr = a * grain * (1 + gpan);
      } else { l = a; rr = a * (1 - width) + b * width; }
    } else if (modal) {
      ph += dt;
      for (const m of modal) { l += Math.sin(TAU * ph * m.ratio) * m.g * m.e; m.e *= m.dec; }
      rr = l;
    } else if (src === 'click') {
      l = rr = i < 3 ? 1 - i / 3 : 0;
    }
    if (drive) { l = softClip(l * drive) ; rr = softClip(rr * drive); }
    for (const F of filters) { for (const s of F.ch[0]) l = s.next(l); for (const s of F.ch[1]) rr = s.next(rr); }
    const g = amp.f(t) * gain;
    L[start + i] += l * g * pl;
    R[start + i] += rr * g * pr;
  }
}

/* ---------------- 効果音の描画 ---------------- */

/** 効果音の長さ（秒）：一番遅く終わる層 + 余韻 */
export function sfxLength(def) {
  if (def.length) return def.length;
  let end = 0;
  for (const ly of def.layers || []) end = Math.max(end, num(ly.at, 0) + num(ly.len, ampFn(ly.amp).end));
  const hasVerb = (def.fx || []).some((f) => f.type === 'reverb' || f.type === 'delay');
  const verb = (def.fx || []).filter((f) => f.type === 'reverb').reduce((m, f) => Math.max(m, num(f.decay, 2)), 0);
  return end + (hasVerb ? Math.max(0.3, verb * 0.9) : 0.02);
}

/**
 * 効果音を描画する。def = { layers:[...], fx:[...], normalize:-1 | null, seed, length? }
 * 戻り値 [L, R]（Float32Array）
 */
export function renderSfx(def, sr = 48000) {
  const len = sfxLength(def);
  const n = Math.max(1, Math.round(len * sr));
  const [L, R] = stereo(n);
  const seed = def.seed ?? 1;
  (def.layers || []).forEach((ly, k) => { if (!ly.off) renderLayer(ly, L, R, sr, seed * 131 + k * 17 + 1); });
  applyChain(def.fx, L, R, { sr, bpm: 120, timeAt: (i) => i / sr });
  // 末尾を数 ms でフェード（プツッと切れないように）
  const fo = Math.min(n, Math.round(sr * (def.fadeOut ?? 0.01)));
  for (let i = 0; i < fo; i++) { const g = i / fo; L[n - 1 - i] *= g; R[n - 1 - i] *= g; }
  if (def.normalize !== null) {
    let pk = 0;
    for (let i = 0; i < n; i++) pk = Math.max(pk, Math.abs(L[i]), Math.abs(R[i]));
    const target = dbToGain(def.normalize ?? -1);
    if (pk > 0) { const g = target / pk; for (let i = 0; i < n; i++) { L[i] *= g; R[i] *= g; } }
    limit(L, R, sr, (def.normalize ?? -1), 0.05, 0.002);
    // 長く続く音が大きくなりすぎないよう、瞬間的なラウドネスの最大を抑える
    const cap = def.loudCap ?? -10;
    const m = maxMomentary(L, R, sr);
    if (Number.isFinite(m) && m > cap) { const g = dbToGain(cap - m); for (let i = 0; i < n; i++) { L[i] *= g; R[i] *= g; } }
  }
  if (def.volume != null) { const g = dbToGain(def.volume); for (let i = 0; i < n; i++) { L[i] *= g; R[i] *= g; } }
  return [L, R];
}

/* ---------------- プリセット ---------------- */

/*
 * どのプリセットも同じつまみで調整できる：
 *   pitch（半音）length（倍率）tone（-1 暗い 〜 1 明るい）space（0〜1 響き）punch（0〜1 迫力）seed（ばらつき）
 */
const verb = (space, size = 1, decay = 1.6, extra = {}) => (space > 0.01 ? [{ type: 'reverb', size, decay: decay * (0.6 + space), mix: Math.min(0.6, space * 0.45), predelay: 0.012, ...extra }] : []);
const P = (o) => Math.pow(2, (o.pitch || 0) / 12);
const B = (o, f) => f * Math.pow(2, (o.tone || 0) * 1.2); // 明るさで周波数をずらす
const jit = (r, amt) => 1 + (r() - 0.5) * 2 * amt;

export const SFX_CATEGORIES = [
  { id: 'ui', label: 'UI・操作' },
  { id: 'trans', label: 'トランジション' },
  { id: 'hit', label: '衝撃・アクセント' },
  { id: 'fun', label: 'バラエティ・ゲーム' },
  { id: 'real', label: '生活音・環境' },
  { id: 'drum', label: 'ドラム' },
];

export const SFX_PRESETS = {
  /* ---------- UI ---------- */
  click: { cat: 'ui', label: 'クリック', make: (o, r) => ({
    layers: [
      { src: 'sine', freq: [[0, 2400 * P(o) * jit(r, 0.03)], [0.012, 1300 * P(o), 'exp']], amp: { a: 0.0005, d: 0.03 * (o.length || 1) }, gain: -2 },
      { src: 'noise', filter: { type: 'bp', freq: B(o, 5000), q: 1.2 }, amp: { a: 0.0003, d: 0.006 }, gain: -8 },
    ],
    fx: verb(o.space ?? 0.12, 0.4, 0.5),
  }) },
  tap: { cat: 'ui', label: 'タップ（やわらか）', make: (o, r) => ({
    layers: [
      { src: 'sine', freq: [[0, 900 * P(o) * jit(r, 0.04)], [0.03, 520 * P(o), 'exp']], amp: { a: 0.001, d: 0.07 * (o.length || 1) } },
      { src: 'tri', freq: 1800 * P(o), amp: { a: 0.0005, d: 0.012 }, gain: -14 },
      { src: 'pink', lp: B(o, 2500), amp: { a: 0.0005, d: 0.015 }, gain: -12 },
    ],
    fx: verb(o.space ?? 0.15, 0.4, 0.5),
  }) },
  pop: { cat: 'ui', label: 'ポップ（ぽんっ）', make: (o, r) => ({
    layers: [
      { src: 'sine', freq: [[0, 260 * P(o)], [0.04 * (o.length || 1), 820 * P(o) * jit(r, 0.05), 'exp']], amp: { a: 0.001, h: 0.01, d: 0.07 * (o.length || 1) } },
      { src: 'sine', freq: [[0, 520 * P(o)], [0.04 * (o.length || 1), 1640 * P(o), 'exp']], amp: { a: 0.001, d: 0.04 }, gain: -16 },
      { src: 'noise', filter: { type: 'bp', freq: B(o, 2500), q: 1 }, amp: { a: 0.0005, d: 0.008 }, gain: -14 },
    ],
    fx: [{ type: 'transient', attack: 3 * (o.punch ?? 0.5) }, ...verb(o.space ?? 0.2, 0.5, 0.6)],
  }) },
  bubble: { cat: 'ui', label: 'あわ', make: (o, r) => ({
    layers: [0, 1, 2].map((k) => ({
      at: k * 0.07 * jit(r, 0.3), src: 'sine', freq: [[0, 500 * P(o) * jit(r, 0.2) * (1 + k * 0.2)], [0.03, 1500 * P(o) * jit(r, 0.2) * (1 + k * 0.2), 'exp']],
      amp: { a: 0.002, d: 0.045 }, gain: -k * 4, pan: (r() - 0.5) * 0.6,
    })),
    fx: verb(o.space ?? 0.25, 0.5, 0.7),
  }) },
  toggle: { cat: 'ui', label: 'スイッチ', make: (o, r) => ({
    layers: [0, 0.055].map((at, k) => ({ at, src: 'sine', freq: [[0, (k ? 1700 : 1300) * P(o)], [0.01, (k ? 1100 : 800) * P(o), 'exp']], amp: { a: 0.0004, d: 0.025 }, gain: k ? -3 : 0 }))
      .concat([{ src: 'noise', filter: { type: 'bp', freq: B(o, 4000), q: 2 }, amp: { a: 0.0003, d: 0.005 }, gain: -10 }]),
    fx: verb(o.space ?? 0.1, 0.4, 0.4),
  }) },
  chime: { cat: 'ui', label: '通知チャイム', make: (o) => ({
    layers: [[0, 1318.5], [0.11, 1975.5]].map(([at, f], k) => ({
      at, src: 'modal', freq: f * P(o), modes: [[1, 1.2 * (o.length || 1), 1], [2.756, 0.45, 0.25 * (1 + (o.tone || 0))], [5.404, 0.18, 0.12], [8.933, 0.08, 0.06]],
      amp: { a: 0.002, h: 1.2 * (o.length || 1), d: 0.2 }, gain: k ? -2 : 0, pan: k ? 0.15 : -0.15,
    })),
    fx: [{ type: 'delay', time: 0.16, feedback: 0.25, mix: 0.12, pingpong: true }, ...verb(o.space ?? 0.35, 1, 1.6)],
  }) },
  success: { cat: 'ui', label: '成功・正解', make: (o) => ({
    layers: [523.25, 659.25, 783.99, 1046.5].flatMap((f, k) => [
      { at: k * 0.075, src: 'modal', freq: f * P(o), modes: [[1, 0.9, 1], [2, 0.4, 0.3 * (1 + (o.tone || 0))], [3, 0.25, 0.12], [4.2, 0.12, 0.05]], amp: { a: 0.002, h: 0.5, d: 0.5 * (o.length || 1) }, gain: -k * 0.5, pan: -0.3 + k * 0.2 },
      { at: k * 0.075, src: 'tri', freq: f * 2 * P(o), amp: { a: 0.001, d: 0.06 }, gain: -18 },
    ]),
    fx: [{ type: 'chorus', mix: 0.25 }, { type: 'delay', time: 0.15, feedback: 0.2, mix: 0.1, pingpong: true }, ...verb(o.space ?? 0.4, 1.2, 1.8)],
  }) },
  error: { cat: 'ui', label: 'エラー・不正解', make: (o) => ({
    layers: [[0, 233.08], [0.17, 185]].map(([at, f]) => ({
      at, src: 'saw', voices: 3, detune: 12, freq: f * P(o), filter: { type: 'lp', freq: [[0, B(o, 2400)], [0.2, B(o, 900), 'exp']], q: 1.2 },
      amp: { a: 0.004, h: 0.08, d: 0.14 * (o.length || 1) }, drive: 4,
    })),
    fx: verb(o.space ?? 0.15, 0.6, 0.6),
  }) },
  coin: { cat: 'ui', label: 'コイン', make: (o) => ({
    layers: [
      { src: 'square', freq: 987.77 * P(o), amp: [[0, 0], [0.002, 1], [0.07, 1], [0.072, 0]], lp: B(o, 9000), gain: -4 },
      { at: 0.07, src: 'square', freq: 1318.5 * P(o), amp: { a: 0.001, h: 0.05, d: 0.45 * (o.length || 1) }, lp: B(o, 9000), gain: -4 },
    ],
    fx: verb(o.space ?? 0.2, 0.6, 0.8),
  }) },
  blip: { cat: 'ui', label: 'ピッ（選択）', make: (o) => ({
    layers: [{ src: 'square', freq: [[0, 880 * P(o)], [0.03, 1320 * P(o), 'exp']], amp: [[0, 0], [0.002, 1], [0.05 * (o.length || 1), 0.8], [0.06 * (o.length || 1), 0]], lp: B(o, 7000), gain: -4 }],
    fx: verb(o.space ?? 0.1, 0.4, 0.4),
  }) },
  type: { cat: 'ui', label: 'タイピング', make: (o, r) => ({
    layers: [
      { src: 'noise', filter: { type: 'bp', freq: B(o, 3200) * jit(r, 0.15), q: 1.5 }, amp: { a: 0.0003, d: 0.012 }, gain: -2 },
      { src: 'sine', freq: [[0, 420 * P(o) * jit(r, 0.1)], [0.02, 260 * P(o), 'exp']], amp: { a: 0.0005, d: 0.035 }, gain: -6 },
      { at: 0.045 * jit(r, 0.2), src: 'noise', filter: { type: 'bp', freq: B(o, 2200), q: 2 }, amp: { a: 0.0003, d: 0.008 }, gain: -12 },
    ],
    fx: verb(o.space ?? 0.08, 0.3, 0.3),
  }) },
  pon: { cat: 'ui', label: 'ポン（テロップ）', make: (o) => ({
    layers: [
      { src: 'sine', freq: 1046.5 * P(o), amp: { a: 0.002, h: 0.02, d: 0.35 * (o.length || 1) } },
      { src: 'sine', freq: 2093 * P(o), amp: { a: 0.001, d: 0.12 }, gain: -10 + 4 * (o.tone || 0) },
      { src: 'sine', freq: 3139.5 * P(o), amp: { a: 0.001, d: 0.05 }, gain: -18 + 4 * (o.tone || 0) },
    ],
    fx: verb(o.space ?? 0.2, 0.6, 0.8),
  }) },

  /* ---------- トランジション ---------- */
  whoosh: { cat: 'trans', label: 'シュッ（ウーシュ）', make: (o, r) => {
    const L = 0.65 * (o.length || 1), pk = L * (0.55 + (r() - 0.5) * 0.1);
    return {
      layers: [
        { src: 'pink', len: L, width: 0.7, filter: { type: 'bp', freq: [[0, B(o, 350) * P(o)], [pk, B(o, 2200) * P(o), 'smooth'], [L, B(o, 600) * P(o), 'smooth']], q: 1.4 }, amp: [[0, 0], [pk, 1, 'in'], [L, 0, 'out']], pan: [[0, -0.5], [L, 0.5]] },
        { src: 'noise', len: L, width: 0.9, filter: { type: 'hp', freq: B(o, 5000) }, amp: [[0, 0], [pk, 0.35, 'in'], [L, 0, 'out']], pan: [[0, -0.7], [L, 0.7]], gain: -6 },
        { src: 'brown', len: L, lp: 260, amp: [[0, 0], [pk, 0.8, 'in'], [L, 0, 'out']], gain: -2 + 6 * (o.punch ?? 0.3) },
      ],
      fx: verb(o.space ?? 0.3, 1.2, 1.4),
    };
  } },
  swipe: { cat: 'trans', label: 'スワイプ（短い）', make: (o) => {
    const L = 0.18 * (o.length || 1);
    return {
      layers: [
        { src: 'noise', len: L, width: 0.6, filter: { type: 'bp', freq: [[0, B(o, 1400) * P(o)], [L, B(o, 6500) * P(o), 'exp']], q: 1.8 }, amp: [[0, 0], [L * 0.7, 1, 'in'], [L, 0]], pan: [[0, -0.6], [L, 0.6]] },
        { src: 'noise', len: L, hp: 7000, amp: [[0, 0], [L * 0.7, 0.4, 'in'], [L, 0]], gain: -8 },
      ],
      fx: verb(o.space ?? 0.15, 0.6, 0.6),
    };
  } },
  riser: { cat: 'trans', label: 'ライザー（盛り上げ）', make: (o) => {
    const L = 2.5 * (o.length || 1);
    return {
      layers: [
        { src: 'supersaw', voices: 7, detune: 25, width: 1, len: L, freq: [[0, 110 * P(o)], [L, 880 * P(o), 'in']], filter: { type: 'lp', freq: [[0, 400], [L, B(o, 9000), 'in']], q: 2 }, amp: [[0, 0], [L * 0.9, 0.8, 'in'], [L, 0]], gain: -6 },
        { src: 'noise', len: L, width: 1, filter: { type: 'hp', freq: [[0, 800], [L, B(o, 6000), 'exp']] }, filter2: { type: 'lp', freq: [[0, 2000], [L, 16000, 'exp']] }, amp: [[0, 0], [L * 0.95, 1, 'in'], [L, 0]], gain: -4 },
        { src: 'sine', len: L, freq: [[0, 55 * P(o)], [L, 110 * P(o), 'exp']], amp: [[0, 0], [L * 0.9, 0.5, 'in'], [L, 0]], gain: -6 + 6 * (o.punch ?? 0.3) },
      ],
      fx: [{ type: 'tremolo', rate: 6, depth: 0.12 }, ...verb(o.space ?? 0.35, 1.5, 2.2)],
    };
  } },
  downer: { cat: 'trans', label: 'ダウナー（下降）', make: (o) => {
    const L = 1.6 * (o.length || 1);
    return {
      layers: [
        { src: 'supersaw', voices: 5, detune: 20, width: 1, len: L, freq: [[0, 660 * P(o)], [L, 80 * P(o), 'out']], filter: { type: 'lp', freq: [[0, B(o, 8000)], [L, 300, 'exp']], q: 1.5 }, amp: [[0, 0], [0.02, 0.8], [L, 0, 'out']], gain: -6 },
        { src: 'noise', len: L, width: 1, filter: { type: 'bp', freq: [[0, B(o, 6000)], [L, 300, 'exp']], q: 1 }, amp: [[0, 0], [0.02, 1], [L, 0, 'out']], gain: -4 },
        { src: 'sine', len: L, freq: [[0, 120 * P(o)], [L, 35 * P(o), 'exp']], amp: [[0, 0], [0.02, 1], [L, 0, 'out']], gain: -4 + 6 * (o.punch ?? 0.4), drive: 4 },
      ],
      fx: verb(o.space ?? 0.4, 1.6, 2.4),
    };
  } },
  revcymbal: { cat: 'trans', label: '逆再生シンバル', make: (o) => {
    const L = 1.5 * (o.length || 1);
    return {
      layers: [
        { src: 'metal', freq: 520 * P(o), len: L, filter: { type: 'hp', freq: B(o, 5000) }, amp: [[0, 0], [L, 1, 'in']], gain: -6 },
        { src: 'noise', len: L, width: 1, filter: { type: 'hp', freq: [[0, 7000], [L, B(o, 2500), 'exp']] }, amp: [[0, 0], [L, 1, 'in']] },
      ],
      fx: verb(o.space ?? 0.2, 1.2, 1.2), fadeOut: 0.004, length: L + 0.01,
    };
  } },
  glitch: { cat: 'trans', label: 'グリッチ', make: (o, r) => {
    const layers = [];
    let t = 0;
    const L = 0.45 * (o.length || 1);
    while (t < L) {
      const d = 0.012 + r() * 0.05;
      const k = r();
      layers.push(k < 0.4
        ? { at: t, src: 'square', freq: (200 + r() * 3000) * P(o), amp: [[0, 0], [0.001, 1], [d, 1], [d + 0.001, 0]], gain: -6 - r() * 6, pan: (r() - 0.5) * 1.6 }
        : k < 0.75
          ? { at: t, src: 'noise', filter: { type: 'bp', freq: 400 + r() * 8000, q: 3 }, amp: [[0, 0], [0.001, 1], [d, 1], [d + 0.001, 0]], gain: -2, pan: (r() - 0.5) * 1.6 }
          : { at: t, src: 'saw', freq: [[0, (100 + r() * 1500) * P(o)], [d, (50 + r() * 400) * P(o), 'exp']], amp: [[0, 0], [0.001, 1], [d, 0.6], [d + 0.001, 0]], gain: -6, pan: (r() - 0.5) * 1.6 });
      t += d + (r() < 0.3 ? r() * 0.03 : 0);
    }
    return { layers, fx: [{ type: 'crush', bits: 6 + Math.round((o.tone || 0) * 3 + 2), rate: 3, mix: 0.6 }, ...verb(o.space ?? 0.1, 0.5, 0.5)] };
  } },
  transition: { cat: 'trans', label: 'トランジションヒット', make: (o, r) => {
    const w = SFX_PRESETS.whoosh.make({ ...o, length: 0.9 * (o.length || 1), space: 0 }, r);
    const L = 0.6 * (o.length || 1);
    return {
      layers: [
        ...w.layers.map((l) => ({ ...l, amp: [[0, 0], [L * 0.98, 1, 'in'], [L, 0]], len: L, gain: (l.gain || 0) - 3 })),
        ...SFX_PRESETS.impact.make({ ...o, length: 0.6 * (o.length || 1), space: 0 }, r).layers.map((l) => ({ ...l, at: L + (l.at || 0) })),
      ],
      fx: verb(o.space ?? 0.35, 1.5, 2),
    };
  } },

  /* ---------- 衝撃 ---------- */
  impact: { cat: 'hit', label: 'インパクト（映画的）', make: (o, r) => {
    const L = o.length || 1, pu = o.punch ?? 0.6;
    return {
      layers: [
        { src: 'sine', freq: [[0, 70 * P(o)], [0.4 * L, 38 * P(o), 'exp'], [1.6 * L, 32 * P(o), 'exp']], amp: { a: 0.002, h: 0.05, d: 1.8 * L }, drive: 6, gain: -1 + 3 * pu },
        { src: 'sine', freq: [[0, 180 * P(o)], [0.05, 60 * P(o), 'exp']], amp: { a: 0.0008, h: 0.01, d: 0.25 }, drive: 9, gain: -2 },
        { src: 'noise', width: 0.8, filter: { type: 'hp', freq: B(o, 1400) }, filter2: { type: 'lp', freq: [[0, B(o, 12000)], [0.2, 2500, 'exp']] }, amp: { a: 0.0005, d: 0.18 * L }, drive: 6, gain: 0 },
        // スマホのスピーカーでも「ドン」と聞こえるよう、中域の胴鳴り
        { src: 'tri', freq: [[0, 320 * P(o)], [0.12, 140 * P(o), 'exp']], amp: { a: 0.0008, h: 0.01, d: 0.35 * L }, drive: 12, gain: -6, lp: 2500 },
        { src: 'pink', width: 0.5, filter: { type: 'bp', freq: [[0, 900], [0.3, 300, 'exp']], q: 0.8 }, amp: { a: 0.001, d: 0.5 * L }, drive: 4, gain: -4 },
        { src: 'metal', freq: 140 * P(o) * jit(r, 0.05), filter: { type: 'bp', freq: B(o, 1800), q: 0.8 }, amp: { a: 0.001, d: 0.9 * L }, gain: -16 + 6 * (o.tone || 0) },
        { src: 'brown', width: 1, lp: 700, amp: { a: 0.003, d: 2.2 * L }, gain: -8 },
      ],
      fx: [{ type: 'transient', attack: 4 * pu, sustain: 0 }, ...verb(o.space ?? 0.4, 1.8, 3)],
    };
  } },
  boom: { cat: 'hit', label: 'ブーム（重低音）', make: (o) => {
    const L = o.length || 1;
    return {
      layers: [
        { src: 'sine', freq: [[0, 90 * P(o)], [1.5 * L, 28 * P(o), 'exp']], amp: { a: 0.003, h: 0.1, d: 2.2 * L }, drive: 8 * (o.punch ?? 0.5) + 2 },
        { src: 'tri', freq: [[0, 180 * P(o)], [1.5 * L, 56 * P(o), 'exp']], amp: { a: 0.002, d: 0.6 * L }, gain: -8 + 6 * (o.tone || 0), drive: 10 },
        // 倍音（小さなスピーカーでも低音を感じられるように）
        { src: 'sine', freq: [[0, 270 * P(o)], [1.5 * L, 84 * P(o), 'exp']], amp: { a: 0.002, d: 0.9 * L }, drive: 14, gain: -6, lp: 1800 },
        { src: 'brown', lp: 400, amp: { a: 0.002, d: 1.2 * L }, gain: -10 },
      ],
      fx: [{ type: 'eq', bands: [{ type: 'hp', freq: 22 }, { type: 'lp', freq: B(o, 3000) }] }, ...verb(o.space ?? 0.2, 1.6, 2)],
    };
  } },
  braam: { cat: 'hit', label: 'ブラーム（緊張感）', make: (o) => {
    const L = 3 * (o.length || 1);
    return {
      layers: [55, 110, 164.8].map((f, k) => ({
        src: 'supersaw', voices: 5, detune: 12, width: 0.8, freq: f * P(o), len: L,
        filter: { type: 'lp', freq: [[0, 300], [0.25, B(o, 2400), 'out'], [L, 500, 'exp']], q: 1.5 }, drive: 8,
        amp: [[0, 0], [0.08, 1], [L * 0.4, 0.7], [L, 0, 'out']], gain: -4 - k * 4,
      })).concat([{ src: 'sine', freq: 55 * P(o), len: L, amp: [[0, 0], [0.05, 1], [L, 0, 'out']], gain: -4 }]),
      fx: [{ type: 'dist', drive: 6, kind: 'tape', mix: 0.5 }, ...verb(o.space ?? 0.5, 2, 3.5)],
    };
  } },
  punch: { cat: 'hit', label: 'パンチ（打撃）', make: (o, r) => ({
    layers: [
      { src: 'sine', freq: [[0, 140 * P(o) * jit(r, 0.05)], [0.08, 55 * P(o), 'exp']], amp: { a: 0.0008, h: 0.01, d: 0.18 }, drive: 10 },
      { src: 'noise', filter: { type: 'lp', freq: [[0, B(o, 6000)], [0.06, 1200, 'exp']] }, amp: { a: 0.0005, d: 0.09 }, drive: 6, gain: -3 },
      { src: 'noise', filter: { type: 'bp', freq: B(o, 900), q: 1.5 }, amp: { a: 0.001, d: 0.05 }, gain: -6 },
    ],
    fx: [{ type: 'transient', attack: 6 * (o.punch ?? 0.6) }, ...verb(o.space ?? 0.15, 0.6, 0.8)],
  }) },
  explosion: { cat: 'hit', label: '爆発', make: (o) => {
    const L = 2.6 * (o.length || 1);
    return {
      layers: [
        { src: 'brown', width: 1, filter: { type: 'lp', freq: [[0, B(o, 4000)], [L, 180, 'exp']] }, amp: { a: 0.003, h: 0.15, d: L }, drive: 10, gain: 0 },
        { src: 'pink', width: 1, filter: { type: 'lp', freq: [[0, B(o, 9000)], [0.6, 900, 'exp']] }, amp: { a: 0.001, d: 0.8 * (o.length || 1) }, drive: 6, gain: -4 },
        { src: 'sine', freq: [[0, 75 * P(o)], [1.2, 30 * P(o), 'exp']], amp: { a: 0.002, h: 0.1, d: 1.6 * (o.length || 1) }, drive: 6, gain: -2 + 4 * (o.punch ?? 0.5) },
        { src: 'crackle', density: 90, width: 1, at: 0.15, len: L * 0.7, filter: { type: 'bp', freq: 2500, q: 0.7 }, amp: [[0, 1], [L * 0.7, 0, 'out']], gain: -6 },
      ],
      fx: [{ type: 'transient', attack: 5 }, ...verb(o.space ?? 0.35, 2, 3)],
    };
  } },
  heartbeat: { cat: 'hit', label: '心臓の鼓動', make: (o) => ({
    layers: [[0, 0], [0.28 * (o.length || 1), -5]].flatMap(([at, g]) => [
      { at, src: 'sine', freq: [[0, 75 * P(o)], [0.12, 42 * P(o), 'exp']], amp: { a: 0.006, h: 0.02, d: 0.22 }, drive: 9, gain: g, lp: B(o, 600) },
      { at, src: 'pink', filter: { type: 'bp', freq: B(o, 480), q: 0.9 }, amp: { a: 0.004, d: 0.11 }, drive: 6, gain: g + 6 },
      { at, src: 'tri', freq: [[0, 240 * P(o)], [0.1, 150 * P(o), 'exp']], amp: { a: 0.004, d: 0.13 }, drive: 12, gain: g - 2, lp: 1200 },
    ]),
    fx: verb(o.space ?? 0.1, 0.8, 1),
  }) },

  /* ---------- バラエティ・ゲーム ---------- */
  sparkle: { cat: 'fun', label: 'キラキラ', make: (o, r) => {
    const notes = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24];
    const L = 0.9 * (o.length || 1);
    const layers = [];
    for (let k = 0; k < 14; k++) {
      const at = Math.pow(r(), 1.3) * L;
      const f = 2093 * Math.pow(2, notes[Math.floor(r() * notes.length)] / 12) * P(o) * Math.pow(2, (o.tone || 0) * 0.5);
      layers.push({ at, src: 'modal', freq: f, modes: [[1, 0.35, 1], [2.76, 0.12, 0.2]], amp: { a: 0.001, h: 0.2, d: 0.2 }, gain: -6 - r() * 8, pan: (r() - 0.5) * 1.6 });
    }
    layers.push({ src: 'noise', len: L, width: 1, hp: 9000, amp: [[0, 0], [L * 0.3, 0.3], [L, 0, 'out']], gain: -14 });
    return { layers, fx: [{ type: 'delay', time: 0.11, feedback: 0.35, mix: 0.2, pingpong: true }, ...verb(o.space ?? 0.5, 1.4, 2)] };
  } },
  magic: { cat: 'fun', label: '魔法', make: (o, r) => {
    const sp = SFX_PRESETS.sparkle.make({ ...o, space: 0 }, r);
    const L = 1.0 * (o.length || 1);
    return {
      layers: [
        { src: 'sine', voices: 3, detune: 8, width: 1, len: L, freq: [[0, 600 * P(o)], [L, 2400 * P(o), 'exp']], vibrato: { rate: 9, depth: 0.25 }, amp: [[0, 0], [0.1, 0.8], [L, 0, 'out']], gain: -8 },
        ...sp.layers.map((l) => ({ ...l, at: (l.at || 0) + 0.15 })),
      ],
      fx: [{ type: 'chorus', mix: 0.4 }, { type: 'delay', time: 0.13, feedback: 0.35, mix: 0.2, pingpong: true }, ...verb(o.space ?? 0.55, 1.6, 2.5)],
    };
  } },
  boing: { cat: 'fun', label: 'ボヨーン', make: (o) => ({
    layers: [
      { src: 'sine', freq: [[0, 140 * P(o)], [0.08, 300 * P(o), 'exp'], [0.6 * (o.length || 1), 260 * P(o)]], wobble: { rate: 13, depth: 3, decay: 0.3 * (o.length || 1) }, amp: { a: 0.003, h: 0.05, d: 0.55 * (o.length || 1) } },
      { src: 'tri', freq: [[0, 280 * P(o)], [0.08, 600 * P(o), 'exp']], wobble: { rate: 13, depth: 3, decay: 0.3 }, amp: { a: 0.002, d: 0.3 }, gain: -12 + 6 * (o.tone || 0) },
    ],
    fx: verb(o.space ?? 0.15, 0.6, 0.6),
  }) },
  jump: { cat: 'fun', label: 'ジャンプ', make: (o) => ({
    layers: [{ src: 'square', freq: [[0, 220 * P(o)], [0.16 * (o.length || 1), 760 * P(o), 'exp']], amp: [[0, 0], [0.003, 0.9], [0.14 * (o.length || 1), 0.7], [0.2 * (o.length || 1), 0]], lp: B(o, 6000), gain: -4 }],
    fx: verb(o.space ?? 0.1, 0.4, 0.4),
  }) },
  powerup: { cat: 'fun', label: 'パワーアップ', make: (o) => ({
    layers: [0, 4, 7, 12, 16, 19, 24].map((s, k) => ({ at: k * 0.055 * (o.length || 1), src: 'square', freq: 392 * Math.pow(2, s / 12) * P(o), vibrato: { rate: 14, depth: 0.15 }, amp: [[0, 0], [0.002, 0.9], [0.05, 0.7], [k === 6 ? 0.4 : 0.06, 0]], lp: B(o, 7000), gain: -6 })),
    fx: [{ type: 'delay', time: 0.09, feedback: 0.3, mix: 0.15 }, ...verb(o.space ?? 0.2, 0.6, 0.8)],
  }) },
  laser: { cat: 'fun', label: 'レーザー', make: (o) => ({
    layers: [
      { src: 'saw', freq: [[0, 2600 * P(o)], [0.25 * (o.length || 1), 180 * P(o), 'exp']], filter: { type: 'lp', freq: B(o, 6000), q: 3 }, amp: { a: 0.001, h: 0.05, d: 0.22 * (o.length || 1) }, gain: -4 },
      { src: 'sine', freq: [[0, 1300 * P(o)], [0.25 * (o.length || 1), 90 * P(o), 'exp']], fm: { ratio: 1.5, index: [[0, 6], [0.25, 0.5]] }, amp: { a: 0.001, d: 0.25 * (o.length || 1) }, gain: -6 },
    ],
    fx: [{ type: 'delay', time: 0.12, feedback: 0.4, mix: 0.25, pingpong: true }, ...verb(o.space ?? 0.2, 0.8, 1)],
  }) },
  slide: { cat: 'fun', label: 'スライドホイッスル', make: (o) => {
    const L = 0.7 * (o.length || 1);
    return { layers: [{ src: 'sine', len: L, freq: [[0, 500 * P(o)], [L, 1600 * P(o), 'smooth']], vibrato: { rate: 6, depth: 0.12 }, amp: [[0, 0], [0.04, 1], [L * 0.85, 0.9], [L, 0]] }, { src: 'noise', len: L, filter: { type: 'bp', freq: [[0, 1000 * P(o)], [L, 3200 * P(o), 'smooth']], q: 8 }, amp: [[0, 0], [0.04, 0.4], [L, 0]], gain: -12 }], fx: verb(o.space ?? 0.2, 0.6, 0.6) };
  } },
  bell: { cat: 'fun', label: 'ベル（チーン）', make: (o) => ({
    layers: [
      { src: 'modal', freq: 880 * P(o), modes: [[0.5, 3, 0.3], [1, 3 * (o.length || 1), 1], [1.19, 2, 0.4], [1.56, 1.6, 0.35], [2, 1.4, 0.3], [2.51, 0.8, 0.25 * (1 + (o.tone || 0))], [3.01, 0.5, 0.15], [4.1, 0.3, 0.08]], amp: { a: 0.001, h: 2.5 * (o.length || 1), d: 0.8 } },
      { src: 'noise', filter: { type: 'bp', freq: 4000, q: 2 }, amp: { a: 0.0003, d: 0.01 }, gain: -18 },
    ],
    fx: verb(o.space ?? 0.4, 1.4, 2.5),
  }) },
  drumroll: { cat: 'fun', label: 'ドラムロール', make: (o, r) => {
    const L = 2 * (o.length || 1);
    const layers = [];
    for (let t = 0, k = 0; t < L; t += 0.045, k++) {
      const g = -12 + 12 * (t / L);
      layers.push(...drum('snare', { tone: (o.tone || 0) - 0.3, length: 0.5 }, r).layers.map((l) => ({ ...l, at: t, gain: (l.gain || 0) + g + (k % 2 ? -2 : 0) })));
    }
    layers.push(...drum('crash', o, r).layers.map((l) => ({ ...l, at: L })));
    layers.push(...drum('kick', o, r).layers.map((l) => ({ ...l, at: L })));
    return { layers, fx: verb(o.space ?? 0.3, 1, 1.4) };
  } },

  /* ---------- 生活音・環境 ---------- */
  shutter: { cat: 'real', label: 'カメラのシャッター', make: (o, r) => ({
    layers: [0, 0.07 * (o.length || 1)].flatMap((at, k) => [
      { at, src: 'noise', filter: { type: 'bp', freq: B(o, k ? 2600 : 3600) * jit(r, 0.1), q: 1.6 }, amp: { a: 0.0003, d: 0.025 }, gain: k ? -3 : 0 },
      { at, src: 'sine', freq: [[0, (k ? 900 : 1300) * P(o)], [0.015, 500 * P(o), 'exp']], amp: { a: 0.0003, d: 0.02 }, gain: -8 },
    ]),
    fx: verb(o.space ?? 0.1, 0.4, 0.4),
  }) },
  drop: { cat: 'real', label: '水滴', make: (o, r) => ({
    layers: [{ src: 'sine', freq: [[0, 700 * P(o) * jit(r, 0.08)], [0.03, 1900 * P(o) * jit(r, 0.08), 'exp']], amp: [[0, 0], [0.002, 1], [0.02, 0.8], [0.06 * (o.length || 1), 0]] }],
    fx: verb(o.space ?? 0.35, 0.8, 1.2),
  }) },
  footstep: { cat: 'real', label: '足音', make: (o, r) => ({
    layers: [
      { src: 'pink', filter: { type: 'lp', freq: B(o, 1800) * jit(r, 0.1) }, amp: { a: 0.002, d: 0.07 }, gain: 0 },
      { src: 'sine', freq: [[0, 110 * P(o)], [0.04, 60 * P(o), 'exp']], amp: { a: 0.002, d: 0.06 }, gain: -6 },
      { at: 0.03 * jit(r, 0.3), src: 'noise', filter: { type: 'bp', freq: B(o, 3000), q: 1 }, amp: { a: 0.002, d: 0.04 }, gain: -14 },
    ],
    fx: verb(o.space ?? 0.15, 0.6, 0.6),
  }) },
  wind: { cat: 'real', label: '風', make: (o, r) => {
    const L = 4 * (o.length || 1);
    const pts = Array.from({ length: 9 }, (_, k) => [(k / 8) * L, B(o, 500 + r() * 900), 'smooth']);
    return { layers: [
      { src: 'pink', width: 1, len: L, filter: { type: 'bp', freq: pts, q: 2.5 }, amp: [[0, 0], [L * 0.3, 1, 'smooth'], [L * 0.7, 0.8], [L, 0, 'smooth']] },
      { src: 'brown', width: 1, len: L, lp: 300, amp: [[0, 0], [L * 0.4, 0.6, 'smooth'], [L, 0, 'smooth']], gain: -4 },
    ], fx: verb(o.space ?? 0.2, 1.4, 1.5) };
  } },
  rain: { cat: 'real', label: '雨', make: (o) => {
    const L = 4 * (o.length || 1);
    return { layers: [
      { src: 'pink', width: 1, len: L, filter: { type: 'hp', freq: 500 }, filter2: { type: 'lp', freq: B(o, 8000) }, amp: [[0, 0], [0.5, 1, 'smooth'], [L - 0.5, 1], [L, 0, 'smooth']], gain: -6 },
      { src: 'crackle', density: 260, width: 1, len: L, filter: { type: 'bp', freq: B(o, 3000), q: 0.6 }, amp: [[0, 0], [0.5, 1], [L - 0.5, 1], [L, 0]], gain: -2 },
    ], fx: verb(o.space ?? 0.25, 1.2, 1.2) };
  } },
  page: { cat: 'real', label: '紙をめくる', make: (o, r) => {
    const L = 0.35 * (o.length || 1);
    return { layers: [
      { src: 'noise', width: 0.6, len: L, filter: { type: 'bp', freq: [[0, B(o, 2000)], [L * 0.6, B(o, 5000) * jit(r, 0.1)], [L, B(o, 3000)]], q: 0.8 }, amp: [[0, 0], [L * 0.2, 0.5], [L * 0.7, 1, 'in'], [L, 0]], pan: [[0, 0.3], [L, -0.3]] },
      { src: 'crackle', density: 400, len: L, filter: { type: 'hp', freq: 3000 }, amp: [[0, 0.3], [L, 0]], gain: -10 },
    ], fx: verb(o.space ?? 0.1, 0.4, 0.4) };
  } },

  /* ---------- ドラム（単発） ---------- */
  kick: { cat: 'drum', label: 'キック', make: (o, r) => drum('kick', o, r) },
  kick808: { cat: 'drum', label: '808 キック', make: (o, r) => drum('kick808', o, r) },
  snare: { cat: 'drum', label: 'スネア', make: (o, r) => drum('snare', o, r) },
  clap: { cat: 'drum', label: 'クラップ', make: (o, r) => drum('clap', o, r) },
  hat: { cat: 'drum', label: 'ハイハット', make: (o, r) => drum('hat', o, r) },
  ohat: { cat: 'drum', label: 'オープンハイハット', make: (o, r) => drum('ohat', o, r) },
  crash: { cat: 'drum', label: 'クラッシュ', make: (o, r) => drum('crash', o, r) },
  tom: { cat: 'drum', label: 'タム', make: (o, r) => drum('tom', o, r) },
};

/* ---------------- ドラム ---------------- */

/** ドラムの1打（効果音の定義を返す）。o.pitch / tone / length / punch / vel */
export function drum(name, o = {}, r = rng(1)) {
  const p = P(o), Ln = o.length || 1, tone = o.tone || 0, v = o.vel ?? 1;
  const vt = (f) => f * Math.pow(2, (v - 0.8) * 0.8 + tone * 0.8); // 強く叩くほど明るい
  switch (name) {
    case 'kick': return { layers: [
      { src: 'sine', freq: [[0, 160 * p * jit(r, 0.02)], [0.03, 72 * p, 'exp'], [0.3, 48 * p, 'exp']], amp: { a: 0.0006, h: 0.03, d: 0.38 * Ln }, drive: 4 + 6 * (o.punch ?? 0.5) },
      { src: 'tri', freq: [[0, 1400 * p], [0.008, 300 * p, 'exp']], amp: { a: 0.0003, d: 0.016 }, gain: -2 + tone * 4 },
      // ノック（胴の「コッ」。スマホでもキックが聞こえるように）
      { src: 'sine', freq: [[0, 260 * p], [0.04, 160 * p, 'exp']], amp: { a: 0.0005, d: 0.06 }, drive: 6, gain: -6 },
      { src: 'noise', filter: { type: 'bp', freq: vt(3800), q: 0.9 }, amp: { a: 0.0003, d: 0.008 }, gain: -4 + tone * 6 },
    ], fx: [{ type: 'eq', bands: [{ type: 'hp', freq: 28 }, { type: 'peak', freq: 3500, gain: 3 + tone * 2, q: 1 }] }] };
    case 'kick808': return { layers: [
      { src: 'sine', freq: [[0, 125 * p], [0.05, 52 * p, 'exp'], [1.5, 47 * p, 'exp']], amp: { a: 0.0008, h: 0.05, d: 1.3 * Ln }, drive: 8 + 10 * (o.punch ?? 0.4) },
      { src: 'tri', freq: [[0, 900 * p], [0.01, 200 * p, 'exp']], amp: { a: 0.0003, d: 0.015 }, gain: -8 },
      // 倍音の層（同じ音程の 2・3 倍。小さなスピーカーでも音程が聞き取れる）
      { src: 'tri', freq: [[0, 250 * p], [0.05, 104 * p, 'exp'], [1.5, 94 * p, 'exp']], amp: { a: 0.001, h: 0.05, d: 0.8 * Ln }, drive: 10, gain: -12, lp: 1500 },
      { src: 'noise', filter: { type: 'bp', freq: vt(3000), q: 1 }, amp: { a: 0.0003, d: 0.006 }, gain: -8 },
    ], fx: [{ type: 'eq', bands: [{ type: 'hp', freq: 25 }] }] };
    case 'snare': return { layers: [
      { src: 'tri', freq: [[0, 340 * p * jit(r, 0.02)], [0.04, 200 * p, 'exp']], amp: { a: 0.0005, h: 0.005, d: 0.11 * Ln }, gain: -2 },
      { src: 'sine', freq: [[0, 260 * p], [0.05, 180 * p, 'exp']], amp: { a: 0.0005, d: 0.16 * Ln }, gain: -6 },
      { src: 'noise', width: 0.3, filter: { type: 'hp', freq: 1200 }, filter2: { type: 'lp', freq: vt(9500) * jit(r, 0.05) }, amp: { a: 0.0005, h: 0.004, d: 0.2 * Ln * jit(r, 0.05) }, gain: -1 },
      { src: 'noise', filter: { type: 'bp', freq: vt(5000), q: 0.8 }, amp: { a: 0.0003, d: 0.012 }, gain: -6 },
    ], fx: [{ type: 'transient', attack: 3 * (o.punch ?? 0.5) }, ...verb(o.space ?? 0, 0.5, 0.6)] };
    case 'clap': {
      const b = [0, 0.009, 0.019, 0.028].map((x) => x * jit(r, 0.15));
      const ampPts = [[0, 0]];
      b.forEach((t, k) => { ampPts.push([t, 0.1], [t + 0.0008, k === 3 ? 1 : 0.85], [t + 0.007, 0.15, 'exp']); });
      ampPts.push([b[3] + 0.008, 0.6], [b[3] + 0.22 * Ln, 0.0001, 'exp']);
      return { layers: [
        { src: 'noise', width: 0.4, filter: { type: 'bp', freq: vt(1300) * jit(r, 0.05), q: 1.3 }, filter2: { type: 'hp', freq: 600 }, amp: ampPts, gain: 2 },
        { src: 'noise', width: 0.6, filter: { type: 'bp', freq: vt(2600), q: 1.5 }, amp: ampPts, gain: -6 },
      ], fx: verb(o.space ?? 0.25, 0.5, 0.7) };
    }
    case 'hat': return { layers: [
      { src: 'metal', freq: 330 * p * jit(r, 0.01), filter: { type: 'bp', freq: vt(10000), q: 1 }, filter2: { type: 'hp', freq: 7000 }, amp: { a: 0.0003, d: (0.045 + (o.open || 0) * 0.4) * Ln * jit(r, 0.1) }, gain: 0 },
      { src: 'noise', width: 0.3, hp: vt(9000), amp: { a: 0.0003, d: (0.03 + (o.open || 0) * 0.3) * Ln }, gain: -8 },
    ] };
    case 'ohat': return drum('hat', { ...o, open: 1 }, r);
    case 'crash': return { layers: [
      { src: 'metal', freq: 420 * p, filter: { type: 'hp', freq: 3500 }, amp: { a: 0.0005, d: 1.6 * Ln }, gain: -6 },
      { src: 'noise', width: 0.9, filter: { type: 'hp', freq: 4000 }, filter2: { type: 'lp', freq: [[0, vt(15000)], [1.5, 7000, 'exp']] }, amp: { a: 0.0008, d: 1.9 * Ln }, gain: -2 },
      { src: 'noise', filter: { type: 'bp', freq: 3000, q: 1 }, amp: { a: 0.0005, d: 0.08 }, gain: -8 },
    ] };
    case 'ride': return { layers: [
      { src: 'metal', freq: 600 * p, filter: { type: 'bp', freq: vt(6000), q: 1.2 }, amp: { a: 0.0005, d: 1.2 * Ln }, gain: -6 },
      { src: 'modal', freq: 3200 * p, modes: [[1, 0.6, 1], [1.48, 0.4, 0.6], [2.03, 0.3, 0.4]], amp: { a: 0.0005, h: 0.4, d: 0.4 }, gain: -18 },
      { src: 'noise', hp: 6000, amp: { a: 0.0005, d: 0.9 * Ln }, gain: -14 },
    ] };
    case 'rim': return { layers: [
      { src: 'tri', freq: 1650 * p, amp: { a: 0.0003, d: 0.025 }, gain: -2 },
      { src: 'sine', freq: 480 * p, amp: { a: 0.0003, d: 0.03 }, gain: -6 },
      { src: 'noise', filter: { type: 'bp', freq: vt(3500), q: 2 }, amp: { a: 0.0002, d: 0.01 }, gain: -6 },
    ] };
    case 'tom': case 'tom1': case 'tom2': case 'tom3': {
      const f = { tom1: 200, tom: 150, tom2: 150, tom3: 105 }[name] * p;
      return { layers: [
        { src: 'sine', freq: [[0, f * 1.7], [0.06, f, 'exp'], [0.5, f * 0.92, 'exp']], amp: { a: 0.0006, h: 0.01, d: 0.45 * Ln }, drive: 3 },
        { src: 'noise', filter: { type: 'bp', freq: vt(f * 8), q: 0.8 }, amp: { a: 0.0005, d: 0.05 }, gain: -10 },
      ] };
    }
    case 'shaker': return { layers: [{ src: 'noise', width: 0.4, filter: { type: 'bp', freq: vt(7500) * jit(r, 0.05), q: 1.4 }, amp: [[0, 0], [0.012 * jit(r, 0.2), 1], [0.07 * Ln, 0, 'out']] }] };
    case 'tamb': return { layers: [
      { src: 'metal', freq: 900 * p, filter: { type: 'hp', freq: 6000 }, amp: { a: 0.001, d: 0.18 * Ln }, gain: -6 },
      { src: 'noise', filter: { type: 'bp', freq: vt(9000), q: 1.2 }, amp: [[0, 0], [0.004, 1], [0.15 * Ln, 0, 'out']], gain: -4 },
    ] };
    case 'cowbell': return { layers: [
      { src: 'square', freq: 540 * p, filter: { type: 'bp', freq: 2600, q: 1.2 }, amp: { a: 0.0005, h: 0.01, d: 0.25 * Ln } },
      { src: 'square', freq: 800 * p, filter: { type: 'bp', freq: 2600, q: 1.2 }, amp: { a: 0.0005, h: 0.01, d: 0.25 * Ln } },
    ] };
    case 'snap': return { layers: [
      { src: 'noise', filter: { type: 'bp', freq: vt(2400), q: 2.2 }, amp: { a: 0.0003, d: 0.04 } },
      { src: 'sine', freq: 1500 * p, amp: { a: 0.0002, d: 0.008 }, gain: -10 },
    ], fx: verb(o.space ?? 0.3, 0.6, 0.8) };
    case 'perc': return { layers: [{ src: 'sine', freq: [[0, 900 * p], [0.02, 600 * p, 'exp']], amp: { a: 0.0005, d: 0.08 * Ln } }, { src: 'noise', filter: { type: 'bp', freq: vt(3000), q: 2 }, amp: { a: 0.0002, d: 0.01 }, gain: -10 }] };
    case 'sub': return { layers: [{ src: 'sine', freq: [[0, 70 * p], [0.08, 50 * p, 'exp']], amp: { a: 0.002, h: 0.1, d: 0.9 * Ln }, drive: 3 }] };
    default: throw new Error(`不明なドラム: ${name}`);
  }
}

export const DRUM_NAMES = ['kick', 'kick808', 'snare', 'clap', 'rim', 'snap', 'hat', 'ohat', 'ride', 'crash', 'tom1', 'tom2', 'tom3', 'shaker', 'tamb', 'cowbell', 'perc', 'sub'];

/** プリセット名 + つまみ → 効果音の定義 */
export function sfxFromPreset(spec) {
  const pr = SFX_PRESETS[spec.preset];
  if (!pr) throw new Error(`不明な効果音プリセット: ${spec.preset}`);
  const seed = spec.seed ?? 1;
  const def = pr.make({ ...spec }, rng(seed * 7 + 3));
  def.seed = seed;
  if (spec.volume != null) def.volume = spec.volume;
  if (spec.fx) def.fx = [...(def.fx || []), ...spec.fx];
  return def;
}

/** プリセット指定でも、層を直接書いた定義でも描画できる */
export function renderAnySfx(spec, sr = 48000) {
  return renderSfx(spec.preset ? sfxFromPreset(spec) : spec, sr);
}
