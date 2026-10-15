/*
 * プロジェクト JSON のチェック。手書き（AI が書いたもの）の書き間違いを、分かりやすい日本語で知らせる。
 * errors：このままだと正しく作れない / warnings：無視されるなど、意図と違うかもしれない
 */
import { TRANSITIONS, TEXT_STYLES } from './project.js';
import { SHAPES, EFFECTS, EASINGS, ANIM_PROPS, GRADIENTS } from './fx.js';

const ANIM_TEXT = ['none', 'fade', 'pop', 'slide', 'typewriter'];
const ANIM_SHAPE = ['none', 'fade', 'pop', 'slide', 'spin', 'wipe'];
const LOOPS = ['none', 'pulse', 'float', 'spin', 'blink', 'shake'];
const FONTS = ['gothic', 'rounded', 'mincho'];
const CUTOUT = ['person', 'object', 'chroma'];

const KEYS = {
  top: ['version', 'id', 'name', 'width', 'height', 'fps', 'background', 'fadeOut', 'media', 'clips', 'texts', 'audios', 'overlays', 'shapes', 'effects', 'updatedAt'],
  media: ['id', 'name', 'kind', 'duration', 'width', 'height', 'hasAudio', 'silences'],
  clip: ['id', 'media', 'in', 'out', 'speed', 'volume', 'fit', 'zoom', 'x', 'y', 'kenburns', 'filter', 'transition', 'cutout'],
  text: ['id', 'text', 'start', 'end', 'style', 'font', 'color', 'stroke', 'strokeWidth', 'strokes', 'bg', 'shadow', 'glow', 'extrude', 'size', 'x', 'y', 'anim', 'animOut', 'opacity', 'rotation', 'scale', 'rx', 'ry', 'perspective', 'to', 'keys', 'ease'],
  shape: ['id', 'kind', 'start', 'end', 'x', 'y', 'w', 'h', 'rotation', 'fill', 'stroke', 'strokeWidth', 'radius', 'opacity', 'shadow', 'anim', 'animOut', 'loop', 'scale', 'rx', 'ry', 'perspective', 'to', 'keys', 'ease'],
  overlay: ['id', 'media', 'start', 'in', 'out', 'speed', 'volume', 'x', 'y', 'w', 'rotation', 'opacity', 'scale', 'rx', 'ry', 'perspective', 'mask', 'radius', 'border', 'borderColor', 'shadow', 'anim', 'animOut', 'loop', 'keys', 'to', 'ease', 'cutout'],
  effect: ['id', 'type', 'start', 'end', 'intensity'],
  audio: ['id', 'media', 'start', 'in', 'out', 'volume', 'fadeIn', 'fadeOut', 'loop'],
};

export function validateProject(p) {
  const errors = [], warnings = [];
  const err = (path, msg) => errors.push(`${path}: ${msg}`);
  const warn = (path, msg) => warnings.push(`${path}: ${msg}`);
  const list = (a) => a.join(' / ');
  const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

  if (!p || typeof p !== 'object') return { errors: ['JSON がオブジェクトではありません'], warnings };
  const unknown = (obj, kind, path) => {
    for (const k of Object.keys(obj || {})) if (!KEYS[kind].includes(k)) warn(`${path}.${k}`, '知らない項目なので無視されます');
  };
  const enumOf = (v, opts, path) => { if (v != null && !opts.includes(v)) err(path, `「${v}」は使えません（${list(opts)}）`); };
  const num = (v, path, { min, max } = {}) => {
    if (v == null) return;
    if (!isNum(v)) return err(path, `数値で指定してください（今は ${JSON.stringify(v)}）`);
    if (min != null && v < min) warn(path, `${v} は小さすぎます（${min} 以上）`);
    if (max != null && v > max) warn(path, `${v} は大きすぎます（${max} 以下）`);
  };
  const color = (v, path) => {
    if (v == null) return;
    if (typeof v === 'string') {
      if (v.startsWith('gradient:') && !GRADIENTS[v.slice(9)]) err(path, `グラデーション「${v.slice(9)}」はありません（${list(Object.keys(GRADIENTS))}）`);
      return;
    }
    if (typeof v === 'object' && Array.isArray(v.colors)) return;
    err(path, '色は "#rrggbb"、"gradient:名前"、{ "colors": [...], "angle": 90 } のどれかで指定してください');
  };
  const timing = (it, path, end) => {
    num(it.start, `${path}.start`, { min: 0 });
    if (end != null && isNum(it.start) && isNum(end) && end <= it.start) err(path, `終わり（${end}）が始まり（${it.start}）より前です`);
  };
  const motion = (it, path, dur) => {
    if (it.to != null && typeof it.to !== 'object') err(`${path}.to`, 'オブジェクトで指定してください');
    if (it.to) for (const k of Object.keys(it.to)) if (!ANIM_PROPS.includes(k)) warn(`${path}.to.${k}`, `動かせる項目は ${list(ANIM_PROPS)} です`);
    enumOf(it.ease, Object.keys(EASINGS), `${path}.ease`);
    if (it.keys != null) {
      if (!Array.isArray(it.keys)) return err(`${path}.keys`, '配列で指定してください');
      it.keys.forEach((k, i) => {
        if (!isNum(k.t)) err(`${path}.keys[${i}].t`, 'キーの時刻 t（開始からの秒）が必要です');
        else if (dur != null && (k.t < 0 || k.t > dur + 1e-6)) warn(`${path}.keys[${i}].t`, `表示時間（0〜${dur.toFixed(2)}秒）の外です`);
        for (const key of Object.keys(k)) if (key !== 't' && key !== 'ease' && !ANIM_PROPS.includes(key)) warn(`${path}.keys[${i}].${key}`, `動かせる項目は ${list(ANIM_PROPS)} です`);
        enumOf(k.ease, Object.keys(EASINGS), `${path}.keys[${i}].ease`);
      });
    }
  };
  const media = p.media || {};
  const mediaRef = (id, path) => { if (!media[id]) err(path, `素材「${id}」が media にありません`); };
  const cutoutCheck = (c, path) => {
    if (!c) return;
    enumOf(c.mode, CUTOUT, `${path}.mode`);
    if (c.mode === 'object' && (!isNum(c.x) || !isNum(c.y))) warn(path, 'object（タップした物）は x, y（素材の中の位置 0〜1）を指定すると確実です');
  };

  unknown(p, 'top', 'project');
  num(p.width, 'width', { min: 16, max: 4096 });
  num(p.height, 'height', { min: 16, max: 4096 });
  if (p.fps != null && ![24, 25, 30, 50, 60].includes(p.fps)) warn('fps', '24 / 30 / 60 のどれかがおすすめです');

  for (const [id, m] of Object.entries(media)) {
    unknown(m, 'media', `media.${id}`);
    if (!m.name) err(`media.${id}`, 'name（ファイル名）が必要です');
  }
  (p.clips || []).forEach((c, i) => {
    const path = `clips[${i}]`;
    unknown(c, 'clip', path);
    mediaRef(c.media, `${path}.media`);
    num(c.in, `${path}.in`, { min: 0 });
    if (isNum(c.in) && isNum(c.out) && c.out <= c.in) err(path, `out（${c.out}）は in（${c.in}）より後にしてください`);
    const d = media[c.media]?.duration;
    if (d && media[c.media]?.kind !== 'image' && isNum(c.out) && c.out > d + 0.05) warn(`${path}.out`, `素材の長さ（${d.toFixed(2)}秒）を超えています`);
    num(c.speed, `${path}.speed`, { min: 0.1, max: 8 });
    enumOf(c.fit, ['cover', 'contain'], `${path}.fit`);
    if (c.transition) enumOf(c.transition.type, Object.keys(TRANSITIONS), `${path}.transition.type`);
    cutoutCheck(c.cutout, `${path}.cutout`);
  });
  (p.texts || []).forEach((t, i) => {
    const path = `texts[${i}]`;
    unknown(t, 'text', path);
    if (typeof t.text !== 'string') err(`${path}.text`, '文字列で指定してください');
    timing(t, path, t.end);
    enumOf(t.style, Object.keys(TEXT_STYLES), `${path}.style`);
    enumOf(t.font, FONTS, `${path}.font`);
    enumOf(t.anim, ANIM_TEXT, `${path}.anim`);
    color(t.color, `${path}.color`);
    color(t.bg, `${path}.bg`);
    num(t.size, `${path}.size`, { min: 0.01, max: 0.5 });
    motion(t, path, t.end - t.start);
  });
  (p.shapes || []).forEach((s, i) => {
    const path = `shapes[${i}]`;
    unknown(s, 'shape', path);
    enumOf(s.kind, Object.keys(SHAPES), `${path}.kind`);
    timing(s, path, s.end);
    enumOf(s.anim, ANIM_SHAPE, `${path}.anim`);
    enumOf(s.loop, LOOPS, `${path}.loop`);
    color(s.fill, `${path}.fill`);
    motion(s, path, s.end - s.start);
  });
  (p.overlays || []).forEach((o, i) => {
    const path = `overlays[${i}]`;
    unknown(o, 'overlay', path);
    mediaRef(o.media, `${path}.media`);
    num(o.start, `${path}.start`, { min: 0 });
    if (isNum(o.in) && isNum(o.out) && o.out <= o.in) err(path, `out（${o.out}）は in（${o.in}）より後にしてください`);
    enumOf(o.mask, ['none', 'round', 'circle'], `${path}.mask`);
    enumOf(o.anim, ANIM_SHAPE, `${path}.anim`);
    enumOf(o.loop, LOOPS, `${path}.loop`);
    cutoutCheck(o.cutout, `${path}.cutout`);
    const dur = isNum(o.in) && isNum(o.out) ? (o.out - o.in) / (o.speed || 1) : null;
    motion(o, path, dur);
  });
  (p.effects || []).forEach((e, i) => {
    const path = `effects[${i}]`;
    unknown(e, 'effect', path);
    enumOf(e.type, Object.keys(EFFECTS), `${path}.type`);
    timing(e, path, e.end);
    num(e.intensity, `${path}.intensity`, { min: 0, max: 1 });
  });
  (p.audios || []).forEach((a, i) => {
    const path = `audios[${i}]`;
    unknown(a, 'audio', path);
    mediaRef(a.media, `${path}.media`);
    num(a.start, `${path}.start`, { min: 0 });
    num(a.volume, `${path}.volume`, { min: 0, max: 4 });
  });
  return { errors, warnings };
}
