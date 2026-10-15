#!/usr/bin/env node
/*
 * プロジェクト JSON をチェックする。
 *   node editor/tools/validate.mjs project.json
 * エラーがあれば終了コード 1。
 */
import { readFileSync } from 'node:fs';
import { validateProject } from '../js/engine/validate.js';

const path = process.argv[2];
if (!path) { console.error('使い方: node editor/tools/validate.mjs project.json'); process.exit(2); }
let data;
try { data = JSON.parse(readFileSync(path, 'utf8')); } catch (e) { console.error(`JSON として読めません: ${e.message}`); process.exit(1); }
const { errors, warnings } = validateProject(data);
for (const e of errors) console.log(`✗ ${e}`);
for (const w of warnings) console.log(`△ ${w}`);
if (!errors.length && !warnings.length) console.log('✓ 問題ありません');
else console.log(`\nエラー ${errors.length} 件 / 注意 ${warnings.length} 件`);
process.exit(errors.length ? 1 : 0);
