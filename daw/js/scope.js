/*
 * かなでる：見える化（再生中の周波数・音量のリアルタイム表示と、曲全体の解析）。
 */
import { $, el, toast, saveFile } from './ui.js';
import { S, ensureRendered } from './app.js';
import { call, analysers, setPhoneSim, audio } from './player.js';
import { drawSheet, sheetHeight, CanvasPainter, waveColumns } from './engine/viz.js';

let specCv = null, waterCv = null, phone = false, lastAnalysis = null;
const lufsEl = {}, freq = new Float32Array(4096), td = new Float32Array(2048), tdR = new Float32Array(2048);
let peakHold = null, momentary = [];

export function renderViz() {
  const v = $('#vizView');
  specCv = el('canvas', { height: 180 });
  waterCv = el('canvas', { height: 140 });
  const phoneBtn = el('button', { class: 'chip', type: 'button', 'aria-pressed': String(phone), onclick: () => { phone = !phone; setPhoneSim(phone); phoneBtn.setAttribute('aria-pressed', String(phone)); } }, 'スマホのスピーカーで聞く');
  const meters = el('div', { class: 'meters' }, ['短時間', 'ピーク', '左右の相関'].map((k) => { const b = el('b', {}, '—'); lufsEl[k] = b; return el('div', {}, [el('small', {}, k), b]); }));
  const out = el('div', { id: 'analysisOut' });
  v.replaceChildren(
    el('div', { class: 'viz-card' }, [el('h3', {}, ['周波数（リアルタイム）', phoneBtn]), specCv, meters]),
    el('div', { class: 'viz-card' }, [el('h3', {}, 'スペクトログラム（時間 → 右、上ほど高い音）'), waterCv]),
    el('div', { class: 'viz-card' }, [
      el('h3', {}, ['曲全体の解析', el('button', { class: 'btn sm primary', type: 'button', onclick: analyze }, '全体を解析')]),
      el('p', { class: 'note' }, 'ラウドネス・ピーク・帯域のバランス・和音・スマホのスピーカーでの聞こえ方・クリックノイズなどを調べ、見える化シートを作ります。'),
      out,
    ]),
  );
  if (lastAnalysis && lastAnalysis.rev === S.rev) showAnalysis(lastAnalysis.a, lastAnalysis.text);
  peakHold = null;
}

/** 再生中に毎フレーム呼ばれる */
export function tickViz() {
  const { analyser, anL, anR, ctx } = analysers();
  if (!analyser || !specCv) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  // スペクトル（対数周波数・1/6 オクターブで平均）
  {
    const W = specCv.clientWidth, H = 180;
    if (specCv.width !== W * dpr) { specCv.width = W * dpr; specCv.height = H * dpr; }
    const g = specCv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    analyser.getFloatFrequencyData(freq);
    const n = analyser.frequencyBinCount, sr = ctx.sampleRate;
    g.fillStyle = '#0b0d12'; g.fillRect(0, 0, W, H);
    const fx = (f) => (Math.log(f / 20) / Math.log(20000 / 20)) * W;
    const fy = (d) => H - ((d + 90) / 84) * H;
    g.strokeStyle = '#232731'; g.fillStyle = '#5c6378'; g.font = '10px sans-serif';
    for (const f of [50, 100, 200, 500, 1000, 2000, 5000, 10000]) { const x = fx(f); g.fillRect(x, 0, 1, H); g.fillText(f >= 1000 ? `${f / 1000}k` : f, x + 2, H - 3); }
    for (const d of [-72, -48, -24]) { g.fillRect(0, fy(d), W, 1); }
    // スマホの範囲外を薄く
    if (phone) { g.fillStyle = 'rgba(255,107,107,0.12)'; g.fillRect(0, 0, fx(250), H); }
    const cols = Math.floor(W / 2);
    if (!peakHold || peakHold.length !== cols) peakHold = new Float32Array(cols).fill(-120);
    const grad = g.createLinearGradient(0, H, 0, 0);
    grad.addColorStop(0, '#1b6b4f'); grad.addColorStop(0.6, '#3ddc97'); grad.addColorStop(1, '#ffcc33');
    g.fillStyle = grad;
    for (let c = 0; c < cols; c++) {
      const f0 = 20 * Math.pow(1000, c / cols), f1 = 20 * Math.pow(1000, (c + 1) / cols);
      const b0 = Math.max(1, Math.floor((f0 / sr) * 2 * n)), b1 = Math.max(b0 + 1, Math.ceil((f1 / sr) * 2 * n));
      let p = 0, k = 0;
      for (let b = b0; b < b1 && b < n; b++) { p += Math.pow(10, freq[b] / 10); k++; }
      const d = 10 * Math.log10(p / Math.max(1, k) + 1e-12) + 4.5 * Math.log2(Math.max(20, f0) / 1000) * 0.5; // 高域を少し持ち上げて見やすく
      const y = fy(d);
      g.fillRect(c * 2, y, 1.6, H - y);
      peakHold[c] = Math.max(d, peakHold[c] - 0.6);
    }
    g.fillStyle = '#ffffff';
    for (let c = 0; c < cols; c++) g.fillRect(c * 2, fy(peakHold[c]), 1.6, 1);
  }
  // 音量・相関
  anL.getFloatTimeDomainData(td); anR.getFloatTimeDomainData(tdR);
  let sq = 0, pk = 0, lr = 0, ll = 0, rr = 0;
  for (let i = 0; i < td.length; i++) { sq += (td[i] * td[i] + tdR[i] * tdR[i]) / 2; pk = Math.max(pk, Math.abs(td[i]), Math.abs(tdR[i])); lr += td[i] * tdR[i]; ll += td[i] * td[i]; rr += tdR[i] * tdR[i]; }
  momentary.push(sq / td.length);
  if (momentary.length > 60) momentary.shift();
  const rms = momentary.reduce((a, b) => a + b, 0) / momentary.length;
  lufsEl['短時間'].textContent = `${(10 * Math.log10(rms + 1e-12) - 0.7).toFixed(1)} dB`;
  lufsEl['ピーク'].textContent = `${(20 * Math.log10(pk + 1e-9)).toFixed(1)} dB`;
  lufsEl['左右の相関'].textContent = (lr / Math.sqrt(ll * rr || 1)).toFixed(2);
  // スペクトログラム（右から流れる）
  {
    const W = waterCv.clientWidth, H = 140;
    if (waterCv.width !== Math.round(W * dpr)) { waterCv.width = W * dpr; waterCv.height = H * dpr; }
    const g = waterCv.getContext('2d');
    const w = waterCv.width, h = waterCv.height;
    g.drawImage(waterCv, -2, 0);
    const n = analyser.frequencyBinCount, sr = ctx.sampleRate;
    for (let y = 0; y < h; y++) {
      const f = 30 * Math.pow(16000 / 30, 1 - y / h);
      const b = Math.min(n - 1, Math.round((f / sr) * 2 * n));
      const u = Math.max(0, Math.min(1, (freq[b] + 100) / 80));
      g.fillStyle = `rgb(${Math.round(255 * Math.min(1, u * 1.5))},${Math.round(255 * Math.max(0, u * 1.6 - 0.6))},${Math.round(60 + 120 * u)})`;
      g.fillRect(w - 2, y, 2, 1);
    }
  }
}

async function analyze(e) {
  const b = e.currentTarget;
  b.disabled = true;
  b.textContent = '解析中…';
  try {
    audio();
    const r = await ensureRendered();
    const m = await call('analyze', { L: r.L, R: r.R, sr: r.sr, song: S.song });
    lastAnalysis = { a: m.analysis, text: m.text, rev: S.rev, r };
    showAnalysis(m.analysis, m.text);
  } catch (err) { toast(err.message, 4000); } finally { b.disabled = false; b.textContent = '全体を解析'; }
}

function showAnalysis(a, text) {
  const out = document.getElementById('analysisOut');
  if (!out) return;
  const W = 1600, H = sheetHeight(a, S.song);
  const cv = el('canvas', { width: W, height: H });
  const r = lastAnalysis.r;
  a._wave = waveColumns(r.L, r.R, W - 90);
  drawSheet(new CanvasPainter(cv.getContext('2d')), a, { song: S.song, title: (S.song.name || '').replace(/[^\x20-\x7e]/g, '') || 'SONG', targetLufs: S.song.master?.loudness ?? -14 });
  const warn = a.warnings.length ? a.warnings.map((w) => el('li', {}, w)) : [el('li', { class: 'ok' }, '気になる点は見つかりませんでした')];
  out.replaceChildren(
    el('ul', { class: 'warn-list' }, warn),
    el('div', { class: 'sheet-img' }, cv),
    el('div', { class: 'row', style: { marginTop: '8px' } }, [
      el('button', { class: 'btn sm', type: 'button', onclick: () => cv.toBlob((bl) => saveFile(bl, `${S.song.name || 'kanaderu'}_見える化.png`, 'image/png')) }, '画像を保存'),
      el('button', { class: 'btn sm', type: 'button', onclick: async () => { try { await navigator.clipboard.writeText(text); toast('レポートをコピーしました'); } catch { toast('コピーできませんでした'); } } }, 'レポートをコピー'),
    ]),
    el('div', { class: 'report' }, text),
  );
}

document.addEventListener('kanaderu:sheet', async () => {
  const btn = document.querySelector('#vizView .btn.primary');
  if (btn) btn.click();
});
