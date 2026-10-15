/*
 * MOV / MP4 から AAC 音声トラックだけを取り出す簡易デマルチプレクサ。
 * Safari の decodeAudioData は動画コンテナ（.mov）を直接読めないことがあるため、
 * 音声だけの M4A / ADTS に組み直してからデコードする。
 * ファイル全体をメモリに載せず、必要な部分だけ File.slice で読む。
 */

export class TrackError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const read = async (file, start, len) => new Uint8Array(await file.slice(start, start + len).arrayBuffer());
const u16 = (b, o) => (b[o] << 8) | b[o + 1];
const u32 = (b, o) => ((b[o] << 24) >>> 0) + (b[o + 1] << 16) + (b[o + 2] << 8) + b[o + 3];
const u64 = (b, o) => u32(b, o) * 2 ** 32 + u32(b, o + 4);
const fourcc = (b, o) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);

const TOP_LEVEL = new Set(['ftyp', 'wide', 'free', 'skip', 'mdat', 'moov', 'uuid', 'pnot', 'meta']);

/** buf[start, end) にある子ボックスを列挙 */
function* boxes(b, start, end) {
  let p = start;
  while (p + 8 <= end) {
    let size = u32(b, p);
    const type = fourcc(b, p + 4);
    let hdr = 8;
    if (size === 1) { size = u64(b, p + 8); hdr = 16; } else if (size === 0) size = end - p;
    if (size < hdr || p + size > end) return;
    yield { type, start: p + hdr, end: p + size, boxStart: p };
    p += size;
  }
}

function child(b, parent, type) {
  for (const x of boxes(b, parent.start, parent.end)) if (x.type === type) return x;
  return null;
}

function path(b, parent, ...types) {
  let cur = parent;
  for (const t of types) { cur = cur && child(b, cur, t); }
  return cur;
}

/** 記述子の長さ（可変長）を読む */
function descLen(b, p) {
  let len = 0, n = 0;
  while (n < 4) {
    const c = b[p + n++];
    len = (len << 7) | (c & 0x7f);
    if (!(c & 0x80)) break;
  }
  return { len, n };
}

/** esds の中身から AudioSpecificConfig と objectType を取り出す */
function parseEsds(b, start, end) {
  let p = start + 4; // version/flags
  while (p < end) {
    const tag = b[p];
    const { len, n } = descLen(b, p + 1);
    const body = p + 1 + n;
    if (tag === 0x03) {
      let q = body + 2;
      const flags = b[q++];
      if (flags & 0x80) q += 2;
      if (flags & 0x40) q += 1 + b[q];
      if (flags & 0x20) q += 2;
      p = q; // 中の記述子へ
      continue;
    }
    if (tag === 0x04) {
      const objectType = b[body];
      let q = body + 13;
      while (q < body + len) {
        const t2 = b[q];
        const d2 = descLen(b, q + 1);
        if (t2 === 0x05) return { objectType, asc: b.slice(q + 1 + d2.n, q + 1 + d2.n + d2.len) };
        q += 1 + d2.n + d2.len;
      }
      return { objectType, asc: null };
    }
    p = body + len;
  }
  return null;
}

function findFourcc(b, start, end, cc) {
  for (let i = start; i + 4 <= end; i++) {
    if (b[i] === cc.charCodeAt(0) && b[i + 1] === cc.charCodeAt(1) && b[i + 2] === cc.charCodeAt(2) && b[i + 3] === cc.charCodeAt(3)) return i;
  }
  return -1;
}

const CODEC_NAMES = {
  lpcm: 'リニアPCM', sowt: 'リニアPCM', twos: 'リニアPCM', alac: 'Apple Lossless', 'ac-3': 'ドルビーデジタル', 'ec-3': 'ドルビーデジタルプラス',
  Opus: 'Opus', fLaC: 'FLAC', '.mp3': 'MP3', samr: 'AMR',
};

/**
 * 音声トラックを読み出す。
 * @returns {Promise<{asc: Uint8Array, sizes: Uint32Array, data: Uint8Array, timescale: number,
 *   stts: number[][], sampleRate: number, channels: number, duration: number}>}
 */
export async function extractAudioTrack(file) {
  // トップレベルを走査して moov を探す（mdat は読み飛ばす）
  let pos = 0, moov = null, first = true;
  while (pos + 8 <= file.size) {
    const h = await read(file, pos, 16);
    let size = u32(h, 0);
    const type = fourcc(h, 4);
    if (first && !TOP_LEVEL.has(type)) throw new TrackError('not-mp4', 'MP4/MOV形式ではありません');
    first = false;
    if (size === 1) size = u64(h, 8); else if (size === 0) size = file.size - pos;
    if (size < 8) break;
    if (type === 'moov') { moov = await read(file, pos, size); break; }
    pos += size;
  }
  if (!moov) throw new TrackError('not-mp4', 'MP4/MOV形式ではありません');

  const root = { start: 8, end: moov.length };
  let codec = null;
  for (const trak of boxes(moov, root.start, root.end)) {
    if (trak.type !== 'trak') continue;
    const mdia = child(moov, trak, 'mdia');
    const hdlr = mdia && child(moov, mdia, 'hdlr');
    if (!hdlr || fourcc(moov, hdlr.start + 8) !== 'soun') continue;

    const mdhd = child(moov, mdia, 'mdhd');
    const v = moov[mdhd.start];
    const timescale = v === 1 ? u32(moov, mdhd.start + 20) : u32(moov, mdhd.start + 12);

    const stbl = path(moov, mdia, 'minf', 'stbl');
    const stsd = child(moov, stbl, 'stsd');
    const entry = boxes(moov, stsd.start + 8, stsd.end).next().value;
    if (!entry) continue;
    codec = entry.type;
    if (entry.type !== 'mp4a') continue;

    const esdsAt = findFourcc(moov, entry.start, entry.end, 'esds');
    if (esdsAt < 0) continue;
    const esdsEnd = esdsAt - 4 + u32(moov, esdsAt - 4);
    const es = parseEsds(moov, esdsAt + 4, esdsEnd);
    if (!es || !es.asc || es.objectType !== 0x40) { codec = 'mp4a(非AAC)'; continue; }

    // サンプルテーブル
    const stsz = child(moov, stbl, 'stsz');
    const fixed = u32(moov, stsz.start + 4);
    const count = u32(moov, stsz.start + 8);
    const sizes = new Uint32Array(count);
    for (let i = 0; i < count; i++) sizes[i] = fixed || u32(moov, stsz.start + 12 + i * 4);

    const stco = child(moov, stbl, 'stco');
    const co64 = child(moov, stbl, 'co64');
    const chunkBox = stco || co64;
    const nChunks = u32(moov, chunkBox.start + 4);
    const chunkOff = new Float64Array(nChunks);
    for (let i = 0; i < nChunks; i++) {
      chunkOff[i] = stco ? u32(moov, chunkBox.start + 8 + i * 4) : u64(moov, chunkBox.start + 8 + i * 8);
    }

    const stsc = child(moov, stbl, 'stsc');
    const nStsc = u32(moov, stsc.start + 4);
    const stscE = [];
    for (let i = 0; i < nStsc; i++) {
      const o = stsc.start + 8 + i * 12;
      stscE.push([u32(moov, o), u32(moov, o + 4)]);
    }

    const offsets = new Float64Array(count);
    let si = 0;
    for (let c = 0, e = 0; c < nChunks && si < count; c++) {
      while (e + 1 < stscE.length && stscE[e + 1][0] <= c + 1) e++;
      let off = chunkOff[c];
      for (let k = 0; k < stscE[e][1] && si < count; k++, si++) {
        offsets[si] = off;
        off += sizes[si];
      }
    }

    const stts = [];
    const sttsBox = child(moov, stbl, 'stts');
    const nStts = u32(moov, sttsBox.start + 4);
    let totalTicks = 0;
    for (let i = 0; i < nStts; i++) {
      const o = sttsBox.start + 8 + i * 8;
      const n = u32(moov, o), d = u32(moov, o + 4);
      stts.push([n, d]);
      totalTicks += n * d;
    }

    // サンプル本体を読む（大きめの窓で順番に読み、動画データ部分は捨てる）
    const total = sizes.reduce((a, b) => a + b, 0);
    const data = new Uint8Array(total);
    const WIN = 8 * 1024 * 1024;
    let winStart = -1, win = null;
    for (let i = 0, w = 0; i < count; i++) {
      const off = offsets[i], len = sizes[i];
      if (!win || off < winStart || off + len > winStart + win.length) {
        winStart = off;
        win = await read(file, off, Math.max(WIN, len));
        if (win.length < len) throw new TrackError('broken', 'ファイルが途中で切れています');
      }
      data.set(win.subarray(off - winStart, off - winStart + len), w);
      w += len;
    }

    const info = parseAsc(es.asc);
    return {
      asc: es.asc,
      sizes,
      data,
      timescale,
      stts,
      sampleRate: info.sampleRate,
      channels: info.channels,
      duration: totalTicks / timescale,
    };
  }
  if (codec === null) throw new TrackError('no-audio', '音声トラックが入っていません');
  throw new TrackError('codec', `対応していない音声形式です（${CODEC_NAMES[codec] || codec}）`);
}

const SAMPLE_RATES = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];

function parseAsc(asc) {
  const aot = asc[0] >> 3;
  const sfi = ((asc[0] & 7) << 1) | (asc[1] >> 7);
  const ch = (asc[1] >> 3) & 0xf;
  return { aot, sfi, sampleRate: SAMPLE_RATES[sfi] || 44100, channels: ch || 2 };
}

/* ---------- 書き出し ---------- */

class Writer {
  constructor() { this.parts = []; }
  box(type, fn) {
    const w = new Writer();
    fn(w);
    const body = w.bytes();
    const out = new Uint8Array(8 + body.length);
    new DataView(out.buffer).setUint32(0, out.length);
    for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
    out.set(body, 8);
    this.parts.push(out);
  }
  u8(...v) { this.parts.push(Uint8Array.from(v)); }
  u16(v) { this.u8(v >> 8, v & 0xff); }
  u32(v) { const a = new Uint8Array(4); new DataView(a.buffer).setUint32(0, v >>> 0); this.parts.push(a); }
  str(s) { this.u8(...[...s].map((c) => c.charCodeAt(0))); }
  zeros(n) { this.parts.push(new Uint8Array(n)); }
  raw(a) { this.parts.push(a); }
  bytes() {
    const n = this.parts.reduce((s, p) => s + p.length, 0);
    const out = new Uint8Array(n);
    let o = 0;
    for (const p of this.parts) { out.set(p, o); o += p.length; }
    return out;
  }
}

const MATRIX = [0x10000, 0, 0, 0, 0x10000, 0, 0, 0, 0x40000000];

/** 指定範囲のサンプル（AACフレーム）だけを切り出す。start/end は秒。 */
export function sliceTrack(t, start = 0, end = Infinity) {
  if (start <= 0 && end >= t.duration) return t;
  const times = [];
  let tick = 0;
  for (const [n, d] of t.stts) for (let k = 0; k < n; k++) { times.push([tick, d]); tick += d; }
  const s0 = start * t.timescale, e0 = end * t.timescale;
  let a = times.findIndex(([tt, d]) => tt + d > s0);
  if (a < 0) a = times.length;
  let b = a;
  while (b < times.length && times[b][0] < e0) b++;
  let off = 0;
  for (let i = 0; i < a; i++) off += t.sizes[i];
  let len = 0;
  for (let i = a; i < b; i++) len += t.sizes[i];
  const stts = [];
  for (let i = a; i < b; i++) {
    const d = times[i][1];
    if (stts.length && stts[stts.length - 1][1] === d) stts[stts.length - 1][0]++;
    else stts.push([1, d]);
  }
  const ticks = stts.reduce((s, [n, d]) => s + n * d, 0);
  return { ...t, sizes: t.sizes.slice(a, b), data: t.data.subarray(off, off + len), stts, duration: ticks / t.timescale };
}

/** 音声だけの M4A（再エンコードなし）を作る */
export function buildM4a(t) {
  const n = t.sizes.length;
  const ticks = t.stts.reduce((s, [c, d]) => s + c * d, 0);

  const esds = (w) => {
    w.u32(0);
    const dsi = t.asc;
    const dcd = 13 + 2 + dsi.length;
    const esd = 3 + 2 + dcd + 3;
    w.u8(0x03, esd); w.u16(1); w.u8(0);
    w.u8(0x04, dcd, 0x40, 0x15); w.u8(0, 0, 0); w.u32(0); w.u32(0);
    w.u8(0x05, dsi.length); w.raw(dsi);
    w.u8(0x06, 1, 0x02);
  };

  const moov = new Writer();
  moov.box('moov', (m) => {
    m.box('mvhd', (w) => {
      w.u32(0); w.u32(0); w.u32(0); w.u32(t.timescale); w.u32(ticks);
      w.u32(0x10000); w.u16(0x100); w.zeros(10);
      MATRIX.forEach((v) => w.u32(v));
      w.zeros(24); w.u32(2);
    });
    m.box('trak', (tr) => {
      tr.box('tkhd', (w) => {
        w.u32(7); w.u32(0); w.u32(0); w.u32(1); w.u32(0); w.u32(ticks);
        w.zeros(8); w.u16(0); w.u16(0); w.u16(0x100); w.u16(0);
        MATRIX.forEach((v) => w.u32(v));
        w.u32(0); w.u32(0);
      });
      tr.box('mdia', (md) => {
        md.box('mdhd', (w) => { w.u32(0); w.u32(0); w.u32(0); w.u32(t.timescale); w.u32(ticks); w.u16(0x55c4); w.u16(0); });
        md.box('hdlr', (w) => { w.u32(0); w.u32(0); w.str('soun'); w.zeros(12); w.str('SoundHandler'); w.u8(0); });
        md.box('minf', (mi) => {
          mi.box('smhd', (w) => { w.u32(0); w.u32(0); });
          mi.box('dinf', (di) => di.box('dref', (w) => { w.u32(0); w.u32(1); w.box('url ', (u) => u.u32(1)); }));
          mi.box('stbl', (st) => {
            st.box('stsd', (w) => {
              w.u32(0); w.u32(1);
              w.box('mp4a', (a) => {
                a.zeros(6); a.u16(1);
                a.u16(0); a.u16(0); a.u32(0);
                a.u16(Math.min(2, t.channels)); a.u16(16); a.u16(0); a.u16(0);
                a.u32((t.sampleRate & 0xffff) * 0x10000);
                a.box('esds', esds);
              });
            });
            st.box('stts', (w) => { w.u32(0); w.u32(t.stts.length); for (const [c, d] of t.stts) { w.u32(c); w.u32(d); } });
            st.box('stsc', (w) => { w.u32(0); w.u32(1); w.u32(1); w.u32(n); w.u32(1); });
            st.box('stsz', (w) => { w.u32(0); w.u32(0); w.u32(n); for (const s of t.sizes) w.u32(s); });
            st.box('stco', (w) => { w.u32(0); w.u32(1); w.u32(0); /* 後で書き換え */ });
          });
        });
      });
    });
  });
  const moovBytes = moov.bytes();

  const ftyp = new Writer();
  ftyp.box('ftyp', (w) => { w.str('M4A '); w.u32(0); w.str('M4A '); w.str('mp42'); w.str('isom'); });
  const ftypBytes = ftyp.bytes();

  // stco の値 = mdat の中身の位置
  const dataStart = ftypBytes.length + moovBytes.length + 8;
  const stcoAt = findFourcc(moovBytes, 0, moovBytes.length, 'stco');
  new DataView(moovBytes.buffer).setUint32(stcoAt + 12, dataStart);

  const mdatHdr = new Uint8Array(8);
  new DataView(mdatHdr.buffer).setUint32(0, 8 + t.data.length);
  mdatHdr.set([0x6d, 0x64, 0x61, 0x74], 4);
  return new Blob([ftypBytes, moovBytes, mdatHdr, t.data], { type: 'audio/mp4' });
}

/** ADTS 形式の AAC（.aac）を作る */
export function buildAdts(t) {
  const { aot, sfi } = parseAsc(t.asc);
  const ch = Math.min(7, t.channels);
  const profile = (aot === 1 || aot === 2 || aot === 3 || aot === 4 ? aot : 2) - 1;
  const out = new Uint8Array(t.data.length + 7 * t.sizes.length);
  let p = 0, q = 0;
  for (const size of t.sizes) {
    const len = size + 7;
    out[p] = 0xff;
    out[p + 1] = 0xf1;
    out[p + 2] = (profile << 6) | (sfi << 2) | (ch >> 2);
    out[p + 3] = ((ch & 3) << 6) | (len >> 11);
    out[p + 4] = (len >> 3) & 0xff;
    out[p + 5] = ((len & 7) << 5) | 0x1f;
    out[p + 6] = 0xfc;
    out.set(t.data.subarray(q, q + size), p + 7);
    p += len;
    q += size;
  }
  return new Blob([out], { type: 'audio/aac' });
}
