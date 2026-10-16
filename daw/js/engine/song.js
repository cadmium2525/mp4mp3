/*
 * かなでる：曲データ（JSON）の読み取り。
 * 時間はすべて「拍」（4分音符 = 1）。秒への換算は bpm から。
 */
import { pitchesOf, rng, hashSeed, noteToMidi } from './dsp.js';

export const SR = 48000;

export const beatsPerBar = (song) => {
  const [n, d] = song.sig || [4, 4];
  return (n * 4) / d;
};
export const secPerBeat = (song) => 60 / (song.bpm || 120);

// ドラムの譜面の文字 → 強さ
const HIT = { X: 1, x: 0.8, o: 0.55, g: 0.35, '*': 0.8 };
const REST = new Set(['.', '-', '_', ' ']);

/** 音符の書き方をそろえる：[t, 音, 長さ, 強さ] / { t, n, d, v } → { t, n, d, v } */
function normNote(x) {
  if (Array.isArray(x)) return { t: Number(x[0]), n: x[1], d: x[2] == null ? 1 : Number(x[2]), v: x[3] == null ? 0.8 : Number(x[3]) };
  return { t: Number(x.t ?? 0), n: x.n ?? x.note ?? x.p, d: Number(x.d ?? x.len ?? 1), v: Number(x.v ?? x.vel ?? 0.8), ...(x.chord ? { n: x.chord } : {}) };
}

/** ドラムの譜面 { kick: "x...x...", ... } → 音符の列 */
function gridNotes(grid, res = 0.25) {
  const out = [];
  for (const [piece, line] of Object.entries(grid)) {
    let k = 0;
    for (const c of String(line)) {
      if (c === '|') continue; // 小節の区切り（読みやすさ用）
      if (!REST.has(c)) {
        if (HIT[c] == null) throw new Error(`ドラム譜の記号が読めません: "${c}"（X x o g . - が使えます）`);
        out.push({ t: k * res, n: piece, d: res, v: HIT[c] });
      }
      k++;
    }
  }
  return out;
}

/** パターン（使い回す音符のまとまり）の中身 */
function patternNotes(p) {
  if (!p) return [];
  const notes = (p.notes || []).map(normNote);
  if (p.grid) notes.push(...gridNotes(p.grid, p.res ?? 0.25));
  return notes;
}

/** パターンやクリップの長さ（拍） */
function contentLen(notes) {
  return notes.reduce((m, x) => Math.max(m, x.t + x.d), 0);
}

/**
 * トラックの全クリップを展開して、拍単位の音符の列にする。
 * clip: { at, notes?, grid?, res?, pattern?, len?, repeat?, transpose?, vel?, swing? }
 */
export function trackNotes(song, track) {
  const out = [];
  for (let clip of track.clips || []) {
    if (clip.mute) continue;
    let notes = [];
    if (clip.pattern) {
      const p = song.patterns?.[clip.pattern];
      if (!p) throw new Error(`パターン「${clip.pattern}」が見つかりません（トラック ${track.name || track.id}）`);
      notes = patternNotes(p);
      if (clip.len == null && p.len != null) clip = { ...clip, len: p.len };
    }
    notes = notes.concat(patternNotes(clip));
    const len = clip.len ?? Math.ceil(contentLen(notes) / beatsPerBar(song)) * beatsPerBar(song);
    const rep = Math.max(1, clip.repeat ?? 1);
    const swing = clip.swing ?? track.swing ?? 0;
    const res = clip.res ?? 0.25;
    for (let r = 0; r < rep; r++) {
      for (const nt of notes) {
        if (nt.t >= len) continue;
        let t = nt.t;
        // スウィング：裏の16分（または8分）を後ろにずらす
        if (swing) {
          const step = Math.round(t / res);
          if (Math.abs(t - step * res) < 1e-6 && step % 2 === 1) t += swing * res;
        }
        out.push({ ...nt, t: (clip.at ?? 0) + r * len + t, v: nt.v * (clip.vel ?? 1), tr: clip.transpose ?? 0 });
      }
    }
  }
  out.sort((a, b) => a.t - b.t);
  return out;
}

/** 曲の長さ（拍） */
export function songBeats(song) {
  if (song.bars) return song.bars * beatsPerBar(song);
  let end = 0;
  for (const tr of song.tracks || []) for (const n of trackNotes(song, tr)) end = Math.max(end, n.t + n.d);
  return Math.ceil(end / beatsPerBar(song) - 1e-6) * beatsPerBar(song);
}

/**
 * 楽器トラックの音符をサンプル単位にする（和音記号は構成音に展開、ヒューマナイズ）。
 * 戻り値 [{ s, len, m, v }]
 */
export function toSamples(song, track, notes, sr = SR) {
  const spb = secPerBeat(song) * sr;
  const hum = track.humanize || {};
  const r = rng(hashSeed(String(track.id || track.name || 't')) + 1);
  const out = [];
  for (const n of notes) {
    const pitches = pitchesOf(n.n).map((m) => m + (n.tr || 0) + (track.transpose || 0));
    // 和音はわずかにずらして弾く（strum: 秒）
    const strum = n.strum ?? track.strum ?? 0;
    pitches.forEach((m, k) => {
      const dt = (hum.time ? (r() - 0.5) * 2 * hum.time : 0) + k * strum;
      const dv = hum.vel ? (r() - 0.5) * 2 * hum.vel : 0;
      out.push({
        s: Math.max(0, Math.round(n.t * spb + dt * sr)),
        len: Math.max(1, Math.round(n.d * spb * (track.legato ?? 1))),
        m,
        v: Math.min(1, Math.max(0.05, n.v + dv)),
      });
    });
  }
  out.sort((a, b) => a.s - b.s);
  return out;
}

/** ドラム名の確認用：ドラムトラックで使える名前 */
export function isDrumName(n) {
  return typeof n === 'string' && !/\d/.test(n) && !n.includes(':');
}

export { noteToMidi };
