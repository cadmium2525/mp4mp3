/*
 * かなでる：新しい曲のひな形。どれも 8 小節で、そのままループしても自然につながる。
 */

const id = () => Math.random().toString(36).slice(2, 10);

/** 和音（音名の配列）を長さ d の音符の列にする */
const chord = (t, notes, d, v = 0.6) => notes.map((n) => [t, n, d, v]);

export const TEMPLATES = [
  { id: 'empty', label: '空の曲', desc: 'ピアノとドラムだけ', make: empty },
  { id: 'lofi', label: 'ローファイ', desc: 'ゆったり・作業用BGM', make: lofi },
  { id: 'pop', label: 'ポップ', desc: '明るい・Vlog向け', make: pop },
  { id: 'edm', label: 'EDM', desc: 'ノリのいい四つ打ち', make: edm },
  { id: 'cinematic', label: 'シネマ', desc: '壮大・緊張感', make: cinematic },
  { id: 'wafu', label: '和風', desc: '琴と笛・和の音階', make: wafu },
];

export function newSong(templateId = 'empty') {
  const t = TEMPLATES.find((x) => x.id === templateId) || TEMPLATES[0];
  const song = t.make();
  song.version = 1;
  song.id = id();
  return song;
}

function empty() {
  return {
    name: '新しい曲', bpm: 100, sig: [4, 4], bars: 8,
    tracks: [
      { id: 'piano', name: 'ピアノ', inst: 'piano', volume: -3, sends: { reverb: 0.15 }, clips: [{ at: 0, len: 16, notes: [] }] },
      { id: 'drums', name: 'ドラム', type: 'drums', kit: 'acoustic', volume: -3, clips: [{ at: 0, len: 4, grid: { kick: 'x.......x.......', snare: '....x.......x...', hat: 'x.x.x.x.x.x.x.x.' } }] },
    ],
  };
}

function lofi() {
  // ii-V-I-VI（D マイナー寄りの C メジャー）。ルートを抜いたジャズのボイシング
  const V = [['F3', 'A3', 'C4', 'E4'], ['F3', 'B3', 'E4', 'A4'], ['E3', 'G3', 'B3', 'D4'], ['G3', 'A#3', 'C#4', 'E4']];
  const keys = [];
  V.forEach((v, b) => { keys.push(...chord(b * 4, v, 2.5, 0.55), ...chord(b * 4 + 2.75, v, 1.1, 0.4)); });
  const mel = [
    [0.5, 'A4', 0.5], [1, 'C5', 1], [2, 'A4', 0.5], [2.5, 'G4', 1.5],
    [4.5, 'F4', 0.5], [5, 'E4', 0.5], [5.5, 'F4', 0.5], [6, 'A4', 2],
    [8.5, 'G4', 0.5], [9, 'B4', 1], [10, 'D5', 0.5], [10.5, 'C5', 1.5],
    [12.5, 'C#5', 0.5], [13, 'E5', 0.5], [13.5, 'D5', 0.5], [14, 'A#4', 1], [15, 'A4', 1],
  ].map(([t, n, d]) => [t, n, d, 0.5]);
  const bass = [[0, 'D2', 1.5], [1.75, 'D2', 0.25], [2, 'A1', 1.5], [3.5, 'C2', 0.5], [4, 'G1', 1.5], [5.75, 'G1', 0.25], [6, 'D2', 1.5], [7.5, 'B1', 0.5],
    [8, 'C2', 1.5], [9.75, 'C2', 0.25], [10, 'G1', 1.5], [11.5, 'B1', 0.5], [12, 'A1', 1.5], [13.75, 'A1', 0.25], [14, 'E2', 1], [15, 'C#2', 1]].map(([t, n, d]) => [t, n, d, 0.75]);
  return {
    name: 'ローファイ', bpm: 80, sig: [4, 4], bars: 8, key: 'C major',
    sends: { reverb: { size: 1.2, decay: 2.2, damp: 5000 } },
    patterns: {
      keys: { len: 16, notes: keys },
      mel: { len: 16, notes: mel },
      bass: { len: 16, notes: bass },
      beat: { len: 4, grid: { kick: 'x.........x..x..', snare: '....x.......x...', hat: 'x.xgx.xgx.xgx.xo', rim: '.......g........' } },
    },
    tracks: [
      { id: 'keys', name: 'エレピ', inst: 'epiano', volume: 1, pan: -0.1, humanize: { time: 0.012, vel: 0.06 }, sends: { reverb: 0.25 }, fx: [{ type: 'lofi', wow: 0.5, noise: 0.25, crackle: 0.3, tone: 6000, mix: 0.8 }], clips: [{ at: 0, pattern: 'keys', repeat: 2 }] },
      { id: 'mel', name: 'ビブラフォン', inst: 'vibraphone', volume: 4.5, pan: 0.2, humanize: { time: 0.01, vel: 0.08 }, sends: { reverb: 0.35, delay: 0.12 }, clips: [{ at: 16, pattern: 'mel' }] },
      { id: 'bass', name: 'ベース', inst: 'ebass', volume: -3.5, humanize: { time: 0.008 }, clips: [{ at: 0, pattern: 'bass', repeat: 2 }] },
      { id: 'drums', name: 'ドラム', type: 'drums', kit: 'lofi', volume: 4, swing: 0.18, humanize: { time: 0.006 }, sends: { reverb: 0.06 }, clips: [{ at: 0, pattern: 'beat', repeat: 8 }] },
    ],
    master: { loudness: -14 },
  };
}

function pop() {
  // I - V/VII - vi - IV（C）
  const prog = [['C4', 'E4', 'G4'], ['B3', 'D4', 'G4'], ['C4', 'E4', 'A4'], ['C4', 'F4', 'A4']];
  const roots = ['C2', 'B1', 'A1', 'F1'];
  const piano = [], bass = [], pad = [];
  prog.forEach((v, b) => {
    for (const t of [0, 1, 1.5, 2.5, 3]) piano.push(...chord(b * 4 + t, v, t === 0 ? 1 : 0.5, t === 0 ? 0.7 : 0.5));
    for (let k = 0; k < 8; k++) bass.push([b * 4 + k * 0.5, roots[b], 0.45, k % 2 ? 0.6 : 0.85]);
    pad.push(...chord(b * 4, v.map((n) => n.replace(/\d/, (d) => String(Number(d)))), 4, 0.5));
  });
  const mel = [
    [0, 'E5', 0.5], [0.5, 'G5', 0.5], [1, 'G5', 1], [2, 'A5', 0.5], [2.5, 'G5', 1],
    [4, 'D5', 0.5], [4.5, 'G5', 0.5], [5, 'G5', 1], [6, 'F5', 0.5], [6.5, 'E5', 0.5], [7, 'D5', 1],
    [8, 'C5', 0.5], [8.5, 'E5', 0.5], [9, 'E5', 1], [10, 'G5', 0.5], [10.5, 'A5', 1],
    [12, 'A5', 0.5], [12.5, 'G5', 0.5], [13, 'F5', 0.5], [13.5, 'E5', 0.5], [14, 'D5', 0.5], [14.5, 'C5', 1.5],
  ].map(([t, n, d]) => [t, n, d, 0.75]);
  return {
    name: 'ポップ', bpm: 112, sig: [4, 4], bars: 8, key: 'C major',
    patterns: {
      piano: { len: 16, notes: piano }, bass: { len: 16, notes: bass }, pad: { len: 16, notes: pad }, mel: { len: 16, notes: mel },
      beat: { len: 4, grid: { kick: 'x......xx.x.....', snare: '....x.......x...', hat: 'x.x.x.x.x.x.x.x.', shaker: '.x.x.x.x.x.x.x.x' } },
      fill: { len: 4, grid: { kick: 'x......xx.x.....', snare: '....x.......xxXX', hat: 'x.x.x.x.x.x.....', crash: '................' } },
    },
    tracks: [
      { id: 'piano', name: 'ピアノ', inst: 'piano', volume: -3.5, humanize: { time: 0.006, vel: 0.05 }, sends: { reverb: 0.15 }, clips: [{ at: 0, pattern: 'piano', repeat: 2 }] },
      { id: 'pad', name: 'ストリングス', inst: 'strings', volume: -4.5, sends: { reverb: 0.3 }, clips: [{ at: 16, pattern: 'pad' }] },
      { id: 'mel', name: 'メロディ', inst: 'softlead', volume: -0.5, sends: { reverb: 0.2, delay: 0.15 }, clips: [{ at: 16, pattern: 'mel' }] },
      { id: 'bass', name: 'ベース', inst: 'synthbass', volume: 2.5, clips: [{ at: 0, pattern: 'bass', repeat: 2 }] },
      { id: 'drums', name: 'ドラム', type: 'drums', kit: 'acoustic', volume: 3, sends: { reverb: 0.08 },
        clips: [{ at: 0, pattern: 'beat', repeat: 3 }, { at: 12, pattern: 'fill' }, { at: 16, pattern: 'beat', repeat: 4 }, { at: 16, grid: { crash: 'x' } }] },
    ],
    master: { loudness: -14 },
  };
}

function edm() {
  // Am - F - C - G
  const prog = [['A3', 'C4', 'E4'], ['A3', 'C4', 'F4'], ['G3', 'C4', 'E4'], ['G3', 'B3', 'D4']];
  const roots = ['A1', 'F1', 'C2', 'G1'];
  const chords = [], bass = [], arp = [];
  prog.forEach((v, b) => {
    // オフビートの刻み（ポンピングで揺れる）
    for (let k = 0; k < 4; k++) chords.push(...chord(b * 4 + k, v.concat([v[0].replace(/\d/, (d) => String(Number(d) + 1))]), 0.9, 0.7));
    for (let k = 0; k < 4; k++) bass.push([b * 4 + k + 0.5, roots[b], 0.4, 0.85]);
    const up = [v[0], v[1], v[2], v[0].replace(/\d/, (d) => String(Number(d) + 1))];
    for (let k = 0; k < 16; k++) arp.push([b * 4 + k * 0.25, up[[0, 1, 2, 3, 2, 1, 2, 3][k % 8]].replace(/\d/, (d) => String(Number(d) + 1)), 0.22, k % 4 === 0 ? 0.8 : 0.55]);
  });
  return {
    name: 'EDM', bpm: 124, sig: [4, 4], bars: 8, key: 'A minor',
    sends: { reverb: { size: 1.5, decay: 2.8 }, delay: { time: '1/8d', feedback: 0.4 } },
    patterns: {
      chords: { len: 16, notes: chords }, bass: { len: 16, notes: bass }, arp: { len: 16, notes: arp },
      beat: { len: 4, grid: { kick: 'x...x...x...x...', clap: '....x.......x...', ohat: '..x...x...x...x.', hat: 'xx.xxx.xxx.xxx.x' } },
    },
    tracks: [
      { id: 'chords', name: 'コード', inst: 'supersaw', volume: -3.5, sends: { reverb: 0.25 }, fx: [{ type: 'pump', amount: 0.75, rate: '1/4', release: 0.55 }, { type: 'filter', kind: 'lp', freq: [[0, 600], [16, 9000, 'exp']], q: 1.1 }], clips: [{ at: 0, pattern: 'chords', repeat: 2 }] },
      { id: 'arp', name: 'アルペジオ', inst: 'pluck', volume: -5, pan: 0.15, sends: { reverb: 0.2, delay: 0.25 }, fx: [{ type: 'pump', amount: 0.5, rate: '1/4', release: 0.5 }], clips: [{ at: 16, pattern: 'arp' }] },
      { id: 'bass', name: 'ベース', inst: 'reese', volume: 3.5, fx: [{ type: 'pump', amount: 0.6, rate: '1/4', release: 0.45 }], clips: [{ at: 0, pattern: 'bass', repeat: 2 }] },
      { id: 'drums', name: 'ドラム', type: 'drums', kit: 'house', volume: 2.5, sends: { reverb: 0.05 },
        clips: [{ at: 0, grid: { kick: 'x...x...x...x...|x...x...x...x...|x...x...x...x...|x...x...x...x...', hat: '..x...x...x...x.|..x...x...x...x.|..x...x...x...x.|..x.x.x.xxxxXXXX' } }, { at: 16, pattern: 'beat', repeat: 4 }, { at: 16, grid: { crash: 'X' } }] },
    ],
    master: { loudness: -12 },
  };
}

function cinematic() {
  // Dm - Bb - F - C（ゆっくり）
  const prog = [['D3', 'A3', 'D4', 'F4'], ['D3', 'A#3', 'D4', 'F4'], ['C3', 'A3', 'C4', 'F4'], ['C3', 'G3', 'C4', 'E4']];
  const roots = ['D2', 'A#1', 'F1', 'C2'];
  const strings = [], low = [], ost = [], choir = [];
  prog.forEach((v, b) => {
    strings.push(...chord(b * 4, v, 4, 0.65));
    low.push([b * 4, roots[b], 4, 0.8], [b * 4, roots[b].replace(/\d/, (d) => String(Number(d) + 1)), 4, 0.6]);
    const o = [v[2], v[3], v[1].replace(/\d/, (d) => String(Number(d) + 1)), v[3]].map((n) => n.replace(/\d/, (d) => String(Number(d) + 1)));
    for (let k = 0; k < 8; k++) ost.push([b * 4 + k * 0.5, o[k % 4], 0.45, k % 2 ? 0.5 : 0.7]);
    choir.push(...chord(b * 4, [v[1], v[3]].map((n) => n.replace(/\d/, (d) => String(Number(d) + 1))), 4, 0.5));
  });
  return {
    name: 'シネマ', bpm: 76, sig: [4, 4], bars: 8, key: 'D minor',
    sends: { reverb: { size: 1.8, decay: 3.6, damp: 6500, predelay: 0.04 } },
    patterns: { strings: { len: 16, notes: strings }, low: { len: 16, notes: low }, ost: { len: 16, notes: ost }, choir: { len: 16, notes: choir } },
    tracks: [
      { id: 'strings', name: 'ストリングス', inst: 'strings', volume: -8.5, sends: { reverb: 0.35 }, clips: [{ at: 0, pattern: 'strings', repeat: 2 }] },
      { id: 'low', name: '低音', inst: 'brass', volume: 2, sends: { reverb: 0.3 }, clips: [{ at: 16, pattern: 'low' }] },
      { id: 'ost', name: 'ピアノ', inst: 'piano', volume: -2, sends: { reverb: 0.3, delay: 0.08 }, clips: [{ at: 0, pattern: 'ost', repeat: 2 }] },
      { id: 'choir', name: 'クワイア', inst: 'choir', volume: -4, sends: { reverb: 0.45 }, clips: [{ at: 16, pattern: 'choir' }] },
      { id: 'perc', name: '打楽器', type: 'drums', kit: 'cinematic', volume: 3.5, sends: { reverb: 0.2 },
        clips: [{ at: 16, len: 16, grid: { tom3: 'x.......x.x.....|x.......x.x.....|x.......x.x.....|x.......x.x.x.xx', tom1: '....x.......x...|....x.......x...|....x.......x...|....x.......xxxx', crash: 'x...............' } }] },
      { id: 'fx', name: '効果音', type: 'sfx', volume: -6.5, clips: [{ at: 0, sfx: { preset: 'braam', length: 1.2 }, gain: -4 }, { at: 12, sfx: { preset: 'riser', length: 0.75 }, gain: -6 }] },
    ],
    master: { loudness: -14 },
  };
}

function wafu() {
  // ヨナ抜きではなく「陽音階」（D E G A B）。琴のアルペジオ・笛の旋律・太鼓
  const koto = [];
  const pats = [['D4', 'A4', 'D5', 'E5'], ['B3', 'G4', 'B4', 'D5'], ['G3', 'D4', 'G4', 'A4'], ['A3', 'E4', 'A4', 'B4']];
  pats.forEach((p, b) => {
    const seq = [p[0], p[1], p[2], p[3], p[2], p[1], p[2], p[3]];
    seq.forEach((n, k) => koto.push([b * 4 + k * 0.5, n, k === 0 ? 2 : 0.5, k === 0 ? 0.8 : 0.55]));
  });
  const fue = [
    [0, 'A5', 1.5], [1.5, 'B5', 0.5], [2, 'A5', 1], [3, 'G5', 1],
    [4, 'E5', 2], [6, 'D5', 1], [7, 'E5', 1],
    [8, 'G5', 1.5], [9.5, 'A5', 0.5], [10, 'B5', 1], [11, 'D6', 1],
    [12, 'B5', 1], [13, 'A5', 1], [14, 'A5', 2],
  ].map(([t, n, d]) => [t, n, d, 0.7]);
  const bass = [[0, 'D2', 4], [4, 'B1', 4], [8, 'G1', 4], [12, 'A1', 4]].map(([t, n, d]) => [t, n, d, 0.7]);
  return {
    name: '和風', bpm: 92, sig: [4, 4], bars: 8, key: 'D（陽音階）',
    sends: { reverb: { size: 1.4, decay: 2.6, damp: 7000 } },
    patterns: {
      koto: { len: 16, notes: koto }, fue: { len: 16, notes: fue }, bass: { len: 16, notes: bass },
      taiko: { len: 4, grid: { tom3: 'x.....x.x.......', tom1: '........x...x.x.', shaker: 'x.x.x.x.x.x.x.x.' } },
    },
    tracks: [
      { id: 'koto', name: '琴', inst: 'koto', volume: 0, humanize: { time: 0.008, vel: 0.06 }, sends: { reverb: 0.25 }, clips: [{ at: 0, pattern: 'koto', repeat: 2 }] },
      { id: 'fue', name: '笛', inst: { preset: 'flute', vibrato: { rate: 5.5, depth: 0.2, delay: 0.25 } }, volume: 0, sends: { reverb: 0.35, delay: 0.1 }, clips: [{ at: 16, pattern: 'fue' }] },
      { id: 'bass', name: '低音', inst: 'darkpad', volume: 0.5, sends: { reverb: 0.2 }, clips: [{ at: 0, pattern: 'bass', repeat: 2 }] },
      { id: 'taiko', name: '太鼓', type: 'drums', kit: 'cinematic', volume: 3.5, sends: { reverb: 0.15 }, clips: [{ at: 16, pattern: 'taiko', repeat: 4 }] },
    ],
    master: { loudness: -14 },
  };
}
