/*
 * 素材（動画・画像・音声）の読み込み、サムネイル、音声デコード、書き出し用のフレーム取得。
 * WebCodecs（mediabunny）が使えればそれを使い、使えなければ <video> 要素で代用する。
 */
import * as MB from '../../lib/mediabunny.min.mjs';
import { extractAudioTrack, buildM4a, buildAdts } from '../../../js/mp4.js';
import { uid } from './project.js';

const VIDEO_EXT = /\.(mov|mp4|m4v|webm|mkv|3gp|avi)$/i;
const AUDIO_EXT = /\.(mp3|m4a|aac|wav|aiff?|caf|ogg|opus|flac)$/i;
const IMAGE_EXT = /\.(jpe?g|png|gif|webp|heic|heif|avif|bmp)$/i;

export function guessKind(file) {
  if (file.type.startsWith('image/') || IMAGE_EXT.test(file.name)) return 'image';
  if (file.type.startsWith('audio/') || AUDIO_EXT.test(file.name)) return 'audio';
  if (file.type.startsWith('video/') || VIDEO_EXT.test(file.name)) return 'video';
  return null;
}

const once = (el, ev) => new Promise((res, rej) => {
  el.addEventListener(ev, res, { once: true });
  el.addEventListener('error', () => rej(new Error('読み込めませんでした')), { once: true });
});

/** 実行中に持っておく素材ごとの情報 */
class Entry {
  constructor(meta, blob) {
    this.meta = meta;
    this.blob = blob;
    this.url = URL.createObjectURL(blob);
    this.input = null;
    this.vTrack = null;
    this.aTrack = null;
    this.firstTs = 0;
    this.bitmap = null;
    this.thumbsP = null;
    this.previewAudio = undefined; // AudioBuffer | null
    this.peaks = null;
    this.el = null;
  }
  dispose() {
    URL.revokeObjectURL(this.url);
    this.bitmap?.close?.();
    this.input?.dispose?.();
    for (const v of [this.el, ...(this.extraEls || [])]) {
      if (!v) continue;
      v.removeAttribute('src');
      v.load();
      v.remove();
    }
  }
}

export class MediaLibrary {
  constructor() {
    /** @type {Map<string, Entry>} */
    this.entries = new Map();
  }

  get(id) { return this.entries.get(id); }

  /** 新しいファイルを調べて登録し、プロジェクトに入れる meta を返す */
  async add(file, id = uid('m')) {
    const kind = guessKind(file);
    if (!kind) throw new Error('対応していないファイルです');
    const meta = { id, name: file.name, kind, duration: 0, width: 0, height: 0, hasAudio: false };
    const e = new Entry(meta, file);
    await this.#probe(e);
    this.entries.set(id, e);
    return meta;
  }

  /** 保存済みの素材を復元する */
  async restore(meta, blob) {
    const e = new Entry({ ...meta }, blob);
    try { await this.#probe(e); } catch { /* 情報は保存済みの meta を使う */ }
    Object.assign(e.meta, meta);
    this.entries.set(meta.id, e);
    return e;
  }

  remove(id) {
    this.entries.get(id)?.dispose();
    this.entries.delete(id);
  }

  async #probe(e) {
    const m = e.meta;
    if (m.kind === 'image') {
      e.bitmap = await loadImage(e.blob);
      m.width = e.bitmap.width;
      m.height = e.bitmap.height;
      m.duration = 0;
      return;
    }
    try {
      const input = new MB.Input({ source: new MB.BlobSource(e.blob), formats: MB.ALL_FORMATS });
      const vt = await input.getPrimaryVideoTrack();
      const at = await input.getPrimaryAudioTrack();
      e.input = input;
      const first = await input.getFirstTimestamp().catch(() => 0);
      e.firstTs = Number.isFinite(first) ? Math.max(0, first) : 0;
      m.duration = (await input.computeDuration()) - e.firstTs;
      if (vt) {
        m.kind = 'video';
        m.width = vt.displayWidth;
        m.height = vt.displayHeight;
        if (await vt.canDecode().catch(() => false)) e.vTrack = vt;
      } else if (m.kind === 'video') {
        m.kind = 'audio';
      }
      if (at) {
        m.hasAudio = true;
        if (await at.canDecode().catch(() => false)) e.aTrack = at;
      }
    } catch {
      // mediabunny で読めない形式は <video>/<audio> 要素で調べる
    }
    if (m.kind === 'video' && (!m.width || !m.duration)) {
      const v = this.element(e);
      if (v.readyState < 1) await once(v, 'loadedmetadata');
      m.width = v.videoWidth;
      m.height = v.videoHeight;
      m.duration = v.duration;
      m.hasAudio = true; // 要素からは判別できないので、あるものとして扱う
    }
    if (m.kind === 'audio' && !m.duration) {
      const a = new Audio();
      a.preload = 'metadata';
      a.src = e.url;
      await once(a, 'loadedmetadata');
      m.duration = a.duration;
      m.hasAudio = true;
    }
    if (!m.duration || !Number.isFinite(m.duration)) throw new Error('長さを取得できませんでした');
  }

  /** プレビュー用の <video> 要素（素材ごとに1つ、ミュート） */
  element(e) {
    if (!e.el) {
      const v = document.createElement('video');
      v.muted = true;
      v.playsInline = true;
      v.setAttribute('playsinline', '');
      v.preload = 'auto';
      v.src = e.url;
      e.el = v;
    }
    return e.el;
  }

  /** タイムライン用のサムネイル（dataURL の配列。時刻は等間隔） */
  thumbnails(id, count = 8, width = 96) {
    const e = this.get(id);
    if (!e) return Promise.resolve([]);
    if (!e.thumbsP) e.thumbsP = this.#makeThumbs(e, count, width).catch(() => []);
    return e.thumbsP;
  }

  async #makeThumbs(e, count, width) {
    const m = e.meta;
    const canvas = document.createElement('canvas');
    const h = Math.round(width * (m.height / m.width || 1));
    canvas.width = width;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    const out = [];
    if (m.kind === 'image') {
      ctx.drawImage(e.bitmap, 0, 0, width, h);
      out.push(canvas.toDataURL('image/jpeg', 0.7));
    } else if (m.kind === 'video') {
      const times = Array.from({ length: count }, (_, i) => (m.duration * (i + 0.5)) / count);
      if (e.vTrack) {
        try {
          const sink = new MB.CanvasSink(e.vTrack, { width, height: h, fit: 'cover' });
          for await (const wc of sink.canvasesAtTimestamps(times.map((t) => t + e.firstTs))) {
            if (wc) ctx.drawImage(wc.canvas, 0, 0, width, h);
            out.push(canvas.toDataURL('image/jpeg', 0.7));
          }
        } catch { out.length = 0; }
      }
      if (!out.length) {
        const v = document.createElement('video');
        v.muted = true; v.playsInline = true; v.preload = 'auto'; v.src = e.url;
        for (const t of times) {
          try {
            v.currentTime = t;
            await Promise.race([once(v, 'seeked'), new Promise((r) => setTimeout(r, 3000))]);
            ctx.drawImage(v, 0, 0, width, h);
          } catch { /* 黒いまま */ }
          out.push(canvas.toDataURL('image/jpeg', 0.7));
        }
        v.removeAttribute('src');
        v.load();
      }
    }
    return out;
  }

  /**
   * 音声をデコードして AudioBuffer にする（音声がなければ null）。
   * Safari は .mov を decodeAudioData で読めないことがあるので、複数の方法を順に試す。
   */
  async decodeAudio(id, sampleRate, mono = false) {
    const e = this.get(id);
    if (!e || !e.meta.hasAudio) return null;
    let buf = null;
    if (e.aTrack) {
      try { buf = await decodeWithMediabunny(e, sampleRate); } catch { buf = null; }
    }
    if (!buf) {
      const blobs = [() => e.blob];
      try {
        const tr = await extractAudioTrack(e.blob);
        blobs.unshift(() => buildM4a(tr), () => buildAdts(tr));
      } catch { /* MP4/MOV 以外 */ }
      for (const make of blobs) {
        try { buf = await decodeBlob(make(), sampleRate); break; } catch { /* 次を試す */ }
      }
    }
    if (!buf) {
      if (e.meta.kind === 'video') { e.meta.hasAudio = false; return null; }
      throw new Error(`${e.meta.name} の音声を読み込めませんでした`);
    }
    return mono ? toMono(buf) : buf;
  }

  /** プレビュー再生・波形表示用（低サンプリングレート・モノラルでメモリ節約） */
  async previewAudio(id) {
    const e = this.get(id);
    if (!e) return null;
    if (e.previewAudio === undefined) {
      e.previewAudio = this.decodeAudio(id, 22050, true).catch(() => null);
    }
    const buf = await e.previewAudio;
    if (buf && !e.peaks) e.peaks = computePeaks(buf, 100);
    e.previewBuf = buf;
    return buf;
  }

  /**
   * 無音（話していない）区間 [[開始, 終了], ...]（秒）。プレビュー用の音声がまだ無ければ null。
   * -40dB 未満が 0.6 秒以上続くところ。
   */
  silences(id, { thresholdDb = -40, minLen = 0.6 } = {}) {
    const buf = this.get(id)?.previewBuf;
    if (!buf) return null;
    const d = buf.getChannelData(0);
    const win = Math.round(buf.sampleRate * 0.05);
    const th = Math.pow(10, thresholdDb / 20);
    const out = [];
    let start = null;
    for (let i = 0; i < d.length; i += win) {
      let sum = 0;
      const e = Math.min(d.length, i + win);
      for (let j = i; j < e; j++) sum += d[j] * d[j];
      const quiet = Math.sqrt(sum / Math.max(1, e - i)) < th;
      const t = i / buf.sampleRate;
      if (quiet && start === null) start = t;
      if (!quiet && start !== null) { if (t - start >= minLen) out.push([start, t]); start = null; }
    }
    if (start !== null && buf.duration - start >= minLen) out.push([start, buf.duration]);
    return out.map(([a, b]) => [Math.round(a * 10) / 10, Math.round(b * 10) / 10]);
  }

  /**
   * 素材のコマ一覧画像（時刻つき）。AI に映像の中身を伝えるのに使う。
   * @returns {Promise<Blob>} JPEG
   */
  async contactSheet(id, { maxFrames = 40, cols = 5, cellW = 240 } = {}) {
    const e = this.get(id);
    const m = e.meta;
    const steps = [0.5, 1, 2, 3, 5, 10, 15, 30, 60, 120];
    const step = steps.find((s) => m.duration / s <= maxFrames) || Math.ceil(m.duration / maxFrames);
    const times = [];
    for (let t = 0; t < m.duration - 0.05; t += step) times.push(t);
    if (!times.length) times.push(0);
    const cellH = Math.round(cellW * (m.height / m.width || 0.5625));
    const rows = Math.ceil(times.length / cols);
    const head = 44;
    const c = document.createElement('canvas');
    c.width = cols * cellW;
    c.height = head + rows * cellH;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#111';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 20px sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${m.name}  長さ ${m.duration.toFixed(1)}秒  ${m.width}×${m.height}  ${step}秒ごと`, 12, head / 2);
    const label = (t, x, y) => {
      const txt = `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}${step < 1 ? '.' + Math.round((t % 1) * 10) : ''}`;
      ctx.font = 'bold 18px sans-serif';
      const w = ctx.measureText(txt).width + 10;
      ctx.fillStyle = 'rgba(0,0,0,0.75)';
      ctx.fillRect(x + 4, y + 4, w, 24);
      ctx.fillStyle = '#ffcc33';
      ctx.fillText(txt, x + 9, y + 16);
    };
    const reader = this.frameReader(id, times, cellW * 2, cellH * 2);
    for (let i = 0; i < times.length; i++) {
      const x = (i % cols) * cellW, y = head + Math.floor(i / cols) * cellH;
      try {
        const src = await reader.next();
        if (src) ctx.drawImage(src.image, x, y, cellW, cellH);
      } catch { /* 黒いまま */ }
      ctx.strokeStyle = '#111';
      ctx.strokeRect(x, y, cellW, cellH);
      label(times[i], x, y);
    }
    reader.close();
    return new Promise((r) => c.toBlob(r, 'image/jpeg', 0.82));
  }

  /** 書き出し用のフレーム取得器（クリップごとに作る） */
  frameReader(id, timestamps, width, height) {
    const e = this.get(id);
    if (e.meta.kind === 'image') {
      const src = { image: e.bitmap, width: e.bitmap.width, height: e.bitmap.height };
      return { next: async () => src, close() {} };
    }
    if (e.vTrack) {
      // 出力より大きい解像度でデコードしてもムダなので縮小して受け取る
      const s = Math.min(1, Math.max(width / e.meta.width, height / e.meta.height) * 1.25);
      const sink = new MB.CanvasSink(e.vTrack, {
        width: Math.max(2, Math.round(e.meta.width * s)),
        height: Math.max(2, Math.round(e.meta.height * s)),
        fit: 'fill',
        poolSize: 3,
      });
      const it = sink.canvasesAtTimestamps(timestamps.map((t) => t + e.firstTs));
      let last = null;
      return {
        async next() {
          const r = await it.next();
          if (!r.done && r.value) last = { image: r.value.canvas, width: r.value.canvas.width, height: r.value.canvas.height };
          return last;
        },
        close() { it.return?.(); },
      };
    }
    // WebCodecs で読めない場合：<video> を1フレームずつシークする（遅いが確実）
    const v = document.createElement('video');
    v.muted = true; v.playsInline = true; v.preload = 'auto'; v.src = e.url;
    let i = 0;
    return {
      async next() {
        const t = timestamps[i++];
        if (v.readyState < 1) await once(v, 'loadedmetadata');
        if (Math.abs(v.currentTime - t) > 0.001) {
          v.currentTime = t;
          await Promise.race([once(v, 'seeked'), new Promise((r) => setTimeout(r, 5000))]);
        }
        return { image: v, width: v.videoWidth, height: v.videoHeight };
      },
      close() { v.removeAttribute('src'); v.load(); },
    };
  }
}

async function loadImage(blob) {
  const MAX = 2560;
  try {
    const bmp = await createImageBitmap(blob);
    const s = Math.min(1, MAX / Math.max(bmp.width, bmp.height));
    if (s >= 1) return bmp;
    const r = await createImageBitmap(bmp, { resizeWidth: Math.round(bmp.width * s), resizeHeight: Math.round(bmp.height * s), resizeQuality: 'high' });
    bmp.close();
    return r;
  } catch {
    // HEIC など createImageBitmap が読めない形式は <img> 経由で
    const url = URL.createObjectURL(blob);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      const s = Math.min(1, MAX / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement('canvas');
      c.width = Math.round(img.naturalWidth * s);
      c.height = Math.round(img.naturalHeight * s);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      return await createImageBitmap(c);
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

function offline(ch, len, sr) {
  const C = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  return new C(ch, Math.max(1, len), sr);
}

function decodeBlob(blob, sampleRate) {
  return blob.arrayBuffer().then((data) => new Promise((resolve, reject) => {
    const p = offline(1, 1, sampleRate).decodeAudioData(data, resolve, reject);
    if (p && p.then) p.then(resolve, reject);
  }));
}

async function decodeWithMediabunny(e, sampleRate) {
  const sink = new MB.AudioBufferSink(e.aTrack);
  const chunks = [];
  let rate = 0, ch = 1, end = 0;
  for await (const w of sink.buffers()) {
    rate = w.buffer.sampleRate;
    ch = Math.max(ch, Math.min(2, w.buffer.numberOfChannels));
    chunks.push(w);
    end = Math.max(end, w.timestamp - e.firstTs + w.buffer.duration);
  }
  if (!chunks.length) return null;
  const len = Math.ceil(end * rate);
  const ctx = offline(ch, len, rate);
  const whole = ctx.createBuffer(ch, len, rate);
  for (const w of chunks) {
    const off = Math.max(0, Math.round((w.timestamp - e.firstTs) * rate));
    for (let c = 0; c < ch; c++) {
      const src = w.buffer.getChannelData(Math.min(c, w.buffer.numberOfChannels - 1));
      const n = Math.min(src.length, len - off);
      if (n > 0) whole.getChannelData(c).set(src.subarray(0, n), off);
    }
  }
  return resample(whole, sampleRate);
}

async function resample(buf, sampleRate) {
  if (buf.sampleRate === sampleRate) return buf;
  const ctx = offline(buf.numberOfChannels, Math.ceil(buf.duration * sampleRate), sampleRate);
  const s = ctx.createBufferSource();
  s.buffer = buf;
  s.connect(ctx.destination);
  s.start();
  return ctx.startRendering();
}

function toMono(buf) {
  if (buf.numberOfChannels === 1) return buf;
  const ctx = offline(1, buf.length, buf.sampleRate);
  const out = ctx.createBuffer(1, buf.length, buf.sampleRate);
  const o = out.getChannelData(0);
  const C = buf.numberOfChannels;
  for (let c = 0; c < C; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < d.length; i++) o[i] += d[i] / C;
  }
  return out;
}

/** 1秒あたり perSec 個の波形ピーク */
function computePeaks(buf, perSec) {
  const d = buf.getChannelData(0);
  const step = Math.max(1, Math.floor(buf.sampleRate / perSec));
  const n = Math.ceil(d.length / step);
  const out = new Float32Array(n);
  let max = 1e-4;
  for (let i = 0; i < n; i++) {
    let m = 0;
    for (let j = i * step, e = Math.min(d.length, j + step); j < e; j++) { const v = Math.abs(d[j]); if (v > m) m = v; }
    out[i] = m;
    if (m > max) max = m;
  }
  for (let i = 0; i < n; i++) out[i] = Math.sqrt(out[i] / max);
  return out;
}
