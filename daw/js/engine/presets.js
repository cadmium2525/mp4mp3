/*
 * かなでる：楽器のプリセットとドラムキット。
 * トラックの inst に名前（"piano"）を書くか、{ preset: "piano", amp: {...} } のように一部だけ変えて使う。
 * fx はそのプリセットに合うエフェクト（トラックの fx の前にかかる）。
 */
import { LEVELS } from './levels.js';

export const INST_CATEGORIES = [
  { id: 'keys', label: 'ピアノ・キー' },
  { id: 'mallet', label: 'マレット・ベル' },
  { id: 'pluck', label: '弦・プラック' },
  { id: 'pad', label: 'パッド・ストリングス' },
  { id: 'bass', label: 'ベース' },
  { id: 'lead', label: 'リード・ブラス' },
  { id: 'orch', label: 'オーケストラ・管楽器' },
  { id: 'wa', label: '和楽器・民族楽器' },
];

export const INST_PRESETS = {
  /* ---------- ピアノ・キー ---------- */
  piano: { cat: 'keys', label: 'グランドピアノ', type: 'partials', piano: true, hammer: 0.35, bright: 0.55, sustain: 7, amp: { a: 0.001, d: 60, s: 1, r: 0.4 }, gain: -4, spread: 0.5,
    fx: [{ type: 'eq', bands: [{ type: 'hp', freq: 35 }, { type: 'peak', freq: 250, gain: -1.5, q: 1 }, { type: 'highshelf', freq: 6000, gain: 1.5 }] }] },
  softpiano: { cat: 'keys', label: 'やわらかいピアノ', type: 'partials', piano: true, hammer: 0.15, bright: 0.2, sustain: 8, amp: { a: 0.003, d: 60, s: 1, r: 0.5 }, gain: -3, spread: 0.5,
    fx: [{ type: 'eq', bands: [{ type: 'hp', freq: 40 }, { type: 'lp', freq: 4500 }, { type: 'peak', freq: 300, gain: 1, q: 0.8 }] }] },
  epiano: { cat: 'keys', label: 'エレピ（ローズ風）', type: 'fm', gain: -6, spread: 0.4, drift: 3,
    ops: [
      { ratio: 1, level: 1, amp: { a: 0.002, d: 2.8, s: 0, r: 0.35, curve: 2.5 }, vel: 0.3 },
      { ratio: 1, level: 1.3, amp: { a: 0.001, d: 1.4, s: 0.15, r: 0.3 }, vel: 0.9 },
      { ratio: 1, detune: 0.7, level: 0.45, amp: { a: 0.002, d: 2.2, s: 0, r: 0.35 } },
      { ratio: 14, level: 0.9, amp: { a: 0.0005, d: 0.12, s: 0, r: 0.1 }, vel: 1 },
    ],
    mods: [[1], [], [3], []], out: [0, 2],
    fx: [{ type: 'tremolo', rate: 4.5, depth: 0.18, stereo: 1 }, { type: 'chorus', rate: 0.5, mix: 0.3 }, { type: 'eq', bands: [{ type: 'hp', freq: 60 }, { type: 'peak', freq: 900, gain: 1.5, q: 0.7 }] }] },
  organ: { cat: 'keys', label: 'オルガン', type: 'partials', partials: [[0.5, 0, 0.55], [1, 0, 1], [1.5, 0, 0.45], [2, 0, 0.65], [3, 0, 0.3], [4, 0, 0.3], [6, 0, 0.08], [8, 0, 0.12]], mallet: 1, randomPhase: true,
    amp: { a: 0.006, d: 1, s: 1, r: 0.06 }, gain: -10, hammer: 0.08,
    fx: [{ type: 'chorus', rate: 5.8, depth: 0.0012, delay: 0.004, mix: 0.45 }, { type: 'dist', drive: 4, kind: 'tape', mix: 0.4 }] },
  bellkeys: { cat: 'keys', label: 'ベルキー（FM）', type: 'fm', gain: -6, spread: 0.3,
    ops: [{ ratio: 1, level: 1, amp: { a: 0.002, d: 2.5, s: 0, r: 0.6 } }, { ratio: 1, level: 0.7, amp: { a: 0.001, d: 1.6, s: 0.1, r: 0.5 }, vel: 0.6 }, { ratio: 7, level: 1.1, amp: { a: 0.001, d: 0.45, s: 0, r: 0.3 }, vel: 0.9 }],
    mods: [[1, 2], [], []],
    fx: [{ type: 'chorus', mix: 0.25 }] },
  chordstab: { cat: 'keys', label: 'コードスタブ', type: 'synth', osc: [{ wave: 'supersaw', detune: 18 }], filter: { cutoff: 900, env: 3.2, q: 1, keytrack: 0.3 }, fenv: { a: 0.002, d: 0.22, s: 0.1, r: 0.2 }, amp: { a: 0.002, d: 0.35, s: 0.2, r: 0.18 }, gain: -10,
    fx: [{ type: 'eq', bands: [{ type: 'hp', freq: 180 }] }] },

  /* ---------- マレット・ベル ---------- */
  marimba: { cat: 'mallet', label: 'マリンバ', type: 'partials', partials: [[1, 0.55, 1], [3.99, 0.12, 0.4], [10.65, 0.035, 0.15]], mallet: 0.55, decayScale: 0.5, amp: { a: 0.001, d: 10, s: 1, r: 0.25 }, gain: -2, spread: 0.6, hammer: 0.15 },
  vibraphone: { cat: 'mallet', label: 'ビブラフォン', type: 'partials', partials: [[1, 3, 1], [4, 0.7, 0.25], [10, 0.15, 0.06]], mallet: 0.5, decayScale: 0.3, tremolo: { rate: 5.2, depth: 0.35 }, amp: { a: 0.001, d: 10, s: 1, r: 0.6 }, gain: -4, spread: 0.5 },
  glock: { cat: 'mallet', label: 'グロッケン', type: 'partials', partials: [[1, 1.6, 1], [2.76, 0.5, 0.35], [5.4, 0.2, 0.15], [8.93, 0.1, 0.08]], mallet: 0.7, decayScale: 0.4, amp: { a: 0.0008, d: 10, s: 1, r: 1 }, gain: -6, spread: 0.4 },
  musicbox: { cat: 'mallet', label: 'オルゴール', type: 'partials', partials: [[1, 1.4, 1], [2, 0.5, 0.12], [3.02, 0.35, 0.14], [5.98, 0.12, 0.08], [8.1, 0.06, 0.05]], mallet: 0.8, decayScale: 0.45, amp: { a: 0.0008, d: 10, s: 1, r: 1.2 }, gain: -6, spread: 0.4, drift: 6 },
  kalimba: { cat: 'mallet', label: 'カリンバ', type: 'partials', partials: [[1, 1.1, 1], [5.4, 0.09, 0.35], [10.9, 0.04, 0.12]], mallet: 0.6, decayScale: 0.35, amp: { a: 0.001, d: 10, s: 1, r: 0.5 }, gain: -3, spread: 0.4, hammer: 0.1 },
  tubular: { cat: 'mallet', label: 'チューブラーベル', type: 'partials', partials: [[0.5, 4, 0.25], [1, 5, 1], [1.19, 3, 0.4], [1.56, 2.4, 0.35], [2, 2, 0.3], [2.51, 1.2, 0.2], [3.01, 0.8, 0.12]], mallet: 0.8, amp: { a: 0.001, d: 10, s: 1, r: 2 }, gain: -8 },
  celesta: { cat: 'mallet', label: 'チェレスタ', type: 'partials', partials: [[1, 1.2, 1], [2, 0.4, 0.3], [3, 0.2, 0.1], [4.1, 0.1, 0.06]], mallet: 0.6, decayScale: 0.4, amp: { a: 0.001, d: 10, s: 1, r: 0.6 }, gain: -6, spread: 0.4 },

  /* ---------- 弦・プラック ---------- */
  guitar: { cat: 'pluck', label: 'アコースティックギター', type: 'pluck', bright: 0.5, decay: 3.2, pick: 0.13, body: 0.8, gain: 2, spread: 0.3,
    fx: [{ type: 'eq', bands: [{ type: 'hp', freq: 80 }, { type: 'peak', freq: 2500, gain: 2, q: 1 }] }] },
  nylon: { cat: 'pluck', label: 'ナイロンギター', type: 'pluck', bright: 0.28, decay: 2.6, pick: 0.2, body: 1, gain: 3, spread: 0.3, fx: [{ type: 'eq', bands: [{ type: 'hp', freq: 70 }] }] },
  harp: { cat: 'pluck', label: 'ハープ', type: 'pluck', bright: 0.35, decay: 5, pick: 0.45, gain: 2, spread: 0.6, release: 2 },
  koto: { cat: 'pluck', label: '琴', type: 'pluck', bright: 0.75, decay: 2.4, pick: 0.07, body: 0.4, gain: 1, spread: 0.3,
    fx: [{ type: 'eq', bands: [{ type: 'hp', freq: 120 }, { type: 'peak', freq: 3000, gain: 3, q: 1.2 }] }] },
  pluck: { cat: 'pluck', label: 'シンセプラック', type: 'synth', osc: [{ wave: 'saw', voices: 3, detune: 10 }, { wave: 'square', semi: 12, level: 0.3 }], filter: { cutoff: 500, env: 4.2, q: 1.2, keytrack: 0.6 }, fenv: { a: 0.001, d: 0.16, s: 0, r: 0.2 }, amp: { a: 0.001, d: 0.4, s: 0, r: 0.25 }, gain: -6 },
  ebass: { cat: 'bass', label: 'エレキベース（指弾き）', type: 'pluck', bright: 0.22, decay: 2.6, pick: 0.22, gain: 6, mono: true, release: 0.08,
    fx: [{ type: 'eq', bands: [{ type: 'hp', freq: 32 }, { type: 'lp', freq: 3500 }, { type: 'peak', freq: 700, gain: 2, q: 1 }] }, { type: 'comp', threshold: -18, ratio: 4, attack: 0.01, release: 0.12, makeup: 3 }] },

  /* ---------- パッド・ストリングス ---------- */
  pad: { cat: 'pad', label: 'あたたかいパッド', type: 'synth', osc: [{ wave: 'supersaw', detune: 16, voices: 7 }, { wave: 'saw', semi: -12, level: 0.35, voices: 2, detune: 8 }], filter: { cutoff: 1300, env: 0.8, q: 0.7, keytrack: 0.4 }, fenv: { a: 1.2, d: 2, s: 0.6, r: 1.5 }, amp: { a: 0.7, d: 1, s: 0.9, r: 1.6 }, gain: -12,
    fx: [{ type: 'eq', bands: [{ type: 'hp', freq: 150 }] }, { type: 'chorus', mix: 0.35 }] },
  darkpad: { cat: 'pad', label: '暗いパッド', type: 'synth', osc: [{ wave: 'supersaw', detune: 12, voices: 5 }, { wave: 'tri', semi: -12, level: 0.5 }], filter: { cutoff: 600, env: 0.6, q: 1, keytrack: 0.3 }, fenv: { a: 2, d: 3, s: 0.5, r: 2 }, amp: { a: 1.2, d: 1, s: 0.9, r: 2.2 }, gain: -10,
    lfo: { to: 'cutoff', rate: 0.15, amt: 0.4 }, fx: [{ type: 'eq', bands: [{ type: 'hp', freq: 100 }] }, { type: 'chorus', mix: 0.4 }] },
  airpad: { cat: 'pad', label: '空気感のあるパッド', type: 'synth', osc: [{ wave: 'supersaw', detune: 24, voices: 7 }], noise: 0.08, noiseColor: 'pink', filter: { type: 'bp', cutoff: 2200, env: 0.5, q: 0.6, keytrack: 0.5 }, fenv: { a: 2, d: 2, s: 0.7, r: 2 }, amp: { a: 1.5, d: 1, s: 0.9, r: 2.5 }, gain: -12,
    fx: [{ type: 'eq', bands: [{ type: 'hp', freq: 300 }] }, { type: 'chorus', mix: 0.5 }] },
  strings: { cat: 'pad', label: 'ストリングス', type: 'synth', osc: [{ wave: 'saw', voices: 5, detune: 12, spread: 0.9 }, { wave: 'saw', voices: 3, detune: 7, semi: 12, level: 0.25 }], filter: { cutoff: 2600, env: 0.6, q: 0.6, keytrack: 0.6, vel: 1.2 }, fenv: { a: 0.35, d: 1, s: 0.8, r: 0.8 }, amp: { a: 0.28, d: 0.5, s: 0.95, r: 0.7 }, vibrato: { rate: 5.3, depth: 0.08, delay: 0.35 }, gain: -10,
    fx: [{ type: 'eq', bands: [{ type: 'hp', freq: 120 }, { type: 'peak', freq: 350, gain: -2, q: 0.8 }, { type: 'peak', freq: 2800, gain: 1.5, q: 0.8 }] }, { type: 'chorus', rate: 0.35, mix: 0.3 }] },
  pizz: { cat: 'pad', label: 'ピチカート', type: 'pluck', bright: 0.3, decay: 0.6, pick: 0.3, body: 0.7, gain: 4, spread: 0.5 },
  choir: { cat: 'pad', label: 'クワイア（あー）', type: 'synth', osc: [{ wave: 'saw', voices: 5, detune: 14 }], formant: 'a', filter: { cutoff: 5000, q: 0.5 }, amp: { a: 0.45, d: 1, s: 0.95, r: 0.9 }, vibrato: { rate: 5, depth: 0.12, delay: 0.3 }, gain: -2,
    fx: [{ type: 'eq', bands: [{ type: 'hp', freq: 150 }] }, { type: 'chorus', mix: 0.4 }] },
  choiroo: { cat: 'pad', label: 'クワイア（うー）', type: 'synth', osc: [{ wave: 'saw', voices: 5, detune: 14 }], formant: 'u', filter: { cutoff: 4000, q: 0.5 }, amp: { a: 0.5, d: 1, s: 0.95, r: 1 }, vibrato: { rate: 5, depth: 0.1, delay: 0.3 }, gain: 4,
    fx: [{ type: 'eq', bands: [{ type: 'hp', freq: 120 }] }, { type: 'chorus', mix: 0.4 }] },
  glasspad: { cat: 'pad', label: 'ガラスパッド', type: 'fm', gain: -8, ops: [{ ratio: 1, level: 1, amp: { a: 0.6, d: 2, s: 0.8, r: 1.8 } }, { ratio: 2.01, level: 0.9, amp: { a: 0.9, d: 3, s: 0.5, r: 1.5 } }], vibrato: { rate: 4.5, depth: 0.05 },
    fx: [{ type: 'chorus', mix: 0.5 }] },

  /* ---------- ベース ---------- */
  subbass: { cat: 'bass', label: 'サブベース', type: 'synth', osc: [{ wave: 'sine' }, { wave: 'tri', level: 0.18 }], filter: { cutoff: 900, q: 0.5, keytrack: 0 }, amp: { a: 0.006, d: 0.5, s: 1, r: 0.08 }, gain: -2, mono: true, glide: 0.04 },
  synthbass: { cat: 'bass', label: 'シンセベース', type: 'synth', osc: [{ wave: 'saw' }, { wave: 'square', semi: -12, level: 0.5 }], filter: { cutoff: 260, env: 2.6, q: 1.6, keytrack: 0.4, poles: 4, drive: 4 }, fenv: { a: 0.002, d: 0.22, s: 0.25, r: 0.1 }, amp: { a: 0.002, d: 0.4, s: 0.85, r: 0.07 }, gain: -6, mono: true, glide: 0.03,
    fx: [{ type: 'eq', bands: [{ type: 'hp', freq: 30 }] }] },
  reese: { cat: 'bass', label: 'リースベース', type: 'synth', osc: [{ wave: 'saw', voices: 2, detune: 22, spread: 0.2 }, { wave: 'sine', semi: -12, level: 0.6 }], filter: { cutoff: 500, env: 0.6, q: 0.9, poles: 4 }, fenv: { a: 0.01, d: 0.5, s: 0.6, r: 0.2 }, amp: { a: 0.004, d: 0.3, s: 1, r: 0.1 }, gain: -8, mono: true,
    lfo: { to: 'cutoff', rate: 0.25, amt: 0.6 }, fx: [{ type: 'dist', drive: 6, kind: 'tape', mix: 0.5 }, { type: 'widen', amount: 1.3, lowmono: 160 }] },
  bass808: { cat: 'bass', label: '808 ベース', type: 'synth', osc: [{ wave: 'sine' }], pitchEnv: { amt: 7, time: 0.025 }, filter: { cutoff: 5000, q: 0.5, drive: 6 }, amp: { a: 0.002, d: 1.6, s: 0.55, r: 0.25 }, gain: -2, mono: true, glide: 0.08,
    fx: [{ type: 'dist', drive: 8, kind: 'soft', mix: 0.35, tone: 3000 }] },
  fmbass: { cat: 'bass', label: 'FM ベース', type: 'fm', gain: -4, mono: true, ops: [{ ratio: 1, level: 1, amp: { a: 0.002, d: 0.6, s: 0.6, r: 0.08 } }, { ratio: 1, level: 1.6, amp: { a: 0.001, d: 0.25, s: 0.2, r: 0.08 }, vel: 0.8, fb: 0.2 }] },
  pluckbass: { cat: 'bass', label: 'プラックベース', type: 'synth', osc: [{ wave: 'saw' }, { wave: 'sine', semi: -12, level: 0.6 }], filter: { cutoff: 200, env: 3.2, q: 1.4, poles: 4 }, fenv: { a: 0.001, d: 0.12, s: 0.05, r: 0.1 }, amp: { a: 0.001, d: 0.35, s: 0.4, r: 0.08 }, gain: -5, mono: true },

  /* ---------- リード・ブラス ---------- */
  sawlead: { cat: 'lead', label: 'のこぎり波リード', type: 'synth', osc: [{ wave: 'saw', voices: 3, detune: 9, spread: 0.4 }, { wave: 'square', semi: -12, level: 0.25 }], filter: { cutoff: 2200, env: 1.4, q: 1.1, keytrack: 0.6 }, fenv: { a: 0.005, d: 0.4, s: 0.6, r: 0.2 }, amp: { a: 0.006, d: 0.3, s: 0.85, r: 0.18 }, vibrato: { rate: 5.6, depth: 0.12, delay: 0.3 }, gain: -10, mono: true, glide: 0.05 },
  squarelead: { cat: 'lead', label: '矩形波リード', type: 'synth', osc: [{ wave: 'pulse', pw: 0.35 }, { wave: 'pulse', pw: 0.5, cents: 7, level: 0.6 }], filter: { cutoff: 3200, env: 0.8, q: 0.8, keytrack: 0.5 }, amp: { a: 0.004, d: 0.3, s: 0.85, r: 0.15 }, vibrato: { rate: 5.5, depth: 0.1, delay: 0.25 }, gain: -10, mono: true, glide: 0.04 },
  softlead: { cat: 'lead', label: 'やわらかいリード', type: 'synth', osc: [{ wave: 'tri' }, { wave: 'sine', semi: 12, level: 0.25 }], noise: 0.015, noiseColor: 'pink', filter: { cutoff: 4000, q: 0.6 }, amp: { a: 0.03, d: 0.3, s: 0.9, r: 0.25 }, vibrato: { rate: 5.2, depth: 0.12, delay: 0.25 }, gain: -4, mono: true, glide: 0.06 },
  chip: { cat: 'lead', label: 'ピコピコ（8bit）', type: 'synth', osc: [{ wave: 'pulse', pw: 0.25 }], filter: { cutoff: 12000, q: 0.5, keytrack: 0 }, amp: { a: 0.002, d: 0.2, s: 0.7, r: 0.05 }, vibrato: { rate: 6, depth: 0.15, delay: 0.2 }, gain: -12 },
  flute: { cat: 'lead', label: 'フルート風', type: 'synth', osc: [{ wave: 'sine' }, { wave: 'tri', semi: 12, level: 0.12 }], noise: 0.05, noiseColor: 'pink', filter: { cutoff: 3000, q: 0.6, keytrack: 0.8 }, amp: { a: 0.06, d: 0.3, s: 0.9, r: 0.18 }, vibrato: { rate: 5, depth: 0.12, delay: 0.3, fade: 0.4 }, gain: -2, mono: true, glide: 0.03 },
  brass: { cat: 'lead', label: 'ブラス', type: 'synth', osc: [{ wave: 'saw', voices: 3, detune: 8 }], filter: { cutoff: 500, env: 2.6, q: 0.8, keytrack: 0.6, vel: 1.4 }, fenv: { a: 0.07, d: 0.5, s: 0.55, r: 0.2 }, amp: { a: 0.035, d: 0.4, s: 0.9, r: 0.2 }, vibrato: { rate: 5, depth: 0.06, delay: 0.4 }, gain: -10,
    fx: [{ type: 'eq', bands: [{ type: 'hp', freq: 90 }, { type: 'peak', freq: 1200, gain: 2, q: 0.8 }] }] },
  supersaw: { cat: 'lead', label: 'スーパーソウ（EDM）', type: 'synth', osc: [{ wave: 'supersaw', detune: 28, voices: 9, spread: 1 }, { wave: 'saw', semi: -12, level: 0.3 }], filter: { cutoff: 5000, env: 0.6, q: 0.6, keytrack: 0.3 }, amp: { a: 0.004, d: 0.3, s: 0.9, r: 0.25 }, gain: -12,
    fx: [{ type: 'eq', bands: [{ type: 'hp', freq: 200 }] }] },

  /* ---------- 追加：キー ---------- */
  honkytonk: { cat: 'keys', label: 'ホンキートンク（酒場のピアノ）', type: 'partials', piano: true, hammer: 0.5, bright: 0.7, sustain: 5, amp: { a: 0.001, d: 60, s: 1, r: 0.3 }, gain: -4, spread: 0.5, drift: 14,
    fx: [{ type: 'chorus', rate: 0.9, depth: 0.0022, mix: 0.45 }, { type: 'eq', bands: [{ type: 'hp', freq: 60 }, { type: 'peak', freq: 1800, gain: 3, q: 0.9 }] }] },
  toypiano: { cat: 'keys', label: 'トイピアノ', type: 'partials', partials: [[1, 0.5, 1], [3.02, 0.18, 0.5], [5.4, 0.1, 0.35], [8.2, 0.05, 0.2]], mallet: 0.9, decayScale: 0.3, amp: { a: 0.0008, d: 10, s: 1, r: 0.2 }, gain: -4, hammer: 0.35, drift: 8, spread: 0.3 },
  harpsichord: { cat: 'keys', label: 'チェンバロ', type: 'pluck', bright: 0.95, decay: 1.6, pick: 0.06, gain: 0, spread: 0.4, release: 0.08,
    fx: [{ type: 'eq', bands: [{ type: 'hp', freq: 100 }, { type: 'peak', freq: 3500, gain: 4, q: 0.8 }] }] },
  clavinet: { cat: 'keys', label: 'クラビネット', type: 'pluck', bright: 0.8, decay: 0.9, pick: 0.1, gain: 2, release: 0.05,
    fx: [{ type: 'eq', bands: [{ type: 'hp', freq: 120 }, { type: 'peak', freq: 1100, gain: 6, q: 1.4 }] }, { type: 'dist', drive: 6, kind: 'tape', mix: 0.5 }] },
  accordion: { cat: 'keys', label: 'アコーディオン', type: 'synth', osc: [{ wave: 'pulse', pw: 0.32 }, { wave: 'pulse', pw: 0.32, cents: 11, level: 0.8 }, { wave: 'pulse', pw: 0.4, semi: 12, cents: -6, level: 0.35 }], filter: { cutoff: 2600, q: 0.6, keytrack: 0.5, vel: 0.6 }, amp: { a: 0.05, d: 0.2, s: 0.95, r: 0.12 }, gain: -12,
    lfo: { to: 'amp', rate: 5.2, amt: 0.08 }, fx: [{ type: 'eq', bands: [{ type: 'hp', freq: 120 }, { type: 'peak', freq: 900, gain: 3, q: 0.8 }] }] },
  harmonica: { cat: 'keys', label: 'ハーモニカ', type: 'synth', osc: [{ wave: 'pulse', pw: 0.22 }, { wave: 'saw', level: 0.3 }], noise: 0.03, noiseColor: 'pink', filter: { type: 'bp', cutoff: 1500, q: 0.9, keytrack: 0.7 }, amp: { a: 0.04, d: 0.2, s: 0.9, r: 0.1 }, pitchEnv: { amt: -0.5, time: 0.05 }, vibrato: { rate: 5.5, depth: 0.2, delay: 0.25 }, gain: -6, mono: true,
    fx: [{ type: 'eq', bands: [{ type: 'hp', freq: 250 }, { type: 'peak', freq: 2400, gain: 4, q: 1 }] }] },

  /* ---------- 追加：マレット ---------- */
  steeldrum: { cat: 'mallet', label: 'スチールドラム', type: 'partials', partials: [[1, 0.9, 1], [2, 0.7, 0.75], [3.01, 0.35, 0.3], [4.02, 0.25, 0.25], [6.1, 0.1, 0.1]], mallet: 0.75, decayScale: 0.35, tremolo: { rate: 6.5, depth: 0.12 }, amp: { a: 0.001, d: 10, s: 1, r: 0.4 }, gain: -5, spread: 0.5, hammer: 0.1 },

  /* ---------- 追加：パッド ---------- */
  bellpad: { cat: 'pad', label: 'ベルパッド', type: 'fm', gain: -8, spread: 0.4, ops: [{ ratio: 1, level: 1, amp: { a: 0.25, d: 3, s: 0.6, r: 2 } }, { ratio: 4, level: 0.9, amp: { a: 0.01, d: 1.2, s: 0.1, r: 1.5 }, vel: 0.5 }, { ratio: 1.005, level: 0.5, amp: { a: 0.8, d: 2, s: 0.7, r: 2 } }], mods: [[1], [], []], out: [0, 2],
    fx: [{ type: 'chorus', mix: 0.45 }] },
  stringmachine: { cat: 'pad', label: 'ストリングマシン（70年代）', type: 'synth', osc: [{ wave: 'saw', voices: 3, detune: 16 }, { wave: 'pulse', pw: 0.4, semi: 12, level: 0.3 }], filter: { cutoff: 3200, q: 0.5, keytrack: 0.5 }, amp: { a: 0.18, d: 0.5, s: 0.95, r: 0.6 }, gain: -12,
    fx: [{ type: 'eq', bands: [{ type: 'hp', freq: 180 }] }, { type: 'chorus', rate: 0.7, depth: 0.005, mix: 0.6 }, { type: 'phaser', rate: 0.25, mix: 0.3 }] },
  futurebass: { cat: 'pad', label: 'フューチャーベース（うねる和音）', type: 'synth', osc: [{ wave: 'supersaw', detune: 26, voices: 9, spread: 1 }, { wave: 'square', semi: 12, level: 0.2 }], filter: { cutoff: 1400, env: 1.2, q: 0.9, keytrack: 0.3 }, fenv: { a: 0.01, d: 0.4, s: 0.5, r: 0.3 }, amp: { a: 0.01, d: 0.3, s: 0.9, r: 0.3 }, lfo: { to: 'cutoff', sync: '1/8', amt: 1.4, phase: -1.57 }, gain: -12,
    fx: [{ type: 'eq', bands: [{ type: 'hp', freq: 180 }] }] },

  /* ---------- 追加：ベース ---------- */
  acid: { cat: 'bass', label: 'アシッドベース（303 風）', type: 'synth', osc: [{ wave: 'saw' }], filter: { cutoff: 220, env: 3.6, q: 6, keytrack: 0.3, poles: 4, drive: 6, vel: 2.5 }, fenv: { a: 0.002, d: 0.18, s: 0.05, r: 0.1 }, amp: { a: 0.002, d: 0.3, s: 0.7, r: 0.06 }, gain: -14, mono: true, glide: 0.07,
    fx: [{ type: 'dist', drive: 8, kind: 'soft', mix: 0.6, tone: 6000 }, { type: 'eq', bands: [{ type: 'hp', freq: 35 }] }] },
  wobble: { cat: 'bass', label: 'ワブルベース', type: 'synth', osc: [{ wave: 'saw', voices: 2, detune: 14, spread: 0.2 }, { wave: 'square', semi: -12, level: 0.7 }], filter: { cutoff: 420, q: 2.4, keytrack: 0.2, poles: 4, drive: 5 }, amp: { a: 0.004, d: 0.3, s: 1, r: 0.08 }, lfo: { to: 'cutoff', sync: '1/8', amt: 2.2 }, gain: -8, mono: true,
    fx: [{ type: 'dist', drive: 8, kind: 'tape', mix: 0.5 }, { type: 'widen', amount: 1.2, lowmono: 150 }] },
  upright: { cat: 'bass', label: 'ウッドベース', type: 'pluck', bright: 0.16, decay: 1.8, pick: 0.3, body: 1.2, gain: 8, mono: true, release: 0.12,
    fx: [{ type: 'eq', bands: [{ type: 'hp', freq: 35 }, { type: 'lp', freq: 2600 }, { type: 'peak', freq: 180, gain: 3, q: 1 }, { type: 'peak', freq: 900, gain: 2, q: 1.2 }] }] },
  slapbass: { cat: 'bass', label: 'スラップベース', type: 'pluck', bright: 0.7, decay: 1.2, pick: 0.08, gain: 4, mono: true, release: 0.05,
    fx: [{ type: 'eq', bands: [{ type: 'hp', freq: 35 }, { type: 'peak', freq: 500, gain: -4, q: 1 }, { type: 'peak', freq: 2800, gain: 5, q: 1 }] }, { type: 'comp', threshold: -20, ratio: 5, attack: 0.004, release: 0.1, makeup: 4 }] },

  /* ---------- 追加：リード ---------- */
  theremin: { cat: 'lead', label: 'テルミン', type: 'synth', osc: [{ wave: 'sine' }, { wave: 'tri', level: 0.12 }], filter: { cutoff: 5000, q: 0.5 }, amp: { a: 0.09, d: 0.3, s: 0.95, r: 0.25 }, vibrato: { rate: 6, depth: 0.35, delay: 0.1, fade: 0.3 }, gain: -4, mono: true, glide: 0.14 },
  whistle: { cat: 'lead', label: '口笛', type: 'synth', osc: [{ wave: 'sine' }], noise: 0.035, noiseColor: 'pink', filter: { type: 'bp', cutoff: 1800, q: 1.2, keytrack: 1 }, amp: { a: 0.05, d: 0.2, s: 0.9, r: 0.12 }, pitchEnv: { amt: -0.7, time: 0.05 }, vibrato: { rate: 5.5, depth: 0.14, delay: 0.3 }, gain: 2, mono: true, glide: 0.04 },
  voxlead: { cat: 'lead', label: 'ボイスリード（おー）', type: 'synth', osc: [{ wave: 'saw', voices: 2, detune: 7 }], formant: 'o', filter: { cutoff: 4500, q: 0.5 }, amp: { a: 0.06, d: 0.3, s: 0.9, r: 0.2 }, vibrato: { rate: 5.4, depth: 0.2, delay: 0.25 }, gain: 2, mono: true, glide: 0.07 },
  synthbrass: { cat: 'lead', label: 'シンセブラス（80年代）', type: 'synth', osc: [{ wave: 'saw', voices: 4, detune: 14 }, { wave: 'saw', semi: -12, level: 0.4 }], filter: { cutoff: 700, env: 2.8, q: 0.8, keytrack: 0.5, vel: 1.5 }, fenv: { a: 0.05, d: 0.35, s: 0.5, r: 0.2 }, amp: { a: 0.02, d: 0.3, s: 0.9, r: 0.2 }, gain: -10,
    fx: [{ type: 'eq', bands: [{ type: 'hp', freq: 100 }] }, { type: 'chorus', mix: 0.25 }] },
  edmlead: { cat: 'lead', label: 'EDM リード（鋭い）', type: 'synth', osc: [{ wave: 'supersaw', detune: 18, voices: 7, spread: 0.7 }, { wave: 'pulse', pw: 0.3, level: 0.5 }, { wave: 'saw', semi: 12, level: 0.25 }], filter: { cutoff: 6500, env: 0.8, q: 1, keytrack: 0.4 }, amp: { a: 0.003, d: 0.2, s: 0.85, r: 0.12 }, gain: -12, mono: true, glide: 0.03,
    fx: [{ type: 'eq', bands: [{ type: 'hp', freq: 220 }, { type: 'highshelf', freq: 7000, gain: 2 }] }, { type: 'dist', drive: 5, kind: 'soft', mix: 0.4 }] },

  /* ---------- オーケストラ・管楽器 ---------- */
  violin: { cat: 'orch', label: 'バイオリン（ソロ）', type: 'synth', osc: [{ wave: 'saw' }, { wave: 'saw', cents: 5, level: 0.35 }], noise: 0.012, noiseColor: 'pink', filter: { cutoff: 3200, env: 0.5, q: 0.7, keytrack: 0.6, vel: 1.2 }, fenv: { a: 0.12, d: 0.6, s: 0.8, r: 0.3 }, amp: { a: 0.09, d: 0.3, s: 0.92, r: 0.22 }, pitchEnv: { amt: -0.25, time: 0.06 }, vibrato: { rate: 5.8, depth: 0.22, delay: 0.22, fade: 0.35 }, gain: -8, mono: true, glide: 0.035,
    fx: [{ type: 'eq', bands: [{ type: 'hp', freq: 190 }, { type: 'peak', freq: 290, gain: 3, q: 2 }, { type: 'peak', freq: 520, gain: 2, q: 2 }, { type: 'peak', freq: 2800, gain: 4, q: 0.9 }, { type: 'lp', freq: 9000 }] }] },
  cello: { cat: 'orch', label: 'チェロ（ソロ）', type: 'synth', osc: [{ wave: 'saw' }, { wave: 'saw', cents: 4, level: 0.3 }], noise: 0.01, noiseColor: 'pink', filter: { cutoff: 1500, env: 0.5, q: 0.7, keytrack: 0.5, vel: 1.2 }, fenv: { a: 0.15, d: 0.6, s: 0.8, r: 0.3 }, amp: { a: 0.11, d: 0.3, s: 0.92, r: 0.28 }, pitchEnv: { amt: -0.2, time: 0.07 }, vibrato: { rate: 5.2, depth: 0.16, delay: 0.3, fade: 0.4 }, gain: -6, mono: true, glide: 0.04,
    fx: [{ type: 'eq', bands: [{ type: 'hp', freq: 60 }, { type: 'peak', freq: 180, gain: 3, q: 1.6 }, { type: 'peak', freq: 400, gain: 2, q: 1.6 }, { type: 'peak', freq: 1500, gain: 2, q: 1 }, { type: 'lp', freq: 6000 }] }] },
  spiccato: { cat: 'orch', label: 'ストリングス（短く刻む）', type: 'synth', osc: [{ wave: 'saw', voices: 5, detune: 12, spread: 0.9 }], noise: 0.02, noiseColor: 'pink', filter: { cutoff: 2000, env: 2, q: 0.6, keytrack: 0.5, vel: 1.5 }, fenv: { a: 0.004, d: 0.12, s: 0.1, r: 0.12 }, amp: { a: 0.006, d: 0.16, s: 0.0, r: 0.14 }, gain: -6,
    fx: [{ type: 'eq', bands: [{ type: 'hp', freq: 110 }, { type: 'peak', freq: 2600, gain: 2, q: 0.8 }] }] },
  trumpet: { cat: 'orch', label: 'トランペット', type: 'synth', osc: [{ wave: 'saw' }, { wave: 'pulse', pw: 0.2, level: 0.35 }], filter: { cutoff: 900, env: 2.2, q: 1, keytrack: 0.6, vel: 2 }, fenv: { a: 0.035, d: 0.3, s: 0.65, r: 0.15 }, amp: { a: 0.025, d: 0.2, s: 0.9, r: 0.12 }, pitchEnv: { amt: -0.4, time: 0.03 }, vibrato: { rate: 5.4, depth: 0.1, delay: 0.4 }, gain: -8, mono: true,
    fx: [{ type: 'eq', bands: [{ type: 'hp', freq: 160 }, { type: 'peak', freq: 1400, gain: 4, q: 1 }, { type: 'peak', freq: 2600, gain: 3, q: 1 }] }] },
  horn: { cat: 'orch', label: 'ホルン', type: 'synth', osc: [{ wave: 'saw' }, { wave: 'tri', level: 0.6 }], filter: { cutoff: 420, env: 1.6, q: 0.7, keytrack: 0.5, vel: 1.8 }, fenv: { a: 0.08, d: 0.5, s: 0.6, r: 0.25 }, amp: { a: 0.06, d: 0.3, s: 0.92, r: 0.25 }, pitchEnv: { amt: -0.3, time: 0.05 }, gain: -4,
    fx: [{ type: 'eq', bands: [{ type: 'hp', freq: 80 }, { type: 'peak', freq: 450, gain: 3, q: 1 }] }] },
  trombone: { cat: 'orch', label: 'トロンボーン', type: 'synth', osc: [{ wave: 'saw' }, { wave: 'pulse', pw: 0.3, level: 0.25 }], filter: { cutoff: 600, env: 2, q: 0.9, keytrack: 0.5, vel: 2 }, fenv: { a: 0.05, d: 0.35, s: 0.6, r: 0.18 }, amp: { a: 0.035, d: 0.25, s: 0.9, r: 0.15 }, pitchEnv: { amt: -0.5, time: 0.05 }, gain: -7, mono: true, glide: 0.09,
    fx: [{ type: 'eq', bands: [{ type: 'hp', freq: 70 }, { type: 'peak', freq: 700, gain: 3, q: 1 }] }] },
  clarinet: { cat: 'orch', label: 'クラリネット', type: 'synth', osc: [{ wave: 'pulse', pw: 0.5 }], noise: 0.012, noiseColor: 'pink', filter: { cutoff: 1500, env: 0.6, q: 0.7, keytrack: 0.7, vel: 1 }, fenv: { a: 0.05, d: 0.3, s: 0.8, r: 0.15 }, amp: { a: 0.05, d: 0.2, s: 0.92, r: 0.12 }, vibrato: { rate: 5, depth: 0.05, delay: 0.5 }, gain: -8, mono: true,
    fx: [{ type: 'eq', bands: [{ type: 'hp', freq: 120 }] }] },
  oboe: { cat: 'orch', label: 'オーボエ', type: 'synth', osc: [{ wave: 'pulse', pw: 0.16 }, { wave: 'saw', level: 0.25 }], filter: { type: 'bp', cutoff: 1300, q: 0.8, keytrack: 0.6 }, amp: { a: 0.04, d: 0.2, s: 0.9, r: 0.1 }, vibrato: { rate: 5.6, depth: 0.12, delay: 0.3 }, gain: -3, mono: true,
    fx: [{ type: 'eq', bands: [{ type: 'hp', freq: 220 }, { type: 'peak', freq: 3000, gain: 3, q: 1 }] }] },
  sax: { cat: 'orch', label: 'サックス', type: 'synth', osc: [{ wave: 'saw' }, { wave: 'pulse', pw: 0.35, level: 0.5 }], noise: 0.035, noiseColor: 'pink', filter: { cutoff: 1100, env: 1.4, q: 1.6, keytrack: 0.5, vel: 2, drive: 3 }, fenv: { a: 0.04, d: 0.3, s: 0.7, r: 0.15 }, amp: { a: 0.03, d: 0.2, s: 0.9, r: 0.12 }, pitchEnv: { amt: -0.6, time: 0.05 }, vibrato: { rate: 5.2, depth: 0.16, delay: 0.3 }, gain: -8, mono: true, glide: 0.03,
    fx: [{ type: 'eq', bands: [{ type: 'hp', freq: 110 }, { type: 'peak', freq: 1000, gain: 3, q: 1 }, { type: 'peak', freq: 2400, gain: 2, q: 1 }] }] },
  timpani: { cat: 'orch', label: 'ティンパニ', type: 'partials', partials: [[1, 1.6, 1], [1.5, 1.2, 0.6], [1.99, 0.9, 0.4], [2.44, 0.6, 0.25], [2.89, 0.4, 0.15]], mallet: 0.6, amp: { a: 0.002, d: 10, s: 1, r: 0.8 }, gain: -2, hammer: 0.5, velCurve: 1.6 },
  orchhit: { cat: 'orch', label: 'オーケストラヒット', type: 'synth', osc: [{ wave: 'supersaw', detune: 20, voices: 7 }, { wave: 'saw', semi: 12, level: 0.5 }, { wave: 'saw', semi: -12, level: 0.6 }, { wave: 'saw', semi: 7, level: 0.35 }], noise: 0.12, filter: { cutoff: 1200, env: 3, q: 0.7, keytrack: 0.3 }, fenv: { a: 0.002, d: 0.25, s: 0.1, r: 0.2 }, amp: { a: 0.002, d: 0.45, s: 0, r: 0.3 }, gain: -8,
    fx: [{ type: 'reverb', size: 1.4, decay: 1.4, mix: 0.25 }] },

  /* ---------- 和楽器・民族楽器 ---------- */
  shakuhachi: { cat: 'wa', label: '尺八', type: 'synth', osc: [{ wave: 'sine' }, { wave: 'tri', semi: 12, level: 0.1 }], noise: 0.16, noiseColor: 'pink', filter: { type: 'bp', cutoff: 1200, q: 0.9, keytrack: 0.9 }, amp: { a: 0.08, d: 0.4, s: 0.85, r: 0.25 }, pitchEnv: { amt: -1.6, time: 0.09 }, vibrato: { rate: 4.6, depth: 0.3, delay: 0.35, fade: 0.5 }, gain: 4, mono: true, glide: 0.08 },
  shamisen: { cat: 'wa', label: '三味線', type: 'pluck', bright: 0.85, decay: 0.9, pick: 0.05, body: 0.3, gain: 2, release: 0.1, spread: 0.2,
    fx: [{ type: 'dist', drive: 9, kind: 'tape', mix: 0.45, tone: 7000 }, { type: 'eq', bands: [{ type: 'hp', freq: 140 }, { type: 'peak', freq: 1600, gain: 4, q: 1.2 }, { type: 'peak', freq: 4200, gain: 3, q: 1 }] }] },
  sitar: { cat: 'wa', label: 'シタール', type: 'pluck', bright: 0.9, decay: 3.5, pick: 0.04, gain: 0, release: 0.4, spread: 0.3,
    fx: [{ type: 'dist', drive: 12, kind: 'fold', mix: 0.3, tone: 8000 }, { type: 'flanger', rate: 0.2, mix: 0.3 }, { type: 'eq', bands: [{ type: 'hp', freq: 120 }, { type: 'peak', freq: 2500, gain: 4, q: 1 }] }] },
  hichiriki: { cat: 'wa', label: '篳篥（ひちりき）', type: 'synth', osc: [{ wave: 'pulse', pw: 0.12 }, { wave: 'saw', level: 0.4 }], noise: 0.04, noiseColor: 'pink', filter: { type: 'bp', cutoff: 1700, q: 1.2, keytrack: 0.6 }, amp: { a: 0.1, d: 0.3, s: 0.92, r: 0.2 }, pitchEnv: { amt: -1.2, time: 0.14 }, vibrato: { rate: 4.2, depth: 0.25, delay: 0.4 }, gain: -2, mono: true, glide: 0.12 },
};

/* ---------- ドラム：パーツごとの基準のピーク（dBFS、強さ 1 のとき） ---------- */
export const DRUM_PEAK = {
  kick: -6, kick808: -6, sub: -8, snare: -8, clap: -10, rim: -14, snap: -14, perc: -14,
  hat: -17, ohat: -17, ride: -17, crash: -14, tom1: -9, tom2: -9, tom3: -8, tom: -9, shaker: -20, tamb: -18, cowbell: -16,
  brush: -12, odaiko: -5, shime: -9, kane: -14, hyoshigi: -10,
};

/* ---------- ドラムキット：パーツごとの調整 ---------- */
export const KITS = {
  acoustic: { label: 'スタンダード', map: { kick: { punch: 0.5 }, snare: { space: 0.15 }, clap: {}, hat: {}, ohat: {}, ride: {}, crash: {} },
    fx: [{ type: 'comp', threshold: -14, ratio: 3, attack: 0.008, release: 0.12, makeup: 2 }] },
  '808': { label: '808（ヒップホップ）', map: { kick: { piece: 'kick808' }, snare: { tone: 0.2, length: 0.8 }, clap: { space: 0.2 }, hat: { pitch: 2, tone: 0.3 }, ohat: { pitch: 2 } } },
  house: { label: 'ハウス・EDM', map: { kick: { punch: 0.9, length: 0.9 }, snare: { tone: 0.3 }, clap: { space: 0.3 }, hat: { tone: 0.5 }, ohat: { tone: 0.4, length: 0.8 } },
    fx: [{ type: 'comp', threshold: -12, ratio: 4, attack: 0.005, release: 0.1, makeup: 2 }] },
  lofi: { label: 'ローファイ', map: { kick: { punch: 0.3, tone: -0.5 }, snare: { tone: -0.4, space: 0.1 }, hat: { tone: -0.6, length: 0.8 }, ohat: { tone: -0.5 }, rim: { tone: -0.3 } },
    fx: [{ type: 'eq', bands: [{ type: 'lp', freq: 7000 }, { type: 'peak', freq: 120, gain: 2, q: 1 }] }, { type: 'crush', bits: 12, rate: 2, mix: 0.4 }, { type: 'comp', threshold: -16, ratio: 3, attack: 0.01, release: 0.15, makeup: 2 }] },
  rock: { label: 'ロック', map: { kick: { punch: 1, tone: 0.3, length: 1.1 }, snare: { tone: 0.25, length: 1.3, space: 0.3, punch: 0.9 }, hat: { tone: 0.2 }, ohat: { length: 1.2 }, crash: { length: 1.2 }, tom1: { length: 1.2 }, tom2: { length: 1.2 }, tom3: { length: 1.3 } },
    fx: [{ type: 'comp', threshold: -16, ratio: 4, attack: 0.006, release: 0.1, makeup: 3 }, { type: 'dist', drive: 3, kind: 'tape', mix: 0.3 }] },
  trap: { label: 'トラップ', map: { kick: { piece: 'kick808', length: 1.3, punch: 0.7 }, snare: { tone: 0.5, length: 0.7, pitch: 2 }, clap: { space: 0.35, tone: 0.3 }, hat: { pitch: 5, tone: 0.7, length: 0.6 }, ohat: { pitch: 5, length: 0.6 }, rim: { pitch: 3 } },
    fx: [{ type: 'comp', threshold: -12, ratio: 3, attack: 0.004, release: 0.08, makeup: 2 }] },
  jazz: { label: 'ジャズ（ブラシ）', map: { kick: { punch: 0.2, tone: -0.6, length: 0.8 }, snare: { piece: 'brush' }, hat: { tone: -0.3, length: 0.8 }, ohat: { tone: -0.2 }, ride: { length: 1.3 }, crash: { tone: -0.2 } },
    fx: [{ type: 'reverb', size: 0.8, decay: 0.9, mix: 0.12 }] },
  chip: { label: '8bit（ゲーム機）', map: { kick: { piece: 'sqkick' }, snare: { piece: 'noisehit', open: 0.6 }, clap: { piece: 'noisehit', open: 0.4, pitch: 5 }, hat: { piece: 'noisehit', pitch: 12 }, ohat: { piece: 'noisehit', pitch: 12, open: 1 }, crash: { piece: 'noisehit', open: 3, pitch: 7 }, tom1: { piece: 'sqkick', pitch: 12 }, tom2: { piece: 'sqkick', pitch: 7 }, tom3: { piece: 'sqkick', pitch: 3 }, rim: { piece: 'noisehit', pitch: 18 }, shaker: { piece: 'noisehit', pitch: 16 } } },
  taiko: { label: '和太鼓', map: { kick: { piece: 'odaiko' }, tom3: { piece: 'odaiko', pitch: 3, length: 0.8 }, tom2: { piece: 'odaiko', pitch: 7, length: 0.6 }, tom1: { piece: 'shime', pitch: -5 }, snare: { piece: 'shime' }, rim: { piece: 'hyoshigi' }, hat: { piece: 'kane', length: 0.4, pitch: 2 }, ohat: { piece: 'kane' }, crash: { piece: 'kane', length: 1.6, pitch: -4 }, clap: { piece: 'hyoshigi' } },
    fx: [{ type: 'reverb', size: 1.5, decay: 1.8, mix: 0.18 }] },
  cinematic: { label: 'シネマティック', map: { kick: { piece: 'tom3', pitch: -7, length: 1.8 }, snare: { space: 0.5, length: 1.4 }, tom1: { length: 1.4 }, tom2: { length: 1.4 }, tom3: { length: 1.6 } },
    fx: [{ type: 'reverb', size: 1.8, decay: 2.5, mix: 0.25 }] },
};

/** 楽器の指定（名前 / { preset, ...上書き } / 完全な定義）を、音源に渡せる定義にする */
/** プリセットの音量をそろえる補正（tools/audition.mjs --calibrate で計算した値）を足す */
function leveled(name, p) {
  return { ...p, gain: (p.gain ?? 0) + (LEVELS[name] ?? 0) };
}

export function resolveInst(spec) {
  if (spec == null) return { ...INST_PRESETS.piano };
  if (typeof spec === 'string') {
    const p = INST_PRESETS[spec];
    if (!p) throw new Error(`不明な楽器プリセット: ${spec}`);
    return leveled(spec, p);
  }
  if (spec.preset) {
    const p = INST_PRESETS[spec.preset];
    if (!p) throw new Error(`不明な楽器プリセット: ${spec.preset}`);
    const out = leveled(spec.preset, p);
    for (const [k, v] of Object.entries(spec)) {
      if (k === 'preset') continue;
      if (k === 'gain') { out.gain += v; continue; } // gain は補正後の値に足す
      // amp や filter などは中身だけ上書きできる
      out[k] = v && typeof v === 'object' && !Array.isArray(v) && p[k] && typeof p[k] === 'object' && !Array.isArray(p[k]) ? { ...p[k], ...v } : v;
    }
    return out;
  }
  return spec;
}
