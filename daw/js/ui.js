/*
 * かなでる：画面まわりの小さな部品（要素の作成、下から出るパネル、トースト、スライダー）。
 */

export const $ = (s, r = document) => r.querySelector(s);

/** 要素を作る：el('div', { class: 'x', onclick }, [子要素や文字]) */
export function el(tag, attrs = {}, children = []) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'html') e.innerHTML = v;
    else if (k in e && typeof v !== 'string') e[k] = v;
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of [].concat(children)) if (c != null && c !== false) e.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return e;
}

let toastTimer = 0;
export function toast(msg, ms = 2200) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), ms);
}

/* ---------- 下から出るパネル ---------- */

let onSheetClose = null;
export function openSheet(title, body, { tall = false, onClose = null } = {}) {
  $('#sheetTitle').textContent = title;
  const b = $('#sheetBody');
  b.replaceChildren(...[].concat(body));
  b.scrollTop = 0;
  $('#sheet').classList.toggle('tall', tall);
  $('#sheet').hidden = false;
  $('#sheetBackdrop').hidden = false;
  onSheetClose = onClose;
}
export function closeSheet() {
  if ($('#sheet').hidden) return;
  $('#sheet').hidden = true;
  $('#sheetBackdrop').hidden = true;
  const f = onSheetClose;
  onSheetClose = null;
  f?.();
}
export const sheetOpen = () => !$('#sheet').hidden;

/** 確認 */
export function confirmBox(msg) { return Promise.resolve(window.confirm(msg)); }

/**
 * ラベル付きスライダー。fmt で値の表示、onInput は動かしている間、onChange は離したとき。
 */
export function slider({ label, min, max, step = 0.01, value, fmt = (v) => v, onInput, onChange }) {
  const b = el('b', {}, fmt(value));
  const input = el('input', { type: 'range', min, max, step, value });
  input.addEventListener('input', () => { const v = Number(input.value); b.textContent = fmt(v); onInput?.(v); });
  input.addEventListener('change', () => onChange?.(Number(input.value)));
  // ダブルタップで初期値に戻す
  let last = 0;
  input.addEventListener('pointerdown', () => {
    const now = Date.now();
    if (now - last < 300 && input.dataset.def != null) {
      input.value = input.dataset.def;
      b.textContent = fmt(Number(input.value));
      onInput?.(Number(input.value)); onChange?.(Number(input.value));
    }
    last = now;
  });
  const f = el('div', { class: 'field' }, [el('label', {}, [label, b]), input]);
  f.input = input;
  f.set = (v) => { input.value = v; b.textContent = fmt(v); };
  input.dataset.def = value;
  return f;
}

/** 選択ボタンの列 */
export function seg(options, value, onPick) {
  const wrap = el('div', { class: 'seg' });
  for (const [v, label] of options) {
    const b = el('button', { type: 'button', 'aria-pressed': String(v === value), onclick: () => {
      for (const x of wrap.children) x.setAttribute('aria-pressed', 'false');
      b.setAttribute('aria-pressed', 'true');
      onPick(v);
    } }, label);
    wrap.append(b);
  }
  return wrap;
}

export const fmtDb = (v) => `${v > 0 ? '+' : ''}${Number(v).toFixed(1)} dB`;
export const fmtPct = (v) => `${Math.round(v * 100)}%`;
export const fmtPan = (v) => (Math.abs(v) < 0.02 ? '中央' : v < 0 ? `左 ${Math.round(-v * 100)}` : `右 ${Math.round(v * 100)}`);
export const fmtTime = (s) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;

/** ファイルを保存（共有シート → だめならダウンロード） */
export async function saveFile(bytes, name, type) {
  const file = new File([bytes], name, { type });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file] }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  const url = URL.createObjectURL(file);
  const a = el('a', { href: url, download: name, style: { display: 'none' } });
  document.body.append(a);
  a.click();
  setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 30000);
}

/** トラックの色 */
export const TRACK_COLORS = ['#ff6b5c', '#4c86ff', '#2edba8', '#ffc83d', '#ba78ff', '#ff8cc8', '#64dcff', '#ffa03c', '#a0e65a', '#e6e6e6'];
