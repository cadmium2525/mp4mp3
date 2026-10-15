/*
 * 図形・エフェクト・動き（to で指定する移動/拡大/回転）の描画。
 * すべて「時刻 t の関数」として決まるので、プレビューと書き出しで同じ結果になる。
 */

/* ---------- 動き ---------- */

export const EASINGS = {
  linear: (p) => p,
  ease: (p) => (p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2),
  out: (p) => 1 - (1 - p) ** 3,
  in: (p) => p * p * p,
  back: (p) => { const c = 1.70158; return 1 + (c + 1) * (p - 1) ** 3 + c * (p - 1) ** 2; },
};

/** キーフレームで動かせる項目 */
export const ANIM_PROPS = ['x', 'y', 'w', 'h', 'size', 'rotation', 'opacity', 'scale', 'rx', 'ry'];

/** 表示の終わりの時刻（オーバーレイは素材の長さから決まる） */
export const itemEnd = (it) => (it.end != null ? it.end : it.start + (it.out - it.in) / (it.speed || 1));

/**
 * キーフレームを時刻順に並べた「状態の列」にする。
 * keys: [{ t: 開始からの秒, x?, y?, ..., ease? }]。書いていない項目は前のキーの値を引き継ぐ。
 * to: { ... } は「最初→最後」の 2 点キーフレームの省略形。
 */
export function keyStates(item) {
  let keys = item.keys;
  if (!keys || !keys.length) {
    if (!item.to) return null;
    keys = [{ t: 0 }, { t: itemEnd(item) - item.start, ...item.to, ease: item.ease }];
  }
  keys = [...keys].sort((a, b) => a.t - b.t);
  if (keys[0].t > 0) keys.unshift({ t: 0 });
  const states = [];
  let cur = {};
  for (const k of ANIM_PROPS) if (typeof item[k] === 'number') cur[k] = item[k];
  for (const k of keys) {
    cur = { ...cur };
    for (const p of ANIM_PROPS) if (typeof k[p] === 'number') cur[p] = k[p];
    states.push({ t: k.t, ease: k.ease, v: cur });
  }
  return states;
}

/** 時刻 t の位置・大きさ・回転などを、キーフレーム（または to）から補間した値にする */
export function withMotion(item, t) {
  const states = keyStates(item);
  if (!states) return item;
  const local = t - item.start;
  let a = states[0], b = null;
  for (let i = 0; i < states.length; i++) {
    if (states[i].t <= local) a = states[i];
    else { b = states[i]; break; }
  }
  const out = { ...item };
  if (!b || b.t <= a.t) { Object.assign(out, a.v); return out; }
  const p = (local - a.t) / (b.t - a.t);
  const e = (EASINGS[b.ease || item.ease] || EASINGS.ease)(Math.min(1, Math.max(0, p)));
  for (const k of Object.keys(b.v)) {
    const v0 = a.v[k] ?? item[k], v1 = b.v[k];
    if (typeof v0 === 'number' && typeof v1 === 'number') out[k] = v0 + (v1 - v0) * e;
  }
  return out;
}

/* ---------- 塗り（単色・グラデーション） ---------- */

export const GRADIENTS = {
  gold: { colors: ['#fff7cc', '#ffd34d', '#c98a00', '#ffe680'], angle: 90 },
  silver: { colors: ['#ffffff', '#c9d1d9', '#7d8590', '#e6edf3'], angle: 90 },
  rainbow: { colors: ['#ff4f4f', '#ffb84f', '#ffe84f', '#5fe08a', '#4fc3ff', '#b07bff'], angle: 0 },
  sunset: { colors: ['#ffd36e', '#ff7a3d', '#ff3d8b'], angle: 90 },
  ocean: { colors: ['#8ff3ff', '#2a9dff', '#3d3dff'], angle: 90 },
  sakura: { colors: ['#ffffff', '#ffc0d9', '#ff6fa8'], angle: 90 },
  neon: { colors: ['#00fff0', '#ff00e6'], angle: 0 },
};

/**
 * 色の指定（"#fff" / { colors: [...], angle } / "gradient:gold"）から塗りを作る。
 * box は塗る範囲（グラデーションの向きと長さの基準）。
 */
export function paint(ctx, spec, box) {
  if (!spec) return null;
  if (typeof spec === 'string') {
    if (!spec.startsWith('gradient:')) return spec;
    spec = GRADIENTS[spec.slice(9)] || GRADIENTS.gold;
  }
  const colors = spec.colors && spec.colors.length ? spec.colors : ['#fff', '#000'];
  const ang = ((spec.angle ?? 90) * Math.PI) / 180;
  const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
  const dx = Math.cos(ang), dy = Math.sin(ang);
  const half = (Math.abs(dx) * box.w + Math.abs(dy) * box.h) / 2;
  const g = ctx.createLinearGradient(cx - dx * half, cy - dy * half, cx + dx * half, cy + dy * half);
  colors.forEach((c, i) => g.addColorStop(colors.length === 1 ? 0 : i / (colors.length - 1), c));
  return g;
}

/* ---------- 乱数（時刻と番号から決まる） ---------- */

const rnd = (i, k = 0) => { const x = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453; return x - Math.floor(x); };
const noise1 = (t, k = 0) => {
  const i = Math.floor(t), f = t - i, u = f * f * (3 - 2 * f);
  return rnd(i, k) * (1 - u) + rnd(i + 1, k) * u;
};

/* ---------- 一時キャンバス ---------- */

const temps = new Map();
function temp(key, w, h) {
  let c = temps.get(key);
  if (!c) {
    c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : document.createElement('canvas');
    temps.set(key, c);
  }
  if (c.width !== w) c.width = w;
  if (c.height !== h) c.height = h;
  return c;
}

function snapshot(ctx) {
  const c = temp('snap', ctx.canvas.width, ctx.canvas.height);
  const x = c.getContext('2d');
  x.clearRect(0, 0, c.width, c.height);
  x.drawImage(ctx.canvas, 0, 0);
  return c;
}

let filterOK = null;
function canFilter(ctx) {
  if (filterOK === null) {
    try { ctx.save(); ctx.filter = 'blur(2px)'; filterOK = ctx.filter === 'blur(2px)'; ctx.restore(); } catch { filterOK = false; }
  }
  return filterOK;
}

/* ---------- 図形 ---------- */

export const SHAPES = {
  rect: '四角', round: '角丸', circle: '丸', ring: '輪', triangle: '三角', star: '星',
  heart: 'ハート', arrow: '矢印', line: '線', bubble: '吹き出し', burst: 'ギザギザ', check: 'チェック',
};

/** (0,0) 中心・幅 w 高さ h のパスを作る */
function shapePath(ctx, kind, w, h, r) {
  const hw = w / 2, hh = h / 2;
  ctx.beginPath();
  switch (kind) {
    case 'rect':
      ctx.rect(-hw, -hh, w, h);
      break;
    case 'round': {
      const rr = Math.min(hw, hh) * Math.min(1, r ?? 0.3) * 2;
      roundRect(ctx, -hw, -hh, w, h, Math.min(rr, hw, hh));
      break;
    }
    case 'circle':
    case 'ring':
      ctx.ellipse(0, 0, hw, hh, 0, 0, Math.PI * 2);
      break;
    case 'triangle':
      ctx.moveTo(0, -hh); ctx.lineTo(hw, hh); ctx.lineTo(-hw, hh); ctx.closePath();
      break;
    case 'star':
    case 'burst': {
      const n = kind === 'star' ? 5 : 14;
      const inner = kind === 'star' ? 0.45 : 0.72;
      for (let i = 0; i < n * 2; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / n;
        const rad = i % 2 ? inner : 1;
        ctx.lineTo(Math.cos(a) * hw * rad, Math.sin(a) * hh * rad);
      }
      ctx.closePath();
      break;
    }
    case 'heart':
      ctx.moveTo(0, hh * 0.9);
      ctx.bezierCurveTo(-hw * 1.15, hh * 0.05, -hw * 0.95, -hh * 1.05, 0, -hh * 0.45);
      ctx.bezierCurveTo(hw * 0.95, -hh * 1.05, hw * 1.15, hh * 0.05, 0, hh * 0.9);
      ctx.closePath();
      break;
    case 'arrow': {
      const sh = hh * 0.42, head = Math.min(w * 0.45, h * 1.1);
      ctx.moveTo(-hw, -sh); ctx.lineTo(hw - head, -sh); ctx.lineTo(hw - head, -hh);
      ctx.lineTo(hw, 0); ctx.lineTo(hw - head, hh); ctx.lineTo(hw - head, sh); ctx.lineTo(-hw, sh);
      ctx.closePath();
      break;
    }
    case 'line':
      ctx.rect(-hw, -Math.max(1, hh * 0.12), w, Math.max(2, h * 0.12));
      break;
    case 'bubble': {
      const bh = h * 0.78;
      const rr = Math.min(hw, bh / 2) * 0.6;
      const top = -hh, bottom = top + bh;
      ctx.moveTo(-hw + rr, top);
      ctx.arcTo(hw, top, hw, bottom, rr);
      ctx.arcTo(hw, bottom, -hw, bottom, rr);
      ctx.lineTo(-hw * 0.1, bottom);
      ctx.lineTo(-hw * 0.45, hh);
      ctx.lineTo(-hw * 0.4, bottom);
      ctx.arcTo(-hw, bottom, -hw, top, rr);
      ctx.arcTo(-hw, top, hw, top, rr);
      ctx.closePath();
      break;
    }
    case 'check':
      ctx.moveTo(-hw, 0); ctx.lineTo(-hw * 0.25, hh * 0.75); ctx.lineTo(hw, -hh * 0.8);
      break;
    default:
      ctx.rect(-hw, -hh, w, h);
  }
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** 入り・出の動きと、ずっと続く動き（loop）。図形・重ねた映像で共通 */
export function shapeAnim(s, t) {
  const local = t - s.start, remain = itemEnd(s) - t;
  const st = { alpha: 1, scale: 1, dy: 0, rot: 0, reveal: 1 };
  const IN = 0.35, OUT = 0.25;
  const p = Math.min(1, Math.max(0, local / IN));
  switch (s.anim) {
    case 'fade': st.alpha = p; break;
    case 'pop': st.scale = EASINGS.back(p); st.alpha = Math.min(1, p * 3); break;
    case 'slide': st.dy = (1 - EASINGS.out(p)) * 0.5; st.alpha = p; break;
    case 'spin': st.rot = (1 - EASINGS.out(p)) * -180; st.scale = EASINGS.out(p); break;
    case 'wipe': st.reveal = EASINGS.out(Math.min(1, local / 0.5)); break;
  }
  if ((s.animOut ?? (s.anim && s.anim !== 'none')) && remain < OUT) st.alpha *= Math.max(0, remain / OUT);
  switch (s.loop) {
    case 'pulse': st.scale *= 1 + 0.08 * Math.sin(local * Math.PI * 2 * 1.2); break;
    case 'float': st.dy += 0.06 * Math.sin(local * Math.PI * 2 * 0.6); break;
    case 'spin': st.rot += local * 90; break;
    case 'blink': st.alpha *= 0.55 + 0.45 * Math.cos(local * Math.PI * 2 * 1.5); break;
    case 'shake': st.rot += 8 * Math.sin(local * Math.PI * 2 * 5); break;
  }
  return st;
}

/** 図形の位置・大きさ（px）。ドラッグの当たり判定にも使う */
export function shapeBox(W, H, s0, t) {
  const s = withMotion(s0, t);
  const base = Math.min(W, H) * (s.scale ?? 1);
  const w = Math.max(1, s.w * base), h = Math.max(1, s.h * base);
  return { s, cx: s.x * W, cy: s.y * H, w, h, box: { x: s.x * W - w / 2, y: s.y * H - h / 2, w, h } };
}

export function drawShape(ctx, W, H, s0, t) {
  if (t < s0.start || t >= s0.end) return;
  const { s, cx, cy, w, h } = shapeBox(W, H, s0, t);
  const a = shapeAnim(s, t);
  const alpha = (s.opacity ?? 1) * a.alpha;
  if (alpha <= 0) return;
  const base = Math.min(W, H);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(cx, cy + a.dy * h);
  ctx.rotate(((s.rotation || 0) + a.rot) * Math.PI / 180);
  ctx.scale(a.scale, a.scale);
  if (a.reveal < 1) { ctx.beginPath(); ctx.rect(-w / 2 - 2, -h / 2 - 2, (w + 4) * a.reveal, h + 4); ctx.clip(); }
  if (s.shadow) { ctx.shadowColor = 'rgba(0,0,0,0.45)'; ctx.shadowBlur = base * 0.02; ctx.shadowOffsetY = base * 0.006; }
  shapePath(ctx, s.kind, w, h, s.radius);
  const lw = Math.max(1, (s.strokeWidth || 0) * base);
  const hollow = s.kind === 'ring' || s.kind === 'check';
  if (hollow) {
    ctx.lineWidth = Math.max(lw, base * 0.012);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.strokeStyle = s.stroke || s.fill || '#fff';
    ctx.stroke();
  } else {
    if (s.fill) { ctx.fillStyle = paint(ctx, s.fill, { x: -w / 2, y: -h / 2, w, h }); ctx.fill(); }
    ctx.shadowColor = 'transparent';
    if (s.stroke && s.strokeWidth > 0) {
      ctx.lineWidth = lw;
      ctx.lineJoin = 'round';
      ctx.strokeStyle = s.stroke;
      ctx.stroke();
    }
  }
  ctx.restore();
}

/* ---------- エフェクト ---------- */

/** layer: video = 映像だけにかかる / top = 文字や図形の上にかかる */
export const EFFECTS = {
  blur: { label: 'ぼかし', icon: '◌', layer: 'video' },
  shake: { label: '手ぶれ', icon: '〰', layer: 'video' },
  zoompulse: { label: 'ズーム鼓動', icon: '⤢', layer: 'video' },
  glitch: { label: 'グリッチ', icon: '▚', layer: 'video' },
  rgbsplit: { label: 'RGBずれ', icon: '◫', layer: 'video' },
  mono: { label: 'モノクロ', icon: '◑', layer: 'video' },
  vignette: { label: '周辺減光', icon: '◉', layer: 'video' },
  grain: { label: 'フィルム粒子', icon: '░', layer: 'video' },
  letterbox: { label: 'シネマ帯', icon: '▭', layer: 'video' },
  flash: { label: 'フラッシュ', icon: '✦', layer: 'top' },
  confetti: { label: '紙吹雪', icon: '🎉', layer: 'top' },
  snow: { label: '雪', icon: '❄', layer: 'top' },
  sparkle: { label: 'キラキラ', icon: '✧', layer: 'top' },
  hearts: { label: 'ハート', icon: '♥', layer: 'top' },
};

/** 効果の強さ（始まりと終わりを 0.15 秒でなめらかに） */
function strength(e, t) {
  const r = 0.15;
  const k = Math.min(1, (t - e.start) / r, (e.end - t) / r);
  return Math.max(0, Math.min(1, k)) * (e.intensity ?? 0.6);
}

export function applyEffects(ctx, W, H, effects, t, layer) {
  for (const e of effects) {
    if (t < e.start || t >= e.end) continue;
    const def = EFFECTS[e.type];
    if (!def || def.layer !== layer) continue;
    const k = strength(e, t);
    if (k <= 0) continue;
    ctx.save();
    try { EFFECT_FN[e.type](ctx, W, H, k, t, e); } finally { ctx.restore(); }
  }
}

const EFFECT_FN = {
  blur(ctx, W, H, k) {
    const snap = snapshot(ctx);
    if (canFilter(ctx)) {
      ctx.filter = `blur(${(k * Math.min(W, H) * 0.025).toFixed(1)}px)`;
      ctx.drawImage(snap, 0, 0);
    } else {
      const s = 1 / (1 + k * 14);
      const small = temp('blur', Math.max(2, Math.round(W * s)), Math.max(2, Math.round(H * s)));
      const sx = small.getContext('2d');
      sx.imageSmoothingQuality = 'high';
      sx.drawImage(snap, 0, 0, small.width, small.height);
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(small, 0, 0, W, H);
    }
  },
  shake(ctx, W, H, k, t) {
    const snap = snapshot(ctx);
    const amp = k * 0.035;
    const dx = (noise1(t * 14, 1) - 0.5) * 2 * amp * W;
    const dy = (noise1(t * 14, 2) - 0.5) * 2 * amp * H;
    const rot = (noise1(t * 10, 3) - 0.5) * k * 0.04;
    const sc = 1 + amp * 2.2;
    ctx.translate(W / 2 + dx, H / 2 + dy);
    ctx.rotate(rot);
    ctx.scale(sc, sc);
    ctx.drawImage(snap, -W / 2, -H / 2);
  },
  zoompulse(ctx, W, H, k, t, e) {
    const snap = snapshot(ctx);
    const beat = (t - e.start) * 2; // 1秒に2回
    const sc = 1 + k * 0.14 * (1 - (beat % 1)) ** 3;
    ctx.translate(W / 2, H / 2);
    ctx.scale(sc, sc);
    ctx.drawImage(snap, -W / 2, -H / 2);
  },
  glitch(ctx, W, H, k, t) {
    const seg = Math.floor(t * 12);
    if (rnd(seg, 7) > 0.35 + k * 0.6) return; // ときどき起きる
    const snap = snapshot(ctx);
    rgbSplit(ctx, snap, W, H, (rnd(seg, 9) - 0.5) * k * W * 0.04);
    const n = 3 + Math.floor(k * 8);
    for (let i = 0; i < n; i++) {
      const y = rnd(seg, i * 3) * H, hh = (0.01 + rnd(seg, i * 3 + 1) * 0.08) * H;
      const dx = (rnd(seg, i * 3 + 2) - 0.5) * k * W * 0.25;
      ctx.drawImage(snap, 0, y, W, hh, dx, y, W, hh);
    }
  },
  rgbsplit(ctx, W, H, k, t) {
    const snap = snapshot(ctx);
    rgbSplit(ctx, snap, W, H, k * W * 0.012 * (0.7 + 0.3 * Math.sin(t * 6)));
  },
  mono(ctx, W, H, k) {
    ctx.globalCompositeOperation = 'saturation';
    ctx.globalAlpha = k;
    ctx.fillStyle = '#808080';
    ctx.fillRect(0, 0, W, H);
  },
  vignette(ctx, W, H, k) {
    const r = Math.hypot(W, H) / 2;
    const g = ctx.createRadialGradient(W / 2, H / 2, r * 0.35, W / 2, H / 2, r);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, `rgba(0,0,0,${(0.9 * k).toFixed(3)})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  },
  grain(ctx, W, H, k, t) {
    const tile = grainTile();
    const f = Math.floor(t * 24);
    ctx.globalAlpha = k * 0.55;
    ctx.globalCompositeOperation = 'overlay';
    const sc = Math.max(1, Math.min(W, H) / 540);
    ctx.scale(sc, sc);
    ctx.translate(-rnd(f, 1) * 256, -rnd(f, 2) * 256);
    ctx.fillStyle = ctx.createPattern(tile, 'repeat');
    ctx.fillRect(0, 0, W / sc + 256, H / sc + 256);
  },
  letterbox(ctx, W, H, k) {
    const bar = Math.round(H * 0.12 * k);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, bar);
    ctx.fillRect(0, H - bar, W, bar);
  },
  flash(ctx, W, H, k, t, e) {
    const p = Math.min(1, (t - e.start) / Math.max(0.05, e.end - e.start));
    ctx.globalAlpha = Math.min(1, (e.intensity ?? 0.8) * (1 - p) ** 2);
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, W, H);
  },
  confetti(ctx, W, H, k, t, e) {
    const colors = ['#ff4f8b', '#ffcc33', '#4fc3ff', '#5fe08a', '#ff7a3d', '#b07bff'];
    particles(ctx, W, H, t, e, Math.round(30 + k * 120), (i, x, y, age) => {
      const s = Math.min(W, H) * (0.012 + rnd(i, 5) * 0.012);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(age * (2 + rnd(i, 6) * 6) + rnd(i, 7) * 6);
      ctx.scale(1, Math.cos(age * (3 + rnd(i, 8) * 5)));
      ctx.fillStyle = colors[i % colors.length];
      ctx.fillRect(-s / 2, -s * 0.3, s, s * 0.6);
      ctx.restore();
    }, { fall: 0.35 });
  },
  snow(ctx, W, H, k, t, e) {
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    particles(ctx, W, H, t, e, Math.round(40 + k * 160), (i, x, y) => {
      const r = Math.min(W, H) * (0.003 + rnd(i, 5) * 0.006);
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }, { fall: 0.12, sway: 0.04 });
  },
  sparkle(ctx, W, H, k, t, e) {
    const n = Math.round(10 + k * 40);
    for (let i = 0; i < n; i++) {
      const a = Math.max(0, Math.sin((t - e.start) * (2 + rnd(i, 3) * 3) + rnd(i, 4) * 6.28)) ** 6;
      if (a < 0.02) continue;
      const x = rnd(i, 1) * W, y = rnd(i, 2) * H;
      const s = Math.min(W, H) * (0.015 + rnd(i, 5) * 0.03) * a;
      ctx.globalAlpha = a;
      ctx.fillStyle = '#fffbe6';
      ctx.save();
      ctx.translate(x, y);
      ctx.beginPath();
      for (let j = 0; j < 8; j++) {
        const ang = (j * Math.PI) / 4;
        const rr = j % 2 ? s * 0.18 : s;
        ctx.lineTo(Math.cos(ang) * rr, Math.sin(ang) * rr);
      }
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  },
  hearts(ctx, W, H, k, t, e) {
    const colors = ['#ff4f8b', '#ff7aa8', '#ff9ec0', '#ff3366'];
    particles(ctx, W, H, t, e, Math.round(8 + k * 30), (i, x, y, age) => {
      const s = Math.min(W, H) * (0.03 + rnd(i, 5) * 0.035);
      ctx.save();
      ctx.globalAlpha = 0.85;
      ctx.translate(x, y);
      ctx.rotate(Math.sin(age * 2 + i) * 0.3);
      ctx.fillStyle = colors[i % colors.length];
      shapePath(ctx, 'heart', s, s);
      ctx.fill();
      ctx.restore();
    }, { fall: -0.2, sway: 0.03 });
  },
};

/** 落ちる（fall < 0 なら昇る）粒子を、時刻から決まる位置に描く */
function particles(ctx, W, H, t, e, n, draw, { fall = 0.3, sway = 0.02 } = {}) {
  const age = t - e.start;
  for (let i = 0; i < n; i++) {
    const speed = Math.abs(fall) * (0.6 + rnd(i, 1) * 0.8);
    // 画面の少し外（-0.1〜1.1）をぐるぐる回る
    const pos = (rnd(i, 2) * 1.2 + age * speed) % 1.2 - 0.1;
    const y = fall >= 0 ? pos : 1 - pos;
    const x = rnd(i, 3) + Math.sin(age * (1 + rnd(i, 4)) + i) * sway;
    draw(i, (((x % 1) + 1) % 1) * W, y * H, age);
  }
}

function rgbSplit(ctx, snap, W, H, dx) {
  const r = temp('red', W, H), c = temp('cyan', W, H);
  for (const [cv, col] of [[r, '#ff0000'], [c, '#00ffff']]) {
    const x = cv.getContext('2d');
    x.globalCompositeOperation = 'source-over';
    x.clearRect(0, 0, W, H);
    x.drawImage(snap, 0, 0);
    x.globalCompositeOperation = 'multiply';
    x.fillStyle = col;
    x.fillRect(0, 0, W, H);
  }
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);
  ctx.drawImage(c, -dx, 0);
  ctx.globalCompositeOperation = 'lighter';
  ctx.drawImage(r, dx, 0);
  ctx.globalCompositeOperation = 'source-over';
}

let grainCanvas = null;
function grainTile() {
  if (!grainCanvas) {
    grainCanvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(256, 256) : document.createElement('canvas');
    grainCanvas.width = grainCanvas.height = 256;
    const x = grainCanvas.getContext('2d');
    const img = x.createImageData(256, 256);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = 128 + (rnd(i, 11) - 0.5) * 200;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
    x.putImageData(img, 0, 0);
  }
  return grainCanvas;
}
