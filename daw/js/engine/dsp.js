/*
 * かなでる：信号処理の部品。
 * ブラウザ（iPhone）でも Node でも同じ結果になるよう、Web Audio API を使わず純粋な JS で計算する。
 * 乱数もすべてシード付きなので、同じ JSON からは毎回まったく同じ音ができる。
 */

export const TAU = Math.PI * 2;

/** シード付き乱数（0〜1） */
export function rng(seed = 1) {
  let a = (seed * 2654435761) >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 文字列から乱数シードを作る */
export function hashSeed(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export const dbToGain = (db) => Math.pow(10, db / 20);
export const gainToDb = (g) => (g > 0 ? 20 * Math.log10(g) : -Infinity);
export const midiToFreq = (m) => 440 * Math.pow(2, (m - 69) / 12);
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/** 速い tanh（ソフトクリップ用。|x|>3 で ±1） */
export function softClip(x) {
  if (x > 3) return 1;
  if (x < -3) return -1;
  const x2 = x * x;
  return (x * (27 + x2)) / (27 + 9 * x2);
}

/* ---------- 音名・和音 ---------- */

const NOTE_BASE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** "C4" "F#3" "Bb2" → MIDI 番号（C4 = 60）。数値はそのまま */
export function noteToMidi(n) {
  if (typeof n === 'number') return n;
  const m = /^([A-Ga-g])([#b♯♭]*)(-?\d+)$/.exec(String(n).trim());
  if (!m) throw new Error(`音名が読めません: ${n}`);
  let v = NOTE_BASE[m[1].toUpperCase()];
  for (const c of m[2]) v += c === '#' || c === '♯' ? 1 : -1;
  return v + (Number(m[3]) + 1) * 12;
}

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export const midiToName = (m) => NAMES[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1);
export const pcName = (pc) => NAMES[((pc % 12) + 12) % 12];

// 和音の種類 → ルートからの半音
const CHORDS = {
  '': [0, 4, 7], M: [0, 4, 7], maj: [0, 4, 7], m: [0, 3, 7], min: [0, 3, 7],
  dim: [0, 3, 6], aug: [0, 4, 8], '+': [0, 4, 8], sus2: [0, 2, 7], sus4: [0, 5, 7], sus: [0, 5, 7], 5: [0, 7],
  6: [0, 4, 7, 9], m6: [0, 3, 7, 9], 7: [0, 4, 7, 10], M7: [0, 4, 7, 11], maj7: [0, 4, 7, 11], m7: [0, 3, 7, 10],
  mM7: [0, 3, 7, 11], m7b5: [0, 3, 6, 10], dim7: [0, 3, 6, 9], '7sus4': [0, 5, 7, 10], add9: [0, 4, 7, 14], madd9: [0, 3, 7, 14],
  9: [0, 4, 7, 10, 14], M9: [0, 4, 7, 11, 14], maj9: [0, 4, 7, 11, 14], m9: [0, 3, 7, 10, 14], 11: [0, 4, 7, 10, 14, 17],
  m11: [0, 3, 7, 10, 14, 17], 13: [0, 4, 7, 10, 14, 21], M13: [0, 4, 7, 11, 14, 21], m13: [0, 3, 7, 10, 14, 21],
  '7b9': [0, 4, 7, 10, 13], '7#9': [0, 4, 7, 10, 15], '69': [0, 4, 7, 9, 14], m69: [0, 3, 7, 9, 14],
};

/**
 * 和音記号 → MIDI 番号の配列。"Am9:3" はルートを3オクターブ目（A3）に置く。"C/E:3" は E を最低音にする。
 * 構成音はルートの上に積む（ボイシングは voicing で調整）。
 */
export function chordToMidi(sym) {
  const [body, octStr = '3'] = String(sym).split(':');
  const [name, bass] = body.split('/');
  const m = /^([A-G][#b]?)(.*)$/.exec(name.trim());
  if (!m || !(m[2] in CHORDS)) throw new Error(`和音記号が読めません: ${sym}`);
  const oct = Number(octStr);
  const root = noteToMidi(m[1] + oct);
  const notes = CHORDS[m[2]].map((i) => root + i);
  if (bass) {
    let b = noteToMidi(bass + oct);
    while (b >= notes[0]) b -= 12;
    // ルートより下に置き、近すぎる場合はそのまま最低音として足す
    notes.unshift(b);
  }
  return notes;
}

/** 音符の指定（"C4" / 60 / "Am7:3" / ["C4","E4"]）→ MIDI 番号の配列 */
export function pitchesOf(n) {
  if (Array.isArray(n)) return n.flatMap(pitchesOf);
  if (typeof n === 'number') return [n];
  if (String(n).includes(':')) return chordToMidi(n);
  return [noteToMidi(n)];
}

/* ---------- 音価・時間 ---------- */

/** "1/8" "1/8d"（付点）"1/8t"（3連）"2" → 拍数（4分音符 = 1） */
export function noteValue(v) {
  if (typeof v === 'number') return v;
  const m = /^(\d+)\/(\d+)([dt]?)$/.exec(String(v));
  if (!m) return Number(v);
  let b = (4 * Number(m[1])) / Number(m[2]);
  if (m[3] === 'd') b *= 1.5;
  if (m[3] === 't') b *= 2 / 3;
  return b;
}

/* ---------- カーブ（時間とともに変わる値） ---------- */

/**
 * [[t, v], [t, v, "exp"|"lin"|"hold"|"smooth"|"in"|"out"], ...] を時刻 t で評価する関数を返す。
 * 形の指定はその点に向かう区間に効く。def は既定の形。数値ならそのまま定数。
 */
export function curve(spec, def = 'lin') {
  if (spec == null) return () => 0;
  if (typeof spec === 'number') return () => spec;
  const pts = spec.map((p) => [Number(p[0]), Number(p[1]), p[2] || def]).sort((a, b) => a[0] - b[0]);
  if (pts.length === 1) { const v = pts[0][1]; return () => v; }
  let i = 1;
  return (t) => {
    if (t <= pts[0][0]) return pts[0][1];
    const last = pts[pts.length - 1];
    if (t >= last[0]) return last[1];
    // 呼び出しは大抵時間順なので前回の位置から探す
    if (t < pts[i - 1][0]) i = 1;
    while (i < pts.length - 1 && t > pts[i][0]) i++;
    const [t0, v0] = pts[i - 1];
    const [t1, v1, shape] = pts[i];
    const u = t1 > t0 ? (t - t0) / (t1 - t0) : 1;
    switch (shape) {
      case 'hold': return v0;
      case 'exp':
        if (v0 > 0 && v1 > 0) return v0 * Math.pow(v1 / v0, u);
        return v0 + (v1 - v0) * u;
      case 'smooth': return v0 + (v1 - v0) * (u * u * (3 - 2 * u));
      case 'in': return v0 + (v1 - v0) * u * u * u;
      case 'out': { const w = 1 - u; return v0 + (v1 - v0) * (1 - w * w * w); }
      default: return v0 + (v1 - v0) * u;
    }
  };
}

/** カーブの最後の時刻 */
export const curveEnd = (spec) => (Array.isArray(spec) && spec.length ? Math.max(...spec.map((p) => Number(p[0]))) : 0);

/* ---------- エンベロープ ---------- */

/**
 * ADSR。attack は直線（クリックを防ぐため最低 1ms）、decay/release は指数で滑らかに落ちる。
 * gate() で離鍵。value は次のサンプルの値。
 */
export class ADSR {
  constructor(sr, { a = 0.005, d = 0.2, s = 0.7, r = 0.2, curve = 3 } = {}) {
    this.sr = sr;
    this.a = Math.max(0.001, a) * sr;
    this.dCoef = Math.exp(-curve / Math.max(1, d * sr));
    this.rCoef = Math.exp(-curve / Math.max(1, r * sr));
    this.s = s;
    this.stage = 0; // 0:attack 1:decay 2:release 3:off
    this.n = 0;
    this.v = 0;
  }
  release() {
    if (this.stage < 2) this.stage = 2;
  }
  next() {
    switch (this.stage) {
      case 0:
        this.v = ++this.n / this.a;
        if (this.n >= this.a) { this.v = 1; this.stage = 1; }
        break;
      case 1:
        this.v = this.s + (this.v - this.s) * this.dCoef;
        break;
      case 2:
        this.v *= this.rCoef;
        if (this.v < 1e-5) { this.v = 0; this.stage = 3; }
        break;
      default:
        this.v = 0;
    }
    return this.v;
  }
  get done() { return this.stage === 3; }
}

/* ---------- 発振器 ---------- */

/** PolyBLEP：のこぎり波・矩形波の折り返しノイズ（エイリアス）を抑える補正 */
function blep(t, dt) {
  if (t < dt) { t /= dt; return t + t - t * t - 1; }
  if (t > 1 - dt) { t = (t - 1) / dt; return t * t + t + t + 1; }
  return 0;
}

/** 帯域制限された基本波形の発振器 */
export class Osc {
  constructor(wave = 'saw', phase = 0) {
    this.wave = wave;
    this.p = phase;
    this.tri = 0;
  }
  /** dt = 周波数 / サンプルレート。pw はパルス幅 */
  next(dt, pw = 0.5) {
    const p = this.p;
    let y;
    switch (this.wave) {
      case 'sine': y = Math.sin(TAU * p); break;
      case 'saw': y = 2 * p - 1 - blep(p, dt); break;
      case 'square':
      case 'pulse': {
        y = (p < pw ? 1 : -1) + blep(p, dt) - blep((p - pw + 1) % 1, dt);
        break;
      }
      case 'tri': {
        // 矩形波を積分して三角波にする（帯域制限のまま）
        const sq = (p < 0.5 ? 1 : -1) + blep(p, dt) - blep((p + 0.5) % 1, dt);
        this.tri = dt * sq * 4 + (1 - dt * 0.5) * this.tri;
        y = this.tri;
        break;
      }
      default: y = Math.sin(TAU * p);
    }
    this.p = p + dt;
    if (this.p >= 1) this.p -= 1;
    return y;
  }
}

/** ノイズ（white / pink / brown） */
export class Noise {
  constructor(color = 'white', seed = 1) {
    this.color = color;
    this.r = rng(seed);
    this.b = [0, 0, 0, 0, 0, 0, 0];
    this.br = 0;
  }
  next() {
    const w = this.r() * 2 - 1;
    if (this.color === 'pink') {
      const b = this.b;
      b[0] = 0.99886 * b[0] + w * 0.0555179;
      b[1] = 0.99332 * b[1] + w * 0.0750759;
      b[2] = 0.969 * b[2] + w * 0.153852;
      b[3] = 0.8665 * b[3] + w * 0.3104856;
      b[4] = 0.55 * b[4] + w * 0.5329522;
      b[5] = -0.7616 * b[5] - w * 0.016898;
      const y = b[0] + b[1] + b[2] + b[3] + b[4] + b[5] + b[6] + w * 0.5362;
      b[6] = w * 0.115926;
      return y * 0.11;
    }
    if (this.color === 'brown') {
      this.br = (this.br + 0.02 * w) / 1.02;
      return this.br * 3.5;
    }
    return w;
  }
}

/* ---------- フィルター ---------- */

/**
 * ステートバリアブルフィルター（Cytomic の TPT/ZDF 方式）。
 * カットオフを速く動かしても安定していて、シンセのフィルターに向く。
 */
export class SVF {
  constructor(sr, type = 'lp') {
    this.sr = sr;
    this.type = type;
    this.ic1 = 0;
    this.ic2 = 0;
    this.set(1000, 0.707);
  }
  /** res: Q 値（0.5〜20 程度） */
  set(freq, q) {
    const f = clamp(freq, 10, this.sr * 0.49);
    this.g = Math.tan((Math.PI * f) / this.sr);
    this.k = 1 / Math.max(0.05, q);
    this.a1 = 1 / (1 + this.g * (this.g + this.k));
    this.a2 = this.g * this.a1;
    this.a3 = this.g * this.a2;
  }
  next(x) {
    const v3 = x - this.ic2;
    const v1 = this.a1 * this.ic1 + this.a2 * v3;
    const v2 = this.ic2 + this.a2 * this.ic1 + this.a3 * v3;
    this.ic1 = 2 * v1 - this.ic1;
    this.ic2 = 2 * v2 - this.ic2;
    switch (this.type) {
      case 'hp': return x - this.k * v1 - v2;
      case 'bp': return v1 * this.k; // 中心でゲイン 1
      case 'notch': return x - this.k * v1;
      case 'peak': return x - this.k * v1 - 2 * v2;
      default: return v2;
    }
  }
}

/** RBJ のバイクアッド（EQ 用） */
export class Biquad {
  constructor(sr, type = 'peak', freq = 1000, gain = 0, q = 0.707) {
    this.sr = sr;
    this.x1 = this.x2 = this.y1 = this.y2 = 0;
    this.set(type, freq, gain, q);
  }
  set(type, freq, gain = 0, q = 0.707) {
    const w = (TAU * clamp(freq, 5, this.sr * 0.49)) / this.sr;
    const cw = Math.cos(w), sw = Math.sin(w);
    const A = Math.pow(10, gain / 40);
    const alpha = sw / (2 * Math.max(0.05, q));
    let b0, b1, b2, a0, a1, a2;
    switch (type) {
      case 'lp': b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = b0; a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha; break;
      case 'hp': b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = b0; a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha; break;
      case 'bp': b0 = alpha; b1 = 0; b2 = -alpha; a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha; break;
      case 'notch': b0 = 1; b1 = -2 * cw; b2 = 1; a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha; break;
      case 'lowshelf': {
        const s = 2 * Math.sqrt(A) * alpha;
        b0 = A * (A + 1 - (A - 1) * cw + s); b1 = 2 * A * (A - 1 - (A + 1) * cw); b2 = A * (A + 1 - (A - 1) * cw - s);
        a0 = A + 1 + (A - 1) * cw + s; a1 = -2 * (A - 1 + (A + 1) * cw); a2 = A + 1 + (A - 1) * cw - s;
        break;
      }
      case 'highshelf': {
        const s = 2 * Math.sqrt(A) * alpha;
        b0 = A * (A + 1 + (A - 1) * cw + s); b1 = -2 * A * (A - 1 + (A + 1) * cw); b2 = A * (A + 1 + (A - 1) * cw - s);
        a0 = A + 1 - (A - 1) * cw + s; a1 = 2 * (A - 1 - (A + 1) * cw); a2 = A + 1 - (A - 1) * cw - s;
        break;
      }
      default: // peak
        b0 = 1 + alpha * A; b1 = -2 * cw; b2 = 1 - alpha * A; a0 = 1 + alpha / A; a1 = -2 * cw; a2 = 1 - alpha / A;
    }
    this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0; this.a1 = a1 / a0; this.a2 = a2 / a0;
  }
  next(x) {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = y;
    return y;
  }
  /** 周波数 f での振幅応答（表示用） */
  response(f) {
    const w = (TAU * f) / this.sr;
    const c1 = Math.cos(w), s1 = Math.sin(w), c2 = Math.cos(2 * w), s2 = Math.sin(2 * w);
    const nr = this.b0 + this.b1 * c1 + this.b2 * c2, ni = -(this.b1 * s1 + this.b2 * s2);
    const dr = 1 + this.a1 * c1 + this.a2 * c2, di = -(this.a1 * s1 + this.a2 * s2);
    return Math.sqrt((nr * nr + ni * ni) / (dr * dr + di * di));
  }
}

/** 1次のローパス（なめらかにする用） */
export class OnePole {
  constructor(sr, freq = 1000) { this.sr = sr; this.y = 0; this.set(freq); }
  set(freq) { this.a = Math.exp((-TAU * clamp(freq, 1, this.sr * 0.49)) / this.sr); }
  next(x) { return (this.y = x + (this.y - x) * this.a); }
}

/** 直流カット */
export class DCBlock {
  constructor() { this.x1 = 0; this.y1 = 0; }
  next(x) { const y = x - this.x1 + 0.9975 * this.y1; this.x1 = x; this.y1 = y; return y; }
}

/** 小数サンプルで読める遅延線 */
export class Delay {
  constructor(maxSamples) {
    let n = 1;
    while (n < maxSamples + 2) n <<= 1;
    this.buf = new Float32Array(n);
    this.mask = n - 1;
    this.w = 0;
  }
  write(x) { this.buf[this.w] = x; this.w = (this.w + 1) & this.mask; }
  /** d サンプル前の値（線形補間） */
  read(d) {
    const p = this.w - 1 - d;
    const i = Math.floor(p);
    const f = p - i;
    const a = this.buf[i & this.mask], b = this.buf[(i + 1) & this.mask];
    return a + (b - a) * f;
  }
  readInt(d) { return this.buf[(this.w - 1 - d) & this.mask]; }
}

/** ステレオの左右バッファを用意 */
export const stereo = (n) => [new Float32Array(n), new Float32Array(n)];

/** 等パワーのパン（-1 左 〜 1 右） */
export function panGains(pan) {
  const a = ((clamp(pan, -1, 1) + 1) * Math.PI) / 4;
  return [Math.cos(a) * Math.SQRT2, Math.sin(a) * Math.SQRT2];
}
