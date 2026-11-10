/*
 * つなぐ：背景・雰囲気のジェネレーターと、グラフ。
 */
import { registerGen, mixColor, css, rnd, noise1 } from './index.js';
import { program, pass, points, GLSL } from '../gl.js';
import { FONTS } from '../fonts.js';

/* ---------- オーロラ（ゆっくり動く色のにじみ） ---------- */
const AURORA_FS = `in vec2 uv; out vec4 o; uniform vec2 res; uniform float time; uniform vec3 c0; uniform vec3 c1; uniform vec3 c2; uniform vec3 c3; uniform float soft; uniform float dark;
${GLSL.hash} ${GLSL.noise}
void main(){ vec2 p = uv * vec2(res.x / res.y, 1.0); float t = time * 0.12;
  vec2 w = vec2(fbm(p * 0.9 + vec2(t, -t * 0.7)), fbm(p * 0.9 + vec2(-t * 0.8, t) + 4.7));
  vec2 q = p + (w - 0.5) * 1.6 * soft;
  float a = fbm(q * 0.8 + t), b = fbm(q * 1.3 - t * 1.3 + 9.1);
  vec3 c = mix(c0, c1, smoothstep(0.25, 0.75, a)); c = mix(c, c2, smoothstep(0.35, 0.8, b)); c = mix(c, c3, smoothstep(0.55, 0.95, w.x * w.y * 2.2));
  c *= 1.0 - dark * (0.35 + 0.65 * smoothstep(0.2, 1.0, length(uv - 0.5) * 1.3));
  c += (hash21(uv * res + time) - 0.5) * 0.012;
  o = vec4(c, 1.0); }`;
registerGen('aurora', {
  label: 'オーロラ（色のにじみ）', cat: 'bg', gl: true,
  desc: 'ゆっくり動くグラデーション。文字の背景に',
  defaults: { soft: 1, dark: 0.5, colors: ['#141a4f', '#4d6dff', '#8a4dff', '#3ddc97'] },
  params: [{ key: 'soft', label: 'ゆらぎ', min: 0, max: 2.5, step: 0.05 }, { key: 'dark', label: '周りを暗く', min: 0, max: 1, step: 0.05 }],
  draw(c) {
    const col = (u) => mixColor(c.colors, u);
    pass(program('g:aurora', AURORA_FS), { res: [c.W, c.H], time: c.t, c0: col(0), c1: col(0.34), c2: col(0.67), c3: col(1), soft: c.p.soft, dark: c.p.dark });
  },
});

/* ---------- 星空（奥から手前へ流れる） ---------- */
registerGen('stars', {
  label: '星空・ワープ', cat: 'bg', gl: true,
  desc: '奥から手前へ流れる星。速くするとワープ',
  defaults: { count: 1800, warp: 0.25, twinkle: 0.5, colors: ['#ffffff', '#cfe9ff', '#ffe9c2'] },
  params: [{ key: 'count', label: '星の数', min: 200, max: 8000, step: 100 }, { key: 'warp', label: '流れる速さ', min: 0, max: 4, step: 0.05 }, { key: 'twinkle', label: 'またたき', min: 0, max: 1, step: 0.05 }],
  draw(c) {
    const { p, W, H, state } = c, n = Math.round(p.count);
    if (!state.buf || state.buf.length !== n * 7) state.buf = new Float32Array(n * 7);
    const buf = state.buf, asp = W / H;
    for (let i = 0; i < n; i++) {
      const z0 = rnd(i, 3, c.seed), z = 1 - ((z0 + c.t * p.warp * 0.25) % 1); // 1（奥）→ 0（手前）
      const x = (rnd(i, 1, c.seed) * 2 - 1) * 1.6, y = (rnd(i, 2, c.seed) * 2 - 1) * 1.6;
      const k = 0.35 / (z * 0.95 + 0.05);
      const col = mixColor(c.colors, rnd(i, 4, c.seed));
      const tw = 1 - p.twinkle * 0.6 * (0.5 + 0.5 * Math.sin(c.t * (1 + rnd(i, 5, c.seed) * 3) + i));
      const o = i * 7;
      buf[o] = (x * k) / asp; buf[o + 1] = y * k; buf[o + 2] = Math.max(1, H * 0.0035 * (0.4 + rnd(i, 6, c.seed)) * (1.6 - z) * (1 + p.warp * 0.5));
      buf[o + 3] = col[0]; buf[o + 4] = col[1]; buf[o + 5] = col[2]; buf[o + 6] = Math.min(1, (1 - z) * 2.2) * Math.min(1, z * 8) * tw * 0.9;
    }
    points('stars', buf, n);
  },
});

/* ---------- つながる点（ネットワーク） ---------- */
registerGen('plexus', {
  label: 'つながる点', cat: 'bg',
  desc: 'ただよう点が近づくと線でつながる。テクノロジー・ネットワークの雰囲気',
  defaults: { count: 70, reach: 0.16, speed: 1, colors: ['#3ddcff', '#4c86ff', '#b14dff'] },
  params: [{ key: 'count', label: '点の数', min: 10, max: 200, step: 5 }, { key: 'reach', label: 'つながる距離', min: 0.05, max: 0.4, step: 0.01 }, { key: 'speed', label: '速さ', min: 0, max: 4, step: 0.1 }],
  draw(c) {
    const { ctx, W, H, p } = c, n = Math.round(p.count), m = Math.min(W, H);
    const pts = [];
    for (let i = 0; i < n; i++) {
      const x = (rnd(i, 1, c.seed) + noise1(c.t * 0.06 * p.speed + i * 3.1, 1, c.seed) * 0.18 + 1) % 1, y = (rnd(i, 2, c.seed) + noise1(c.t * 0.06 * p.speed + i * 1.7, 2, c.seed) * 0.18 + 1) % 1;
      pts.push([x * W, y * H]);
    }
    const R = p.reach * Math.hypot(W, H) * 0.6;
    ctx.lineWidth = Math.max(1, m * 0.0016);
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      const d = Math.hypot(pts[i][0] - pts[j][0], pts[i][1] - pts[j][1]);
      if (d > R) continue;
      ctx.strokeStyle = css(mixColor(c.colors, (i / n + j / n) / 2), (1 - d / R) * 0.55);
      ctx.beginPath(); ctx.moveTo(pts[i][0], pts[i][1]); ctx.lineTo(pts[j][0], pts[j][1]); ctx.stroke();
    }
    for (let i = 0; i < n; i++) { ctx.fillStyle = css(mixColor(c.colors, i / n), 0.9); ctx.beginPath(); ctx.arc(pts[i][0], pts[i][1], m * (0.003 + rnd(i, 3, c.seed) * 0.004), 0, 6.283); ctx.fill(); }
  },
});

/* ---------- グリッドの地平線（シンセウェーブ） ---------- */
const GRID_FS = `in vec2 uv; out vec4 o; uniform vec2 res; uniform float time; uniform vec3 cl; uniform vec3 cs; uniform vec3 cg; uniform float speed; uniform float sun;
void main(){ vec2 p = (uv * 2.0 - 1.0) * vec2(res.x / res.y, 1.0); float hz = 0.08; vec3 c = vec3(0.0);
  if (p.y < hz) { float d = 1.0 / (hz - p.y); vec2 g = vec2(p.x * d, d + time * speed * 2.0);
    vec2 f = abs(fract(g) - 0.5); float w = 0.03 * d; float ln = smoothstep(w, 0.0, f.x) + smoothstep(w * 0.7, 0.0, f.y);
    c = cl * min(1.0, ln) * exp(-d * 0.09) + cg * 0.06 * exp(-d * 0.3); }
  else { c = mix(cg * 0.35, vec3(0.0), smoothstep(hz, 1.0, p.y));
    float r = length(p - vec2(0.0, hz + 0.32)); float s = smoothstep(0.34, 0.33, r) * sun;
    float bands = step(0.0, sin((p.y - hz) * 60.0 - 1.0)) * smoothstep(hz + 0.36, hz + 0.1, p.y); s *= 1.0 - bands * 0.9 * step(p.y, hz + 0.36);
    c += mix(cs, cl, clamp((p.y - hz) * 2.2, 0.0, 1.0)) * s + cs * exp(-r * 4.0) * 0.35 * sun; }
  c += cl * exp(-abs(p.y - hz) * 40.0) * 0.6;
  o = vec4(c, 1.0); }`;
registerGen('grid', {
  label: 'グリッドの地平線', cat: 'bg', gl: true,
  desc: '奥へ流れるネオンの格子と夕日（シンセウェーブ）',
  defaults: { speed: 1, sun: 1, colors: ['#ff3dbb', '#ffd23d', '#3d1d7a'] },
  params: [{ key: 'speed', label: '速さ', min: 0, max: 4, step: 0.1 }, { key: 'sun', label: '太陽', min: 0, max: 1, step: 0.05 }],
  draw(c) { pass(program('g:grid', GRID_FS), { res: [c.W, c.H], time: c.t, cl: mixColor(c.colors, 0), cs: mixColor(c.colors, 0.5), cg: mixColor(c.colors, 1), speed: c.p.speed, sun: c.p.sun }); },
});

/* ---------- グラフ（棒・折れ線・円） ---------- */
registerGen('chart', {
  label: 'グラフ', cat: 'algo',
  desc: '数値を渡すと、伸びる棒グラフ・折れ線・円グラフを描く（params.data に数値、labels にラベル）',
  defaults: { kind: 'bar', data: [32, 48, 61, 55, 78, 92], labels: ['1月', '2月', '3月', '4月', '5月', '6月'], unit: '', title: '', growDur: 1.4, stagger: 0.12, highlight: -1, showValues: true, decimals: 0, max: 0, colors: ['#4c86ff', '#3ddcff'], hi: '#ffc83d', text: '#e8ecf8' },
  params: [
    { key: 'kind', label: '種類', type: 'select', options: [['bar', '棒'], ['line', '折れ線'], ['area', '面'], ['pie', '円'], ['hbar', '横棒']] },
    { key: 'title', label: '見出し', type: 'text' },
    { key: 'growDur', label: '伸びる時間', min: 0.2, max: 5, step: 0.1 },
    { key: 'stagger', label: '順に出る間隔', min: 0, max: 0.6, step: 0.01 },
    { key: 'highlight', label: '強調する番号（-1 でなし）', min: -1, max: 30, step: 1 },
    { key: 'showValues', label: '数値を表示', type: 'toggle' },
  ],
  draw(c) {
    const { ctx, W, H, p } = c;
    const data = (p.data || []).map(Number), n = data.length;
    if (!n) return;
    const f = FONTS.gothic, m = Math.min(W, H);
    const fs = Math.max(10, m * 0.055), pad = fs * 1.2;
    const top = p.title ? fs * 2.4 : fs * 1.6, bottom = H - fs * 2.2, left = pad, right = W - pad;
    const mx = p.max || Math.max(...data) * 1.12 || 1;
    const prog = (i) => { const u = Math.min(1, Math.max(0, (c.t - i * p.stagger) / Math.max(0.05, p.growDur))); return 1 - (1 - u) ** 3; };
    const colOf = (i) => (i === Math.round(p.highlight) ? p.hi : css(mixColor(c.colors, n > 1 ? i / (n - 1) : 0)));
    const fmt = (v) => v.toFixed(p.decimals).replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (p.unit || '');
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    if (p.title) { ctx.fillStyle = p.text; ctx.font = `${f.weight} ${fs * 1.15}px ${f.family}`; ctx.textAlign = 'left'; ctx.fillText(p.title, left, fs * 0.9); ctx.textAlign = 'center'; }
    ctx.font = `${f.weight} ${fs * 0.72}px ${f.family}`;
    if (p.kind === 'pie') {
      const sum = data.reduce((a, b) => a + b, 0) || 1, R = Math.min(right - left, bottom - top) * 0.46, cx = W / 2, cy = (top + bottom) / 2 + fs * 0.4;
      const sweep = prog(0) * Math.PI * 2;
      let a0 = -Math.PI / 2;
      data.forEach((v, i) => {
        const a1 = a0 + (v / sum) * Math.PI * 2, e = Math.min(a1, -Math.PI / 2 + sweep);
        if (e > a0) { ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, R * (i === Math.round(p.highlight) ? 1.06 : 1), a0, e); ctx.closePath(); ctx.fillStyle = colOf(i); ctx.fill(); }
        if (sweep >= (a0 + a1) / 2 + Math.PI / 2 && v / sum > 0.04) { const am = (a0 + a1) / 2; ctx.fillStyle = '#0b0d14'; ctx.fillText(p.labels?.[i] ?? '', cx + Math.cos(am) * R * 0.62, cy + Math.sin(am) * R * 0.62 - fs * 0.4); if (p.showValues) ctx.fillText(`${Math.round((v / sum) * 100)}%`, cx + Math.cos(am) * R * 0.62, cy + Math.sin(am) * R * 0.62 + fs * 0.45); }
        a0 = a1;
      });
      return;
    }
    // 目盛り線
    ctx.fillStyle = 'rgba(255,255,255,0.1)';
    for (let k = 0; k <= 4; k++) ctx.fillRect(left, bottom - ((bottom - top) * k) / 4, right - left, 1);
    if (p.kind === 'hbar') {
      const bh = (bottom - top + fs) / n;
      data.forEach((v, i) => {
        const y = top - fs * 0.5 + i * bh, w = (right - left - fs * 4) * (v / mx) * prog(i);
        ctx.fillStyle = colOf(i); ctx.beginPath(); ctx.roundRect ? ctx.roundRect(left + fs * 3.2, y + bh * 0.15, Math.max(1, w), bh * 0.7, bh * 0.15) : ctx.rect(left + fs * 3.2, y + bh * 0.15, w, bh * 0.7); ctx.fill();
        ctx.fillStyle = p.text; ctx.textAlign = 'right'; ctx.fillText(p.labels?.[i] ?? '', left + fs * 2.9, y + bh / 2);
        if (p.showValues) { ctx.textAlign = 'left'; ctx.fillText(fmt(v * prog(i)), left + fs * 3.4 + w, y + bh / 2); }
      });
      return;
    }
    const bw = (right - left) / n;
    const xOf = (i) => left + bw * (i + 0.5), yOf = (v) => bottom - (bottom - top) * (v / mx);
    if (p.kind === 'bar') {
      data.forEach((v, i) => {
        const h = (bottom - top) * (v / mx) * prog(i), x = left + bw * i + bw * 0.16, w = bw * 0.68;
        const g = ctx.createLinearGradient(0, bottom - h, 0, bottom); const col = colOf(i);
        g.addColorStop(0, col); g.addColorStop(1, i === Math.round(p.highlight) ? col : css(mixColor(c.colors, n > 1 ? i / (n - 1) : 0), 0.55));
        ctx.fillStyle = g; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x, bottom - h, w, Math.max(1, h), [w * 0.12, w * 0.12, 0, 0]) : ctx.rect(x, bottom - h, w, h); ctx.fill();
        if (p.showValues && prog(i) > 0.05) { ctx.fillStyle = i === Math.round(p.highlight) ? p.hi : p.text; ctx.fillText(fmt(v * prog(i)), xOf(i), bottom - h - fs * 0.6); }
      });
    } else {
      // 折れ線・面：左から描いていく
      const total = Math.min(1, c.t / Math.max(0.05, p.growDur + p.stagger * n)), e = 1 - (1 - total) ** 3, upto = e * (n - 1);
      ctx.beginPath();
      for (let i = 0; i <= Math.floor(upto); i++) i ? ctx.lineTo(xOf(i), yOf(data[i])) : ctx.moveTo(xOf(i), yOf(data[i]));
      const fi = Math.floor(upto), fr = upto - fi;
      let ex = xOf(fi), ey = yOf(data[fi]);
      if (fi < n - 1) { ex = xOf(fi) + (xOf(fi + 1) - xOf(fi)) * fr; ey = yOf(data[fi]) + (yOf(data[fi + 1]) - yOf(data[fi])) * fr; ctx.lineTo(ex, ey); }
      const g = ctx.createLinearGradient(left, 0, right, 0);
      c.colors.forEach((col, i) => g.addColorStop(i / Math.max(1, c.colors.length - 1), col));
      if (p.kind === 'area') { ctx.save(); ctx.lineTo(ex, bottom); ctx.lineTo(xOf(0), bottom); ctx.closePath(); ctx.globalAlpha = 0.28; ctx.fillStyle = g; ctx.fill(); ctx.restore(); ctx.beginPath(); for (let i = 0; i <= fi; i++) i ? ctx.lineTo(xOf(i), yOf(data[i])) : ctx.moveTo(xOf(i), yOf(data[i])); ctx.lineTo(ex, ey); }
      ctx.strokeStyle = g; ctx.lineWidth = Math.max(2, m * 0.009); ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.stroke();
      for (let i = 0; i <= fi; i++) { ctx.fillStyle = colOf(i); ctx.beginPath(); ctx.arc(xOf(i), yOf(data[i]), m * (i === Math.round(p.highlight) ? 0.016 : 0.01), 0, 6.283); ctx.fill(); if (p.showValues) { ctx.fillStyle = i === Math.round(p.highlight) ? p.hi : p.text; ctx.fillText(fmt(data[i]), xOf(i), yOf(data[i]) - fs * 0.85); } }
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(ex, ey, m * 0.008, 0, 6.283); ctx.fill();
    }
    ctx.fillStyle = 'rgba(232,236,248,0.75)';
    data.forEach((_, i) => ctx.fillText(p.labels?.[i] ?? '', xOf(i), bottom + fs * 0.9));
  },
});
