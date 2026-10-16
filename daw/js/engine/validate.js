/*
 * かなでる：曲 JSON の検査。間違いを日本語で返す（Claude が書いた JSON の確認にも使う）。
 */
import { pitchesOf } from './dsp.js';
import { INST_PRESETS, KITS } from './presets.js';
import { DRUM_NAMES, SFX_PRESETS } from './sfx.js';
import { FX_TYPES } from './fx.js';
import { trackNotes } from './song.js';

export function validateSong(song) {
  const errors = [], warnings = [];
  if (!song || typeof song !== 'object') return { errors: ['JSON がオブジェクトではありません'], warnings };
  if (!(song.bpm > 20 && song.bpm < 400)) errors.push(`bpm が不正です（${song.bpm}）`);
  if (!Array.isArray(song.tracks) || !song.tracks.length) errors.push('tracks がありません');
  const ids = new Set();
  const checkFx = (list, where) => {
    for (const f of list || []) {
      if (!FX_TYPES[f?.type]) errors.push(`${where}：不明なエフェクト「${f?.type}」（使えるもの：${Object.keys(FX_TYPES).join(', ')}）`);
      if (f?.sidechain && !song.tracks.some((t) => (t.id || t.name) === f.sidechain)) errors.push(`${where}：サイドチェインの元「${f.sidechain}」というトラックがありません`);
    }
  };
  for (const [k, p] of Object.entries(song.patterns || {})) {
    if (!p.notes && !p.grid) warnings.push(`パターン「${k}」に notes も grid もありません`);
  }
  (song.tracks || []).forEach((tr, i) => {
    const where = `トラック${i + 1}「${tr.name || tr.id || ''}」`;
    const id = tr.id || tr.name;
    if (!id) warnings.push(`${where}：id がありません`);
    if (ids.has(id)) errors.push(`${where}：id「${id}」が重複しています`);
    ids.add(id);
    const type = tr.type || (tr.kit ? 'drums' : tr.clips?.some((c) => c.sfx) ? 'sfx' : 'inst');
    if (type === 'inst') {
      const name = typeof tr.inst === 'string' ? tr.inst : tr.inst?.preset;
      if (name && !INST_PRESETS[name]) errors.push(`${where}：楽器「${name}」がありません（使えるもの：${Object.keys(INST_PRESETS).join(', ')}）`);
      if (!tr.inst) warnings.push(`${where}：inst がないのでピアノになります`);
    }
    if (type === 'drums' && tr.kit && !KITS[tr.kit]) errors.push(`${where}：ドラムキット「${tr.kit}」がありません（${Object.keys(KITS).join(', ')}）`);
    checkFx(tr.fx, where);
    let notes = [];
    try { notes = trackNotes(song, tr); } catch (e) { errors.push(`${where}：${e.message}`); }
    for (const n of notes) {
      if (type === 'drums') {
        if (!DRUM_NAMES.includes(String(n.n))) { errors.push(`${where}：ドラム「${n.n}」がありません（${DRUM_NAMES.join(', ')}）`); break; }
      } else if (type === 'inst') {
        try { pitchesOf(n.n); } catch (e) { errors.push(`${where}：${e.message}`); break; }
        if (!(n.d > 0)) { errors.push(`${where}：長さが 0 以下の音符があります（拍 ${n.t}）`); break; }
      }
      if (!(n.t >= 0)) { errors.push(`${where}：開始位置が不正な音符があります`); break; }
    }
    for (const c of tr.clips || []) {
      if (c.sfx?.preset && !SFX_PRESETS[c.sfx.preset]) errors.push(`${where}：効果音プリセット「${c.sfx.preset}」がありません`);
    }
    if (type === 'inst' && notes.length) {
      const ms = notes.flatMap((n) => { try { return pitchesOf(n.n); } catch { return []; } });
      if (Math.min(...ms) < 21 || Math.max(...ms) > 108) warnings.push(`${where}：ピアノの音域（A0〜C8）を外れた音があります`);
    }
    if ((tr.volume ?? 0) > 6) warnings.push(`${where}：volume が大きすぎます（${tr.volume} dB）`);
  });
  checkFx(song.master?.fx, 'マスター');
  return { errors, warnings };
}
