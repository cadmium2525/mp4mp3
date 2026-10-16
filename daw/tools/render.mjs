#!/usr/bin/env node
/*
 * かなでる：曲・効果音の JSON を、iPhone のアプリと同じエンジンで音にするコマンド。
 *
 *   node daw/tools/render.mjs song.json out.wav [--mp3 out.mp3] [--sheet out.png] [--report] [--stems] [--bits 16|24]
 *
 *   --sheet   見える化シート（波形・ラウドネス・スペクトログラム・和音・ピアノロール・帯域バランス・トラック別）
 *   --report  数値のレポートを表示（ラウドネス・帯域・検出した和音・注意点）
 *   --stems   トラック別の解析もする（--sheet / --report と一緒に）
 *   --expect  "Am,F,C,G"：小節ごとの予定の和音と、検出結果を照合する
 *
 * JSON に layers または preset があれば効果音、tracks があれば曲として扱う。
 * 出力が .mp3 / .m4a なら ffmpeg で変換する。
 */
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { renderSong } from '../js/engine/mix.js';
import { renderAnySfx } from '../js/engine/sfx.js';
import { analyzeAudio, reportText } from '../js/engine/analyze.js';
import { drawSheet, sheetHeight, Raster, waveColumns, sfxStats } from '../js/engine/viz.js';
import { encodeWav } from '../js/engine/wav.js';
import { validateSong } from '../js/engine/validate.js';
import { beatsPerBar } from '../js/engine/song.js';
import { encodePng, transcode } from './common.mjs';

const args = process.argv.slice(2);
const flag = (name, def = null) => { const i = args.indexOf(name); if (i < 0) return def; const v = args[i + 1]; args.splice(i, 2); return v; };
const bool = (name) => { const i = args.indexOf(name); if (i < 0) return false; args.splice(i, 1); return true; };
const sheet = flag('--sheet');
const mp3 = flag('--mp3');
const bits = Number(flag('--bits', 24));
const expect = flag('--expect');
const report = bool('--report');
const wantStems = bool('--stems');
const [inPath, outPath = 'out.wav'] = args;
if (!inPath) {
  console.error('使い方: node daw/tools/render.mjs song.json out.wav [--mp3 out.mp3] [--sheet out.png] [--report] [--stems]');
  process.exit(1);
}

const data = JSON.parse(readFileSync(inPath, 'utf8'));
const isSfx = !data.tracks && (data.layers || data.preset);
const t0 = Date.now();
let L, R, sr = 48000, song = null;
if (isSfx) {
  [L, R] = renderAnySfx(data, sr);
} else {
  const chk = validateSong(data);
  for (const e of chk.errors) console.error(`✗ ${e}`);
  for (const w of chk.warnings) console.error(`△ ${w}`);
  if (chk.errors.length) process.exit(1);
  song = data;
  const out = renderSong(song, { stems: wantStems, onProgress: (p, s) => process.stderr.write(`\r${Math.round(p * 100)}% ${s}            `) });
  process.stderr.write('\n');
  ({ L, R, sr } = out);
  var stems = out.stems;
}
console.log(`描画 ${(Date.now() - t0) / 1000}s  長さ ${(L.length / sr).toFixed(2)}s`);

// 書き出し
if (/\.(mp3|m4a)$/i.test(outPath)) {
  const tmp = outPath + '.tmp.wav';
  writeFileSync(tmp, encodeWav(L, R, sr, 24));
  transcode(tmp, outPath);
  unlinkSync(tmp);
} else writeFileSync(outPath, encodeWav(L, R, sr, bits));
console.log(`書き出し: ${outPath}`);
if (mp3) {
  const tmp = mp3 + '.tmp.wav';
  writeFileSync(tmp, encodeWav(L, R, sr, 24));
  transcode(tmp, mp3);
  unlinkSync(tmp);
  console.log(`書き出し: ${mp3}`);
}

// 解析
if (sheet || report) {
  const opts = song ? { bpm: song.bpm, beatsPerBar: beatsPerBar(song), stems, targetLufs: song.master?.loudness ?? -14, expectChords: expect ? expect.split(',').map((s) => s.trim()) : null, chordStep: song.chordStep } : {};
  const a = analyzeAudio(L, R, sr, opts);
  a.chordStep = song?.chordStep;
  if (report) {
    console.log(reportText(a));
    if (isSfx) console.log('エンベロープ:', JSON.stringify(sfxStats(L, R, sr)));
  }
  if (sheet) {
    const W = isSfx ? 1200 : 1600;
    const H = sheetHeight(a, song);
    const P = new Raster(W, H);
    a._wave = waveColumns(L, R, W - 90);
    drawSheet(P, a, { song, title: (song?.name || data.preset || inPath).replace(/[^\x20-\x7e]/g, ''), targetLufs: song ? song.master?.loudness ?? -14 : -14 });
    writeFileSync(sheet, encodePng(P.w, P.h, P.px));
    console.log(`見える化シート: ${sheet}`);
  }
}
