/*
 * かなでる：MP3 への変換（lamejs）。lamejs が通常のスクリプトなので、別のワーカーにしている。
 */
'use strict';
importScripts('../../lib/lame.min.js');

self.onmessage = (e) => {
  const { id, L, R, sr, bitrate = 256 } = e.data;
  try {
    const enc = new lamejs.Mp3Encoder(2, sr, bitrate);
    const block = 1152 * 32, n = L.length;
    const l = new Int16Array(block), r = new Int16Array(block);
    const parts = [];
    const push = (buf) => { if (buf.length) parts.push(new Uint8Array(buf.buffer, buf.byteOffset, buf.length).slice()); };
    const toI = (src, dst, off, len) => { for (let i = 0; i < len; i++) { let v = src[off + i]; v = v > 1 ? 1 : v < -1 ? -1 : v; dst[i] = v < 0 ? v * 0x8000 : v * 0x7fff; } };
    for (let i = 0; i < n; i += block) {
      const len = Math.min(block, n - i);
      toI(L, l, i, len); toI(R, r, i, len);
      push(enc.encodeBuffer(l.subarray(0, len), r.subarray(0, len)));
      self.postMessage({ type: 'progress', id, p: (i + len) / n });
    }
    push(enc.flush());
    self.postMessage({ type: 'done', id, blob: new Blob(parts, { type: 'audio/mpeg' }) });
  } catch (err) {
    self.postMessage({ type: 'error', id, message: err.message || String(err) });
  }
};
