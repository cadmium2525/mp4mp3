/*
 * かなでる：曲を描画（ミックス）する。
 * トラック → 楽器/ドラム/効果音 → トラックのエフェクト → 音量・パン（オートメーション）
 *   → センド（共有のリバーブ・ディレイ）→ マスター（EQ・コンプ・ラウドネス合わせ・リミッター）
 */
import { stereo, dbToGain, panGains, curve, hashSeed, clamp } from './dsp.js';
import { renderNotes } from './instruments.js';
import { resolveInst, KITS, DRUM_PEAK, INST_PRESETS } from './presets.js';
import { renderSfx, sfxFromPreset, drum } from './sfx.js';
import { applyChain, limit } from './fx.js';
import { loudness, truePeak } from './analyze.js';
import { trackNotes, toSamples, songBeats, secPerBeat, beatsPerBar, SR } from './song.js';

/** トラックの楽器・ドラム・効果音を鳴らした生の音（エフェクト前） */
function renderSource(song, track, n, sr, onProgress) {
  const [L, R] = stereo(n);
  const type = track.type || (track.kit ? 'drums' : track.sfx || track.clips?.some((c) => c.sfx) ? 'sfx' : 'inst');
  const notes = trackNotes(song, track);
  const spb = secPerBeat(song) * sr;
  if (type === 'inst') {
    const inst = resolveInst(track.inst);
    renderNotes(inst, toSamples(song, track, notes, sr), L, R, sr, hashSeed(String(track.id || track.name)), onProgress);
    return { L, R, presetFx: inst.fx || [] };
  }
  if (type === 'drums') {
    const kit = KITS[track.kit || 'acoustic'] || KITS.acoustic;
    const cache = new Map();
    const tune = track.tune || {}; // パーツごとの上書き { snare: { tone: 0.3 } }
    const hum = track.humanize || {};
    let k = 0;
    for (const nt of notes) {
      const name = String(nt.n);
      const opt = { ...(kit.map[name] || {}), ...(tune[name] || {}) };
      const piece = opt.piece || name;
      const vb = Math.round(nt.v * 8) / 8;
      const variant = k++ % 4; // 同じ音の連打でも毎回すこし違う（マシンガン感を消す）
      const key = `${name}|${vb}|${variant}`;
      let buf = cache.get(key);
      if (!buf) {
        const def = drum(piece, { ...opt, vel: vb }, undefined);
        def.seed = hashSeed(key) % 100000;
        def.normalize = null;
        buf = renderSfx(def, sr);
        // パーツごとに決まったピークにそろえる（強弱は下の g で付ける）
        let pk = 0;
        for (let i = 0; i < buf[0].length; i++) pk = Math.max(pk, Math.abs(buf[0][i]), Math.abs(buf[1][i]));
        const target = dbToGain(DRUM_PEAK[name] ?? DRUM_PEAK[piece] ?? -12);
        if (pk > 0) { const gg = target / pk; for (const ch of buf) for (let i = 0; i < ch.length; i++) ch[i] *= gg; }
        cache.set(key, buf);
      }
      const jitter = hum.time ? (((hashSeed(key + k) % 1000) / 1000 - 0.5) * 2 * hum.time) : 0;
      const s0 = Math.max(0, Math.round(nt.t * spb + jitter * sr));
      const g = Math.pow(nt.v, 1.4) * dbToGain(opt.gain ?? 0);
      const [bl, br] = buf;
      // チョーク：オープンハイハットは次のハイハットで止める
      let end = bl.length;
      if (name === 'ohat') {
        const nx = notes.find((m) => m.t > nt.t && (m.n === 'hat' || m.n === 'ohat'));
        if (nx) end = Math.min(end, Math.round((nx.t - nt.t) * spb));
      }
      for (let i = 0; i < end && s0 + i < n; i++) {
        const fade = end < bl.length && i > end - 200 ? (end - i) / 200 : 1;
        L[s0 + i] += bl[i] * g * fade;
        R[s0 + i] += br[i] * g * fade;
      }
    }
    return { L, R, presetFx: kit.fx || [] };
  }
  if (type === 'sfx') {
    // 効果音トラック：clip = { at, sfx: { preset, ... } | 層の定義 }
    for (const clip of track.clips || []) {
      if (!clip.sfx || clip.mute) continue;
      const def = clip.sfx.preset ? sfxFromPreset(clip.sfx) : clip.sfx;
      const [bl, br] = renderSfx(def, sr);
      const s0 = Math.round((clip.at ?? 0) * spb);
      const g = dbToGain(clip.gain ?? 0);
      for (let i = 0; i < bl.length && s0 + i < n; i++) { L[s0 + i] += bl[i] * g; R[s0 + i] += br[i] * g; }
    }
    return { L, R, presetFx: [] };
  }
  throw new Error(`不明なトラックの種類: ${type}`);
}

/** オートメーション（拍 → 値）を、サンプル位置で引ける関数にする */
function autoFn(spec, sr, song, def) {
  if (spec == null) return null;
  const c = curve(spec, 'lin');
  const bps = 1 / (secPerBeat(song) * sr);
  return (i) => c(i * bps) ?? def;
}

/**
 * 曲を描画する。
 * opts: { sr, stems: true でトラックごとの音も返す, onProgress(0〜1, 文字), cache: Map（トラックの使い回し） }
 * 戻り値 { L, R, sr, duration, stems?, loudness }
 */
export function renderSong(song, opts = {}) {
  const sr = opts.sr || song.sr || SR;
  const prog = opts.onProgress || (() => {});
  const beats = songBeats(song);
  const tail = song.tail ?? 3;
  const n = Math.max(sr, Math.round((beats * secPerBeat(song) + tail) * sr));
  const tracks = (song.tracks || []).filter((t) => t && !t.off);
  const anySolo = tracks.some((t) => t.solo);
  const ctxBase = { sr, bpm: song.bpm || 120, timeAt: (i) => (i / sr) / secPerBeat(song), start: 0 };

  // サイドチェインの元になるトラックを先に作る
  const order = [...tracks].sort((a, b) => (hasSidechain(a) ? 1 : 0) - (hasSidechain(b) ? 1 : 0));
  const post = new Map(); // id → エフェクト後・フェーダー前
  const busRev = stereo(n), busDel = stereo(n), mix = stereo(n);
  const stems = {};
  order.forEach((tr, k) => {
    const id = tr.id || tr.name || `t${k}`;
    prog(k / (order.length + 2), `${tr.name || id} を演奏中…`);
    const key = opts.cache ? JSON.stringify([tr, song.bpm, song.sig, n, sr, usedPatterns(song, tr)]) : null;
    let L, R;
    const cached = key && opts.cache.get(key);
    if (cached && !hasSidechain(tr)) {
      L = cached[0].slice(); R = cached[1].slice();
    } else {
      const src = renderSource(song, tr, n, sr, (p) => prog((k + p) / (order.length + 2), `${tr.name || id} を演奏中…`));
      L = src.L; R = src.R;
      const ctx = { ...ctxBase, sidechain: (sid) => post.get(sid) || null };
      applyChain(src.presetFx, L, R, ctx);
      applyChain(tr.fx, L, R, ctx);
      if (key && !hasSidechain(tr)) opts.cache.set(key, [L.slice(), R.slice()]);
    }
    post.set(id, [L, R]);
    if (tr.mute || (anySolo && !tr.solo)) return;
    // 音量・パン（オートメーション対応）
    const volA = autoFn(tr.auto?.volume, sr, song, 0);
    const panA = autoFn(tr.auto?.pan, sr, song, 0);
    const v0 = tr.volume ?? 0, p0 = tr.pan ?? 0;
    const sRev = tr.sends?.reverb ?? 0, sDel = tr.sends?.delay ?? 0;
    const sL = opts.stems ? new Float32Array(n) : null, sR = opts.stems ? new Float32Array(n) : null;
    let gl = 1, gr = 1, g = dbToGain(v0);
    [gl, gr] = panGains(p0);
    for (let i = 0; i < n; i++) {
      if ((volA || panA) && i % 64 === 0) {
        if (volA) g = dbToGain(v0 + volA(i));
        if (panA) [gl, gr] = panGains(clamp(p0 + panA(i), -1, 1));
      }
      const l = L[i] * g * gl, r = R[i] * g * gr;
      mix[0][i] += l; mix[1][i] += r;
      if (sRev) { busRev[0][i] += l * sRev; busRev[1][i] += r * sRev; }
      if (sDel) { busDel[0][i] += l * sDel; busDel[1][i] += r * sDel; }
      if (sL) { sL[i] = l; sR[i] = r; }
    }
    if (opts.stems) stems[id] = [sL, sR];
  });

  // 共有のセンド（リバーブ・ディレイ）
  prog(order.length / (order.length + 2), '響きを計算中…');
  const sends = song.sends || {};
  const rv = { type: 'reverb', size: 1.2, decay: 2.2, damp: 7000, predelay: 0.025, lowcut: 250, ...(sends.reverb || {}), mix: 1 };
  const dl = { type: 'delay', time: '1/8d', feedback: 0.35, tone: 4500, lowcut: 300, pingpong: true, ...(sends.delay || {}), mix: 1 };
  // ディレイの戻りにもリバーブを少し
  applyChain([dl], busDel[0], busDel[1], ctxBase);
  for (let i = 0; i < n; i++) { busRev[0][i] += busDel[0][i] * 0.25; busRev[1][i] += busDel[1][i] * 0.25; }
  applyChain([rv], busRev[0], busRev[1], ctxBase);
  const rg = dbToGain(sends.reverb?.volume ?? 0), dg = dbToGain(sends.delay?.volume ?? 0);
  for (let i = 0; i < n; i++) {
    mix[0][i] += busRev[0][i] * rg + busDel[0][i] * dg;
    mix[1][i] += busRev[1][i] * rg + busDel[1][i] * dg;
  }
  if (opts.stems) { stems['send:reverb'] = busRev; stems['send:delay'] = busDel; }

  // マスター
  prog((order.length + 1) / (order.length + 2), '仕上げ中…');
  const m = song.master || {};
  const masterFx = m.fx ?? [
    { type: 'eq', bands: [{ type: 'hp', freq: 25, q: 0.7 }] },
    { type: 'comp', threshold: -16, ratio: 2, attack: 0.02, release: 0.2, knee: 8, makeup: 0 },
  ];
  applyChain(masterFx, mix[0], mix[1], ctxBase);
  const [L, R] = mix;
  const vol = dbToGain(m.volume ?? 0);
  if (vol !== 1) for (let i = 0; i < n; i++) { L[i] *= vol; R[i] *= vol; }
  // ラウドネスを目標に合わせてからリミッター（2回で追い込む）
  const target = m.loudness === null ? null : m.loudness ?? -14;
  const ceiling = m.ceiling ?? -1;
  if (target != null) {
    for (let pass = 0; pass < 2; pass++) {
      const lu = loudness(L, R, sr);
      if (!Number.isFinite(lu)) break;
      const g = dbToGain(Math.min(24, target - lu));
      for (let i = 0; i < n; i++) { L[i] *= g; R[i] *= g; }
      limit(L, R, sr, ceiling - 0.3, 0.06, 0.005);
    }
  } else {
    limit(L, R, sr, ceiling - 0.3, 0.06, 0.005);
  }
  // 最後にトゥルーピークを測り、上限を超えていれば全体を少し下げる（サンプル間の山の対策）
  const tp = truePeak(L, R), cg = dbToGain(ceiling);
  if (tp > cg) { const g = (cg / tp) * 0.995; for (let i = 0; i < n; i++) { L[i] *= g; R[i] *= g; } }
  // フェードアウト
  const fo = Math.round((m.fadeOut ?? 0) * sr);
  const endS = Math.round(beats * secPerBeat(song) * sr);
  if (fo > 0) {
    const f0 = Math.max(0, (m.fadeEnd != null ? Math.round(m.fadeEnd * secPerBeat(song) * sr) : n) - fo);
    for (let i = f0; i < n; i++) { const gg = Math.max(0, 1 - (i - f0) / fo); L[i] *= gg * gg; R[i] *= gg * gg; }
  }
  // 末尾の無音を切る（余韻は残す）
  let last = n - 1;
  while (last > endS && Math.abs(L[last]) < 2e-5 && Math.abs(R[last]) < 2e-5) last--;
  const len = Math.min(n, last + Math.round(sr * 0.2));
  const fadeTail = Math.min(len, Math.round(sr * 0.05));
  for (let i = 0; i < fadeTail; i++) { const gg = i / fadeTail; L[len - 1 - i] *= gg; R[len - 1 - i] *= gg; }
  const out = { L: L.subarray(0, len), R: R.subarray(0, len), sr, duration: len / sr, beats, bar: beatsPerBar(song) };
  if (opts.stems) for (const k of Object.keys(stems)) stems[k] = [stems[k][0].subarray(0, len), stems[k][1].subarray(0, len)];
  if (opts.stems) out.stems = stems;
  prog(1, '完了');
  return out;
}

function hasSidechain(tr) {
  return (tr.fx || []).some((f) => f.sidechain);
}

function usedPatterns(song, tr) {
  const ids = new Set((tr.clips || []).map((c) => c.pattern).filter(Boolean));
  return [...ids].map((id) => song.patterns?.[id]);
}

/* ---------------- 自動ミックス ---------------- */

/** トラックの役割（音量の目安を決めるため） */
export function trackRole(tr) {
  const type = tr.type || (tr.kit ? 'drums' : tr.clips?.some((c) => c.sfx) ? 'sfx' : 'inst');
  if (type !== 'inst') return type;
  const name = typeof tr.inst === 'string' ? tr.inst : tr.inst?.preset;
  const cat = INST_PRESETS[name]?.cat;
  if (cat === 'bass') return 'bass';
  if (cat === 'pad') return 'pad';
  if (cat === 'lead') return 'lead';
  return 'harmony';
}

/** 役割ごとの、トラック単体のラウドネスの目安（LUFS）。ここから全体を -14 付近に合わせる */
export const ROLE_TARGET = { drums: -19, bass: -21, lead: -22, harmony: -22.5, pad: -26, sfx: -24 };

/**
 * トラックごとの音を測って、役割に合った音量に揃える（自動ミックス）。
 * lead（メロディ）があるときは伴奏を少し下げる。戻り値：{ id: 新しい volume(dB) }
 */
export function autoMix(song, opts = {}) {
  const sr = opts.sr || 24000; // 測るだけなので軽く
  const flat = { ...song, master: { ...(song.master || {}), loudness: null, fx: [] }, sends: { ...(song.sends || {}), reverb: { ...(song.sends?.reverb || {}), volume: -120 }, delay: { ...(song.sends?.delay || {}), volume: -120 } } };
  flat.tracks = song.tracks.map((t) => ({ ...t, volume: 0, pan: 0, mute: false, solo: false }));
  const out = renderSong(flat, { sr, stems: true, onProgress: opts.onProgress });
  const hasLead = song.tracks.some((t) => trackRole(t) === 'lead' && !t.mute);
  const res = {};
  for (const tr of song.tracks) {
    const id = tr.id || tr.name;
    const st = out.stems[id];
    if (!st) continue;
    const lu = loudness(st[0], st[1], sr);
    if (!Number.isFinite(lu)) continue;
    let target = ROLE_TARGET[trackRole(tr)] ?? -23;
    if (hasLead && trackRole(tr) === 'harmony') target -= 1.5;
    res[id] = Math.max(-40, Math.min(12, Math.round((target - lu) * 2) / 2));
  }
  return res;
}
