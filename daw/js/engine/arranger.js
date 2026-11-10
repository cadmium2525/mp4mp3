/*
 * かなでる：自動アレンジ・おまかせ作曲。
 *
 *  - 和音トラック  song.chords = [[拍, "Am7"], [4, "Fmaj7"], ...]
 *  - 自動クリップ  clip.gen = { type: chords / arp / bass / drums / melody, ...つまみ, seed }
 *      → trackNotes() が和音トラックを見て、その場で音符に展開する（同じ JSON からは毎回同じ音符）
 *  - compose(opts)        スタイルを選ぶだけで 1 曲ぶんの JSON を作る
 *  - fitToLength(song, 秒) 動画の長さぴったりに合わせる
 *  - bake(song)           自動クリップをふつうの音符に変換する（ピアノロールで直せるように）
 *
 * ブラウザ（ワーカー）でも Node でも動くよう、DOM にも音の描画にも頼らない。乱数はすべてシード付き。
 */
import { rng, hashSeed, noteValue, clamp, midiToName } from './dsp.js';

/* ====================================================================== */
/*  音楽理論の部品（和音記号・調・音階）                                    */
/* ====================================================================== */

const PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const mod12 = (x) => ((x % 12) + 12) % 12;

function pcOf(name) {
  const m = /^([A-Ga-g])([#b♯♭]*)$/.exec(String(name).trim());
  if (!m) return null;
  let v = PC[m[1].toUpperCase()];
  for (const c of m[2]) v += c === '#' || c === '♯' ? 1 : -1;
  return mod12(v);
}

// 和音の種類 → ルートからの半音（dsp.js の CHORDS に、よく使う書き方を足したもの）
const QUAL = {
  '': [0, 4, 7], M: [0, 4, 7], m: [0, 3, 7], dim: [0, 3, 6], aug: [0, 4, 8], '+': [0, 4, 8],
  sus2: [0, 2, 7], sus4: [0, 5, 7], sus: [0, 5, 7], 5: [0, 7], 2: [0, 4, 7, 14], 4: [0, 5, 7],
  6: [0, 4, 7, 9], m6: [0, 3, 7, 9], 7: [0, 4, 7, 10], M7: [0, 4, 7, 11], m7: [0, 3, 7, 10], mM7: [0, 3, 7, 11],
  m7b5: [0, 3, 6, 10], dim7: [0, 3, 6, 9], '7sus4': [0, 5, 7, 10], '7sus': [0, 5, 7, 10], '7sus2': [0, 2, 7, 10],
  add9: [0, 4, 7, 14], add2: [0, 4, 7, 14], madd9: [0, 3, 7, 14], add4: [0, 4, 5, 7], add11: [0, 4, 7, 17], madd11: [0, 3, 7, 17],
  9: [0, 4, 7, 10, 14], M9: [0, 4, 7, 11, 14], m9: [0, 3, 7, 10, 14], mM9: [0, 3, 7, 11, 14], '9sus4': [0, 5, 7, 10, 14],
  11: [0, 4, 7, 10, 14, 17], m11: [0, 3, 7, 10, 14, 17], 13: [0, 4, 7, 10, 14, 21], M13: [0, 4, 7, 11, 14, 21], m13: [0, 3, 7, 10, 14, 21],
  '7b9': [0, 4, 7, 10, 13], '7#9': [0, 4, 7, 10, 15], '7b5': [0, 4, 6, 10], '7#5': [0, 4, 8, 10], aug7: [0, 4, 8, 10],
  '7#11': [0, 4, 7, 10, 18], '7b13': [0, 4, 7, 10, 20], 'M7#11': [0, 4, 7, 11, 18], 'M7#5': [0, 4, 8, 11],
  69: [0, 4, 7, 9, 14], '6/9': [0, 4, 7, 9, 14], m69: [0, 3, 7, 9, 14], 'm6/9': [0, 3, 7, 9, 14],
};

/** 和音の種類の書き方をそろえる（maj7 → M7、min7 → m7、Δ → M7、ø → m7b5 など） */
function normQual(q) {
  let s = String(q).replace(/[()\s]/g, '');
  s = s.replace(/♭/g, 'b').replace(/♯/g, '#').replace(/Δ7?|△7?/g, 'M7').replace(/ø7?/g, 'm7b5').replace(/°/g, 'dim').replace(/^-/, 'm');
  s = s.replace(/^major/i, 'M').replace(/^minor/i, 'm').replace(/^maj/i, 'M').replace(/^min/, 'm').replace(/^mi(?=\d|$)/, 'm');
  s = s.replace(/^mmaj/i, 'mM').replace(/^mM$/, 'mM7');
  if (s === 'M' || s === 'maj') return '';
  return s;
}

const chordCache = new Map();

/**
 * 和音記号を読む。"Am7" "Fmaj7" "C/E" "Bb6/9" など（":3" のオクターブは付けない）。
 * 戻り値 { sym, root, bass, iv: ルートからの半音, pcs: 構成音（ルートが先頭）, minor, q }。読めなければ例外。
 */
export function parseChord(sym) {
  const key = String(sym).trim();
  const hit = chordCache.get(key);
  if (hit) return hit;
  const m = /^([A-G][#b♯♭]?)(.*)$/.exec(key);
  if (!m) throw new Error(`和音記号が読めません: ${sym}`);
  let rest = m[2], bass = null;
  // 分数コード（"6/9" の / は分母が音名ではないので区別できる）
  const sl = /^(.*)\/([A-G][#b♯♭]?)$/.exec(rest);
  if (sl) { rest = sl[1]; bass = pcOf(sl[2]); }
  const q = normQual(rest);
  if (!(q in QUAL)) throw new Error(`和音記号が読めません: ${sym}（使える種類：${Object.keys(QUAL).filter(Boolean).join(' ')}）`);
  const root = pcOf(m[1]);
  const iv = QUAL[q];
  const pcs = [...new Set(iv.map((i) => mod12(root + i)))];
  const out = { sym: key, root, bass: bass ?? root, slash: bass != null && bass !== root, iv, pcs, minor: iv.includes(3) && !iv.includes(4), q };
  chordCache.set(key, out);
  return out;
}

/** 和音記号を半音ずらす（flat: ♭で書く） */
export function transposeChord(sym, semis, flat = false) {
  const names = flat ? FLAT : SHARP;
  return String(sym).replace(/(^|\/)([A-G][#b]?)/g, (_, pre, n) => pre + names[mod12(pcOf(n) + semis)]);
}

// 音階（主音からの半音）
export const SCALES = {
  major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10], harmonic: [0, 2, 3, 5, 7, 8, 11], melodic: [0, 2, 3, 5, 7, 9, 11],
  dorian: [0, 2, 3, 5, 7, 9, 10], phrygian: [0, 1, 3, 5, 7, 8, 10], lydian: [0, 2, 4, 6, 7, 9, 11], mixolydian: [0, 2, 4, 5, 7, 9, 10], locrian: [0, 1, 3, 5, 6, 8, 10],
  pentatonic: [0, 2, 4, 7, 9], 'minor pentatonic': [0, 3, 5, 7, 10], blues: [0, 3, 5, 6, 7, 10],
  yo: [0, 2, 5, 7, 9], in: [0, 1, 5, 7, 8], ryukyu: [0, 4, 5, 7, 11], yonanuki: [0, 2, 4, 7, 9], 'yonanuki minor': [0, 2, 3, 7, 8], hirajoshi: [0, 2, 3, 7, 8],
  wholetone: [0, 2, 4, 6, 8, 10],
};
const SCALE_ALIAS = {
  '': 'major', maj: 'major', ionian: 'major', 'メジャー': 'major', '長調': 'major', m: 'minor', min: 'minor', aeolian: 'minor', 'natural minor': 'minor', 'マイナー': 'minor', '短調': 'minor',
  'harmonic minor': 'harmonic', 'melodic minor': 'melodic', 'major pentatonic': 'pentatonic', penta: 'pentatonic', 'ペンタトニック': 'pentatonic', 'minor penta': 'minor pentatonic',
  '陽': 'yo', '陽音階': 'yo', '陽旋法': 'yo', '陰': 'in', '陰音階': 'in', '陰旋法': 'in', '都節': 'in', miyakobushi: 'in', '琉球': 'ryukyu', '琉球音階': 'ryukyu', okinawa: 'ryukyu',
  'ヨナ抜き': 'yonanuki', 'ヨナ抜き長音階': 'yonanuki', 'ヨナ抜き短音階': 'yonanuki minor', '平調子': 'hirajoshi', 'whole tone': 'wholetone',
};
export const SCALE_LABEL = {
  major: 'メジャー（長調）', minor: 'マイナー（短調）', harmonic: 'ハーモニックマイナー', melodic: 'メロディックマイナー', dorian: 'ドリアン', phrygian: 'フリジアン', lydian: 'リディアン', mixolydian: 'ミクソリディアン', locrian: 'ロクリアン',
  pentatonic: 'ペンタトニック', 'minor pentatonic': 'マイナーペンタ', blues: 'ブルース', yo: '陽音階（和風・明るい）', in: '陰音階（和風・暗い）', ryukyu: '琉球音階', yonanuki: 'ヨナ抜き長音階', 'yonanuki minor': 'ヨナ抜き短音階', hirajoshi: '平調子', wholetone: '全音音階',
};

/**
 * 調・音階を読む。"A minor" "C major" "D dorian" "E yo" "C 琉球" "Am"、または音名の配列（先頭が主音）。
 * 読めなければ null。戻り値 { root, name, iv, pcs, minor, text }
 */
export function parseKey(spec) {
  if (spec == null) return null;
  if (Array.isArray(spec)) {
    const p = spec.map((x) => (typeof x === 'number' ? mod12(x) : pcOf(x)));
    if (!p.length || p.some((x) => x == null)) return null;
    const iv = [...new Set(p.map((x) => mod12(x - p[0])))].sort((a, b) => a - b);
    return mkKey(p[0], 'custom', iv);
  }
  const m = /^\s*([A-Ga-g][#b♯♭]?)\s*(.*)$/.exec(String(spec));
  if (!m) return null;
  const root = pcOf(m[1][0].toUpperCase() + m[1].slice(1));
  let name = m[2].trim().replace(/[（）()]/g, ' ').replace(/scale|音階$/i, (x) => (x === '音階' ? '音階' : '')).trim().replace(/\s+/g, ' ');
  const low = name.toLowerCase();
  name = SCALES[low] ? low : SCALE_ALIAS[low] ?? SCALE_ALIAS[name] ?? null;
  if (!name) return null;
  return mkKey(root, name, SCALES[name]);
}
function mkKey(root, name, iv) {
  return { root, name, iv, pcs: iv.map((i) => mod12(root + i)), minor: iv.includes(3) && !iv.includes(4), text: `${SHARP[root]} ${name}` };
}

/** 和音の並びを取り出す（拍の順、読めない記号は例外） */
export function chordList(song) {
  const src = Array.isArray(song?.chords) ? song.chords : [];
  const out = [];
  for (const c of src) {
    const t = Array.isArray(c) ? Number(c[0]) : Number(c?.t ?? c?.at);
    const sym = Array.isArray(c) ? c[1] : c?.chord ?? c?.sym;
    if (!Number.isFinite(t) || sym == null || sym === '') continue;
    out.push({ t, sym: String(sym), ch: parseChord(sym) });
  }
  out.sort((a, b) => a.t - b.t);
  return out;
}

/** 曲の調（scale → key → 最初の和音から推定 → C major） */
export function songKey(song) {
  const k = parseKey(song?.scale) || parseKey(song?.key);
  if (k) return k;
  try {
    const first = chordList(song)[0];
    if (first) return mkKey(first.ch.root, first.ch.minor ? 'minor' : 'major', SCALES[first.ch.minor ? 'minor' : 'major']);
  } catch { /* 和音が読めないときは下へ */ }
  return mkKey(0, 'major', SCALES.major);
}

/** 拍 t で鳴っている和音（和音トラックの最初より前は最初の和音） */
export function chordAt(song, t) {
  const list = chordList(song);
  let cur = list[0] || null;
  for (const c of list) { if (c.t <= t + 1e-6) cur = c; else break; }
  return cur ? cur.sym : null;
}

/** 範囲 [a, b) を和音ごとの区間に分ける（時刻は a からの相対） */
function segments(list, a, b, fallback) {
  const out = [];
  let cur = list.length ? list[0] : { ch: fallback };
  let t = a;
  for (const c of list) {
    if (c.t <= a + 1e-6) { cur = c; continue; }
    if (c.t >= b - 1e-6) break;
    out.push({ t0: t - a, t1: c.t - a, ch: cur.ch });
    cur = c; t = c.t;
  }
  out.push({ t0: t - a, t1: b - a, ch: cur.ch });
  return out.filter((s) => s.t1 - s.t0 > 1e-6);
}

/** その和音の上で使える音階（調の音階を、調の外の構成音に合わせて直す。E7 on C major → G を G# に） */
function chordScale(scalePcs, ch) {
  const set = new Set(scalePcs);
  for (const ct of ch.pcs) {
    if (set.has(ct)) continue;
    for (const nb of [mod12(ct + 1), mod12(ct - 1)]) if (!ch.pcs.includes(nb)) set.delete(nb);
    set.add(ct);
  }
  return set;
}

/** 音階の上を n 段動く（p が音階の外なら、その向きで最初の音階の音が 1 段目） */
function stepScale(p, n, set) {
  const dir = n < 0 ? -1 : 1;
  let q = p;
  for (let k = 0; k < Math.abs(n); k++) {
    let guard = 0;
    do { q += dir; } while (!set.has(mod12(q)) && ++guard < 12);
  }
  return q;
}

/** p にいちばん近い構成音（dir: 同じ距離ならこの向きを優先、skip: この高さは選ばない） */
function nearTone(p, pcs, dir = 0, skip = null) {
  for (let d = 0; d <= 12; d++) {
    const order = dir < 0 ? [p - d, p + d] : [p + d, p - d];
    for (const q of order) if (q !== skip && pcs.includes(mod12(q))) return q;
  }
  return p;
}

/** 音域 [lo, hi] の中で、near にいちばん近い「音名 pc の音」 */
function placePc(pc, lo, hi, near) {
  let best = null;
  for (let m = lo; m <= hi; m++) if (mod12(m) === pc && (best == null || Math.abs(m - near) < Math.abs(best - near))) best = m;
  if (best == null) { best = lo + mod12(pc - lo); }
  return best;
}

const midiOf = (v, def) => {
  if (v == null) return def;
  if (typeof v === 'number') return v;
  const m = /^([A-Ga-g][#b]?)(-?\d+)$/.exec(String(v).trim());
  return m ? pcOf(m[1][0].toUpperCase() + m[1].slice(1)) + (Number(m[2]) + 1) * 12 : def;
};

/* ====================================================================== */
/*  ボイシング（和音の積み方）と、なめらかな声部進行                        */
/* ====================================================================== */

/** 鳴らす構成音を選ぶ（多すぎるときは 5度 → ルート → 高いテンションの順に省く） */
function pickTones(ch, opt, keyPcs) {
  let iv = [...new Set(ch.iv.map((i) => i % 12))];
  const has7 = iv.some((i) => i === 10 || i === 11 || i === 9);
  if (opt.tensions && iv.length <= 4 && !iv.includes(2) && !iv.includes(1) && ch.q !== '5') {
    // 9th を足す（調の音で、3度とぶつからないときだけ）
    const nine = mod12(ch.root + 2);
    if (keyPcs.includes(nine) && (iv.includes(3) || iv.includes(4))) iv.push(2);
  }
  if (opt.voicing === 'shell') {
    const third = iv.find((i) => i === 3 || i === 4 || i === 5 || i === 2);
    const sev = iv.find((i) => i === 10 || i === 11) ?? iv.find((i) => i === 9);
    const ext = iv.find((i) => i === 2 && third !== 2);
    iv = has7 && sev != null ? [third, sev, ...(ext != null && (opt.maxNotes ?? 4) > 2 ? [ext] : [])].filter((x) => x != null) : iv;
  }
  const max = Math.max(2, opt.maxNotes ?? 4);
  const drop = [7, 0, 9, 5, 2];
  for (const d of drop) {
    if (iv.length <= max) break;
    if (d === 0 && !has7) continue;
    if (d === 5 && !iv.includes(4) && !iv.includes(3)) continue; // sus4 の 4度は残す
    if (d === 2 && !iv.includes(4) && !iv.includes(3)) continue;
    if (iv.includes(d)) iv = iv.filter((x) => x !== d);
  }
  while (iv.length > max) iv.pop();
  return iv.map((i) => mod12(ch.root + i));
}

/** 密集で積んだ和音を、指定の積み方に変える */
function spread(close, kind) {
  const v = close.slice();
  if (v.length < 3) return v;
  if (kind === 'open') { const b = v.splice(1, 1)[0]; v.push(b + 12); }
  else if (kind === 'drop2') { const b = v.splice(v.length - 2, 1)[0]; v.unshift(b - 12); }
  else if (kind === 'wide') { const b = v.splice(1, 1)[0]; v.push(b + 12); v[0] -= 12; }
  return v.sort((a, b) => a - b);
}

/**
 * 和音をボイシングする。prev（直前のボイシング）があれば、動きがいちばん小さい転回形を選ぶ。
 * opt: { voicing: close/open/drop2/shell/wide/guitar, register: 中心の音, maxNotes, tensions }
 */
export function voiceChord(chord, opt = {}, prev = null, keyPcs = SCALES.major) {
  const ch = typeof chord === 'string' ? parseChord(chord) : chord;
  const center = midiOf(opt.register, 60);
  if (opt.voicing === 'guitar') {
    // ギターの押さえ方ふう：ルート・5度・ルート・3度・5度
    const r0 = placePc(ch.root, 40, 51, 45);
    const third = ch.iv.find((i) => i === 3 || i === 4 || i === 5 || i === 2) ?? 7;
    const fifth = ch.iv.find((i) => i === 7 || i === 6 || i === 8) ?? 7;
    const sev = ch.iv.find((i) => i === 10 || i === 11 || i === 9);
    const v = [r0, r0 + fifth, sev != null ? r0 + sev : r0 + 12, r0 + 12 + third, r0 + 12 + fifth];
    if (ch.iv.some((i) => i % 12 === 2 && i > 12)) v[4] = r0 + 26;
    return v.slice(0, Math.max(3, opt.maxNotes ?? 5));
  }
  const pcs = pickTones(ch, opt, keyPcs);
  const cands = [];
  for (let k = 0; k < pcs.length; k++) {
    // k 番目の音を最低音にした密集の形
    const rot = pcs.slice(k).concat(pcs.slice(0, k));
    const base = [];
    let p = 48 + rot[0];
    for (const pc of rot) { while (mod12(p) !== pc) p++; base.push(p); }
    const shaped = spread(base, opt.voicing || 'close');
    for (let o = -2; o <= 2; o++) {
      const v = shaped.map((x) => x + 12 * o);
      const mean = v.reduce((a, b) => a + b, 0) / v.length;
      if (Math.abs(mean - center) > 8) continue;
      cands.push(v);
    }
  }
  if (!cands.length) return pcs.map((pc) => placePc(pc, center - 6, center + 6, center)).sort((a, b) => a - b);
  let best = null, bestCost = Infinity;
  for (const v of cands) {
    const mean = v.reduce((a, b) => a + b, 0) / v.length;
    let cost = Math.abs(mean - center) * (prev ? 0.35 : 1);
    if (v[0] < 50 && v.length > 1 && v[1] - v[0] < 4) cost += 4; // 低いところで音が詰まると濁る
    if (v[0] < 40) cost += 6;
    if (prev) {
      for (const x of v) cost += Math.min(...prev.map((y) => Math.abs(x - y)));
      for (const y of prev) cost += Math.min(...v.map((x) => Math.abs(x - y))) * 0.5;
      cost += Math.abs(v[v.length - 1] - prev[prev.length - 1]) * 0.6; // いちばん上の音はとくに動かさない
    } else if (mod12(v[0]) !== ch.root) cost += 0.8; // 最初は基本形を少し優先
    if (cost < bestCost - 1e-9) { best = v; bestCost = cost; }
  }
  return best;
}

/* ====================================================================== */
/*  自動クリップ（gen）の展開                                              */
/* ====================================================================== */

const HITV = { X: 1, x: 0.8, o: 0.55, g: 0.35 };

/** スウィング：裏拍（unit の奇数番目）を後ろにずらす */
function swung(t, unit, amt) {
  if (!amt) return t;
  const k = Math.round(t / unit);
  return Math.abs(t - k * unit) < 1e-6 && k % 2 === 1 ? t + amt * unit : t;
}

const seedOf = (g, salt) => hashSeed(`${salt}:${g.seed ?? 1}`) % 1000003;
const pick = (r, arr) => arr[Math.min(arr.length - 1, Math.floor(r() * arr.length))];

/* ---------------- 伴奏（chords） ---------------- */

const STAB = ['x..x..x...x.x...', 'x..x..x.x..x..x.', 'x.....x..x....x.', '..x..x....x..x..', 'x..x....x.x..x..'];
const FUNK = ['x.gx.gx.g.xg.x.g', 'g.xg.x.gx.g.x.xg', 'x..xg.x.g.x.gx..', '.gx.gxg.x.gx.g.x'];
const STRUM = ['D.DU.UDU', 'D.D.DUDU', 'D..UDUDU', 'D.DUDUDU', 'D...D.DU'];
const BOSSA = [[0, 1.5, 3], [1, 2.5]];
const CHARL = [[[0, 1.4], [1.5, 0.45]], [[1.5, 0.45], [3, 0.9]], [[0, 0.9], [2.5, 0.45]], [[0.5, 0.45], [2, 1.4]], [[0, 1.4], [1.5, 0.45], [3.5, 0.45]]];

function genChords(cx, g) {
  const out = [];
  const r = rng(seedOf(g, 'ch'));
  const style = g.style || 'pad';
  const vel = g.vel ?? 0.6;
  const opt = { voicing: g.voicing || (style === 'strum' ? 'guitar' : 'close'), register: g.register, maxNotes: g.maxNotes ?? (style === 'strum' ? 5 : 4), tensions: !!g.tensions };
  // 区間ごとのボイシング（前の和音からいちばん近い形）
  let prev = null;
  const voic = cx.segs.map((s) => (prev = voiceChord(s.ch, opt, opt.voicing === 'guitar' || g.lead === false ? null : prev, cx.key.pcs)));
  // 左手のルート：分散和音はいつも最低音をルートにする。root: true なら、ほかの弾き方でも下にルートを足す（ベースがいない場面用）
  const broken = style === 'ballad' || style === 'arp-comp';
  if (opt.voicing !== 'guitar' && g.root !== false && (broken || g.root)) {
    voic.forEach((v, k) => {
      const b = cx.segs[k].ch.bass;
      if (mod12(v[0]) === b) { if (!broken) v.unshift(v[0] - 12); return; }
      const low = placePc(b, v[0] - 11, v[0] - 1, v[0] - 6);
      const rest = broken ? v.filter((p) => mod12(p) !== b || v.length <= 3) : v;
      voic[k] = [low, ...rest];
    });
  }
  const segAt = (t) => { let k = 0; while (k < cx.segs.length - 1 && t >= cx.segs[k].t1 - 1e-6) k++; return k; };
  const hit = (t, d, v, sel = null, strum = 0) => {
    if (t < 0 || t >= cx.len - 1e-6) return;
    const k = segAt(t);
    let ps = voic[k];
    if (sel === 'top') ps = ps.slice(Math.max(1, ps.length - 3));
    else if (sel === 'low') ps = ps.slice(0, 1);
    else if (typeof sel === 'number') ps = [ps[Math.min(ps.length - 1, sel)]];
    const end = Math.min(cx.len, g.cut === false ? cx.len : cx.segs[k].t1);
    const order = strum < 0 ? ps.slice().reverse() : ps;
    order.forEach((p, i) => {
      const tt = t + i * Math.abs(strum);
      out.push({ t: tt, n: p, d: Math.max(0.05, Math.min(d, end - tt)), v: clamp(v * (1 + (r() - 0.5) * 0.06), 0.05, 1) });
    });
  };
  const bars = Math.ceil(cx.len / cx.bpb - 1e-6);
  const sw = g.swing ?? 0, su = noteValue(g.swingUnit || '1/16');
  const variant = Math.floor(r() * 97);
  const grid16 = (pats, d, sel) => {
    for (let b = 0; b < bars; b++) {
      const pat = pats[(variant + (b % 2 ? Math.floor(variant / 7) + 1 : 0)) % pats.length];
      const steps = Math.round(cx.bpb * 4);
      for (let k = 0; k < steps; k++) {
        const c = pat[k % pat.length];
        if (c === '.') continue;
        const ghost = c === 'g';
        hit(swung(b * cx.bpb + k * 0.25, su, sw), ghost ? 0.12 : d, vel * (ghost ? 0.5 : k % 4 === 0 ? 1.08 : 0.95), ghost ? 'top' : sel);
      }
    }
  };
  switch (style) {
    case 'pad': case 'whole': case 'half': {
      const chunk = style === 'whole' ? cx.bpb : style === 'half' ? cx.bpb / 2 : (g.hold ?? 4) * cx.bpb;
      for (const s of cx.segs) {
        // 小節線にそろえて弾き直す
        let t = s.t0;
        while (t < s.t1 - 1e-6) {
          const abs = cx.at + t;
          const next = Math.min(s.t1, (Math.floor(abs / chunk + 1e-6) + 1) * chunk - cx.at);
          hit(t, (next - t) * (g.gate ?? 1), vel);
          t = next;
        }
      }
      break;
    }
    case 'quarters':
      for (let t = 0; t < cx.len - 1e-6; t += 1) hit(t, 0.9 * (g.gate ?? 1), vel * ((t % cx.bpb) === 0 ? 1.1 : 0.92));
      break;
    case 'piano8':
      for (let t = 0; t < cx.len - 1e-6; t += 0.5) {
        const on = Math.abs(t % 1) < 1e-6;
        hit(swung(t, 0.5, g.swingUnit === '1/8' ? sw : 0), 0.45 * (g.gate ?? 1), vel * (on ? ((t % cx.bpb) === 0 ? 1.12 : 1) : 0.72), on ? null : 'top');
      }
      break;
    case 'stab': grid16(g.pattern ? [g.pattern] : STAB, 0.3 * (g.gate ?? 1)); break;
    case 'funk': grid16(g.pattern ? [g.pattern] : FUNK, 0.2 * (g.gate ?? 1), 'top'); break;
    case 'offbeat':
      for (let t = 0.5; t < cx.len - 1e-6; t += 1) hit(t, 0.4 * (g.gate ?? 1), vel);
      break;
    case 'lazy':
      // ローファイのエレピ：頭で長く、3 拍目の裏の手前でもう一度
      for (let b = 0; b < bars; b++) { hit(b * cx.bpb, 2.5, vel); hit(swung(b * cx.bpb + 2.75, su, sw), 1.1, vel * 0.72); }
      break;
    case 'charleston':
      for (let b = 0; b < bars; b++) {
        const pat = CHARL[(variant + b * 3 + (b % 4 === 3 ? 1 : 0)) % CHARL.length];
        for (const [t, d] of pat) hit(swung(b * cx.bpb + t, 0.5, sw || 0.33), d, vel * (t === 0 ? 1.05 : 0.9));
      }
      break;
    case 'bossa':
      for (let b = 0; b < bars; b++) for (const t of BOSSA[b % 2]) hit(b * cx.bpb + t, t % 1 ? 0.45 : 0.9, vel * (t === 0 ? 1.05 : 0.92));
      break;
    case 'ballad':
      // 分散和音：最低音を伸ばし、上の音を 8 分で行き来する（ペダルを踏んだように残す）
      for (const s of cx.segs) {
        let t = s.t0;
        while (t < s.t1 - 1e-6) {
          const abs = cx.at + t;
          const end = Math.min(s.t1, (Math.floor(abs / cx.bpb + 1e-6) + 1) * cx.bpb - cx.at);
          const n = voic[segAt(t)].length;
          const seq = n >= 4 ? [0, 1, 2, 3, 2, 1, 2, 3] : [0, 1, 2, 1, 2, 1, 2, 1];
          let k = 0;
          for (let u = t; u < end - 1e-6; u += 0.5, k++) {
            const idx = seq[k % seq.length];
            hit(u, Math.min(end - u, k === 0 ? end - t : 2), vel * (k === 0 ? 1.05 : k % 2 ? 0.74 : 0.86), idx);
          }
          t = end;
        }
      }
      break;
    case 'arp-comp':
      // 低・高・中・高（アルベルティ・バスふう）
      for (let t = 0, k = 0; t < cx.len - 1e-6; t += 0.5, k++) {
        const n = voic[segAt(t)].length;
        const seq = [0, n - 1, Math.max(1, n - 2), n - 1];
        hit(swung(t, 0.5, g.swingUnit === '1/8' ? sw : 0), 0.5 * (g.gate ?? 0.95), vel * (k % 2 ? 0.78 : k % 4 === 0 ? 1.05 : 0.9), seq[Math.round((t % cx.bpb) * 2) % 4]);
      }
      break;
    case 'strum': {
      const stroke = ((g.strum ?? 0.016) * cx.bpm) / 60; // 秒 → 拍
      for (let b = 0; b < bars; b++) {
        const pat = g.pattern || STRUM[(variant + (b % 4 === 3 ? 1 : 0)) % STRUM.length];
        const steps = Math.round(cx.bpb * 2);
        for (let k = 0; k < steps; k++) {
          const c = pat[k % pat.length];
          if (c === '.') continue;
          let nx = k + 1;
          while (nx < steps && pat[nx % pat.length] === '.') nx++;
          const t = swung(b * cx.bpb + k * 0.5, 0.5, g.swingUnit === '1/8' ? sw : 0);
          if (c === 'D') hit(t, (nx - k) * 0.5 * 0.96, vel * (k % 4 === 0 ? 1.1 : 0.92), null, stroke);
          else hit(t, (nx - k) * 0.5 * 0.9, vel * 0.7, 'top', -stroke);
        }
      }
      break;
    }
    default: throw new Error(`伴奏のスタイル「${style}」はありません（${GEN_INFO.chords.styles.map((s) => s[0]).join(', ')}）`);
  }
  return out;
}

/* ---------------- アルペジオ（arp） ---------------- */

function arpOrder(n, pattern, r) {
  const up = Array.from({ length: n }, (_, i) => i);
  switch (pattern) {
    case 'down': return up.reverse();
    case 'updown': return n > 2 ? up.concat(up.slice(1, -1).reverse()) : up;
    case 'downup': { const d = up.slice().reverse(); return n > 2 ? d.concat(d.slice(1, -1).reverse()) : d; }
    case 'converge': { const o = []; for (let i = 0, j = n - 1; i <= j; i++, j--) { o.push(i); if (j !== i) o.push(j); } return o; }
    case 'thirds': { const o = []; for (let i = 0; i < n; i++) { o.push(i); if (i + 2 < n) o.push(i + 2); } return o; }
    case 'random': { const o = []; let last = -1; for (let i = 0; i < 16; i++) { let k; do { k = Math.floor(r() * n); } while (k === last && n > 1); o.push(k); last = k; } return o; }
    default: return up; // up / as-played
  }
}

function genArp(cx, g) {
  const out = [];
  const r = rng(seedOf(g, 'arp'));
  const rate = noteValue(g.rate || '1/8');
  const oct = clamp(Math.round(g.octaves ?? 1), 1, 4);
  const gate = g.gate ?? 0.8;
  const vel = g.vel ?? 0.6;
  const sw = g.swing ?? 0;
  const acc = typeof g.accent === 'string' && g.accent.length ? g.accent : null;
  const opt = { voicing: g.voicing || 'close', register: g.register ?? 64, maxNotes: g.maxNotes ?? 4, tensions: !!g.tensions };
  let prev = null;
  const tones = cx.segs.map((s) => {
    let v;
    if (g.pattern === 'as-played') {
      // 和音記号の順（ルート・3度・5度…）にそのまま積む
      const root = placePc(s.ch.root, midiOf(opt.register, 64) - 9, midiOf(opt.register, 64) + 3, midiOf(opt.register, 64) - 4);
      v = [...new Set(s.ch.iv)].slice(0, opt.maxNotes).map((i) => root + i);
    } else v = prev = voiceChord(s.ch, opt, prev, cx.key.pcs);
    const all = [];
    for (let o = 0; o < oct; o++) for (const p of v) all.push(p + 12 * o);
    return g.pattern === 'as-played' ? all : all.sort((a, b) => a - b);
  });
  const orders = tones.map((t) => arpOrder(t.length, g.pattern || 'up', r));
  let seg = 0, idx = 0;
  const steps = Math.ceil(cx.len / rate - 1e-6);
  for (let k = 0; k < steps; k++) {
    const t = k * rate;
    while (seg < cx.segs.length - 1 && t >= cx.segs[seg].t1 - 1e-6) { seg++; idx = 0; }
    if (g.restart === 'bar' && Math.abs((cx.at + t) % cx.bpb) < 1e-6) idx = 0;
    const ord = orders[seg];
    const p = tones[seg][ord[idx % ord.length]];
    idx++;
    const c = acc ? acc[k % acc.length] : null;
    if (c === '.' || c === '-') continue;
    const onBeat = Math.abs(t % 1) < 1e-6;
    const a = c ? HITV[c] ?? 0.8 : onBeat ? (Math.abs((cx.at + t) % cx.bpb) < 1e-6 ? 1 : 0.88) : 0.7;
    out.push({ t: swung(t, rate, rate <= 0.5 ? sw : 0), n: p, d: Math.max(0.05, rate * gate), v: clamp(vel * (c ? a / 0.8 : a) * (1 + (r() - 0.5) * 0.06), 0.05, 1) });
  }
  return out;
}

/* ---------------- ベース（bass） ---------------- */

const BASS_SYNCO = ['R..R..R...R.R...', 'R.....R.R...R.5.', 'R..R....R..R..o.', 'R.R...R..R..R.5.', 'R..R..R.R.....R.'];
const BASS_FUNK = ['R..R.go.R..R.g5.', 'R.gR..o.g.R.R.o.', 'R...g.RoR..g..5.', 'R.R.g.o.R.gR.o5.'];
const BASS_808 = ['R.......R..R....', 'R.....R.....R.R.', 'R..R......R.....', 'R.........R..R.5', 'R.......R.....R.'];

function genBass(cx, g) {
  const out = [];
  const r = rng(seedOf(g, 'bass'));
  const style = g.style || 'root';
  const lo = midiOf(g.lo, 31), hi = Math.max(lo + 12, midiOf(g.hi, 50));
  const vel = g.vel ?? 0.8;
  const appr = g.approach ?? 0.5;
  const chrom = g.chromatic ?? (style === 'walking' ? 0.5 : 0);
  const sw = g.swing ?? 0, su = noteValue(g.swingUnit || (style === 'walking' ? '1/8' : '1/16'));
  const push = (t, n, d, v) => { if (t >= -1e-6 && t < cx.len - 1e-6) out.push({ t: swung(Math.max(0, t), su, sw), n: clamp(n, 21, 72), d: Math.max(0.05, Math.min(d, cx.len - t)), v: clamp(v * vel * (1 + (r() - 0.5) * 0.06), 0.05, 1) }); };
  const center = lo + 7;
  const rootOf = (ch, near = center) => placePc(ch.bass, lo, hi, near);
  // ルートの次に使う音：ふつうは 5 度。分数コード（C/E）は、低音から見た和音のルート
  const fifthOf = (ch) => (ch.slash ? mod12(ch.root - ch.bass) : ch.iv.find((i) => i === 7 || i === 6 || i === 8) ?? 7);
  // 区間のルート（前のルートから近い高さに置く）
  let last = center;
  const roots = cx.segs.map((s) => (last = rootOf(s.ch, (last + center) / 2)));
  const nextRoot = (k) => (k + 1 < cx.segs.length ? roots[k + 1] : cx.next ? rootOf(cx.next, roots[k]) : null);
  /** 次のルートへ向かう音（半音・音階の隣・5度下） */
  const approachTo = (target, from, k) => {
    const set = chordScale(cx.key.pcs, cx.segs[k].ch);
    const x = r();
    let p;
    if (x < chrom) p = from <= target ? target - 1 : target + 1;
    else if (x < chrom + (1 - chrom) * 0.7) p = from <= target ? stepScale(target, -1, set) : stepScale(target, 1, set);
    else p = target - 5 >= lo ? target - 5 : target + 7;
    if (p < lo) p += 12;
    if (p > hi + 2) p -= 12;
    return p;
  };
  const bars = Math.ceil(cx.len / cx.bpb - 1e-6);
  const segIdx = (t) => { let k = 0; while (k < cx.segs.length - 1 && t >= cx.segs[k].t1 - 1e-6) k++; return k; };
  /** 区間を小節線で切った「かたまり」ごとに fn(開始, 終了, 区間番号, 区間の最後か) */
  const chunks = (fn) => cx.segs.forEach((s, k) => {
    let t = s.t0;
    while (t < s.t1 - 1e-6) {
      const end = Math.min(s.t1, (Math.floor((cx.at + t) / cx.bpb + 1e-6) + 1) * cx.bpb - cx.at);
      fn(t, end, k, end >= s.t1 - 1e-6);
      t = end;
    }
  });
  const grid = (pats, sustain) => {
    const variant = Math.floor(r() * 97);
    for (let b = 0; b < bars; b++) {
      const pat = g.pattern || pats[(variant + (b % 2 ? Math.floor(variant / 5) + 1 : 0) + (b % 4 === 3 ? 2 : 0)) % pats.length];
      const steps = Math.round(cx.bpb * 4);
      for (let k = 0; k < steps; k++) {
        const c = pat[k % pat.length];
        if (c === '.') continue;
        const t = b * cx.bpb + k * 0.25;
        if (t >= cx.len - 1e-6) break;
        const si = segIdx(t), root = roots[si], ch = cx.segs[si].ch;
        let nx = k + 1;
        while (nx < steps && pat[nx % pat.length] === '.') nx++;
        const gap = (nx - k) * 0.25;
        const nr = nextRoot(si);
        const lastOfSeg = t + gap >= cx.segs[si].t1 - 1e-6;
        if (c === 'R') push(t, root, sustain ? gap * 0.98 : Math.min(gap * 0.9, 1), k === 0 ? 1 : 0.9);
        else if (c === 'o') push(t, root + 12 <= hi + 5 ? root + 12 : root, 0.2, 0.85);
        else if (c === 'g') push(t, root, 0.1, 0.42);
        else if (c === '5') {
          const p = lastOfSeg && nr != null && nr !== root && r() < appr ? approachTo(nr, root, si) : root + fifthOf(ch) <= hi ? root + fifthOf(ch) : root + fifthOf(ch) - 12;
          push(t, p, sustain ? gap * 0.98 : Math.min(gap * 0.9, 0.5), 0.8);
        }
      }
    }
  };
  switch (style) {
    case 'root': case 'half':
      chunks((t, end, k, lastChunk) => {
        const root = roots[k], nr = nextRoot(k), len = end - t;
        const ap = lastChunk && nr != null && nr !== root && len >= 2 && r() < appr ? (len >= 3 && r() < 0.5 ? 1 : 0.5) : 0;
        if (style === 'half' && len >= cx.bpb - 1e-6 && len >= 3) {
          const h = Math.floor(len / 2);
          const f = root + fifthOf(cx.segs[k].ch);
          push(t, root, h * 0.95, 1);
          push(t + h, f <= hi ? f : f - 12, (len - h - ap) * 0.95, 0.85);
        } else push(t, root, (len - ap) * (g.gate ?? 0.96), 1);
        if (ap) push(end - ap, approachTo(nr, root, k), ap * 0.95, 0.8);
      });
      break;
    case 'root8': case 'octave': case 'offbeat':
      chunks((t, end, k, lastChunk) => {
        const root = roots[k], nr = nextRoot(k);
        for (let u = t, i = 0; u < end - 1e-6; u += 0.5, i++) {
          const beatPos = (cx.at + u) % 1;
          const off = Math.abs(beatPos - 0.5) < 1e-6;
          if (style === 'offbeat' && !off) continue;
          const lastStep = u + 0.5 >= end - 1e-6;
          let p = root;
          if (style === 'octave' && off) p = root + 12;
          else if (style === 'root8' && off && r() < 0.08 && root + 12 <= hi + 4) p = root + 12;
          if (lastStep && lastChunk && nr != null && nr !== root && r() < appr && style !== 'offbeat') p = approachTo(nr, root, k);
          push(u, p, 0.5 * (g.gate ?? (style === 'offbeat' ? 0.8 : 0.9)), off ? 0.8 : Math.abs((cx.at + u) % cx.bpb) < 1e-6 ? 1 : 0.92);
        }
      });
      break;
    case 'walking': {
      let cur = roots[0], dir = r() < 0.5 ? 1 : -1;
      cx.segs.forEach((s, k) => {
        const root = roots[k], nr = nextRoot(k);
        const tones = s.ch.pcs;
        const set = chordScale(cx.key.pcs, s.ch);
        const n = Math.max(1, Math.round(s.t1 - s.t0));
        for (let i = 0; i < n; i++) {
          const t = s.t0 + i;
          let p;
          if (i === 0) p = root;
          else if (i === n - 1 && nr != null) p = approachTo(nr, cur, k);
          else {
            if (cur >= hi - 2) dir = -1; else if (cur <= lo + 2) dir = 1; else if (r() < 0.2) dir = -dir;
            const ct = nearTone(cur + dir * 2, tones, dir, cur);
            p = Math.abs(ct - cur) >= 4 && r() < 0.45 ? stepScale(cur, dir, set) : ct;
            if (p === cur) p = stepScale(cur, dir, set);
            if (p > hi + 2 || p < lo - 1) { dir = -dir; p = nearTone(cur + dir * 3, tones, dir, cur); }
          }
          push(t, p, 0.92, i === 0 ? 1 : 0.88);
          cur = p;
        }
      });
      break;
    }
    case 'synco': grid(BASS_SYNCO, false); break;
    case 'funk': grid(BASS_FUNK, false); break;
    case '808': grid(BASS_808, true); break;
    case 'pedal': case 'pedal8': {
      const p = placePc(g.note != null ? mod12(midiOf(g.note, 0)) : cx.key.root, lo, hi, center);
      if (style === 'pedal') for (let t = 0; t < cx.len - 1e-6; t += cx.bpb * (g.hold ?? 2)) push(t, p, Math.min(cx.bpb * (g.hold ?? 2), cx.len - t) * 0.98, 1);
      else for (let t = 0; t < cx.len - 1e-6; t += 0.5) push(t, p, 0.5 * (g.gate ?? 0.7), Math.abs(t % 1) < 1e-6 ? 1 : 0.78);
      break;
    }
    case 'reggae':
      for (let b = 0; b < bars; b++) {
        const t0 = b * cx.bpb;
        const at = (dt, kind, d, v) => { const t = t0 + dt; if (t >= cx.len) return; const k = segIdx(t), f = roots[k] + fifthOf(cx.segs[k].ch); push(t, kind === '5' ? (f <= hi ? f : f - 12) : roots[k], d, v); };
        at(1, 'R', 0.45, 1); at(1.5, 'R', 0.45, 0.85); at(2.5, '5', 0.45, 0.85); at(3, 'R', 0.9, 0.95);
      }
      break;
    case 'bossa':
      for (let b = 0; b < bars; b++) {
        const t0 = b * cx.bpb;
        const at = (dt, kind, d, v) => {
          const t = t0 + dt; if (t >= cx.len) return;
          const k = segIdx(t), f = roots[k] + fifthOf(cx.segs[k].ch) - 12, nr = nextRoot(k);
          const lastOfSeg = t + 0.5 >= cx.segs[k].t1 - 1e-6;
          push(t, kind === 'a' && lastOfSeg && nr != null && nr !== roots[k] && r() < appr ? approachTo(nr, roots[k], k) : kind === 'R' ? roots[k] : f >= lo - 2 ? f : f + 12, d, v);
        };
        at(0, 'R', 1.4, 1); at(1.5, '5', 0.45, 0.8); at(2, '5', 1.4, 0.92); at(3.5, 'a', 0.45, 0.8);
      }
      break;
    default: throw new Error(`ベースのスタイル「${style}」はありません（${GEN_INFO.bass.styles.map((s) => s[0]).join(', ')}）`);
  }
  return out;
}

/* ---------------- ドラム（drums） ---------------- */

/*
 * スタイルごとの層：[パーツ, この intensity 以上で鳴る, 譜面 または 譜面の候補]。
 * 同じパーツは「条件を満たすなかでいちばん上の層」だけが鳴る（intensity を上げると譜面が入れ替わる）。
 * 譜面は 1 小節 = 16 文字（16 分）。steps: 12 のスタイルは 1 拍 = 3 文字（3 連）。
 */
const DRUM_STYLES = {
  pop: { fill: 'toms', layers: [
    ['kick', 0, ['x.......x.x.....', 'x......xx.x.....', 'x.....x.x.......', 'x.......x..x....']],
    ['snare', 0.2, '....x.......x...'], ['rim', 0, '....x.......x...'], ['rim', 0.2, ''],
    ['hat', 0, 'o...o...o...o...'], ['hat', 0.3, 'x.o.x.o.x.o.x.o.'], ['hat', 0.8, 'x.o.x.o.x.o.x...'], ['ohat', 0.8, '..............o.'],
    ['snare+', 0.6, '.......g.g......'], ['tamb', 0.7, '....o.......o...'], ['clap', 0.9, '....o.......o...'], ['shaker', 0.5, '..g...g...g...g.'],
  ] },
  rock: { fill: 'toms', layers: [
    ['kick', 0, ['x.......x.x.....', 'x..x....x.x.....', 'x.....x.x..x....', 'x.x.....x.x.....']],
    ['snare', 0, '....X.......X...'], ['hat', 0, 'x.x.x.x.x.x.x.x.'], ['hat', 0.75, ''], ['ride', 0.75, 'x.x.x.x.x.x.x.x.'],
    ['ohat', 0.55, '..............o.'], ['ohat', 0.75, ''], ['crash', 0.9, 'o...............'], ['snare+', 0.5, '.........g......'],
  ] },
  lofi: { fill: 'lofi', swing: 0.18, crash: false, layers: [
    ['kick', 0, ['x.........x..x..', 'x......x..x.....', 'x.....x...x.....', 'x.........xx....']],
    ['rim', 0, '....x.......x...'], ['rim', 0.4, '.......g........'], ['snare', 0.4, '....x.......x...'],
    ['hat', 0, 'o...o...o...o...'], ['hat', 0.25, 'o.o.o.o.o.o.o.o.'], ['hat', 0.55, 'x.xgx.xgx.xgx.xo'], ['ohat', 0.85, '..............o.'], ['shaker', 0.7, '..g...g...g...g.'],
  ] },
  hiphop: { fill: 'lofi', swing: 0.12, crash: false, layers: [
    ['kick', 0, ['x......x.x......', 'x.....x...x.....', 'x..x......x..x..', 'x.......x.x....x']],
    ['snare', 0, '....x.......x...'], ['hat', 0, 'x.x.x.x.x.x.x.x.'], ['hat', 0.6, 'x.x.x.xxx.x.x.x.'], ['ohat', 0.75, '......o.........'],
    ['clap', 0.8, '....o.......o...'], ['snare+', 0.5, '...............g'], ['perc', 0.9, '..........o.....'],
  ] },
  trap: { fill: 'trap', rolls: true, layers: [
    ['kick', 0, ['x.........x.....', 'x......x..x.....', 'x.....x......x..', 'x..x......x.....']],
    ['clap', 0, '........x.......'], ['snare', 0.7, '........x.......'], ['hat', 0, 'x...x...x...x...'], ['hat', 0.3, 'x.x.x.x.x.x.x.x.'], ['hat', 0.75, 'x.xxx.x.x.xxx.x.'],
    ['ohat', 0.6, '..............o.'], ['rim', 0.85, '...o.....o......'],
  ] },
  house: { fill: 'snare', layers: [
    ['kick', 0, 'x...x...x...x...'], ['clap', 0.25, '....x.......x...'], ['ohat', 0.3, '..x...x...x...x.'], ['hat', 0.1, 'o...o...o...o...'], ['hat', 0.3, ''],
    ['hat', 0.6, 'oo.ooo.ooo.ooo.o'], ['shaker', 0.8, 'g.g.g.g.g.g.g.g.'], ['snare', 0.9, '....o.......o..g'], ['perc', 0.7, ['.......o........', '..........o.....']],
  ] },
  dnb: { fill: 'snare', layers: [
    ['kick', 0, ['x.........x.....', 'x.....x...x.....', 'x.........x..x..']],
    ['snare', 0, '....x.......x...'], ['hat', 0, 'x.x.x.x.x.x.x.x.'], ['hat', 0.6, 'x.xxx.xxx.xxx.xx'], ['snare+', 0.5, '.......g.g....g.'], ['ride', 0.85, 'x...x...x...x...'],
  ] },
  funk: { fill: 'toms', layers: [
    ['kick', 0, ['x..x..x...x..x..', 'x.....x..xx.....', 'x..x......x..x..', 'x.x...x...x.x...']],
    ['snare', 0, '....x.......x...'], ['snare+', 0.35, '.......g.g.....g'], ['snare+', 0.7, '.g.....g.g.....g'],
    ['hat', 0, 'x.x.x.x.x.x.x.x.'], ['hat', 0.45, 'xoxoxoxoxoxoxo..'], ['ohat', 0.45, '..............o.'], ['tamb', 0.8, '....o.......o...'], ['cowbell', 0.95, 'o...o...o...o...'],
  ] },
  bossa: { fill: 'lofi', crash: false, layers: [
    ['kick', 0, 'x.....x.x.....x.'], ['rim', 0, ['x.....x.....x...', '....x.....x.....']], ['hat', 0, 'o.o.o.o.o.o.o.o.'], ['shaker', 0.5, 'ogogogogogogogog'], ['ride', 0.85, 'o...o...o...o...'],
  ], twoBar: ['rim'] },
  ballad: { fill: 'toms', layers: [
    ['kick', 0, ['x.........x.....', 'x.......x.......', 'x.....x...x.....']],
    ['rim', 0, '....x.......x...'], ['rim', 0.5, ''], ['snare', 0.5, '....x.......x...'], ['hat', 0, 'o...o...o...o...'], ['hat', 0.3, 'o.o.o.o.o.o.o.o.'], ['hat', 0.8, ''], ['ride', 0.8, 'x.o.x.o.x.o.x.o.'],
    ['tamb', 0.7, '....o.......o...'],
  ] },
  halftime: { fill: 'toms', layers: [
    ['kick', 0, ['x.....x.......x.', 'x..x..........x.', 'x.........x.....']],
    ['snare', 0, '........X.......'], ['hat', 0, 'x.x.x.x.x.x.x.x.'], ['hat', 0.7, 'x.x.x.x.x.x.xxx.'], ['ohat', 0.6, '......o.........'], ['snare+', 0.5, '.............g.g'], ['crash', 0.95, 'o...............'],
  ] },
  shuffle: { fill: 'toms', steps: 12, layers: [
    ['kick', 0, ['x.....x.....', 'x....xx.....', 'x.....x..x..']], ['snare', 0, '...x.....x..'], ['hat', 0, 'x.ox.ox.ox.o'], ['hat', 0.8, ''], ['ride', 0.8, 'x.ox.ox.ox.o'], ['snare+', 0.6, '..g.....g..g'], ['tamb', 0.75, '...o.....o..'],
  ] },
  jazz: { fill: 'lofi', steps: 12, crash: false, comp: true, layers: [
    ['ride', 0, 'x..x.ox..x.o'], ['hat', 0, '...x.....x..'], ['kick', 0.3, 'g..g..g..g..'], ['kick', 0.75, 'o..g..g..g.o'], ['rim', 0.2, '.........g..'],
  ] },
  cinematic: { fill: 'taiko', layers: [
    ['tom3', 0, 'X...............'], ['tom3', 0.3, 'X.......x.x.....'], ['tom3', 0.6, 'X..x..x.X..x..x.'], ['tom3', 0.85, 'X.xx.xx.X.xx.xxx'],
    ['kick', 0.45, 'x...............'], ['kick', 0.8, 'x.......x.......'], ['tom1', 0.6, ['....x.......x...', '....x.......x.xx']], ['snare', 0.75, 'o.ggo.ggo.ggo.gg'], ['crash', 0.95, 'o...............'],
  ] },
  taiko: { fill: 'taiko', layers: [
    ['tom3', 0, ['X.....x.x.......', 'X.......x...x...']], ['tom3', 0.5, ['X..x..x.X..x..x.', 'X...x.x.X...xxx.', 'X.x...x.X.x.x...']],
    ['tom1', 0.3, '........x...x.x.'], ['tom1', 0.7, '..x...x...x.x.xx'], ['rim', 0.4, '..o...o...o...o.'], ['rim', 0.7, ''], ['shaker', 0.6, 'x.o.x.o.x.o.x.o.'], ['tom2', 0.85, '....x.......x...'],
  ] },
  twobeat: { fill: 'toms', layers: [
    ['kick', 0, 'x.......x.......'], ['snare', 0.3, '....x.......x...'], ['rim', 0, '....x.......x...'], ['rim', 0.3, ''], ['hat', 0.2, '..x...x...x...x.'], ['hat', 0.6, 'x.x.x.x.x.x.x.x.'], ['tamb', 0.8, '..o...o...o...o.'], ['cowbell', 0.95, '....o.......o...'],
  ] },
  light: { fill: 'lofi', crash: false, layers: [
    ['shaker', 0, 'o.g.o.g.o.g.o.g.'], ['shaker', 0.6, 'ogogogogogogogog'], ['snap', 0.2, '....x.......x...'], ['kick', 0.35, ['x.......x.......', 'x.......x.x.....']], ['tamb', 0.7, '..o...o...o...o.'], ['clap', 0.85, '....o.......o...'], ['rim', 0.5, '.......g......g.'],
  ] },
  disco: { fill: 'snare', layers: [
    ['kick', 0, 'x...x...x...x...'], ['snare', 0.2, '....x.......x...'], ['ohat', 0.2, '..x...x...x...x.'], ['hat', 0.5, 'xx.xxx.xxx.xxx.x'], ['clap', 0.7, '....o.......o...'], ['tamb', 0.85, 'o.o.o.o.o.o.o.o.'],
  ] },
};
const FILL_CUT = new Set(['hat', 'ohat', 'ride', 'shaker', 'snare', 'clap', 'rim', 'tamb', 'snap', 'perc', 'cowbell', 'tom1', 'tom2']);

function genDrums(cx, g) {
  const out = [];
  const style = g.style || 'pop';
  const S = DRUM_STYLES[style];
  if (!S) throw new Error(`ドラムのスタイル「${style}」はありません（${Object.keys(DRUM_STYLES).join(', ')}）`);
  const r = rng(seedOf(g, 'dr'));
  const I = clamp(g.intensity ?? 0.6, 0, 1);
  const hum = g.humanize ?? 0.07;
  const tri = S.steps === 12;
  const step = tri ? 1 / 3 : 0.25;
  const steps = Math.round(cx.bpb / step);
  const sw = tri ? 0 : g.swing ?? cx.trackSwing ?? S.swing ?? 0;
  const bars = Math.ceil(cx.len / cx.bpb - 1e-6);
  // intensity に合う層を選ぶ（同じパーツはいちばん上の層）
  const chosen = new Map();
  for (const [piece, min, pat] of S.layers) if (I >= min - 1e-9) chosen.set(piece, pat);
  // 候補のある層は、奇数小節・偶数小節で別の候補にする（2 小節のパターンになる）
  const va = Math.floor(r() * 50), vb = Math.floor(r() * 50);
  const patOf = (piece, pat, b) => {
    if (typeof pat === 'string') return pat;
    if (S.twoBar?.includes(piece)) return pat[b % pat.length];
    return pat[(b % 2 ? va + 1 + (vb % Math.max(1, pat.length - 1)) : va) % pat.length];
  };
  const add = (t, n, v) => { if (t >= -1e-6 && t < cx.len - 1e-6) out.push({ t: Math.max(0, t), n, d: step, v: clamp(v * (1 + (r() - 0.5) * 2 * hum), 0.12, 1) }); };
  const fillN = g.fill ?? 0;
  const fillBars = new Map(); // 小節番号 → フィルの長さ（拍）
  for (let b = 0; b < bars; b++) {
    const isEnd = b === bars - 1 && g.fillEnd !== false && (fillN > 0 || g.fillEnd === true) && bars >= 2;
    const isMid = fillN > 0 && (b + 1) % fillN === 0 && b !== bars - 1;
    if (!isEnd && !isMid) continue;
    const x = r();
    fillBars.set(b, Math.min(cx.bpb, isEnd ? (I < 0.35 ? 1 : I < 0.7 ? 2 : x < 0.35 ? 4 : 2) : I < 0.6 ? 1 : x < 0.5 ? 1 : 2));
  }
  for (let b = 0; b < bars; b++) {
    const t0 = b * cx.bpb;
    const fb = fillBars.get(b) || 0;
    const cut = cx.bpb - fb; // この拍より後ろはフィル
    for (const [piece, pat0] of chosen) {
      const pat = patOf(piece, pat0, b);
      if (!pat) continue;
      const name = piece.replace('+', '');
      for (let k = 0; k < steps; k++) {
        const c = pat[k % pat.length];
        if (c === '.' || c === undefined) continue;
        const t = k * step;
        if (fb && t >= cut - 1e-6 && (FILL_CUT.has(name) || (name === 'kick' && t > cut + 1e-6) || name.startsWith('tom'))) continue;
        add(t0 + swung(t, 0.25, sw), name, HITV[c] ?? 0.8);
      }
    }
    // トラップのハイハットの連打
    if (S.rolls && I >= 0.4 && !fb && r() < 0.35 + I * 0.4) {
      const beat = pick(r, [1, 3, 3, 2]) % Math.max(1, Math.floor(cx.bpb));
      const half = r() < 0.5 ? 0 : 0.5;
      const n = r() < 0.5 ? 4 : 3, span = 0.5;
      for (let i = out.length - 1; i >= 0; i--) { const o = out[i]; if (o.n === 'hat' && o.t >= t0 + beat + half - 1e-6 && o.t < t0 + beat + half + span - 1e-6) out.splice(i, 1); }
      for (let i = 0; i < n; i++) add(t0 + beat + half + (i * span) / n, 'hat', 0.5 + (0.35 * i) / n);
    }
    // ジャズのスネアの合いの手
    if (S.comp && I >= 0.35 && !fb) {
      const n = I > 0.7 ? 2 : 1;
      for (let i = 0; i < n; i++) if (r() < 0.75) add(t0 + Math.floor(r() * cx.bpb) + (r() < 0.6 ? 2 / 3 : 0), 'snare', r() < 0.3 ? 0.55 : 0.35);
    }
    if (fb) drumFill(add, r, S, t0 + cut, fb, I, tri, cx.len);
    // フィルの次の小節の頭にクラッシュ
    if (b > 0 && fillBars.has(b - 1) && S.crash !== false && I >= 0.5) add(t0, 'crash', 0.8);
  }
  if (g.crash) { add(0, 'crash', typeof g.crash === 'number' ? g.crash : 0.9); if (!out.some((o) => o.n === 'kick' && o.t < 1e-6) && I > 0.15) add(0, chosen.has('kick') ? 'kick' : 'tom3', 0.9); }
  return out;
}

/** フィルイン（小節の終わりの飾り）。t0 から len 拍ぶん */
function drumFill(add, r, S, t0, len, I, tri, clipLen) {
  const sub = tri ? 3 : 4, step = 1 / sub;
  const n = Math.round(len * sub);
  const vAt = (i) => 0.5 + 0.45 * ((i + 1) / n);
  switch (S.fill) {
    case 'lofi': {
      // 控えめ：最後の 1 拍にスネアを 2〜3 個
      const pat = tri ? pick(r, ['x.x', '.xx', 'x..']) : pick(r, ['x.xx', '..xx', 'x..x', '.x.x']);
      const base = t0 + len - 1;
      for (let i = 0; i < pat.length; i++) if (pat[i] === 'x') add(base + i * step, I < 0.4 ? 'rim' : 'snare', 0.4 + 0.3 * (i / pat.length));
      if (len >= 2) add(t0, 'kick', 0.7);
      break;
    }
    case 'snare': {
      // ビルドアップ：8 分 → 16 分で詰めていく
      for (let i = 0; i < n; i++) {
        const dense = i >= n / 2 || len <= 1;
        if (!dense && i % 2) continue;
        add(t0 + i * step, 'snare', vAt(i));
      }
      add(t0 + len - step, 'clap', 0.8);
      break;
    }
    case 'trap': {
      const base = t0 + len - 1;
      for (let i = 0; i < 6; i++) add(base + i / 6, i < 3 ? 'hat' : 'snare', 0.5 + 0.08 * i);
      if (len >= 2) for (let i = 0; i < 4; i++) add(t0 + i * 0.25, 'hat', 0.6);
      break;
    }
    case 'taiko': {
      for (let i = 0; i < n; i++) {
        const acc = i % 3 === 0 || i >= n - sub;
        if (!acc && I < 0.5 && i % 2) continue;
        add(t0 + i * step, i >= n - 2 ? 'tom3' : i % 3 === 0 ? 'tom3' : 'tom2', acc ? vAt(i) + 0.05 : vAt(i) * 0.7);
      }
      break;
    }
    default: {
      // スネア → タムへ降りていく
      const pieces = len >= 2 ? ['snare', 'snare', 'tom1', 'tom1', 'tom2', 'tom3'] : I > 0.6 ? ['snare', 'tom1', 'tom2', 'tom3'] : ['snare', 'snare', 'snare', 'tom2'];
      const beatPat = () => (tri ? pick(r, ['xxx', 'x.x', 'xxx']) : I < 0.45 ? pick(r, ['x.x.', 'x.xx', 'x...']) : pick(r, ['xxxx', 'x.xx', 'xx.x', 'xxxx']));
      for (let b = 0; b < len; b++) {
        const pat = b === len - 1 && I >= 0.45 ? (tri ? 'xxx' : 'xxxx') : beatPat();
        for (let i = 0; i < sub; i++) {
          if (pat[i] !== 'x') continue;
          const k = b * sub + i;
          add(t0 + k * step, pieces[Math.min(pieces.length - 1, Math.floor((k / n) * pieces.length))], vAt(k));
        }
      }
      add(t0, 'kick', 0.8);
    }
  }
}

/* ---------------- メロディ（melody） ---------------- */

// リズムのひな形（4/4 の 1 小節。[開始拍, 長さ]）。RUN：動く小節、END：フレーズの終わり（長い音と休み）
const RUN = [
  [[[0, 2], [2, 2]], [[0, 3], [3, 1]], [[0, 1.5], [1.5, 2.5]], [[1, 1], [2, 2]], [[0, 2], [2, 1], [3, 1]]],
  [[[0, 1], [1, 1], [2, 2]], [[0, 1.5], [1.5, 0.5], [2, 2]], [[0, 1], [1, 0.5], [1.5, 1.5], [3, 1]], [[0, 2], [2, 1], [3, 1]], [[0.5, 0.5], [1, 1], [2, 2]], [[0, 1.5], [1.5, 1.5], [3, 1]]],
  [[[0, 1], [1, 0.5], [1.5, 0.5], [2, 1], [3, 1]], [[0, 0.5], [0.5, 0.5], [1, 1], [2, 1.5], [3.5, 0.5]], [[0, 1.5], [1.5, 0.5], [2, 0.5], [2.5, 0.5], [3, 1]], [[0, 0.5], [0.5, 1], [1.5, 0.5], [2, 1], [3, 1]], [[0, 1], [1, 1], [2, 0.5], [2.5, 0.5], [3, 1]], [[0, 0.75], [0.75, 0.75], [1.5, 0.5], [2, 1], [3, 1]]],
  [[[0, 0.5], [0.5, 0.5], [1, 0.5], [1.5, 0.5], [2, 1], [3, 0.5], [3.5, 0.5]], [[0, 0.5], [0.5, 0.5], [1, 1], [2, 0.5], [2.5, 0.5], [3, 0.5], [3.5, 0.5]], [[0, 0.75], [0.75, 0.75], [1.5, 0.5], [2, 0.75], [2.75, 0.75], [3.5, 0.5]], [[0, 0.5], [0.5, 0.25], [0.75, 0.25], [1, 1], [2, 0.5], [2.5, 0.5], [3, 1]], [[0, 1], [1, 0.5], [1.5, 0.5], [2, 0.5], [2.5, 0.5], [3, 0.5], [3.5, 0.5]]],
];
const END = [
  [[[0, 3]], [[0, 2.5]], [[0, 1], [1, 2]]],
  [[[0, 1], [1, 2]], [[0, 1.5], [1.5, 1.5]], [[0, 1], [1, 1], [2, 1.5]], [[0, 0.5], [0.5, 0.5], [1, 2]]],
  [[[0, 1], [1, 0.5], [1.5, 0.5], [2, 1.5]], [[0, 0.5], [0.5, 0.5], [1, 1], [2, 1.5]], [[0, 1.5], [1.5, 0.5], [2, 1.5]], [[0, 0.5], [0.5, 1], [1.5, 1.5]]],
  [[[0, 0.5], [0.5, 0.5], [1, 0.5], [1.5, 0.5], [2, 1.5]], [[0, 0.5], [0.5, 0.5], [1, 1], [2, 0.5], [2.5, 1]], [[0, 0.75], [0.75, 0.75], [1.5, 0.5], [2, 1.5]]],
];

/** 1 小節ぶんのリズム（4/4 以外は、拍ごとの音を density に応じて割る） */
function barRhythm(r, density, bpb, ending) {
  if (Math.abs(bpb - 4) < 1e-6) {
    const x = clamp(density, 0, 0.999) * 3 + (r() - 0.5) * 0.9;
    const lv = clamp(Math.round(x), 0, 3);
    return pick(r, (ending ? END : RUN)[lv]).map((n) => n.slice());
  }
  const out = [];
  const beats = Math.round(bpb);
  const stop = ending ? Math.max(1, beats - 2) : beats;
  for (let b = 0; b < stop; b++) {
    if (b > 0 && r() > 0.35 + density * 0.6) { if (out.length) out[out.length - 1][1] += 1; continue; }
    if (r() < density * 0.6 && !(ending && b === stop - 1)) out.push([b, 0.5], [b + 0.5, 0.5]);
    else out.push([b, 1]);
  }
  if (ending && out.length) out[out.length - 1][1] = Math.max(1, bpb - out[out.length - 1][0] - 1);
  return out;
}

/** モチーフ（リズムと、音階の段数で表した動き）を作る */
function makeMotif(r, cx, g, unitBars, density, kind) {
  const bars = [];
  for (let b = 0; b < unitBars; b++) bars.push(barRhythm(r, density, cx.bpb, b === unitBars - 1 || (unitBars >= 4 && b % 2 === 1 && r() < 0.6)));
  // 同じ小節のリズムをくり返すと「作った」感じが出る（B は 1 小節目のリズムを 2 回使うことが多い）
  if (kind === 'B' && unitBars >= 2 && r() < 0.5) { /* 1 小節目はそのまま */ }
  const notes = [];
  bars.forEach((bar, b) => bar.forEach(([t, d]) => notes.push({ t: b * cx.bpb + t, d, bar: b })));
  const shape = g.contour && g.contour !== 'auto' ? g.contour : pick(r, kind === 'B' ? ['fall', 'arch', 'wave', 'fall'] : ['arch', 'rise', 'wave', 'arch', 'fall']);
  const n = notes.length;
  const iv = [0];
  let lastLeap = 0, lastZero = false;
  const leapP = g.leap ?? 0.2;
  for (let i = 1; i < n; i++) {
    const pos = i / Math.max(1, n - 1);
    let bias = shape === 'rise' ? 1 : shape === 'fall' ? -1 : shape === 'arch' ? (pos < 0.5 ? 1 : -1) : Math.sin(pos * Math.PI * 2.2) >= 0 ? 1 : -1;
    let dir = r() < 0.76 ? bias : -bias;
    let mag;
    const x = r();
    if (lastLeap) { dir = -Math.sign(lastLeap); mag = 1; } // 跳んだあとは、反対向きに 1 段戻る
    else if (x < leapP) mag = r() < 0.7 ? 2 : r() < 0.7 ? 3 : 4;
    else if (x < leapP + 0.12 && !lastZero) mag = 0;
    else mag = 1;
    lastLeap = mag >= 3 ? dir * mag : 0;
    lastZero = mag === 0;
    iv.push(dir * mag);
  }
  // B はよく「同じ形を 1 段ずらしてくり返す」（反復進行）
  const seq = kind === 'B' && unitBars >= 2 && r() < 0.6 ? pick(r, [-1, -1, -2, 1]) : 0;
  return { notes, iv, seq, pickup: g.pickup ? (r() < (typeof g.pickup === 'number' ? g.pickup : 0.7) ? (r() < 0.5 ? 1 : 2) : 0) : 0, pickDir: r() < 0.7 ? -1 : 1, anchor: 0 };
}

function genMelody(cx, g) {
  const r = rng(seedOf(g, 'mel'));
  const bpb = cx.bpb;
  let lo = midiOf(g.lo, 60), hi = midiOf(g.hi, 81);
  if (hi - lo < 9) hi = lo + 9;
  const center = (lo + hi) / 2;
  const density = clamp(g.density ?? 0.5, 0, 1);
  const vel = g.vel ?? 0.72;
  const final = g.end === 'final' && cx.len >= bpb * 2;
  const body = final ? cx.len - bpb : cx.len;
  const unitBars = Math.max(1, Math.round(g.phrase ?? 2));
  const unit = unitBars * bpb;
  let nPh = Math.max(1, Math.floor(body / unit + 1e-6));
  const rem = body - nPh * unit;
  if (rem >= bpb - 1e-6 && body >= unit) nPh++; // 余った小節は短いフレーズにする
  // 形式：同じ文字は同じモチーフ（2 回目からは終わり方を変える）
  let form = typeof g.form === 'string' && /^[A-Za-z]+$/.test(g.form) ? g.form.toUpperCase() : 'AABA';
  const letters = Array.from({ length: nPh }, (_, k) => (nPh === 2 && form === 'AABA' ? 'AA' : nPh === 3 && form === 'AABA' ? 'AAB' : form)[k % (nPh === 2 && form === 'AABA' ? 2 : nPh === 3 && form === 'AABA' ? 3 : form.length)]);
  // 調の音階。メロディ用に 5 音（ペンタトニック）へしぼることもできる
  const hepta = cx.key.iv.length >= 7;
  let scalePcs = cx.key.pcs;
  if (g.scale === 'penta' && hepta) scalePcs = (cx.key.minor ? SCALES['minor pentatonic'] : SCALES.pentatonic).map((i) => mod12(cx.key.root + i));
  const strict = !hepta; // 和風の音階などは、和音の音でも音階の外なら使わない
  const tonesOf = (ch) => { if (!strict) return ch.pcs; const t = ch.pcs.filter((p) => scalePcs.includes(p)); return t.length ? t : scalePcs; };
  const setOf = (ch) => (strict || g.scale === 'penta' ? new Set(scalePcs) : chordScale(scalePcs, ch));
  const chAt = (t) => { let k = 0; while (k < cx.segs.length - 1 && t >= cx.segs[k].t1 - 1e-6) k++; return cx.segs[k].ch; };
  const inRange = (p) => { while (p > hi) p -= 12; while (p < lo) p += 12; return p; };

  const motifs = {};
  const seen = {};
  const out = [];
  let lastP = null; // 直前に鳴らした音（跳びすぎを防ぐ）
  const emit = (t, p, d, v, tag) => { out.push({ t, n: p, d, v: clamp(v, 0.05, 1), _s: tag }); lastP = p; };
  const sw = g.swing ?? 0, su = noteValue(g.swingUnit || '1/8');

  for (let k = 0; k < nPh; k++) {
    const L = letters[k];
    const t0 = k * unit;
    const tEnd = k === nPh - 1 ? body : Math.min(body, t0 + unit);
    const isLast = k === nPh - 1;
    if (!motifs[L]) {
      const m = makeMotif(r, cx, g, unitBars, clamp(density + (L === 'A' ? 0 : 0.08), 0, 1), L === 'A' ? 'A' : 'B');
      // 出だしの高さ：A は真ん中あたり、B は少し上（盛り上がり）
      m.anchor = Math.round(center + (L === 'A' ? -2 + r() * 5 : 2 + r() * 5));
      motifs[L] = m;
    }
    const M = motifs[L];
    const occ = (seen[L] = (seen[L] ?? 0) + 1);
    const vr = rng(seedOf(g, `var${L}${occ}`));
    // このフレーズの音符（フレーズが短いときは入るぶんだけ）
    let ns = M.notes.filter((n) => t0 + n.t < tEnd - 0.25);
    if (!ns.length) ns = [{ t: 0, d: Math.max(1, tEnd - t0 - 1), bar: 0 }];
    const iv = M.iv.slice(0, ns.length);
    // 2 回目からは終わりの 2 音の動きを変える
    if (occ > 1) for (let i = Math.max(1, ns.length - 2); i < ns.length; i++) iv[i] = (vr() < 0.5 ? 1 : -1) * (vr() < 0.75 ? 1 : 2);
    // 終わり方：途中のフレーズは「続く感じ」、偶数番目は「落ち着く」、最後は主音
    const endKind = isLast ? (final ? 'lead' : g.end === 'open' ? 'open' : 'tonic') : k % 2 === 1 ? 'close' : 'open';
    const ph = [];
    let prev = null, barFirst = null;
    for (let i = 0; i < ns.length; i++) {
      const nt = ns[i];
      const t = t0 + nt.t;
      let d = Math.min(nt.d, tEnd - t);
      const onBeat = Math.abs(nt.t % 1) < 1e-6;
      const antic = !onBeat && d >= 1; // 裏から伸ばす音は、次の拍の和音で考える（先取り）
      const ch = chAt(antic ? Math.min(cx.len - 0.01, t + 0.5) : t);
      const tones = tonesOf(ch), set = setOf(ch);
      const posInBar = nt.t % bpb;
      const strong = (onBeat && (Math.abs(posInBar) < 1e-6 || Math.abs(posInBar - bpb / 2) < 1e-6)) || d >= 1.5 || antic || i === 0 || i === ns.length - 1;
      const nextLeap = i + 1 < ns.length && Math.abs(iv[i + 1]) >= 2;
      const wasLeap = Math.abs(iv[i]) >= 2;
      let p;
      if (i === 0) {
        // 出だし：モチーフの高さに近い構成音（同じモチーフは同じ高さから始まりやすい）
        p = nearTone(M.anchor, tones, 0);
        if (lastP != null && Math.abs(p - lastP) > 9) p = nearTone(lastP + Math.sign(p - lastP) * 5, tones, Math.sign(p - lastP));
      } else if (M.seq && nt.bar >= 1 && ns[i - 1].bar !== nt.bar && barFirst != null) {
        // 反復進行：前の小節の頭の音から seq 段ずらして始める
        p = nearTone(stepScale(barFirst, M.seq * nt.bar, set), tones, Math.sign(M.seq));
      } else {
        let step = iv[i];
        if (prev + step * 2 > hi) step = -Math.abs(step);
        if (prev + step * 2 < lo) step = Math.abs(step);
        if (prev > center + 6 && step > 0 && vr() < 0.5) step = -step;
        if (prev < center - 6 && step < 0 && vr() < 0.5) step = -step;
        p = step === 0 ? prev : stepScale(prev, step, set);
        if (strong || nextLeap || wasLeap || step === 0) {
          p = nearTone(p, tones, Math.sign(step));
          if (p === prev && step !== 0) p = nearTone(prev + Math.sign(step), tones, Math.sign(step), prev);
        }
      }
      // 小節の頭の音を覚える（反復進行用）
      if (i === 0 || ns[i - 1].bar !== nt.bar) barFirst = barFirst == null || nt.bar === 0 ? p : barFirst;
      // フレーズの最後の音
      if (i === ns.length - 1) {
        const from = prev ?? p;
        if (endKind === 'tonic') {
          p = tones.includes(cx.key.root) || g.end === 'tonic' ? nearTone(from, [cx.key.root], 0) : nearTone(from, [ch.root], 0);
        } else if (endKind === 'close') {
          const pref = [ch.root, tones.find((x) => mod12(x - ch.root) === 3 || mod12(x - ch.root) === 4)].filter((x) => x != null && tones.includes(x));
          p = nearTone(from, pref.length ? pref : tones, 0);
        } else if (endKind === 'lead') {
          // 最後の小節の主音へ 1 段で入れる音（音階の 2 番目か 7 番目）を優先
          const tonic = nearTone(from, [cx.key.root], 0);
          const nb = [stepScale(tonic, 1, new Set(scalePcs)), stepScale(tonic, -1, new Set(scalePcs))].filter((x) => tones.includes(mod12(x)));
          p = nb.length ? nb.sort((a, b) => Math.abs(a - from) - Math.abs(b - from))[0] : nearTone(from, tones.filter((x) => x !== cx.key.root).length ? tones.filter((x) => x !== cx.key.root) : tones, 0);
        } else {
          const open = tones.filter((x) => x !== cx.key.root);
          p = nearTone(p, open.length ? open : tones, 0);
        }
        // 終わりの音へは近いところから入る
        if (prev != null && Math.abs(p - prev) > 7) p += p > prev ? -12 : 12;
        d = Math.max(d, Math.min(tEnd - t - (isLast && !final ? 0 : 0.5), 2));
      }
      p = inRange(p);
      // 1 オクターブを超えて跳ばない
      const ref = ph.length ? ph[ph.length - 1].p : lastP;
      if (ref != null && Math.abs(p - ref) > 9) {
        const q = nearTone(ref + Math.sign(p - ref) * 4, strong ? tones : [...set], Math.sign(p - ref));
        p = inRange(q);
        if (Math.abs(p - ref) > 12) p = nearTone(ref, tones, 0);
      }
      ph.push({ t, p, d, strong, onBeat });
      prev = p;
    }
    // 半音下からのアプローチ（ジャズなど）：短い弱拍の音を、次の強い音の半音下にする
    if (g.chromatic) for (let i = 1; i < ph.length - 1; i++) {
      const a = ph[i], b = ph[i + 1];
      if (!a.strong && a.d <= 0.5 && b.strong && Math.abs(b.t - (a.t + a.d)) < 1e-6 && vr() < g.chromatic && Math.abs(b.p - 1 - ph[i - 1].p) <= 5) a.p = b.p - 1;
    }
    // 弱起（フレーズの前に 1〜2 音、次の音へ 1 段ずつ近づく）
    if (M.pickup && k > 0 && out.length) {
      const lastOut = out[out.length - 1];
      const free = t0 - (lastOut.t + lastOut.d);
      const cnt = Math.min(M.pickup, Math.floor((free + 1e-6) / 0.5));
      const set = setOf(chAt(Math.max(0, t0 - 0.5)));
      let p = ph[0].p;
      const pk = [];
      for (let i = 1; i <= cnt; i++) { p = stepScale(p, M.pickDir, set); pk.unshift({ t: t0 - i * 0.5, p: inRange(p) }); }
      if (pk.length && Math.abs(pk[0].p - lastP) <= 12 && pk.every((x) => x.p >= lo && x.p <= hi)) for (const x of pk) emit(swung(x.t, su, sw), x.p, 0.46, vel * 0.82, 'w');
    }
    // 強弱：強拍は少し強く、フレーズの山に向かって大きく、終わりはやさしく
    const top = Math.max(...ph.map((x) => x.p)), bot = Math.min(...ph.map((x) => x.p));
    ph.forEach((x, i) => {
      const hgt = top > bot ? (x.p - bot) / (top - bot) : 0.5;
      const v = vel * (0.9 + 0.1 * hgt + (x.strong && x.onBeat ? 0.05 : 0) - (i === ph.length - 1 ? 0.05 : 0) + (vr() - 0.5) * 0.05) * (L === 'A' ? 1 : 1.04);
      emit(swung(x.t, su, sw), x.p, x.d <= 1 ? x.d * (g.gate ?? 0.92) : x.d - 0.12, v, x.strong ? 's' : 'w');
    });
  }
  // 最後の小節の頭で主音に着地して伸ばす
  if (final) {
    const from = lastP ?? center;
    let p = nearTone(from, [cx.key.root], 0);
    p = inRange(p);
    if (Math.abs(p - from) > 12) p = nearTone(from, [cx.key.root], 0);
    emit(body, p, cx.len - body - 0.05, vel * 0.98, 's');
  }
  // 念のため：となり合う音が 1 オクターブを超えて離れていたら、オクターブを寄せる
  out.sort((a, b) => a.t - b.t);
  for (let i = 1; i < out.length; i++) {
    while (out[i].n - out[i - 1].n > 12) out[i].n -= 12;
    while (out[i - 1].n - out[i].n > 12) out[i].n += 12;
  }
  return out;
}

/* ---------------- 展開の入口 ---------------- */

/** 自動クリップの種類とつまみ（画面と検査で使う） */
export const GEN_INFO = {
  chords: { label: '伴奏', styles: [['pad', 'のばす'], ['whole', '小節ごと'], ['half', '2 拍ごと'], ['quarters', '4 分きざみ'], ['piano8', '8 分きざみ'], ['ballad', '分散和音'], ['arp-comp', 'アルベルティ'], ['stab', 'スタブ'], ['offbeat', '裏打ち'], ['strum', 'ストローク'], ['lazy', 'ローファイ'], ['charleston', 'ジャズ'], ['bossa', 'ボサノバ'], ['funk', 'ファンク']],
    voicings: [['close', '密集'], ['open', '開離'], ['drop2', 'ドロップ2'], ['shell', 'シェル'], ['wide', 'ワイド'], ['guitar', 'ギター']] },
  arp: { label: 'アルペジオ', styles: [['up', '上がる'], ['down', '下がる'], ['updown', '上がって下がる'], ['downup', '下がって上がる'], ['converge', '外から内へ'], ['thirds', '1 つ飛ばし'], ['random', 'ランダム'], ['as-played', '和音の順']],
    rates: [['1/4', '4 分'], ['1/8', '8 分'], ['1/8t', '3 連'], ['1/16', '16 分'], ['1/16t', '16 分 3 連'], ['1/32', '32 分']] },
  bass: { label: 'ベース', styles: [['root', 'ルート'], ['half', 'ルートと 5 度'], ['root8', '8 分'], ['octave', 'オクターブ'], ['offbeat', '裏打ち'], ['walking', 'ウォーキング'], ['synco', 'シンコペーション'], ['funk', 'ファンク'], ['808', '808'], ['pedal', 'ペダル（のばす）'], ['pedal8', 'ペダル（8 分）'], ['reggae', 'レゲエ'], ['bossa', 'ボサノバ']] },
  drums: { label: 'ドラム', styles: [['pop', 'ポップ'], ['rock', 'ロック'], ['lofi', 'ローファイ'], ['hiphop', 'ヒップホップ'], ['trap', 'トラップ'], ['house', 'ハウス'], ['disco', 'ディスコ'], ['dnb', 'ドラムンベース'], ['funk', 'ファンク'], ['bossa', 'ボサノバ'], ['ballad', 'バラード'], ['halftime', 'ハーフタイム'], ['shuffle', 'シャッフル'], ['jazz', 'ジャズ'], ['twobeat', 'ツービート'], ['light', '軽いパーカッション'], ['cinematic', 'シネマティック'], ['taiko', '太鼓']] },
  melody: { label: 'メロディ', styles: [['auto', 'おまかせ'], ['arch', '山なり'], ['rise', '上がっていく'], ['fall', '下がっていく'], ['wave', '波']],
    forms: [['AABA', 'AABA'], ['ABAB', 'ABAB'], ['AAAB', 'AAAB'], ['ABAC', 'ABAC'], ['AB', 'かけあい']] },
};
export const GEN_TYPES = Object.keys(GEN_INFO);
const GENS = { chords: genChords, arp: genArp, bass: genBass, drums: genDrums, melody: genMelody };

/** クリップのラベル（自動：アルペジオ など） */
export function genLabel(gen) {
  const info = GEN_INFO[gen?.type];
  if (!info) return '自動';
  const key = gen.type === 'arp' ? gen.pattern || 'up' : gen.type === 'melody' ? null : gen.style;
  const st = key && info.styles.find((s) => s[0] === key);
  return `自動：${info.label}${st ? `（${st[1]}）` : ''}`;
}

const genCache = new Map();

/**
 * 自動クリップを音符に展開する。戻り値 [{ t（クリップ頭からの拍）, n（MIDI 番号かドラム名）, d, v }]。
 * 同じ和音・同じつまみ・同じシードなら、曲のどこに置いても同じ音符になる（くり返しが同じフレーズになる）。
 */
export function expandGen(song, track, clip) {
  const g = clip.gen;
  if (!g || typeof g !== 'object') return [];
  const fn = GENS[g.type];
  if (!fn) throw new Error(`自動クリップの種類「${g.type}」はありません（${GEN_TYPES.join(', ')}）`);
  const [sn, sd] = song.sig || [4, 4];
  const bpb = (sn * 4) / sd;
  const at = Number(clip.at ?? 0);
  const len = Number(clip.len ?? bpb * 4);
  if (!(len > 0)) return [];
  const key = songKey(song);
  const list = g.type === 'drums' ? [] : chordList(song);
  const fallback = parseChord(SHARP[key.root] + (key.minor ? 'm' : key.iv.includes(4) ? '' : key.iv.includes(5) ? 'sus4' : '5'));
  const segs = segments(list, at, at + len, fallback);
  const nextC = list.find((c) => c.t >= at + len - 1e-6 && c.t < at + len + bpb * 2);
  const after = g.type === 'drums' ? null : nextC ? nextC.ch : song.loop && list.length ? list[0].ch : null;
  const ck = JSON.stringify([g, len, at % bpb, bpb, song.bpm, key.root, key.iv, segs.map((s) => [s.t0, s.t1, s.ch.sym]), after?.sym, track?.swing]);
  let notes = genCache.get(ck);
  if (!notes) {
    const cx = { at, len, bpb, bpm: song.bpm || 120, key, segs, next: after, trackSwing: track?.swing ?? null };
    notes = fn(cx, g).filter((n) => n.t >= -1e-6 && n.t < len - 1e-6).map((n) => ({ t: Math.round(Math.max(0, n.t) * 1e4) / 1e4, n: n.n, d: Math.round(n.d * 1e4) / 1e4, v: Math.round(n.v * 1e3) / 1e3 }));
    notes.sort((a, b) => a.t - b.t || (typeof a.n === 'number' ? a.n - b.n : String(a.n).localeCompare(String(b.n))));
    if (genCache.size > 400) genCache.clear();
    genCache.set(ck, notes);
  }
  return notes;
}

/** 自動クリップ 1 つを、ふつうの音符のクリップに変換する（元のクリップは変えない） */
export function bakeClip(song, track, clip) {
  if (!clip?.gen) return clip;
  const notes = expandGen(song, track, clip);
  const { gen, ...rest } = clip;
  return { ...rest, len: clip.len, notes: notes.map((n) => [n.t, typeof n.n === 'number' ? midiToName(n.n) : n.n, n.d, n.v]) };
}

/** 曲の中の自動クリップをすべて音符に変換した、新しい曲を返す */
export function bake(song) {
  const out = { ...song, tracks: (song.tracks || []).map((tr) => ({ ...tr, clips: (tr.clips || []).map((c) => (c.gen ? bakeClip(song, tr, c) : c)) })) };
  return JSON.parse(JSON.stringify(out));
}

export const hasGen = (song) => (song?.tracks || []).some((t) => (t.clips || []).some((c) => c?.gen));

/* ====================================================================== */
/*  おまかせ作曲（compose）                                                */
/* ====================================================================== */

/*
 * スタイルの定義。和音進行は「C メジャー / A マイナー」で書き、選んだ調へ移す（1 要素 = 1 小節、"Dm7 G7" は半分ずつ）。
 * トラック：on = 鳴らす場面（I イントロ / A / B サビ / C ブリッジ / O アウトロ、小文字 a は 2 回目の A から）、
 *           by = 場面ごとのつまみの上書き。vol は自動ミックス（autoMix）で測って決めた値。
 */
const tr = (id, name, inst, role, on, gen, x = {}) => ({ id, name, inst, role, on, gen, ...x });
const dr = (name, kit, on, gen, x = {}) => ({ id: 'drums', name, kit, role: 'drums', on, gen: { type: 'drums', fill: 4, ...gen }, ...x });

const GENERIC = {
  major: { A: [['C', 'G', 'Am', 'F'], ['C', 'Am', 'F', 'G'], ['F', 'G', 'Em', 'Am'], ['C', 'Em', 'F', 'G']], B: [['F', 'G', 'C', 'Am'], ['F', 'C', 'G', 'Am'], ['Am', 'F', 'C', 'G']], C: [['Am', 'Em', 'F', 'G'], ['Dm', 'F', 'C', 'G']], cadence: 'G', final: 'C' },
  minor: { A: [['Am', 'F', 'C', 'G'], ['Am', 'G', 'F', 'G'], ['Am', 'Em', 'F', 'G'], ['Am', 'Dm', 'G', 'C']], B: [['F', 'G', 'Am', 'Am'], ['F', 'C', 'G', 'Am'], ['Dm', 'G', 'C', 'Am']], C: [['Dm', 'Dm', 'E', 'E'], ['F', 'F', 'G', 'G']], cadence: 'E', final: 'Am' },
};

const STYLE_DEFS = {
  lofi: {
    label: 'ローファイ', desc: 'ゆったり・作業用', bpm: [70, 90], mode: 'major', keys: ['C', 'D', 'Eb', 'F', 'G', 'Bb'],
    A: [['Dm7', 'G7', 'Cmaj7', 'Am7'], ['Fmaj7', 'Em7', 'Dm7', 'Cmaj7'], ['Cmaj7', 'Am7', 'Dm7', 'G7'], ['Fmaj7', 'G7', 'Em7', 'Am7']],
    B: [['Am7', 'Dm7', 'G7', 'Cmaj7'], ['Fmaj7', 'G7', 'Cmaj7', 'A7'], ['Dm7', 'Em7', 'Fmaj7', 'G7']],
    C: [['Fmaj7', 'Fmaj7', 'Em7', 'Em7'], ['Dm7', 'Dm7', 'G7sus4', 'G7']], cadence: 'G7', final: 'Cmaj9',
    sends: { reverb: { size: 1.2, decay: 2.2 } },
    tracks: [
      tr('keys', 'エレピ', 'epiano', 'harmony', 'IABCO', { type: 'chords', style: 'lazy', tensions: true, register: 60, swing: 0.15, vel: 0.55 }, { rev: 0.25, pan: -0.1, hum: { time: 0.012, vel: 0.06 }, fx: [{ type: 'lofi', wow: 0.5, noise: 0.25, crackle: 0.3, tone: 6000, mix: 0.8 }], by: { I: { style: 'whole' } } }),
      tr('pad', 'パッド', 'pad', 'pad', 'BC', { type: 'chords', style: 'pad', register: 65, maxNotes: 3, vel: 0.5 }, { rev: 0.3 }),
      tr('mel', 'ビブラフォン', 'vibraphone', 'lead', 'ABO', { type: 'melody', density: 0.35, lo: 62, hi: 84, pickup: 0.5 }, { rev: 0.35, del: 0.12, pan: 0.15, hum: { time: 0.01, vel: 0.06 }, by: { B: { density: 0.5 }, O: { density: 0.25 } } }),
      tr('bass', 'ベース', 'ebass', 'bass', 'ABCO', { type: 'bass', style: 'root', lo: 31, hi: 48 }, { hum: { time: 0.008 }, by: { B: { style: 'synco' } } }),
      dr('ドラム', 'lofi', 'ABCO', { style: 'lofi' }, { rev: 0.06, hum: { time: 0.006 } }),
    ],
  },
  pop: {
    label: 'ポップ', desc: '明るい・Vlog 向け', bpm: [100, 124], mode: 'major', keys: ['C', 'D', 'E', 'F', 'G', 'A', 'Bb'],
    A: [['C', 'G', 'Am', 'F'], ['C', 'Am', 'F', 'G'], ['F', 'G', 'Em', 'Am'], ['C', 'Em', 'F', 'G'], ['Am', 'F', 'C', 'G']],
    B: [['F', 'G', 'C', 'Am'], ['F', 'C', 'G', 'Am'], ['C', 'G', 'Am', 'F'], ['F', 'G', 'Em', 'Am', 'F', 'G', 'C', 'C']],
    C: [['Am', 'Em', 'F', 'G'], ['Dm', 'Em', 'F', 'G']], cadence: 'G', final: 'C',
    tracks: [
      tr('piano', 'ピアノ', 'piano', 'harmony', 'IABCO', { type: 'chords', style: 'quarters', register: 60, vel: 0.6 }, { rev: 0.15, hum: { time: 0.006, vel: 0.05 }, by: { I: { style: 'whole' }, B: { style: 'piano8' }, C: { style: 'whole' }, O: { style: 'half' } } }),
      tr('pad', 'ストリングス', 'strings', 'pad', 'BC', { type: 'chords', style: 'pad', voicing: 'open', register: 64, vel: 0.5 }, { rev: 0.3 }),
      tr('arp', 'プラック', 'pluck', 'harmony', 'Ba', { type: 'arp', pattern: 'updown', rate: '1/8', octaves: 2, register: 67, gate: 0.6, vel: 0.5 }, { rev: 0.2, del: 0.2, pan: 0.2 }),
      tr('mel', 'メロディ', 'softlead', 'lead', 'ABO', { type: 'melody', density: 0.45, lo: 64, hi: 84, scale: 'penta', pickup: 0.6 }, { rev: 0.2, del: 0.15, by: { B: { density: 0.6 }, O: { density: 0.3 } } }),
      tr('bass', 'ベース', 'ebass', 'bass', 'ABCO', { type: 'bass', style: 'root', lo: 31, hi: 48 }, { by: { B: { style: 'root8' } } }),
      dr('ドラム', 'acoustic', 'ABO', { style: 'pop' }, { rev: 0.08 }),
    ],
  },
  edm: {
    label: 'EDM', desc: 'ノリのいい四つ打ち', bpm: [120, 130], mode: 'minor', keys: ['A', 'F', 'G', 'E', 'D', 'C'],
    A: [['Am', 'F', 'C', 'G'], ['Am', 'G', 'F', 'G'], ['Am', 'Em', 'F', 'G'], ['F', 'G', 'Am', 'Am']],
    B: [['F', 'G', 'Am', 'C'], ['F', 'C', 'G', 'Am'], ['Am', 'F', 'C', 'G']],
    C: [['F', 'F', 'G', 'G'], ['Dm', 'F', 'Am', 'G']], cadence: 'G', final: 'Am',
    sends: { reverb: { size: 1.5, decay: 2.8 }, delay: { time: '1/8d', feedback: 0.4 } },
    sfx: [['pre:B', 'riser', -6], ['at:B', 'impact', -6]],
    tracks: [
      tr('chords', 'コード', 'supersaw', 'harmony', 'IABCO', { type: 'chords', style: 'stab', register: 62, vel: 0.65 }, { rev: 0.25, fx: [{ type: 'pump', amount: 0.6, rate: '1/4', release: 0.55 }], by: { I: { style: 'pad' }, B: { style: 'whole', voicing: 'open' }, C: { style: 'pad' }, O: { style: 'pad' } } }),
      tr('arp', 'アルペジオ', 'pluck', 'harmony', 'IAC', { type: 'arp', pattern: 'up', rate: '1/16', octaves: 2, register: 69, gate: 0.6, vel: 0.5 }, { rev: 0.2, del: 0.25, pan: 0.15 }),
      tr('mel', 'リード', 'sawlead', 'lead', 'B', { type: 'melody', density: 0.5, lo: 67, hi: 86, scale: 'penta' }, { rev: 0.2, del: 0.2 }),
      tr('bass', 'ベース', 'synthbass', 'bass', 'ABO', { type: 'bass', style: 'offbeat', lo: 33, hi: 50 }, { fx: [{ type: 'pump', amount: 0.5, rate: '1/4', release: 0.45 }], by: { B: { style: 'octave' } } }),
      dr('ドラム', 'house', 'ABO', { style: 'house' }, { rev: 0.05 }),
    ],
  },
  cinematic: {
    label: 'シネマ', desc: '映画のような広がり', bpm: [70, 90], mode: 'minor', keys: ['D', 'A', 'E', 'C', 'G'], tail: 3.5,
    A: [['Am', 'F', 'C', 'G'], ['Am', 'Em', 'F', 'Dm'], ['Am', 'G', 'F', 'E'], ['Am', 'C', 'G', 'Dm']],
    B: [['F', 'G', 'Am', 'Am'], ['F', 'C', 'G', 'Am'], ['Dm', 'F', 'C', 'G'], ['Am', 'F', 'C', 'E']],
    C: [['Dm', 'Dm', 'Am', 'Am'], ['F', 'F', 'E', 'E']], cadence: 'E', final: 'Am',
    sends: { reverb: { size: 1.8, decay: 3.6, damp: 6500, predelay: 0.04 } },
    sfx: [['pre:B', 'riser', -8], ['at:B', 'impact', -6]],
    tracks: [
      tr('strings', 'ストリングス', 'strings', 'pad', 'IABCO', { type: 'chords', style: 'pad', voicing: 'wide', register: 60, vel: 0.6 }, { rev: 0.35 }),
      tr('piano', 'ピアノ', 'piano', 'harmony', 'IACO', { type: 'arp', pattern: 'updown', rate: '1/8', register: 67, gate: 0.9, vel: 0.5 }, { rev: 0.3, del: 0.08, by: { I: { rate: '1/4' } } }),
      tr('choir', 'クワイア', 'choir', 'pad', 'B', { type: 'chords', style: 'pad', register: 67, maxNotes: 3, vel: 0.5 }, { rev: 0.45 }),
      tr('mel', 'ブラス', 'brass', 'lead', 'ABO', { type: 'melody', density: 0.25, lo: 55, hi: 76, phrase: 2 }, { rev: 0.35, by: { B: { density: 0.35 }, O: { density: 0.15 } } }),
      tr('bass', '低音', 'subbass', 'bass', 'ABCO', { type: 'bass', style: 'root', lo: 33, hi: 48, approach: 0.2 }, {}),
      dr('打楽器', 'cinematic', 'aB', { style: 'cinematic' }, { rev: 0.2 }),
    ],
  },
  wafu: {
    label: '和風', desc: '琴と笛・和の音階', bpm: [80, 100], mode: 'major', scale: 'yo', keys: ['D', 'E', 'G', 'A', 'C'],
    A: [['Csus2', 'Fadd9', 'Dm7', 'Gsus4'], ['Dm7', 'Csus2', 'F', 'Gsus4'], ['F', 'Gsus4', 'Csus2', 'Csus2'], ['Csus2', 'Gsus4', 'Dm7', 'F']],
    B: [['F', 'Gsus4', 'Dm7', 'Csus2'], ['Dm7', 'F', 'Gsus4', 'Csus2'], ['F', 'Csus2', 'Dm7', 'Gsus4']],
    C: [['Dm7', 'Dm7', 'Gsus4', 'Gsus4']], cadence: 'Gsus4', final: 'Csus2',
    alt: { in: { A: [['Csus4', 'Dbmaj7', 'Csus4', 'Fm'], ['Fm', 'Db', 'Csus4', 'C5'], ['C5', 'Db', 'Fm', 'Csus4']], B: [['Db', 'Fm', 'Db', 'Csus4'], ['Fm', 'Fm', 'Db', 'Csus4']], C: [['Db', 'Db', 'Csus4', 'Csus4']], cadence: 'Db', final: 'C5' } },
    sends: { reverb: { size: 1.4, decay: 2.6, damp: 7000 } },
    tracks: [
      tr('koto', '琴', 'koto', 'harmony', 'IABCO', { type: 'chords', style: 'ballad', register: 62, vel: 0.62 }, { rev: 0.25, hum: { time: 0.008, vel: 0.06 }, by: { B: { style: 'arp-comp' } } }),
      tr('pad', 'パッド', 'airpad', 'pad', 'IBC', { type: 'chords', style: 'pad', register: 64, maxNotes: 3, vel: 0.5 }, { rev: 0.3 }),
      tr('mel', '笛', { preset: 'flute', vibrato: { rate: 5.5, depth: 0.2, delay: 0.25 } }, 'lead', 'ABO', { type: 'melody', density: 0.35, lo: 69, hi: 88, pickup: 0.4 }, { rev: 0.35, del: 0.1, by: { B: { density: 0.45 }, O: { density: 0.2 } } }),
      tr('bass', '低音', 'subbass', 'bass', 'ABCO', { type: 'bass', style: 'root', lo: 33, hi: 48, approach: 0 }, {}),
      dr('太鼓', 'cinematic', 'aBC', { style: 'taiko' }, { rev: 0.15, by: { C: { intensity: 0.25 } } }),
    ],
  },
  rock: {
    label: 'ロック', desc: '力強いバンドサウンド', bpm: [110, 140], mode: 'major', keys: ['E', 'A', 'D', 'G', 'C'],
    A: [['C', 'F', 'G', 'F'], ['C', 'Bb', 'F', 'C'], ['Am', 'F', 'C', 'G'], ['C', 'G', 'Am', 'F']],
    B: [['F', 'G', 'C', 'Am'], ['F', 'C', 'G', 'G'], ['Am', 'F', 'G', 'G']],
    C: [['Am', 'Am', 'F', 'G'], ['F', 'F', 'G', 'G']], cadence: 'G', final: 'C',
    tracks: [
      tr('guitar', 'ギター', 'guitar', 'harmony', 'IABCO', { type: 'chords', style: 'strum', vel: 0.7 }, { rev: 0.12, pan: -0.2, fx: [{ type: 'dist', drive: 9, kind: 'tape', mix: 0.5 }], by: { I: { style: 'whole', voicing: 'guitar', maxNotes: 5 }, C: { style: 'whole', voicing: 'guitar', maxNotes: 5 } } }),
      tr('organ', 'オルガン', 'organ', 'pad', 'BC', { type: 'chords', style: 'pad', register: 62, vel: 0.5 }, { rev: 0.15, pan: 0.2 }),
      tr('mel', 'リード', 'sawlead', 'lead', 'ABO', { type: 'melody', density: 0.4, lo: 62, hi: 82, scale: 'penta' }, { rev: 0.18, del: 0.12, fx: [{ type: 'dist', drive: 10, kind: 'soft', mix: 0.6 }], by: { B: { density: 0.55 } } }),
      tr('bass', 'ベース', 'ebass', 'bass', 'ABCO', { type: 'bass', style: 'root8', lo: 28, hi: 47 }, { by: { C: { style: 'root' } } }),
      dr('ドラム', 'acoustic', 'ABCO', { style: 'rock' }, { rev: 0.08, by: { C: { intensity: 0.3 } } }),
    ],
  },
  jazz: {
    label: 'ジャズ', desc: 'スウィングする小編成', bpm: [112, 150], mode: 'major', keys: ['C', 'F', 'Bb', 'Eb', 'G'],
    A: [['Dm7', 'G7', 'Cmaj7', 'A7'], ['Cmaj7', 'A7', 'Dm7', 'G7'], ['Dm7', 'G7', 'Em7', 'A7'], ['Cmaj7', 'Am7', 'Dm7', 'G7']],
    B: [['Fmaj7', 'Fm7', 'Em7', 'A7', 'Dm7', 'G7', 'Cmaj7', 'Cmaj7'], ['Em7', 'A7', 'Dm7', 'G7'], ['Fmaj7', 'G7', 'Em7', 'Am7']],
    C: [['Am7', 'D7', 'Dm7', 'G7']], cadence: 'G7', final: 'C69',
    tracks: [
      tr('piano', 'ピアノ', 'piano', 'harmony', 'IABCO', { type: 'chords', style: 'charleston', voicing: 'drop2', tensions: true, register: 60, swing: 0.33, vel: 0.55 }, { rev: 0.18, hum: { time: 0.008, vel: 0.06 } }),
      tr('mel', 'ビブラフォン', 'vibraphone', 'lead', 'ABO', { type: 'melody', density: 0.6, lo: 62, hi: 84, chromatic: 0.5, swing: 0.33, pickup: 0.7 }, { rev: 0.25, hum: { time: 0.008, vel: 0.06 }, by: { B: { density: 0.7 } } }),
      tr('bass', 'ベース', 'ebass', 'bass', 'IABCO', { type: 'bass', style: 'walking', lo: 31, hi: 52, swing: 0.33 }, { hum: { time: 0.006 }, by: { I: { style: 'half' } } }),
      dr('ドラム', 'acoustic', 'IABCO', { style: 'jazz' }, { rev: 0.1 }),
    ],
  },
  ballad: {
    label: 'バラード', desc: 'しっとり・感動', bpm: [62, 80], mode: 'major', keys: ['C', 'D', 'Eb', 'F', 'G', 'A'], tail: 3,
    A: [['C', 'G/B', 'Am', 'F'], ['C', 'Em', 'F', 'G'], ['C', 'Am', 'Dm', 'G'], ['F', 'G', 'Em', 'Am']],
    B: [['F', 'G', 'Em', 'Am', 'Dm', 'G', 'C', 'C'], ['F', 'G', 'C', 'Am'], ['Am', 'F', 'C', 'G']],
    C: [['Dm', 'Em', 'F', 'G'], ['Am', 'Em', 'F', 'G']], cadence: 'G', final: 'C',
    sends: { reverb: { size: 1.5, decay: 3 } },
    tracks: [
      tr('piano', 'ピアノ', 'softpiano', 'harmony', 'IABCO', { type: 'chords', style: 'ballad', register: 58, vel: 0.58 }, { rev: 0.3, hum: { time: 0.01, vel: 0.05 } }),
      tr('pad', 'ストリングス', 'strings', 'pad', 'aBC', { type: 'chords', style: 'pad', voicing: 'open', register: 64, vel: 0.5 }, { rev: 0.35 }),
      tr('mel', 'フルート', 'flute', 'lead', 'ABO', { type: 'melody', density: 0.3, lo: 64, hi: 84, pickup: 0.5 }, { rev: 0.35, del: 0.08, by: { B: { density: 0.42 }, O: { density: 0.2 } } }),
      tr('bass', 'ベース', 'ebass', 'bass', 'aBC', { type: 'bass', style: 'root', lo: 31, hi: 48 }, {}),
      dr('ドラム', 'acoustic', 'aB', { style: 'ballad' }, { rev: 0.15 }),
    ],
  },
  funk: {
    label: 'ファンク', desc: '跳ねるグルーヴ', bpm: [96, 116], mode: 'minor', scale: 'dorian', keys: ['E', 'A', 'D', 'G'],
    A: [['Am7', 'D7', 'Am7', 'D7'], ['Am7', 'Am7', 'D9', 'D9'], ['Am7', 'C', 'D', 'Am7'], ['Am9', 'Am9', 'Dm7', 'E7#9']],
    B: [['Dm7', 'Dm7', 'Am7', 'Am7'], ['Fmaj7', 'E7#9', 'Am7', 'Am7'], ['D7', 'D7', 'Am7', 'E7#9']],
    C: [['Fmaj7', 'Fmaj7', 'E7#9', 'E7#9']], cadence: 'E7#9', final: 'Am9',
    tracks: [
      tr('keys', 'エレピ', 'epiano', 'harmony', 'IABCO', { type: 'chords', style: 'funk', tensions: true, register: 62, vel: 0.6 }, { rev: 0.12, pan: -0.15, by: { I: { style: 'stab' }, C: { style: 'whole' } } }),
      tr('organ', 'オルガン', 'organ', 'pad', 'BC', { type: 'chords', style: 'pad', register: 64, maxNotes: 3, vel: 0.45 }, { rev: 0.15, pan: 0.2 }),
      tr('mel', 'ブラス', 'brass', 'lead', 'ABO', { type: 'melody', density: 0.5, lo: 60, hi: 80, scale: 'penta', form: 'ABAB' }, { rev: 0.15, by: { B: { density: 0.6 } } }),
      tr('bass', 'ベース', 'ebass', 'bass', 'IABCO', { type: 'bass', style: 'funk', lo: 28, hi: 47, chromatic: 0.3 }, { by: { I: { style: 'synco' }, C: { style: 'root' } } }),
      dr('ドラム', 'acoustic', 'ABCO', { style: 'funk' }, { rev: 0.06, by: { C: { intensity: 0.3 } } }),
    ],
  },
  '8bit': {
    label: '8bit', desc: 'ピコピコ・ゲーム風', bpm: [130, 165], mode: 'major', keys: ['C', 'D', 'F', 'G', 'A'], tail: 1.5,
    A: [['C', 'G', 'Am', 'F'], ['C', 'F', 'G', 'C'], ['C', 'Am', 'F', 'G'], ['F', 'G', 'Em', 'Am']],
    B: [['F', 'G', 'Em', 'Am'], ['Am', 'F', 'G', 'C'], ['F', 'G', 'C', 'C']],
    C: [['Am', 'G', 'F', 'G']], cadence: 'G', final: 'C',
    sends: { reverb: { size: 0.8, decay: 1.2 } },
    tracks: [
      tr('arp', 'アルペジオ', 'squarelead', 'harmony', 'IABCO', { type: 'arp', pattern: 'up', rate: '1/16', octaves: 2, register: 62, gate: 0.5, vel: 0.5, maxNotes: 3 }, { rev: 0.05, pan: -0.2, by: { I: { rate: '1/8' }, C: { rate: '1/8' } } }),
      tr('mel', 'メロディ', 'chip', 'lead', 'ABO', { type: 'melody', density: 0.7, lo: 67, hi: 88, scale: 'penta', pickup: 0.7, leap: 0.3 }, { rev: 0.08, del: 0.12, pan: 0.1, by: { B: { density: 0.8 } } }),
      tr('bass', 'ベース', 'fmbass', 'bass', 'ABCO', { type: 'bass', style: 'root8', lo: 33, hi: 52 }, { by: { B: { style: 'octave' } } }),
      dr('ドラム', '808', 'ABO', { style: 'pop' }, { fx: [{ type: 'crush', bits: 8, rate: 3, mix: 0.5 }] }),
    ],
  },
  ambient: {
    label: 'アンビエント', desc: '静か・瞑想・背景', bpm: [60, 76], mode: 'major', keys: ['C', 'D', 'F', 'G', 'A', 'Eb'], tail: 4,
    A: [['Cmaj7', 'Am7', 'Fmaj7', 'Fmaj7'], ['Fmaj7', 'Cmaj7', 'Fmaj7', 'G6'], ['Am7', 'Fmaj7', 'Cmaj7', 'Gsus4'], ['Cmaj7', 'Cmaj7', 'Fmaj7', 'Fmaj7']],
    B: [['Fmaj7', 'G6', 'Am7', 'Am7'], ['Dm7', 'Am7', 'Fmaj7', 'Cmaj7'], ['Fmaj7', 'Em7', 'Dm7', 'Cmaj7']],
    C: [['Dm7', 'Dm7', 'Fmaj7', 'Fmaj7']], cadence: 'Gsus4', final: 'Cmaj9',
    sends: { reverb: { size: 1.9, decay: 5, damp: 6000, predelay: 0.04 }, delay: { time: '1/4', feedback: 0.45 } },
    tracks: [
      tr('pad', 'パッド', 'airpad', 'pad', 'IABCO', { type: 'chords', style: 'pad', voicing: 'open', register: 60, vel: 0.55 }, { rev: 0.45 }),
      tr('glass', 'ガラス', 'glasspad', 'pad', 'BC', { type: 'chords', style: 'pad', register: 72, maxNotes: 2, vel: 0.45 }, { rev: 0.5, pan: 0.2 }),
      tr('bell', 'ベル', 'bellkeys', 'harmony', 'ABCO', { type: 'arp', pattern: 'random', rate: '1/4', octaves: 2, register: 69, gate: 2, accent: 'x..o.x..o...x.o.', vel: 0.5 }, { rev: 0.45, del: 0.3, pan: -0.2 }),
      tr('mel', 'ピアノ', 'softpiano', 'lead', 'BO', { type: 'melody', density: 0.1, lo: 67, hi: 86 }, { rev: 0.45, del: 0.2 }),
      tr('bass', '低音', 'subbass', 'bass', 'ABCO', { type: 'bass', style: 'root', lo: 33, hi: 48, approach: 0 }, {}),
    ],
  },
  trap: {
    label: 'トラップ', desc: '重い 808・ダーク', bpm: [130, 150], mode: 'minor', keys: ['C', 'D', 'E', 'F', 'G'],
    A: [['Am', 'Am', 'F', 'E'], ['Am', 'F', 'Dm', 'E'], ['Am', 'G', 'F', 'F'], ['Am', 'Am', 'Dm', 'Dm']],
    B: [['F', 'G', 'Am', 'Am'], ['Dm', 'E', 'Am', 'Am'], ['F', 'E', 'Am', 'Am']],
    C: [['Dm', 'Dm', 'E', 'E']], cadence: 'E', final: 'Am',
    sends: { reverb: { size: 1.4, decay: 2.6 }, delay: { time: '1/4', feedback: 0.35 } },
    tracks: [
      tr('bell', 'ベル', 'bellkeys', 'harmony', 'IABCO', { type: 'arp', pattern: 'converge', rate: '1/8', register: 67, gate: 1.5, vel: 0.55, accent: 'x.ox..x.x.o.x...' }, { rev: 0.3, del: 0.2 }),
      tr('pad', 'パッド', 'darkpad', 'pad', 'IBC', { type: 'chords', style: 'pad', register: 60, vel: 0.5 }, { rev: 0.3 }),
      tr('mel', 'リード', 'flute', 'lead', 'ABO', { type: 'melody', density: 0.3, lo: 67, hi: 86 }, { rev: 0.3, del: 0.2, by: { B: { density: 0.4 } } }),
      tr('bass', '808', 'bass808', 'bass', 'ABO', { type: 'bass', style: '808', lo: 31, hi: 46, approach: 0.3 }, {}),
      dr('ドラム', '808', 'ABO', { style: 'trap' }, { rev: 0.04 }),
    ],
  },
  corporate: {
    label: '企業VP', desc: '明るい・解説動画向け', bpm: [104, 124], mode: 'major', keys: ['C', 'D', 'E', 'G', 'A'],
    A: [['C', 'G', 'Am', 'F'], ['F', 'C', 'G', 'Am'], ['C', 'F', 'Am', 'G'], ['C', 'Am', 'F', 'G']],
    B: [['F', 'G', 'C', 'Am'], ['F', 'C', 'G', 'G'], ['Am', 'F', 'C', 'G']],
    C: [['Am', 'F', 'C', 'G'], ['Dm', 'F', 'C', 'G']], cadence: 'G', final: 'C',
    sends: { reverb: { size: 1.2, decay: 2 }, delay: { time: '1/8d', feedback: 0.35 } },
    tracks: [
      tr('pluck', 'ミュートギター', 'pluck', 'harmony', 'IABCO', { type: 'arp', pattern: 'as-played', rate: '1/8', register: 62, gate: 0.5, vel: 0.55, maxNotes: 3 }, { rev: 0.15, del: 0.25, pan: -0.2 }),
      tr('piano', 'ピアノ', 'piano', 'harmony', 'ABCO', { type: 'chords', style: 'half', register: 62, vel: 0.55 }, { rev: 0.2, pan: 0.15, by: { B: { style: 'quarters' }, C: { style: 'whole' }, O: { style: 'whole' } } }),
      tr('pad', 'ストリングス', 'strings', 'pad', 'BC', { type: 'chords', style: 'pad', voicing: 'open', register: 64, vel: 0.5 }, { rev: 0.3 }),
      tr('mel', 'ベル', 'bellkeys', 'lead', 'ABO', { type: 'melody', density: 0.35, lo: 67, hi: 86, scale: 'penta' }, { rev: 0.25, del: 0.15, by: { B: { density: 0.5 }, O: { density: 0.25 } } }),
      tr('bass', 'ベース', 'ebass', 'bass', 'ABCO', { type: 'bass', style: 'root', lo: 31, hi: 48 }, { by: { B: { style: 'root8' } } }),
      dr('ドラム', 'acoustic', 'aBO', { style: 'pop' }, { rev: 0.08 }),
    ],
  },
  kawaii: {
    label: 'かわいい', desc: 'ポップで軽やか・Vlog', bpm: [112, 138], mode: 'major', keys: ['C', 'D', 'F', 'G', 'A', 'Bb'], tail: 2,
    A: [['C', 'Am', 'F', 'G'], ['F', 'G', 'Em', 'Am'], ['C', 'F', 'C', 'G'], ['C', 'E7', 'Am', 'F']],
    B: [['F', 'G', 'Em', 'Am', 'F', 'G', 'C', 'C'], ['F', 'G', 'C', 'Am'], ['Dm', 'G', 'C', 'Am']],
    C: [['Am', 'Em', 'F', 'G']], cadence: 'G', final: 'C',
    sends: { reverb: { size: 1, decay: 1.6 } },
    tracks: [
      tr('marimba', 'マリンバ', 'marimba', 'harmony', 'IABCO', { type: 'chords', style: 'arp-comp', register: 62, vel: 0.6 }, { rev: 0.15, pan: -0.15, hum: { time: 0.005, vel: 0.06 } }),
      tr('pizz', 'ピチカート', 'pizz', 'harmony', 'ABC', { type: 'chords', style: 'offbeat', register: 64, maxNotes: 3, vel: 0.6 }, { rev: 0.18, pan: 0.2, by: { B: { style: 'quarters' } } }),
      tr('box', 'オルゴール', 'musicbox', 'harmony', 'Ba', { type: 'arp', pattern: 'up', rate: '1/8', octaves: 2, register: 74, gate: 0.9, vel: 0.45 }, { rev: 0.3, del: 0.15, pan: 0.3 }),
      tr('mel', 'グロッケン', 'glock', 'lead', 'ABO', { type: 'melody', density: 0.55, lo: 72, hi: 93, scale: 'penta', pickup: 0.7 }, { rev: 0.25, del: 0.1, by: { B: { density: 0.65 }, O: { density: 0.35 } } }),
      tr('bass', 'ベース', 'pluckbass', 'bass', 'ABCO', { type: 'bass', style: 'half', lo: 33, hi: 52 }, { by: { B: { style: 'synco' } } }),
      dr('パーカッション', 'acoustic', 'ABO', { style: 'light' }, { rev: 0.08, by: { B: { style: 'pop' } } }),
    ],
  },
  epic: {
    label: '壮大', desc: 'トレーラー・決戦', bpm: [96, 130], mode: 'minor', keys: ['D', 'E', 'C', 'A', 'G'], tail: 3.5,
    A: [['Am', 'F', 'C', 'G'], ['Am', 'C', 'G', 'Em'], ['Am', 'G', 'F', 'E'], ['Am', 'F', 'Dm', 'E']],
    B: [['F', 'G', 'Am', 'Am'], ['Am', 'F', 'C', 'G'], ['F', 'C', 'G', 'E']],
    C: [['Dm', 'Dm', 'E', 'E'], ['F', 'F', 'G', 'G']], cadence: 'E', final: 'Am',
    sends: { reverb: { size: 1.9, decay: 3.4, damp: 6500, predelay: 0.03 } },
    sfx: [['start', 'braam', -8], ['pre:B', 'riser', -6], ['at:B', 'impact', -4], ['end', 'boom', -6]],
    tracks: [
      tr('strings', 'ストリングス', 'strings', 'pad', 'IABCO', { type: 'chords', style: 'pad', voicing: 'wide', register: 60, vel: 0.65 }, { rev: 0.3 }),
      tr('ost', 'オスティナート', 'pizz', 'harmony', 'ABO', { type: 'chords', style: 'piano8', register: 60, maxNotes: 3, vel: 0.65 }, { rev: 0.2, by: { O: { style: 'quarters' } } }),
      tr('choir', 'クワイア', 'choir', 'pad', 'B', { type: 'chords', style: 'pad', register: 67, maxNotes: 3, vel: 0.55 }, { rev: 0.4 }),
      tr('mel', 'ブラス', 'brass', 'lead', 'ABO', { type: 'melody', density: 0.3, lo: 55, hi: 77 }, { rev: 0.3, by: { B: { density: 0.4 }, O: { density: 0.2 } } }),
      tr('bass', '低音', 'reese', 'bass', 'ABCO', { type: 'bass', style: 'root', lo: 33, hi: 48, approach: 0.2 }, { by: { B: { style: 'root8' } } }),
      dr('打楽器', 'cinematic', 'IABO', { style: 'cinematic' }, { rev: 0.2, by: { I: { intensity: 0.15, fill: 0 } } }),
    ],
  },
  tension: {
    label: '緊張', desc: 'サスペンス・不安', bpm: [90, 120], mode: 'minor', keys: ['D', 'E', 'C', 'A'], tail: 3,
    A: [['Am', 'Am', 'F/A', 'Am'], ['Am', 'Bb/A', 'Am', 'E/A'], ['Am', 'Dm/A', 'Am', 'E7/A'], ['Am', 'Am', 'Dm/A', 'Dm/A']],
    B: [['F', 'F', 'E', 'E'], ['Dm', 'Dm', 'E7', 'E7'], ['Am', 'F', 'Dm', 'E']],
    C: [['Am', 'Am', 'Am', 'Am']], cadence: 'E', final: 'Am',
    sends: { reverb: { size: 1.7, decay: 3.2, damp: 5500 }, delay: { time: '1/8d', feedback: 0.45 } },
    sfx: [['pre:B', 'riser', -10], ['end', 'downer', -8]],
    tracks: [
      tr('pad', 'パッド', 'darkpad', 'pad', 'IABCO', { type: 'chords', style: 'pad', register: 58, vel: 0.55 }, { rev: 0.35 }),
      tr('strings', '高弦', 'strings', 'pad', 'BC', { type: 'chords', style: 'pad', register: 74, maxNotes: 2, vel: 0.45 }, { rev: 0.4 }),
      tr('piano', 'ピアノ', 'piano', 'harmony', 'ABO', { type: 'arp', pattern: 'as-played', rate: '1/8', register: 64, gate: 0.5, vel: 0.5, maxNotes: 3 }, { rev: 0.3, del: 0.3, pan: 0.15 }),
      tr('mel', '旋律', 'softpiano', 'lead', 'BO', { type: 'melody', density: 0.15, lo: 57, hi: 74 }, { rev: 0.4, del: 0.2 }),
      tr('bass', 'ベース', 'synthbass', 'bass', 'IABCO', { type: 'bass', style: 'pedal8', lo: 33, hi: 48, gate: 0.6 }, { fx: [{ type: 'filter', kind: 'lp', freq: 900, q: 0.8 }], by: { I: { style: 'pedal' }, B: { style: 'root8' }, C: { style: 'pedal' } } }),
      dr('打楽器', 'cinematic', 'ABO', { style: 'cinematic' }, { rev: 0.2, scale: 0.6 }),
    ],
  },
  comedy: {
    label: 'コミカル', desc: 'おどけた・ゆかいな', bpm: [116, 150], mode: 'major', keys: ['C', 'F', 'G', 'Bb', 'D'], tail: 1.5,
    A: [['C', 'C', 'G7', 'G7', 'G7', 'G7', 'C', 'C'], ['C', 'A7', 'Dm', 'G7'], ['C', 'F', 'C', 'G7'], ['C', 'Am', 'Dm', 'G7']],
    B: [['F', 'F', 'C', 'C', 'G7', 'G7', 'C', 'C'], ['F', 'C', 'G7', 'C'], ['Dm', 'G7', 'C', 'A7']],
    C: [['Am', 'Am', 'E7', 'E7'], ['F', 'Fm', 'C', 'G7']], cadence: 'G7', final: 'C',
    sends: { reverb: { size: 0.9, decay: 1.4 } },
    sfx: [['pre:B', 'slide', -10], ['end', 'pon', -8]],
    tracks: [
      tr('pizz', 'ピチカート', 'pizz', 'harmony', 'IABCO', { type: 'chords', style: 'offbeat', register: 62, maxNotes: 3, vel: 0.65 }, { rev: 0.15, pan: -0.15 }),
      tr('mel', 'マリンバ', 'marimba', 'lead', 'ABO', { type: 'melody', density: 0.7, lo: 67, hi: 88, chromatic: 0.35, pickup: 0.8, leap: 0.3 }, { rev: 0.15, pan: 0.1, hum: { time: 0.005, vel: 0.06 }, by: { B: { density: 0.8 } } }),
      tr('bass', 'ベース', 'fmbass', 'bass', 'IABCO', { type: 'bass', style: 'half', lo: 33, hi: 52, approach: 0.6 }, {}),
      dr('ドラム', 'acoustic', 'ABCO', { style: 'twobeat' }, { rev: 0.08, by: { C: { intensity: 0.25 } } }),
    ],
  },
  acoustic: {
    label: 'アコースティック', desc: 'ギターのあたたかさ', bpm: [84, 112], mode: 'major', keys: ['C', 'D', 'E', 'G', 'A'], tail: 1.8,
    A: [['C', 'G', 'Am', 'F'], ['C', 'F', 'C', 'G'], ['Am', 'F', 'C', 'G'], ['C', 'Em', 'F', 'G'], ['C', 'G/B', 'Am', 'F']],
    B: [['F', 'G', 'C', 'Am'], ['F', 'C', 'G', 'G'], ['F', 'G', 'Em', 'Am']],
    C: [['Am', 'Em', 'F', 'G'], ['Dm', 'F', 'C', 'G']], cadence: 'G', final: 'C',
    sends: { reverb: { size: 1.2, decay: 2.4 } },
    tracks: [
      tr('nylon', 'ナイロンギター', 'nylon', 'harmony', 'IABCO', { type: 'chords', style: 'ballad', register: 57, vel: 0.62 }, { rev: 0.18, pan: -0.2, hum: { time: 0.008, vel: 0.06 } }),
      tr('guitar', 'ギター', 'guitar', 'harmony', 'aBC', { type: 'chords', style: 'strum', vel: 0.6 }, { rev: 0.15, pan: 0.2, hum: { time: 0.006, vel: 0.05 }, by: { C: { style: 'whole', voicing: 'guitar', maxNotes: 5 } } }),
      tr('mel', 'カリンバ', 'kalimba', 'lead', 'ABO', { type: 'melody', density: 0.45, lo: 67, hi: 88, scale: 'penta', pickup: 0.5 }, { rev: 0.25, del: 0.12, by: { B: { density: 0.55 }, O: { density: 0.3 } } }),
      tr('bass', 'ベース', 'ebass', 'bass', 'ABCO', { type: 'bass', style: 'half', lo: 31, hi: 48 }, { by: { B: { style: 'synco' } } }),
      dr('パーカッション', 'acoustic', 'ABO', { style: 'light' }, { rev: 0.1 }),
    ],
  },
};

/** スタイルの一覧（画面・コマンド用） */
export const STYLES = Object.entries(STYLE_DEFS).map(([id, s]) => ({ id, label: s.label, desc: s.desc, bpm: s.bpm, mode: s.scale || s.mode }));

// トラックの音量（dB）。tools で autoMix を数シードぶん回した平均（スタイル → トラック ID）
const VOL = {
  lofi: { keys: 0.5, pad: -6, mel: 1.5, bass: -3.5, drums: 4.5 },
  pop: { piano: -3, pad: -5.5, arp: 1, mel: 0.5, bass: -4.5, drums: 2.5 },
  edm: { chords: -0.5, arp: -1, mel: 1, bass: 3.5, drums: 2.5, fx: -6 },
  cinematic: { strings: -6, piano: 5, choir: -6, mel: 1, bass: -0.5, drums: 0, fx: -6 },
  wafu: { koto: 0.5, pad: -6.5, mel: 0.5, bass: -1, drums: 0.5 },
  rock: { guitar: -10.5, organ: -1.5, mel: -2, bass: -6, drums: 1.5 },
  jazz: { piano: 0, mel: 0, bass: -5, drums: 5.5 },
  ballad: { piano: -1.5, pad: -6, mel: 1, bass: -2, drums: 3 },
  funk: { keys: -5.5, organ: -2, mel: 0.5, bass: -4.5, drums: 2.5 },
  '8bit': { arp: 4.5, mel: 0, bass: -1, drums: -1 },
  ambient: { pad: -8, glass: -3.5, bell: 4, mel: 3, bass: -1 },
  trap: { bell: 0.5, pad: -6, mel: 0.5, bass: -1, drums: 1 },
  corporate: { pluck: 2, piano: -0.5, pad: -4.5, mel: -1, bass: -4.5, drums: 2.5 },
  kawaii: { marimba: 0, pizz: -4, box: 5, mel: 0, bass: 0, drums: 2.5 },
  epic: { strings: -7, ost: -6, choir: -6.5, mel: 1, bass: -0.5, drums: -0.5, fx: -6 },
  tension: { pad: -7.5, strings: -4.5, piano: 6, mel: 0, bass: 1.5, drums: 1.5, fx: -6 },
  comedy: { pizz: -5, mel: 0, bass: 0, drums: 3, fx: -6 },
  acoustic: { nylon: -1, guitar: -7.5, mel: 1, bass: -4, drums: 5 },
};
const ROLE_VOL = { drums: 2, bass: -2, lead: 0, harmony: -3, pad: -8, sfx: -8 };

const SEC_LABEL = { I: 'イントロ', A: 'A', B: 'サビ', C: 'ブリッジ', O: 'アウトロ', E: 'エンディング' };
const SEC_NAME = { I: 'intro', A: 'A', B: 'B', C: 'bridge', O: 'outro', E: 'ending' };
const SEC_LV = { I: 0.25, A: 0.5, B: 0.85, C: 0.35, O: 0.3 };
// 効果音の「山」までの秒数（length = 1 のとき）
const SFX_PEAK = { riser: 2.14, revcymbal: 1.49, slide: 0.15 };

/** 小節数から場面の並びを決める（4 小節のかたまりで考える） */
function planSections(body, loop) {
  const n = Math.floor(body / 4), rem = body % 4;
  let seq;
  if (n === 0) return [{ L: loop ? 'A' : 'B', bars: body }];
  if (loop) {
    const fixed = { 1: 'A', 2: 'AB', 3: 'AAB', 4: 'AABB', 5: 'AABBC', 6: 'AABBCB', 7: 'AABBCBB' };
    seq = fixed[n] || null;
    if (!seq) { seq = ''; let left = n; while (left >= 4) { seq += 'AABB'; left -= 4; } seq += ['', 'C', 'CC', 'CBB'][left]; }
  } else {
    const fixed = { 1: 'B', 2: 'AB', 3: 'IAB', 4: 'IABB', 5: 'IAABB', 6: 'IAABBO', 7: 'IAABBCB', 8: 'IAABBCBB', 9: 'IAABBCBBO', 10: 'IAABBAABBO', 11: 'IAABBCAABBO', 12: 'IAABBAABBCBB' };
    // 4 で割り切れないぶんは短いイントロにする（そのときは 4 小節のイントロを置かない）
    seq = rem ? (fixed[n + 1] || '').slice(1) || null : fixed[n] || null;
    if (!seq) {
      // 長い曲：A A B B をくり返し、最後のサビの前にブリッジ、終わりにアウトロ
      let left = n - 2; // イントロとアウトロ
      const cyc = [];
      while (left >= 4) { cyc.push('AABB'); left -= 4; }
      const last = cyc.pop();
      seq = 'I' + cyc.join('') + (left === 1 ? 'C' : left === 2 ? 'CC' : left === 3 ? 'CBB' : '') + last + 'O';
      if (left === 3) seq = 'I' + cyc.join('') + last + 'CBB' + 'O';
    }
  }
  // 同じ文字が続くところは 8 小節までまとめる
  const out = [];
  for (const L of seq) {
    const p = out[out.length - 1];
    if (p && p.L === L && p.bars < 8 && L !== 'I' && L !== 'O') p.bars += 4; else out.push({ L, bars: 4 });
  }
  // 4 で割り切れない小節はイントロ（なければ最初の場面の前）に足す
  if (rem) {
    if (out[0].L === 'I') out[0].bars = rem;
    else if (loop) out[out.length - 1].bars += rem;
    else out.unshift({ L: 'I', bars: rem });
  }
  return out;
}

const FLAT_MAJ = new Set([5, 10, 3, 8, 1, 6]), FLAT_MIN = new Set([2, 7, 0, 5, 10, 3]);

/** "Dm7 G7" → その小節の和音 [[小節内の拍, 記号], ...] */
function barChords(str, bpb) {
  const toks = String(str).trim().split(/\s+/).filter(Boolean);
  const out = [];
  toks.forEach((tk, i) => { if (!/^[.\-%]$/.test(tk)) out.push([(i * bpb) / toks.length, tk]); });
  return out;
}

/**
 * おまかせ作曲。opts: { style, key?, bpm?, bars? | seconds?, seed?, energy?(0〜1), loop?, structure?("IAABB" など), name? }
 * 戻り値：そのまま再生・書き出しできる曲の JSON（自動クリップと和音トラックでできている）。
 */
export function compose(opts = {}) {
  const sid = opts.style || 'pop';
  const st = STYLE_DEFS[sid];
  if (!st) throw new Error(`スタイル「${sid}」はありません（${Object.keys(STYLE_DEFS).join(', ')}）`);
  const seed = Number.isFinite(Number(opts.seed)) ? Number(opts.seed) : 1;
  const r = rng(hashSeed(`compose:${sid}:${seed}`));
  const energy = clamp(opts.energy ?? 0.6, 0, 1);
  const bpb = 4;
  const loop = !!opts.loop;

  // --- 調（乱数を引く順番は固定：長さを変えても同じ進行・同じメロディになるように） ---
  const autoRoot = pick(r, st.keys);
  const bpmAuto = Math.round(st.bpm[0] + (st.bpm[1] - st.bpm[0]) * clamp(0.15 + 0.5 * energy + (r() - 0.5) * 0.5, 0, 1));
  const want = parseKey(opts.key);
  if (opts.key && !want) throw new Error(`調「${opts.key}」が読めません（例：C major / A minor / D dorian / E yo）`);
  const stMinor = st.mode === 'minor';
  let P = st, scaleName = st.scale || (stMinor ? 'minor' : 'major');
  let minor = stMinor;
  if (want) {
    if (st.alt?.[want.name]) { P = { ...st, ...st.alt[want.name] }; scaleName = want.name; }
    else if (st.scale && want.name === st.scale) scaleName = st.scale;
    else if (want.minor !== stMinor || (st.scale && SCALES[st.scale].length < 7)) {
      // スタイルの得意な調と違う長調・短調を選んだとき：一般的な進行を使う
      minor = want.minor;
      P = { ...st, ...GENERIC[minor ? 'minor' : 'major'], alt: null };
      scaleName = want.iv.length >= 5 && want.name !== 'custom' ? want.name : minor ? 'minor' : 'major';
    } else scaleName = want.name !== 'custom' ? (want.name === 'major' || want.name === 'minor' ? scaleName : want.name) : scaleName;
  }
  const root = want ? want.root : pcOf(autoRoot);
  const refRoot = minor && !(st.scale && SCALES[st.scale].length < 7 && P === st) ? 9 : 0;
  const semis = mod12(root - refRoot);
  const flat = (minor ? FLAT_MIN : FLAT_MAJ).has(root);
  const rootName = (flat ? FLAT : SHARP)[root];
  const keyText = `${rootName} ${scaleName}`;
  const X = (sym) => transposeChord(sym, semis, flat);

  // --- 進行をえらぶ ---
  const progs = { A: pick(r, P.A), B: pick(r, P.B), C: pick(r, P.C || P.A) };
  const melSeed = { A: 1 + Math.floor(r() * 9000), B: 1 + Math.floor(r() * 9000), C: 1 + Math.floor(r() * 9000) };
  const bpm = clamp(Math.round(opts.bpm ?? bpmAuto), 30, 300);

  // --- 長さ ---
  const tail = loop ? 0 : st.tail ?? 2.5;
  const endBars = loop ? 0 : 1;
  let total;
  if (opts.bars) total = Math.max(endBars + 1, Math.round(opts.bars));
  else {
    const sec = opts.seconds ?? (loop ? (16 * bpb * 60) / bpm : 60);
    total = Math.max(endBars + 1, Math.round(((sec - Math.min(tail, sec * 0.4)) * bpm) / (60 * bpb)));
  }
  const body = total - endBars;
  let plan;
  if (typeof opts.structure === 'string' && /^[IABCO]+$/i.test(opts.structure)) {
    plan = [];
    for (const L of opts.structure.toUpperCase()) { const p = plan[plan.length - 1]; if (p && p.L === L && p.bars < 8 && L !== 'I' && L !== 'O') p.bars += 4; else plan.push({ L, bars: 4 }); }
    total = plan.reduce((a, s) => a + s.bars, 0) + endBars;
  } else plan = planSections(body, loop);

  // --- 場面ごとの和音 ---
  const seen = {};
  let at = 0;
  const sections = plan.map((s, i) => {
    const occ = (seen[s.L] = (seen[s.L] ?? 0) + 1);
    const lastB = s.L === 'B' && !plan.slice(i + 1).some((x) => x.L === 'B');
    let lv = SEC_LV[s.L] + (s.L === 'A' && occ > 1 ? 0.12 : 0) + (lastB && occ > 1 ? 0.1 : 0);
    lv = clamp(lv + (energy - 0.6) * 0.6, 0.05, 1);
    const src = s.L === 'I' || s.L === 'O' ? progs.A : progs[s.L];
    let bars = [];
    if (s.L === 'I') { for (let k = 0; k < s.bars; k++) bars.unshift(src[(((src.length - 1 - k) % src.length) + src.length) % src.length]); } // A の進行の後ろ側（A の頭へつながる）
    else if (src.length > s.bars && i === plan.length - 1) bars = src.slice(src.length - s.bars);
    else for (let k = 0; k < s.bars; k++) bars.push(src[k % src.length]);
    const sec = { L: s.L, name: SEC_NAME[s.L], label: SEC_LABEL[s.L], at, bars: s.bars, len: s.bars * bpb, occ, lv, chords: bars.map(X), last: i === plan.length - 1, first: i === 0 };
    at += sec.len;
    return sec;
  });
  const finalSym = X(P.final);
  if (!loop) {
    // 終わりの前の小節は、主和音へ戻りたくなる和音（ドミナントなど）にする
    const lastSec = sections[sections.length - 1];
    const lb = lastSec.chords.length - 1;
    const lastCh = parseChord(barChords(lastSec.chords[lb], bpb).pop()[1]);
    const rel = mod12(lastCh.root - root);
    if (![0, 7, 10, 5, 1].includes(rel)) lastSec.chords[lb] = X(P.cadence);
  }
  const chords = [];
  for (const s of sections) s.chords.forEach((str, b) => { for (const [dt, sym] of barChords(str, bpb)) { if (!chords.length || chords[chords.length - 1][1] !== sym) chords.push([s.at + b * bpb + dt, sym]); } });
  const endAt = at;
  if (!loop && (!chords.length || chords[chords.length - 1][1] !== finalSym)) chords.push([endAt, finalSym]);
  const tailBeats = (tail * bpm) / 60;
  const keyPcs = SCALES[scaleName].map((i) => mod12(root + i));

  // --- トラック ---
  const vols = VOL[sid] || {};
  const hasMel = st.tracks.some((t) => t.gen.type === 'melody');
  const activeIn = (t, s) => t.on.includes(s.L) || (t.on.includes(s.L.toLowerCase()) && s.occ > 1) || (t.gen.type === 'melody' && s.last && !loop) || sections.length === 1;
  const bassT = st.tracks.find((t) => t.role === 'bass');
  const bassOn = sections.map((s) => !!bassT && activeIn(bassT, s));
  const firstHarmony = st.tracks.findIndex((t) => t.role === 'harmony' && t.gen.type === 'chords');
  const tracks = st.tracks.map((t, ti) => {
    const isDrum = !!t.kit;
    const clips = [];
    const actives = sections.map((s) => activeIn(t, s));
    const lastActive = actives.lastIndexOf(true);
    sections.forEach((s, si) => {
      if (!actives[si]) return;
      const ov = t.by?.[s.L] || {};
      const g = { ...t.gen, ...ov, seed: seed * 1000 + ti * 10 + 'IABCO'.indexOf(s.L) };
      let len = s.len;
      if (g.type === 'drums') {
        if (g.intensity == null) g.intensity = Math.round(clamp(s.lv * (t.scale ?? 1), 0.05, 1) * 100) / 100;
        if (!s.first && s.lv >= 0.45 && 'AB'.includes(s.L) && g.crash == null) g.crash = true;
        if (s.bars < 2) g.fill = 0;
      } else if (g.type === 'melody') {
        g.seed = melSeed[s.L === 'O' || s.L === 'I' ? 'A' : s.L];
        if (g.density != null) g.density = Math.round(clamp(g.density + (energy - 0.6) * 0.25, 0.05, 1) * 100) / 100;
        if (s.last && !loop) { len += endBars * bpb; g.end = 'final'; }
        else if (si === lastActive && !loop) g.end = 'tonic';
      } else {
        if (g.vel != null && (s.L === 'I' || s.L === 'O')) g.vel = Math.round(g.vel * 0.9 * 100) / 100;
        // ベースが休んでいる場面では、伴奏の左手でルートを弾く
        if (g.type === 'chords' && t.role === 'harmony' && !bassOn[si] && g.root == null && g.style !== 'strum' && g.voicing !== 'guitar' && ti === firstHarmony) g.root = true;
      }
      clips.push({ at: s.at, len, gen: g });
    });
    // 終わりの和音を鳴らして伸ばす
    const lastSec = sections[sections.length - 1];
    if (!loop && actives[sections.length - 1]) {
      const g = { ...t.gen, ...(t.by?.[lastSec.L] || {}) };
      const ring = bpb + Math.min(tailBeats, 10);
      if (isDrum) clips.push({ at: endAt, len: bpb, grid: t.kit === 'cinematic' ? { tom3: 'X', crash: 'x' } : g.style === 'lofi' || g.style === 'light' || g.style === 'jazz' || g.style === 'bossa' ? { kick: 'x', crash: 'o' } : { kick: 'X', crash: 'X' } });
      else if (g.type === 'bass') {
        const fc = parseChord(finalSym);
        const p = placePc(fc.bass, midiOf(g.lo, 31), Math.max(midiOf(g.lo, 31) + 12, midiOf(g.hi, 50)), midiOf(g.lo, 31) + 7);
        clips.push({ at: endAt, len: bpb, notes: [[0, midiToName(p), ring, 0.8]] });
      } else if (g.type === 'chords' || g.type === 'arp') {
        const v = voiceChord(finalSym, { voicing: g.voicing || (g.style === 'strum' ? 'guitar' : 'close'), register: g.register ?? (g.type === 'arp' ? 64 : 60), maxNotes: g.maxNotes ?? (g.style === 'strum' ? 5 : 4), tensions: !!g.tensions }, null, keyPcs);
        // 分散和音・アルペジオ・ストロークの楽器は、下から順にさっと鳴らす
        // （分散和音はゆっくり上がって、いちばん上の音が 2〜3 拍目に鳴る：余韻が最後まで残る）
        const roll = g.type === 'arp' || g.style === 'arp-comp' ? 0.12 : g.style === 'ballad' ? 0.5 : g.style === 'strum' ? 0.04 : 0;
        if (g.style === 'ballad') { const fc = parseChord(finalSym); if (mod12(v[0]) !== fc.bass) v.unshift(placePc(fc.bass, v[0] - 11, v[0] - 1, v[0] - 6)); else v.push(v[0] + 12 > v[v.length - 1] ? v[0] + 12 : v[v.length - 1] + 12); }
        clips.push({ at: endAt, len: bpb, notes: v.map((p, k) => [Math.round(k * roll * 1000) / 1000, midiToName(p), ring - k * roll, 0.7]) });
      }
    }
    const out = { id: t.id, name: t.name };
    if (isDrum) { out.type = 'drums'; out.kit = t.kit; } else out.inst = t.inst;
    out.volume = vols[t.id] ?? ROLE_VOL[t.role] ?? -3;
    if (t.pan) out.pan = t.pan;
    const sends = {};
    if (t.rev) sends.reverb = t.rev;
    if (t.del) sends.delay = t.del;
    if (Object.keys(sends).length) out.sends = sends;
    if (t.hum) out.humanize = t.hum;
    if (t.fx) out.fx = JSON.parse(JSON.stringify(t.fx));
    out.clips = clips;
    return out;
  }).filter((t) => t.clips.length);

  // --- 効果音（場面の変わり目） ---
  if (st.sfx) {
    const clips = [];
    const barSec = (bpb * 60) / bpm;
    for (const [when, preset, gain] of st.sfx) {
      const [kind, L] = when.split(':');
      if (kind === 'start') clips.push({ at: 0, sfx: { preset }, gain });
      else if (kind === 'end') { if (!loop) clips.push({ at: endAt, sfx: { preset }, gain }); }
      else for (const s of sections) {
        if (s.L !== L || s.first) continue;
        if (kind === 'at') clips.push({ at: s.at, sfx: { preset }, gain });
        else {
          // 山が場面の頭に来るように、長さを 1〜2 小節に合わせて手前に置く
          const pk = SFX_PEAK[preset] ?? 1;
          const lead = Math.min(barSec * 2, 3.2, (s.at * 60) / bpm);
          const length = Math.round(clamp(lead / pk, 0.4, 2) * 100) / 100;
          const a = s.at - (pk * length * bpm) / 60;
          if (a >= 0) clips.push({ at: Math.round(a * 1000) / 1000, sfx: { preset, length }, gain });
        }
      }
    }
    if (clips.length) tracks.push({ id: 'fx', name: '効果音', type: 'sfx', volume: vols.fx ?? ROLE_VOL.sfx, sends: { reverb: 0.2 }, clips: clips.sort((a, b) => a.at - b.at) });
  }

  const song = {
    name: opts.name || `${st.label} #${seed}`,
    bpm, sig: [4, 4], bars: total, key: keyText,
    style: sid, seed,
    ...(loop ? { loop: true, tail: 0 } : { tail }),
    chords,
    sections: sections.map((s) => ({ at: s.at, len: s.len, name: s.name, label: s.label })).concat(loop ? [] : [{ at: endAt, len: endBars * bpb, name: 'ending', label: SEC_LABEL.E }]),
    sends: JSON.parse(JSON.stringify(st.sends || { reverb: { size: 1.2, decay: 2.2 } })),
    master: { loudness: -14, ...(loop ? {} : { fadeOut: tail }) },
    tracks,
    compose: { style: sid, seed, key: keyText, energy, bpm, ...(loop ? { loop: true } : {}), ...(opts.structure ? { structure: opts.structure } : {}) },
  };
  if (!hasMel) delete song.compose.melody;
  return opts.seconds && !opts.bars ? fitToLength(song, opts.seconds) : song;
}

/** 曲の長さ（小節）。bars がなければ中身から数える */
function songBars(song, bpb) {
  if (song.bars) return song.bars;
  let end = 0;
  for (const t of song.tracks || []) for (const c of t.clips || []) {
    const at = c.at ?? 0;
    const p = c.pattern ? song.patterns?.[c.pattern] : null;
    let len = c.len ?? p?.len;
    if (len == null) {
      len = 0;
      for (const x of [...(c.notes || []), ...(p?.notes || [])]) len = Math.max(len, Array.isArray(x) ? Number(x[0]) + Number(x[2] ?? 1) : Number(x.t ?? 0) + Number(x.d ?? 1));
      for (const line of Object.values(c.grid || p?.grid || {})) len = Math.max(len, String(line).replace(/\|/g, '').length * (c.res ?? p?.res ?? 0.25));
    }
    end = Math.max(end, at + len * Math.max(1, c.repeat ?? 1));
  }
  return Math.max(1, Math.ceil(end / bpb - 1e-6));
}

/**
 * 曲を「ちょうど seconds 秒」にする（動画の BGM 用）。余韻（tail）とフェードアウトも含めた長さ。
 * まず余韻の長さで合わせ、足りなければテンポを数 % だけ動かし、それでも合わなければ小節数を変える
 * （おまかせ作曲の曲は、その小節数で作り直す。手で直した内容は残らないので注意）。新しい曲を返す。
 */
export function fitToLength(song, seconds, opts = {}) {
  if (!(seconds > 0)) throw new Error(`長さ（秒）が不正です: ${seconds}`);
  const maxStretch = opts.maxStretch ?? 0.04;
  let s = JSON.parse(JSON.stringify(song));
  const [sn, sd] = s.sig || [4, 4];
  const bpb = (sn * 4) / sd;
  const loop = !!s.loop;
  const bpm0 = s.bpm || 120;
  const barSec = (bpb * 60) / bpm0;
  let bars = songBars(s, bpb);
  const tail0 = loop ? 0 : Math.min(s.tail ?? 3, seconds * 0.4);
  const tMin = loop ? 0 : tail0 * 0.6, tMax = loop ? 0 : Math.max(tail0 * 1.5, tail0 + 0.8);
  const need = (b) => { // この小節数にしたときのテンポの倍率（余韻で吸収したあと）
    const t = clamp(seconds - b * barSec, tMin, tMax);
    return (b * barSec) / (seconds - t);
  };
  if (Math.abs(need(bars) - 1) > maxStretch) {
    // 小節数を変える：テンポの変化がいちばん小さい小節数
    const guess = Math.max(1, Math.round((seconds - tail0) / barSec));
    let best = guess;
    for (const b of [guess - 1, guess, guess + 1]) if (b >= (loop ? 1 : 2) && Math.abs(need(b) - 1) < Math.abs(need(best) - 1)) best = b;
    if (best !== bars) {
      if (s.compose && !opts.noRecompose) {
        s = compose({ ...s.compose, bpm: bpm0, bars: best, name: s.name });
        if (song.id) s.id = song.id;
      } else s.bars = best;
      bars = best;
    }
  }
  s.bars = bars;
  const tail = clamp(seconds - bars * barSec, tMin, tMax);
  s.bpm = Math.round(((bars * bpb * 60) / (seconds - tail)) * 100) / 100;
  if (Math.abs(s.bpm - bpm0) < 0.006) s.bpm = bpm0;
  const real = loop ? 0 : Math.max(0, seconds - (bars * bpb * 60) / s.bpm);
  s.tail = Math.round(real * 1e4) / 1e4;
  s.master = { ...(s.master || {}), fadeOut: loop ? 0 : Math.round(Math.min(real, Math.max(1, real)) * 100) / 100 };
  if (loop) s.loopBars = [1, bars];
  return s;
}

/** 小節ごとの予定の和音（解析との照合用。render.mjs --expect に渡す）。分数コードは低音で書く */
export function expectedChords(song) {
  const [sn, sd] = song.sig || [4, 4];
  const bpb = (sn * 4) / sd;
  const list = chordList(song);
  const bars = songBars(song, bpb);
  const key = songKey(song);
  const out = [];
  for (let b = 0; b < bars; b++) {
    let cur = list[0];
    for (const c of list) { if (c.t <= b * bpb + 1e-6) cur = c; else break; }
    const pedal = cur && cur.ch.slash && cur.ch.bass === key.root; // 主音を低音に置いたままの和音は、低音で照合する
    out.push(cur ? (pedal ? SHARP[cur.ch.bass] : SHARP[cur.ch.root] + (cur.ch.minor ? 'm' : '')) : '');
  }
  return out;
}

/** 和音トラックを小節ごとの文字列にする（"C" / "Dm7 G7"。前の小節と同じなら ""） */
export function chordsToBars(song) {
  const [sn, sd] = song.sig || [4, 4];
  const bpb = (sn * 4) / sd;
  const bars = songBars(song, bpb);
  const src = (Array.isArray(song.chords) ? song.chords : []).map((c) => [Number(c[0]), String(c[1])]).sort((a, b) => a[0] - b[0]);
  const out = [];
  for (let b = 0; b < bars; b++) {
    const inBar = src.filter(([t]) => t >= b * bpb - 1e-6 && t < (b + 1) * bpb - 1e-6);
    if (!inBar.length) { out.push(''); continue; }
    // 小節を等分したマスに置けるなら "C . G ." のように書く
    let done = false;
    for (const div of [1, 2, 4, bpb, bpb * 2]) {
      const cell = bpb / div;
      if (!inBar.every(([t]) => Math.abs((t - b * bpb) / cell - Math.round((t - b * bpb) / cell)) < 1e-6)) continue;
      const cells = Array(div).fill('.');
      for (const [t, sym] of inBar) cells[Math.round((t - b * bpb) / cell)] = sym;
      out.push(cells.join(' '));
      done = true;
      break;
    }
    if (!done) out.push(inBar.map(([, sym]) => sym).join(' '));
  }
  return out;
}

/** 小節ごとの文字列から和音トラックを作る（"." "-" "%" と空は「前のまま」）。読めない記号は例外 */
export function barsToChords(bars, bpb = 4) {
  const out = [];
  bars.forEach((str, b) => {
    for (const [dt, sym] of barChords(str || '', bpb)) {
      try { parseChord(sym); } catch (e) { throw new Error(`${b + 1} 小節目：${e.message}`); }
      if (!out.length || out[out.length - 1][1] !== sym) out.push([Math.round((b * bpb + dt) * 1000) / 1000, sym]);
    }
  });
  return out;
}

/** 曲の構成と和音進行を文章にする（コマンドの表示用） */
export function describeSong(song) {
  const [sn, sd] = song.sig || [4, 4];
  const bpb = (sn * 4) / sd;
  const bars = chordsToBars(song);
  const lines = [`${song.name || ''}：${song.key || ''} ／ ${song.bpm} BPM ／ ${songBars(song, bpb)} 小節${song.loop ? '（ループ）' : ''}`];
  const secs = song.sections?.length ? song.sections : [{ at: 0, len: bars.length * bpb, label: '全体' }];
  let cur = '';
  for (const s of secs) {
    const b0 = Math.round(s.at / bpb), n = Math.round(s.len / bpb);
    const cs = [];
    for (let b = b0; b < b0 + n && b < bars.length; b++) { const x = bars[b].replace(/( \.)+$/g, '') || cur; cur = x.split(' ').filter((y) => y !== '.').pop() || cur; cs.push(bars[b] ? x : `(${cur})`); }
    lines.push(`  ${String(b0 + 1).padStart(3)}〜 ${(s.label || s.name || '').padEnd(6, '　')} ${n} 小節 | ${cs.join(' | ')}`);
  }
  for (const t of song.tracks || []) {
    const kinds = [...new Set((t.clips || []).map((c) => (c.gen ? `${c.gen.type}${c.gen.style ? ':' + c.gen.style : c.gen.pattern ? ':' + c.gen.pattern : ''}` : c.sfx ? `sfx:${c.sfx.preset}` : 'notes')))];
    lines.push(`  ${String(t.id).padEnd(8)} ${String(typeof t.inst === 'string' ? t.inst : t.inst?.preset || t.kit || t.type || '').padEnd(11)} ${String(t.volume).padStart(5)} dB  ${kinds.join(' ')}`);
  }
  return lines.join('\n');
}
