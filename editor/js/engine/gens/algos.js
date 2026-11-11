/*
 * つなぐ：アルゴリズムの可視化（本当に計算して動かす）と、それらを並べるパネル。
 */
import { registerGen, drawGen, GENS, mixColor, css, rnd } from './index.js';
import { program, pass, GLSL } from '../gl.js';
import { FONTS } from '../fonts.js';

const cl = (v, a, b) => (v < a ? a : v > b ? b : v);
const params = (extra = []) => [{ key: 'speed', label: '速さ', min: 0.2, max: 5, step: 0.1 }, ...extra];

/* ---------- 並べ替え（クイックソートの手順を記録して再生） ---------- */
registerGen('sort', {
  label: '並べ替え（ソート）', cat: 'algo', desc: '棒が高さ順に並び替わっていく', defaults: { n: 64, speed: 1, colors: ['#4c86ff', '#3ddc97', '#ffd23d', '#ff7a3d'] },
  params: params([{ key: 'n', label: '本数', min: 16, max: 160, step: 4 }]),
  draw(c) {
    const { ctx, W, H, p, state } = c, n = Math.round(p.n);
    if (!state.steps) {
      const a = Array.from({ length: n }, (_, i) => i).sort((x, y) => rnd(x, 1, c.seed) - rnd(y, 1, c.seed));
      state.init = a.slice(); state.steps = [];
      const sw = (i, j) => { if (i !== j) { [a[i], a[j]] = [a[j], a[i]]; state.steps.push([i, j]); } };
      const qs = (lo, hi) => { if (lo >= hi) return; const pv = a[hi]; let i = lo; for (let j = lo; j < hi; j++) if (a[j] < pv) sw(i++, j); sw(i, hi); qs(lo, i - 1); qs(i + 1, hi); };
      qs(0, n - 1);
    }
    const k = Math.min(state.steps.length, Math.floor(c.t * p.speed * state.steps.length / 6));
    const a = state.init.slice();
    for (let i = 0; i < k; i++) { const [x, y] = state.steps[i]; [a[x], a[y]] = [a[y], a[x]]; }
    const act = state.steps[Math.min(k, state.steps.length - 1)] || [];
    const bw = W / n;
    for (let i = 0; i < n; i++) {
      const h = ((a[i] + 1) / n) * H * 0.92;
      ctx.fillStyle = k < state.steps.length && (i === act[0] || i === act[1]) ? '#ffffff' : css(mixColor(c.colors, a[i] / (n - 1)));
      ctx.fillRect(i * bw + bw * 0.1, H - h, bw * 0.8, h);
    }
  },
});

/* ---------- ライフゲーム ---------- */
registerGen('life', {
  label: 'ライフゲーム', cat: 'algo', desc: '単純な規則から生き物のような模様が生まれる', defaults: { cols: 64, speed: 1, colors: ['#3ddc97', '#b8ffd9'] },
  params: params([{ key: 'cols', label: 'マスの細かさ', min: 24, max: 160, step: 4 }]),
  draw(c) {
    const { ctx, W, H, p } = c, cols = Math.round(p.cols), rows = Math.max(4, Math.round((cols * H) / W));
    const s = c.sim(() => { const g = new Uint8Array(cols * rows), age = new Uint8Array(cols * rows); for (let i = 0; i < g.length; i++) g[i] = rnd(i, 2, c.seed) < 0.3 ? 1 : 0; return { g, age, b: new Uint8Array(cols * rows) }; },
      (st) => { const { g, b, age } = st; for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) { let nn = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (dx || dy) nn += g[((y + dy + rows) % rows) * cols + ((x + dx + cols) % cols)]; const i = y * cols + x; b[i] = nn === 3 || (nn === 2 && g[i]) ? 1 : 0; age[i] = b[i] ? Math.min(255, age[i] + 1) : 0; } st.g = b; st.b = g; }, 1 / (10 * p.speed));
    const cw = W / cols, ch = H / rows;
    for (let i = 0; i < s.g.length; i++) if (s.g[i]) { ctx.fillStyle = css(mixColor(c.colors, cl(s.age[i] / 12, 0, 1))); ctx.fillRect((i % cols) * cw + 0.5, Math.floor(i / cols) * ch + 0.5, cw - 1, ch - 1); }
  },
});

/* ---------- 迷路（作って、解く） ---------- */
registerGen('maze', {
  label: '迷路（作って解く）', cat: 'algo', desc: '迷路を掘り進め、できたら最短の道を探す', defaults: { cols: 28, speed: 1, colors: ['#4c86ff', '#ffd23d', '#ff5c5c'] },
  params: params([{ key: 'cols', label: '細かさ', min: 10, max: 60, step: 2 }]),
  draw(c) {
    const { ctx, W, H, p, state } = c, cols = Math.round(p.cols), rows = Math.max(4, Math.round((cols * H) / W));
    if (!state.order) {
      const seen = new Uint8Array(cols * rows), walls = [], order = [], parent = new Int32Array(cols * rows).fill(-1);
      const stack = [0]; seen[0] = 1; let rk = 0;
      while (stack.length) {
        const cur = stack[stack.length - 1], x = cur % cols, y = Math.floor(cur / cols);
        const nb = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => [x + dx, y + dy]).filter(([a, b]) => a >= 0 && b >= 0 && a < cols && b < rows && !seen[b * cols + a]);
        if (!nb.length) { stack.pop(); continue; }
        const [nx, ny] = nb[Math.floor(rnd(rk++, 3, c.seed) * nb.length)], ni = ny * cols + nx;
        seen[ni] = 1; parent[ni] = cur; order.push([cur, ni]); stack.push(ni);
      }
      const path = []; for (let i = cols * rows - 1; i !== -1; i = parent[i]) path.push(i);
      state.order = order; state.path = path.reverse();
    }
    const cw = W / cols, ch = H / rows, tt = c.t * p.speed;
    const carve = Math.min(state.order.length, Math.floor((tt / 3.5) * state.order.length));
    ctx.strokeStyle = css(mixColor(c.colors, 0)); ctx.lineWidth = Math.min(cw, ch) * 0.62; ctx.lineCap = 'square';
    ctx.beginPath();
    for (let i = 0; i < carve; i++) { const [a, b] = state.order[i]; ctx.moveTo((a % cols + 0.5) * cw, (Math.floor(a / cols) + 0.5) * ch); ctx.lineTo((b % cols + 0.5) * cw, (Math.floor(b / cols) + 0.5) * ch); }
    ctx.stroke();
    if (carve >= state.order.length) {
      const k = Math.min(state.path.length, Math.floor(((tt - 3.5) / 1.8) * state.path.length));
      ctx.strokeStyle = css(mixColor(c.colors, 0.5)); ctx.lineWidth = Math.min(cw, ch) * 0.3; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.beginPath();
      for (let i = 0; i < k; i++) { const a = state.path[i], x = (a % cols + 0.5) * cw, y = (Math.floor(a / cols) + 0.5) * ch; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
      ctx.stroke();
    } else if (carve) { const h = state.order[carve - 1][1]; ctx.fillStyle = css(mixColor(c.colors, 1)); ctx.fillRect((h % cols) * cw + cw * 0.2, Math.floor(h / cols) * ch + ch * 0.2, cw * 0.6, ch * 0.6); }
  },
});

/* ---------- マンデルブロ集合（ズーム） ---------- */
const MANDEL_FS = `in vec2 uv; out vec4 o; uniform vec2 res; uniform float zoom; uniform vec2 ctr; uniform vec3 c0; uniform vec3 c1; uniform vec3 c2;
void main(){ vec2 p = (uv - 0.5) * vec2(res.x / res.y, 1.0) * zoom + ctr; vec2 z = vec2(0.0); float n = 0.0;
  for (int i = 0; i < 220; i++) { z = vec2(z.x * z.x - z.y * z.y, 2.0 * z.x * z.y) + p; if (dot(z, z) > 64.0) break; n += 1.0; }
  if (n >= 220.0) { o = vec4(0.02, 0.02, 0.05, 1.0); return; }
  float s = n - log2(log2(dot(z, z))) + 4.0; float t = fract(s * 0.035);
  vec3 c = t < 0.33 ? mix(c0, c1, t * 3.0) : t < 0.66 ? mix(c1, c2, (t - 0.33) * 3.0) : mix(c2, c0, (t - 0.66) * 3.0);
  o = vec4(c, 1.0); }`;
registerGen('mandelbrot', {
  label: 'マンデルブロ集合', cat: 'algo', gl: true, desc: 'どこまで拡大しても模様が現れる', defaults: { speed: 1, depth: 9, colors: ['#141a4f', '#ff7a3d', '#fff1c9'] },
  params: params([{ key: 'depth', label: '拡大の深さ', min: 2, max: 13, step: 0.5 }]),
  draw(c) {
    const u = 0.5 - 0.5 * Math.cos(Math.min(1, (c.t * c.p.speed) / Math.max(1, c.dur)) * Math.PI * 2);
    pass(program('g:mandel', MANDEL_FS), { res: [c.W, c.H], zoom: 2.6 * Math.pow(0.5, u * c.p.depth), ctr: [-0.743643887, 0.131825904], c0: mixColor(c.colors, 0), c1: mixColor(c.colors, 0.5), c2: mixColor(c.colors, 1) });
  },
});

/* ---------- 二重振り子 ---------- */
registerGen('pendulum', {
  label: '二重振り子', cat: 'algo', desc: 'わずかな違いで動きがまったく変わる（カオス）', defaults: { count: 3, speed: 1, colors: ['#ff5c5c', '#ffd23d', '#3ddcff'] },
  params: params([{ key: 'count', label: '本数', min: 1, max: 6, step: 1 }]),
  draw(c) {
    const { ctx, W, H, p } = c, n = Math.round(p.count), m = Math.min(W, H), L = m * 0.22;
    const s = c.sim(() => Array.from({ length: n }, (_, k) => ({ a: 2.2 + k * 0.004, b: 2.6, va: 0, vb: 0, trail: [] })),
      (st, dt) => { const g = 9.8, h = dt * p.speed * 1.6 / 4; for (const q of st) { for (let i = 0; i < 4; i++) { const d = q.a - q.b, den = 3 - Math.cos(2 * d);
        const aa = (-3 * g * Math.sin(q.a) - g * Math.sin(q.a - 2 * q.b) - 2 * Math.sin(d) * (q.vb * q.vb + q.va * q.va * Math.cos(d))) / den;
        const ab = (2 * Math.sin(d) * (2 * q.va * q.va + 2 * g * Math.cos(q.a) + q.vb * q.vb * Math.cos(d))) / den;
        q.va += aa * h; q.vb += ab * h; q.a += q.va * h; q.b += q.vb * h; }
        q.trail.push(Math.sin(q.a) + Math.sin(q.b), Math.cos(q.a) + Math.cos(q.b)); if (q.trail.length > 360) q.trail.splice(0, 2); } }, 1 / 60);
    const ox = W / 2, oy = H * 0.42;
    s.forEach((q, k) => {
      const col = mixColor(c.colors, n > 1 ? k / (n - 1) : 0);
      ctx.lineWidth = Math.max(1, m * 0.004);
      for (let i = 2; i < q.trail.length; i += 2) { ctx.strokeStyle = css(col, (i / q.trail.length) * 0.8); ctx.beginPath(); ctx.moveTo(ox + q.trail[i - 2] * L, oy + q.trail[i - 1] * L); ctx.lineTo(ox + q.trail[i] * L, oy + q.trail[i + 1] * L); ctx.stroke(); }
      const x1 = ox + Math.sin(q.a) * L, y1 = oy + Math.cos(q.a) * L, x2 = x1 + Math.sin(q.b) * L, y2 = y1 + Math.cos(q.b) * L;
      ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = Math.max(1, m * 0.005);
      ctx.beginPath(); ctx.moveTo(ox, oy); ctx.lineTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      ctx.fillStyle = css(col); ctx.beginPath(); ctx.arc(x2, y2, m * 0.016, 0, 6.283); ctx.fill();
    });
  },
});

/* ---------- フーリエ級数（回る円で絵を描く） ---------- */
registerGen('epicycles', {
  label: '回る円で描く（フーリエ）', cat: 'algo', desc: '円を重ねて回すだけで、形が描ける', defaults: { terms: 9, speed: 1, shape: 'square', colors: ['#3ddcff', '#ffd23d'] },
  params: params([{ key: 'terms', label: '円の数', min: 1, max: 24, step: 1 }, { key: 'shape', label: '形', type: 'select', options: [['square', '四角い波'], ['saw', 'のこぎり'], ['star', '星']] }]),
  draw(c) {
    const { ctx, W, H, p } = c, m = Math.min(W, H), R = m * 0.17, n = Math.round(p.terms);
    const tip = (th) => { let x = 0, y = 0; const pts = []; for (let k = 0; k < n; k++) { let f, a; if (p.shape === 'saw') { f = k + 1; a = (k % 2 ? -1 : 1) / f; } else if (p.shape === 'star') { f = k % 2 ? -(k * 2 + 1) : k * 2 + 1; a = 1 / (Math.abs(f) ** 1.4); } else { f = 2 * k + 1; a = 1 / f; } pts.push([x, y, Math.abs(a) * R]); x += Math.cos(th * f) * a * R; y += Math.sin(th * f) * a * R; } return { x, y, pts }; };
    const th = c.t * p.speed * 1.4, cur = tip(th), ox = p.shape === 'star' ? W / 2 : W * 0.28, oy = H / 2;
    ctx.lineWidth = Math.max(1, m * 0.003);
    cur.pts.forEach(([x, y, r]) => { ctx.strokeStyle = 'rgba(255,255,255,0.22)'; ctx.beginPath(); ctx.arc(ox + x, oy + y, r, 0, 6.283); ctx.stroke(); });
    ctx.strokeStyle = css(mixColor(c.colors, 0)); ctx.beginPath(); ctx.moveTo(ox, oy); cur.pts.slice(1).forEach(([x, y]) => ctx.lineTo(ox + x, oy + y)); ctx.lineTo(ox + cur.x, oy + cur.y); ctx.stroke();
    ctx.strokeStyle = css(mixColor(c.colors, 1)); ctx.lineWidth = Math.max(1.5, m * 0.006); ctx.lineJoin = 'round'; ctx.beginPath();
    if (p.shape === 'star') { for (let i = 0; i <= 240; i++) { const q = tip(th - (i / 240) * 6.283); i ? ctx.lineTo(ox + q.x, oy + q.y) : ctx.moveTo(ox + q.x, oy + q.y); } }
    else { const x0 = W * 0.52; ctx.moveTo(x0, oy + cur.y); for (let i = 1; i <= 200; i++) ctx.lineTo(x0 + (i / 200) * W * 0.44, oy + tip(th - i * 0.035).y); ctx.stroke(); ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(ox + cur.x, oy + cur.y); ctx.lineTo(x0, oy + cur.y); }
    ctx.stroke();
  },
});

/* ---------- 群れ（ボイド） ---------- */
registerGen('boids', {
  label: '群れ（ボイド）', cat: 'algo', desc: '3 つの規則だけで、鳥や魚の群れのように動く', defaults: { count: 140, speed: 1, colors: ['#3ddcff', '#b79cff', '#ff9ec7'] },
  params: params([{ key: 'count', label: '数', min: 20, max: 400, step: 10 }]),
  draw(c) {
    const { ctx, W, H, p } = c, n = Math.round(p.count), asp = W / H;
    const s = c.sim(() => { const b = new Float32Array(n * 4); for (let i = 0; i < n; i++) { b[i * 4] = rnd(i, 1, c.seed) * asp; b[i * 4 + 1] = rnd(i, 2, c.seed); const a = rnd(i, 3, c.seed) * 6.283; b[i * 4 + 2] = Math.cos(a) * 0.2; b[i * 4 + 3] = Math.sin(a) * 0.2; } return b; },
      (b, dt) => { const h = dt * p.speed; for (let i = 0; i < n; i++) { let cx = 0, cy = 0, vx = 0, vy = 0, sx = 0, sy = 0, k = 0; const x = b[i * 4], y = b[i * 4 + 1];
        for (let j = 0; j < n; j++) { if (j === i) continue; const dx = b[j * 4] - x, dy = b[j * 4 + 1] - y, d2 = dx * dx + dy * dy; if (d2 > 0.02) continue; k++; cx += dx; cy += dy; vx += b[j * 4 + 2]; vy += b[j * 4 + 3]; if (d2 < 0.002) { sx -= dx / (d2 + 1e-4) * 0.002; sy -= dy / (d2 + 1e-4) * 0.002; } }
        let ax = sx * 3, ay = sy * 3; if (k) { ax += (cx / k) * 1.2 + (vx / k - b[i * 4 + 2]) * 1.5; ay += (cy / k) * 1.2 + (vy / k - b[i * 4 + 3]) * 1.5; }
        b[i * 4 + 2] += ax * h; b[i * 4 + 3] += ay * h; const sp = Math.hypot(b[i * 4 + 2], b[i * 4 + 3]) || 1, t = cl(sp, 0.16, 0.34) / sp; b[i * 4 + 2] *= t; b[i * 4 + 3] *= t; }
        for (let i = 0; i < n; i++) { b[i * 4] = (b[i * 4] + b[i * 4 + 2] * h + asp) % asp; b[i * 4 + 1] = (b[i * 4 + 1] + b[i * 4 + 3] * h + 1) % 1; } }, 1 / 30);
    const sz = Math.min(W, H) * 0.02;
    for (let i = 0; i < n; i++) { const a = Math.atan2(s[i * 4 + 3], s[i * 4 + 2]), x = (s[i * 4] / asp) * W, y = s[i * 4 + 1] * H;
      ctx.fillStyle = css(mixColor(c.colors, rnd(i, 5, c.seed))); ctx.beginPath(); ctx.moveTo(x + Math.cos(a) * sz, y + Math.sin(a) * sz); ctx.lineTo(x + Math.cos(a + 2.5) * sz * 0.6, y + Math.sin(a + 2.5) * sz * 0.6); ctx.lineTo(x + Math.cos(a - 2.5) * sz * 0.6, y + Math.sin(a - 2.5) * sz * 0.6); ctx.fill(); }
  },
});

/* ---------- ボロノイ図 ---------- */
const VORO_FS = `in vec2 uv; out vec4 o; uniform vec2 res; uniform float time; uniform vec3 c0; uniform vec3 c1; uniform vec3 c2; uniform float cells; ${GLSL.hash}
void main(){ vec2 p = uv * vec2(res.x / res.y, 1.0) * cells; vec2 i = floor(p), f = fract(p); float d1 = 9.0, d2 = 9.0; vec2 id = vec2(0.0);
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) { vec2 g = vec2(float(x), float(y)); vec2 h = hash22(i + g); vec2 q = g + 0.5 + 0.42 * sin(time * (0.5 + h.x) + h * 6.283) - f; float d = dot(q, q); if (d < d1) { d2 = d1; d1 = d; id = i + g; } else if (d < d2) d2 = d; }
  float e = sqrt(d2) - sqrt(d1); float h = hash21(id); vec3 c = h < 0.5 ? mix(c0, c1, h * 2.0) : mix(c1, c2, h * 2.0 - 1.0);
  c *= 0.55 + 0.45 * smoothstep(0.0, 0.5, sqrt(d1)); c = mix(vec3(1.0), c, smoothstep(0.02, 0.06, e)); c *= 1.0 - smoothstep(0.03, 0.0, sqrt(d1)) * 0.6;
  o = vec4(c, 1.0); }`;
registerGen('voronoi', {
  label: 'ボロノイ図', cat: 'algo', gl: true, desc: 'いちばん近い点ごとに領域を分ける。細胞や石垣のような模様', defaults: { cells: 6, speed: 1, colors: ['#1b2350', '#4c86ff', '#3ddc97'] },
  params: params([{ key: 'cells', label: '細かさ', min: 2, max: 20, step: 1 }]),
  draw(c) { pass(program('g:voro', VORO_FS), { res: [c.W, c.H], time: c.t * c.p.speed, cells: c.p.cells, c0: mixColor(c.colors, 0), c1: mixColor(c.colors, 0.5), c2: mixColor(c.colors, 1) }); },
});

/* ---------- レイトレーシング ---------- */
const RT_FS = `in vec2 uv; out vec4 o; uniform vec2 res; uniform float time; uniform vec3 c0; uniform vec3 c1; uniform vec3 c2;
float sph(vec3 ro, vec3 rd, vec3 c, float r){ vec3 oc = ro - c; float b = dot(oc, rd), h = b * b - dot(oc, oc) + r * r; return h < 0.0 ? -1.0 : -b - sqrt(h); }
vec3 sc(int i){ return i == 0 ? vec3(sin(time) * 1.3, 0.55 + 0.25 * sin(time * 2.0), cos(time) * 1.3) : i == 1 ? vec3(sin(time + 2.1) * 1.3, 0.4, cos(time + 2.1) * 1.3) : vec3(sin(time + 4.2) * 1.3, 0.7 + 0.2 * cos(time * 1.7), cos(time + 4.2) * 1.3); }
vec3 trace(vec3 ro, vec3 rd){ vec3 col = vec3(0.0), att = vec3(1.0);
  for (int b = 0; b < 3; b++) { float t = 1e9; int hit = -1; for (int i = 0; i < 3; i++) { float d = sph(ro, rd, sc(i), i == 1 ? 0.4 : 0.5); if (d > 0.001 && d < t) { t = d; hit = i; } }
    float tp = rd.y < 0.0 ? -ro.y / rd.y : -1.0; vec3 L = normalize(vec3(0.5, 0.9, -0.4));
    if (tp > 0.001 && tp < t) { vec3 p = ro + rd * tp; float ch = mod(floor(p.x) + floor(p.z), 2.0); float sh = 1.0; for (int i = 0; i < 3; i++) if (sph(p + vec3(0, 0.001, 0), L, sc(i), i == 1 ? 0.4 : 0.5) > 0.0) sh = 0.35;
      col += att * mix(vec3(0.08), vec3(0.75), ch) * sh * exp(-tp * 0.07); ro = p + vec3(0, 0.001, 0); rd = reflect(rd, vec3(0, 1, 0)); att *= 0.25; }
    else if (hit >= 0) { vec3 p = ro + rd * t; vec3 n = normalize(p - sc(hit)); vec3 base = hit == 0 ? c0 : hit == 1 ? c1 : c2;
      col += att * (base * (0.15 + 0.85 * max(dot(n, L), 0.0)) + pow(max(dot(reflect(rd, n), L), 0.0), 40.0)) * 0.7; ro = p + n * 0.001; rd = reflect(rd, n); att *= 0.45; }
    else { col += att * mix(vec3(0.02, 0.03, 0.08), vec3(0.25, 0.35, 0.6), clamp(rd.y * 1.5 + 0.2, 0.0, 1.0)); break; } }
  return col; }
void main(){ vec2 q = (uv * 2.0 - 1.0) * vec2(res.x / res.y, 1.0); vec3 ro = vec3(0.0, 1.5, -4.2); vec3 rd = normalize(vec3(q.x, q.y - 0.25, 1.7)); o = vec4(pow(trace(ro, rd), vec3(0.8)), 1.0); }`;
registerGen('raytrace', {
  label: 'レイトレーシング', cat: 'algo', gl: true, desc: '光の反射を 1 本ずつ追いかけて、鏡の球と床を描く', defaults: { speed: 1, colors: ['#ff5c5c', '#ffd23d', '#4c86ff'] }, params: params(),
  draw(c) { pass(program('g:rt', RT_FS), { res: [c.W, c.H], time: c.t * c.p.speed * 0.8, c0: mixColor(c.colors, 0), c1: mixColor(c.colors, 0.5), c2: mixColor(c.colors, 1) }); },
});

/* ---------- 流れの線（フローフィールド） ---------- */
registerGen('flow', {
  label: '流れの線', cat: 'algo', desc: '見えない流れに沿って、たくさんの線が伸びていく', defaults: { count: 500, speed: 1, colors: ['#4c86ff', '#3ddcff', '#b79cff', '#ff9ec7'] },
  params: params([{ key: 'count', label: '線の数', min: 50, max: 2000, step: 50 }]),
  draw(c) {
    const { ctx, W, H, p } = c, n = Math.round(p.count), steps = Math.min(90, Math.floor(c.t * p.speed * 22) + 2), m = Math.min(W, H);
    const ang = (x, y) => (Math.sin(x * 3.1 + c.seed) + Math.cos(y * 2.7 - c.seed * 1.3) + Math.sin((x + y) * 1.9 + c.t * 0.15 * p.speed)) * 1.6;
    ctx.lineWidth = Math.max(1, m * 0.0022); ctx.lineCap = 'round';
    for (let i = 0; i < n; i++) {
      let x = rnd(i, 1, c.seed) * (W / H), y = rnd(i, 2, c.seed);
      ctx.strokeStyle = css(mixColor(c.colors, rnd(i, 3, c.seed)), 0.55); ctx.beginPath(); ctx.moveTo((x / (W / H)) * W, y * H);
      for (let k = 0; k < steps; k++) { const a = ang(x, y); x += Math.cos(a) * 0.006; y += Math.sin(a) * 0.006; ctx.lineTo((x / (W / H)) * W, y * H); }
      ctx.stroke();
    }
  },
});

/* ---------- 木が育つ（再帰） ---------- */
registerGen('tree', {
  label: '育つ木（再帰）', cat: 'algo', desc: '同じ規則をくり返すだけで、枝分かれした木になる', defaults: { depth: 10, speed: 1, spread: 0.45, colors: ['#8a5a2b', '#56ab2f', '#b8ffd9'] },
  params: params([{ key: 'depth', label: '枝分かれの回数', min: 3, max: 12, step: 1 }, { key: 'spread', label: '枝の開き', min: 0.1, max: 1, step: 0.01 }]),
  draw(c) {
    const { ctx, W, H, p } = c, D = Math.round(p.depth), grow = c.t * p.speed * 2.2, m = Math.min(W, H);
    let k = 0;
    const br = (x, y, a, len, d) => {
      const u = cl(grow - (D - d), 0, 1); if (u <= 0 || d === 0) return;
      const sway = Math.sin(c.t * 1.2 + d) * 0.02 * (D - d);
      const x2 = x + Math.cos(a + sway) * len * u, y2 = y + Math.sin(a + sway) * len * u;
      ctx.strokeStyle = css(mixColor(c.colors, 1 - d / D)); ctx.lineWidth = Math.max(1, m * 0.0035 * d); ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x2, y2); ctx.stroke();
      const j = rnd(k++, 4, c.seed) - 0.5;
      br(x2, y2, a - p.spread * (1 + j * 0.5), len * (0.72 + j * 0.1), d - 1); br(x2, y2, a + p.spread * (1 - j * 0.5), len * (0.72 - j * 0.1), d - 1);
    };
    ctx.lineCap = 'round'; br(W / 2, H * 0.96, -Math.PI / 2, H * 0.24, D);
  },
});

/* ---------- ヒルベルト曲線 ---------- */
registerGen('hilbert', {
  label: 'ヒルベルト曲線', cat: 'algo', desc: '1 本の線で平面を埋め尽くす', defaults: { order: 6, speed: 1, colors: ['#ff5c5c', '#ffd23d', '#3ddc97', '#4c86ff', '#b14dff'] },
  params: params([{ key: 'order', label: '細かさ', min: 2, max: 7, step: 1 }]),
  draw(c) {
    const { ctx, W, H, p, state } = c, ord = Math.round(p.order), N = 1 << ord;
    if (!state.pts) { state.pts = []; for (let i = 0; i < N * N; i++) { let rx, ry, t = i, x = 0, y = 0; for (let s = 1; s < N; s *= 2) { rx = 1 & (t / 2); ry = 1 & (t ^ rx); if (!ry) { if (rx) { x = s - 1 - x; y = s - 1 - y; } [x, y] = [y, x]; } x += s * rx; y += s * ry; t = Math.floor(t / 4); } state.pts.push(x, y); } }
    const m = Math.min(W, H) * 0.9, ox = (W - m) / 2, oy = (H - m) / 2, cell = m / N, tot = N * N, k = Math.min(tot, Math.floor((c.t * p.speed / 5) * tot) + 2);
    ctx.lineWidth = Math.max(1, cell * 0.35); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const seg = Math.max(8, Math.floor(tot / 64));
    for (let s = 0; s < k - 1; s += seg) { ctx.strokeStyle = css(mixColor(c.colors, s / tot)); ctx.beginPath(); for (let i = s; i <= Math.min(k - 1, s + seg); i++) { const x = ox + (state.pts[i * 2] + 0.5) * cell, y = oy + (state.pts[i * 2 + 1] + 0.5) * cell; i === s ? ctx.moveTo(x, y) : ctx.lineTo(x, y); } ctx.stroke(); }
  },
});

/* ---------- パネル：複数のジェネレーターを並べて同時に動かす ---------- */
registerGen('panels', {
  label: 'パネル（並べて同時に動かす）', cat: 'algo', heavy: true,
  desc: '好きなジェネレーターを格子に並べる（params.items に種類の一覧）',
  defaults: { items: ['sort', 'maze', 'life', 'mandelbrot', 'pendulum', 'epicycles', 'boids', 'raytrace', 'voronoi', 'flow', 'tree', 'hilbert'], cols: 4, gap: 0.012, labels: true, stagger: 0.12 },
  params: [{ key: 'cols', label: '列の数', min: 1, max: 6, step: 1 }, { key: 'gap', label: 'すき間', min: 0, max: 0.05, step: 0.002 }, { key: 'stagger', label: '順に現れる間隔', min: 0, max: 0.5, step: 0.01 }, { key: 'labels', label: '名前を表示', type: 'toggle' }],
  draw(c) {
    const { ctx, W, H, p } = c, items = p.items || [], cols = Math.max(1, Math.round(p.cols)), rows = Math.ceil(items.length / cols);
    const g = p.gap * W, cw = (W - g * (cols + 1)) / cols, chh = (H - g * (rows + 1)) / rows, fs = Math.max(8, chh * 0.075);
    items.forEach((it, k) => {
      const spec = typeof it === 'string' ? { type: it } : it;
      const st = c.item.start + k * p.stagger;
      if (c.T < st || !GENS[spec.type] || spec.type === 'panels') return;
      const x = g + (k % cols) * (cw + g), y = g + Math.floor(k / cols) * (chh + g), lab = p.labels ? fs * 1.9 : 0;
      ctx.fillStyle = 'rgba(255,255,255,0.045)'; ctx.fillRect(x, y, cw, chh);
      const child = { anim: 'fade', seed: c.seed + k, ...spec, id: `${c.item.id}:${k}`, start: st, end: c.item.end, x: (x + cw / 2) / W, y: (y + lab + (chh - lab) / 2) / H, w: (cw - 4) / W, h: (chh - lab - 4) / H };
      drawGen(ctx, W, H, child, c.T, { ...c.opts, depth: c.depth + 1, onPending: () => { c.pending = true; } });
      if (lab) { ctx.fillStyle = 'rgba(232,236,248,0.85)'; ctx.font = `${FONTS.gothic.weight} ${fs}px ${FONTS.gothic.family}`; ctx.textBaseline = 'middle'; ctx.textAlign = 'left'; ctx.fillText(spec.label || GENS[spec.type].label, x + fs * 0.6, y + lab / 2); }
    });
  },
});
