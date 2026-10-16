/*
 * プレビュー再生。映像はミュートした <video> 要素、音声は Web Audio で鳴らす。
 * 描画は書き出しと同じ drawFrame を使う。
 */
import { layoutClips, projectDuration, activeClipsAt, mediaTime, overlayEnd } from './engine/project.js';
import { drawFrame } from './engine/render.js';
import { scheduleAudio } from './engine/audio.js';

export class Player {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {import('./engine/media.js').MediaLibrary} lib
   */
  constructor(canvas, lib, { onTime, onState } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.lib = lib;
    this.onTime = onTime || (() => {});
    this.onState = onState || (() => {});
    this.project = null;
    this.layout = [];
    this.duration = 0;
    this.t = 0;
    this.playing = false;
    this.ac = null;
    this.nodes = [];
    this.raf = 0;
    this.drawQueued = false;
    this.hideTextId = null;
    this.overlay = null; // (ctx, scale) => void  ガイド線などの追加描画
    this.holder = document.createElement('div');
    this.holder.style.cssText = 'position:fixed;left:0;top:0;width:2px;height:2px;opacity:0;pointer-events:none;overflow:hidden';
    document.body.append(this.holder);
    this.audioBufs = new Map();
    // 切り抜きの AI モデルを読み込み終えたら描き直す
    window.addEventListener('cutoutready', () => this.requestDraw());
    window.addEventListener('motionready', () => this.requestDraw());
  }

  setProject(project) {
    this.project = project;
    this.layout = layoutClips(project);
    this.duration = projectDuration(project, this.layout);
    this.#sizeCanvas();
    if (this.t > this.duration) this.t = this.duration;
    // 音声の準備（バックグラウンドでデコード）
    const ids = new Set([...project.clips.map((c) => c.media), ...project.audios.map((a) => a.media), ...(project.overlays || []).map((o) => o.media)]);
    for (const id of ids) {
      if (this.audioBufs.has(id)) continue;
      this.audioBufs.set(id, null);
      this.lib.previewAudio(id).then((b) => {
        this.audioBufs.set(id, b);
        this.onAudioReady?.(id);
      });
    }
    if (this.playing) this.#restartAudio();
    this.requestDraw();
  }

  #sizeCanvas() {
    const p = this.project;
    const box = this.canvas.parentElement.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const s = Math.min(box.width / p.width, box.height / p.height);
    const cssW = Math.max(1, Math.floor(p.width * s)), cssH = Math.max(1, Math.floor(p.height * s));
    this.canvas.style.width = cssW + 'px';
    this.canvas.style.height = cssH + 'px';
    // プレビューは最大でも短辺 720px 程度で十分
    const r = Math.min(dpr, 720 / Math.min(cssW, cssH));
    const w = Math.max(2, Math.round(cssW * r)), h = Math.max(2, Math.round(cssH * r));
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
    this.scale = w / p.width;
  }

  resize() { if (this.project) { this.#sizeCanvas(); this.requestDraw(); } }

  /**
   * 素材ごとの <video> 要素。同じ素材のクリップ同士がトランジションで重なるときは
   * 2本目（slot 1）に別の要素を使う（1つの要素を2か所にシークし合うと表示が崩れるため）。
   */
  #video(id, slot = 0) {
    const e = this.lib.get(id);
    if (!e || e.meta.kind !== 'video') return null;
    let v;
    if (slot === 0) v = this.lib.element(e);
    else {
      e.extraEls ||= [];
      v = e.extraEls[slot - 1];
      if (!v) {
        v = document.createElement('video');
        v.muted = true;
        v.playsInline = true;
        v.setAttribute('playsinline', '');
        v.preload = 'auto';
        v.src = e.url;
        e.extraEls[slot - 1] = v;
      }
    }
    if (!v.isConnected) {
      this.holder.append(v);
      v.addEventListener('seeked', () => this.requestDraw());
      v.addEventListener('loadeddata', () => this.requestDraw());
    }
    return v;
  }

  #source(L, mt) {
    const e = this.lib.get(L.clip.media);
    if (!e) return null;
    if (e.meta.kind === 'image') return e.bitmap ? { image: e.bitmap, width: e.bitmap.width, height: e.bitmap.height } : null;
    const v = this.#video(L.clip.media, this.slots?.get(L.clip.id) || 0);
    if (!v) return null;
    if (!this.playing) seekTo(v, mt);
    if (v.readyState < 2) return null;
    return { image: v, width: v.videoWidth, height: v.videoHeight };
  }

  requestDraw() {
    if (this.drawQueued || this.playing) return;
    this.drawQueued = true;
    requestAnimationFrame(() => { this.drawQueued = false; this.draw(); });
  }

  /** 時刻 t に表示するクリップへ、素材ごとの要素番号を割り当てる */
  #assignSlots(t) {
    const count = new Map();
    const slots = new Map();
    // メインのクリップと重ねた映像を、同じ形 {L: {clip}, mt} にそろえる
    const items = activeClipsAt(this.layout, t).map((it) => ({ L: it.L, mt: mediaTime(it.L, t) }));
    for (const o of this.project.overlays || []) {
      if (t >= o.start && t < overlayEnd(o)) items.push({ L: { clip: o, overlay: true }, mt: Math.min(o.out, o.in + (t - o.start) * (o.speed || 1)) });
    }
    for (const it of items) {
      const id = it.L.clip.media;
      const n = count.get(id) || 0;
      slots.set(it.L.clip.id, n);
      count.set(id, n + 1);
    }
    this.slots = slots;
    return items;
  }

  draw() {
    if (!this.project) return;
    this.#assignSlots(Math.min(this.t, Math.max(0, this.duration - 1e-3)));
    const p = { ...this.project, width: this.canvas.width, height: this.canvas.height };
    drawFrame(this.ctx, p, this.layout, Math.min(this.t, Math.max(0, this.duration - 1e-3)), (L, mt) => this.#source(L, mt), { hideTextId: this.hideTextId, preview: true, playing: this.playing });
    if (this.overlay) { this.ctx.save(); this.overlay(this.ctx, this.scale); this.ctx.restore(); }
  }

  seek(t) {
    this.t = Math.max(0, Math.min(this.duration, t));
    if (this.playing) this.#restartAudio();
    this.requestDraw();
    this.onTime(this.t);
  }

  async play() {
    if (this.playing || !this.project) return;
    if (this.t >= this.duration - 0.05) this.t = 0;
    if (!this.ac) {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ac = new AC({ latencyHint: 'playback' });
      this.master = this.ac.createGain();
      this.master.connect(this.ac.destination);
    }
    // iOS は無音の短いバッファを鳴らしてからでないと音が出ないことがある
    const unlock = this.ac.createBufferSource();
    unlock.buffer = this.ac.createBuffer(1, 1, 22050);
    unlock.connect(this.ac.destination);
    unlock.start();
    if (this.ac.state !== 'running') await this.ac.resume().catch(() => {});
    this.playing = true;
    this.onState(true);
    this.#restartAudio();
    // 再生開始時に使う動画要素をユーザー操作の中で一度動かしておく
    for (const it of this.#assignSlots(this.t)) {
      const v = this.#video(it.L.clip.media, this.slots.get(it.L.clip.id));
      if (v) { v.currentTime = it.mt; v.play().catch(() => {}); }
    }
    const loop = () => {
      if (!this.playing) return;
      this.t = this.t0 + Math.max(0, this.ac.currentTime - this.ctxStart);
      if (this.t >= this.duration) {
        this.t = this.duration;
        this.pause();
        this.onTime(this.t);
        return;
      }
      this.#syncVideos();
      this.draw();
      this.onTime(this.t);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  pause() {
    if (!this.playing) return;
    this.playing = false;
    cancelAnimationFrame(this.raf);
    for (const n of this.nodes) { try { n.stop(); } catch { /* 済み */ } }
    this.nodes = [];
    for (const v of this.holder.querySelectorAll('video')) v.pause();
    this.onState(false);
    this.requestDraw();
  }

  toggle() { this.playing ? this.pause() : this.play(); }

  #restartAudio() {
    for (const n of this.nodes) { try { n.stop(); } catch { /* 済み */ } }
    this.t0 = this.t;
    this.ctxStart = this.ac.currentTime + 0.06;
    this.nodes = scheduleAudio(this.ac, this.project, this.layout, (id) => this.audioBufs.get(id) || null, this.t0, this.ctxStart, this.master);
  }

  #syncVideos() {
    const used = new Set();
    for (const it of this.#assignSlots(this.t)) {
      const L = it.L;
      const v = this.#video(L.clip.media, this.slots.get(L.clip.id));
      if (!v) continue;
      used.add(v);
      const target = it.mt;
      const rate = L.clip.speed || 1;
      if (v.playbackRate !== rate) v.playbackRate = rate;
      if (v.paused) {
        v.currentTime = target;
        v.play().catch(() => {});
      } else if (Math.abs(v.currentTime - target) > 0.25 * rate) {
        v.currentTime = target;
      }
    }
    for (const v of this.holder.querySelectorAll('video')) {
      if (!used.has(v) && !v.paused) v.pause();
    }
  }
}

/* 連続したシーク要求をまとめる（スクラブ中に詰まらないように） */
function seekTo(v, t) {
  if (v.readyState < 1) {
    v._want = t;
    if (!v._metaHooked) {
      v._metaHooked = true;
      v.addEventListener('loadedmetadata', () => { if (v._want != null) seekTo(v, v._want); }, { once: true });
    }
    return;
  }
  if (Math.abs(v.currentTime - t) < 1 / 120 && !v.seeking) return;
  v._want = t;
  if (v.seeking) {
    if (!v._chained) {
      v._chained = true;
      v.addEventListener('seeked', () => { v._chained = false; if (v._want != null && Math.abs(v.currentTime - v._want) > 1 / 120) seekTo(v, v._want); }, { once: true });
    }
    return;
  }
  v.currentTime = t;
}
