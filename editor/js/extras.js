/*
 * つなぐ：追加機能の画面（ジェネレーター、かなでるの音、効果音の自動付け）。
 * App のメソッドとして取り付ける（installExtras）。
 */
import { newGen, newAudio, projectDuration, layoutClips } from './engine/project.js';
import { GENS, GEN_CATEGORIES, PALETTES, BLENDS } from './engine/gens/index.js';
import { synthFile, synthSfx, synthCompose } from './engine/synth.js';
import { autoSfx } from './engine/autosfx.js';
import { SFX_PRESETS, SFX_CATEGORIES } from '../../daw/js/engine/sfx.js';
import { STYLES } from '../../daw/js/engine/arranger.js';
import * as store from './store.js';

export function installExtras(App, { h, toast }) {
  const P = App.prototype;

  /* ---------- ジェネレーター ---------- */

  P.addGenDialog = function () {
    this.openSheet('ジェネレーターを追加', (body) => {
      for (const cat of GEN_CATEGORIES) {
        const list = Object.entries(GENS).filter(([, d]) => d.cat === cat.id);
        if (!list.length) continue;
        const grid = h('div', { class: 'gen-list' });
        for (const [type, def] of list) {
          const b = h('button', { type: 'button', class: 'gen-item' }, h('b', {}, def.label), h('small', {}, def.desc || ''));
          b.addEventListener('click', () => {
            const p = this.project;
            const t = Math.min(this.player.t, Math.max(0, this.player.duration - 0.3));
            const g = newGen(type, t, { end: t + 6 });
            this.closeSheet();
            this.change(() => { (p.gens ||= []).push(g); });
            this.select({ type: 'gen', id: g.id });
            this.player.seek(g.start);
            this.player.play();
          });
          grid.append(b);
        }
        body.append(h('div', { class: 'sec' }, h('div', { class: 'lbl' }, h('span', {}, cat.label)), grid));
      }
      body.append(h('p', { class: 'note' }, '素材を使わず、計算だけで描く映像です。配置したあと「編集」で文字・色・速さなどを変えられます。エフェクトの「ブルーム」を重ねると光がにじんで映えます。'));
    }, { tall: true });
  };

  P.genSheet = function (g) {
    const def = GENS[g.type];
    const reopen = () => { this.closeSheet(); this.openInspector(); };
    this.openSheet(def?.label || 'ジェネレーター', (body) => {
      const params = { ...(def?.defaults || {}), ...(g.params || {}) };
      const setP = (k, v) => { g.params = { ...(g.params || {}), [k]: v }; };
      for (const pr of def?.params || []) {
        const v = params[pr.key];
        if (pr.type === 'text') {
          const ta = h('textarea', { rows: '2' });
          ta.value = v ?? '';
          ta.addEventListener('change', () => this.change(() => setP(pr.key, ta.value)));
          body.append(h('div', { class: 'sec' }, h('div', { class: 'lbl' }, h('span', {}, pr.label)), ta));
        } else if (pr.type === 'select') body.append(this.seg(pr.label, pr.options, v, (x) => setP(pr.key, x)));
        else if (pr.type === 'toggle') body.append(this.toggle(pr.label, v, (x) => setP(pr.key, x)));
        else body.append(this.slider(pr.label, Number(v ?? pr.min), pr.min, pr.max, pr.step, (x) => String(Math.round(x * 100) / 100), (x) => setP(pr.key, x)));
      }
      const palNow = typeof g.palette === 'string' ? g.palette : g.colors ? 'custom' : 'default';
      body.append(
        this.seg('配色', [['default', '標準'], ...Object.keys(PALETTES).map((k) => [k, k])], palNow, (v) => { if (v === 'default') { delete g.palette; delete g.colors; } else { g.palette = v; delete g.colors; } }),
        h('div', { class: 'sec' }, h('button', { class: 'btn', type: 'button', onclick: () => { this.change(() => { g.seed = Math.floor(Math.random() * 9999) + 1; }); } }, '🎲 別のパターン（シード）')),
        this.slider('速さ', g.speed ?? 1, 0.1, 4, 0.05, (v) => `×${v.toFixed(2)}`, (v) => { g.speed = v; }),
        this.slider('不透明度', g.opacity ?? 1, 0, 1, 0.01, (v) => `${Math.round(v * 100)}%`, (v) => { g.opacity = v; }),
        this.seg('重ね方', Object.keys(BLENDS).slice(0, 6).map((k) => [k, { normal: '通常', add: '加算（光）', screen: 'スクリーン', multiply: '乗算', overlay: 'オーバーレイ', lighten: '明るい方' }[k]]), g.blend || 'normal', (v) => { g.blend = v; }),
        this.seg('重なり順', [['back', '映像の後ろ'], ['mid', '映像の上'], ['top', '文字の上']], g.z || 'mid', (v) => { g.z = v; }),
        this.slider('横の位置', g.x ?? 0.5, -0.5, 1.5, 0.01, (v) => v.toFixed(2), (v) => { g.x = v; }),
        this.slider('縦の位置', g.y ?? 0.5, -0.5, 1.5, 0.01, (v) => v.toFixed(2), (v) => { g.y = v; }),
        this.slider('幅', g.w ?? 1, 0.05, 2, 0.01, (v) => `${Math.round(v * 100)}%`, (v) => { g.w = v; }),
        this.slider('高さ', g.h ?? 1, 0.05, 2, 0.01, (v) => `${Math.round(v * 100)}%`, (v) => { g.h = v; }),
        this.seg('音に反応', [['', 'しない'], ['kick', 'キック'], ['bass', '低音'], ['level', '全体の音量']], g.react?.src || '', (v) => { if (v) g.react = { src: v, prop: 'scale', amount: 0.12 }; else delete g.react; }),
      );
      body.append(h('div', { class: 'sec' },
        h('div', { class: 'row-btns' },
          h('button', { class: 'btn', type: 'button', onclick: () => { this.change(() => { const d = g.end - g.start; g.start = this.player.t; g.end = g.start + d; }); reopen(); } }, 'ここから表示'),
          h('button', { class: 'btn', type: 'button', onclick: () => { if (this.player.t <= g.start + 0.1) return toast('開始より後ろに再生ヘッドを合わせてください'); this.change(() => { g.end = this.player.t; }); reopen(); } }, 'ここまで表示'),
          h('button', { class: 'btn', type: 'button', onclick: () => { this.player.seek(g.start); this.player.play(); } }, '▶ 再生'))));
    }, { tall: true });
  };

  /* ---------- 音：ファイル / かなでる ---------- */

  /** 作った音（WAV）を素材として登録し、タイムラインに置く */
  P.addGenerated = async function (gen, name, start, opts = {}) {
    const p = this.project;
    const file = await synthFile(gen, name);
    const meta = await this.lib.add(file);
    meta.gen = gen;
    p.media[meta.id] = meta;
    await store.putMedia(p.id, meta, file);
    const a = newAudio(meta, start, { loop: false, fadeOut: gen.song ? 1 : 0.05, ...opts });
    p.audios.push(a);
    return a;
  };

  P.audioMenu = function () {
    this.openSheet('音楽・音を追加', (body) => {
      const item = (title, sub, fn) => { const b = h('button', { type: 'button', class: 'gen-item' }, h('b', {}, title), h('small', {}, sub)); b.addEventListener('click', fn); return b; };
      body.append(h('div', { class: 'gen-list one' },
        item('ファイルから', '端末の音楽・音声・動画の音を使う', () => { this.closeSheet(); document.getElementById('fileAudio').click(); }),
        item('おまかせ BGM', '動画の長さにぴったり合う曲を、その場で作曲する（18 スタイル）', () => this.bgmDialog()),
        item('効果音を選ぶ', 'かなでるの効果音（シュッ・ポン・インパクトなど）を作って置く', () => this.sfxDialog()),
        item('効果音を自動で付ける', '文字や図形の出現・切り替え・エフェクトに合わせて、効果音をまとめて付ける', () => this.autoSfxDialog()),
        item('かなでるで作った曲', 'かなでる（作曲アプリ）に保存してある曲を BGM にする', () => this.kanaderuSongs()),
      ));
    });
  };

  P.bgmDialog = function () {
    let style = 'corporate', energy = 0.6;
    const dur = Math.max(8, Math.round(this.player.duration || 30));
    this.openSheet('おまかせ BGM', (body) => {
      const grid = h('div', { class: 'seg' });
      for (const st of STYLES) {
        const b = h('button', { type: 'button', class: st.id === style ? 'on' : '' }, st.label);
        b.onclick = () => { style = st.id; [...grid.children].forEach((x) => x.classList.toggle('on', x === b)); note.textContent = st.desc || ''; };
        grid.append(b);
      }
      const note = h('p', { class: 'note' }, STYLES.find((s) => s.id === style)?.desc || '');
      const go = h('button', { class: 'btn primary wide', type: 'button' }, `${dur} 秒の曲を作って置く`);
      go.onclick = async () => {
        go.disabled = true; go.textContent = '作曲中…';
        try {
          const m = await synthCompose({ style, seconds: dur, seed: Math.floor(Math.random() * 9999) + 1, energy });
          go.textContent = '音にしています…';
          this.beginEdit();
          await this.addGenerated({ song: m.song }, `BGM_${m.song.name || style}.wav`, 0, { volume: 0.5, fadeIn: 0.3, fadeOut: 1.5 });
          this.endEdit();
          this.closeSheet();
          toast('BGM を置きました（音量は音のブロックを選んで調整できます）', 4000);
        } catch (err) { this.endEdit(); toast('作れませんでした：' + err.message, 5000); go.disabled = false; go.textContent = `${dur} 秒の曲を作って置く`; }
      };
      body.append(h('div', { class: 'sec' }, grid), note,
        this.slider('盛り上がり', energy, 0, 1, 0.05, (v) => `${Math.round(v * 100)}%`, (v) => { energy = v; }),
        h('div', { class: 'sec' }, go),
        h('p', { class: 'note' }, '曲は余韻まで含めて動画の長さちょうどになります。細かく直したいときは「かなでる」で作曲してください。'));
    }, { tall: true });
  };

  let ac = null;
  const playPcm = (m) => {
    ac ||= new (window.AudioContext || window.webkitAudioContext)();
    ac.resume?.();
    const b = ac.createBuffer(2, m.L.length, m.sr);
    b.copyToChannel(m.L, 0); b.copyToChannel(m.R, 1);
    const s = ac.createBufferSource();
    s.buffer = b; s.connect(ac.destination); s.start();
  };

  P.sfxDialog = function () {
    let spec = { preset: 'whoosh', seed: 1 };
    this.openSheet('効果音を選ぶ', (body) => {
      const lists = [];
      const pick = (k, b) => { spec = { ...spec, preset: k }; for (const x of lists) x.classList.remove('on'); b.classList.add('on'); synthSfx(spec).then(playPcm).catch((e) => toast(e.message)); };
      for (const cat of SFX_CATEGORIES) {
        const seg = h('div', { class: 'seg' });
        for (const [k, pr] of Object.entries(SFX_PRESETS)) {
          if (pr.cat !== cat.id) continue;
          const b = h('button', { type: 'button', class: k === spec.preset ? 'on' : '' }, pr.label);
          b.onclick = () => pick(k, b);
          lists.push(b); seg.append(b);
        }
        body.append(h('div', { class: 'sec' }, h('div', { class: 'lbl' }, h('span', {}, cat.label)), seg));
      }
      const knob = (key, label, min, max, step, def, f) => {
        const out = h('output', {}, f(def));
        const input = h('input', { type: 'range', min: String(min), max: String(max), step: String(step) });
        input.value = String(def);
        input.addEventListener('input', () => { out.textContent = f(Number(input.value)); });
        input.addEventListener('change', () => { spec = { ...spec, [key]: Number(input.value) }; synthSfx(spec).then(playPcm).catch(() => {}); });
        return h('div', { class: 'sec' }, h('div', { class: 'lbl' }, h('span', {}, label), out), input);
      };
      const go = h('button', { class: 'btn primary wide', type: 'button' }, '再生ヘッドの位置に置く');
      go.onclick = async () => {
        go.disabled = true;
        try {
          this.beginEdit();
          const a = await this.addGenerated({ sfx: spec }, `効果音_${SFX_PRESETS[spec.preset].label}.wav`, this.player.t, { volume: 0.7 });
          this.endEdit();
          this.closeSheet();
          this.select({ type: 'audio', id: a.id });
        } catch (err) { this.endEdit(); toast(err.message, 4000); go.disabled = false; }
      };
      body.append(
        knob('pitch', '高さ', -12, 12, 1, 0, (v) => `${v > 0 ? '+' : ''}${v} 半音`),
        knob('length', '長さ', 0.3, 3, 0.05, 1, (v) => `×${v.toFixed(2)}`),
        knob('tone', '明るさ', -1, 1, 0.05, 0, (v) => v.toFixed(2)),
        h('div', { class: 'sec row-btns' },
          h('button', { class: 'btn', type: 'button', onclick: () => synthSfx(spec).then(playPcm) }, '▶ 試聴'),
          h('button', { class: 'btn', type: 'button', onclick: () => { spec = { ...spec, seed: Math.floor(Math.random() * 9999) }; synthSfx(spec).then(playPcm); } }, '🎲 ばらつき')),
        h('div', { class: 'sec' }, go));
    }, { tall: true });
  };

  P.autoSfxDialog = function () {
    const p = this.project;
    const list = autoSfx(p);
    const old = p.audios.filter((a) => a.auto).length;
    this.openSheet('効果音を自動で付ける', (body) => {
      if (!list.length) { body.append(h('p', { class: 'note' }, '効果音を付けられる動き（文字や図形の出現、切り替え、エフェクトなど）が見つかりませんでした。')); return; }
      const counts = {};
      for (const x of list) counts[x.why] = (counts[x.why] || 0) + 1;
      const ul = h('ul', { class: 'note' }, ...Object.entries(counts).map(([k, n]) => h('li', {}, `${k}：${n} か所`)));
      let vol = 0.5;
      const go = h('button', { class: 'btn primary wide', type: 'button' }, `${list.length} 個の効果音を付ける`);
      go.onclick = async () => {
        go.disabled = true;
        try {
          this.beginEdit();
          // 前に自動で付けたものは置き換える
          p.audios = p.audios.filter((a) => !a.auto);
          const cache = new Map();
          let k = 0;
          for (const x of autoSfx(p, { volume: vol })) {
            go.textContent = `作成中… ${++k}/${list.length}`;
            const key = JSON.stringify(x.sfx);
            let meta = cache.get(key);
            if (!meta) {
              const a = await this.addGenerated({ sfx: x.sfx }, `効果音_${SFX_PRESETS[x.sfx.preset]?.label || x.sfx.preset}.wav`, x.start, { volume: x.volume, auto: true });
              cache.set(key, p.media[a.media]);
            } else p.audios.push(newAudio(meta, x.start, { loop: false, fadeOut: 0.05, volume: x.volume, auto: true }));
          }
          this.endEdit();
          this.closeSheet();
          toast(`${list.length} 個の効果音を付けました（元に戻すボタンで取り消せます）`, 4000);
        } catch (err) { this.endEdit(); toast(err.message, 5000); go.disabled = false; }
      };
      body.append(h('p', { class: 'note' }, '映像の動きに合わせて、次の場所に効果音を付けます。連続する「ポン」は音階で上がっていくようにします。'), ul,
        old ? h('p', { class: 'note' }, `前に自動で付けた ${old} 個は、新しいものに置き換えます。`) : null,
        this.slider('音量', vol, 0.1, 1, 0.05, (v) => `${Math.round(v * 100)}%`, (v) => { vol = v; }),
        h('div', { class: 'sec' }, go));
    }, { tall: true });
  };

  P.kanaderuSongs = async function () {
    let songs = [];
    try {
      songs = await new Promise((res, rej) => {
        const r = indexedDB.open('kanaderu');
        r.onerror = () => rej(r.error);
        r.onsuccess = () => {
          const d = r.result;
          if (!d.objectStoreNames.contains('songs')) { d.close(); return res([]); }
          const q = d.transaction('songs', 'readonly').objectStore('songs').getAll();
          q.onsuccess = () => { d.close(); res(q.result || []); };
          q.onerror = () => { d.close(); rej(q.error); };
        };
      });
    } catch { /* まだ使っていない */ }
    this.openSheet('かなでるで作った曲', (body) => {
      if (!songs.length) { body.append(h('p', { class: 'note' }, 'まだ曲がありません。'), h('a', { class: 'btn', href: '../daw/' }, 'かなでるを開く')); return; }
      const list = h('div', { class: 'gen-list one' });
      for (const it of songs.sort((a, b) => (b.updated || 0) - (a.updated || 0))) {
        const b = h('button', { type: 'button', class: 'gen-item' }, h('b', {}, it.name || '無題'), h('small', {}, `${it.song?.bpm || '?'} BPM ・ ${it.song?.tracks?.length || 0} トラック`));
        b.onclick = async () => {
          b.disabled = true; b.querySelector('small').textContent = '音にしています…';
          try {
            this.beginEdit();
            await this.addGenerated({ song: it.song }, `${it.name || 'かなでる'}.wav`, 0, { volume: 0.5, fadeIn: 0.3, fadeOut: 1.5 });
            this.endEdit();
            this.closeSheet();
            toast('BGM を置きました');
          } catch (err) { this.endEdit(); toast(err.message, 5000); b.disabled = false; }
        };
        list.append(b);
      }
      body.append(list);
    }, { tall: true });
  };
}
