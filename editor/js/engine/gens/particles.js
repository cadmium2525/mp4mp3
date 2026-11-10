/*
 * つなぐ：点で描くジェネレーター（粒子の文字・ストレンジアトラクター・銀河の衝突）。
 * 位置は CPU で計算し、GL の加算合成の点として描く（光が重なって明るくなる）。
 */
import { registerGen, mixColor, textPoints, rnd, noise1 } from './index.js';
import { points } from '../gl.js';

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const easeOut = (u) => 1 - (1 - u) ** 3;
const easeInOut = (u) => (u < 0.5 ? 4 * u * u * u : 1 - (-2 * u + 2) ** 3 / 2);

/* ---------------- 粒子の文字 ---------------- */

registerGen('particletext', {
  label: '粒子の文字', cat: 'text', gl: true,
  desc: '粒子が集まって文字になり、最後は風に散る',
  defaults: { text: 'TSUNAGU', font: 'gothic', size: 0.26, count: 9000, inDur: 1.8, outDur: 1.3, swirl: 1, glow: 1, mode: 'assemble', colors: ['#ffffff', '#ffe9c2', '#ff9a3d', '#ff6a3d'], colorBy: 'x' },
  params: [
    { key: 'text', label: '文字', type: 'text' },
    { key: 'font', label: '書体', type: 'select', options: [['gothic', 'ゴシック'], ['rounded', '丸ゴシック'], ['mincho', '明朝'], ['mono', '等幅']] },
    { key: 'size', label: '大きさ', min: 0.05, max: 0.6, step: 0.01 },
    { key: 'count', label: '粒の数', min: 1000, max: 30000, step: 500 },
    { key: 'inDur', label: '集まる時間', min: 0.3, max: 5, step: 0.1 },
    { key: 'outDur', label: '散る時間', min: 0, max: 5, step: 0.1 },
    { key: 'swirl', label: '渦', min: 0, max: 3, step: 0.1 },
    { key: 'glow', label: '粒の大きさ', min: 0.3, max: 3, step: 0.1 },
    { key: 'mode', label: '出かた', type: 'select', options: [['assemble', '集まる'], ['burst', '中心から広がる'], ['rain', '上から降る']] },
    { key: 'colorBy', label: '色の付け方', type: 'select', options: [['x', '左→右'], ['random', 'ばらばら'], ['y', '上→下']] },
  ],
  draw(c) {
    const { p, W, H, state } = c;
    const n = Math.round(p.count);
    if (!state.tx || state.n !== n) {
      // 文字の形を点の集まりにする（解像度は固定なので、プレビューと書き出しで同じ並びになる）
      const tw = 640, th = Math.max(64, Math.round((640 * H) / W));
      const { pts } = textPoints(p.text, p.font, tw, th, p.size, { step: 1 });
      const m = pts.length / 2;
      state.n = n;
      state.tx = new Float32Array(n); state.ty = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const k = m ? Math.floor(rnd(i, 1, c.seed) * m) : 0;
        state.tx[i] = m ? pts[k * 2] + (rnd(i, 2, c.seed) - 0.5) / tw : 0.5;
        state.ty[i] = m ? pts[k * 2 + 1] + (rnd(i, 3, c.seed) - 0.5) / th : 0.5;
      }
      state.buf = new Float32Array(n * 7);
    }
    const buf = state.buf, asp = W / H;
    const t = c.t, outStart = c.dur - p.outDur;
    const base = H * 0.0062 * p.glow;
    for (let i = 0; i < n; i++) {
      const r1 = rnd(i, 4, c.seed), r2 = rnd(i, 5, c.seed), r3 = rnd(i, 6, c.seed);
      const tx = state.tx[i], ty = state.ty[i];
      // 集まる
      const delay = r1 * p.inDur * 0.45;
      const u = clamp01((t - delay) / Math.max(0.05, p.inDur * 0.55));
      const e = easeOut(u);
      let sx, sy;
      if (p.mode === 'burst') { sx = 0.5 + (r2 - 0.5) * 0.02; sy = 0.5 + (r3 - 0.5) * 0.02; }
      else if (p.mode === 'rain') { sx = tx + (r2 - 0.5) * 0.1; sy = -0.1 - r3 * 0.8; }
      else { const ang = r2 * Math.PI * 2, rad = 0.35 + r3 * 0.75; sx = 0.5 + Math.cos(ang) * rad / asp * 1.2; sy = 0.5 + Math.sin(ang) * rad; }
      let x = sx + (tx - sx) * e, y = sy + (ty - sy) * e;
      // 渦を巻きながら近づく
      if (p.swirl && u < 1 && p.mode !== 'rain') {
        const a = (1 - e) * p.swirl * (1.2 + r1) * (r2 > 0.5 ? 1 : -1) * 1.6;
        const dx = (x - 0.5) * asp, dy = y - 0.5, cs = Math.cos(a), sn = Math.sin(a);
        x = 0.5 + (dx * cs - dy * sn) / asp; y = 0.5 + dx * sn + dy * cs;
      }
      // 止まっている間のゆらぎ
      const wob = 0.0012 * (0.4 + r3);
      x += noise1(t * 1.3 + r1 * 40, i % 97, c.seed) * wob;
      y += noise1(t * 1.1 + r2 * 40, (i % 89) + 100, c.seed) * wob;
      let alpha = Math.min(1, u * 3) * (0.55 + 0.45 * r3);
      let size = base * (0.7 + r1 * 0.9) * (1 + (1 - e) * 1.6);
      // 散る
      if (p.outDur > 0 && t > outStart) {
        const v = clamp01((t - outStart - r2 * p.outDur * 0.35) / (p.outDur * 0.65));
        const k = v * v;
        x += k * (0.25 + r1 * 0.5) + Math.sin(v * 5 + r3 * 6.28) * 0.02 * v;
        y += -k * (0.05 + r3 * 0.25) + Math.cos(v * 4 + r1 * 6.28) * 0.03 * v;
        alpha *= 1 - v;
        size *= 1 + v * 1.5;
      }
      const cu = p.colorBy === 'random' ? r1 : p.colorBy === 'y' ? ty : tx;
      const col = mixColor(c.colors, clamp01((cu - 0.12) / 0.76));
      const o = i * 7;
      buf[o] = x * 2 - 1; buf[o + 1] = 1 - y * 2; buf[o + 2] = Math.max(1, size);
      buf[o + 3] = col[0]; buf[o + 4] = col[1]; buf[o + 5] = col[2]; buf[o + 6] = alpha * 0.5;
    }
    points('ptext', buf, n);
  },
});

/* ---------------- ストレンジアトラクター ---------------- */

const ATTRACTORS = {
  lorenz: { f: (x, y, z) => [10 * (y - x), x * (28 - z) - y, x * y - (8 / 3) * z], s: [0.1, 0, 0], dt: 0.004, eq: ['dx/dt = σ (y − x)', 'dy/dt = x (ρ − z) − y', 'dz/dt = x y − β z'] },
  aizawa: { f: (x, y, z) => [(z - 0.7) * x - 3.5 * y, 3.5 * x + (z - 0.7) * y, 0.6 + 0.95 * z - (z * z * z) / 3 - (x * x + y * y) * (1 + 0.25 * z) + 0.1 * z * x * x * x], s: [0.1, 0, 0], dt: 0.008 },
  thomas: { f: (x, y, z) => [Math.sin(y) - 0.208186 * x, Math.sin(z) - 0.208186 * y, Math.sin(x) - 0.208186 * z], s: [1.1, 1.1, -0.01], dt: 0.05 },
  halvorsen: { f: (x, y, z) => [-1.89 * x - 4 * y - 4 * z - y * y, -1.89 * y - 4 * z - 4 * x - z * z, -1.89 * z - 4 * x - 4 * y - x * x], s: [-1.48, -1.51, 2.04], dt: 0.004 },
  dadras: { f: (x, y, z) => [y - 3 * x + 2.7 * y * z, 1.7 * y - x * z + z, 2 * x * y - 9 * z], s: [1.1, 2.1, -2], dt: 0.006 },
  rossler: { f: (x, y, z) => [-y - z, x + 0.2 * y, 0.2 + z * (x - 5.7)], s: [0.1, 0, 0], dt: 0.02 },
  chen: { f: (x, y, z) => [40 * (y - x), (28 - 40) * x - x * z + 28 * y, x * y - 3 * z], s: [-0.1, 0.5, -0.6], dt: 0.002 },
};

registerGen('attractor', {
  label: 'カオス（アトラクター）', cat: 'hero', gl: true,
  desc: 'ローレンツなどの方程式の軌跡を光の線で描く',
  defaults: { kind: 'lorenz', count: 45000, drawDur: 6, rotate: 0.25, tilt: 0.35, zoom: 1, glow: 1, colors: ['#ff7a5c', '#ffd2b0', '#8fc4ff', '#4c86ff'], colorBy: 'side' },
  params: [
    { key: 'kind', label: '種類', type: 'select', options: [['lorenz', 'ローレンツ'], ['aizawa', 'アイザワ'], ['thomas', 'トーマス'], ['halvorsen', 'ハルヴォルセン'], ['dadras', 'ダドラス'], ['rossler', 'レスラー'], ['chen', 'チェン']] },
    { key: 'drawDur', label: '描ききる時間', min: 0.5, max: 30, step: 0.5 },
    { key: 'rotate', label: '回転の速さ', min: -1.5, max: 1.5, step: 0.05 },
    { key: 'tilt', label: '傾き', min: -1.5, max: 1.5, step: 0.05 },
    { key: 'zoom', label: '大きさ', min: 0.3, max: 2.5, step: 0.05 },
    { key: 'glow', label: '線の太さ', min: 0.3, max: 3, step: 0.1 },
    { key: 'colorBy', label: '色の付け方', type: 'select', options: [['side', '左右で分ける'], ['time', '時間の流れ'], ['speed', '速さ']] },
  ],
  draw(c) {
    const { p, W, H, state } = c;
    const n = Math.round(p.count);
    if (!state.pts) {
      const A = ATTRACTORS[p.kind] || ATTRACTORS.lorenz;
      const pts = new Float32Array(n * 4);
      let [x, y, z] = A.s;
      const step = (h) => {
        const k1 = A.f(x, y, z), k2 = A.f(x + k1[0] * h / 2, y + k1[1] * h / 2, z + k1[2] * h / 2);
        const k3 = A.f(x + k2[0] * h / 2, y + k2[1] * h / 2, z + k2[2] * h / 2), k4 = A.f(x + k3[0] * h, y + k3[1] * h, z + k3[2] * h);
        const dx = (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]) / 6, dy = (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]) / 6, dz = (k1[2] + 2 * k2[2] + 2 * k3[2] + k4[2]) / 6;
        x += dx * h; y += dy * h; z += dz * h;
        return Math.hypot(dx, dy, dz);
      };
      for (let i = 0; i < 400; i++) step(A.dt); // 最初のふらつきを捨てる
      let mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9], vmax = 0;
      for (let i = 0; i < n; i++) {
        const v = step(A.dt);
        pts[i * 4] = x; pts[i * 4 + 1] = y; pts[i * 4 + 2] = z; pts[i * 4 + 3] = v;
        mn = [Math.min(mn[0], x), Math.min(mn[1], y), Math.min(mn[2], z)];
        mx = [Math.max(mx[0], x), Math.max(mx[1], y), Math.max(mx[2], z)];
        vmax = Math.max(vmax, v);
      }
      // 中心を原点に、全体が ±1 に収まるように
      const ctr = [(mn[0] + mx[0]) / 2, (mn[1] + mx[1]) / 2, (mn[2] + mx[2]) / 2];
      const sc = 2 / Math.max(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]);
      for (let i = 0; i < n; i++) { pts[i * 4] = (pts[i * 4] - ctr[0]) * sc; pts[i * 4 + 1] = (pts[i * 4 + 1] - ctr[1]) * sc; pts[i * 4 + 2] = (pts[i * 4 + 2] - ctr[2]) * sc; pts[i * 4 + 3] /= vmax; }
      state.pts = pts;
      state.buf = new Float32Array(n * 7);
      state.zUp = p.kind === 'lorenz' || p.kind === 'chen' || p.kind === 'rossler';
    }
    const pts = state.pts, buf = state.buf;
    const shown = Math.max(2, Math.floor(n * clamp01(c.t / Math.max(0.1, p.drawDur))));
    // カメラは左右にゆっくり振る（1 回転させると蝶の形が見えない瞬間ができるため）
    const ang = 0.25 + 0.75 * Math.sin(c.t * p.rotate * 1.6), cs = Math.cos(ang), sn = Math.sin(ang);
    const ct = Math.cos(p.tilt), stl = Math.sin(p.tilt);
    const asp = W / H, zoom = 0.72 * p.zoom, size = H * 0.0042 * p.glow;
    const head = Math.max(40, n * 0.002);
    for (let i = 0; i < shown; i++) {
      let x = pts[i * 4], y = pts[i * 4 + 1], z = pts[i * 4 + 2];
      if (state.zUp) { const tmp = y; y = z; z = -tmp; } // z を上に
      const side = pts[i * 4];
      // Y 軸まわりに回し、少し傾ける
      const x1 = x * cs - z * sn, z1 = x * sn + z * cs;
      const y1 = y * ct - z1 * stl, z2 = y * stl + z1 * ct;
      const persp = 2.6 / (2.6 + z2);
      const u = p.colorBy === 'time' ? i / n : p.colorBy === 'speed' ? pts[i * 4 + 3] : 0.5 + side * 0.9;
      const col = mixColor(c.colors, clamp01(u));
      const h = clamp01(1 - (shown - i) / head); // 先端は明るく
      const o = i * 7;
      buf[o] = (x1 * zoom * persp) / asp; buf[o + 1] = y1 * zoom * persp; buf[o + 2] = Math.max(1, size * persp * (1 + h * 1.6));
      buf[o + 3] = col[0] + h * 0.6; buf[o + 4] = col[1] + h * 0.6; buf[o + 5] = col[2] + h * 0.6; buf[o + 6] = 0.34 + h * 0.5;
    }
    points('attr', buf, shown);
  },
});
export const ATTRACTOR_EQ = Object.fromEntries(Object.entries(ATTRACTORS).map(([k, v]) => [k, v.eq || null]));

/* ---------------- 銀河の衝突 ---------------- */

registerGen('galaxy', {
  label: '銀河の衝突', cat: 'hero', gl: true,
  desc: '2 つの銀河が万有引力で引き合い、尾を引きながら混ざる',
  defaults: { count: 36000, speed: 1, mass: 0.7, distance: 3.2, tilt: 1.05, rotate: 0.05, zoom: 1, glow: 1, stars: 500, colors: ['#ffe2b8', '#ffb070', '#bfe0ff', '#7fb2ff'] },
  params: [
    { key: 'count', label: '星の数', min: 4000, max: 120000, step: 2000 },
    { key: 'speed', label: '時間の速さ', min: 0.2, max: 4, step: 0.1 },
    { key: 'mass', label: '2 つ目の重さ', min: 0.2, max: 1.5, step: 0.05 },
    { key: 'distance', label: '最初の距離', min: 2, max: 6, step: 0.1 },
    { key: 'tilt', label: '見る角度', min: 0, max: 1.5, step: 0.05 },
    { key: 'rotate', label: 'カメラの回転', min: -0.5, max: 0.5, step: 0.01 },
    { key: 'zoom', label: '大きさ', min: 0.3, max: 3, step: 0.05 },
    { key: 'glow', label: '星の大きさ', min: 0.3, max: 3, step: 0.1 },
    { key: 'stars', label: '背景の星', min: 0, max: 3000, step: 100 },
  ],
  draw(c) {
    const { p, W, H } = c;
    const n = Math.round(p.count), half = n >> 1;
    const EPS = 0.18;
    const s = c.sim(() => {
      // 2 つの核。重心が止まるように速度を決める（離心率の大きい軌道で近づく）
      const m1 = 1, m2 = p.mass, M = m1 + m2, d = p.distance;
      const vrel = Math.sqrt(M / d) * 0.62;
      const core = new Float64Array([-d * m2 / M, 0, 0, 0, -vrel * m2 / M, 0, d * m1 / M, 0, 0, 0, vrel * m1 / M, 0]);
      const pos = new Float32Array(n * 3), vel = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        const g = i < half ? 0 : 1, m = g ? m2 : m1;
        const r = 0.18 + Math.sqrt(rnd(i, 1, c.seed)) * 1.25 * (g ? Math.sqrt(m2) : 1);
        const a = rnd(i, 2, c.seed) * Math.PI * 2;
        const v = Math.sqrt(m * r * r / Math.pow(r * r + EPS * EPS, 1.5)); // 円運動の速さ
        // 円盤の傾き（銀河ごとに違う向き）
        const inc = g ? 1.0 : -0.5, ci = Math.cos(inc), si = Math.sin(inc);
        let x = Math.cos(a) * r, y = Math.sin(a) * r, z = (rnd(i, 3, c.seed) - 0.5) * 0.06;
        let vx = -Math.sin(a) * v * (g ? -1 : 1), vy = Math.cos(a) * v * (g ? -1 : 1), vz = 0;
        const y2 = y * ci - z * si, z2 = y * si + z * ci, vy2 = vy * ci - vz * si, vz2 = vy * si + vz * ci;
        pos[i * 3] = x + core[g * 6]; pos[i * 3 + 1] = y2 + core[g * 6 + 1]; pos[i * 3 + 2] = z2 + core[g * 6 + 2];
        vel[i * 3] = vx + core[g * 6 + 3]; vel[i * 3 + 1] = vy2 + core[g * 6 + 4]; vel[i * 3 + 2] = vz2 + core[g * 6 + 5];
      }
      return { core, pos, vel, m1, m2 };
    }, (st, dt) => {
      // 1 ステップ（リープフロッグ法）。星は 2 つの核だけに引かれる（Toomre & Toomre 1972 の方式）
      const h = dt * 0.9 * p.speed, { core, pos, vel, m1, m2 } = st;
      const sub = 2, hh = h / sub;
      for (let k = 0; k < sub; k++) {
        const dx = core[6] - core[0], dy = core[7] - core[1], dz = core[8] - core[2];
        const r3 = Math.pow(dx * dx + dy * dy + dz * dz + EPS * EPS, 1.5);
        core[3] += (m2 * dx / r3) * hh; core[4] += (m2 * dy / r3) * hh; core[5] += (m2 * dz / r3) * hh;
        core[9] -= (m1 * dx / r3) * hh; core[10] -= (m1 * dy / r3) * hh; core[11] -= (m1 * dz / r3) * hh;
        for (let j = 0; j < 2; j++) { core[j * 6] += core[j * 6 + 3] * hh; core[j * 6 + 1] += core[j * 6 + 4] * hh; core[j * 6 + 2] += core[j * 6 + 5] * hh; }
        const ax0 = core[0], ay0 = core[1], az0 = core[2], ax1 = core[6], ay1 = core[7], az1 = core[8];
        for (let i = 0; i < n; i++) {
          const o = i * 3, x = pos[o], y = pos[o + 1], z = pos[o + 2];
          let ex = ax0 - x, ey = ay0 - y, ez = az0 - z;
          let q = m1 / Math.pow(ex * ex + ey * ey + ez * ez + EPS * EPS, 1.5);
          let fx = ex * q, fy = ey * q, fz = ez * q;
          ex = ax1 - x; ey = ay1 - y; ez = az1 - z;
          q = m2 / Math.pow(ex * ex + ey * ey + ez * ez + EPS * EPS, 1.5);
          fx += ex * q; fy += ey * q; fz += ez * q;
          vel[o] += fx * hh; vel[o + 1] += fy * hh; vel[o + 2] += fz * hh;
          pos[o] += vel[o] * hh; pos[o + 1] += vel[o + 1] * hh; pos[o + 2] += vel[o + 2] * hh;
        }
      }
    }, 1 / 30);
    const ns = Math.round(p.stars);
    if (!c.state.buf || c.state.buf.length !== (n + ns + 2) * 7) c.state.buf = new Float32Array((n + ns + 2) * 7);
    const buf = c.state.buf, asp = W / H;
    const ang = c.t * p.rotate, cs = Math.cos(ang), sn = Math.sin(ang), ct = Math.cos(p.tilt), stl = Math.sin(p.tilt);
    const zoom = 0.3 * p.zoom, size = H * 0.0034 * p.glow;
    let k = 0;
    // 背景の星
    for (let i = 0; i < ns; i++) {
      const o = k++ * 7, tw = 0.5 + 0.5 * Math.sin(c.t * (0.5 + rnd(i, 23, c.seed) * 2) + i);
      buf[o] = rnd(i, 20, c.seed) * 2 - 1; buf[o + 1] = rnd(i, 21, c.seed) * 2 - 1; buf[o + 2] = Math.max(1, H * 0.0016 * (0.5 + rnd(i, 22, c.seed)));
      buf[o + 3] = 0.8; buf[o + 4] = 0.85; buf[o + 5] = 1; buf[o + 6] = 0.12 + 0.3 * tw * rnd(i, 24, c.seed);
    }
    const proj = (x, y, z) => {
      const x1 = x * cs - y * sn, y1 = x * sn + y * cs;
      const y2 = y1 * ct - z * stl, z2 = y1 * stl + z * ct;
      const pe = 6 / (6 + z2);
      return [(x1 * zoom * pe) / asp, y2 * zoom * pe, pe];
    };
    for (let i = 0; i < n; i++) {
      const o3 = i * 3, [px, py, pe] = proj(s.pos[o3], s.pos[o3 + 1], s.pos[o3 + 2]);
      const g = i < half ? 0 : 1;
      const col = mixColor(c.colors, g ? 0.62 + rnd(i, 9, c.seed) * 0.38 : rnd(i, 9, c.seed) * 0.38);
      const o = k++ * 7;
      buf[o] = px; buf[o + 1] = py; buf[o + 2] = Math.max(1, size * pe * (0.7 + rnd(i, 8, c.seed) * 0.8));
      buf[o + 3] = col[0]; buf[o + 4] = col[1]; buf[o + 5] = col[2]; buf[o + 6] = 0.2;
    }
    // 核（明るい中心）
    for (let j = 0; j < 2; j++) {
      const [px, py, pe] = proj(s.core[j * 6], s.core[j * 6 + 1], s.core[j * 6 + 2]);
      const col = mixColor(c.colors, j ? 0.8 : 0.15);
      const o = k++ * 7;
      buf[o] = px; buf[o + 1] = py; buf[o + 2] = H * 0.032 * p.glow * pe * (j ? Math.sqrt(p.mass) : 1);
      buf[o + 3] = col[0] + 0.3; buf[o + 4] = col[1] + 0.3; buf[o + 5] = col[2] + 0.3; buf[o + 6] = 0.4;
    }
    points('galaxy', buf, k);
  },
});

export { easeInOut };
