/*
 * かなでる：アレンジ画面（トラックとクリップの並び）。
 */
import { $, el, openSheet, closeSheet, toast, TRACK_COLORS } from './ui.js';
import { S, commit, seekBeat, refresh } from './app.js';
import { beatsPerBar, songBeats, trackNotes } from './engine/song.js';
import { pitchesOf } from './engine/dsp.js';
import { INST_PRESETS, KITS } from './engine/presets.js';
import { SFX_PRESETS } from './engine/sfx.js';
import { openClipEditor } from './roll.js';
import { openTrackSettings, pickInstrument, openSfxClip } from './panels.js';

const HDR = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--hdr')) || 112;

export const trackType = (tr) => tr.type || (tr.kit ? 'drums' : tr.clips?.some((c) => c.sfx) ? 'sfx' : 'inst');

export function instLabel(tr) {
  const t = trackType(tr);
  if (t === 'drums') return `ドラム：${KITS[tr.kit || 'acoustic']?.label || tr.kit}`;
  if (t === 'sfx') return '効果音';
  const name = typeof tr.inst === 'string' ? tr.inst : tr.inst?.preset;
  return INST_PRESETS[name]?.label || name || 'カスタム音源';
}

/** クリップの長さ（拍） */
export function clipLen(song, clip) {
  if (clip.len != null) return clip.len * Math.max(1, clip.repeat ?? 1);
  if (clip.sfx) return 2;
  const p = clip.pattern ? song.patterns?.[clip.pattern] : null;
  const notes = trackNotes(song, { clips: [{ ...clip, at: 0, repeat: 1 }] });
  const bpb = beatsPerBar(song);
  const one = p?.len ?? Math.max(bpb, Math.ceil(notes.reduce((m, n) => Math.max(m, n.t + n.d), 0) / bpb) * bpb);
  return one * Math.max(1, clip.repeat ?? 1);
}

let scrollEl = null;

export function initArrange() {
  scrollEl = $('#arr');
  $('#zoomIn').onclick = () => { S.ppb = Math.min(64, S.ppb * 1.4); renderArrange(); };
  $('#zoomOut').onclick = () => { S.ppb = Math.max(6, S.ppb / 1.4); renderArrange(); };
  $('#addTrack').onclick = addTrackMenu;
  $('#clipbar').onclick = (e) => { const a = e.target.closest('button')?.dataset.act; if (a) clipAction(a); };
}

export function renderArrange() {
  const song = S.song;
  const bpb = beatsPerBar(song);
  const beats = Math.max(songBeats(song), bpb * 4) + bpb * 4; // 後ろに少し余白
  const ppb = S.ppb;
  const W = beats * ppb;
  const inner = el('div', { class: 'arr-inner', style: { width: `${W + HDR()}px` } });
  // 目盛り
  const marks = el('div', { class: 'marks', style: { width: `${W}px` } });
  const every = ppb * bpb < 28 ? 4 : ppb * bpb < 50 ? 2 : 1;
  for (let b = 0; b * bpb < beats; b++) {
    if (b % every) continue;
    marks.append(el('div', { class: 'mk', style: { left: `${b * bpb * ppb}px` } }, String(b + 1)));
  }
  if (S.loop) {
    const [a, z] = song.loopBars || [1, Math.round(songBeats(song) / bpb)];
    marks.append(el('div', { class: 'loopband', style: { left: `${(a - 1) * bpb * ppb}px`, width: `${(z - a + 1) * bpb * ppb}px` } }));
  }
  marks.addEventListener('click', (e) => {
    const x = e.clientX - marks.getBoundingClientRect().left;
    seekBeat(Math.round((x / ppb) * 4) / 4);
  });
  inner.append(el('div', { class: 'ruler' }, [el('div', { class: 'corner' }), marks]));

  song.tracks.forEach((tr, ti) => {
    const color = TRACK_COLORS[ti % TRACK_COLORS.length];
    const head = el('div', { class: 'thead', style: { '--tc': color }, onclick: () => openTrackSettings(ti) }, [
      el('div', { class: 'tn' }, tr.name || tr.id),
      el('div', { class: 'ti' }, instLabel(tr)),
      el('div', { class: 'ms' }, [
        el('button', { type: 'button', class: 'm', 'aria-pressed': String(!!tr.mute), onclick: (e) => { e.stopPropagation(); commit((s) => { s.tracks[ti].mute = !s.tracks[ti].mute; }); } }, 'M'),
        el('button', { type: 'button', class: 's', 'aria-pressed': String(!!tr.solo), onclick: (e) => { e.stopPropagation(); commit((s) => { s.tracks[ti].solo = !s.tracks[ti].solo; }); } }, 'S'),
      ]),
    ]);
    const lane = el('div', { class: 'lane', style: { width: `${W}px`, backgroundSize: `${bpb * ppb}px 100%` } });
    lane.addEventListener('click', (e) => {
      if (e.target !== lane) return;
      const x = e.clientX - lane.getBoundingClientRect().left;
      const at = Math.floor(x / ppb / bpb) * bpb;
      addClip(ti, at);
    });
    (tr.clips || []).forEach((c, ci) => lane.append(clipEl(song, tr, ti, c, ci, color)));
    inner.append(el('div', { class: 'trow' }, [head, lane]));
  });
  inner.append(el('div', { class: 'playhead', id: 'playhead' }));
  const sx = scrollEl.scrollLeft, sy = scrollEl.scrollTop;
  scrollEl.replaceChildren(inner);
  scrollEl.scrollLeft = sx; scrollEl.scrollTop = sy;
  updatePlayhead(S.transport.position() / (60 / song.bpm));
  $('#clipbar').hidden = !S.sel || !song.tracks[S.sel.t]?.clips?.[S.sel.c];
}

export function updatePlayhead(beat) {
  const ph = document.getElementById('playhead');
  if (!ph) return;
  const x = HDR() + beat * S.ppb;
  ph.style.left = `${x}px`;
  // 再生中は見える位置に追従
  if (S.transport.playing && scrollEl) {
    const vw = scrollEl.clientWidth;
    if (x - scrollEl.scrollLeft > vw - 40 || x < scrollEl.scrollLeft + HDR()) scrollEl.scrollLeft = Math.max(0, x - HDR() - 20);
  }
}

function clipEl(song, tr, ti, c, ci, color) {
  const len = clipLen(song, c);
  const sel = S.sel && S.sel.t === ti && S.sel.c === ci;
  const x = (c.at ?? 0) * S.ppb, w = Math.max(8, len * S.ppb - 2);
  const label = c.sfx ? (SFX_PRESETS[c.sfx.preset]?.label || '効果音') : c.pattern ? `${c.pattern}${c.repeat > 1 ? ` ×${c.repeat}` : ''}` : c.repeat > 1 ? `×${c.repeat}` : '';
  const cv = el('canvas');
  const d = el('div', { class: `clip${sel ? ' sel' : ''}`, style: { left: `${x}px`, width: `${w}px`, '--tc': color } }, [cv, el('span', { class: 'cl' }, label)]);
  requestAnimationFrame(() => drawClip(cv, song, tr, c, len, color));
  // タップで選択、選択中をタップで編集、ドラッグで移動
  let sx = 0, startAt = 0, moved = false, pid = null;
  d.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    sx = e.clientX; startAt = c.at ?? 0; moved = false; pid = e.pointerId;
    if (sel) d.setPointerCapture(pid);
  });
  d.addEventListener('pointermove', (e) => {
    if (pid !== e.pointerId || !sel) return;
    const dx = e.clientX - sx;
    if (!moved && Math.abs(dx) < 8) return;
    moved = true;
    const bpb = beatsPerBar(song);
    const snap = S.ppb * bpb > 60 ? 1 : bpb;
    const at = Math.max(0, Math.round((startAt + dx / S.ppb) / snap) * snap);
    d.style.left = `${at * S.ppb}px`;
    d.dataset.at = at;
  });
  d.addEventListener('pointerup', (e) => {
    if (pid !== e.pointerId) return;
    pid = null;
    if (moved) {
      const at = Number(d.dataset.at);
      if (at !== startAt) commit((s) => { s.tracks[ti].clips[ci].at = at; });
      return;
    }
    if (sel) openClip(ti, ci);
    else { S.sel = { t: ti, c: ci }; renderArrange(); }
  });
  return d;
}

function drawClip(cv, song, tr, c, len, color) {
  const w = cv.clientWidth, h = cv.clientHeight;
  if (!w || !h) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  cv.width = w * dpr; cv.height = h * dpr;
  const g = cv.getContext('2d');
  g.scale(dpr, dpr);
  g.fillStyle = color;
  if (c.sfx) { g.globalAlpha = 0.6; for (let i = 0; i < w; i += 3) { const a = Math.exp(-i / (w * 0.4)); g.fillRect(i, h / 2 - a * h * 0.35, 2, a * h * 0.7); } return; }
  let notes;
  try { notes = trackNotes(song, { clips: [{ ...c, at: 0 }], swing: tr.swing }); } catch { return; }
  if (!notes.length) return;
  const isDrum = trackType(tr) === 'drums';
  if (isDrum) {
    const names = [...new Set(notes.map((n) => String(n.n)))];
    const rh = (h - 12) / Math.max(1, names.length);
    for (const n of notes) { g.globalAlpha = 0.4 + 0.6 * n.v; g.fillRect((n.t / len) * w, 11 + names.indexOf(String(n.n)) * rh, 2, Math.max(1.5, rh - 1)); }
    return;
  }
  const ps = notes.map((n) => { try { return pitchesOf(n.n); } catch { return []; } });
  const all = ps.flat();
  const lo = Math.min(...all), hi = Math.max(...all);
  const span = Math.max(12, hi - lo + 2);
  notes.forEach((n, k) => {
    for (const m of ps[k]) {
      g.globalAlpha = 0.5 + 0.5 * n.v;
      g.fillRect((n.t / len) * w, 11 + (h - 14) * (1 - (m - lo + 1) / span), Math.max(2, (n.d / len) * w - 1), 2.5);
    }
  });
}

function openClip(ti, ci) {
  const tr = S.song.tracks[ti];
  if (trackType(tr) === 'sfx') return openSfxClip(ti, ci);
  openClipEditor(ti, ci);
}

function addClip(ti, at) {
  const tr = S.song.tracks[ti];
  const bpb = beatsPerBar(S.song);
  const t = trackType(tr);
  if (t === 'sfx') {
    commit((s) => { s.tracks[ti].clips.push({ at, sfx: { preset: 'whoosh' } }); });
    S.sel = { t: ti, c: tr.clips.length - 1 };
    return openSfxClip(ti, S.sel.c);
  }
  commit((s) => {
    const c = t === 'drums' ? { at, len: bpb, grid: { kick: 'x.......x.......'.slice(0, bpb * 4), snare: '....x.......x...'.slice(0, bpb * 4), hat: 'x.x.x.x.x.x.x.x.'.slice(0, bpb * 4) } } : { at, len: bpb, notes: [] };
    s.tracks[ti].clips.push(c);
  });
  S.sel = { t: ti, c: S.song.tracks[ti].clips.length - 1 };
  renderArrange();
  openClipEditor(ti, S.sel.c);
}

function clipAction(a) {
  if (!S.sel) return;
  const { t, c } = S.sel;
  const bpb = beatsPerBar(S.song);
  const clip = S.song.tracks[t]?.clips?.[c];
  if (!clip) return;
  switch (a) {
    case 'edit': return openClip(t, c);
    case 'dup': {
      const len = clipLen(S.song, clip);
      commit((s) => { s.tracks[t].clips.push({ ...structuredClone(clip), at: (clip.at ?? 0) + len }); });
      S.sel = { t, c: S.song.tracks[t].clips.length - 1 };
      return renderArrange();
    }
    case 'left': return commit((s) => { s.tracks[t].clips[c].at = Math.max(0, (clip.at ?? 0) - bpb); });
    case 'right': return commit((s) => { s.tracks[t].clips[c].at = (clip.at ?? 0) + bpb; });
    case 'longer': return commit((s) => { const k = s.tracks[t].clips[c]; if (k.pattern || k.grid) k.repeat = (k.repeat ?? 1) + 1; else k.len = (k.len ?? clipLen(s, k)) + bpb; });
    case 'shorter': return commit((s) => { const k = s.tracks[t].clips[c]; if ((k.pattern || k.grid) && (k.repeat ?? 1) > 1) k.repeat -= 1; else if (!k.pattern && !k.grid) k.len = Math.max(bpb, (k.len ?? clipLen(s, k)) - bpb); });
    case 'del':
      commit((s) => { s.tracks[t].clips.splice(c, 1); });
      S.sel = null;
      return renderArrange();
  }
}

function addTrackMenu() {
  const add = (tr) => { commit((s) => { s.tracks.push(tr); }); closeSheet(); toast(`「${tr.name}」を追加しました`); };
  const uid = () => 't' + Math.random().toString(36).slice(2, 7);
  openSheet('トラックを追加', el('div', { class: 'list' }, [
    el('div', { class: 'item', onclick: () => pickInstrument('piano', (name) => add({ id: uid(), name: INST_PRESETS[name].label, inst: name, volume: -3, sends: { reverb: 0.15 }, clips: [] })) }, [el('div', { class: 'grow' }, ['楽器', el('small', {}, 'ピアノ・シンセ・ベース・ストリングスなど 40 種')])]),
    el('div', { class: 'item', onclick: () => add({ id: uid(), name: 'ドラム', type: 'drums', kit: 'acoustic', volume: 0, clips: [] }) }, [el('div', { class: 'grow' }, ['ドラム', el('small', {}, 'マス目をタップして打ち込む')])]),
    el('div', { class: 'item', onclick: () => add({ id: uid(), name: '効果音', type: 'sfx', volume: -4, clips: [] }) }, [el('div', { class: 'grow' }, ['効果音', el('small', {}, 'ウーシュ・インパクト・ライザーなどを曲の中に置く')])]),
  ]));
}

export { refresh };
