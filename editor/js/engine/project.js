/*
 * つなぐ — プロジェクトのデータ構造とタイムライン計算。
 * プロジェクトはただの JSON なので、人が UI で編集しても、Claude などが直接書いても同じように扱える。
 * 形式の説明は editor/PROJECT_FORMAT.md を参照。
 */

export const FORMAT_VERSION = 1;

export const PRESETS = {
  shorts: { label: 'ショート・リール・TikTok', ratio: '9:16', width: 1080, height: 1920 },
  youtube: { label: 'YouTube（横）', ratio: '16:9', width: 1920, height: 1080 },
  square: { label: '正方形', ratio: '1:1', width: 1080, height: 1080 },
  portrait: { label: 'インスタ縦長', ratio: '4:5', width: 1080, height: 1350 },
};

export const TRANSITIONS = {
  none: { label: 'なし', overlap: false },
  fade: { label: 'クロスフェード', overlap: true },
  black: { label: '黒にフェード', overlap: false },
  white: { label: '白にフェード', overlap: false },
  slide: { label: 'スライド', overlap: true },
  wipe: { label: 'ワイプ', overlap: true },
  zoom: { label: 'ズーム', overlap: true },
  flip: { label: '3Dフリップ', overlap: true },
  cube: { label: '3Dキューブ', overlap: true },
};

export const uid = (p = 'x') => p + Math.random().toString(36).slice(2, 9);

export function newProject(preset = 'shorts') {
  const pr = PRESETS[preset] || PRESETS.shorts;
  return {
    version: FORMAT_VERSION,
    id: uid('p'),
    name: '新しい動画',
    width: pr.width,
    height: pr.height,
    fps: 30,
    background: '#000000',
    fadeOut: 0,
    media: {},
    clips: [],
    texts: [],
    audios: [],
    overlays: [],
    motions: [],
    shapes: [],
    effects: [],
    updatedAt: Date.now(),
  };
}

export function newShape(start, kind = 'round', opts = {}) {
  const square = ['circle', 'ring', 'star', 'heart', 'burst', 'check', 'triangle'].includes(kind);
  const wide = kind === 'arrow' || kind === 'line' || kind === 'bubble';
  return {
    id: uid('s'),
    kind,
    start,
    end: start + 3,
    x: 0.5,
    y: 0.5,
    w: wide ? 0.5 : square ? 0.3 : 0.45,
    h: kind === 'line' ? 0.06 : kind === 'arrow' ? 0.16 : kind === 'bubble' ? 0.32 : square ? 0.3 : 0.25,
    rotation: 0,
    fill: kind === 'bubble' ? '#ffffff' : '#ff7a3d',
    stroke: kind === 'bubble' ? '#111111' : null,
    strokeWidth: kind === 'bubble' ? 0.008 : 0.01,
    radius: 0.3,
    opacity: 1,
    shadow: false,
    anim: 'pop',
    loop: 'none',
    to: null,
    ease: 'ease',
    ...opts,
  };
}

/** 画面に重ねる動画・写真（ワイプ / PiP） */
export function newOverlay(media, start = 0, opts = {}) {
  const isImg = media.kind === 'image';
  return {
    id: uid('o'),
    media: media.id,
    start,
    in: 0,
    out: isImg ? 3 : media.duration,
    speed: 1,
    volume: 1,
    x: 0.72,
    y: 0.28,
    w: 0.42,
    rotation: 0,
    opacity: 1,
    scale: 1,
    rx: 0,
    ry: 0,
    mask: 'round',
    radius: 0.08,
    border: 0.006,
    borderColor: '#ffffff',
    shadow: true,
    anim: 'pop',
    loop: 'none',
    keys: null,
    ease: 'ease',
    cutout: null,
    ...opts,
  };
}

/** Motion Prompt の要素（#001〜）を画面に置く */
export function newMotion(ref, start = 0, cycle = 4.7, opts = {}) {
  return {
    id: uid('mo'),
    ref: String(ref).replace(/^#/, '').padStart(3, '0'),
    start,
    end: start + cycle,
    x: 0.5,
    y: 0.5,
    w: 1,
    cover: false,
    mode: 'loop',
    hold: null,
    speed: 1,
    offset: 0,
    transparent: false,
    colors: null,
    opacity: 1,
    rotation: 0,
    scale: 1,
    rx: 0,
    ry: 0,
    anim: 'none',
    loop: 'none',
    keys: null,
    ease: 'ease',
    ...opts,
  };
}

export const overlayEnd = (o) => o.start + Math.max(0.05, (o.out - o.in) / (o.speed || 1));

export function newEffect(start, type = 'flash', opts = {}) {
  return { id: uid('e'), type, start, end: start + (type === 'flash' ? 0.6 : 2), intensity: 0.6, ...opts };
}

export function newClip(media, opts = {}) {
  const dur = media.kind === 'image' ? 3 : media.duration;
  return {
    id: uid('c'),
    media: media.id,
    in: 0,
    out: dur,
    speed: 1,
    volume: 1,
    fit: 'cover',
    zoom: 1,
    x: 0,
    y: 0,
    kenburns: media.kind === 'image',
    filter: { brightness: 1, contrast: 1, saturation: 1 },
    transition: { type: 'none', duration: 0.5 },
    ...opts,
  };
}

export const TEXT_STYLES = {
  telop: { label: 'テロップ', font: 'gothic', color: '#ffffff', stroke: '#000000', strokeWidth: 0.18, bg: null, shadow: false, size: 0.075 },
  yellow: { label: '強調（黄）', font: 'gothic', color: '#ffe14d', stroke: '#1a1a1a', strokeWidth: 0.2, bg: null, shadow: false, size: 0.085 },
  subtitle: { label: '字幕', font: 'gothic', color: '#ffffff', stroke: null, strokeWidth: 0, bg: 'rgba(0,0,0,0.6)', shadow: false, size: 0.05 },
  title: { label: 'タイトル', font: 'gothic', color: '#ffffff', stroke: null, strokeWidth: 0, bg: null, shadow: true, size: 0.11 },
  pop: { label: 'ポップ', font: 'rounded', color: '#ffffff', stroke: '#ff4f8b', strokeWidth: 0.22, bg: null, shadow: false, size: 0.085 },
  elegant: { label: '明朝', font: 'mincho', color: '#ffffff', stroke: null, strokeWidth: 0, bg: null, shadow: true, size: 0.07 },
  label: { label: '帯ラベル', font: 'gothic', color: '#111111', stroke: null, strokeWidth: 0, bg: '#ffe14d', shadow: false, size: 0.055 },
  gold: { label: 'ゴールド', font: 'gothic', color: 'gradient:gold', stroke: '#5a3a00', strokeWidth: 0.08, strokes: [{ color: '#ffffff', width: 0.2 }], bg: null, shadow: true, extrude: { depth: 0.1, color: '#6b4500', angle: 120 }, size: 0.1 },
  neon: { label: 'ネオン', font: 'rounded', color: '#ffffff', stroke: '#ff2bd6', strokeWidth: 0.06, bg: null, shadow: false, glow: { color: '#ff2bd6', size: 0.5 }, size: 0.085 },
  rainbow: { label: 'レインボー', font: 'rounded', color: 'gradient:rainbow', stroke: '#ffffff', strokeWidth: 0.16, bg: null, shadow: true, size: 0.09 },
  pop3d: { label: '立体', font: 'gothic', color: '#ffe14d', stroke: '#111111', strokeWidth: 0.08, bg: null, shadow: false, extrude: { depth: 0.14, color: '#e8590c', angle: 135 }, size: 0.1 },
  double: { label: '二重ふち', font: 'gothic', color: '#ff4f8b', stroke: '#ffffff', strokeWidth: 0.12, strokes: [{ color: '#111111', width: 0.24 }], bg: null, shadow: false, size: 0.085 },
};

export function newText(start, opts = {}) {
  const st = TEXT_STYLES.telop;
  return {
    id: uid('t'),
    text: 'テキスト',
    start,
    end: start + 3,
    style: 'telop',
    font: st.font,
    color: st.color,
    stroke: st.stroke,
    strokeWidth: st.strokeWidth,
    bg: st.bg,
    shadow: st.shadow,
    size: st.size,
    x: 0.5,
    y: 0.8,
    anim: 'pop',
    ...opts,
  };
}

export function newAudio(media, start = 0, opts = {}) {
  return {
    id: uid('a'),
    media: media.id,
    start,
    in: 0,
    out: media.duration,
    volume: 0.6,
    fadeIn: 0,
    fadeOut: 1,
    loop: false,
    ...opts,
  };
}

/* ---------- タイムライン計算 ---------- */

const clipDur = (c) => Math.max(0.05, (c.out - c.in) / (c.speed || 1));

/**
 * メイントラックの各クリップの配置を計算する。
 * 重なるトランジション（クロスフェード等）は前のクリップと duration 分だけ重ねて配置する。
 * @returns {{clip, index, start, end, dur, tIn: {type, d}}[]}
 */
export function layoutClips(project) {
  const out = [];
  let t = 0;
  project.clips.forEach((clip, i) => {
    const dur = clipDur(clip);
    const tr = clip.transition || { type: 'none', duration: 0 };
    let d = TRANSITIONS[tr.type] && tr.type !== 'none' ? Math.max(0, tr.duration || 0) : 0;
    const prev = out[i - 1];
    const overlap = TRANSITIONS[tr.type]?.overlap && prev;
    if (overlap) d = Math.min(d, prev.dur / 2, dur / 2);
    else if (prev) d = Math.min(d, prev.dur, dur);
    else d = Math.min(d, dur / 2);
    const start = overlap ? t - d : t;
    out.push({ clip, index: i, start, end: start + dur, dur, tIn: { type: d > 0 ? tr.type : 'none', d } });
    t = start + dur;
  });
  return out;
}

export function projectDuration(project, layout = layoutClips(project)) {
  let d = layout.length ? layout[layout.length - 1].end : 0;
  for (const t of project.texts) d = Math.max(d, t.end);
  for (const s of project.shapes || []) d = Math.max(d, s.end);
  for (const o of project.overlays || []) d = Math.max(d, overlayEnd(o));
  for (const m of project.motions || []) d = Math.max(d, m.end);
  for (const e of project.effects || []) d = Math.max(d, e.end);
  if (!d) {
    for (const a of project.audios) d = Math.max(d, a.start + (a.out - a.in));
  }
  return d;
}

/** 時刻 t に表示するクリップと、それぞれの描画パラメータ */
export function activeClipsAt(layout, t) {
  const res = [];
  for (let i = 0; i < layout.length; i++) {
    const L = layout[i];
    const next = layout[i + 1];
    // 黒/白フェードは境目の前後 d/2 ずつ。前のクリップは境目まで表示。
    if (t < L.start || t >= L.end) {
      // 最後のフレーム（t === end）は最後のクリップを表示
      if (!(i === layout.length - 1 && t >= L.end && t <= L.end + 1e-6)) continue;
    }
    const item = { L, alpha: 1, offsetX: 0, clipRect: null, scale: 1, under: false };
    const tr = L.tIn;
    if (tr.d > 0 && TRANSITIONS[tr.type].overlap && i > 0 && t < L.start + tr.d) {
      const p = (t - L.start) / tr.d;
      if (tr.type === 'fade') item.alpha = p;
      if (tr.type === 'slide') item.offsetX = 1 - easeInOut(p);
      if (tr.type === 'wipe') item.clipRect = easeInOut(p);
      if (tr.type === 'zoom') { item.alpha = p; item.scale = 1.3 - 0.3 * easeOut(p); }
      // 3D：前半は前のクリップが回って消え、後半にこのクリップが回って出てくる
      if (tr.type === 'flip') { if (p < 0.5) item.hidden = true; else item.ry = -90 * (1 - easeOut((p - 0.5) * 2)); }
      if (tr.type === 'cube') { item.ry = -90 * (1 - easeInOut(p)); item.cube = true; }
    }
    // 次のクリップがズームで入ってくるとき、前のクリップも少し拡大
    if (next && next.tIn.type === 'zoom' && t >= next.start) {
      const p = (t - next.start) / next.tIn.d;
      item.scale = 1 + 0.15 * easeIn(Math.min(1, p));
    }
    if (next && next.tIn.d > 0 && t >= next.start && (next.tIn.type === 'flip' || next.tIn.type === 'cube')) {
      const p = Math.min(1, (t - next.start) / next.tIn.d);
      if (next.tIn.type === 'flip') { if (p >= 0.5) item.hidden = true; else item.ry = 90 * easeIn(p * 2); }
      else { item.ry = 90 * easeInOut(p); item.cube = true; }
    }
    if (!item.hidden) res.push(item);
  }
  return res;
}

/** 黒/白フェード、最後のフェードアウトの色かぶせ量 */
export function dipAt(project, layout, t) {
  let best = null;
  for (let i = 0; i < layout.length; i++) {
    const L = layout[i];
    const tr = L.tIn;
    if (tr.d <= 0 || (tr.type !== 'black' && tr.type !== 'white')) continue;
    const color = tr.type === 'black' ? '#000000' : '#ffffff';
    const half = i === 0 ? tr.d : tr.d / 2;
    let a = 0;
    if (i === 0) {
      if (t < L.start + half) a = 1 - (t - L.start) / half;
    } else if (t >= L.start - half && t < L.start + half) {
      a = 1 - Math.abs(t - L.start) / half;
    }
    if (a > 0 && (!best || a > best.alpha)) best = { color, alpha: Math.min(1, a) };
  }
  const total = projectDuration(project, layout);
  if (project.fadeOut > 0 && t > total - project.fadeOut) {
    const a = Math.min(1, (t - (total - project.fadeOut)) / project.fadeOut);
    if (!best || a > best.alpha) best = { color: '#000000', alpha: a };
  }
  return best;
}

/** クリップ内の素材の時刻 */
export function mediaTime(L, t) {
  const c = L.clip;
  return Math.min(c.out, Math.max(c.in, c.in + (t - L.start) * (c.speed || 1)));
}

export const easeInOut = (p) => (p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2);
export const easeOut = (p) => 1 - (1 - p) ** 3;
export const easeIn = (p) => p * p * p;

/** 使われていない素材を除いた media 一覧 */
export function usedMediaIds(project) {
  const s = new Set();
  for (const c of project.clips) s.add(c.media);
  for (const a of project.audios) s.add(a.media);
  for (const o of project.overlays || []) s.add(o.media);
  return s;
}

const defined = (o) => Object.fromEntries(Object.entries(o || {}).filter(([, v]) => v !== undefined));

/** 古い形式や手書き JSON の欠けている項目を補う */
export function normalizeProject(p) {
  const base = newProject();
  const proj = { ...base, ...p, media: { ...(p.media || {}) } };
  proj.clips = (p.clips || []).map((c) => {
    const m = proj.media[c.media] || { kind: 'video', duration: c.out ?? 3 };
    const d = newClip({ id: c.media, ...m });
    c = defined(c);
    return { ...d, ...c, filter: { ...d.filter, ...defined(c.filter) }, transition: { ...d.transition, ...defined(c.transition) } };
  });
  proj.texts = (p.texts || []).map((t) => {
    const st = TEXT_STYLES[t.style] || TEXT_STYLES.telop;
    return newText(t.start ?? 0, { ...st, label: undefined, ...defined(t), style: t.style || 'telop' });
  });
  proj.audios = (p.audios || []).map((a) => {
    const m = proj.media[a.media] || { duration: a.out ?? 0 };
    return newAudio({ id: a.media, ...m }, a.start ?? 0, defined(a));
  });
  for (const t of proj.texts) delete t.label;
  proj.shapes = (p.shapes || []).map((x) => newShape(x.start ?? 0, x.kind || 'round', defined(x)));
  proj.effects = (p.effects || []).map((x) => newEffect(x.start ?? 0, x.type || 'flash', defined(x)));
  proj.motions = (p.motions || []).map((m) => newMotion(m.ref ?? '001', m.start ?? 0, 4.7, defined(m)));
  proj.overlays = (p.overlays || []).map((o) => {
    const m = proj.media[o.media] || { id: o.media, kind: 'video', duration: o.out ?? 3 };
    return newOverlay({ id: o.media, ...m }, o.start ?? 0, defined(o));
  });
  return proj;
}
