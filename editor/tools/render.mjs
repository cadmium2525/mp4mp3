#!/usr/bin/env node
/*
 * つなぐ のプロジェクト JSON を、ブラウザと同じエンジンで書き出すコマンド。
 *
 *   node editor/tools/render.mjs project.json 素材フォルダ out.mp4 [--still 秒 | --sheet 枚数] [--short 1080] [--quality high] [--force]
 *
 *   --still 3     3秒地点の静止画（PNG）
 *   --sheet 12    全体を12コマに分けた一覧画像（PNG）
 *   --force       JSON にエラーがあっても書き出す
 *
 * ヘッドレス Chromium（Playwright）で editor/render.html を開いて書き出す。
 * Chromium が H.264/AAC に対応していない場合は VP9/Opus で書き出され、ffmpeg があれば H.264/AAC に変換する。
 */
import { createRequire } from 'node:module';
import { readFileSync, readdirSync, existsSync, renameSync } from 'node:fs';
import { createServer } from 'node:http';
import { join, resolve, extname, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
let playwright;
try { playwright = require('playwright'); } catch {
  const g = spawnSync('npm', ['root', '-g'], { encoding: 'utf8' }).stdout.trim();
  playwright = require(join(g, 'playwright'));
}

const args = process.argv.slice(2);
const flag = (name, def) => { const i = args.indexOf(name); if (i < 0) return def; const v = args[i + 1]; args.splice(i, 2); return v; };
const still = flag('--still', null);
const sheet = flag('--sheet', null);
const force = args.includes('--force');
if (force) args.splice(args.indexOf('--force'), 1);
const shortSide = Number(flag('--short', 1080));
const quality = flag('--quality', 'high');
const [projPath, mediaDir, outPath = 'out.mp4'] = args;
if (!projPath || !mediaDir) {
  console.error('使い方: node editor/tools/render.mjs project.json 素材フォルダ out.mp4 [--still 秒] [--short 1080] [--quality standard|high|max]');
  process.exit(1);
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = createServer((req, res) => {
  const p = join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!p.startsWith(root) || !existsSync(p)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': types[extname(p)] || 'application/octet-stream' });
  res.end(readFileSync(p));
});
await new Promise((r) => server.listen(0, r));
const port = server.address().port;

const project = JSON.parse(readFileSync(projPath, 'utf8'));
const { validateProject } = await import('../js/engine/validate.js');
const check = validateProject(project);
for (const e of check.errors) console.error(`✗ ${e}`);
for (const w of check.warnings) console.error(`△ ${w}`);
if (check.errors.length && !force) {
  console.error(`JSON にエラーが ${check.errors.length} 件あります（--force で無視して書き出し）`);
  process.exit(1);
}
const files = readdirSync(mediaDir).map((f) => join(mediaDir, f));

const browser = await playwright.chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
try {
  const page = await browser.newPage({ acceptDownloads: true });
  page.on('console', (m) => { if (m.text().startsWith('progress')) process.stderr.write(`\r${m.text().slice(9)}        `); else if (m.type() === 'error' && !/WebGL|GPU stall|swiftshader/i.test(m.text())) console.error(m.text()); });
  page.on('pageerror', (e) => console.error('pageerror', e.message));
  await page.goto(`http://localhost:${port}/editor/render.html`);
  await page.waitForFunction(() => window.ready);
  await page.setInputFiles('#files', files);
  const [download, info] = await Promise.all([
    page.waitForEvent('download', { timeout: 0 }),
    still != null
      ? page.evaluate(([p, t]) => window.renderStill(p, t), [project, Number(still)])
      : sheet != null
        ? page.evaluate(([p, n]) => window.renderSheet(p, n, n > 12 ? 5 : 4), [project, Number(sheet) || 12])
        : page.evaluate(([p, o]) => window.renderProject(p, o), [project, { shortSide, quality }]),
  ]);
  process.stderr.write('\n');
  if (still != null || sheet != null) {
    await download.saveAs(outPath);
    console.log(`${still != null ? '静止画' : 'コマ一覧'}: ${outPath}`);
  } else {
    const tmp = outPath + '.tmp.mp4';
    await download.saveAs(tmp);
    console.log(`書き出し: ${info.width}x${info.height} ${info.duration.toFixed(2)}秒 映像=${info.codec} 音声=${info.audioCodec}`);
    const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;
    if (info.codec !== 'avc' && hasFfmpeg) {
      // SNS で確実に再生できるよう H.264 / AAC に変換
      const r = spawnSync('ffmpeg', ['-v', 'error', '-y', '-i', tmp, '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', outPath], { stdio: 'inherit' });
      if (r.status !== 0) throw new Error('ffmpeg での変換に失敗しました');
      console.log(`H.264/AAC に変換: ${outPath}`);
    } else {
      renameSync(tmp, outPath);
    }
  }
} finally {
  await browser.close();
  server.close();
}
