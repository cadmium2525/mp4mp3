// 「日本の人口は、これからどう変わるのか。」の BGM（かなでるの曲 JSON を作る）
// 100 BPM（1拍 0.6 秒）。場面の切り替わり 7 / 22 / 33.5 / 42.5 / 51.5 / 67.5 秒に、音楽の区切りを合わせる。
import { writeFileSync } from 'node:fs';

const N = (t, n, d, v = 0.7) => [t, n, d, v];
const chordNotes = (t, notes, d, v = 0.55) => notes.map((n) => N(t, n, d, v));

// 区切り（拍）：A 0 / B 12 / C 36 / D 56 / E 72 / F 86 / G 112 / 終 132
// 和音の進行 [開始拍, 長さ, ルート, 弦のボイシング, 低音]
const prog = [
  // A 導入（Dm add9 → Bbmaj7 → Csus4）
  [0, 4, 'Dm', ['D4', 'E4', 'A4'], 'D2'], [4, 4, 'Bb', ['D4', 'F4', 'A4'], 'A#1'], [8, 4, 'Csus4', ['C4', 'F4', 'G4'], 'C2'],
  // B グラフ（データ・刻み）
  [12, 4, 'Dm', ['D4', 'F4', 'A4'], 'D2'], [16, 4, 'Bb', ['D4', 'F4', 'A#4'], 'A#1'], [20, 4, 'F', ['C4', 'F4', 'A4'], 'F1'], [24, 4, 'C', ['C4', 'E4', 'G4'], 'C2'],
  [28, 4, 'Gm7', ['D4', 'F4', 'A#4'], 'G1'], [32, 2, 'A7sus4', ['D4', 'E4', 'G4'], 'A1'], [34, 2, 'A7', ['C#4', 'E4', 'G4'], 'A1'],
  // C 高齢化（暗く）
  [36, 4, 'Dm', ['D4', 'F4', 'A4'], 'D2'], [40, 4, 'Bbmaj7', ['D4', 'F4', 'A4'], 'A#1'], [44, 4, 'Gm', ['D4', 'G4', 'A#4'], 'G1'], [48, 4, 'Em7b5', ['D4', 'G4', 'A#4'], 'E1'], [52, 4, 'A7', ['C#4', 'E4', 'G4'], 'A1'],
  // D 働き手（推進力）
  [56, 4, 'Dm', ['D4', 'F4', 'A4'], 'D2'], [60, 4, 'C', ['E4', 'G4', 'C5'], 'C2'], [64, 4, 'Bb', ['D4', 'F4', 'A#4'], 'A#1'], [68, 4, 'A', ['C#4', 'E4', 'A4'], 'A1'],
  // E 出生数（静かに）
  [72, 4, 'Bbmaj7', ['D4', 'F4', 'A4'], 'A#1'], [76, 4, 'F/A', ['C4', 'F4', 'A4'], 'A1'], [80, 4, 'Gm7', ['D4', 'F4', 'A#4'], 'G1'], [84, 2, 'Csus4', ['C4', 'F4', 'G4'], 'C2'],
  // F 暮らし（希望・F メジャー）
  [86, 4, 'F', ['C4', 'F4', 'A4'], 'F1'], [90, 4, 'C/E', ['C4', 'E4', 'G4'], 'E1'], [94, 4, 'Dm7', ['C4', 'F4', 'A4'], 'D2'], [98, 4, 'Bbmaj7', ['D4', 'F4', 'A4'], 'A#1'],
  [102, 4, 'F/A', ['C4', 'F4', 'A4'], 'A1'], [106, 4, 'Gm7', ['D4', 'F4', 'A#4'], 'G1'], [110, 2, 'C', ['E4', 'G4', 'C5'], 'C2'],
  // G 結び（Bbmaj7 → C → F で明るく終わる）
  [112, 4, 'Bbmaj7', ['D4', 'F4', 'A4'], 'A#1'], [116, 4, 'C', ['E4', 'G4', 'C5'], 'C2'], [120, 12, 'F', ['F4', 'A4', 'C5'], 'F1'],
];
const inRange = (a, b) => prog.filter(([t]) => t >= a && t < b);
const up = (n, k = 1) => n.replace(/(-?\d+)$/, (d) => String(Number(d) + k));

/* 弦（C 以降。E は弱く、F・G で大きく） */
const strings = [];
for (const [t, d, , v] of inRange(36, 132)) strings.push(...chordNotes(t, v, Math.min(d, 132 - t), t < 72 ? 0.55 : t < 86 ? 0.4 : 0.7));
/* パッド（A・E・F・G、1 オクターブ上） */
const pad = [];
for (const [t, d, , v] of [...inRange(0, 12), ...inRange(72, 132)]) pad.push(...chordNotes(t, v.map((n) => up(n)), d, 0.5));
/* 低音 */
const bass = [];
for (const [t, d, , , b] of inRange(12, 132)) {
  if (t >= 72 && t < 80) continue; // E の前半は低音なし
  if (t >= 56 && t < 72) { for (let k = 0; k < d * 2; k++) bass.push(N(t + k * 0.5, b, 0.45, k % 2 ? 0.55 : 0.8)); continue; } // D：8分で推進
  bass.push(N(t, b, Math.min(d, 132 - t) - 0.1, 0.8));
}
/* マリンバの刻み（B・D：データを数えるような 8 分） */
const mar = [];
const arp = (v) => { const [a, b, c] = v; return [a, b, c, up(a), c, b, up(a), c]; };
for (const [t, d, , v] of [...inRange(12, 36), ...inRange(56, 72)]) {
  const seq = arp(v.map((n) => up(n)));
  for (let k = 0; k < d * 2; k++) mar.push(N(t + k * 0.5, seq[k % 8], 0.45, k % 4 === 0 ? 0.75 : 0.5));
}
/* チェレスタのきらめき（F・G：未来） */
const cel = [];
for (const [t, d, , v] of inRange(86, 124)) {
  const tones = v.map((n) => up(n, 1)).concat([up(v[0], 2)]);
  for (let k = 0; k < Math.min(d, 8) * 2; k++) cel.push(N(t + k * 0.5, tones[[0, 1, 2, 3, 2, 1, 3, 2][k % 8]], 0.4, k % 2 ? 0.35 : 0.5));
}
/* ピアノ：旋律 */
const mel = [
  // A
  N(0, 'A4', 1, 0.6), N(1, 'D5', 1, 0.6), N(2, 'E5', 1, 0.62), N(3, 'F5', 1, 0.65), N(4, 'E5', 1.5, 0.6), N(5.5, 'D5', 0.5, 0.5), N(6, 'F5', 2, 0.6), N(8, 'E5', 1, 0.55), N(9, 'C5', 1, 0.5), N(10, 'G4', 2, 0.5),
  // C
  N(36, 'F5', 2, 0.6), N(38, 'E5', 1, 0.55), N(39, 'D5', 1, 0.55), N(40, 'D5', 3, 0.6), N(43, 'C5', 1, 0.5), N(44, 'A#4', 2, 0.55), N(46, 'A4', 1, 0.5), N(47, 'G4', 1, 0.5),
  N(48, 'G4', 2, 0.5), N(50, 'A#4', 1, 0.5), N(51, 'A4', 1, 0.5), N(52, 'A4', 2, 0.55), N(54, 'G4', 1, 0.5), N(55, 'C#5', 1, 0.55),
  // D
  N(56, 'D5', 1, 0.65), N(57, 'F5', 1, 0.62), N(58, 'A5', 2, 0.68), N(60, 'G5', 1, 0.62), N(61, 'E5', 1, 0.6), N(62, 'C5', 2, 0.6), N(64, 'F5', 1, 0.62), N(65, 'D5', 1, 0.6), N(66, 'A#4', 2, 0.6), N(68, 'A4', 1, 0.6), N(69, 'C#5', 1, 0.62), N(70, 'E5', 2, 0.65),
  // E
  N(72, 'D5', 3, 0.5), N(75, 'C5', 1, 0.45), N(76, 'C5', 2, 0.5), N(78, 'A4', 2, 0.45), N(80, 'A#4', 3, 0.5), N(83, 'A4', 1, 0.45), N(84, 'G4', 2, 0.5),
  // F
  N(86, 'C5', 1, 0.65), N(87, 'F5', 1, 0.68), N(88, 'A5', 1.5, 0.72), N(89.5, 'G5', 0.5, 0.6), N(90, 'G5', 2, 0.68), N(92, 'E5', 1, 0.6), N(93, 'C5', 1, 0.6),
  N(94, 'D5', 1, 0.62), N(95, 'F5', 1, 0.65), N(96, 'A5', 1, 0.68), N(97, 'C6', 1, 0.72), N(98, 'A5', 2, 0.7), N(100, 'F5', 1, 0.62), N(101, 'D5', 1, 0.6),
  N(102, 'C5', 1, 0.62), N(103, 'F5', 1, 0.66), N(104, 'A5', 1.5, 0.7), N(105.5, 'A#5', 0.5, 0.62), N(106, 'A5', 1, 0.68), N(107, 'G5', 1, 0.64), N(108, 'F5', 1, 0.62), N(109, 'D5', 1, 0.6), N(110, 'E5', 1, 0.62), N(111, 'G5', 1, 0.66),
  // G
  N(112, 'F5', 2, 0.68), N(114, 'G5', 1, 0.64), N(115, 'A5', 1, 0.66), N(116, 'G5', 2, 0.66), N(118, 'E5', 1, 0.6), N(119, 'C5', 1, 0.6), N(120, 'F5', 8, 0.68),
];
/* ピアノの左手（A・C・E・G：和音をやさしく） */
const lh = [];
for (const [t, d, , v, b] of [...inRange(0, 12), ...inRange(36, 56), ...inRange(72, 86), ...inRange(112, 132)]) {
  lh.push(N(t, up(b, 1), Math.min(d, 8), 0.45));
  lh.push(...chordNotes(t + 0.5, v.map((n) => n.replace(/\d$/, (x) => String(Number(x) - 1))), Math.min(d, 8) - 0.5, 0.35));
}
/* クワイア（G） */
const choir = [];
for (const [t, d, , v] of inRange(112, 132)) choir.push(...chordNotes(t, [v[0], v[2]], d, 0.5));

/* ドラム（B：軽く、D：前へ、F：明るく、G：締め） */
const drums = [
  { at: 12, len: 24, grid: { kick: 'x.......x.......|x.......x.......|x.......x.......|x.......x.......|x.......x.......|x.......x...x.x.', shaker: '..x...x...x...x.|..x...x...x...x.|..x...x...x...x.|..x...x...x...x.|..x...x...x...x.|..x...x.x.x.xxxx' } },
  { at: 56, len: 16, grid: { kick: 'x.....x.x.......|x.....x.x.......|x.....x.x.......|x.....x.x...x.x.', rim: '....x.......x...|....x.......x...|....x.......x...|....x.......xxxx', shaker: 'xxxxxxxxxxxxxxxx|xxxxxxxxxxxxxxxx|xxxxxxxxxxxxxxxx|xxxxxxxxxxxxxxxx', tom3: '................|................|................|........x.x.x.x.' } },
  { at: 86, len: 26, grid: { crash: 'X', kick: 'x.......x.......|x.......x.......|x.......x.......|x.......x.......|x.......x.......|x.......x.......|x...x.x.', clap: '....x.......x...|....x.......x...|....x.......x...|....x.......x...|....x.......x...|....x.......x...|....xxxx', hat: 'x.x.x.x.x.x.x.x.|x.x.x.x.x.x.x.x.|x.x.x.x.x.x.x.x.|x.x.x.x.x.x.x.x.|x.x.x.x.x.x.x.x.|x.x.x.x.x.x.x.x.|........', shaker: '.x.x.x.x.x.x.x.x|.x.x.x.x.x.x.x.x|.x.x.x.x.x.x.x.x|.x.x.x.x.x.x.x.x|.x.x.x.x.x.x.x.x|.x.x.x.x.x.x.x.x|........' } },
  { at: 112, len: 12, grid: { kick: 'x...............|x...............|X...............', crash: '................|................|X...............', tom3: '................|........x.x.xxxx|................' } },
];

const song = {
  name: 'Japan 2070 BGM', bpm: 100, sig: [4, 4], bars: 33, key: 'D minor → F major',
  sends: { reverb: { size: 1.5, decay: 3, damp: 6500, predelay: 0.03 }, delay: { time: '1/8d', feedback: 0.3 } },
  tracks: [
    { id: 'piano', name: 'ピアノ（旋律）', inst: 'softpiano', volume: 4, pan: 0.05, humanize: { time: 0.008, vel: 0.05 }, sends: { reverb: 0.3, delay: 0.06 }, clips: [{ at: 0, notes: mel }] },
    { id: 'lh', name: 'ピアノ（和音）', inst: 'softpiano', volume: 2, pan: -0.1, humanize: { time: 0.01, vel: 0.04 }, sends: { reverb: 0.3 }, fx: [{ type: 'eq', bands: [{ type: 'hp', freq: 70 }, { type: 'peak', freq: 320, gain: -3.5, q: 1 }] }], clips: [{ at: 0, notes: lh }] },
    { id: 'strings', name: 'ストリングス', inst: 'strings', volume: -6, sends: { reverb: 0.35 }, auto: { volume: [[36, -8], [44, 0], [72, -3], [86, 0], [124, 0], [132, -10]] }, clips: [{ at: 0, notes: strings }] },
    { id: 'pad', name: 'パッド', inst: 'airpad', volume: -8, sends: { reverb: 0.3 }, clips: [{ at: 0, notes: pad }] },
    { id: 'bass', name: 'ベース', inst: 'subbass', volume: 1, clips: [{ at: 0, notes: bass }] },
    { id: 'mar', name: 'マリンバ', inst: 'marimba', volume: 0, pan: 0.25, humanize: { time: 0.005, vel: 0.06 }, sends: { reverb: 0.15, delay: 0.1 }, clips: [{ at: 0, notes: mar }] },
    { id: 'cel', name: 'チェレスタ', inst: 'celesta', volume: 2, pan: -0.25, sends: { reverb: 0.35, delay: 0.15 }, clips: [{ at: 0, notes: cel }] },
    { id: 'choir', name: 'クワイア', inst: 'choiroo', volume: -3.5, sends: { reverb: 0.45 }, clips: [{ at: 0, notes: choir }] },
    { id: 'drums', name: 'ドラム', type: 'drums', kit: 'acoustic', volume: 1, sends: { reverb: 0.12 }, humanize: { time: 0.004 }, tune: { kick: { tone: -0.2 }, clap: { space: 0.3 } }, clips: drums },
    { id: 'fx', name: '効果音', type: 'sfx', volume: -8, clips: [
      { at: 52, sfx: { preset: 'revcymbal', length: 1.6 }, gain: -2 },
      { at: 82, sfx: { preset: 'revcymbal', length: 2.4 }, gain: 0 },
      { at: 120, sfx: { preset: 'sparkle', length: 2, space: 0.6 }, gain: -6 },
    ] },
  ],
  master: { loudness: -18, ceiling: -1.5 },
};
writeFileSync(new URL('./japan2070_bgm.json', import.meta.url), JSON.stringify(song, null, 1));
// 予定の和音（小節ごと、4/4 の小節線で）：解析と照合する
const exp = [];
for (let b = 0; b < 33; b++) { const t = b * 4 + 0.01; const c = prog.filter(([s]) => s <= t).pop(); exp.push(c ? c[2].replace(/maj7|m7b5|sus4|7|m7/, (x) => (x === 'm7' ? 'm' : '')).replace(/\/.*/, '') : '-'); }

console.log('ok', exp.join(','));
