import { makeZip } from './zip.js';
import { extractAudioTrack, buildM4a, buildAdts, sliceTrack } from './mp4.js';

const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];

/* ============ 設定 ============ */

const DEFAULTS = {
  format: 'mp3',
  bitrate: 192,
  channels: 'auto',
  sampleRate: 44100,
  normMode: 'off',
  lufsTarget: -16,
  peakTarget: -1,
  maxGain: 20,
  ceiling: -1,
  silence: false,
  silenceDb: -50,
  fadeIn: 0,
  fadeOut: 0,
  join: false,
  joinName: '',
  tagTitle: true,
  artist: '',
  album: '',
};
const STORE_KEY = 'otodake.settings.v1';

let settings = { ...DEFAULTS };
try {
  Object.assign(settings, JSON.parse(localStorage.getItem(STORE_KEY) || '{}'));
} catch { /* プライベートモードなど */ }

function saveSettings() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(settings)); } catch { /* 保存できなくても動作は続ける */ }
}

const form = $('#settings');

function settingsToForm() {
  for (const el of form.elements) {
    if (!el.name || !(el.name in settings)) continue;
    const v = settings[el.name];
    if (el.type === 'checkbox') el.checked = !!v;
    else if (el.type === 'radio') el.checked = el.value === String(v);
    else el.value = String(v);
  }
  updateConditional();
}

function updateConditional() {
  for (const el of $$('[data-show-if]')) {
    const [k, v] = el.dataset.showIf.split('=');
    el.hidden = String(settings[k]) !== v;
  }
  for (const out of $$('output[data-out]')) {
    const k = out.dataset.out;
    const v = settings[k];
    out.textContent = k === 'lufsTarget' ? `${v} LUFS` : `${v} dB`;
    if (k === 'lufsTarget') {
      const small = document.createElement('small');
      small.textContent = lufsWord(v);
      out.append(small);
    }
  }
  for (const chip of $$('.chip[data-set]')) {
    const [k, v] = chip.dataset.set.split('=');
    chip.classList.toggle('on', String(settings[k]) === v);
  }
  for (const el of $$('[data-hide-if]')) {
    const [k, v] = el.dataset.hideIf.split('=');
    el.hidden = String(settings[k]) === v;
  }
  const ext = settings.format;
  for (const it of state.items) it.refs.ext.textContent = '.' + ext;
  for (const el of $$('#rnList .ext')) el.textContent = '.' + ext;
  updateSettingsSummary();
  updateConvertButton();
}

function lufsWord(v) {
  if (v >= -12) return 'とても大きい';
  if (v >= -15) return '大きめ（音楽配信）';
  if (v >= -18) return '標準（ポッドキャスト）';
  if (v >= -24) return 'やや小さめ（テレビ放送）';
  if (v >= -32) return '小さめ';
  return 'かなり小さい';
}

function updateSettingsSummary() {
  if (settings.format === 'm4a') { $('#settingsSummary').textContent = 'M4A（劣化なし）'; return; }
  const parts = [settings.format === 'mp3' ? `MP3 ${settings.bitrate}k` : 'WAV'];
  if (settings.channels === '1') parts.push('モノラル');
  if (settings.normMode === 'lufs') parts.push(`音量統一 ${settings.lufsTarget}LUFS`);
  if (settings.normMode === 'peak') parts.push(`ピーク ${settings.peakTarget}dB`);
  if (settings.silence) parts.push('無音カット');
  if (settings.join) parts.push('結合');
  $('#settingsSummary').textContent = parts.join(' · ');
}

form.addEventListener('change', (e) => {
  const el = e.target;
  if (!el.name || !(el.name in settings)) return;
  let v;
  if (el.type === 'checkbox') v = el.checked;
  else if ('num' in el.dataset) v = Number(el.value);
  else v = el.value;
  const rateChanged = el.name === 'sampleRate' && v !== settings.sampleRate;
  settings[el.name] = v;
  saveSettings();
  settingsToForm(); // 同じ name を持つ別の入力欄にも反映
  if (rateChanged) toast('次に変換するときから反映されます');
});
form.addEventListener('input', (e) => {
  const el = e.target;
  if (!(el.name in settings)) return;
  if (el.type === 'text') { settings[el.name] = el.value; saveSettings(); }
  if (el.type === 'range') { settings[el.name] = Number(el.value); saveSettings(); updateConditional(); }
});
for (const chip of $$('.chip[data-set]')) {
  chip.addEventListener('click', () => {
    const [k, v] = chip.dataset.set.split('=');
    settings[k] = Number(v);
    saveSettings();
    settingsToForm();
  });
}
$('#resetSettings').addEventListener('click', () => {
  settings = { ...DEFAULTS };
  saveSettings();
  settingsToForm();
  toast('設定を初期値に戻しました');
});

/* ============ ワーカー ============ */

const worker = new Worker(new URL('./worker.js', import.meta.url));
const pending = new Map();
let seq = 0;

worker.onmessage = (e) => {
  const m = e.data;
  const p = pending.get(m.id);
  if (!p) return;
  if (m.type === 'progress') { p.onProgress && p.onProgress(m); return; }
  pending.delete(m.id);
  if (m.type === 'error') p.reject(new Error(m.message));
  else p.resolve(m);
};
worker.onerror = (e) => {
  for (const p of pending.values()) p.reject(new Error(e.message || '処理中にエラーが発生しました'));
  pending.clear();
};

function callWorker(msg, transfer = [], onProgress) {
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, onProgress });
    worker.postMessage({ ...msg, id }, transfer);
  });
}

/* ============ デコード ============ */

function decodeWith(ctx, data) {
  return new Promise((resolve, reject) => {
    const p = ctx.decodeAudioData(data, resolve, reject);
    if (p && p.then) p.then(resolve, reject);
  });
}

/** Blob をデコード。OfflineAudioContext で失敗したら通常の AudioContext でも試す */
async function decodeBlob(blob, sampleRate) {
  const data = await blob.arrayBuffer();
  const Offline = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  try {
    return await decodeWith(new Offline(1, 1, sampleRate), data.slice(0));
  } catch (err1) {
    const AC = window.AudioContext || window.webkitAudioContext;
    let ac;
    try { ac = new AC({ sampleRate }); } catch { ac = new AC(); }
    try {
      return await resample(await decodeWith(ac, data), sampleRate);
    } finally {
      ac.close && ac.close().catch(() => {});
    }
  }
}

async function resample(buf, sampleRate) {
  if (buf.sampleRate === sampleRate) return buf;
  const Offline = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const ctx = new Offline(buf.numberOfChannels, Math.ceil(buf.duration * sampleRate), sampleRate);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.connect(ctx.destination);
  src.start();
  return ctx.startRendering();
}

/** MOV/MP4 なら音声トラックを取り出しておく（失敗しても item.track = null） */
async function loadTrack(item) {
  if (item.track !== undefined) return item.track;
  try {
    item.track = await extractAudioTrack(item.file);
  } catch (err) {
    item.track = null;
    item.trackError = err;
  }
  return item.track;
}

/**
 * ファイルをデコードする。Safari は .mov を直接読めないことがあるので、
 * 取り出した音声を M4A → ADTS(AAC) → 元ファイルの順に試す。
 */
async function decodeItem(item, sampleRate) {
  const track = await loadTrack(item);
  const ways = [];
  if (track) ways.push(['m4a', () => buildM4a(track)], ['adts', () => buildAdts(track)]);
  if (!track || item.kind === 'audio') ways.push(['raw', () => item.file]);
  if (item.decodeVia) ways.sort((a, b) => (b[0] === item.decodeVia) - (a[0] === item.decodeVia));

  const errors = [];
  for (const [via, make] of ways) {
    try {
      const buf = await decodeBlob(make(), sampleRate);
      item.decodeVia = via;
      return buf;
    } catch (err) {
      errors.push(`${via}:${(err && (err.name || err.message)) || err}`);
    }
  }
  const te = item.trackError;
  if (te && te.code === 'no-audio') throw new Error('この動画には音声が入っていません（画面収録のときにマイクやアプリの音がオフだった可能性があります）');
  if (te && (te.code === 'codec' || te.code === 'broken')) throw new Error(te.message);
  throw new Error(`音声を読み込めませんでした（対応していない形式の可能性があります）［${errors.join(' / ')}］`);
}

function copyChannels(buf) {
  const n = Math.min(2, buf.numberOfChannels);
  const out = [];
  for (let c = 0; c < n; c++) out.push(buf.getChannelData(c).slice());
  return out;
}

/* ============ ファイル一覧 ============ */

const state = {
  items: [],
  results: [],
  busy: false,
};
let itemSeq = 0;
const listEl = $('#list');
const itemTpl = $('#itemTpl');

function baseName(name) {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(0, i) : name;
}

function addFiles(files) {
  const accepted = [...files].filter((f) => /^(video|audio)\//.test(f.type) || /\.(mov|mp4|m4v|m4a|mp3|wav|aac|caf|aiff?|ogg|opus|webm|flac|3gp)$/i.test(f.name));
  if (accepted.length < files.length) toast(`${files.length - accepted.length}件は動画・音声ではないため追加しませんでした`);
  for (const file of accepted) {
    const item = {
      id: ++itemSeq,
      file,
      original: baseName(file.name),
      name: baseName(file.name),
      kind: file.type.startsWith('video/') || /\.(mov|mp4|m4v|webm|3gp)$/i.test(file.name) ? 'video' : 'audio',
      status: 'waiting',
      duration: 0,
      trimStart: 0,
      trimEnd: 0,
    };
    buildCard(item);
    state.items.push(item);
    listEl.appendChild(item.el);
    queueAnalyze(item);
  }
  refreshList();
}

function buildCard(item) {
  const el = itemTpl.content.firstElementChild.cloneNode(true);
  const refs = {
    name: $('.name', el),
    ext: $('.ext', el),
    kind: $('.kind', el),
    meta: $('.meta', el),
    canvas: $('.wave', el),
    status: $('.wave-status', el),
    rStart: $('.r-start', el),
    rEnd: $('.r-end', el),
    tStart: $('.t-start', el),
    tEnd: $('.t-end', el),
  };
  item.el = el;
  item.refs = refs;
  refs.name.value = item.name;
  refs.ext.textContent = '.' + settings.format;
  refs.kind.textContent = item.kind === 'video' ? '動画' : '音声';

  refs.name.addEventListener('input', () => { item.name = refs.name.value; syncRenameRow(item); });
  refs.name.addEventListener('blur', () => {
    if (!refs.name.value.trim()) setName(item, item.original);
  });
  $('.remove', el).addEventListener('click', () => removeItem(item));
  $('.up', el).addEventListener('click', () => moveItem(item, -1));
  $('.down', el).addEventListener('click', () => moveItem(item, 1));
  $('.play', el).addEventListener('click', () => togglePreview(item));

  const setStart = (v) => {
    item.trimStart = clamp(v, 0, Math.max(0, item.trimEnd - 0.1));
    syncTrim(item);
  };
  const setEnd = (v) => {
    item.trimEnd = clamp(v, Math.min(item.duration, item.trimStart + 0.1), item.duration);
    syncTrim(item);
  };
  refs.rStart.addEventListener('input', () => setStart(Number(refs.rStart.value)));
  refs.rEnd.addEventListener('input', () => setEnd(Number(refs.rEnd.value)));
  refs.tStart.addEventListener('change', () => { const v = parseTime(refs.tStart.value); v == null ? syncTrim(item) : setStart(v); });
  refs.tEnd.addEventListener('change', () => { const v = parseTime(refs.tEnd.value); v == null ? syncTrim(item) : setEnd(v); });

  // 波形タップでその位置から試聴
  refs.canvas.addEventListener('click', (e) => {
    if (item.status !== 'ready') return;
    const r = refs.canvas.getBoundingClientRect();
    const t = ((e.clientX - r.left) / r.width) * item.duration;
    startPreview(item, clamp(t, item.trimStart, item.trimEnd - 0.05));
  });
  updateCard(item);
}

function syncTrim(item) {
  const { rStart, rEnd, tStart, tEnd } = item.refs;
  for (const r of [rStart, rEnd]) r.max = String(item.duration);
  rStart.value = String(item.trimStart);
  rEnd.value = String(item.trimEnd);
  tStart.value = fmtTime(item.trimStart, true);
  tEnd.value = fmtTime(item.trimEnd, true);
  updateMeta(item);
  drawWave(item);
}

function updateCard(item) {
  item.el.classList.toggle('ready', item.status === 'ready');
  item.el.classList.toggle('error', item.status === 'error');
  const st = item.refs.status;
  st.textContent = item.status === 'waiting' ? '待機中…' : item.status === 'analyzing' ? '読み込み中…' : '';
  if (item.status === 'ready') syncTrim(item);
  else { updateMeta(item); drawWave(item); }
}

function updateMeta(item) {
  const m = item.refs.meta;
  const parts = [];
  if (item.status === 'error') {
    m.innerHTML = '';
    const s = document.createElement('span');
    s.className = 'err';
    s.textContent = item.error;
    m.append(s);
    return;
  }
  parts.push(fmtBytes(item.file.size));
  if (item.status === 'ready') {
    const len = item.trimEnd - item.trimStart;
    const trimmed = item.trimStart > 0.05 || item.trimEnd < item.duration - 0.05;
    parts.push(trimmed ? `${fmtTime(len)}（元 ${fmtTime(item.duration)}）` : fmtTime(item.duration));
    parts.push(item.numChannels >= 2 ? 'ステレオ' : 'モノラル');
    if (isFinite(item.lufs)) parts.push(`音量 ${item.lufs.toFixed(1)} LUFS`);
    else if (item.decodeError) parts.push('波形なし（M4A（劣化なし）で保存できます）');
    else parts.push('ほぼ無音');
  }
  m.textContent = '';
  for (const p of parts) { const s = document.createElement('span'); s.textContent = p; m.append(s); }
}

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function drawWave(item) {
  const cv = item.refs.canvas;
  const w = cv.clientWidth, h = cv.clientHeight;
  if (!w) return;
  const dpr = window.devicePixelRatio || 1;
  if (cv.width !== Math.round(w * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  if (!item.peaks) return;

  const peaks = item.peaks;
  const max = Math.max(1e-4, ...peaks);
  const bars = Math.floor(w / 3);
  const xs = item.trimStart / item.duration * w;
  const xe = item.trimEnd / item.duration * w;
  const cOn = cssVar('--wave-active'), cOff = cssVar('--wave');
  for (let i = 0; i < bars; i++) {
    const p = peaks[Math.floor(i / bars * peaks.length)] / max;
    const bh = Math.max(1.5, Math.sqrt(p) * (h - 10));
    const x = i * 3;
    ctx.fillStyle = x >= xs && x <= xe ? cOn : cOff;
    ctx.fillRect(x, (h - bh) / 2, 2, bh);
  }
  // 再生位置
  if (preview.item === item && preview.time != null) {
    const x = preview.time / item.duration * w;
    ctx.fillStyle = cssVar('--text');
    ctx.fillRect(x - 1, 0, 2, h);
  }
}

function removeItem(item) {
  if (state.busy) return;
  if (preview.item === item) stopPreview();
  if (item.url) URL.revokeObjectURL(item.url);
  item.removed = true;
  item.el.remove();
  state.items = state.items.filter((i) => i !== item);
  refreshList();
}

function moveItem(item, d) {
  const i = state.items.indexOf(item);
  const j = i + d;
  if (j < 0 || j >= state.items.length) return;
  [state.items[i], state.items[j]] = [state.items[j], state.items[i]];
  reorderDom();
}

function reorderDom() {
  for (const it of state.items) listEl.appendChild(it.el);
  refreshList();
}

function refreshList() {
  const n = state.items.length;
  $('#listSection').hidden = n === 0;
  $('#renamePanel').hidden = n === 0;
  $('#actionbar').hidden = n === 0 && !state.busy;
  $('#count').textContent = n ? `${n}件` : '';
  updateConvertButton();
  renderRenameList();
}

function updateConvertButton() {
  const ready = state.items.filter((i) => i.status === 'ready').length;
  const waiting = state.items.some((i) => i.status === 'waiting' || i.status === 'analyzing');
  const btn = $('#convert');
  btn.disabled = state.busy || ready === 0;
  if (state.busy) btn.textContent = '変換中…';
  else if (waiting && ready === 0) btn.textContent = '読み込み中…';
  else btn.textContent = ready > 1 ? (settings.join && settings.format !== 'm4a' ? `${ready}件を結合して変換` : `${ready}件を変換する`) : '変換する';
}

$('#clearAll').addEventListener('click', () => {
  if (state.busy) return;
  for (const it of [...state.items]) removeItem(it);
});

/* 解析は1件ずつ順番に（メモリ節約のため） */
let analyzeChain = Promise.resolve();
function queueAnalyze(item) {
  analyzeChain = analyzeChain.then(() => analyze(item));
}

async function analyze(item) {
  if (item.removed) return;
  item.status = 'analyzing';
  updateCard(item);
  try {
    const buf = await decodeItem(item, settings.sampleRate);
    item.duration = buf.duration;
    item.numChannels = buf.numberOfChannels;
    item.trimStart = 0;
    item.trimEnd = buf.duration;
    const chs = copyChannels(buf);
    const r = await callWorker({ type: 'analyze', channels: chs, sampleRate: buf.sampleRate, bins: 400 }, chs.map((c) => c.buffer));
    item.lufs = r.lufs;
    item.peakDb = r.peakDb;
    item.peaks = r.peaks;
    item.status = 'ready';
  } catch (err) {
    if (item.track) {
      // デコードできなくても音声トラックは取り出せている → M4A（劣化なし）なら保存できる
      item.decodeError = err.message;
      item.duration = item.track.duration;
      item.numChannels = item.track.channels;
      item.trimStart = 0;
      item.trimEnd = item.track.duration;
      item.lufs = NaN;
      item.status = 'ready';
      if (settings.format !== 'm4a') {
        settings.format = 'm4a';
        saveSettings();
        settingsToForm();
        toast('この動画は「M4A（劣化なし）」で保存できます。出力形式を切り替えました');
      }
    } else {
      item.status = 'error';
      item.error = err.message;
    }
  }
  if (!item.removed) updateCard(item);
  updateConvertButton();
}

/* ============ 試聴 ============ */

const player = $('#player');
const preview = { item: null, time: null, raf: 0 };

function togglePreview(item) {
  if (preview.item === item && !player.paused) stopPreview();
  else startPreview(item, item.trimStart);
}

function startPreview(item, from) {
  if (preview.item && preview.item !== item) stopPreview();
  if (!item.url) item.url = URL.createObjectURL(item.file);
  preview.item = item;
  item.el.classList.add('playing');
  const go = () => {
    player.currentTime = from;
    player.play().catch(() => { toast('この形式は試聴できません（変換は可能です）'); stopPreview(); });
  };
  if (player.dataset.src !== item.url) {
    player.src = item.url;
    player.dataset.src = item.url;
    player.load();
    player.addEventListener('loadedmetadata', go, { once: true });
  } else go();
  cancelAnimationFrame(preview.raf);
  const tick = () => {
    if (preview.item !== item) return;
    preview.time = player.currentTime;
    if (player.currentTime >= item.trimEnd) { stopPreview(); return; }
    drawWave(item);
    preview.raf = requestAnimationFrame(tick);
  };
  preview.raf = requestAnimationFrame(tick);
}

function stopPreview() {
  player.pause();
  cancelAnimationFrame(preview.raf);
  const it = preview.item;
  preview.item = null;
  preview.time = null;
  if (it) { it.el.classList.remove('playing'); drawWave(it); }
}
player.addEventListener('ended', stopPreview);

/* ============ まとめて名前をつける ============ */

function pad(n, d) { return String(n).padStart(d, '0'); }

const rnList = $('#rnList');

/** 「1曲目: [名前].mp3」の入力欄を一覧の順番で作り直す（入力途中の内容は item.draft に残る） */
function renderRenameList() {
  rnList.textContent = '';
  state.items.forEach((it, i) => {
    const li = document.createElement('li');
    const no = document.createElement('label');
    no.className = 'rn-no';
    no.textContent = `${i + 1}曲目`;
    const wrap = document.createElement('div');
    wrap.className = 'name-wrap';
    const input = document.createElement('input');
    input.className = 'name';
    input.type = 'text';
    input.id = `rn-${it.id}`;
    input.autocomplete = 'off';
    input.autocapitalize = 'off';
    input.spellcheck = false;
    input.enterKeyHint = i === state.items.length - 1 ? 'done' : 'next';
    input.value = it.draft ?? it.name;
    input.addEventListener('input', () => { it.draft = input.value; });
    // フォーカスしたら全選択して、そのまま打てば置き換わるようにする
    input.addEventListener('focus', () => setTimeout(() => input.select(), 0));
    input.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || e.isComposing) return;
      e.preventDefault();
      const next = rnList.querySelectorAll('input')[i + 1];
      if (next) next.focus(); else input.blur();
    });
    no.htmlFor = input.id;
    const ext = document.createElement('span');
    ext.className = 'ext';
    ext.textContent = '.' + settings.format;
    wrap.append(input, ext);
    const orig = document.createElement('div');
    orig.className = 'rn-orig';
    orig.textContent = `元のファイル：${it.file.name}`;
    li.append(no, wrap, orig);
    rnList.append(li);
    it.rnInput = input;
  });
}

/** カード側で名前を直接変えたときに、こちらの入力欄にも反映する */
function syncRenameRow(item) {
  item.draft = undefined;
  if (item.rnInput) item.rnInput.value = item.name;
}

function setName(item, name) {
  item.name = name;
  item.draft = undefined;
  item.refs.name.value = name;
  if (item.rnInput) item.rnInput.value = name;
}

$('#rnApply').addEventListener('click', () => {
  let changed = 0;
  for (const it of state.items) {
    const v = (it.draft ?? it.name).trim();
    const name = v ? sanitize(v) : it.name;
    if (name !== it.name) changed++;
    setName(it, name);
  }
  toast(changed ? `${changed}件の名前を変更しました` : '名前は変わっていません');
});
$('#rnReset').addEventListener('click', () => {
  for (const it of state.items) setName(it, it.original);
  toast('元の名前に戻しました');
});
$('#sortApply').addEventListener('click', () => {
  const by = $('#sortBy').value;
  const cmp = {
    name: (a, b) => a.name.localeCompare(b.name, 'ja', { numeric: true }),
    date: (a, b) => a.file.lastModified - b.file.lastModified,
    dateDesc: (a, b) => b.file.lastModified - a.file.lastModified,
    added: (a, b) => a.id - b.id,
  }[by];
  state.items.sort(cmp);
  reorderDom();
  toast('並べ替えました');
});

/* ============ 変換 ============ */

const progress = {
  box: $('#progress'),
  text: $('#progressText'),
  fill: $('#progressFill'),
  set(text, frac) {
    this.box.hidden = false;
    if (text != null) this.text.textContent = text;
    this.fill.style.width = `${Math.round(clamp(frac, 0, 1) * 100)}%`;
  },
  hide() { this.box.hidden = true; },
};

let wakeLock = null;
async function keepAwake(on) {
  try {
    if (on && 'wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen');
    else if (!on && wakeLock) { await wakeLock.release(); wakeLock = null; }
  } catch { /* 非対応でも問題なし */ }
}

$('#convert').addEventListener('click', convertAll);

async function convertAll() {
  const items = state.items.filter((i) => i.status === 'ready');
  if (!items.length || state.busy) return;
  stopPreview();
  state.busy = true;
  document.body.classList.add('busy');
  updateConvertButton();
  keepAwake(true);

  const s = { ...settings };
  const ext = s.format;
  const n = items.length;
  const lossless = s.format === 'm4a';
  const join = s.join && n > 1 && !lossless;
  let channels = s.channels;
  if (join && channels === 'auto') channels = items.some((i) => i.numChannels >= 2) ? 2 : 1;

  const baseOpts = {
    format: s.format,
    bitrate: s.bitrate,
    channels,
    normMode: s.normMode,
    lufsTarget: s.lufsTarget,
    peakTarget: s.peakTarget,
    maxGain: s.maxGain,
    ceiling: s.ceiling,
    silence: s.silence,
    silenceDb: s.silenceDb,
    fadeIn: s.fadeIn,
    fadeOut: s.fadeOut,
    join,
  };
  const tags = (title) => (s.format === 'mp3' ? { title: s.tagTitle ? title : '', artist: s.artist, album: s.album } : null);
  const used = new Set(state.results.map((r) => r.name));
  const steps = join ? n + 1 : n;
  let done = 0;
  let failed = 0;

  try {
    if (join) await callWorker({ type: 'reset' });
    for (const item of items) {
      const label = `${done + 1}/${steps}  ${item.name}`;
      progress.set(`${label} を読み込み中…`, done / steps);
      try {
        if (lossless) {
          // 再エンコードせず AAC をそのまま M4A に詰め替える（トリミングのみ反映）
          const track = await loadTrack(item);
          if (!track) throw new Error(item.trackError && item.trackError.code === 'no-audio' ? 'この動画には音声が入っていません' : '「M4A（劣化なし）」は MOV/MP4/M4A のファイルだけに使えます。MP3 を選んでください');
          const t = sliceTrack(track, item.trimStart, item.trimEnd >= item.duration - 0.01 ? Infinity : item.trimEnd);
          addResult({ name: uniqueName(sanitize(item.name), ext, used), blob: buildM4a(t), stats: { duration: t.duration, lufsOut: NaN } });
          done++;
          continue;
        }
        const buf = await decodeItem(item, s.sampleRate);
        const chs = copyChannels(buf);
        progress.set(`${label} を処理中…`, (done + 0.3) / steps);
        const name = uniqueName(sanitize(item.name), ext, used);
        const r = await callWorker({
          type: 'process',
          channels: chs,
          sampleRate: buf.sampleRate,
          opts: { ...baseOpts, trimStart: item.trimStart, trimEnd: item.trimEnd, tags: tags(baseName(name)) },
        }, chs.map((c) => c.buffer), (m) => {
          if (m.stage === 'encode') progress.set(`${label} を書き出し中… ${Math.round(m.value * 100)}%`, (done + 0.4 + 0.6 * m.value) / steps);
        });
        if (!join) addResult({ name, blob: r.blob, stats: r.stats });
      } catch (err) {
        failed++;
        if (join) throw new Error(`${item.name}：${err.message}`);
        addResult({ name: item.name, error: err.message + (item.track && !lossless ? '　→ 出力形式を「M4A（劣化なし）」にすると保存できます' : '') });
      }
      done++;
    }
    if (join) {
      const base = sanitize(s.joinName.trim() || `${items[0].name}_結合`);
      const name = uniqueName(base, ext, used);
      progress.set(`${steps}/${steps}  結合して書き出し中…`, done / steps);
      const r = await callWorker({
        type: 'finishJoin',
        sampleRate: s.sampleRate,
        opts: { ...baseOpts, tags: tags(base) },
      }, [], (m) => progress.set(`${steps}/${steps}  結合して書き出し中… ${Math.round(m.value * 100)}%`, (done + m.value) / steps));
      addResult({ name, blob: r.blob, stats: { ...r.stats, joined: n } });
    }
    progress.set(failed ? `完了（${failed}件失敗）` : '完了しました', 1);
    toast(failed ? `${n - failed}件変換しました（${failed}件失敗）` : '変換が完了しました');
    $('#resultSection').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) {
    progress.set(`エラー：${err.message}`, 0);
    toast('変換に失敗しました');
    if (join) callWorker({ type: 'reset' }).catch(() => {});
  } finally {
    state.busy = false;
    document.body.classList.remove('busy');
    keepAwake(false);
    updateConvertButton();
    setTimeout(() => { if (!state.busy) progress.hide(); }, 4000);
  }
}

function uniqueName(base, ext, used) {
  let name = `${base}.${ext}`;
  for (let k = 2; used.has(name); k++) name = `${base} (${k}).${ext}`;
  used.add(name);
  return name;
}

/* ============ 結果 ============ */

const resultTpl = $('#resultTpl');

function addResult(r) {
  const el = resultTpl.content.firstElementChild.cloneNode(true);
  r.el = el;
  $('.result-name', el).textContent = r.name;
  const meta = $('.meta', el);
  if (r.error) {
    el.classList.add('error');
    $('audio', el).remove();
    $('.btn-row', el).remove();
    meta.textContent = r.error;
  } else {
    r.url = URL.createObjectURL(r.blob);
    $('audio', el).src = r.url;
    const st = r.stats || {};
    const parts = [fmtBytes(r.blob.size), fmtTime(st.duration || 0)];
    if (st.joined) parts.push(`${st.joined}件を結合`);
    if (isFinite(st.lufsIn) && isFinite(st.lufsOut) && Math.abs(st.gainDb) > 0.05) {
      parts.push(`音量 ${st.lufsIn.toFixed(1)} → ${st.lufsOut.toFixed(1)} LUFS（${st.gainDb > 0 ? '+' : ''}${st.gainDb.toFixed(1)} dB）`);
      if (st.capped) parts.push('※元が小さすぎるため上げ幅の上限で止めました');
    } else if (isFinite(st.lufsOut)) {
      parts.push(`音量 ${st.lufsOut.toFixed(1)} LUFS`);
      if (st.capped) parts.push('※目標より小さいため上げていません');
    }
    for (const p of parts) { const s = document.createElement('span'); s.textContent = p; meta.append(s); }
    $('.share', el).addEventListener('click', () => shareFiles([r]));
    $('.dl', el).addEventListener('click', () => download(r.blob, r.name));
    if (!canShareFiles()) $('.share', el).remove();
  }
  state.results.push(r);
  $('#results').prepend(el);
  refreshResults();
}

function refreshResults() {
  const ok = state.results.filter((r) => !r.error);
  $('#resultSection').hidden = state.results.length === 0;
  $('#resultCount').textContent = ok.length ? `${ok.length}件` : '';
  $('#bulkActions').hidden = ok.length < 2;
  $('#shareAll').hidden = !canShareFiles();
}

$('#clearResults').addEventListener('click', () => {
  for (const r of state.results) { if (r.url) URL.revokeObjectURL(r.url); r.el.remove(); }
  state.results = [];
  refreshResults();
});

$('#shareAll').addEventListener('click', () => shareFiles(state.results.filter((r) => !r.error)));
$('#zipAll').addEventListener('click', async () => {
  const ok = state.results.filter((r) => !r.error);
  if (!ok.length) return;
  const btn = $('#zipAll');
  btn.disabled = true;
  try {
    const zip = await makeZip(ok);
    const d = new Date();
    download(zip, `otodake_${d.getFullYear()}${pad(d.getMonth() + 1, 2)}${pad(d.getDate(), 2)}_${pad(d.getHours(), 2)}${pad(d.getMinutes(), 2)}.zip`);
  } catch (err) {
    toast('ZIPの作成に失敗しました');
  } finally {
    btn.disabled = false;
  }
});

function canShareFiles() {
  try {
    return !!(navigator.canShare && navigator.canShare({ files: [new File([''], 'a.mp3', { type: 'audio/mpeg' })] }));
  } catch { return false; }
}

async function shareFiles(rs) {
  const files = rs.map((r) => new File([r.blob], r.name, { type: r.blob.type }));
  try {
    if (!navigator.canShare || !navigator.canShare({ files })) throw new Error('unsupported');
    await navigator.share({ files });
  } catch (err) {
    if (err && err.name === 'AbortError') return; // ユーザーが閉じた
    if (rs.length === 1) download(rs[0].blob, rs[0].name);
    else toast('共有できませんでした。ZIPでダウンロードしてください');
  }
}

function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 60_000);
}

/* ============ ユーティリティ ============ */

function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

function sanitize(name) {
  // eslint-disable-next-line no-control-regex
  const s = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/^\.+/, '').trim();
  return s || 'audio';
}

function fmtTime(sec, precise = false) {
  if (!isFinite(sec)) sec = 0;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const ss = precise ? s.toFixed(1).padStart(4, '0') : String(Math.floor(s)).padStart(2, '0');
  return h ? `${h}:${pad(m, 2)}:${ss}` : `${m}:${ss}`;
}

function parseTime(str) {
  const t = str.trim().replace(/：/g, ':').replace(/[０-９．]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
  if (!t) return null;
  const parts = t.split(':').map(Number);
  if (parts.some((p) => !isFinite(p) || p < 0) || parts.length > 3) return null;
  return parts.reduce((acc, p) => acc * 60 + p, 0);
}

function fmtBytes(b) {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  if (b < 1024 * 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} MB`;
  return `${(b / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

let toastTimer = 0;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

/* ============ 入力 ============ */

const fileInput = $('#fileInput');
fileInput.addEventListener('change', () => {
  if (fileInput.files.length) addFiles(fileInput.files);
  fileInput.value = '';
});

const drop = $('#drop');
for (const ev of ['dragenter', 'dragover']) {
  document.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('dragover'); });
}
for (const ev of ['dragleave', 'drop']) {
  document.addEventListener(ev, (e) => { e.preventDefault(); if (ev === 'drop' || e.target === document.documentElement) drop.classList.remove('dragover'); });
}
document.addEventListener('drop', (e) => {
  if (e.dataTransfer && e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
});

let resizeTimer = 0;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => state.items.forEach(drawWave), 100);
});
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => state.items.forEach(drawWave));

window.addEventListener('beforeunload', (e) => {
  if (state.busy || state.results.some((r) => !r.error)) { e.preventDefault(); e.returnValue = ''; }
});

settingsToForm();
refreshList();

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
