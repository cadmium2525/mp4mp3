#!/usr/bin/env node
/*
 * Motion Prompt（https://github.com/showheyohtaki/motion-prompt, MIT）を つなぐ に取り込む。
 *   node editor/tools/vendor-motion-prompt.mjs <motion-prompt のクローン>
 * packs/<pack>/pack.js をコピーし（パレット C も返すように1行だけ変更）、
 * meta.json と各要素の見出し（1周の秒数）から catalog.json を作る。
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, copyFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const src = process.argv[2];
if (!src) { console.error('使い方: node editor/tools/vendor-motion-prompt.mjs <motion-prompt のクローン>'); process.exit(1); }
const out = join(dirname(fileURLToPath(import.meta.url)), '../lib/motion-prompt');
mkdirSync(out, { recursive: true });

const cat = JSON.parse(readFileSync(join(src, 'api/v1/catalog.json'), 'utf8'));
const elements = [];
const packs = [];
for (const p of cat.packs) {
  const js = readFileSync(join(src, 'packs', p.pack, 'pack.js'), 'utf8');
  const ret = /return \{ width: CW, height: CH, cycle: ([^,]+), cells: CELLS, fonts: (\[[^\]]*\]) \};/;
  if (!ret.test(js)) throw new Error(`${p.pack}/pack.js の形式が想定と違います`);
  // つなぐで色を差し替えられるよう、パレット C も返す（Motion Prompt からの唯一の変更）
  const hasC = /\bconst C = \{/.test(js);
  writeFileSync(join(out, `${p.pack}.js`), hasC ? js.replace(ret, 'return { width: CW, height: CH, cycle: $1, cells: CELLS, fonts: $2, palette: C };') : js);
  const meta = JSON.parse(readFileSync(join(src, 'packs', p.pack, 'meta.json'), 'utf8'));
  const first = parseInt(p.first, 10);
  const palette = {};
  const m = /const C = \{([\s\S]*?)\};/.exec(js);
  if (m) for (const [, k, v] of m[1].matchAll(/(\w+): '(#[0-9A-Fa-f]{6})'/g)) palette[k] = v;
  packs.push({ pack: p.pack, title: p.title, categories: p.categories, width: p.width, height: p.height, cycle: p.cycle, first: p.first, last: p.last, palette });
  for (const e of meta.elements) {
    const id = String(first + parseInt(e.no, 10) - 1).padStart(3, '0');
    const head = readFileSync(join(src, 'api/v1/ja/e', `${id}.txt`), 'utf8');
    const cyc = /1周: ([\d.]+) s/.exec(head);
    const size = /サイズ: (\d+)x(\d+) px/.exec(head);
    elements.push({
      id, pack: p.pack, index: parseInt(e.no, 10) - 1, category: e.category,
      name: e.name, meaning: e.meaning, summary: e.summary, spec: e.spec, ask: e.ask, use: e.use, tags: e.tags,
      cycle: cyc ? Number(cyc[1]) : p.cycle,
      width: size ? Number(size[1]) : p.width, height: size ? Number(size[2]) : p.height,
    });
  }
}
writeFileSync(join(out, 'catalog.json'), JSON.stringify({ version: cat.version, site: cat.site, repo: cat.repo, packs, elements }));
copyFileSync(join(src, 'LICENSE'), join(out, 'LICENSE'));
writeFileSync(join(out, 'README.md'), `# Motion Prompt（取り込み）

[Motion Prompt](${cat.repo})（MIT License © 2026 Shohei Ohtaki）の ${elements.length} 個の要素を、つなぐ で使えるように取り込んだものです。
カタログのバージョン: ${cat.version}

- \`<pack>.js\` … 各パックの kit と要素（元の \`packs/<pack>/pack.js\`）。つなぐで色を差し替えられるよう、パレット \`C\` があるパックは最後の \`return\` に \`C\` を足しています（変更はこの1行のみ）。
- \`catalog.json\` … 名前・意味・仕様・1周の秒数などの一覧（元の \`packs/<pack>/meta.json\` と \`api/v1/ja/e/*.txt\` から生成）。
- 更新するとき: \`node editor/tools/vendor-motion-prompt.mjs <motion-prompt のクローン>\`
`);
console.log(`${elements.length} 個の要素、${packs.length} パックを取り込みました → ${out}`);
