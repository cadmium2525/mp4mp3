#!/usr/bin/env node
/*
 * つなぐに取り込んだ Motion Prompt の一覧を引く（AI・PC 向け）。
 *   node editor/tools/motion-catalog.mjs list [pack]        一覧（pack: motion / camera / ui / lp / photo）
 *   node editor/tools/motion-catalog.mjs search 文字 登場    言葉で探す（日本語・英語）
 *   node editor/tools/motion-catalog.mjs get 12 45          仕様（動き・時間・1周の秒数・パレット）
 * 使い方：つなぐの JSON の motions に { "ref": "012", ... } と書くと、その要素がそのまま描かれる。
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const cat = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../lib/motion-prompt/catalog.json'), 'utf8'));
const [cmd = 'list', ...args] = process.argv.slice(2);
const id3 = (s) => String(s).replace(/^#/, '').padStart(3, '0');
const line = (e) => `#${e.id}  ${e.name.ja} / ${e.name.en}  [${e.pack}] ${e.cycle}s — ${e.summary.ja}`;

if (cmd === 'list') {
  for (const p of cat.packs) {
    if (args[0] && p.pack !== args[0]) continue;
    console.log(`\n■ ${p.pack}：${p.title.ja}（#${p.first}〜#${p.last}・カード ${p.width}x${p.height}・1周 ${p.cycle}s）`);
    for (const c of p.categories) {
      console.log(`  ${c.ja}`);
      for (const e of cat.elements.filter((x) => x.pack === p.pack && x.category === c.slug)) console.log('   ' + line(e));
    }
  }
} else if (cmd === 'search') {
  const words = args.map((w) => w.toLowerCase());
  const score = (e) => {
    const hay = [e.name.ja, e.name.en, e.meaning.ja, e.meaning.en, e.summary.ja, e.summary.en, e.tags.join(' '), e.use.ja, ...e.spec.ja].join(' ').toLowerCase();
    return words.reduce((s, w) => s + (hay.includes(w) ? 1 + (e.name.ja + e.name.en).toLowerCase().includes(w) * 2 + e.tags.includes(w) : 0), 0);
  };
  const hits = cat.elements.map((e) => [score(e), e]).filter(([s]) => s > 0).sort((a, b) => b[0] - a[0]).slice(0, 12);
  if (!hits.length) console.log('見つかりませんでした');
  for (const [, e] of hits) console.log(line(e));
} else if (cmd === 'get') {
  for (const a of args) {
    const e = cat.elements.find((x) => x.id === id3(a));
    if (!e) { console.log(`#${id3(a)} はありません`); continue; }
    const p = cat.packs.find((x) => x.pack === e.pack);
    console.log(`\n#${e.id} ${e.name.ja} / ${e.name.en}（${e.pack}・カード ${e.width}x${e.height}・1周 ${e.cycle}s）`);
    console.log(`意味: ${e.meaning.ja}\n何が起きるか: ${e.summary.ja}\n使いどころ: ${e.use.ja}`);
    console.log('動きの仕様:\n' + e.spec.ja.map((s) => '  - ' + s).join('\n'));
    if (Object.keys(p.palette).length) console.log('パレット（colors で差し替え可）: ' + Object.entries(p.palette).map(([k, v]) => `${k}=${v}`).join(' '));
    console.log(`見本: ${cat.site}#${e.id}`);
  }
} else {
  console.log('使い方: list [pack] | search 言葉… | get 番号…');
}
