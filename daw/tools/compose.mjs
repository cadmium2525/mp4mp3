#!/usr/bin/env node
/*
 * かなでる：おまかせ作曲。スタイルと長さを選ぶと、そのまま鳴らせる曲の JSON を作る。
 *
 *   node daw/tools/compose.mjs --style lofi --seconds 45 --seed 3 [--key "D minor"] [--bpm 84] [--energy 0.6] out.json
 *   node daw/tools/compose.mjs --style edm --bars 16 --loop out.json     # ループ用（終わりを付けない）
 *   node daw/tools/compose.mjs --list                                     # スタイルの一覧
 *
 *   --bake        自動クリップをふつうの音符に変換して書き出す
 *   --structure   場面の並びを指定（I イントロ / A / B サビ / C ブリッジ / O アウトロ。例 IAABB）
 *
 * 和音進行と構成を表示し、最後に「予定の和音（小節ごと）」を出す。そのまま render.mjs --expect に渡して照合できる。
 */
import { writeFileSync } from 'node:fs';
import { compose, bake, describeSong, expectedChords, STYLES } from '../js/engine/arranger.js';
import { validateSong } from '../js/engine/validate.js';

const args = process.argv.slice(2);
const flag = (name, def = null) => { const i = args.indexOf(name); if (i < 0) return def; const v = args[i + 1]; args.splice(i, 2); return v; };
const bool = (name) => { const i = args.indexOf(name); if (i < 0) return false; args.splice(i, 1); return true; };
if (bool('--list')) {
  for (const s of STYLES) console.log(`${s.id.padEnd(10)} ${s.label}（${s.desc}）  ${s.bpm[0]}〜${s.bpm[1]} BPM・${s.mode}`);
  process.exit(0);
}
const num = (v) => (v == null ? undefined : Number(v));
const opts = {
  style: flag('--style', 'pop'), key: flag('--key') ?? undefined, bpm: num(flag('--bpm')), bars: num(flag('--bars')), seconds: num(flag('--seconds')),
  seed: num(flag('--seed')) ?? 1, energy: num(flag('--energy')), structure: flag('--structure') ?? undefined, loop: bool('--loop'),
};
const doBake = bool('--bake');
const [outPath] = args;
if (!outPath) {
  console.error('使い方: node daw/tools/compose.mjs --style lofi --seconds 45 --seed 3 [--key "D minor"] [--bpm 84] out.json\n        （--list でスタイルの一覧）');
  process.exit(1);
}
let song;
try { song = compose(opts); } catch (e) { console.error(`✗ ${e.message}`); process.exit(1); }
if (doBake) song = bake(song);
const chk = validateSong(song);
for (const e of chk.errors) console.error(`✗ ${e}`);
for (const w of chk.warnings) console.error(`△ ${w}`);
if (chk.errors.length) process.exit(1);
writeFileSync(outPath, JSON.stringify(song, null, 1));
console.log(describeSong(song));
const sec = (song.bars * 4 * 60) / song.bpm + (song.tail ?? 3);
console.log(`長さ：${sec.toFixed(2)} 秒（余韻 ${song.tail ?? 3} 秒を含む）`);
console.log(`書き出し: ${outPath}`);
console.log(`expect: ${expectedChords(song).join(',')}`);
