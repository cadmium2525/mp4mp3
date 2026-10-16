#!/usr/bin/env node
/*
 * かなでる：音声・動画ファイルを解析して、数値のレポートと見える化シートを作る。
 * （参考曲・効果音・書き出した動画の音を「見る」ために使う。ffmpeg が必要）
 *
 *   node daw/tools/analyze.mjs file.mp3|wav|m4a|mp4|mov [--sheet out.png] [--bpm 120] [--start 秒] [--dur 秒]
 */
import { writeFileSync } from 'node:fs';
import { analyzeAudio, reportText } from '../js/engine/analyze.js';
import { drawSheet, sheetHeight, Raster, waveColumns, sfxStats } from '../js/engine/viz.js';
import { decodeAudio, encodePng } from './common.mjs';

const args = process.argv.slice(2);
const flag = (name, def = null) => { const i = args.indexOf(name); if (i < 0) return def; const v = args[i + 1]; args.splice(i, 2); return v; };
const sheet = flag('--sheet');
const bpm = Number(flag('--bpm', 0)) || null;
const start = Number(flag('--start', 0));
const dur = Number(flag('--dur', 0));
const [path] = args;
if (!path) { console.error('使い方: node daw/tools/analyze.mjs file [--sheet out.png] [--bpm 120]'); process.exit(1); }
const sr = 48000;
let [L, R] = decodeAudio(path, sr);
if (start || dur) {
  const s = Math.round(start * sr), e = dur ? Math.min(L.length, s + Math.round(dur * sr)) : L.length;
  L = L.subarray(s, e); R = R.subarray(s, e);
}
const a = analyzeAudio(L, R, sr, bpm ? { bpm, beatsPerBar: 4 } : {});
if (!bpm && a.tempo) {
  // テンポを推定して、小節ごとの和音も出す
  Object.assign(a, analyzeAudio(L, R, sr, { bpm: a.tempo, beatsPerBar: 4 }));
}
console.log(reportText(a));
if (L.length / sr < 8) console.log('エンベロープ:', JSON.stringify(sfxStats(L, R, sr)));
if (sheet) {
  const W = 1600, P = new Raster(W, sheetHeight(a, null));
  a._wave = waveColumns(L, R, W - 90);
  drawSheet(P, a, { title: path.split('/').pop().replace(/[^\x20-\x7e]/g, '') });
  writeFileSync(sheet, encodePng(P.w, P.h, P.px));
  console.log(`見える化シート: ${sheet}`);
}
