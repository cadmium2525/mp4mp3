/*
 * かなでる：WAV の書き出し（16bit / 24bit / 32bit float）。
 */
export function encodeWav(L, R, sr, bits = 24) {
  const n = L.length, ch = 2, bps = bits / 8;
  const data = n * ch * bps;
  const buf = new ArrayBuffer(44 + data);
  const v = new DataView(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + data, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, bits === 32 ? 3 : 1, true); v.setUint16(22, ch, true);
  v.setUint32(24, sr, true); v.setUint32(28, sr * ch * bps, true); v.setUint16(32, ch * bps, true); v.setUint16(34, bits, true);
  str(36, 'data'); v.setUint32(40, data, true);
  let o = 44;
  // 量子化ノイズを目立たなくするための弱いディザ（16bit のみ）
  let seed = 1;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  for (let i = 0; i < n; i++) {
    for (const x of [L[i], R[i]]) {
      const s = Math.max(-1, Math.min(1, x));
      if (bits === 16) { v.setInt16(o, Math.max(-32768, Math.min(32767, Math.round(s * 32767 + (rnd() - rnd())))), true); }
      else if (bits === 24) { const q = Math.round(s * 8388607); v.setUint8(o, q & 255); v.setUint8(o + 1, (q >> 8) & 255); v.setUint8(o + 2, (q >> 16) & 255); }
      else v.setFloat32(o, s, true);
      o += bps;
    }
  }
  return new Uint8Array(buf);
}
