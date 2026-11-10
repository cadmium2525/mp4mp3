#!/usr/bin/env node
/*
 * つなぐ：プロジェクト JSON に、動きに合わせた効果音を自動で付ける。
 *   node editor/tools/autosfx.mjs project.json out.json [--volume 0.5]
 * 効果音は「かなでる」のエンジンで書き出し時に作られる（素材ファイル不要）。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { autoSfx } from '../js/engine/autosfx.js';
import { normalizeProject } from '../js/engine/project.js';

const args = process.argv.slice(2);
const vi = args.indexOf('--volume');
const volume = vi >= 0 ? Number(args.splice(vi, 2)[1]) : 0.5;
const [inPath, outPath] = args;
if (!inPath || !outPath) { console.error('使い方: node editor/tools/autosfx.mjs project.json out.json [--volume 0.5]'); process.exit(1); }
const raw = JSON.parse(readFileSync(inPath, 'utf8'));
const list = autoSfx(normalizeProject({ ...raw, audios: [] }), { volume });
raw.audios = [...(raw.audios || []).filter((a) => !a.auto), ...list.map(({ why, ...a }) => a)];
writeFileSync(outPath, JSON.stringify(raw));
const counts = {};
for (const x of list) counts[x.why] = (counts[x.why] || 0) + 1;
console.log(`${list.length} 個の効果音を付けました`);
for (const [k, n] of Object.entries(counts)) console.log(`  ${k}：${n}`);
