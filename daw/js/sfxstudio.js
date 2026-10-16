/*
 * かなでる：効果音スタジオ。プリセットを選び、つまみで調整して、波形とスペクトログラムを見ながら作る。
 */
import { $, el, toast, slider, openSheet, closeSheet, seg, saveFile, fmtPct } from './ui.js';
import { call, encodeMp3, playBuffer, audio } from './player.js';
import { store } from './store.js';
import { SFX_PRESETS, SFX_CATEGORIES } from './engine/sfx.js';
import { magnitude } from './engine/analyze.js';

let spec = { preset: 'whoosh', pitch: 0, length: 1, tone: 0, seed: 1 };
let cat = 'trans', last = null, custom = null, back = null;

export function openSfxStudio(opts = {}) {
  back = opts.back;
  for (const s of document.querySelectorAll('.screen')) s.hidden = s.id !== 'sfx';
  $('#sfxBack').onclick = () => back?.();
  $('#sfxExport').onclick = exportSfx;
  render();
  play();
}

function render() {
  const body = $('#sfxBody');
  const cats = el('div', { class: 'cats' }, SFX_CATEGORIES.concat([{ id: 'saved', label: '保存した音' }]).map((c) => el('button', { class: 'chip', type: 'button', 'aria-pressed': String(c.id === cat), onclick: () => { cat = c.id; render(); } }, c.label)));
  let grid;
  if (cat === 'saved') {
    grid = el('div', { class: 'list' });
    store.list('sfx').then((list) => {
      if (!list.length) grid.append(el('p', { class: 'note' }, 'まだありません。「保存」で、調整した効果音をここに残せます。'));
      for (const it of list) grid.append(el('div', { class: 'item', onclick: () => { spec = { ...it.spec }; custom = it.custom || null; cat = SFX_PRESETS[spec.preset]?.cat || cat; render(); play(); } }, [
        el('div', { class: 'grow' }, [it.name, el('small', {}, SFX_PRESETS[it.spec.preset]?.label || 'カスタム')]),
        el('button', { class: 'chip', type: 'button', onclick: async (e) => { e.stopPropagation(); await store.del(it.id, 'sfx'); render(); } }, '削除'),
      ]));
    });
  } else {
    grid = el('div', { class: 'presets' }, Object.entries(SFX_PRESETS).filter(([, p]) => p.cat === cat).map(([k, p]) => el('button', { type: 'button', 'aria-pressed': String(k === spec.preset && !custom), onclick: () => { spec = { ...spec, preset: k, seed: 1 }; custom = null; render(); play(); } }, p.label)));
  }
  const cv = el('canvas', { id: 'sfxCanvas' });
  const stats = el('div', { class: 'sfx-stats', id: 'sfxStats' }, '—');
  // 響き・迫力は、触るまではプリセットのおすすめ値（おまかせ）
  const knob = (key, label, min, max, step, fmt, def) => {
    const auto = spec[key] == null;
    const f = slider({ label, min, max, step, value: spec[key] ?? def, fmt: (v) => (spec[key] == null && v === def ? 'おまかせ' : fmt(v)), onChange: (v) => { spec[key] = v; custom = null; play(); } });
    if (auto) f.set(def);
    return f;
  };
  body.replaceChildren(
    cats, grid,
    el('div', { class: 'sfx-view' }, [cv, stats]),
    el('div', { class: 'sfx-actions' }, [
      el('button', { class: 'btn primary', type: 'button', onclick: () => replay() }, '▶ 再生'),
      el('button', { class: 'btn', type: 'button', onclick: () => { spec.seed = Math.floor(Math.random() * 99999); custom = null; play(); } }, '🎲 ばらつき'),
      el('button', { class: 'btn', type: 'button', onclick: saveSfx }, '保存'),
    ]),
    el('div', { class: 'knobs' }, [
      knob('pitch', '高さ', -12, 12, 1, (v) => `${v > 0 ? '+' : ''}${v} 半音`, 0),
      knob('length', '長さ', 0.3, 3, 0.05, (v) => `×${v.toFixed(2)}`, 1),
      knob('tone', '明るさ', -1, 1, 0.05, (v) => (v > 0.05 ? `明るい ${v.toFixed(2)}` : v < -0.05 ? `暗い ${(-v).toFixed(2)}` : '標準'), 0),
      knob('space', '響き（空間）', 0, 1, 0.01, fmtPct, 0.3),
      knob('punch', '迫力', 0, 1, 0.01, fmtPct, 0.5),
      el('button', { class: 'btn sm', type: 'button', onclick: () => { spec = { preset: spec.preset, seed: spec.seed, pitch: 0, length: 1, tone: 0 }; custom = null; render(); play(); } }, 'つまみを戻す'),
    ]),
    el('button', { class: 'btn wide', type: 'button', style: { marginTop: '8px' }, onclick: editLayers }, '層（レイヤー）を JSON で編集'),
    el('p', { class: 'note' }, '効果音は「立ち上がり・胴鳴り・余韻・空間」の層を重ねて作っています。「スマホ損失」は、iPhone のスピーカーで鳴らしたときにどれだけ小さく聞こえるかの目安です（小さいほど良い）。'),
  );
  if (last) drawSfx(last);
}

async function play() {
  audio();
  try {
    const m = await call('sfx', { spec: custom || spec });
    last = m;
    drawSfx(m);
    playBuffer(m.L, m.R, m.sr);
  } catch (e) { toast(e.message, 4000); }
}
function replay() { if (last) { audio(); playBuffer(last.L, last.R, last.sr); } else play(); }

function drawSfx(m) {
  const cv = document.getElementById('sfxCanvas');
  if (!cv) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = cv.clientWidth || 340, H = 150;
  cv.width = W * dpr; cv.height = H * dpr;
  const g = cv.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.fillStyle = '#0b0d12'; g.fillRect(0, 0, W, H);
  const { L, R } = m, n = L.length;
  // 下：スペクトログラム
  const sh = 90, top = H - sh;
  const N = 512, cols = Math.min(W, 260);
  const img = g.createImageData(cols, sh);
  for (let c = 0; c < cols; c++) {
    const off = Math.floor((c / cols) * Math.max(0, n - N));
    const mono = new Float32Array(N);
    for (let i = 0; i < N; i++) mono[i] = ((L[off + i] || 0) + (R[off + i] || 0)) / 2;
    const mag = magnitude(mono, 0, N);
    for (let y = 0; y < sh; y++) {
      const f = 40 * Math.pow(18000 / 40, 1 - y / sh);
      const b = Math.min(mag.length - 1, Math.round((f / m.sr) * N));
      const u = Math.max(0, Math.min(1, (20 * Math.log10(mag[b] + 1e-9) + 80) / 75));
      const i = (y * cols + c) * 4;
      img.data[i] = 255 * Math.min(1, u * 1.5); img.data[i + 1] = 255 * Math.max(0, u * 1.6 - 0.6); img.data[i + 2] = 60 + 140 * u; img.data[i + 3] = 255;
    }
  }
  const tmp = document.createElement('canvas');
  tmp.width = cols; tmp.height = sh;
  tmp.getContext('2d').putImageData(img, 0, 0);
  g.imageSmoothingEnabled = true;
  g.drawImage(tmp, 0, top, W, sh);
  // 上：波形
  g.fillStyle = '#3ddc97';
  const mid = top / 2;
  for (let x = 0; x < W; x++) {
    const s = Math.floor((x / W) * n), e = Math.floor(((x + 1) / W) * n);
    let mx = 0;
    for (let i = s; i < e; i++) mx = Math.max(mx, Math.abs(L[i]), Math.abs(R[i]));
    g.fillRect(x, mid - mx * mid * 0.95, 1, Math.max(1, mx * top * 0.95));
  }
  g.fillStyle = '#5c6378'; g.font = '10px sans-serif';
  g.fillText('1k', 2, top + sh * (1 - Math.log(1000 / 40) / Math.log(18000 / 40)) + 3);
  g.fillText('100', 2, top + sh * (1 - Math.log(100 / 40) / Math.log(18000 / 40)) + 3);
  const st = m.stats;
  const s = document.getElementById('sfxStats');
  if (s && st) s.replaceChildren(...[['長さ', `${(st.lengthMs / 1000).toFixed(2)}s`], ['立ち上がり', `${st.attackMs}ms`], ['-20dB まで', `${st.to20dBms}ms`], ['スマホ損失', st.phoneLoss != null ? `${st.phoneLoss}dB` : '—']].map(([k, v]) => el('span', {}, [k + ' ', el('b', {}, v)])));
}

async function saveSfx() {
  const name = prompt('名前', `${SFX_PRESETS[spec.preset]?.label || '効果音'} ${spec.seed}`);
  if (!name) return;
  await store.put({ id: Math.random().toString(36).slice(2, 10), name, spec: { ...spec }, custom }, 'sfx');
  toast('保存しました（「保存した音」から呼び出せます）');
}

function editLayers() {
  const def = custom || last?.def || null;
  const ta = el('textarea', { rows: 18, value: JSON.stringify(def, null, 1) });
  const err = el('div', { class: 'err' });
  openSheet('層（レイヤー）の編集', [
    el('p', { class: 'note' }, 'layers の各層：src（sine/tri/saw/square/noise/pink/brown/metal/modal/crackle/click）、freq（[[秒,Hz],…] で変化）、amp（{a,h,d} か [[秒,値],…]）、filter、drive、pan など。fx でリバーブなど。Claude に頼んで書き換えてもらうこともできます。'),
    ta, err,
    el('button', { class: 'btn primary wide', type: 'button', style: { marginTop: '8px' }, onclick: () => {
      try { custom = JSON.parse(ta.value); } catch (e) { err.textContent = e.message; return; }
      closeSheet(); play();
    } }, '鳴らす'),
  ], { tall: true });
}

function exportSfx() {
  if (!last) return toast('まず音を鳴らしてください');
  let fmt = 'wav24';
  openSheet('効果音の書き出し', [
    seg([['wav24', 'WAV 24bit'], ['wav16', 'WAV 16bit'], ['mp3', 'MP3']], fmt, (v) => (fmt = v)),
    el('button', { class: 'btn primary wide', type: 'button', style: { marginTop: '12px' }, onclick: async () => {
      const base = `${SFX_PRESETS[spec.preset]?.label || 'sfx'}_${spec.seed}`;
      try {
        if (fmt === 'mp3') { const m = await encodeMp3(last.L, last.R, last.sr, 320); await saveFile(m.blob, `${base}.mp3`, 'audio/mpeg'); }
        else { const m = await call('wav', { L: last.L, R: last.R, sr: last.sr, bits: fmt === 'wav16' ? 16 : 24 }); await saveFile(m.bytes, `${base}.wav`, 'audio/wav'); }
        closeSheet();
      } catch (e) { toast(e.message, 4000); }
    } }, '書き出す'),
  ]);
}
