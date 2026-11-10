/*
 * かなでる：曲 JSON の検査。間違いを日本語で返す（Claude が書いた JSON の確認にも使う）。
 */
import { pitchesOf, noteValue } from './dsp.js';
import { INST_PRESETS, KITS } from './presets.js';
import { DRUM_NAMES, SFX_PRESETS } from './sfx.js';
import { FX_TYPES } from './fx.js';
import { trackNotes } from './song.js';
import { parseChord, parseKey, GEN_INFO, GEN_TYPES } from './arranger.js';

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
  // 和音トラック・音階
  let chordsOk = false;
  if (song.chords != null) {
    if (!Array.isArray(song.chords)) errors.push('chords は [[拍, "Am7"], ...] の配列で書いてください');
    else {
      chordsOk = song.chords.length > 0;
      let prev = -Infinity, unsorted = false;
      song.chords.forEach((c, k) => {
        if (!Array.isArray(c) || c.length < 2) { errors.push(`chords の ${k + 1} 番目：[拍, "和音記号"] の形で書いてください`); chordsOk = false; return; }
        const t = Number(c[0]);
        if (!(t >= 0)) { errors.push(`chords の ${k + 1} 番目：拍（${c[0]}）が不正です`); chordsOk = false; }
        if (String(c[1]).includes(':')) { errors.push(`chords の ${k + 1} 番目：和音トラックではオクターブ（:3）を付けません（${c[1]}）`); chordsOk = false; return; }
        try { parseChord(c[1]); } catch (e) { errors.push(`chords の ${k + 1} 番目（拍 ${c[0]}）：${e.message}`); chordsOk = false; }
        if (t < prev) unsorted = true;
        prev = t;
      });
      if (unsorted) warnings.push('chords が拍の順に並んでいません（拍の順に並べ替えて読みます）');
    }
  }
  if (song.scale != null && !parseKey(song.scale)) errors.push(`scale「${JSON.stringify(song.scale)}」が読めません（例："D yo" "A minor pentatonic"、または音名の配列）`);
  else if (song.scale == null && typeof song.key === 'string' && song.chords != null && !parseKey(song.key)) warnings.push(`key「${song.key}」は音階として読めないので、最初の和音から調を決めます（例："A minor" "D dorian" "E yo"）`);
  const NUM = { intensity: [0, 1], density: [0, 1], vel: [0, 1], swing: [0, 0.7], gate: [0.05, 4], approach: [0, 1], chromatic: [0, 1], octaves: [1, 4], maxNotes: [2, 6], fill: [0, 64], phrase: [1, 8], leap: [0, 1] };
  const checkGen = (g, clip, type, where) => {
    if (typeof g !== 'object' || !g) return errors.push(`${where}：gen はオブジェクトで書いてください`);
    if (!GEN_TYPES.includes(g.type)) return errors.push(`${where}：自動クリップの種類「${g.type}」はありません（${GEN_TYPES.join(', ')}）`);
    if (!(clip.len > 0)) errors.push(`${where}：自動クリップには len（長さ・拍）が必要です`);
    if ((g.type === 'drums') !== (type === 'drums')) errors.push(`${where}：自動クリップ「${g.type}」は${g.type === 'drums' ? 'ドラムのトラック' : '楽器のトラック'}で使います`);
    if (clip.notes || clip.grid || clip.pattern) warnings.push(`${where}：gen があるクリップの notes / grid / pattern は使われません`);
    if (g.type !== 'drums' && !chordsOk) warnings.push(`${where}：和音トラック（chords）がないので、主和音だけで作ります`);
    const info = GEN_INFO[g.type];
    const st = g.type === 'arp' ? g.pattern : g.type === 'melody' ? g.contour : g.style;
    if (st != null && !info.styles.some((s) => s[0] === st)) errors.push(`${where}：${info.label}の${g.type === 'arp' ? 'pattern' : g.type === 'melody' ? 'contour' : 'style'}「${st}」はありません（${info.styles.map((s) => s[0]).join(', ')}）`);
    if (g.voicing != null && !GEN_INFO.chords.voicings.some((v) => v[0] === g.voicing)) errors.push(`${where}：voicing「${g.voicing}」はありません（${GEN_INFO.chords.voicings.map((v) => v[0]).join(', ')}）`);
    if (g.rate != null && !(noteValue(g.rate) > 0)) errors.push(`${where}：rate「${g.rate}」が読めません（"1/8" "1/16" "1/8t" など）`);
    if (g.form != null && !/^[A-Za-z]+$/.test(String(g.form))) errors.push(`${where}：form「${g.form}」は AABA のようにアルファベットで書いてください`);
    if (g.end != null && !['final', 'tonic', 'open'].includes(g.end)) errors.push(`${where}：end「${g.end}」はありません（final, tonic, open）`);
    for (const [k, [lo, hi]] of Object.entries(NUM)) {
      if (g[k] == null || (k === 'pickup')) continue;
      if (typeof g[k] !== 'number' || !(g[k] >= lo && g[k] <= hi)) errors.push(`${where}：gen.${k}（${g[k]}）は ${lo}〜${hi} の数で書いてください`);
    }
  };
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
    (tr.clips || []).forEach((c, k) => { if (c?.gen != null) checkGen(c.gen, c, type, `${where}のクリップ${k + 1}`); });
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
