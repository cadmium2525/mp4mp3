/*
 * おとだけ — 音声処理ワーカー
 * 解析（ラウドネス・ピーク・波形）、加工（トリム・無音カット・音量統一・リミッター・フェード）、
 * エンコード（MP3 / WAV）をメインスレッドの外で行う。
 */
'use strict';
importScripts('../lib/lame.min.js');

let joined = []; // 結合モードで溜めておく加工済み音声（[ [Float32Array, ...], ... ]）

self.onmessage = (e) => {
  const m = e.data;
  try {
    switch (m.type) {
      case 'analyze': return analyze(m);
      case 'process': return processOne(m);
      case 'finishJoin': return finishJoin(m);
      case 'reset': joined = []; return post({ type: 'done', id: m.id });
    }
  } catch (err) {
    post({ type: 'error', id: m.id, message: (err && err.message) || String(err) });
  }
};

function post(msg, transfer) {
  self.postMessage(msg, transfer || []);
}

/* ---------- 解析 ---------- */

function analyze({ id, channels, sampleRate, bins }) {
  const lufs = integratedLoudness(channels, sampleRate);
  const peakDb = toDb(samplePeak(channels));
  const peaks = waveformPeaks(channels, bins || 300);
  post({ type: 'done', id, lufs, peakDb, peaks }, [peaks.buffer]);
}

function waveformPeaks(chs, bins) {
  const n = chs[0].length;
  const out = new Float32Array(bins);
  const step = n / bins;
  for (let b = 0; b < bins; b++) {
    const s = Math.floor(b * step), e = Math.min(n, Math.floor((b + 1) * step));
    let m = 0;
    for (const ch of chs) {
      for (let i = s; i < e; i++) {
        const v = ch[i] < 0 ? -ch[i] : ch[i];
        if (v > m) m = v;
      }
    }
    out[b] = m;
  }
  return out;
}

/* ---------- 加工 ---------- */

function processOne({ id, channels, sampleRate: sr, opts }) {
  const progress = (stage, value) => post({ type: 'progress', id, stage, value });

  let chs = convertChannels(channels, opts.channels);
  chs = trimRange(chs, sr, opts.trimStart, opts.trimEnd);
  if (opts.silence) chs = trimSilence(chs, sr, opts.silenceDb);
  if (chs[0].length < sr * 0.05) throw new Error('トリミング後の音声が短すぎます');

  progress('analyze', 0);
  const stats = applyLoudness(chs, sr, opts);
  stats.duration = chs[0].length / sr;

  if (opts.join) {
    // 継ぎ目のプチノイズ防止に極短フェードだけかけて溜めておく
    fade(chs, sr, 0.005, 0.005);
    joined.push(chs);
    return post({ type: 'done', id, stats });
  }

  fade(chs, sr, opts.fadeIn, opts.fadeOut);
  const blob = encode(chs, sr, opts, (v) => progress('encode', v));
  post({ type: 'done', id, blob, stats });
}

function finishJoin({ id, opts, sampleRate: sr }) {
  if (!joined.length) throw new Error('結合する音声がありません');
  const C = joined[0].length;
  const total = joined.reduce((s, chs) => s + chs[0].length, 0);
  const out = [];
  for (let c = 0; c < C; c++) {
    const buf = new Float32Array(total);
    let off = 0;
    for (const chs of joined) { buf.set(chs[c], off); off += chs[c].length; }
    out.push(buf);
  }
  joined = [];
  fade(out, sr, opts.fadeIn, opts.fadeOut);
  const stats = { duration: total / sr, lufsOut: integratedLoudness(out, sr) };
  const blob = encode(out, sr, opts, (v) => post({ type: 'progress', id, stage: 'encode', value: v }));
  post({ type: 'done', id, blob, stats });
}

function convertChannels(chs, mode) {
  if (mode === 1 || mode === '1') {
    if (chs.length === 1) return [chs[0]];
    const a = chs[0], b = chs[1];
    for (let i = 0; i < a.length; i++) a[i] = (a[i] + b[i]) * 0.5;
    return [a];
  }
  if (mode === 2 || mode === '2') {
    // 同じ配列を共有すると音量処理が二重にかかるので必ず複製する
    return chs.length === 1 ? [chs[0], chs[0].slice()] : [chs[0], chs[1]];
  }
  return chs.length >= 2 ? [chs[0], chs[1]] : [chs[0]];
}

function trimRange(chs, sr, start, end) {
  const n = chs[0].length;
  const s = Math.max(0, Math.min(n, Math.round((start || 0) * sr)));
  const e = end == null ? n : Math.max(s, Math.min(n, Math.round(end * sr)));
  if (s === 0 && e === n) return chs;
  return chs.map((ch) => ch.subarray(s, e));
}

function trimSilence(chs, sr, thDb) {
  const th = Math.pow(10, thDb / 20);
  const n = chs[0].length;
  const loud = (i) => chs.some((ch) => Math.abs(ch[i]) > th);
  let s = 0;
  while (s < n && !loud(s)) s++;
  if (s >= n) return chs.map((ch) => ch.subarray(0, 0));
  let e = n - 1;
  while (e > s && !loud(e)) e--;
  const pad = Math.round(sr * 0.15);
  s = Math.max(0, s - pad);
  e = Math.min(n, e + 1 + pad);
  return chs.map((ch) => ch.subarray(s, e));
}

function applyLoudness(chs, sr, opts) {
  const lufsIn = integratedLoudness(chs, sr);
  const peakIn = samplePeak(chs);
  const stats = { lufsIn, peakIn: toDb(peakIn), gainDb: 0 };
  if (opts.normMode === 'off') { stats.lufsOut = lufsIn; return stats; }

  let gainDb = 0;
  if (opts.normMode === 'lufs' && isFinite(lufsIn)) gainDb = opts.lufsTarget - lufsIn;
  if (opts.normMode === 'peak' && peakIn > 0) gainDb = opts.peakTarget - toDb(peakIn);
  gainDb = Math.max(-60, Math.min(opts.maxGain, gainDb));
  stats.capped = gainDb >= opts.maxGain;
  stats.gainDb = gainDb;

  const g = Math.pow(10, gainDb / 20);
  if (g !== 1) for (const ch of chs) for (let i = 0; i < ch.length; i++) ch[i] *= g;
  if (opts.normMode === 'lufs') {
    const ceil = Math.pow(10, opts.ceiling / 20);
    stats.limited = limiter(chs, sr, ceil);
  }
  stats.lufsOut = integratedLoudness(chs, sr);
  return stats;
}

/*
 * 先読みリミッター（サンプルピーク基準）。
 * 必要ゲインの区間最小値 → 移動平均 → リリース平滑化の順で、ピーク位置では必ず ceil 以下になる。
 * 追加メモリは Float32Array 1本分のみ。
 */
function limiter(chs, sr, ceil) {
  const n = chs[0].length;
  const g = new Float32Array(n);
  let any = false;
  for (let i = 0; i < n; i++) {
    let a = 0;
    for (const ch of chs) { const v = ch[i] < 0 ? -ch[i] : ch[i]; if (v > a) a = v; }
    if (a > ceil) { g[i] = ceil / a; any = true; } else g[i] = 1;
  }
  if (!any) return false;

  const L = Math.max(1, Math.round(sr * 0.005));
  // 区間 [i, i+L-1] の最小値をリングバッファの単調deque で求め、g[i] に上書き
  const cap = L + 1, dqI = new Int32Array(cap), dqV = new Float32Array(cap);
  let head = 0, size = 0;
  for (let j = 0; j < n + L - 1; j++) {
    const v = j < n ? g[j] : 1;
    while (size > 0 && dqV[(head + size - 1) % cap] >= v) size--;
    const t = (head + size) % cap;
    dqI[t] = j; dqV[t] = v; size++;
    const i = j - L + 1;
    if (i >= 0) {
      while (dqI[head] < i) { head = (head + 1) % cap; size--; }
      g[i] = dqV[head];
    }
  }
  // 移動平均（長さL）＋ リリース 80ms
  // 先頭より前は g[0]（= 先頭 L サンプルの最小値）で埋めて、冒頭のピークも確実に抑える
  const ring = new Float32Array(L).fill(g[0]);
  let sum = L * g[0], rp = 0, env = g[0];
  const rel = 1 - Math.exp(-1 / (sr * 0.08));
  for (let i = 0; i < n; i++) {
    const mv = g[i];
    sum += mv - ring[rp];
    ring[rp] = mv;
    rp = (rp + 1) % L;
    let t = sum / L;
    if (t > 1) t = 1;
    env = t < env ? t : env + (t - env) * rel;
    if (env < 1) for (const ch of chs) ch[i] *= env;
  }
  return true;
}

function fade(chs, sr, inSec, outSec) {
  const n = chs[0].length;
  const fi = Math.min(n, Math.round((inSec || 0) * sr));
  const fo = Math.min(n, Math.round((outSec || 0) * sr));
  for (const ch of chs) {
    for (let i = 0; i < fi; i++) ch[i] *= Math.sin((i / fi) * Math.PI / 2) ** 2;
    for (let i = 0; i < fo; i++) ch[n - 1 - i] *= Math.sin((i / fo) * Math.PI / 2) ** 2;
  }
}

/* ---------- ラウドネス（ITU-R BS.1770 / EBU R128 準拠の積分ラウドネス） ---------- */

function kWeighting(fs) {
  // 高域シェルフ
  let f0 = 1681.974450955533, G = 3.999843853973347, Q = 0.7071752369554196;
  let K = Math.tan(Math.PI * f0 / fs);
  const Vh = Math.pow(10, G / 20), Vb = Math.pow(Vh, 0.4996667741545416);
  let a0 = 1 + K / Q + K * K;
  const s1 = {
    b0: (Vh + Vb * K / Q + K * K) / a0, b1: 2 * (K * K - Vh) / a0, b2: (Vh - Vb * K / Q + K * K) / a0,
    a1: 2 * (K * K - 1) / a0, a2: (1 - K / Q + K * K) / a0,
  };
  // 低域カット
  f0 = 38.13547087602444; Q = 0.5003270373238773;
  K = Math.tan(Math.PI * f0 / fs);
  a0 = 1 + K / Q + K * K;
  const s2 = { b0: 1, b1: -2, b2: 1, a1: 2 * (K * K - 1) / a0, a2: (1 - K / Q + K * K) / a0 };
  return [s1, s2];
}

function integratedLoudness(chs, fs) {
  const [s1, s2] = kWeighting(fs);
  const n = chs[0].length;
  const seg = Math.max(1, Math.round(fs * 0.1)); // 100ms 単位（400msブロック・75%重複）
  const nSeg = Math.max(1, Math.ceil(n / seg));
  const segPow = new Float64Array(nSeg);
  const segLen = new Float64Array(nSeg);

  for (const x of chs.slice(0, 2)) {
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0, z1 = 0, z2 = 0;
    for (let k = 0; k < nSeg; k++) {
      const end = Math.min(n, (k + 1) * seg);
      let acc = 0;
      for (let i = k * seg; i < end; i++) {
        const xi = x[i];
        const y = s1.b0 * xi + s1.b1 * x1 + s1.b2 * x2 - s1.a1 * y1 - s1.a2 * y2;
        x2 = x1; x1 = xi;
        const z = s2.b0 * y + s2.b1 * y1 + s2.b2 * y2 - s2.a1 * z1 - s2.a2 * z2;
        y2 = y1; y1 = y;
        z2 = z1; z1 = z;
        acc += z * z;
      }
      segPow[k] += acc;
      segLen[k] = end - k * seg;
    }
  }

  const blocks = [];
  if (nSeg < 4) {
    let p = 0, l = 0;
    for (let k = 0; k < nSeg; k++) { p += segPow[k]; l += segLen[k]; }
    blocks.push(p / l);
  } else {
    for (let k = 0; k + 3 < nSeg; k++) {
      const p = segPow[k] + segPow[k + 1] + segPow[k + 2] + segPow[k + 3];
      const l = segLen[k] + segLen[k + 1] + segLen[k + 2] + segLen[k + 3];
      blocks.push(p / l);
    }
  }
  const lk = (z) => -0.691 + 10 * Math.log10(z);
  const abs = blocks.filter((z) => z > 0 && lk(z) > -70);
  if (!abs.length) return -Infinity;
  const rel = lk(abs.reduce((a, b) => a + b, 0) / abs.length) - 10;
  const gated = abs.filter((z) => lk(z) > rel);
  if (!gated.length) return -Infinity;
  return lk(gated.reduce((a, b) => a + b, 0) / gated.length);
}

function samplePeak(chs) {
  let m = 0;
  for (const ch of chs) for (let i = 0; i < ch.length; i++) { const v = ch[i] < 0 ? -ch[i] : ch[i]; if (v > m) m = v; }
  return m;
}

function toDb(v) { return v > 0 ? 20 * Math.log10(v) : -Infinity; }

/* ---------- エンコード ---------- */

function encode(chs, sr, opts, onProgress) {
  return opts.format === 'wav' ? encodeWav(chs, sr) : encodeMp3(chs, sr, opts, onProgress);
}

function toInt16(src, dst, off, len) {
  for (let i = 0; i < len; i++) {
    let v = src[off + i];
    v = v > 1 ? 1 : v < -1 ? -1 : v;
    dst[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
  }
}

function encodeMp3(chs, sr, opts, onProgress) {
  const C = chs.length, n = chs[0].length;
  const enc = new lamejs.Mp3Encoder(C, sr, opts.bitrate);
  const block = 1152 * 32;
  const l = new Int16Array(block), r = new Int16Array(block);
  const parts = [];
  const tag = id3(opts.tags);
  if (tag) parts.push(tag);
  const push = (buf) => {
    if (!buf.length) return;
    const u = new Uint8Array(buf.length);
    u.set(new Uint8Array(buf.buffer, buf.byteOffset, buf.length));
    parts.push(u);
  };
  let last = 0;
  for (let i = 0; i < n; i += block) {
    const len = Math.min(block, n - i);
    toInt16(chs[0], l, i, len);
    if (C === 2) {
      toInt16(chs[1], r, i, len);
      push(enc.encodeBuffer(l.subarray(0, len), r.subarray(0, len)));
    } else {
      push(enc.encodeBuffer(l.subarray(0, len)));
    }
    const p = (i + len) / n;
    if (p - last > 0.02) { onProgress(p); last = p; }
  }
  push(enc.flush());
  onProgress(1);
  return new Blob(parts, { type: 'audio/mpeg' });
}

function encodeWav(chs, sr) {
  const C = chs.length, n = chs[0].length;
  const dataLen = n * C * 2;
  const buf = new ArrayBuffer(44 + dataLen);
  const v = new DataView(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + dataLen, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, C, true);
  v.setUint32(24, sr, true); v.setUint32(28, sr * C * 2, true); v.setUint16(32, C * 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, dataLen, true);
  const out = new Int16Array(buf, 44);
  for (let i = 0, k = 0; i < n; i++) {
    for (let c = 0; c < C; c++, k++) {
      let s = chs[c][i];
      s = s > 1 ? 1 : s < -1 ? -1 : s;
      out[k] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
  }
  return new Blob([buf], { type: 'audio/wav' });
}

/* ID3v2.3 タグ（タイトル・アーティスト・アルバム、UTF-16 で日本語対応） */
function id3(tags) {
  if (!tags) return null;
  const frames = [];
  for (const [fid, val] of [['TIT2', tags.title], ['TPE1', tags.artist], ['TALB', tags.album]]) {
    if (!val) continue;
    const body = new Uint8Array(3 + val.length * 2);
    body[0] = 1; body[1] = 0xff; body[2] = 0xfe; // UTF-16 + BOM(LE)
    for (let i = 0; i < val.length; i++) {
      const c = val.charCodeAt(i);
      body[3 + i * 2] = c & 0xff; body[4 + i * 2] = c >> 8;
    }
    const f = new Uint8Array(10 + body.length);
    for (let i = 0; i < 4; i++) f[i] = fid.charCodeAt(i);
    new DataView(f.buffer).setUint32(4, body.length);
    f.set(body, 10);
    frames.push(f);
  }
  if (!frames.length) return null;
  const size = frames.reduce((s, f) => s + f.length, 0);
  const out = new Uint8Array(10 + size);
  out.set([0x49, 0x44, 0x33, 3, 0, 0], 0);
  out[6] = (size >> 21) & 0x7f; out[7] = (size >> 14) & 0x7f; out[8] = (size >> 7) & 0x7f; out[9] = size & 0x7f;
  let o = 10;
  for (const f of frames) { out.set(f, o); o += f.length; }
  return out;
}
