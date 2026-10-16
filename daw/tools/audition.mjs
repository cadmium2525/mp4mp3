#!/usr/bin/env node
/*
 * かなでる：プリセットの総点検。すべての楽器・効果音を鳴らし、数値と図で確かめる。
 *
 *   node daw/tools/audition.mjs inst [out.png]    楽器：音量のそろい具合・音程・クリック・減衰
 *   node daw/tools/audition.mjs sfx  [out.png]    効果音：長さ・立ち上がり・帯域・クリック
 *   node daw/tools/audition.mjs inst piano out.wav  1つを試聴用に書き出す
 */
import { writeFileSync } from 'node:fs';
import { renderNotes } from '../js/engine/instruments.js';
import { INST_PRESETS, resolveInst } from '../js/engine/presets.js';
import { SFX_PRESETS, sfxFromPreset, renderSfx } from '../js/engine/sfx.js';
import { applyChain } from '../js/engine/fx.js';
import { loudness, magnitude, analyzeAudio } from '../js/engine/analyze.js';
import { Raster, waveColumns, sfxStats } from '../js/engine/viz.js';
import { encodeWav } from '../js/engine/wav.js';
import { encodePng } from './common.mjs';

const argv = process.argv.slice(2);
const calibrate = argv.includes('--calibrate');
const [kind = 'inst', a1, a2] = argv.filter((x) => !x.startsWith('--'));
const sr = 48000;

/** 楽器のテストフレーズ：低・中・高の単音と和音 */
function phrase(inst, name) {
  const n = sr * 7;
  const L = new Float32Array(n), R = new Float32Array(n);
  const isBass = INST_PRESETS[name]?.cat === 'bass';
  const base = isBass ? 36 : 48;
  const notes = [
    { s: 0, len: sr * 0.9, m: base, v: 0.8 },
    { s: sr * 1, len: sr * 0.9, m: base + 12, v: 0.8 },
    { s: sr * 2, len: sr * 0.9, m: base + 24, v: 0.8 },
    { s: sr * 3, len: sr * 0.45, m: base + 7, v: 0.5 },
    { s: sr * 3.5, len: sr * 0.45, m: base + 7, v: 1 },
  ];
  if (!isBass) for (const m of [base + 12, base + 16, base + 19, base + 23]) notes.push({ s: sr * 4.2, len: sr * 1.6, m, v: 0.7 });
  renderNotes(inst, notes, L, R, sr, 1);
  applyChain(inst.fx, L, R, { sr, bpm: 120, timeAt: (i) => i / sr });
  return [L, R];
}

/** 基音（その音の高さの成分）の周波数のずれ（セント）。FFT のピークを補間して測る */
function pitchCents(x, s, len, midi) {
  const N = 32768, mag = magnitude(x, s, N);
  const f0 = 440 * Math.pow(2, (midi - 69) / 12);
  const c = Math.round((f0 * N) / sr), w = Math.round(c * 0.04) + 3;
  let bi = c - w;
  for (let i = c - w; i <= c + w; i++) if (mag[i] > mag[bi]) bi = i;
  const a = mag[bi - 1], b = mag[bi], cc = mag[bi + 1];
  const p = (0.5 * (a - cc)) / (a - 2 * b + cc || 1);
  return Math.round(1200 * Math.log2(((bi + p) * sr) / N / f0));
}

function centroid(x, s) {
  const mag = magnitude(x, s, 4096);
  let num = 0, den = 0;
  for (let i = 1; i < mag.length; i++) { num += i * mag[i]; den += mag[i]; }
  return Math.round(((num / (den || 1)) * sr) / 4096);
}

function spectroThumb(P, x0, y0, w, h, L) {
  const n = 1024, hop = Math.max(256, Math.floor(L.length / w));
  const img = new Uint8ClampedArray(w * h * 4);
  for (let col = 0; col < w; col++) {
    const mag = magnitude(L, col * hop, n);
    for (let row = 0; row < h; row++) {
      const f = 40 * Math.pow(16000 / 40, row / h);
      const bin = Math.min(mag.length - 1, Math.round((f * n) / sr));
      const d = 20 * Math.log10(mag[bin] + 1e-9);
      const u = Math.max(0, Math.min(1, (d + 90) / 80));
      const i = ((h - 1 - row) * w + col) * 4;
      img[i] = 255 * Math.min(1, u * 1.6); img[i + 1] = 255 * Math.max(0, u * 1.4 - 0.4); img[i + 2] = 80 + 120 * u; img[i + 3] = 255;
    }
  }
  P.image(x0, y0, w, h, w, h, img);
}

if (kind === 'inst' && a1 && a2) {
  const [L, R] = phrase(resolveInst(a1), a1);
  writeFileSync(a2, encodeWav(L, R, sr, 16));
  console.log(`書き出し: ${a2}`);
  process.exit(0);
}
if (kind === 'sfx' && a1 && a2) {
  const [L, R] = renderSfx(sfxFromPreset({ preset: a1 }), sr);
  writeFileSync(a2, encodeWav(L, R, sr, 16));
  console.log(`書き出し: ${a2}`, JSON.stringify(sfxStats(L, R, sr)));
  process.exit(0);
}

const out = a1;
const rows = [];
if (kind === 'inst') {
  const names = Object.keys(INST_PRESETS);
  const P = out ? new Raster(1500, 40 + names.length * 34) : null;
  console.log('name          LUFS  peak  cents(lo/mid/hi)  centroid(lo/hi)  clicks  tail(s)  width');
  names.forEach((name, k) => {
    const inst = resolveInst(name);
    const [L, R] = phrase(inst, name);
    const lu = loudness(L, R, sr);
    let pk = 0; for (let i = 0; i < L.length; i++) pk = Math.max(pk, Math.abs(L[i]), Math.abs(R[i]));
    const mono = new Float32Array(L.length); for (let i = 0; i < L.length; i++) mono[i] = (L[i] + R[i]) / 2;
    const isBass = INST_PRESETS[name].cat === 'bass';
    const base = isBass ? 36 : 48;
    const cents = [0, 1, 2].map((j) => pitchCents(mono, Math.round(sr * (j + 0.25)), 4096, base + 12 * j));
    const cen = [centroid(mono, Math.round(sr * 0.2)), centroid(mono, Math.round(sr * 2.2))];
    const a = analyzeAudio(L, R, sr, {});
    // 最後の和音の余韻（-60dB まで）
    let last = L.length - 1; while (last > 0 && Math.abs(mono[last]) < pk * 0.001) last--;
    const tail = Math.max(0, last / sr - 5.8);
    rows.push({ name, lu });
    console.log(`${name.padEnd(13)} ${lu.toFixed(1).padStart(5)} ${(20 * Math.log10(pk)).toFixed(1).padStart(5)}  ${cents.map((c) => String(c).padStart(4)).join(' ')}       ${cen.map((c) => String(c).padStart(5)).join(' ')}       ${String(a.clicks.length).padStart(3)}    ${tail.toFixed(1).padStart(4)}   ${a.stereo.width}`);
    if (P) {
      const y = 30 + k * 34;
      P.text(8, y + 10, name, [220, 225, 240]);
      P.text(110, y + 10, `${lu.toFixed(1)} LUFS`, Math.abs(lu + 20) > 4 ? [255, 120, 100] : [130, 140, 170]);
      const wv = waveColumns(L, R, 600);
      for (let x = 0; x < 600; x++) P.rect(200 + x, y + 15 - wv.max[x] * 15, 1, Math.max(1, (wv.max[x] - wv.min[x]) * 15), [120, 150, 230]);
      spectroThumb(P, 820, y, 660, 30, mono);
    }
  });
  const lus = rows.map((r) => r.lu);
  if (calibrate) {
    // 今の補正値に、-20 LUFS との差を足して書き直す
    const { LEVELS } = await import('../js/engine/levels.js');
    const next = {};
    for (const r of rows) next[r.name] = Math.round(((LEVELS[r.name] ?? 0) + (-20 - r.lu)) * 10) / 10;
    const body = Object.entries(next).map(([k, v]) => `  ${k}: ${v},`).join('\n');
    writeFileSync(new URL('../js/engine/levels.js', import.meta.url), `/* プリセットの音量補正（dB）。node daw/tools/audition.mjs inst --calibrate で再計算 */\nexport const LEVELS = {\n${body}\n};\n`);
    console.log('levels.js を更新しました');
  }
  console.log(`\n音量の幅：${Math.min(...lus).toFixed(1)} 〜 ${Math.max(...lus).toFixed(1)} LUFS（目標：どれも -20±4）`);
  if (P) { writeFileSync(out, encodePng(P.w, P.h, P.px)); console.log(`一覧: ${out}`); }
} else {
  const names = Object.keys(SFX_PRESETS);
  const P = out ? new Raster(1500, 40 + names.length * 34) : null;
  console.log('name         len(ms) attack peakAt -20dB -40dB  LUFS  centroid  clicks  width  bands(sub/bass/mid/himid/air)');
  names.forEach((name, k) => {
    const [L, R] = renderSfx(sfxFromPreset({ preset: name }), sr);
    const st = sfxStats(L, R, sr);
    const a = analyzeAudio(L, R, sr, {});
    const mono = new Float32Array(L.length); for (let i = 0; i < L.length; i++) mono[i] = (L[i] + R[i]) / 2;
    const cen = centroid(mono, Math.max(0, Math.round((st.peakAtMs / 1000) * sr) - 512));
    console.log(`${name.padEnd(12)} ${String(st.lengthMs).padStart(6)} ${String(st.attackMs).padStart(6)} ${String(st.peakAtMs).padStart(6)} ${String(st.to20dBms).padStart(5)} ${String(st.to40dBms).padStart(5)} ${String(a.lufs).padStart(6)} ${String(cen).padStart(8)}  ${String(a.clicks.length).padStart(5)}  ${String(a.stereo.width).padStart(5)}  ${[a.bands.sub, a.bands.bass, a.bands.mid, a.bands.himid, a.bands.air].map((v) => String(Math.round(v))).join('/')}`);
    if (P) {
      const y = 30 + k * 34;
      P.text(8, y + 10, name, [220, 225, 240]);
      P.text(110, y + 10, `${st.lengthMs}ms`, [130, 140, 170]);
      const wv = waveColumns(L, R, 600);
      for (let x = 0; x < 600; x++) P.rect(200 + x, y + 15 - wv.max[x] * 15, 1, Math.max(1, (wv.max[x] - wv.min[x]) * 15), [120, 150, 230]);
      spectroThumb(P, 820, y, 660, 30, mono);
    }
  });
  if (P) { writeFileSync(out, encodePng(P.w, P.h, P.px)); console.log(`一覧: ${out}`); }
}
