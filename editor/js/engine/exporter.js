/*
 * 書き出し：フレームを1枚ずつ描画して WebCodecs でエンコードし、MP4 にまとめる。
 * iPhone（Safari）では H.264 + AAC、対応していない環境では VP9/AV1 + Opus になる。
 */
import * as MB from '../../lib/mediabunny.min.mjs';
import { layoutClips, projectDuration, activeClipsAt, mediaTime, overlayEnd } from './project.js';
import { loadCutout } from './cutout.js';
import { drawFrame, loadFonts } from './render.js';
import { mixdown } from './audio.js';

export const QUALITIES = {
  standard: { label: '標準', bitrate: MB.QUALITY_MEDIUM },
  high: { label: '高画質', bitrate: MB.QUALITY_HIGH },
  max: { label: '最高画質', bitrate: MB.QUALITY_VERY_HIGH },
};

/** 出力解像度（長辺ではなく短辺で指定：1080 → 1080p） */
export function outputSize(project, shortSide) {
  const s = Math.min(1, shortSide / Math.min(project.width, project.height));
  const even = (v) => Math.max(2, Math.round(v / 2) * 2);
  return { width: even(project.width * s), height: even(project.height * s) };
}

export async function supportedCodecs(width, height) {
  const video = await MB.getFirstEncodableVideoCodec(['avc', 'hevc', 'vp9', 'av1'], { width, height });
  const audio = await MB.getFirstEncodableAudioCodec(['aac', 'opus']);
  return { video, audio };
}

/**
 * @param {object} project
 * @param {import('./media.js').MediaLibrary} lib
 * @param {{shortSide?: number, fps?: number, quality?: string, onProgress?: (p: number, label: string) => void, signal?: AbortSignal}} opts
 * @returns {Promise<{blob: Blob, codec: string, audioCodec: string|null, width: number, height: number}>}
 */
export async function exportVideo(project, lib, opts = {}) {
  const { shortSide = 1080, quality = 'high', onProgress = () => {}, signal } = opts;
  const fps = opts.fps || project.fps || 30;
  const { width, height } = outputSize(project, shortSide);
  const proj = { ...project, width, height };
  const layout = layoutClips(proj);
  const total = projectDuration(proj, layout);
  if (total <= 0) throw new Error('タイムラインが空です');

  const codecs = await supportedCodecs(width, height);
  if (!codecs.video) throw new Error('この端末のブラウザは動画の書き出しに対応していません（iOS 16.4 以降の Safari が必要です）');

  await loadFonts(proj);
  onProgress(0, '準備中…');
  // 切り抜き用の AI モデルを先に読み込む
  const modes = new Set([...proj.clips, ...(proj.overlays || [])].map((x) => x.cutout?.mode).filter(Boolean));
  for (const m of modes) {
    onProgress(0, '切り抜きの準備中…');
    await loadCutout(m === 'object' ? 'object' : m === 'chroma' ? 'chroma' : 'person');
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { alpha: false });

  const output = new MB.Output({
    format: new MB.Mp4OutputFormat({ fastStart: 'in-memory' }),
    target: new MB.BufferTarget(),
  });
  const videoSource = new MB.CanvasSource(canvas, {
    codec: codecs.video,
    bitrate: (QUALITIES[quality] || QUALITIES.high).bitrate,
    keyFrameInterval: 2,
  });
  output.addVideoTrack(videoSource, { frameRate: fps });
  let audioSource = null;
  if (codecs.audio) {
    audioSource = new MB.AudioBufferSource({ codec: codecs.audio, bitrate: MB.QUALITY_HIGH });
    output.addAudioTrack(audioSource);
  }
  await output.start();

  try {
    // 音声：使う素材をデコードしてミックス
    if (audioSource) {
      onProgress(0, '音声を準備中…');
      const ids = new Set();
      for (const L of layout) if (L.clip.volume > 0) ids.add(L.clip.media);
      for (const o of proj.overlays || []) if (o.volume > 0) ids.add(o.media);
      for (const a of proj.audios) if (a.volume > 0) ids.add(a.media);
      const bufs = new Map();
      for (const id of ids) {
        if (signal?.aborted) throw new DOMException('中止しました', 'AbortError');
        bufs.set(id, await lib.decodeAudio(id, 48000).catch(() => null));
      }
      const mixed = await mixdown(proj, layout, (id) => bufs.get(id) || null, 48000);
      bufs.clear();
      await audioSource.add(mixed);
      audioSource.close();
    }

    // 映像：クリップごとに必要なフレームの時刻を先に並べておくと、デコードが1回で済む
    const frames = Math.max(1, Math.round(total * fps));
    const stamps = new Map();
    for (let k = 0; k < frames; k++) {
      const t = k / fps;
      for (const it of activeClipsAt(layout, t)) {
        const id = it.L.clip.id;
        if (!stamps.has(id)) stamps.set(id, []);
        stamps.get(id).push(mediaTime(it.L, t));
      }
      for (const o of activeOverlays(proj, t)) {
        if (!stamps.has(o.id)) stamps.set(o.id, []);
        stamps.get(o.id).push(overlayTime(o, t));
      }
    }
    const readers = new Map();
    for (const L of layout) {
      if (stamps.has(L.clip.id)) readers.set(L.clip.id, lib.frameReader(L.clip.media, stamps.get(L.clip.id), width, height));
    }
    for (const o of proj.overlays || []) {
      if (stamps.has(o.id)) readers.set(o.id, lib.frameReader(o.media, stamps.get(o.id), width, height));
    }

    for (let k = 0; k < frames; k++) {
      if (signal?.aborted) throw new DOMException('中止しました', 'AbortError');
      const t = k / fps;
      const srcs = new Map();
      for (const it of activeClipsAt(layout, t)) {
        srcs.set(it.L.clip.id, await readers.get(it.L.clip.id).next());
      }
      for (const o of activeOverlays(proj, t)) srcs.set(o.id, await readers.get(o.id).next());
      drawFrame(ctx, proj, layout, t, (L) => srcs.get(L.clip.id));
      await videoSource.add(t, 1 / fps);
      if (k % 5 === 0) onProgress(k / frames, `書き出し中… ${Math.round((k / frames) * 100)}%`);
    }
    for (const r of readers.values()) r.close();
    videoSource.close();
    onProgress(1, '仕上げ中…');
    await output.finalize();
  } catch (err) {
    await output.cancel().catch(() => {});
    throw err;
  }

  const blob = new Blob([output.target.buffer], { type: 'video/mp4' });
  return { blob, codec: codecs.video, audioCodec: codecs.audio, width, height, duration: total };
}

const activeOverlays = (p, t) => (p.overlays || []).filter((o) => t >= o.start && t < overlayEnd(o));
const overlayTime = (o, t) => Math.min(o.out, o.in + (t - o.start) * (o.speed || 1));
