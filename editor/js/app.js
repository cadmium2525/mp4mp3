import {
  PRESETS, TRANSITIONS, TEXT_STYLES, newProject, newClip, newText, newAudio, newShape, newEffect, newOverlay, overlayEnd, uid,
  layoutClips, mediaTime, normalizeProject, usedMediaIds,
} from './engine/project.js';
import { MediaLibrary } from './engine/media.js';
import { exportVideo, outputSize, supportedCodecs, QUALITIES } from './engine/exporter.js';
import { drawText, measureText, loadFonts, overlayBox } from './engine/render.js';
import { SHAPES, EFFECTS, drawShape, shapeBox, withMotion, keyStates, itemEnd, ANIM_PROPS, GRADIENTS } from './engine/fx.js';
import { loadCutout, cutoutReady } from './engine/cutout.js';
import { validateProject } from './engine/validate.js';
import { Player } from './player.js';
import { Timeline } from './timeline.js';
import * as store from './store.js';

const $ = (s, el = document) => el.querySelector(s);
const h = (tag, props = {}, ...children) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') e.className = v;
    else if (k === 'innerHTML') e.innerHTML = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k in e && typeof v !== 'string') e[k] = v;
    else e.setAttribute(k, v);
  }
  for (const c of children.flat()) if (c != null && c !== false) e.append(c);
  return e;
};

const fmt = (s) => {
  s = Math.max(0, s || 0);
  const m = Math.floor(s / 60);
  return `${m}:${(s % 60).toFixed(1).padStart(4, '0')}`;
};

const ICONS = {
  add: '<path d="M12 5v14M5 12h14"/>',
  media: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M10 9.5v5l4-2.5z"/>',
  text: '<path d="M5 6h14M12 6v13M9 19h6"/>',
  music: '<path d="M9 18V6l10-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/>',
  split: '<path d="M12 3v18"/><path d="M5 8l-2 4 2 4M19 8l2 4-2 4"/>',
  speed: '<path d="M12 13l4-4"/><path d="M4 18a8 8 0 1116 0"/>',
  volume: '<path d="M4 10v4h4l5 4V6L8 10z"/><path d="M16 9a4 4 0 010 6M18.5 6.5a7.5 7.5 0 010 11"/>',
  frame: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 9h16M9 4v16"/>',
  color: '<circle cx="12" cy="12" r="8"/><path d="M12 4v16M12 4a8 8 0 010 16"/>',
  trans: '<rect x="3" y="6" width="8" height="12" rx="1.5"/><rect x="13" y="6" width="8" height="12" rx="1.5"/>',
  left: '<path d="M14 6l-6 6 6 6"/>',
  right: '<path d="M10 6l6 6-6 6"/>',
  dup: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 00-1-1H5a1 1 0 00-1 1v10a1 1 0 001 1h3"/>',
  del: '<path d="M5 7h14M10 7V5h4v2M7 7l1 13h8l1-13"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
  ratio: '<rect x="7" y="3" width="10" height="18" rx="2"/>',
  shape: '<circle cx="9" cy="9" r="5"/><rect x="11" y="11" width="9" height="9" rx="1.5"/>',
  fx: '<path d="M12 3l1.8 4.7L19 9l-4.2 3 1.3 5.2L12 14.5 7.9 17.2 9.2 12 5 9l5.2-1.3z"/>',
  front: '<rect x="4" y="4" width="11" height="11" rx="1.5"/><path d="M9 20h11V9"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 00-1-1H5a1 1 0 00-1 1v10a1 1 0 001 1h3"/>',
  pip: '<rect x="3" y="5" width="18" height="14" rx="2"/><rect x="12" y="11" width="7" height="6" rx="1"/>',
  cut: '<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M8.5 8L20 19M8.5 16L20 5"/>',
};
const icon = (name) => `<svg viewBox="0 0 24 24">${ICONS[name]}</svg>`;

class App {
  constructor() {
    this.lib = new MediaLibrary();
    this.project = null;
    this.undoStack = [];
    this.redoStack = [];
    this.editing = false;
    this.snapshot = null;
    this.saveTimer = 0;
    this.player = new Player($('#preview'), this.lib, {
      onTime: (t) => this.#onTime(t),
      onState: (on) => document.body.classList.toggle('playing', on),
    });
    this.player.onAudioReady = () => this.timeline?.render();
    this.timeline = new Timeline($('#timeline'), this);
    this.#bind();
    this.showHome();
  }

  /* ================= ホーム ================= */

  async showHome() {
    this.player.pause();
    for (const r of document.querySelectorAll('.tl-row')) r.textContent = '';
    $('#editor').hidden = true;
    $('#home').hidden = false;
    const pre = $('#presets');
    pre.textContent = '';
    for (const [key, p] of Object.entries(PRESETS)) {
      const s = 44 / Math.max(p.width, p.height);
      const shape = h('div', { class: 'shape' });
      shape.style.width = `${p.width * s}px`;
      shape.style.height = `${p.height * s}px`;
      pre.append(h('button', { class: 'preset', type: 'button', onclick: () => this.createProject(key) },
        h('div', { style: 'height:46px;display:grid;place-items:center' }, shape), h('b', {}, p.ratio), h('small', {}, p.label)));
    }
    const list = $('#projects');
    list.textContent = '';
    let projects = [];
    try { projects = await store.listProjects(); } catch { toast('保存領域を開けませんでした（プライベートブラウズでは保存できません）'); }
    if (!projects.length) list.append(h('li', { class: 'empty-note' }, 'まだプロジェクトはありません。上の比率を選んで始めましょう。'));
    for (const p of projects) {
      const d = new Date(p.updatedAt);
      list.append(h('li', { class: 'proj', onclick: () => this.openProject(p.id) },
        p.thumb ? h('img', { src: p.thumb, alt: '' }) : h('div', { class: 'ph' }),
        h('div', { class: 'pi' },
          h('div', { class: 'pn' }, p.name),
          h('div', { class: 'pm' }, `${p.ratio || ''}  ${fmt(p.duration || 0)}  ・ ${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`)),
        h('button', {
          class: 'icon-btn more', type: 'button', 'aria-label': 'その他',
          onclick: (e) => { e.stopPropagation(); this.projectActions(p); },
          innerHTML: '<svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/></svg>',
        })));
    }
    const est = await store.storageEstimate();
    $('#storageNote').textContent = est && est.quota ? `端末内の使用量：${(est.usage / 1e6).toFixed(0)} MB / 利用可能 ${(est.quota / 1e9).toFixed(1)} GB` : '';
  }

  projectActions(p) {
    this.openSheet('プロジェクト', (body) => {
      body.append(
        h('p', {}, p.name),
        h('div', { class: 'row-btns' },
          h('button', { class: 'btn', type: 'button', onclick: () => { this.closeSheet(); this.openProject(p.id); } }, '開く'),
          h('button', { class: 'btn', type: 'button', onclick: () => this.duplicateProject(p.id) }, '複製'),
          h('button', {
            class: 'btn danger', type: 'button', onclick: async () => {
              if (!confirm(`「${p.name}」を削除しますか？素材も端末から削除されます。`)) return;
              await store.deleteProject(p.id);
              this.closeSheet();
              this.showHome();
            },
          }, '削除')));
    });
  }

  async duplicateProject(id) {
    const data = await store.loadProject(id);
    if (!data) return;
    const copy = JSON.parse(JSON.stringify(data));
    copy.id = uid('p');
    copy.name = data.name + ' のコピー';
    const idMap = {};
    for (const mid of Object.keys(data.media)) {
      const rec = await store.getMedia(mid);
      if (!rec) continue;
      const nid = uid('m');
      idMap[mid] = nid;
      await store.putMedia(copy.id, { ...rec.meta, id: nid }, rec.blob);
    }
    copy.media = Object.fromEntries(Object.entries(data.media).map(([k, v]) => [idMap[k] || k, { ...v, id: idMap[k] || k }]));
    for (const c of copy.clips) c.media = idMap[c.media] || c.media;
    for (const a of copy.audios) a.media = idMap[a.media] || a.media;
    await store.saveProject(copy, { ratio: ratioOf(copy) });
    this.closeSheet();
    this.showHome();
    toast('複製しました');
  }

  async createProject(preset) {
    const p = newProject(preset);
    store.requestPersist();
    await store.saveProject(p, { ratio: ratioOf(p), duration: 0 });
    await this.openProject(p.id);
    this.addMediaDialog();
  }

  async openProject(id) {
    const data = await store.loadProject(id);
    if (!data) { toast('プロジェクトが見つかりません'); return; }
    for (const mid of [...this.lib.entries.keys()]) this.lib.remove(mid);
    this.player.audioBufs.clear();
    const project = normalizeProject(data);
    $('#home').hidden = true;
    $('#editor').hidden = false;
    this.project = project;
    this.undoStack = [];
    this.redoStack = [];
    this.select(null);
    // 素材を復元
    const missing = [];
    await Promise.all(Object.values(project.media).map(async (m) => {
      const rec = await store.getMedia(m.id).catch(() => null);
      if (rec) await this.lib.restore(m, rec.blob);
      else missing.push(m.name);
    }));
    if (missing.length) toast(`見つからない素材があります：${missing.join('、')}`);
    this.player.t = 0;
    this.refresh();
    this.timeline.setTime(0);
    loadFonts(project);
  }

  /* ================= 編集の基本 ================= */

  refresh() {
    const p = this.project;
    $('#projName').textContent = p.name;
    this.player.setProject(p);
    this.timeline.render();
    this.timeline.setTime(this.player.t);
    this.#onTime(this.player.t);
    this.renderToolbar();
    $('#undo').disabled = !this.undoStack.length;
    $('#redo').disabled = !this.redoStack.length;
  }

  beginEdit() {
    if (this.editing) return;
    this.editing = true;
    this.snapshot = JSON.stringify(this.project);
  }

  /** ドラッグ中などの途中経過を反映（元に戻す履歴には積まない） */
  live() {
    this.player.setProject(this.project);
    this.timeline.render();
    this.#onTime(this.player.t);
  }

  endEdit() {
    if (!this.editing) return;
    this.editing = false;
    const now = JSON.stringify(this.project);
    if (now !== this.snapshot) {
      this.undoStack.push(this.snapshot);
      if (this.undoStack.length > 60) this.undoStack.shift();
      this.redoStack = [];
      this.scheduleSave();
    }
    this.snapshot = null;
    this.refresh();
  }

  change(fn) {
    this.beginEdit();
    fn();
    this.endEdit();
  }

  undo() {
    if (!this.undoStack.length) return;
    this.redoStack.push(JSON.stringify(this.project));
    this.project = normalizeProject(JSON.parse(this.undoStack.pop()));
    this.#afterHistory();
  }

  redo() {
    if (!this.redoStack.length) return;
    this.undoStack.push(JSON.stringify(this.project));
    this.project = normalizeProject(JSON.parse(this.redoStack.pop()));
    this.#afterHistory();
  }

  #afterHistory() {
    if (this.timeline.selection && !this.findItem(this.timeline.selection.type, this.timeline.selection.id)) this.select(null);
    this.closeSheet();
    this.refresh();
    this.scheduleSave();
  }

  /** 一覧に戻る。使われなくなった素材はこのとき端末から削除する（編集中は元に戻せるよう残しておく） */
  async leave() {
    this.closeSheet();
    const p = this.project;
    const used = usedMediaIds(p);
    for (const id of Object.keys(p.media)) {
      if (used.has(id)) continue;
      delete p.media[id];
      this.lib.remove(id);
      await store.deleteMedia(id).catch(() => {});
    }
    await this.saveNow();
    this.project = null;
    this.showHome();
  }

  scheduleSave() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.saveNow(), 700);
  }

  async saveNow() {
    clearTimeout(this.saveTimer);
    if (!this.project) return;
    try {
      await store.saveProject(this.project, { ratio: ratioOf(this.project), duration: this.player.duration, thumb: this.#thumb() });
    } catch (err) {
      toast('保存できませんでした：' + err.message);
    }
  }

  #thumb() {
    try {
      const c = document.createElement('canvas');
      const src = this.player.canvas;
      const s = 128 / Math.max(src.width, src.height);
      c.width = Math.round(src.width * s);
      c.height = Math.round(src.height * s);
      c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
      return c.toDataURL('image/jpeg', 0.7);
    } catch { return undefined; }
  }

  #onTime(t) {
    $('#time').textContent = `${fmt(t)} / ${fmt(this.player.duration)}`;
    this.timeline.setTime(t); // スクロール由来なら位置は同じなので何もしない
    this.renderToolbarState?.();
  }

  scrub(t) {
    if (this.player.playing) this.player.pause();
    this.player.seek(t);
  }

  listOf(type) {
    const p = this.project;
    return { clip: p.clips, text: p.texts, audio: p.audios, shape: p.shapes, effect: p.effects, overlay: p.overlays }[type];
  }

  findItem(type, id) {
    return this.listOf(type)?.find((x) => x.id === id);
  }

  select(sel) {
    this.timeline.select(sel);
    this.player.overlay = null;
    this.renderToolbar();
  }

  /* ================= 素材の追加 ================= */

  addMediaDialog() { $('#fileMedia').click(); }

  async addFiles(files, { asAudio = false } = {}) {
    const p = this.project;
    let added = 0;
    const t = this.player.t;
    // 再生ヘッドの位置にあるクリップの後ろに入れる
    const layout = layoutClips(p);
    let insertAt = layout.findIndex((L) => t >= L.start && t < L.end);
    insertAt = insertAt < 0 ? p.clips.length : insertAt + 1;
    this.beginEdit();
    for (const file of files) {
      toast(`読み込み中… ${file.name}`, 60000);
      try {
        const meta = await this.lib.add(file);
        if (asAudio && !meta.hasAudio) throw new Error('音声が入っていません');
        p.media[meta.id] = meta;
        await store.putMedia(p.id, meta, file);
        if (asAudio || meta.kind === 'audio') {
          p.audios.push(newAudio(meta, Math.min(t, Math.max(0, this.player.duration - 0.5)), { loop: false }));
        } else {
          p.clips.splice(insertAt++, 0, newClip(meta));
        }
        added++;
      } catch (err) {
        toast(`${file.name}：${err.message}`, 4000);
        await new Promise((r) => setTimeout(r, 1500));
      }
    }
    this.endEdit();
    if (added) toast(`${added}件追加しました`);
    store.requestPersist();
  }

  addText() {
    const p = this.project;
    const t = Math.min(this.player.t, Math.max(0, this.player.duration - 0.5));
    const tx = newText(t, { end: t + 3 });
    this.change(() => p.texts.push(tx));
    this.select({ type: 'text', id: tx.id });
    this.openInspector();
  }

  /* ================= 選択中の操作 ================= */

  splitAtPlayhead() {
    const p = this.project;
    const t = this.player.t;
    const sel = this.timeline.selection;
    if (sel && ['text', 'shape', 'effect'].includes(sel.type)) {
      const tx = this.findItem(sel.type, sel.id);
      const list = this.listOf(sel.type);
      if (t <= tx.start + 0.1 || t >= tx.end - 0.1) return toast('途中に再生ヘッドを合わせてください');
      return this.change(() => {
        const b = { ...JSON.parse(JSON.stringify(tx)), id: uid(sel.type[0]), start: t };
        splitMotion(tx, b, t);
        if ('anim' in tx) {
          // 前半は消えずに、後半は出現アニメなしでつなぐ
          b.animOut = tx.animOut ?? tx.anim !== 'none';
          b.anim = 'none';
          tx.animOut = false;
        }
        tx.end = t;
        list.splice(list.indexOf(tx) + 1, 0, b);
      });
    }
    if (sel?.type === 'overlay') {
      const o = this.findItem('overlay', sel.id);
      if (t <= o.start + 0.1 || t >= overlayEnd(o) - 0.1) return toast('途中に再生ヘッドを合わせてください');
      return this.change(() => {
        const mid = o.in + (t - o.start) * (o.speed || 1);
        const b = { ...JSON.parse(JSON.stringify(o)), id: uid('o'), start: t, in: mid };
        splitMotion(o, b, t);
        b.animOut = o.animOut ?? o.anim !== 'none';
        b.anim = 'none';
        o.animOut = false;
        o.out = mid;
        p.overlays.splice(p.overlays.indexOf(o) + 1, 0, b);
      });
    }
    if (sel?.type === 'audio') {
      const a = this.findItem('audio', sel.id);
      const len = a.out - a.in;
      if (a.loop) return toast('ループ再生中の音は分割できません');
      if (t <= a.start + 0.1 || t >= a.start + len - 0.1) return toast('音の途中に再生ヘッドを合わせてください');
      return this.change(() => {
        const b = { ...a, id: uid('a'), start: t, in: a.in + (t - a.start), fadeIn: 0 };
        a.out = a.in + (t - a.start);
        a.fadeOut = 0;
        p.audios.splice(p.audios.indexOf(a) + 1, 0, b);
      });
    }
    const layout = layoutClips(p);
    const L = layout.find((x) => t > x.start + 0.05 && t < x.end - 0.05 && (!sel || sel.type !== 'clip' || x.clip.id === sel.id)) ||
      layout.find((x) => t > x.start + 0.05 && t < x.end - 0.05);
    if (!L) return toast('クリップの途中に再生ヘッドを合わせてください');
    const mt = mediaTime(L, t);
    const c = L.clip;
    this.change(() => {
      const b = JSON.parse(JSON.stringify(c));
      b.id = uid('c');
      b.in = mt;
      b.transition = { type: 'none', duration: 0.5 };
      c.out = mt;
      p.clips.splice(p.clips.indexOf(c) + 1, 0, b);
    });
    this.select({ type: 'clip', id: c.id });
    toast('分割しました');
  }

  deleteSelected() {
    const sel = this.timeline.selection;
    if (!sel) return;
    const p = this.project;
    this.change(() => {
      const list = this.listOf(sel.type);
      const i = list.findIndex((c) => c.id === sel.id);
      if (i >= 0) list.splice(i, 1);
    });
    this.select(null);
  }

  duplicateSelected() {
    const sel = this.timeline.selection;
    if (!sel) return;
    const p = this.project;
    const item = this.findItem(sel.type, sel.id);
    const copy = JSON.parse(JSON.stringify(item));
    copy.id = uid(sel.type[0]);
    this.change(() => {
      if (sel.type === 'clip') p.clips.splice(p.clips.indexOf(item) + 1, 0, copy);
      if (['text', 'shape', 'effect'].includes(sel.type)) {
        const d = item.end - item.start;
        copy.start = item.end;
        copy.end = item.end + d;
        this.listOf(sel.type).push(copy);
      }
      if (sel.type === 'audio') { copy.start = item.start + (item.out - item.in); p.audios.push(copy); }
      if (sel.type === 'overlay') { copy.x = Math.min(0.9, item.x + 0.05); copy.y = Math.min(0.9, item.y + 0.05); p.overlays.push(copy); }
    });
    this.select({ type: sel.type, id: copy.id });
  }

  moveClip(dir) {
    const sel = this.timeline.selection;
    if (sel?.type !== 'clip') return;
    const p = this.project;
    const i = p.clips.findIndex((c) => c.id === sel.id);
    const j = i + dir;
    if (j < 0 || j >= p.clips.length) return;
    this.change(() => { [p.clips[i], p.clips[j]] = [p.clips[j], p.clips[i]]; });
    const L = layoutClips(p).find((x) => x.clip.id === sel.id);
    if (L) { this.player.seek(L.start + 0.01); this.timeline.setTime(L.start + 0.01); }
  }

  /** タイムライン上のドラッグ（つまみ・移動）を反映 */
  applyDrag(type, item, orig, mode, dt) {
    const p = this.project;
    if (type === 'clip') {
      const media = p.media[item.media];
      const sp = item.speed || 1;
      const isImg = media?.kind === 'image';
      const maxOut = isImg ? 3600 : media.duration;
      if (mode === 'left') {
        if (isImg) item.out = Math.max(0.3, orig.out - dt);
        else item.in = Math.min(orig.out - 0.2, Math.max(0, orig.in + dt * sp));
      } else if (mode === 'right') {
        item.out = Math.max(item.in + 0.2, Math.min(maxOut, orig.out + dt * sp));
      }
    } else if (type === 'text' || type === 'shape' || type === 'effect') {
      const snap = (v) => (Math.abs(v - this.player.t) * this.timeline.pps < 10 ? this.player.t : v);
      if (mode === 'left') item.start = Math.max(0, Math.min(orig.end - 0.2, snap(orig.start + dt)));
      if (mode === 'right') item.end = Math.max(orig.start + 0.2, snap(orig.end + dt));
      if (mode === 'move') {
        const d = orig.end - orig.start;
        item.start = Math.max(0, snap(orig.start + dt));
        item.end = item.start + d;
      }
    } else if (type === 'overlay') {
      const media = p.media[item.media];
      const sp = item.speed || 1;
      const isImg = media?.kind === 'image';
      const snap = (v) => (Math.abs(v - this.player.t) * this.timeline.pps < 10 ? this.player.t : v);
      if (mode === 'left') {
        if (isImg) {
          const ns = Math.min(orig.start + (orig.out - orig.in) - 0.2, Math.max(0, snap(orig.start + dt)));
          item.start = ns;
          item.out = orig.out - (ns - orig.start);
        } else {
          const ni = Math.min(orig.out - 0.2, Math.max(0, orig.in + dt * sp));
          item.in = ni;
          item.start = Math.max(0, orig.start + (ni - orig.in) / sp);
        }
      }
      if (mode === 'right') item.out = Math.max(item.in + 0.2, Math.min(isImg ? 3600 : media.duration, orig.out + dt * sp));
      if (mode === 'move') item.start = Math.max(0, snap(orig.start + dt));
    } else if (type === 'audio') {
      const media = p.media[item.media];
      if (mode === 'left') {
        const ni = Math.min(orig.out - 0.2, Math.max(0, orig.in + dt));
        item.in = ni;
        item.start = Math.max(0, orig.start + (ni - orig.in));
      }
      if (mode === 'right') item.out = Math.max(item.in + 0.2, Math.min(media.duration, orig.out + dt));
      if (mode === 'move') item.start = Math.max(0, orig.start + dt);
    }
    this.live();
  }

  /* ================= ツールバー ================= */

  renderToolbar() {
    const bar = $('#toolbar');
    if (!bar || !this.project) return;
    bar.textContent = '';
    const sel = this.timeline.selection;
    const tool = (name, label, fn, cls = '') => {
      const b = h('button', { class: `tool ${cls}`, type: 'button', onclick: fn });
      b.innerHTML = `${icon(name)}<span>${label}</span>`;
      bar.append(b);
      return b;
    };
    if (!sel) {
      tool('media', '素材を追加', () => this.addMediaDialog());
      tool('text', 'テキスト', () => this.addText());
      tool('pip', 'ワイプ', () => $('#fileOverlay').click());
      tool('shape', '図形', () => this.addShapeDialog());
      tool('fx', 'エフェクト', () => this.addEffectDialog());
      tool('music', '音楽・音', () => $('#fileAudio').click());
      tool('split', '分割', () => this.splitAtPlayhead());
      tool('ratio', '比率・設定', () => this.openProjectSettings());
      return;
    }
    tool('close', '', () => this.select(null), 'close');
    if (sel.type === 'clip') {
      const c = this.findItem('clip', sel.id);
      const isImg = this.project.media[c?.media]?.kind === 'image';
      tool('split', '分割', () => this.splitAtPlayhead());
      if (!isImg) tool('speed', '速度', () => this.openInspector('speed'));
      if (!isImg) tool('volume', '音量', () => this.openInspector('volume'));
      tool('frame', '表示', () => this.openInspector('frame'));
      tool('color', '色調整', () => this.openInspector('color'));
      tool('cut', '切り抜き', () => this.openInspector('cutout'));
      tool('trans', '切替効果', () => this.openTransition(sel.id));
      tool('left', '前へ', () => this.moveClip(-1));
      tool('right', '後ろへ', () => this.moveClip(1));
      tool('dup', '複製', () => this.duplicateSelected());
      tool('del', '削除', () => this.deleteSelected(), 'danger');
    } else if (sel.type === 'text') {
      tool('edit', '編集', () => this.openInspector());
      tool('split', '分割', () => this.splitAtPlayhead());
      tool('dup', '複製', () => this.duplicateSelected());
      tool('del', '削除', () => this.deleteSelected(), 'danger');
    } else if (sel.type === 'overlay') {
      tool('edit', '編集', () => this.openInspector());
      tool('cut', '切り抜き', () => this.openInspector('cutout'));
      tool('split', '分割', () => this.splitAtPlayhead());
      tool('dup', '複製', () => this.duplicateSelected());
      tool('front', '最前面へ', () => this.bringToFront());
      tool('del', '削除', () => this.deleteSelected(), 'danger');
    } else if (sel.type === 'shape' || sel.type === 'effect') {
      tool('edit', '編集', () => this.openInspector());
      tool('split', '分割', () => this.splitAtPlayhead());
      tool('dup', '複製', () => this.duplicateSelected());
      if (sel.type === 'shape') tool('front', '最前面へ', () => this.bringToFront());
      tool('del', '削除', () => this.deleteSelected(), 'danger');
    } else if (sel.type === 'audio') {
      tool('volume', '音量・フェード', () => this.openInspector());
      tool('split', '分割', () => this.splitAtPlayhead());
      tool('dup', '複製', () => this.duplicateSelected());
      tool('del', '削除', () => this.deleteSelected(), 'danger');
    }
  }

  /* ================= シート ================= */

  openSheet(title, build, { tall = false } = {}) {
    const sheet = $('#sheet');
    $('#sheetTitle').textContent = title;
    const body = $('#sheetBody');
    body.textContent = '';
    sheet.classList.toggle('tall', tall);
    sheet.hidden = false;
    build(body);
    body.scrollTop = 0;
    this.#fitStageToSheet();
  }

  closeSheet() {
    if ($('#sheet').hidden) return;
    $('#sheet').hidden = true;
    this.player.hideTextId = null;
    this.endEdit();
    this.#fitStageToSheet();
    this.onSheetClose?.();
    this.onSheetClose = null;
  }

  /** シートを開いている間は、プレビューがシートに隠れないように縮める */
  #fitStageToSheet() {
    const ed = $('#editor');
    const open = !$('#sheet').hidden && !ed.hidden;
    ed.classList.toggle('sheet-open', open);
    $('#timeline').hidden = open;
    $('#toolbar').hidden = open;
    ed.style.paddingBottom = open ? `${$('#sheet').getBoundingClientRect().height}px` : '';
    requestAnimationFrame(() => this.player.resize());
  }

  /* ---- 入力部品 ---- */

  slider(label, value, min, max, step, fmtv, apply) {
    const out = h('output', {}, fmtv(value));
    const input = h('input', { type: 'range', min: String(min), max: String(max), step: String(step) });
    input.value = String(value);
    input.addEventListener('input', () => {
      this.beginEdit();
      const v = Number(input.value);
      apply(v);
      out.textContent = fmtv(v);
      this.live();
    });
    input.addEventListener('change', () => this.endEdit());
    return h('div', { class: 'sec' }, h('div', { class: 'lbl' }, h('span', {}, label), out), input);
  }

  seg(label, options, value, apply) {
    const wrap = h('div', { class: 'seg' });
    for (const [v, text] of options) {
      const b = h('button', { type: 'button', class: v === value ? 'on' : '' }, text);
      b.addEventListener('click', () => {
        for (const x of wrap.children) x.classList.remove('on');
        b.classList.add('on');
        this.change(() => apply(v));
      });
      wrap.append(b);
    }
    return h('div', { class: 'sec' }, label ? h('div', { class: 'lbl' }, h('span', {}, label)) : null, wrap);
  }

  swatches(label, colors, value, apply, allowNone = false) {
    const wrap = h('div', { class: 'swatches' });
    const all = allowNone ? [null, ...colors] : colors;
    const mark = (v) => { for (const x of wrap.querySelectorAll('.sw')) x.classList.toggle('on', x.dataset.v === String(v)); };
    for (const c of all) {
      const b = h('button', { type: 'button', class: 'sw' + (c === null ? ' none' : ''), 'aria-label': c || 'なし' });
      b.dataset.v = String(c);
      if (c && c.startsWith('gradient:')) b.style.background = `linear-gradient(135deg, ${(GRADIENTS[c.slice(9)]?.colors || []).join(',')})`;
      else if (c) b.style.background = c;
      b.addEventListener('click', () => { mark(c); this.change(() => apply(c)); });
      wrap.append(b);
    }
    const custom = h('input', { type: 'color', class: 'sw-custom', 'aria-label': 'その他の色' });
    if (typeof value === 'string' && value.startsWith('#')) custom.value = value;
    custom.addEventListener('input', () => { this.beginEdit(); apply(custom.value); mark(custom.value); this.live(); });
    custom.addEventListener('change', () => this.endEdit());
    wrap.append(custom);
    mark(value);
    return h('div', { class: 'sec' }, h('div', { class: 'lbl' }, h('span', {}, label)), wrap);
  }

  toggle(label, value, apply) {
    return this.seg(label, [[true, 'オン'], [false, 'オフ']], !!value, apply);
  }

  /* ---- 各種設定シート ---- */

  openInspector(section) {
    const sel = this.timeline.selection;
    if (!sel) return;
    const item = this.findItem(sel.type, sel.id);
    if (!item) return;
    if (sel.type === 'clip') this.#clipSheet(item, section);
    if (sel.type === 'text') this.#textSheet(item);
    if (sel.type === 'audio') this.#audioSheet(item);
    if (sel.type === 'shape') this.#shapeSheet(item);
    if (sel.type === 'effect') this.#effectSheet(item);
    if (sel.type === 'overlay') this.#overlaySheet(item, section);
  }

  #clipSheet(c, section) {
    const media = this.project.media[c.media];
    const isImg = media?.kind === 'image';
    const titles = { speed: '速度', volume: '音量', frame: '表示', color: '色調整', cutout: '切り抜き' };
    this.openSheet(titles[section] || 'クリップ', (body) => {
      const secs = {
        speed: () => [
          this.slider('再生速度', c.speed, 0.25, 4, 0.05, (v) => `${v.toFixed(2)}x`, (v) => { c.speed = v; }),
          this.seg('', [[0.5, '0.5x'], [1, '1x'], [1.5, '1.5x'], [2, '2x'], [3, '3x']], c.speed, (v) => { c.speed = v; this.closeSheet(); this.openInspector('speed'); }),
          h('p', { class: 'note' }, '速度を変えると音の高さも変わります。'),
        ],
        volume: () => [
          this.slider('このクリップの音量', c.volume, 0, 2, 0.05, (v) => (v === 0 ? 'ミュート' : `${Math.round(v * 100)}%`), (v) => { c.volume = v; }),
          this.seg('', [[0, 'ミュート'], [0.5, '50%'], [1, '100%'], [1.5, '150%']], c.volume, (v) => { c.volume = v; this.closeSheet(); this.openInspector('volume'); }),
        ],
        frame: () => [
          this.seg('画面への収め方', [['cover', '画面いっぱい'], ['contain', '全体を表示']], c.fit, (v) => { c.fit = v; }),
          this.slider('拡大', c.zoom, 1, 3, 0.01, (v) => `${Math.round(v * 100)}%`, (v) => { c.zoom = v; }),
          this.slider('左右の位置', c.x, -0.5, 0.5, 0.005, (v) => `${Math.round(v * 100)}`, (v) => { c.x = v; }),
          this.slider('上下の位置', c.y, -0.5, 0.5, 0.005, (v) => `${Math.round(v * 100)}`, (v) => { c.y = v; }),
          this.toggle('ゆっくりズーム（ケン・バーンズ）', c.kenburns, (v) => { c.kenburns = v; }),
          h('p', { class: 'note' }, 'プレビューを指でドラッグしても位置を動かせます。'),
          h('div', { class: 'sec' }, h('button', { class: 'btn', type: 'button', onclick: () => { this.change(() => { c.zoom = 1; c.x = 0; c.y = 0; }); this.closeSheet(); this.openInspector('frame'); } }, '位置と拡大をリセット')),
        ],
        color: () => [
          this.slider('明るさ', c.filter.brightness, 0.3, 1.8, 0.01, (v) => `${Math.round((v - 1) * 100)}`, (v) => { c.filter.brightness = v; }),
          this.slider('コントラスト', c.filter.contrast, 0.3, 1.8, 0.01, (v) => `${Math.round((v - 1) * 100)}`, (v) => { c.filter.contrast = v; }),
          this.slider('彩度', c.filter.saturation, 0, 2, 0.01, (v) => `${Math.round((v - 1) * 100)}`, (v) => { c.filter.saturation = v; }),
          this.seg('プリセット', [['n', '元に戻す'], ['v', 'あざやか'], ['m', 'モノクロ'], ['s', 'しっとり'], ['b', '明るく']], null, (v) => {
            c.filter = {
              n: { brightness: 1, contrast: 1, saturation: 1 },
              v: { brightness: 1.03, contrast: 1.1, saturation: 1.35 },
              m: { brightness: 1, contrast: 1.15, saturation: 0 },
              s: { brightness: 0.95, contrast: 0.9, saturation: 0.75 },
              b: { brightness: 1.18, contrast: 1.02, saturation: 1.05 },
            }[v];
            setTimeout(() => { this.closeSheet(); this.openInspector('color'); });
          }),
        ],
        cutout: () => [
          ...this.#cutoutSection(c, 'clip', () => { this.closeSheet(); this.openInspector('cutout'); }),
          c.cutout?.mode ? this.seg('切り抜いた後ろ', [['color', '背景色'], ['blur', '元の映像をぼかす']], c.cutout.bg || 'color', (v) => { c.cutout.bg = v; }) : null,
          h('p', { class: 'note' }, '背景色は「比率・設定」で変えられます。別の映像の上に人物を重ねたいときは、人物の動画を「ワイプ」で追加して切り抜いてください。'),
        ],
      };
      const order = section ? [section] : (isImg ? ['frame', 'color'] : ['speed', 'volume', 'frame', 'color']);
      for (const k of order) body.append(...secs[k]());
      if (!section) body.append(h('p', { class: 'note' }, `${media?.name || ''}（${fmt(c.in)}〜${fmt(c.out)}）`));
    });
    // プレビューのドラッグでクリップの位置を動かす
    this.player.overlay = null;
  }

  #textSheet(tx) {
    this.openSheet('テキスト', (body) => {
      const ta = h('textarea', { rows: '2', placeholder: '文字を入力' });
      ta.value = tx.text;
      ta.addEventListener('focus', () => this.beginEdit());
      ta.addEventListener('input', () => { this.beginEdit(); tx.text = ta.value; this.live(); });
      ta.addEventListener('blur', () => this.endEdit());
      body.append(h('div', { class: 'sec' }, ta));

      // スタイル（実際の描画で見本を作る）
      const grid = h('div', { class: 'style-grid' });
      for (const [key, st] of Object.entries(TEXT_STYLES)) {
        const b = h('button', { type: 'button', class: 'style-chip' + (tx.style === key ? ' on' : ''), 'aria-label': st.label });
        const cv = h('canvas', { width: '184', height: '104' });
        const ctx = cv.getContext('2d');
        drawText(ctx, 184, 104, { ...newText(0), ...st, text: st.label, x: 0.5, y: 0.5, size: 0.3, anim: 'none', end: 1 }, 0.5);
        b.append(cv);
        b.addEventListener('click', () => {
          for (const x of grid.children) x.classList.remove('on');
          b.classList.add('on');
          this.change(() => {
            const { label, ...rest } = st;
            Object.assign(tx, rest, { style: key });
          });
        });
        grid.append(b);
      }
      body.append(h('div', { class: 'sec' }, h('div', { class: 'lbl' }, h('span', {}, 'スタイル')), grid));
      setTimeout(() => loadFonts({ texts: Object.values(TEXT_STYLES).map((s) => ({ font: s.font, text: s.label })) }).then(() => {
        grid.querySelectorAll('canvas').forEach((cv, i) => {
          const st = Object.values(TEXT_STYLES)[i];
          const ctx = cv.getContext('2d');
          ctx.clearRect(0, 0, cv.width, cv.height);
          drawText(ctx, 184, 104, { ...newText(0), ...st, text: st.label, x: 0.5, y: 0.5, size: 0.3, anim: 'none', end: 1 }, 0.5);
        });
      }));

      body.append(
        this.slider('大きさ', this.cur(tx).size, 0.03, 0.2, 0.005, (v) => `${Math.round(v * 1000)}`, (v) => { this.kfTarget(tx).size = v; }),
        this.seg('位置', [[0.12, '上'], [0.5, '中央'], [0.8, '下'], [0.9, '一番下']], null, (v) => { const k = this.kfTarget(tx); k.y = v; k.x = 0.5; }),
        this.seg('書体', [['gothic', 'ゴシック'], ['rounded', '丸ゴシック'], ['mincho', '明朝']], tx.font, (v) => { tx.font = v; }),
        this.swatches('文字の色', ['#ffffff', '#111111', '#ffe14d', '#ff4f8b', '#4fc3ff', '#5fe08a', '#ff7a3d', 'gradient:gold', 'gradient:silver', 'gradient:rainbow', 'gradient:sunset', 'gradient:ocean', 'gradient:sakura'], tx.color, (v) => { tx.color = v; }),
        this.swatches('ふちの色', ['#000000', '#ffffff', '#ff4f8b', '#2a6cff', '#ff7a3d'], tx.stroke, (v) => { tx.stroke = v; if (v && !(tx.strokeWidth > 0)) tx.strokeWidth = 0.15; }, true),
        this.slider('ふちの太さ', tx.strokeWidth || 0, 0, 0.35, 0.01, (v) => `${Math.round(v * 100)}`, (v) => { tx.strokeWidth = v; }),
        this.swatches('背景', ['rgba(0,0,0,0.6)', '#000000', '#ffffff', '#ffe14d', '#ff4f8b'], tx.bg, (v) => { tx.bg = v; }, true),
        this.toggle('影', tx.shadow, (v) => { tx.shadow = v; }),
        this.seg('装飾', [['none', 'なし'], ['glow', '光彩'], ['extrude', '立体'], ['double', '二重ふち']], tx.glow ? 'glow' : tx.extrude ? 'extrude' : tx.strokes?.length ? 'double' : 'none', (v) => {
          tx.glow = v === 'glow' ? { color: typeof tx.stroke === 'string' && tx.stroke !== '#000000' ? tx.stroke : '#ff2bd6', size: 0.5 } : null;
          tx.extrude = v === 'extrude' ? { depth: 0.12, color: '#333333', angle: 135 } : null;
          tx.strokes = v === 'double' ? [{ color: '#111111', width: (tx.strokeWidth || 0.12) * 2 }] : null;
          if (v === 'double' && !(tx.strokeWidth > 0)) { tx.stroke = '#ffffff'; tx.strokeWidth = 0.12; }
        }),
        this.seg('出かた', [['none', 'なし'], ['fade', 'フェード'], ['pop', 'ポップ'], ['slide', 'スライド'], ['typewriter', 'タイプ']], tx.anim, (v) => { tx.anim = v; }),
        this.slider('回転', this.cur(tx).rotation || 0, -180, 180, 1, (v) => `${Math.round(v)}°`, (v) => { this.kfTarget(tx).rotation = v; }),
        ...this.#threeDSection(tx),
        this.#motionSeg(tx, null, () => { this.closeSheet(); this.openInspector(); }),
        ...this.#keySection(tx, () => { this.closeSheet(); this.openInspector(); }),
        h('div', { class: 'sec' },
          h('div', { class: 'lbl' }, h('span', {}, '表示時間'), h('output', {}, `${fmt(tx.start)} 〜 ${fmt(tx.end)}`)),
          h('div', { class: 'row-btns' },
            h('button', { class: 'btn', type: 'button', onclick: () => { this.change(() => { const d = tx.end - tx.start; tx.start = this.player.t; tx.end = Math.max(tx.start + 0.2, tx.end > tx.start ? tx.end : tx.start + d); }); this.closeSheet(); this.openInspector(); } }, 'ここから表示'),
            h('button', { class: 'btn', type: 'button', onclick: () => { if (this.player.t <= tx.start + 0.1) return toast('開始より後ろに再生ヘッドを合わせてください'); this.change(() => { tx.end = this.player.t; }); this.closeSheet(); this.openInspector(); } }, 'ここまで表示'))),
        h('p', { class: 'note' }, 'プレビューの文字を指でドラッグすると位置を動かせます。タイムラインの紫のバーの両端で表示時間も変えられます。'),
      );
      // 表示時間外なら、文字が見える位置へ移動
      if (this.player.t < tx.start || this.player.t >= tx.end) this.player.seek(tx.start + Math.min(0.5, (tx.end - tx.start) / 2));
    }, { tall: false });
  }

  #audioSheet(a) {
    const media = this.project.media[a.media];
    this.openSheet('音楽・音', (body) => {
      body.append(
        h('p', { class: 'note' }, media?.name || ''),
        this.slider('音量', a.volume, 0, 2, 0.05, (v) => `${Math.round(v * 100)}%`, (v) => { a.volume = v; }),
        this.slider('フェードイン', a.fadeIn, 0, 5, 0.1, (v) => `${v.toFixed(1)}秒`, (v) => { a.fadeIn = v; }),
        this.slider('フェードアウト', a.fadeOut, 0, 5, 0.1, (v) => `${v.toFixed(1)}秒`, (v) => { a.fadeOut = v; }),
        this.toggle('動画の最後までくり返す', a.loop, (v) => { a.loop = v; }),
        h('div', { class: 'sec' }, h('div', { class: 'row-btns' },
          h('button', { class: 'btn', type: 'button', onclick: () => { this.change(() => { a.start = this.player.t; }); toast('再生ヘッドの位置から鳴るようにしました'); } }, 'ここから鳴らす'),
          h('button', { class: 'btn', type: 'button', onclick: () => { this.change(() => { a.start = 0; }); toast('最初から鳴るようにしました'); } }, '最初から鳴らす'))),
        h('p', { class: 'note' }, '動画の声と重なるときは BGM の音量を 20〜40% くらいにすると聞き取りやすくなります。'),
      );
    });
  }

  openTransition(clipId) {
    const c = this.findItem('clip', clipId);
    if (!c) return;
    const idx = this.project.clips.indexOf(c);
    this.select({ type: 'clip', id: clipId });
    this.openSheet(idx === 0 ? '始まりの効果' : '切り替え効果', (body) => {
      const grid = h('div', { class: 'trans-grid' });
      const ic = { none: '✕', fade: '◐', black: '■', white: '□', slide: '⇢', wipe: '▥', zoom: '⤢', flip: '⟲', cube: '◧' };
      for (const [k, t] of Object.entries(TRANSITIONS)) {
        if (idx === 0 && t.overlap) continue;
        const b = h('button', { type: 'button', class: c.transition.type === k ? 'on' : '' }, h('span', { class: 'ic' }, ic[k]), t.label);
        b.addEventListener('click', () => {
          for (const x of grid.children) x.classList.remove('on');
          b.classList.add('on');
          this.change(() => { c.transition.type = k; });
          const L = layoutClips(this.project).find((x) => x.clip.id === c.id);
          if (L && k !== 'none') { this.player.seek(Math.max(0, L.start - 0.6)); this.player.play(); }
        });
        grid.append(b);
      }
      body.append(h('div', { class: 'sec' }, grid),
        this.slider('長さ', c.transition.duration, 0.2, 2, 0.1, (v) => `${v.toFixed(1)}秒`, (v) => { c.transition.duration = v; }),
        h('div', { class: 'sec' }, h('button', {
          class: 'btn', type: 'button', onclick: () => {
            this.change(() => { for (const x of this.project.clips.slice(1)) x.transition = { ...c.transition }; });
            toast('すべての切り替えに適用しました');
          },
        }, 'すべての切り替えに適用')),
        h('p', { class: 'note' }, idx === 0 ? '最初のクリップは「黒/白からフェードイン」にできます。' : 'クロスフェード・スライド・ワイプ・ズーム・3D は前後のクリップが少し重なります。'));
    });
  }

  /* ---- 図形 ---- */

  #shapeIcon(kind, size = 64, opts = {}) {
    const cv = h('canvas', { width: String(size * 2), height: String(size * 2) });
    const ctx = cv.getContext('2d');
    const s = newShape(0, kind, { anim: 'none', loop: 'none', end: 1, x: 0.5, y: 0.5, ...opts });
    const sc = 0.7 / Math.max(s.w, s.h);
    drawShape(ctx, size * 2, size * 2, { ...s, w: s.w * sc, h: s.h * sc }, 0.5);
    return cv;
  }

  addShapeDialog() {
    this.openSheet('図形を追加', (body) => {
      const grid = h('div', { class: 'trans-grid' });
      for (const [kind, label] of Object.entries(SHAPES)) {
        const b = h('button', { type: 'button' }, this.#shapeIcon(kind, 28), label);
        b.querySelector('canvas').style.cssText = 'width:44px;height:44px';
        b.addEventListener('click', () => {
          const p = this.project;
          const t = Math.min(this.player.t, Math.max(0, this.player.duration - 0.5));
          const sh = newShape(t, kind);
          this.closeSheet();
          this.change(() => p.shapes.push(sh));
          this.select({ type: 'shape', id: sh.id });
          this.openInspector();
        });
        grid.append(b);
      }
      body.append(h('div', { class: 'sec' }, grid));
    });
  }

  bringToFront() {
    const sel = this.timeline.selection;
    const list = this.listOf(sel?.type);
    const item = this.findItem(sel?.type, sel?.id);
    if (!list || !item) return;
    this.change(() => { list.splice(list.indexOf(item), 1); list.push(item); });
    toast('いちばん手前にしました');
  }

  #shapeSheet(s) {
    const reopen = () => { this.closeSheet(); this.openInspector(); };
    this.openSheet('図形', (body) => {
      const grid = h('div', { class: 'seg' });
      for (const [kind, label] of Object.entries(SHAPES)) {
        const b = h('button', { type: 'button', class: s.kind === kind ? 'on' : '' }, label);
        b.addEventListener('click', () => { this.change(() => { s.kind = kind; }); reopen(); });
        grid.append(b);
      }
      const hollow = s.kind === 'ring' || s.kind === 'check';
      const motion = s.to ? Object.keys(s.to).join(',') : 'none';
      body.append(
        h('div', { class: 'sec' }, h('div', { class: 'lbl' }, h('span', {}, '形')), grid),
        hollow ? null : this.swatches('塗り', ['#ff7a3d', '#ffcc33', '#ff4f8b', '#4fc3ff', '#5fe08a', '#b07bff', '#ffffff', '#111111', 'gradient:gold', 'gradient:silver', 'gradient:rainbow', 'gradient:sunset', 'gradient:ocean', 'gradient:sakura', 'gradient:neon'], s.fill, (v) => { s.fill = v; }, true),
        this.swatches(hollow ? '線の色' : 'ふち', ['#ffffff', '#111111', '#ffcc33', '#ff4f8b', '#4fc3ff'], s.stroke, (v) => { s.stroke = v; if (v && !(s.strokeWidth > 0)) s.strokeWidth = 0.01; }, !hollow),
        this.slider(hollow ? '線の太さ' : 'ふちの太さ', s.strokeWidth || 0, 0, 0.05, 0.001, (v) => `${Math.round(v * 1000)}`, (v) => { s.strokeWidth = v; }),
        this.slider('大きさ', Math.max(this.cur(s).w, this.cur(s).h), 0.03, 1.5, 0.01, (v) => `${Math.round(v * 100)}`, (v) => {
          const k = this.kfTarget(s);
          const c = this.cur(s);
          const r = v / Math.max(c.w, c.h);
          k.w = c.w * r; k.h = c.h * r;
          if (k === s && s.to) { if (typeof s.to.w === 'number') s.to.w *= r; if (typeof s.to.h === 'number') s.to.h *= r; }
        }),
        this.slider('横の長さ', this.cur(s).w, 0.02, 1.6, 0.01, (v) => `${Math.round(v * 100)}`, (v) => { this.kfTarget(s).w = v; }),
        this.slider('縦の長さ', this.cur(s).h, 0.02, 1.6, 0.01, (v) => `${Math.round(v * 100)}`, (v) => { this.kfTarget(s).h = v; }),
        this.slider('回転', this.cur(s).rotation || 0, -180, 180, 1, (v) => `${Math.round(v)}°`, (v) => { this.kfTarget(s).rotation = v; }),
        this.slider('不透明度', this.cur(s).opacity ?? 1, 0.05, 1, 0.01, (v) => `${Math.round(v * 100)}%`, (v) => { this.kfTarget(s).opacity = v; }),
        s.kind === 'round' ? this.slider('角の丸み', s.radius ?? 0.3, 0, 0.5, 0.01, (v) => `${Math.round(v * 200)}%`, (v) => { s.radius = v; }) : null,
        this.toggle('影', s.shadow, (v) => { s.shadow = v; }),
        this.seg('出かた', [['none', 'なし'], ['fade', 'フェード'], ['pop', 'ポップ'], ['slide', 'スライド'], ['spin', '回転'], ['wipe', 'ワイプ']], s.anim, (v) => { s.anim = v; }),
        this.seg('ずっと続く動き', [['none', 'なし'], ['pulse', '鼓動'], ['float', 'ふわふわ'], ['spin', '回転'], ['blink', '点滅'], ['shake', 'ゆれる']], s.loop || 'none', (v) => { s.loop = v; }),
        ...this.#threeDSection(s),
        this.#motionSeg(s, motion, reopen),
        ...this.#keySection(s, reopen),
        this.#timingButtons(s, reopen),
        h('p', { class: 'note' }, 'プレビューの図形を指でドラッグすると位置を動かせます。'),
      );
      this.#seekInto(s);
    });
  }

  /* ---- キーフレーム ---- */

  /** 再生ヘッドの時刻での見た目（キーフレーム・動きを反映した値） */
  cur(item) { return withMotion(item, this.player.t); }

  /**
   * 変更の書き込み先。キーフレームがあれば再生ヘッド位置のキー（なければ作る）、なければ本体。
   * キーフレームを使い始めると「動かしたいところに再生ヘッドを合わせて変更」するだけで動きが作れる。
   */
  kfTarget(item) {
    if (!item.keys?.length) return item;
    const len = itemEnd(item) - item.start;
    const local = Math.min(len, Math.max(0, this.player.t - item.start));
    const tol = 0.5 / (this.project.fps || 30);
    let k = item.keys.find((x) => Math.abs(x.t - local) <= tol);
    if (!k) {
      const c = withMotion(item, this.player.t);
      k = { t: Math.round(local * 1000) / 1000 };
      for (const p of ANIM_PROPS) if (typeof c[p] === 'number') k[p] = c[p];
      item.keys.push(k);
      item.keys.sort((a, b) => a.t - b.t);
    }
    return k;
  }

  #keySection(item, reopen) {
    const len = itemEnd(item) - item.start;
    const local = this.player.t - item.start;
    const tol = 0.5 / (this.project.fps || 30);
    const keys = item.keys || [];
    const here = keys.find((k) => Math.abs(k.t - local) <= tol);
    const chips = h('div', { class: 'seg' }, ...keys.map((k) => {
      const b = h('button', { type: 'button', class: k === here ? 'on' : '' }, `◆ ${k.t.toFixed(2)}s`);
      b.onclick = () => { this.player.seek(item.start + k.t); reopen(); };
      return b;
    }));
    const add = () => {
      this.change(() => {
        if (!item.keys?.length) {
          // 「to」の動きがあればキーフレームに置き換える
          item.keys = item.to ? keyStates(item).map((st) => ({ t: st.t, ...st.v, ...(st.ease ? { ease: st.ease } : {}) })) : [];
          item.to = null;
          if (!item.keys.length) {
            const c = withMotion(item, this.player.t);
            const k = { t: Math.round(Math.min(len, Math.max(0, local)) * 1000) / 1000 };
            for (const p of ANIM_PROPS) if (typeof c[p] === 'number') k[p] = c[p];
            item.keys.push(k);
          }
        }
        this.kfTarget(item);
      });
      reopen();
      toast('キーを追加しました。別の時刻に移動して位置や大きさを変えると、その間が動きます');
    };
    return [
      h('div', { class: 'sec' },
        h('div', { class: 'lbl' }, h('span', {}, `キーフレーム（${keys.length}個）`)),
        keys.length ? chips : null,
        h('div', { class: 'row-btns', style: 'margin-top:8px' },
          h('button', { class: 'btn', type: 'button', onclick: add }, here ? '◆ このキーを更新' : '◆ ここにキーを追加'),
          here ? h('button', { class: 'btn', type: 'button', onclick: () => { this.change(() => { item.keys = item.keys.filter((k) => k !== here); if (!item.keys.length) item.keys = null; }); reopen(); } }, 'このキーを削除') : null,
          keys.length ? h('button', { class: 'btn danger', type: 'button', onclick: () => {
            this.change(() => { const c = withMotion(item, this.player.t); for (const p of ANIM_PROPS) if (typeof c[p] === 'number') item[p] = c[p]; item.keys = null; });
            reopen();
          } }, 'すべて削除') : null)),
      h('p', { class: 'note' }, keys.length
        ? 'キーがある間は、再生ヘッドの位置で動かしたり大きさを変えたりすると、その時刻のキーとして記録されます。'
        : '動かしたい最初の時刻で「キーを追加」→ 再生ヘッドを動かして位置・大きさ・回転・3D を変えると、その間がなめらかにつながります。'),
    ];
  }

  #threeDSection(item) {
    return [
      this.slider('3D 縦軸の回転（左右に向く）', this.cur(item).ry || 0, -180, 180, 1, (v) => `${Math.round(v)}°`, (v) => { this.kfTarget(item).ry = v; }),
      this.slider('3D 横軸の回転（前後に倒れる）', this.cur(item).rx || 0, -85, 85, 1, (v) => `${Math.round(v)}°`, (v) => { this.kfTarget(item).rx = v; }),
    ];
  }

  /* ---- 切り抜き ---- */

  #cutoutSection(item, type, reopen) {
    const c = item.cutout;
    const mode = c?.mode || 'none';
    const out = [
      this.seg('切り抜き', [['none', 'なし'], ['person', '人物（AI）'], ['object', 'タップした物（AI）'], ['chroma', 'グリーンバック']], mode, (v) => {
        if (v === 'none') item.cutout = null;
        else item.cutout = { ...(item.cutout || {}), mode: v, ...(v === 'chroma' && !item.cutout?.color ? { color: '#00b140', tolerance: 0.3, softness: 0.1 } : {}), ...(v === 'object' && item.cutout?.x == null ? { x: 0.5, y: 0.5 } : {}) };
        if (v === 'person' || v === 'object') this.#prepareAI(v);
        setTimeout(reopen);
      }),
    ];
    if (mode === 'chroma') {
      out.push(
        this.swatches('抜く色', ['#00b140', '#00ff00', '#0047bb', '#0000ff'], c.color, (v) => { item.cutout.color = v; }),
        this.slider('抜く範囲', c.tolerance ?? 0.3, 0.02, 0.8, 0.01, (v) => `${Math.round(v * 100)}`, (v) => { item.cutout.tolerance = v; }),
        this.slider('境目のなめらかさ', c.softness ?? 0.1, 0, 0.5, 0.01, (v) => `${Math.round(v * 100)}`, (v) => { item.cutout.softness = v; }),
      );
    }
    if (mode === 'object') {
      out.push(h('div', { class: 'sec' },
        h('button', { class: 'btn primary', type: 'button', onclick: () => { this.pickPoint = { type, id: item.id, reopen }; toast('プレビューで切り抜きたい物をタップしてください', 4000); } }, '切り抜く物をタップして選ぶ'),
        h('p', { class: 'note' }, `今の位置：横 ${Math.round((c.x ?? 0.5) * 100)}% / 縦 ${Math.round((c.y ?? 0.5) * 100)}%。動画では、その位置にある物を毎コマ切り抜きます（大きく動く物は外れることがあります）。`)));
    }
    if (mode === 'person' || mode === 'object') {
      out.push(this.toggle('反転（背景のほうを残す）', !!c.invert, (v) => { item.cutout.invert = v; }));
      if (!cutoutReady(mode === 'object' ? 'object' : 'person')) out.push(h('p', { class: 'note' }, 'AI を準備中です（初回のみ数秒〜。完了するとプレビューに反映されます）'));
    }
    return out;
  }

  #prepareAI(mode) {
    const kind = mode === 'object' ? 'object' : 'person';
    if (cutoutReady(kind)) return;
    toast('切り抜き AI を準備中…（初回のみ）', 8000);
    loadCutout(kind).then(() => toast('切り抜き AI の準備ができました')).catch((err) => toast('AI を読み込めませんでした：' + err.message, 5000));
  }

  /* ---- ワイプ（重ねた映像） ---- */

  async addOverlay(file) {
    const p = this.project;
    toast(`読み込み中… ${file.name}`, 60000);
    try {
      const meta = await this.lib.add(file);
      if (meta.kind === 'audio') throw new Error('動画か写真を選んでください');
      await store.putMedia(p.id, meta, file);
      const t = Math.min(this.player.t, Math.max(0, this.player.duration - 0.5));
      const o = newOverlay(meta, t);
      this.change(() => { p.media[meta.id] = meta; p.overlays.push(o); });
      this.select({ type: 'overlay', id: o.id });
      toast('ワイプを追加しました。プレビューでドラッグして位置を調整できます');
      this.openInspector();
    } catch (err) {
      toast(`${file.name}：${err.message}`, 4000);
    }
  }

  #overlaySheet(o, section) {
    const reopen = () => { this.closeSheet(); this.openInspector(section); };
    const media = this.project.media[o.media];
    if (section === 'cutout') {
      this.openSheet('切り抜き', (body) => {
        body.append(...this.#cutoutSection(o, 'overlay', reopen).filter(Boolean),
          h('p', { class: 'note' }, '人物の切り抜きは、背景と人がはっきり分かれている映像ほどきれいに抜けます。グリーンバックで撮った映像なら「グリーンバック」がいちばん正確です。'));
        this.#seekInto(o);
      });
      return;
    }
    this.openSheet('ワイプ', (body) => {
      body.append(
        h('p', { class: 'note' }, media?.name || ''),
        this.slider('大きさ', this.cur(o).w, 0.05, 1.6, 0.01, (v) => `${Math.round(v * 100)}`, (v) => { this.kfTarget(o).w = v; }),
        this.slider('回転', this.cur(o).rotation || 0, -180, 180, 1, (v) => `${Math.round(v)}°`, (v) => { this.kfTarget(o).rotation = v; }),
        this.slider('不透明度', this.cur(o).opacity ?? 1, 0.05, 1, 0.01, (v) => `${Math.round(v * 100)}%`, (v) => { this.kfTarget(o).opacity = v; }),
        this.seg('形', [['none', '四角'], ['round', '角丸'], ['circle', '丸']], o.mask, (v) => { o.mask = v; }),
        o.mask === 'round' ? this.slider('角の丸み', o.radius ?? 0.08, 0, 0.5, 0.01, (v) => `${Math.round(v * 200)}%`, (v) => { o.radius = v; }) : null,
        this.swatches('ふちの色', ['#ffffff', '#111111', '#ffcc33', '#ff4f8b', '#4fc3ff'], o.borderColor, (v) => { o.borderColor = v; }),
        this.slider('ふちの太さ', o.border || 0, 0, 0.03, 0.001, (v) => `${Math.round(v * 1000)}`, (v) => { o.border = v; }),
        this.toggle('影', o.shadow, (v) => { o.shadow = v; }),
        media?.kind === 'video' ? this.slider('音量', o.volume ?? 1, 0, 2, 0.05, (v) => (v === 0 ? 'ミュート' : `${Math.round(v * 100)}%`), (v) => { o.volume = v; }) : null,
        this.seg('出かた', [['none', 'なし'], ['fade', 'フェード'], ['pop', 'ポップ'], ['slide', 'スライド'], ['spin', '回転'], ['wipe', 'ワイプ']], o.anim, (v) => { o.anim = v; }),
        this.seg('ずっと続く動き', [['none', 'なし'], ['pulse', '鼓動'], ['float', 'ふわふわ'], ['shake', 'ゆれる']], o.loop || 'none', (v) => { o.loop = v; }),
        ...this.#threeDSection(o),
        ...this.#keySection(o, reopen),
        h('div', { class: 'sec' }, h('div', { class: 'row-btns' },
          h('button', { class: 'btn', type: 'button', onclick: () => { this.closeSheet(); this.openInspector('cutout'); } }, '✂ 切り抜き…'),
          h('button', { class: 'btn', type: 'button', onclick: () => { this.change(() => { o.start = this.player.t; }); reopen(); } }, 'ここから表示'))),
        h('p', { class: 'note' }, 'プレビューでドラッグして位置を動かせます。タイムラインの「重ね」の段で長さや表示時間を調整できます。'),
      );
      this.#seekInto(o);
    });
  }

  /** 表示時間の始め→終わりで動かす（to を作る） */
  #motionSeg(item, current, reopen) {
    const isText = 'text' in item;
    const presets = [
      ['none', 'なし', () => null],
      ['right', '→ 右へ', () => ({ x: item.x + 0.3 })],
      ['left', '← 左へ', () => ({ x: item.x - 0.3 })],
      ['up', '↑ 上へ', () => ({ y: item.y - 0.2 })],
      ['down', '↓ 下へ', () => ({ y: item.y + 0.2 })],
      ['grow', '拡大', () => (isText ? { size: item.size * 1.5 } : { w: item.w * 1.6, h: item.h * 1.6 })],
      ['shrink', '縮小', () => (isText ? { size: item.size * 0.6 } : { w: item.w * 0.5, h: item.h * 0.5 })],
      ['rotate', '1回転', () => ({ rotation: (item.rotation || 0) + 360 })],
    ];
    const cur = !item.to ? 'none' : null;
    return h('div', {},
      this.seg('表示中の動き', presets.map(([k, l]) => [k, l]), cur, (k) => {
        item.to = presets.find((x) => x[0] === k)[2]();
        setTimeout(() => { reopen(); this.player.seek(item.start); this.player.play(); });
      }),
      item.to ? h('p', { class: 'note' }, `動き：${Object.entries(item.to).map(([k, v]) => `${k}→${Math.round(v * 100) / 100}`).join('、')}（細かい調整は JSON で）`) : null);
  }

  #timingButtons(item, reopen) {
    return h('div', { class: 'sec' },
      h('div', { class: 'lbl' }, h('span', {}, '表示時間'), h('output', {}, `${fmt(item.start)} 〜 ${fmt(item.end)}`)),
      h('div', { class: 'row-btns' },
        h('button', { class: 'btn', type: 'button', onclick: () => { this.change(() => { const d = item.end - item.start; item.start = this.player.t; item.end = item.start + d; }); reopen(); } }, 'ここから表示'),
        h('button', { class: 'btn', type: 'button', onclick: () => { if (this.player.t <= item.start + 0.1) return toast('開始より後ろに再生ヘッドを合わせてください'); this.change(() => { item.end = this.player.t; }); reopen(); } }, 'ここまで表示'),
        h('button', { class: 'btn', type: 'button', onclick: () => { this.change(() => { item.start = 0; item.end = Math.max(this.player.duration, 1); }); reopen(); } }, '最初から最後まで')));
  }

  #seekInto(item) {
    const end = itemEnd(item);
    if (this.player.t < item.start || this.player.t >= end) this.player.seek(item.start + Math.min(0.5, (end - item.start) / 2));
  }

  /* ---- エフェクト ---- */

  addEffectDialog() {
    this.openSheet('エフェクトを追加', (body) => {
      const grid = h('div', { class: 'trans-grid' });
      for (const [type, def] of Object.entries(EFFECTS)) {
        const b = h('button', { type: 'button' }, h('span', { class: 'ic' }, def.icon), def.label);
        b.addEventListener('click', () => {
          const p = this.project;
          const t = Math.min(this.player.t, Math.max(0, this.player.duration - 0.3));
          const ef = newEffect(t, type);
          this.closeSheet();
          this.change(() => p.effects.push(ef));
          this.select({ type: 'effect', id: ef.id });
          this.player.seek(ef.start);
          this.player.play();
        });
        grid.append(b);
      }
      body.append(h('div', { class: 'sec' }, grid),
        h('p', { class: 'note' }, 'ぼかし・手ぶれ・グリッチなどは映像だけに、紙吹雪・雪・キラキラ・フラッシュは文字や図形の上にもかかります。'));
    });
  }

  #effectSheet(e) {
    const reopen = () => { this.closeSheet(); this.openInspector(); };
    this.openSheet(EFFECTS[e.type]?.label || 'エフェクト', (body) => {
      body.append(
        this.seg('種類', Object.entries(EFFECTS).map(([k, d]) => [k, `${d.icon} ${d.label}`]), e.type, (v) => { e.type = v; }),
        this.slider('強さ', e.intensity ?? 0.6, 0.05, 1, 0.01, (v) => `${Math.round(v * 100)}%`, (v) => { e.intensity = v; }),
        this.#timingButtons(e, reopen),
        h('div', { class: 'sec' }, h('button', { class: 'btn', type: 'button', onclick: () => { this.player.seek(e.start); this.player.play(); } }, '▶ この部分を再生')),
      );
      this.#seekInto(e);
    });
  }

  openProjectSettings() {
    const p = this.project;
    this.openSheet('比率・設定', (body) => {
      body.append(
        this.seg('画面の比率', Object.entries(PRESETS).map(([k, v]) => [k, `${v.ratio} ${v.label}`]), presetOf(p), (k) => {
          p.width = PRESETS[k].width;
          p.height = PRESETS[k].height;
        }),
        this.swatches('背景色（全体を表示のときの余白）', ['#000000', '#ffffff', '#1d1d1f', '#ffe14d', '#ff4f8b', '#4fc3ff'], p.background, (v) => { p.background = v; }),
        this.slider('最後のフェードアウト', p.fadeOut, 0, 3, 0.1, (v) => (v ? `${v.toFixed(1)}秒` : 'なし'), (v) => { p.fadeOut = v; }),
        this.seg('フレームレート', [[30, '30fps'], [60, '60fps（なめらか）'], [24, '24fps（映画風）']], p.fps, (v) => { p.fps = v; }),
      );
    });
  }

  /* ================= メニュー（名前・JSON） ================= */

  openMenu() {
    const p = this.project;
    this.openSheet('メニュー', (body) => {
      const name = h('input', { type: 'text', value: p.name, 'aria-label': 'プロジェクト名' });
      name.addEventListener('change', () => this.change(() => { p.name = name.value.trim() || '無題'; }));
      body.append(
        h('div', { class: 'sec' }, h('div', { class: 'lbl' }, h('span', {}, 'プロジェクト名')), name),
        h('div', { class: 'sec' }, h('div', { class: 'lbl' }, h('span', {}, 'Claude などの AI と一緒に編集')),
          h('div', { class: 'row-btns' },
            h('button', { class: 'btn', type: 'button', onclick: () => this.copyJson() }, 'JSONをコピー'),
            h('button', { class: 'btn', type: 'button', onclick: () => this.pasteJsonSheet() }, 'JSONを貼り付け'),
            h('button', { class: 'btn', type: 'button', onclick: () => this.downloadJson() }, 'JSONを保存'),
            h('button', { class: 'btn', type: 'button', onclick: () => { this.closeSheet(); this.shareContactSheets(); } }, 'コマ一覧の画像'))),
        h('p', { class: 'note' }, '編集内容（テロップの文字・タイミング、カット位置、話していない区間など）を文字データとしてやり取りできます。素材ファイル自体は含まれませんが、「コマ一覧の画像」を一緒に送ると映像の中身も伝わります。'),
        h('div', { class: 'sec' }, h('div', { class: 'row-btns' },
          h('button', { class: 'btn', type: 'button', onclick: () => { this.closeSheet(); this.openProjectSettings(); } }, '比率・設定'),
          h('button', { class: 'btn', type: 'button', onclick: () => { this.closeSheet(); this.leave(); } }, 'プロジェクト一覧へ'))),
      );
    });
  }

  /** AI に渡す JSON。素材ごとに無音区間（silences）も付ける */
  projectJson() {
    const p = JSON.parse(JSON.stringify(this.project));
    delete p.updatedAt;
    for (const [id, m] of Object.entries(p.media)) {
      if (!m.hasAudio) continue;
      const sil = this.lib.silences(id);
      if (sil) m.silences = sil;
    }
    return JSON.stringify(p, null, 2);
  }

  /** 動画素材のコマ一覧画像を作って共有/保存（AI に映像の中身を見せる用） */
  async shareContactSheets() {
    const vids = Object.values(this.project.media).filter((m) => m.kind === 'video' && this.lib.get(m.id));
    if (!vids.length) return toast('動画の素材がありません');
    toast('コマ一覧を作成中…', 60000);
    const files = [];
    for (const m of vids) {
      try {
        const blob = await this.lib.contactSheet(m.id);
        files.push(new File([blob], `コマ一覧_${m.name.replace(/\.[^.]+$/, '')}.jpg`, { type: 'image/jpeg' }));
      } catch (err) {
        toast(`${m.name}：${err.message}`, 3000);
      }
    }
    if (!files.length) return;
    toast(`${files.length}枚できました`);
    this.openSheet('コマ一覧', (body) => {
      for (const f of files) {
        const url = URL.createObjectURL(f);
        body.append(h('img', { src: url, alt: f.name, style: 'width:100%;border-radius:8px;margin-bottom:8px' }));
      }
      const canShare = navigator.canShare?.({ files });
      body.append(h('div', { class: 'row-btns' },
        canShare ? h('button', { class: 'btn primary', type: 'button', onclick: () => navigator.share({ files }).catch(() => {}) }, '共有・保存') : null,
        h('button', { class: 'btn', type: 'button', onclick: () => files.forEach((f) => downloadBlob(f, f.name)) }, 'ダウンロード')),
        h('p', { class: 'note' }, 'この画像と「JSONをコピー」した内容を Claude に送ると、映像の中身を見ながら編集案を作ってもらえます。'));
    }, { tall: true });
  }

  async copyJson() {
    try {
      await navigator.clipboard.writeText(this.projectJson());
      toast('コピーしました。Claude に貼り付けて頼めます');
    } catch {
      this.openSheet('JSON', (body) => {
        const ta = h('textarea', { rows: '12' });
        ta.value = this.projectJson();
        body.append(h('p', { class: 'note' }, '自動でコピーできなかったので、全選択してコピーしてください。'), ta);
        setTimeout(() => ta.select(), 50);
      }, { tall: true });
    }
  }

  downloadJson() {
    const blob = new Blob([this.projectJson()], { type: 'application/json' });
    downloadBlob(blob, `${this.project.name}.json`);
  }

  pasteJsonSheet() {
    this.openSheet('JSONを貼り付け', (body) => {
      const ta = h('textarea', { rows: '10', placeholder: '{ "clips": [...], "texts": [...] }' });
      const report = h('ul', { class: 'note' });
      body.append(ta, report, h('div', { class: 'sec' }, h('button', {
        class: 'btn primary wide', type: 'button', onclick: () => {
          let data;
          try { data = JSON.parse(ta.value); } catch (err) { return toast('JSON として読めません：' + err.message, 5000); }
          const v = validateProject({ ...data, media: { ...this.project.media, ...(data.media || {}) } });
          report.textContent = '';
          if (v.errors.length || v.warnings.length) {
            report.append(...v.errors.map((e) => h('li', { style: 'color:var(--danger)' }, e)), ...v.warnings.map((w) => h('li', {}, w)));
          }
          if (v.errors.length) return toast(`エラーが ${v.errors.length} 件あります（下に表示）`, 4000);
          try {
            this.applyJson(data);
            if (!v.warnings.length) this.closeSheet();
            toast(v.warnings.length ? `反映しました（注意 ${v.warnings.length} 件）` : '反映しました（元に戻すボタンで取り消せます）', 4000);
          } catch (err) {
            toast('読み込めませんでした：' + err.message, 5000);
          }
        },
      }, '反映する')), h('p', { class: 'note' }, '今の素材をそのまま使い、編集内容だけを置き換えます。'));
      setTimeout(() => ta.focus(), 100);
    }, { tall: true });
  }

  /** 貼り付けた JSON を今のプロジェクトに反映（素材は ID か ファイル名で対応付け） */
  applyJson(data) {
    const p = this.project;
    const byName = new Map(Object.values(p.media).map((m) => [m.name, m.id]));
    const remap = {};
    for (const [id, m] of Object.entries(data.media || {})) {
      if (p.media[id]) remap[id] = id;
      else if (m?.name && byName.has(m.name)) remap[id] = byName.get(m.name);
      else throw new Error(`素材「${m?.name || id}」がこのプロジェクトにありません`);
    }
    const fix = (x) => ({ ...x, media: remap[x.media] || x.media });
    const merged = normalizeProject({
      ...p,
      ...data,
      id: p.id,
      media: p.media,
      clips: (data.clips || p.clips).map(fix),
      audios: (data.audios || p.audios).map(fix),
      overlays: (data.overlays || p.overlays).map(fix),
      texts: data.texts || p.texts,
    });
    for (const x of [...merged.clips, ...merged.audios, ...merged.overlays]) if (!merged.media[x.media]) throw new Error(`素材 ${x.media} が見つかりません`);
    this.change(() => { this.project = merged; });
    this.select(null);
  }

  /* ================= JSON から新規作成（素材を選び直す） ================= */

  async importFromJson(file) {
    let data;
    try { data = JSON.parse(await file.text()); } catch { return toast('JSON を読み込めませんでした'); }
    const names = Object.values(data.media || {}).map((m) => m.name);
    this.openSheet('素材を選ぶ', (body) => {
      body.append(
        h('p', {}, 'このプロジェクトで使う素材ファイルを選んでください（ファイル名で対応付けます）。'),
        h('ul', {}, ...names.map((n) => h('li', {}, n))),
        h('button', { class: 'btn primary wide', type: 'button', onclick: () => $('#fileRelink').click() }, '素材ファイルを選ぶ'),
      );
      this.pendingImport = data;
    });
  }

  async finishImport(files) {
    const data = this.pendingImport;
    this.pendingImport = null;
    this.closeSheet();
    if (!data) return;
    const pr = newProject();
    const project = { ...pr, ...data, id: pr.id, media: {} };
    const lib = new MediaLibrary();
    const missing = [];
    toast('素材を読み込み中…', 60000);
    for (const [id, m] of Object.entries(data.media || {})) {
      const f = [...files].find((x) => x.name === m.name);
      if (!f) { missing.push(m.name); continue; }
      const meta = await lib.add(f, id);
      project.media[id] = meta;
      await store.putMedia(project.id, meta, f);
    }
    for (const id of [...lib.entries.keys()]) lib.remove(id);
    if (missing.length) {
      project.clips = (project.clips || []).filter((c) => project.media[c.media]);
      project.audios = (project.audios || []).filter((a) => project.media[a.media]);
      toast(`見つからなかった素材：${missing.join('、')}`, 5000);
    }
    const norm = normalizeProject(project);
    await store.saveProject(norm, { ratio: ratioOf(norm) });
    await this.openProject(norm.id);
  }

  /* ================= 書き出し ================= */

  async openExport() {
    this.player.pause();
    this.select(null);
    const p = this.project;
    if (!(this.player.duration > 0)) return toast('先に素材・テキスト・図形を追加してください');
    const short = Math.min(p.width, p.height);
    let res = 1080, quality = 'high';
    const est = () => {
      const { width, height } = outputSize(p, res);
      const mbps = { standard: 0.06, high: 0.1, max: 0.16 }[quality] * width * height * (p.fps / 30) / 1e6 * 1.0;
      return { width, height, mb: Math.round((mbps * this.player.duration) / 8 + 0.5) };
    };
    this.openSheet('書き出す', (body) => {
      const info = h('dl', { class: 'kv' });
      const upd = () => {
        const e = est();
        info.innerHTML = '';
        info.append(h('dt', {}, 'サイズ'), h('dd', {}, `${e.width} × ${e.height}`), h('dt', {}, '長さ'), h('dd', {}, fmt(this.player.duration)),
          h('dt', {}, 'フレームレート'), h('dd', {}, `${p.fps}fps`), h('dt', {}, '容量の目安'), h('dd', {}, `約 ${e.mb} MB`));
      };
      const resOpts = [[720, '720p'], [1080, '1080p']];
      if (short >= 1080) resOpts.push([1440, '1440p'], [2160, '4K']);
      const resSeg = h('div', { class: 'seg' });
      for (const [v, t] of resOpts) {
        const b = h('button', { type: 'button', class: v === res ? 'on' : '' }, t);
        b.onclick = () => { res = v; [...resSeg.children].forEach((x) => x.classList.toggle('on', x === b)); upd(); };
        resSeg.append(b);
      }
      const qSeg = h('div', { class: 'seg' });
      for (const [k, q] of Object.entries(QUALITIES)) {
        const b = h('button', { type: 'button', class: k === quality ? 'on' : '' }, q.label);
        b.onclick = () => { quality = k; [...qSeg.children].forEach((x) => x.classList.toggle('on', x === b)); upd(); };
        qSeg.append(b);
      }
      const bar = h('div', { class: 'progress' }, h('div'));
      const status = h('p', { class: 'note' }, '');
      const go = h('button', { class: 'btn primary wide', type: 'button' }, '書き出しを始める');
      const area = h('div', { class: 'sec' });
      go.onclick = () => this.#runExport({ res, quality, bar, status, go, area });
      upd();
      body.append(
        h('div', { class: 'sec' }, h('div', { class: 'lbl' }, h('span', {}, '解像度')), resSeg),
        h('div', { class: 'sec' }, h('div', { class: 'lbl' }, h('span', {}, '画質')), qSeg),
        h('div', { class: 'sec' }, info),
        h('div', { class: 'sec' }, go, bar, status),
        area,
        h('p', { class: 'note' }, '書き出し中は画面を閉じたり、ほかのアプリに切り替えたりしないでください。長い動画や 4K は時間がかかります。'),
      );
      supportedCodecs(1080, 1920).then((c) => {
        if (!c.video) status.textContent = 'このブラウザは動画の書き出しに対応していません（iPhone は iOS 16.4 以降の Safari が必要です）。';
        else if (!c.audio) status.textContent = 'このブラウザは音声の書き出しに対応していないため、音なしの動画になります（iOS 26 以降で音声付きになります）。';
      });
    }, { tall: true });
  }

  async #runExport({ res, quality, bar, status, go, area }) {
    go.disabled = true;
    const ac = new AbortController();
    const cancel = h('button', { class: 'btn danger wide', type: 'button', onclick: () => ac.abort() }, '中止');
    area.textContent = '';
    area.append(cancel);
    let lock = null;
    try { lock = await navigator.wakeLock?.request('screen'); } catch { /* 非対応 */ }
    const t0 = performance.now();
    try {
      const r = await exportVideo(this.project, this.lib, {
        shortSide: res,
        quality,
        signal: ac.signal,
        onProgress: (p, label) => {
          bar.firstChild.style.width = `${Math.round(p * 100)}%`;
          const el = (performance.now() - t0) / 1000;
          const remain = p > 0.03 ? Math.round((el / p) * (1 - p)) : null;
          status.textContent = label + (remain != null && p < 1 ? `（残り約 ${remain >= 60 ? Math.round(remain / 60) + '分' : remain + '秒'}）` : '');
        },
      });
      const name = `${(this.project.name || 'video').replace(/[\\/:*?"<>|]/g, '_')}.mp4`;
      const file = new File([r.blob], name, { type: 'video/mp4' });
      const url = URL.createObjectURL(r.blob);
      status.textContent = `完成！ ${(r.blob.size / 1e6).toFixed(1)} MB・${r.width}×${r.height}（映像 ${r.codec.toUpperCase()} / 音声 ${r.audioCodec ? r.audioCodec.toUpperCase() : 'なし'}）`;
      area.textContent = '';
      const canShare = navigator.canShare?.({ files: [file] });
      area.append(
        h('video', { class: 'result-video', src: url, controls: true, playsinline: true }),
        h('div', { class: 'row-btns', style: 'margin-top:10px' },
          canShare ? h('button', {
            class: 'btn primary', type: 'button', onclick: async () => {
              try { await navigator.share({ files: [file] }); } catch (err) { if (err.name !== 'AbortError') downloadBlob(r.blob, name); }
            },
          }, '共有・写真に保存') : null,
          h('button', { class: 'btn', type: 'button', onclick: () => downloadBlob(r.blob, name) }, 'ダウンロード')),
        h('p', { class: 'note' }, canShare ? '「共有・写真に保存」→「ビデオを保存」で写真アプリに入ります。そこから YouTube や TikTok に投稿できます。' : ''),
      );
      this.onSheetClose = () => URL.revokeObjectURL(url);
    } catch (err) {
      area.textContent = '';
      status.textContent = err.name === 'AbortError' ? '中止しました' : `書き出しに失敗しました：${err.message}`;
      go.disabled = false;
    } finally {
      lock?.release?.().catch(() => {});
    }
  }

  /* ================= プレビュー上のドラッグ ================= */

  #previewGestures() {
    const cv = $('#preview');
    let drag = null;
    const toProj = (e) => {
      const r = cv.getBoundingClientRect();
      return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
    };
    cv.addEventListener('pointerdown', (e) => {
      if (!this.project) return;
      const pt = toProj(e);
      const t = this.player.t;
      const W = cv.width, H = cv.height;
      const ctx = cv.getContext('2d');
      if (this.pickPoint) { this.#pickCutoutPoint(pt, W, H); return; }
      // 上に描かれているテキストから順に当たり判定
      const inside = (b) => {
        const m = 12;
        return pt.x * W >= b.x - m && pt.x * W <= b.x + b.w + m && pt.y * H >= b.y - m && pt.y * H <= b.y + b.h + m;
      };
      const sel = this.timeline.selection;
      // 選択中のものを優先し、なければ上に描かれている順（文字→図形）
      const cands = [
        ...[...this.project.texts].reverse().map((x) => ({ type: 'text', item: x })),
        ...[...this.project.shapes].reverse().map((x) => ({ type: 'shape', item: x })),
        ...[...this.project.overlays].reverse().map((x) => ({ type: 'overlay', item: x })),
      ].filter(({ type, item }) => t >= item.start && t < itemEnd(item) &&
        inside(type === 'text' ? measureText(ctx, W, H, item, t).box : type === 'shape' ? shapeBox(W, H, item, t).box : this.#overlayBox(W, H, item, t).box));
      const hit = cands.find((c) => sel && c.type === sel.type && c.item.id === sel.id) || cands[0];
      if (hit) {
        const c = withMotion(hit.item, t);
        drag = { type: hit.type, item: hit.item, x0: pt.x, y0: pt.y, ox: c.x, oy: c.y, moved: false };
        if (!(sel?.type === hit.type && sel.id === hit.item.id)) this.select({ type: hit.type, id: hit.item.id });
      } else if (sel?.type === 'clip') {
        const c = this.findItem('clip', sel.id);
        drag = { type: 'clip', item: c, x0: pt.x, y0: pt.y, ox: c.x, oy: c.y, moved: false };
      } else {
        drag = { type: 'tap', x0: pt.x, y0: pt.y, moved: false };
      }
      cv.setPointerCapture(e.pointerId);
    });
    cv.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const pt = toProj(e);
      const dx = pt.x - drag.x0, dy = pt.y - drag.y0;
      if (!drag.moved && Math.hypot(dx * cv.clientWidth, dy * cv.clientHeight) < 6) return;
      drag.moved = true;
      if (drag.type === 'tap') return;
      this.beginEdit();
      let nx = drag.ox + dx, ny = drag.oy + dy;
      const guides = [];
      if (drag.type === 'text' || drag.type === 'shape' || drag.type === 'overlay') {
        // 動き（to）がある場合は、終点も同じだけずらす
        if (drag.item.to && !drag.toOrig) drag.toOrig = { ...drag.item.to };
        if (Math.abs(nx - 0.5) < 0.025) { nx = 0.5; guides.push('v'); }
        if (Math.abs(ny - 0.5) < 0.02) { ny = 0.5; guides.push('h'); }
        // キーフレームがあれば、再生ヘッド位置のキーを動かす
        const target = this.kfTarget(drag.item);
        target.x = Math.max(-0.5, Math.min(1.5, nx));
        target.y = Math.max(-0.5, Math.min(1.5, ny));
        if (drag.toOrig && target === drag.item) {
          if (typeof drag.toOrig.x === 'number') drag.item.to.x = drag.toOrig.x + (drag.item.x - drag.ox);
          if (typeof drag.toOrig.y === 'number') drag.item.to.y = drag.toOrig.y + (drag.item.y - drag.oy);
        }
      } else {
        if (Math.abs(nx) < 0.015) { nx = 0; guides.push('v'); }
        if (Math.abs(ny) < 0.015) { ny = 0; guides.push('h'); }
        drag.item.x = Math.max(-1, Math.min(1, nx));
        drag.item.y = Math.max(-1, Math.min(1, ny));
      }
      this.player.overlay = (ctx) => {
        ctx.strokeStyle = 'rgba(255,204,51,0.9)';
        ctx.lineWidth = Math.max(1, ctx.canvas.width / 400);
        ctx.setLineDash([6, 6]);
        if (guides.includes('v')) { ctx.beginPath(); ctx.moveTo(ctx.canvas.width / 2, 0); ctx.lineTo(ctx.canvas.width / 2, ctx.canvas.height); ctx.stroke(); }
        if (guides.includes('h')) { ctx.beginPath(); ctx.moveTo(0, ctx.canvas.height / 2); ctx.lineTo(ctx.canvas.width, ctx.canvas.height / 2); ctx.stroke(); }
      };
      this.player.setProject(this.project);
    });
    const end = () => {
      if (!drag) return;
      const d = drag;
      drag = null;
      this.player.overlay = null;
      if (d.moved && d.type !== 'tap') this.endEdit();
      else if (!d.moved && d.type === 'tap') this.player.toggle();
      else this.player.requestDraw();
    };
    cv.addEventListener('pointerup', end);
    cv.addEventListener('pointercancel', end);
  }

  /** 重ねた映像の表示枠（素材の縦横比を使う） */
  #overlayBox(W, H, o, t) {
    const m = this.project.media[o.media] || {};
    return overlayBox(W, H, o, t, m.width, m.height);
  }

  /** 「タップした物」の切り抜き位置を、プレビューのタップから決める */
  #pickCutoutPoint(pt, W, H) {
    const { type, id, reopen } = this.pickPoint;
    this.pickPoint = null;
    const item = this.findItem(type, id);
    if (!item?.cutout) return;
    const m = this.project.media[item.media] || {};
    const px = pt.x * W, py = pt.y * H;
    let rx, ry;
    if (type === 'overlay') {
      const b = this.#overlayBox(W, H, item, this.player.t);
      const s = Math.max(b.dw / (m.width || 1), b.dh / (m.height || 1));
      const iw = (m.width || 1) * s, ih = (m.height || 1) * s;
      rx = (px - (b.cx - iw / 2)) / iw;
      ry = (py - (b.cy - ih / 2)) / ih;
    } else {
      const fit = item.fit === 'contain' ? Math.min(W / m.width, H / m.height) : Math.max(W / m.width, H / m.height);
      const s = fit * (item.zoom || 1);
      const dw = m.width * s, dh = m.height * s;
      const cx = W / 2 + (item.x || 0) * W, cy = H / 2 + (item.y || 0) * H;
      rx = (px - (cx - dw / 2)) / dw;
      ry = (py - (cy - dh / 2)) / dh;
    }
    if (!(rx >= 0 && rx <= 1 && ry >= 0 && ry <= 1)) { toast('素材の中をタップしてください'); return; }
    this.change(() => { item.cutout.x = Math.round(rx * 1000) / 1000; item.cutout.y = Math.round(ry * 1000) / 1000; });
    toast('切り抜く物を選びました');
    reopen?.();
  }

  /* ================= イベント ================= */

  #bind() {
    $('#playBtn').addEventListener('click', () => this.player.toggle());
    $('#back').addEventListener('click', () => this.leave());
    $('#undo').addEventListener('click', () => this.undo());
    $('#redo').addEventListener('click', () => this.redo());
    $('#menuBtn').addEventListener('click', () => this.openMenu());
    $('#projName').addEventListener('click', () => this.openMenu());
    $('#exportBtn').addEventListener('click', () => this.openExport());
    $('#zoomIn').addEventListener('click', () => this.timeline.zoom(1.5));
    $('#zoomOut').addEventListener('click', () => this.timeline.zoom(1 / 1.5));
    $('#sheetDone').addEventListener('click', () => this.closeSheet());
    $('#fileMedia').addEventListener('change', (e) => { const f = [...e.target.files]; e.target.value = ''; if (f.length) this.addFiles(f); });
    $('#fileOverlay').addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) this.addOverlay(f); });
    $('#fileAudio').addEventListener('change', (e) => { const f = [...e.target.files]; e.target.value = ''; if (f.length) this.addFiles(f, { asAudio: true }); });
    $('#importJson').addEventListener('click', () => $('#fileJson').click());
    $('#fileJson').addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) this.importFromJson(f); });
    $('#fileRelink').addEventListener('change', (e) => { const f = [...e.target.files]; e.target.value = ''; this.finishImport(f); });
    // タイムラインの空き部分をタップしたら選択解除
    $('#timeline').addEventListener('click', (e) => { if (!e.target.closest('.blk, .tl-trans, .tl-empty')) this.select(null); });
    this.#previewGestures();
    window.addEventListener('resize', () => { this.player.resize(); });
    document.addEventListener('visibilitychange', () => { if (document.hidden) { this.player.pause(); this.saveNow(); } });
    window.addEventListener('pagehide', () => this.saveNow());
    document.addEventListener('keydown', (e) => {
      if ($('#editor').hidden || /INPUT|TEXTAREA/.test(document.activeElement?.tagName)) return;
      const mod = e.metaKey || e.ctrlKey;
      if (e.key === ' ') { e.preventDefault(); this.player.toggle(); }
      else if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? this.redo() : this.undo(); }
      else if (e.key === 'Delete' || e.key === 'Backspace') this.deleteSelected();
      else if (e.key.toLowerCase() === 's' && !mod) this.splitAtPlayhead();
      else if (e.key === 'ArrowLeft') this.scrub(this.player.t - (e.shiftKey ? 1 : 1 / this.project.fps));
      else if (e.key === 'ArrowRight') this.scrub(this.player.t + (e.shiftKey ? 1 : 1 / this.project.fps));
      else if (e.key === 'Escape') { this.closeSheet(); this.select(null); }
      if (e.key.startsWith('Arrow')) this.timeline.setTime(this.player.t);
    });
  }
}

/* ================= ユーティリティ ================= */

/** 分割したとき、前半 a と後半 b の動き（to / keys）をつなぎ目で途切れないように分ける */
function splitMotion(a, b, t) {
  const local = t - a.start;
  const mid = withMotion(a, t);
  const state = {};
  for (const p of ANIM_PROPS) if (typeof mid[p] === 'number') state[p] = mid[p];
  if (a.keys?.length) {
    const ks = a.keys;
    a.keys = [...ks.filter((k) => k.t < local - 1e-6), { t: local, ...state }];
    b.keys = [{ t: 0, ...state }, ...ks.filter((k) => k.t > local + 1e-6).map((k) => ({ ...k, t: k.t - local }))];
  } else if (a.to) {
    const firstTo = {};
    for (const k of Object.keys(a.to)) { firstTo[k] = mid[k]; b[k] = mid[k]; }
    a.to = firstTo;
  }
}

function ratioOf(p) {
  const k = presetOf(p);
  return k ? PRESETS[k].ratio : `${p.width}×${p.height}`;
}

function presetOf(p) {
  return Object.keys(PRESETS).find((k) => PRESETS[k].width === p.width && PRESETS[k].height === p.height) || null;
}

function downloadBlob(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 60000);
}

let toastTimer = 0;
function toast(msg, ms = 2400) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

window.app = new App();

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
