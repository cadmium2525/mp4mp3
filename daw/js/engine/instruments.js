/*
 * かなでる：音源（楽器）。
 *   synth   … 減算シンセ（のこぎり波などを重ねてフィルターで削る。パッド・ベース・リード・ブラス）
 *   fm      … FM シンセ（エレピ・ベル・金属的なベース）
 *   pluck   … 弦をはじく物理モデル（ギター・ハープ・プラック）
 *   partials… 倍音を足し合わせる（ピアノ・マリンバ・ベル・オルガン）
 * 1音ごとに Voice を作り、ステレオのバッファへ足し込む。
 */
import { ADSR, Osc, Noise, SVF, Biquad, OnePole, Delay, rng, clamp, dbToGain, midiToFreq, TAU } from './dsp.js';

const CR = 16; // コントロールレート（ピッチやフィルターを更新する間隔）

/* ---------------- 減算シンセ ---------------- */

const VOWELS = {
  a: [[800, 1, 80], [1150, 0.5, 90], [2900, 0.25, 120]],
  e: [[400, 1, 60], [1600, 0.35, 80], [2700, 0.25, 120]],
  i: [[300, 1, 50], [2250, 0.3, 90], [3000, 0.2, 120]],
  o: [[450, 1, 70], [800, 0.6, 80], [2830, 0.12, 100]],
  u: [[325, 1, 50], [700, 0.25, 60], [2530, 0.08, 170]],
};

class SynthVoice {
  constructor(sr, p, midi, vel, seed, glideFrom) {
    this.sr = sr;
    this.p = p;
    this.vel = vel;
    const r = rng(seed);
    this.r = r;
    this.midi = midi;
    this.glideFrom = glideFrom ?? midi;
    this.glide = glideFrom != null ? p.glide ?? 0.06 : 0;
    // 発振器（ユニゾンは左右に広げる）
    this.oscs = [];
    for (const o of p.osc || [{ wave: 'saw' }]) {
      let wave = o.wave || 'saw';
      let n = o.voices ?? 1, det = o.detune ?? 0;
      if (wave === 'supersaw') { wave = 'saw'; n = o.voices ?? 7; det = o.detune ?? 22; }
      const spread = o.spread ?? 0.8;
      const lvl = (o.level ?? 1) / Math.sqrt(n);
      for (let k = 0; k < n; k++) {
        const u = n === 1 ? 0 : (k / (n - 1)) * 2 - 1; // -1〜1
        const pan = u * spread;
        const a = ((pan + 1) * Math.PI) / 4;
        this.oscs.push({
          osc: new Osc(wave, n > 1 || o.randomPhase ? r() : 0),
          ratio: Math.pow(2, ((o.semi ?? 0) * 100 + (o.cents ?? 0) + u * det + (n > 1 ? (r() - 0.5) * det * 0.15 : 0)) / 1200),
          pw: o.pw ?? 0.5,
          gl: lvl * Math.cos(a) * Math.SQRT2,
          gr: lvl * Math.sin(a) * Math.SQRT2,
          fixed: o.fixed, // 固定周波数（Hz）
        });
      }
    }
    this.noise = p.noise ? new Noise(p.noiseColor || 'white', seed + 3) : null;
    this.subOsc = p.sub ? new Osc(p.subWave || 'sine') : null;
    const f = p.filter || {};
    this.fType = f.type || 'lp';
    this.poles = f.poles === 4 ? 2 : 1;
    this.fl = Array.from({ length: this.poles }, () => new SVF(sr, this.fType));
    this.fr = Array.from({ length: this.poles }, () => new SVF(sr, this.fType));
    this.aenv = new ADSR(sr, p.amp || { a: 0.005, d: 0.3, s: 0.7, r: 0.2 });
    this.fenv = new ADSR(sr, p.fenv || p.amp || { a: 0.005, d: 0.3, s: 0.5, r: 0.2 });
    this.form = p.formant ? (VOWELS[p.formant] || VOWELS.a).map(([fr, g, bw]) => ({ l: new SVF(sr, 'bp'), r: new SVF(sr, 'bp'), fr, g, q: fr / bw })) : null;
    if (this.form) for (const x of this.form) { x.l.set(x.fr, x.q); x.r.set(x.fr, x.q); }
    this.gain = dbToGain(p.gain ?? 0) * Math.pow(vel, p.velCurve ?? 1.2);
    this.t = 0;
  }
  release() { this.aenv.release(); this.fenv.release(); }
  get done() { return this.aenv.done; }
  render(L, R, off, n) {
    const p = this.p, sr = this.sr, f = p.filter || {};
    const cutoff = f.cutoff ?? 8000, q = f.q ?? 0.8, envAmt = f.env ?? 0, key = f.keytrack ?? 0.5, velAmt = f.vel ?? 1;
    const drive = f.drive ? dbToGain(f.drive) : 0;
    const lfo = p.lfo, vib = p.vibrato, pe = p.pitchEnv;
    let pitch = this.midi, dtBase = 0, fc = cutoff;
    for (let i = 0; i < n; i++) {
      if (i % CR === 0) {
        const t = this.t / sr;
        // ピッチ（グライド・ピッチエンベロープ・ビブラート）
        pitch = this.glide > 0 && t < this.glide * 4 ? this.midi + (this.glideFrom - this.midi) * Math.exp(-t / this.glide) : this.midi;
        if (pe) pitch += pe.amt * Math.exp(-t / Math.max(0.001, pe.time ?? 0.05));
        if (vib) {
          const ramp = clamp((t - (vib.delay ?? 0.25)) / (vib.fade ?? 0.3), 0, 1);
          pitch += Math.sin(TAU * (vib.rate ?? 5.2) * t) * (vib.depth ?? 0.15) * ramp;
        }
        if (lfo?.to === 'pitch') pitch += Math.sin(TAU * lfo.rate * t) * lfo.amt;
        dtBase = midiToFreq(pitch) / sr;
        // フィルター
        let oct = envAmt * this.fenv.v + key * ((this.midi - 60) / 12) + velAmt * (this.vel - 0.8);
        if (lfo?.to === 'cutoff') oct += Math.sin(TAU * lfo.rate * t + (lfo.phase ?? 0)) * lfo.amt;
        fc = cutoff * Math.pow(2, oct);
        for (const x of this.fl) x.set(fc, q);
        for (const x of this.fr) x.set(fc, q);
      }
      const env = this.aenv.next();
      this.fenv.next();
      let l = 0, r = 0;
      for (const o of this.oscs) {
        const dt = o.fixed ? o.fixed / sr : dtBase * o.ratio;
        let pw = o.pw;
        if (lfo?.to === 'pw') pw = clamp(pw + Math.sin((TAU * lfo.rate * this.t) / sr) * lfo.amt, 0.05, 0.95);
        const y = o.osc.next(dt, pw);
        l += y * o.gl;
        r += y * o.gr;
      }
      if (this.subOsc) { const y = this.subOsc.next(dtBase * 0.5) * p.sub; l += y; r += y; }
      if (this.noise) { const y = this.noise.next() * p.noise; l += y; r += y; }
      if (drive) { l = Math.tanh(l * drive) / Math.tanh(drive); r = Math.tanh(r * drive) / Math.tanh(drive); }
      for (const x of this.fl) l = x.next(l);
      for (const x of this.fr) r = x.next(r);
      if (this.form) {
        let fl = 0, fr = 0;
        for (const x of this.form) { fl += x.l.next(l) * x.g; fr += x.r.next(r) * x.g; }
        l = fl * 1.6; r = fr * 1.6;
      }
      let a = env * this.gain;
      if (lfo?.to === 'amp') a *= 1 - lfo.amt * 0.5 * (1 + Math.sin((TAU * lfo.rate * this.t) / sr));
      L[off + i] += l * a;
      R[off + i] += r * a;
      this.t++;
    }
  }
}

/* ---------------- FM ---------------- */

/*
 * ops: [{ ratio, level, amp:{a,d,s,r}, fb, vel, fixed }]
 * mods: ops[i] を変調する op の番号の配列。out: 音として出す op の番号
 */
class FMVoice {
  constructor(sr, p, midi, vel, seed) {
    this.sr = sr;
    this.p = p;
    this.vel = vel;
    this.midi = midi;
    this.ops = p.ops.map((o) => ({ ...o, env: new ADSR(sr, o.amp || p.amp || {}), ph: 0, y: 0, y1: 0 }));
    this.mods = p.mods || this.ops.map((_, i) => (i + 1 < this.ops.length ? [i + 1] : []));
    this.out = p.out || [0];
    this.gain = dbToGain(p.gain ?? 0) * Math.pow(vel, p.velCurve ?? 1.2);
    this.order = this.ops.map((_, i) => i).reverse();
    this.t = 0;
    this.detune = (rng(seed)() - 0.5) * (p.drift ?? 2); // 1音ごとのわずかなずれ（セント）
    this.pan = p.spread ? ((midi - 60) / 36) * p.spread : 0;
    const filt = p.filter;
    this.filter = filt ? new SVF(sr, filt.type || 'lp') : null;
    if (this.filter) this.filter.set(filt.cutoff * Math.pow(2, (filt.keytrack ?? 0.5) * ((midi - 60) / 12)), filt.q ?? 0.7);
  }
  release() { for (const o of this.ops) o.env.release(); }
  get done() { return this.out.every((i) => this.ops[i].env.done); }
  render(L, R, off, n) {
    const sr = this.sr, ops = this.ops, vib = this.p.vibrato;
    let f0 = midiToFreq(this.midi) * Math.pow(2, this.detune / 1200);
    const gl = Math.cos(((this.pan + 1) * Math.PI) / 4) * Math.SQRT2, gr = Math.sin(((this.pan + 1) * Math.PI) / 4) * Math.SQRT2;
    for (let i = 0; i < n; i++) {
      if (vib && i % CR === 0) {
        const t = this.t / sr;
        f0 = midiToFreq(this.midi + Math.sin(TAU * vib.rate * t) * vib.depth * clamp((t - (vib.delay ?? 0.2)) / 0.3, 0, 1));
      }
      for (const k of this.order) {
        const o = ops[k];
        let m = 0;
        for (const j of this.mods[k]) m += ops[j].y;
        if (o.fb) m += o.fb * (o.y + o.y1) * 0.5;
        const e = o.env.next() * (o.vel != null ? 1 - o.vel + o.vel * this.vel : 1);
        o.y1 = o.y;
        o.y = Math.sin(TAU * o.ph + m) * e * (o.level ?? 1);
        o.ph += (o.fixed || f0 * (o.ratio ?? 1) + (o.detune ?? 0)) / sr;
        if (o.ph > 1) o.ph -= 1;
      }
      let y = 0;
      for (const k of this.out) y += ops[k].y;
      if (this.filter) y = this.filter.next(y);
      y *= this.gain;
      L[off + i] += y * gl;
      R[off + i] += y * gr;
      this.t++;
    }
  }
}

/* ---------------- 弦をはじく（Karplus-Strong 拡張） ---------------- */

class PluckVoice {
  constructor(sr, p, midi, vel, seed) {
    this.sr = sr;
    this.p = p;
    const f = midiToFreq(midi);
    const r = rng(seed);
    this.r = r;
    // ループ内のローパスによる遅れ（約 0.5 サンプル）を差し引いて音程を合わせる
    const total = sr / f;
    const N = Math.floor(total - 0.5);
    const frac = total - 0.5 - N;
    this.ap = (1 - frac) / (1 + frac); // 小数部分はオールパスで
    this.apx = 0; this.apy = 0;
    this.N = N;
    this.d = new Delay(N + 4);
    this.bright = clamp((p.bright ?? 0.5) * (0.6 + 0.6 * vel), 0, 1);
    const decay = (p.decay ?? 3) * Math.pow(2, -(midi - 60) / 30);
    this.g = Math.pow(10, -3 / (f * decay));
    this.relG = Math.pow(10, -3 / (f * (p.release ?? 0.15)));
    this.s = 0.5 - 0.45 * this.bright; // ループ内ローパスの強さ
    this.last = 0;
    // 励起：ローパスしたノイズ + ピック位置の櫛形フィルター
    const ex = new Float32Array(N);
    const lp = new OnePole(sr, 400 + 12000 * this.bright * this.bright);
    const pick = Math.max(1, Math.round(N * (p.pick ?? 0.13)));
    const tmp = new Float32Array(N);
    for (let i = 0; i < N; i++) tmp[i] = lp.next(r() * 2 - 1);
    let mean = 0;
    for (let i = 0; i < N; i++) { ex[i] = tmp[i] - (i >= pick ? tmp[i - pick] : 0); mean += ex[i]; }
    mean /= N;
    let peak = 0;
    for (let i = 0; i < N; i++) { ex[i] -= mean; peak = Math.max(peak, Math.abs(ex[i])); }
    for (let i = 0; i < N; i++) this.d.write((ex[i] / (peak || 1)) * 0.6);
    this.gain = dbToGain(p.gain ?? 0) * Math.pow(vel, p.velCurve ?? 1);
    this.body = p.body ? [new Biquad(sr, 'peak', 110, 6 * p.body, 1.2), new Biquad(sr, 'peak', 220, 4 * p.body, 1.5), new Biquad(sr, 'peak', 3000, -3 * p.body, 0.8)] : null;
    this.pan = p.spread ? ((midi - 60) / 30) * p.spread : 0;
    this.rel = false;
    this.quiet = 0;
    this.t = 0;
  }
  release() { this.rel = true; }
  get done() { return this.quiet > this.sr * 0.05; }
  render(L, R, off, n) {
    const gl = Math.cos(((this.pan + 1) * Math.PI) / 4) * Math.SQRT2, gr = Math.sin(((this.pan + 1) * Math.PI) / 4) * Math.SQRT2;
    for (let i = 0; i < n; i++) {
      const x = this.d.readInt(this.N - 1);
      // 2点平均型のローパス
      const lp = (1 - this.s) * x + this.s * this.last;
      this.last = x;
      // 小数遅延のオールパス
      const y = this.ap * lp + this.apx - this.ap * this.apy;
      this.apx = lp; this.apy = y;
      const g = this.rel ? this.relG : this.g;
      this.d.write(y * g);
      let out = x * this.gain;
      if (this.body) for (const b of this.body) out = b.next(out);
      L[off + i] += out * gl;
      R[off + i] += out * gr;
      this.quiet = Math.abs(x) < 1e-4 ? this.quiet + 1 : 0;
      this.t++;
    }
  }
}

/* ---------------- 倍音の足し合わせ（ピアノ・マレット・ベル・オルガン） ---------------- */

/*
 * partials: [[倍率, 減衰の速さ(秒, 0 で持続), 音量]]、または piano: true でピアノの倍音を自動生成。
 * hammer: 打鍵ノイズ、mallet: 叩く物の硬さ（高い倍音の出かた）
 */
class PartialVoice {
  constructor(sr, p, midi, vel, seed) {
    this.sr = sr;
    this.p = p;
    const r = rng(seed);
    const f0 = midiToFreq(midi) * Math.pow(2, ((r() - 0.5) * (p.drift ?? 0)) / 1200);
    let parts;
    if (p.piano) parts = pianoPartials(midi, vel, p);
    else {
      const hard = clamp((p.mallet ?? 0.5) * (0.5 + vel * 0.7), 0, 1.5);
      const scale = p.decayScale ? Math.pow(2, -((midi - 60) / 12) * p.decayScale) : 1;
      parts = (p.partials || [[1, 2, 1]]).map(([ratio, dec, g], k) => [ratio, dec * scale, g * (k === 0 ? 1 : Math.pow(hard, 1 + k * 0.4)), p.beat ?? 0]);
    }
    this.osc = [];
    for (const [ratio, dec, g, beat] of parts) {
      const f = f0 * ratio;
      if (f > sr * 0.45 || g < 1e-4) continue;
      const strings = beat ? 2 : 1;
      for (let s = 0; s < strings; s++) {
        const ff = f + (strings === 2 ? (s ? beat : -beat) * (0.5 + r()) : 0);
        const w = (TAU * ff) / sr;
        const ph = r() * TAU * (p.randomPhase === false ? 0 : 1);
        this.osc.push({
          c: Math.cos(w), s: Math.sin(w), x: Math.cos(ph), y: Math.sin(ph),
          g: g / strings,
          dec: dec > 0 ? Math.exp(-1 / (dec * sr)) : 1,
          dec2: p.twoStage && dec > 0 ? Math.exp(-1 / (dec * p.twoStage * sr)) : 0,
          e: 1, e2: 1,
          pan: s ? 0.25 : -0.25,
        });
      }
    }
    this.amp = new ADSR(sr, p.amp || { a: 0.002, d: 10, s: 1, r: 0.25 });
    this.gain = dbToGain(p.gain ?? 0) * Math.pow(vel, p.velCurve ?? 1.4);
    this.noise = p.hammer ? new Noise('white', seed + 1) : null;
    this.nf = p.hammer ? new SVF(sr, 'bp') : null;
    if (this.nf) this.nf.set(Math.min(sr * 0.4, f0 * 6 + 1500), 0.8);
    this.nDec = Math.exp(-1 / (0.012 * sr));
    this.nEnv = (p.hammer || 0) * (0.4 + vel);
    this.attack = Math.max(1, Math.round((p.attack ?? 0.0015) * sr));
    this.pan = p.spread ? ((midi - 64) / 36) * p.spread : 0;
    this.trem = p.tremolo;
    this.t = 0;
  }
  release() { this.amp.release(); }
  get done() { return this.amp.done || this.osc.every((o) => o.e < 2e-5); }
  render(L, R, off, n) {
    const pl = Math.cos(((this.pan + 1) * Math.PI) / 4) * Math.SQRT2, pr = Math.sin(((this.pan + 1) * Math.PI) / 4) * Math.SQRT2;
    for (let i = 0; i < n; i++) {
      let l = 0, r = 0;
      for (const o of this.osc) {
        const x = o.x * o.c - o.y * o.s;
        o.y = o.x * o.s + o.y * o.c;
        o.x = x;
        o.e *= o.dec;
        let e = o.e;
        if (o.dec2) { o.e2 *= o.dec2; e = 0.35 * o.e2 + 0.65 * o.e; }
        const v = o.y * o.g * e;
        l += v * (1 - o.pan);
        r += v * (1 + o.pan);
      }
      // 振幅の補正（発振器の数値誤差でずれないように時々正規化）
      if ((this.t & 1023) === 0) for (const o of this.osc) { const m = 1 / Math.hypot(o.x, o.y); o.x *= m; o.y *= m; }
      if (this.noise) {
        const nz = this.nf.next(this.noise.next()) * this.nEnv;
        this.nEnv *= this.nDec;
        l += nz; r += nz;
      }
      let a = this.amp.next() * this.gain * Math.min(1, this.t / this.attack);
      if (this.trem) a *= 1 - this.trem.depth * 0.5 * (1 + Math.sin((TAU * this.trem.rate * this.t) / this.sr));
      L[off + i] += l * a * pl;
      R[off + i] += r * a * pr;
      this.t++;
    }
  }
}

/** ピアノの倍音：弦の硬さによる倍音のずれ（インハーモニシティ）、打弦位置、高い音ほど速い減衰 */
function pianoPartials(midi, vel, p) {
  const f0 = midiToFreq(midi);
  const B = 0.00004 * Math.pow(2, (midi - 21) / 13);
  const base = (p.sustain ?? 7) * Math.pow(2, -(midi - 48) / 20);
  const bright = (p.bright ?? 0.5) * (0.4 + vel);
  const out = [];
  const K = Math.min(28, Math.floor(18000 / f0));
  for (let k = 1; k <= K; k++) {
    const ratio = k * Math.sqrt(1 + B * k * k);
    const strike = Math.abs(Math.sin((Math.PI * k) / 8.5)) + 0.08; // 弦の 1/8.5 の位置を叩く
    const g = (strike / Math.pow(k, 1.6 - bright * 0.7)) * (k === 1 ? 1 : 0.9);
    const dec = base / (1 + 0.12 * Math.pow(k, 1.4));
    const beat = midi < 40 ? 0 : 0.12 + 0.02 * k; // 複数の弦のうなり
    out.push([ratio, dec, g, beat]);
  }
  return out;
}

/* ---------------- 楽器の作成 ---------------- */

const VOICES = { synth: SynthVoice, fm: FMVoice, pluck: PluckVoice, partials: PartialVoice };

/**
 * 音符の列を楽器で鳴らしてステレオのバッファに足す。
 * notes: [{ s: 開始サンプル, len: 長さサンプル, m: MIDI, v: 強さ0〜1, glideFrom? }]
 */
export function renderNotes(inst, notes, L, R, sr, seed = 1, onProgress) {
  const V = VOICES[inst.type || 'synth'];
  if (!V) throw new Error(`不明な音源: ${inst.type}`);
  const maxTail = Math.round((inst.tail ?? 12) * sr);
  const total = L.length;
  let prev = null;
  notes.forEach((nt, k) => {
    if (nt.s >= total) return;
    // モノフォニック（mono:true）：前の音から滑らかにつなぐ
    const glideFrom = inst.mono && prev && prev.s + prev.len >= nt.s - sr * 0.01 ? prev.m : undefined;
    const voice = new V(sr, inst, nt.m + (inst.transpose ?? 0), nt.v, seed + k * 7919, glideFrom);
    let pos = nt.s;
    // 鳴っている間
    const on = Math.min(nt.len, total - pos);
    for (let done = 0; done < on;) {
      const c = Math.min(4096, on - done);
      voice.render(L, R, pos + done, c);
      done += c;
      if (voice.done) break;
    }
    pos += on;
    voice.release();
    // 余韻
    for (let t = 0; t < maxTail && pos < total && !voice.done;) {
      const c = Math.min(2048, total - pos);
      voice.render(L, R, pos, c);
      pos += c;
      t += c;
    }
    prev = nt;
    if (onProgress && k % 16 === 0) onProgress(k / notes.length);
  });
}
