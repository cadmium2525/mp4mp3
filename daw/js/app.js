/*
 * かなでる：アプリ本体（画面の切り替え、曲の状態、保存、再生、書き出し）。
 */
import { $, el, toast, openSheet, closeSheet, sheetOpen, slider, seg, fmtTime, saveFile } from './ui.js';
import { store } from './store.js';
import { call, encodeMp3, Transport, audio } from './player.js';
import { TEMPLATES, newSong } from './templates.js';
import { beatsPerBar, secPerBeat, songBeats } from './engine/song.js';
import { validateSong } from './engine/validate.js';
import { renderArrange, updatePlayhead, initArrange } from './arrange.js';
import { renderMixer, updateMeters } from './mixer.js';
import { renderViz, tickViz } from './scope.js';
import { openSfxStudio } from './sfxstudio.js';

/* ---------------- 状態 ---------------- */

export const S = {
  song: null,
  past: [],
  future: [],
  sel: null, // { t: トラック番号, c: クリップ番号 }
  ppb: 18, // 1拍の幅（px）
  tab: 'arrange',
  transport: new Transport(),
  rendered: null, // { L, R, sr, duration, rev }
  rev: 0, // 曲を変更するたびに増える
  rendering: null,
  loop: false,
};

/** 曲を変更する（元に戻せるように記録し、保存し、再描画する） */
export function commit(fn, { quiet = false } = {}) {
  S.past.push(JSON.stringify(S.song));
  if (S.past.length > 120) S.past.shift();
  S.future = [];
  fn(S.song);
  changed(quiet);
}

function changed(quiet) {
  S.rev++;
  scheduleSave();
  refresh();
  if (!quiet && S.transport.playing) scheduleRerender();
}

function undo() {
  if (!S.past.length) return;
  S.future.push(JSON.stringify(S.song));
  S.song = JSON.parse(S.past.pop());
  S.sel = null;
  changed();
}
function redo() {
  if (!S.future.length) return;
  S.past.push(JSON.stringify(S.song));
  S.song = JSON.parse(S.future.pop());
  changed();
}

let saveTimer = 0;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => store.put({ id: S.song.id, name: S.song.name, song: S.song }).catch((e) => toast('保存に失敗: ' + e.message)), 500);
}

/** 画面の更新 */
export function refresh() {
  if (!S.song) return;
  $('#songName').textContent = S.song.name || '無題';
  $('#bpmBtn').textContent = `${S.song.bpm} BPM`;
  $('#undo').disabled = !S.past.length;
  $('#redo').disabled = !S.future.length;
  $('#loopBtn').setAttribute('aria-pressed', String(S.loop));
  if (S.tab === 'arrange') renderArrange();
  if (S.tab === 'mixer') renderMixer();
  if (S.tab === 'viz') renderViz();
}

/* ---------------- 描画（ワーカー） ---------------- */

function setStatus(text, busy = false) {
  const s = $('#status');
  s.textContent = text;
  s.classList.toggle('busy', busy);
}

/** 今の曲を音にする（変更がなければ前の結果を使う） */
export async function ensureRendered() {
  if (S.rendered && S.rendered.rev === S.rev) return S.rendered;
  if (S.rendering && S.rendering.rev === S.rev) return S.rendering.p;
  const rev = S.rev;
  const p = call('render', { song: S.song }, (p, label) => setStatus(`${Math.round(p * 100)}% ${label}`, true))
    .then((m) => {
      if (rev !== S.rev && S.rendering?.rev !== rev) { /* 古い結果でも、何もないよりは使う */ }
      S.rendered = { L: m.L, R: m.R, sr: m.sr, duration: m.duration, rev };
      S.transport.setBuffer(m.L, m.R, m.sr);
      setStatus(`${fmtTime(m.duration)}`);
      return S.rendered;
    })
    .catch((e) => { setStatus('エラー'); toast(e.message, 5000); throw e; })
    .finally(() => { if (S.rendering?.rev === rev) S.rendering = null; });
  S.rendering = { rev, p };
  return p;
}

let rerenderTimer = 0;
function scheduleRerender() {
  clearTimeout(rerenderTimer);
  rerenderTimer = setTimeout(async () => {
    const pos = S.transport.position();
    await ensureRendered().catch(() => null);
    if (S.transport.playing) S.transport.seek(Math.min(pos + 0.0, S.transport.duration));
  }, 450);
}

/* ---------------- 再生 ---------------- */

export const beatToSec = (b) => b * secPerBeat(S.song);
export const secToBeat = (s) => s / secPerBeat(S.song);

function loopRange() {
  if (!S.loop) return null;
  const bpb = beatsPerBar(S.song);
  const L = S.song.loopBars || [1, Math.round(songBeats(S.song) / bpb)];
  return [beatToSec((L[0] - 1) * bpb), beatToSec(L[1] * bpb)];
}

async function togglePlay() {
  audio();
  const T = S.transport;
  if (T.playing) { T.pause(); document.body.classList.remove('playing'); return; }
  try {
    await ensureRendered();
  } catch { return; }
  T.loop = loopRange();
  T.play(T.startPos);
  document.body.classList.add('playing');
  T.onEnd = () => document.body.classList.remove('playing');
}

export function seekBeat(beat) {
  S.transport.seek(beatToSec(Math.max(0, beat)));
  tick(true);
}

function tick(force) {
  if (S.song && (S.transport.playing || force)) {
    const t = S.transport.position();
    const beat = secToBeat(t);
    const bpb = beatsPerBar(S.song);
    $('#pos').textContent = `${Math.floor(beat / bpb) + 1}.${Math.floor(beat % bpb) + 1}`;
    $('#posSec').textContent = fmtTime(t);
    if (S.tab === 'arrange') updatePlayhead(beat);
    if (S.tab === 'mixer') updateMeters();
    if (S.tab === 'viz') tickViz();
  }
  if (!force) requestAnimationFrame(() => tick());
}

/* ---------------- 画面 ---------------- */

function show(id) {
  for (const s of document.querySelectorAll('.screen')) s.hidden = s.id !== id;
}

async function renderHome() {
  show('home');
  const tp = $('#templates');
  tp.replaceChildren(...TEMPLATES.map((t) => el('button', { class: 'tpl', type: 'button', onclick: () => createSong(t.id) }, [el('i'), el('b', {}, t.label), el('small', {}, t.desc)])));
  const list = await store.list().catch(() => []);
  const ul = $('#songs');
  if (!list.length) { ul.replaceChildren(el('li', { class: 'empty-note' }, 'まだ曲がありません。上のひな形から始めましょう。')); return; }
  ul.replaceChildren(...list.map((it) => el('li', { class: 'song-item', onclick: () => openSong(it.id) }, [
    el('div', { class: 'si' }, [el('div', { class: 'sn' }, it.name || '無題'), el('div', { class: 'sm' }, `${it.song?.bpm || '?'} BPM ・ ${it.song?.tracks?.length || 0} トラック ・ ${new Date(it.updated).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`)]),
    el('button', { class: 'icon-btn sm', type: 'button', 'aria-label': 'その他', onclick: (e) => { e.stopPropagation(); songMenu(it); }, html: '<svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/></svg>' }),
  ])));
}

function songMenu(it) {
  openSheet(it.name || '無題', [
    el('div', { class: 'list' }, [
      el('div', { class: 'item', onclick: async () => { const s = structuredClone(it.song); s.id = Math.random().toString(36).slice(2, 10); s.name = (s.name || '無題') + ' のコピー'; await store.put({ id: s.id, name: s.name, song: s }); closeSheet(); renderHome(); } }, '複製'),
      el('div', { class: 'item', onclick: async () => { if (!confirm(`「${it.name}」を削除しますか？`)) return; await store.del(it.id); closeSheet(); renderHome(); } }, el('span', { style: { color: 'var(--danger)' } }, '削除')),
    ]),
  ]);
}

async function createSong(tid) {
  const song = newSong(tid);
  await store.put({ id: song.id, name: song.name, song });
  openSong(song.id, song);
}

async function openSong(id, song) {
  if (!song) song = (await store.get(id))?.song;
  if (!song) return toast('曲が見つかりません');
  S.song = song;
  S.past = []; S.future = []; S.sel = null; S.rendered = null; S.rev++;
  S.transport.pause(); S.transport.startPos = 0;
  document.body.classList.remove('playing');
  show('song');
  setTab('arrange');
  setStatus('');
  history.replaceState(null, '', '#song=' + song.id);
}

function setTab(tab) {
  S.tab = tab;
  for (const b of $('#tabs').children) b.setAttribute('aria-selected', String(b.dataset.tab === tab));
  $('#arrangeView').hidden = tab !== 'arrange';
  $('#mixerView').hidden = tab !== 'mixer';
  $('#vizView').hidden = tab !== 'viz';
  refresh();
}

/* ---------------- 曲の設定・メニュー ---------------- */

function songSettings() {
  const s = S.song;
  const bpb = beatsPerBar(s);
  const name = el('input', { type: 'text', value: s.name || '' });
  name.addEventListener('change', () => commit((x) => { x.name = name.value.trim() || '無題'; }, { quiet: true }));
  const bars = Math.round(songBeats(s) / bpb);
  openSheet('曲の設定', [
    el('div', { class: 'field' }, [el('label', {}, '曲名'), name]),
    slider({ label: 'テンポ', min: 50, max: 200, step: 1, value: s.bpm, fmt: (v) => `${v} BPM`, onChange: (v) => commit((x) => { x.bpm = v; }) }),
    el('div', { class: 'field' }, [el('div', { class: 'lbl' }, '拍子'), seg([['4/4', '4/4'], ['3/4', '3/4'], ['6/8', '6/8']], (s.sig || [4, 4]).join('/'), (v) => commit((x) => { x.sig = v.split('/').map(Number); }))]),
    slider({ label: '長さ（小節）', min: 1, max: 128, step: 1, value: s.bars || bars, fmt: (v) => `${v} 小節`, onChange: (v) => commit((x) => { x.bars = v; }) }),
    el('div', { class: 'field' }, [el('div', { class: 'lbl' }, '仕上がりの音量（ラウドネス）'), seg([[-14, '-14（YouTube・配信）'], [-16, '-16（ポッドキャスト）'], [-12, '-12（大きめ）'], [-20, '-20（BGM控えめ）']], s.master?.loudness ?? -14, (v) => commit((x) => { x.master = { ...(x.master || {}), loudness: v }; }))]),
    slider({ label: '最後のフェードアウト', min: 0, max: 8, step: 0.5, value: s.master?.fadeOut ?? 0, fmt: (v) => (v ? `${v} 秒` : 'なし'), onChange: (v) => commit((x) => { x.master = { ...(x.master || {}), fadeOut: v }; }) }),
    slider({ label: '共有リバーブの長さ', min: 0.5, max: 6, step: 0.1, value: s.sends?.reverb?.decay ?? 2.2, fmt: (v) => `${v.toFixed(1)} 秒`, onChange: (v) => commit((x) => { x.sends = { ...(x.sends || {}), reverb: { ...(x.sends?.reverb || {}), decay: v } }; }) }),
    el('div', { class: 'field' }, [el('div', { class: 'lbl' }, 'ディレイの間隔'), seg([['1/8', '8分'], ['1/8d', '付点8分'], ['1/4', '4分'], ['1/16', '16分']], s.sends?.delay?.time ?? '1/8d', (v) => commit((x) => { x.sends = { ...(x.sends || {}), delay: { ...(x.sends?.delay || {}), time: v } }; }))]),
    el('div', { class: 'field' }, [el('div', { class: 'lbl' }, 'ループ再生の範囲（小節）'), loopEditor()]),
  ]);
}

function loopEditor() {
  const bpb = beatsPerBar(S.song);
  const total = Math.max(1, Math.round(songBeats(S.song) / bpb));
  const [a, b] = S.song.loopBars || [1, total];
  const mk = (v) => { const i = el('input', { type: 'number', min: 1, max: total, value: v, style: { width: '80px' } }); return i; };
  const ia = mk(a), ib = mk(b);
  const apply = () => commit((x) => { const s0 = Math.max(1, Math.min(total, Number(ia.value) || 1)); const s1 = Math.max(s0, Math.min(total, Number(ib.value) || total)); x.loopBars = [s0, s1]; }, { quiet: true });
  ia.addEventListener('change', apply); ib.addEventListener('change', apply);
  return el('div', { class: 'row' }, [ia, '〜', ib, '小節']);
}

function mainMenu() {
  const items = [
    ['曲の設定（テンポ・長さ・音量）', songSettings],
    ['JSON をコピー（AI に渡す）', copyJson],
    ['JSON を貼り付け', pasteJson],
    ['見える化シートを画像で保存', () => { closeSheet(); setTab('viz'); setTimeout(() => document.dispatchEvent(new CustomEvent('kanaderu:sheet')), 50); }],
    ['効果音スタジオ', () => { closeSheet(); openSfxStudio({ back: () => show('song') }); }],
  ];
  openSheet('メニュー', el('div', { class: 'list' }, items.map(([label, fn]) => el('div', { class: 'item', onclick: fn }, label))));
}

async function copyJson() {
  const { id, ...rest } = S.song;
  const txt = JSON.stringify(rest, null, 1);
  try { await navigator.clipboard.writeText(txt); toast('JSON をコピーしました'); closeSheet(); } catch {
    openSheet('JSON', [el('p', { class: 'note' }, '全選択してコピーしてください'), el('textarea', { value: txt, rows: 16 })]);
  }
}

function pasteJson() {
  const ta = el('textarea', { rows: 14, placeholder: '{ "bpm": 100, "tracks": [...] }' });
  const err = el('div', { class: 'err' });
  openSheet('JSON を貼り付け', [
    el('p', { class: 'note' }, 'Claude などが書いた曲の JSON を貼り付けると、今の曲がその内容に置き換わります（元に戻すこともできます）。'),
    ta, err,
    el('button', { class: 'btn primary wide', type: 'button', style: { marginTop: '10px' }, onclick: () => {
      let j;
      try { j = JSON.parse(ta.value.replace(/^```(json)?|```$/gm, '')); } catch (e) { err.textContent = 'JSON として読めません: ' + e.message; return; }
      const chk = validateSong(j);
      if (chk.errors.length) { err.textContent = chk.errors.join('\n'); return; }
      commit((x) => { const id = x.id; for (const k of Object.keys(x)) delete x[k]; Object.assign(x, j, { id }); });
      S.sel = null;
      closeSheet();
      toast(chk.warnings.length ? `反映しました（注意 ${chk.warnings.length} 件）` : '反映しました');
    } }, '反映する'),
  ], { tall: true });
}

async function importJsonHome() {
  const ta = el('textarea', { rows: 14, placeholder: '{ "bpm": 100, "tracks": [...] }' });
  const err = el('div', { class: 'err' });
  openSheet('JSON から作成', [ta, err, el('button', { class: 'btn primary wide', type: 'button', style: { marginTop: '10px' }, onclick: async () => {
    let j;
    try { j = JSON.parse(ta.value.replace(/^```(json)?|```$/gm, '')); } catch (e) { err.textContent = 'JSON として読めません: ' + e.message; return; }
    const chk = validateSong(j);
    if (chk.errors.length) { err.textContent = chk.errors.join('\n'); return; }
    j.id = Math.random().toString(36).slice(2, 10);
    j.name = j.name || 'JSON の曲';
    await store.put({ id: j.id, name: j.name, song: j });
    closeSheet();
    openSong(j.id, j);
  } }, '作成')], { tall: true });
}

/* ---------------- 書き出し ---------------- */

function exportSheet() {
  let fmt = 'mp3';
  openSheet('書き出し', [
    el('div', { class: 'field' }, [el('div', { class: 'lbl' }, '形式'), seg([['mp3', 'MP3（320kbps）'], ['wav24', 'WAV 24bit'], ['wav16', 'WAV 16bit']], fmt, (v) => (fmt = v))]),
    el('p', { class: 'note' }, `仕上がりの音量：${S.song.master?.loudness ?? -14} LUFS、ピークは -1 dBTP 以下に自動で抑えます（曲の設定で変更できます）。`),
    el('button', { class: 'btn primary wide', type: 'button', onclick: async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      try {
        const r = await ensureRendered();
        const base = (S.song.name || 'kanaderu').replace(/[\\/:*?"<>|]/g, '_');
        if (fmt === 'mp3') {
          btn.textContent = 'MP3 に変換中…';
          const m = await encodeMp3(r.L, r.R, r.sr, 320, (p) => (btn.textContent = `MP3 に変換中… ${Math.round(p * 100)}%`));
          await saveFile(m.blob, `${base}.mp3`, 'audio/mpeg');
        } else {
          const m = await call('wav', { L: r.L, R: r.R, sr: r.sr, bits: fmt === 'wav16' ? 16 : 24 });
          await saveFile(m.bytes, `${base}.wav`, 'audio/wav');
        }
        closeSheet();
      } catch (err) { toast('書き出しに失敗: ' + err.message, 5000); } finally { btn.disabled = false; btn.textContent = '書き出す'; }
    } }, '書き出す'),
  ]);
}

/* ---------------- 起動 ---------------- */

function bind() {
  $('#back').onclick = () => { S.transport.pause(); document.body.classList.remove('playing'); history.replaceState(null, '', '#'); renderHome(); };
  $('#undo').onclick = undo;
  $('#redo').onclick = redo;
  $('#menuBtn').onclick = mainMenu;
  $('#songName').onclick = songSettings;
  $('#bpmBtn').onclick = songSettings;
  $('#exportBtn').onclick = exportSheet;
  $('#playBtn').onclick = togglePlay;
  $('#stopBtn').onclick = () => seekBeat(0);
  $('#loopBtn').onclick = () => { S.loop = !S.loop; S.transport.loop = loopRange(); if (S.transport.playing) S.transport.seek(S.transport.position()); refresh(); };
  $('#tabs').onclick = (e) => { const t = e.target.closest('button')?.dataset.tab; if (t) setTab(t); };
  $('#sheetClose').onclick = closeSheet;
  $('#sheetBackdrop').onclick = closeSheet;
  $('#importJson').onclick = importJsonHome;
  $('#openSfx').onclick = () => openSfxStudio({ back: renderHome });
  document.addEventListener('keydown', (e) => {
    if (e.target.matches('input, textarea, select')) return;
    if (e.code === 'Space' && !$('#song').hidden) { e.preventDefault(); togglePlay(); }
    if ((e.metaKey || e.ctrlKey) && e.key === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
    if (e.key === 'Escape' && sheetOpen()) closeSheet();
  });
  initArrange();
}

bind();
const m = /#song=(\w+)/.exec(location.hash);
if (m) openSong(m[1]); else renderHome();
requestAnimationFrame(() => tick());

if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});

export { show, setTab };
