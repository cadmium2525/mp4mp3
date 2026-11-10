/*
 * つなぐ：流体（ナビエ–ストークス方程式を GPU で解く）。
 * 速度の場を「移流 → 渦の強調 → 圧力を解いて発散を消す」の順に毎ステップ更新し、色のついたインクを流す。
 * 解像度と刻み（1/60 秒）を固定しているので、プレビューと書き出しで同じ流れになる。
 */
import { registerGen, mixColor, textPoints, rnd } from './index.js';
import { program, pass, doubleTarget, target, texture, clear, GLSL } from '../gl.js';

const H0 = `in vec2 uv; out vec4 o; uniform vec2 px;`;
const FS = {
  advect: `${H0} uniform sampler2D vel; uniform sampler2D src; uniform float dt; uniform float diss; uniform vec2 asp; uniform float cap;
void main(){ vec2 p = uv - dt * texture(vel, uv).xy * asp; o = clamp(texture(src, p) * diss, -cap, cap); }`,
  splat: `${H0} uniform sampler2D src; uniform vec2 pt; uniform vec3 val; uniform float rad; uniform vec2 asp;
void main(){ vec2 d = (uv - pt) / asp; o = texture(src, uv) + vec4(val * exp(-dot(d, d) / rad), 0.0); }`,
  stamp: `${H0} uniform sampler2D src; uniform sampler2D mask; uniform vec3 ca; uniform vec3 cb; uniform vec3 cc; uniform float amt;
void main(){ float m = texture(mask, uv).a; vec3 c = uv.x < 0.5 ? mix(ca, cb, uv.x * 2.0) : mix(cb, cc, uv.x * 2.0 - 1.0); o = texture(src, uv) + vec4(c * m * amt, 0.0); }`,
  curl: `${H0} uniform sampler2D vel;
void main(){ float l = texture(vel, uv - vec2(px.x, 0)).y, r = texture(vel, uv + vec2(px.x, 0)).y, b = texture(vel, uv - vec2(0, px.y)).x, t = texture(vel, uv + vec2(0, px.y)).x; o = vec4(0.5 * (r - l - t + b), 0, 0, 1); }`,
  vort: `${H0} uniform sampler2D vel; uniform sampler2D curl; uniform float amt; uniform float dt;
void main(){ float l = texture(curl, uv - vec2(px.x, 0)).x, r = texture(curl, uv + vec2(px.x, 0)).x, b = texture(curl, uv - vec2(0, px.y)).x, t = texture(curl, uv + vec2(0, px.y)).x, c = texture(curl, uv).x;
  vec2 f = 0.5 * vec2(abs(t) - abs(b), abs(r) - abs(l)); f /= length(f) + 1e-4; f *= amt * c; f.y *= -1.0;
  vec2 v = texture(vel, uv).xy + f * dt; o = vec4(clamp(v, -30.0, 30.0), 0, 1); }`,
  div: `${H0} uniform sampler2D vel;
void main(){ float l = texture(vel, uv - vec2(px.x, 0)).x, r = texture(vel, uv + vec2(px.x, 0)).x, b = texture(vel, uv - vec2(0, px.y)).y, t = texture(vel, uv + vec2(0, px.y)).y;
  vec2 c = texture(vel, uv).xy; if (uv.x - px.x < 0.0) l = -c.x; if (uv.x + px.x > 1.0) r = -c.x; if (uv.y - px.y < 0.0) b = -c.y; if (uv.y + px.y > 1.0) t = -c.y;
  o = vec4(0.5 * (r - l + t - b), 0, 0, 1); }`,
  clearp: `${H0} uniform sampler2D src; uniform float k; void main(){ o = texture(src, uv) * k; }`,
  jacobi: `${H0} uniform sampler2D prs; uniform sampler2D dv;
void main(){ float l = texture(prs, uv - vec2(px.x, 0)).x, r = texture(prs, uv + vec2(px.x, 0)).x, b = texture(prs, uv - vec2(0, px.y)).x, t = texture(prs, uv + vec2(0, px.y)).x;
  o = vec4((l + r + b + t - texture(dv, uv).x) * 0.25, 0, 0, 1); }`,
  grad: `${H0} uniform sampler2D prs; uniform sampler2D vel;
void main(){ float l = texture(prs, uv - vec2(px.x, 0)).x, r = texture(prs, uv + vec2(px.x, 0)).x, b = texture(prs, uv - vec2(0, px.y)).x, t = texture(prs, uv + vec2(0, px.y)).x;
  o = vec4(texture(vel, uv).xy - vec2(r - l, t - b), 0, 1); }`,
  show: `${H0} uniform sampler2D dye; uniform float shade; uniform float bright;
void main(){ vec3 c = pow(texture(dye, uv).rgb, vec3(0.8)) * bright;
  // インクの濃淡から面の向きを作って、つやを付ける
  float l = length(c), lx = length(texture(dye, uv + vec2(px.x, 0)).rgb * bright), ly = length(texture(dye, uv + vec2(0, px.y)).rgb * bright);
  vec3 n = normalize(vec3((l - lx) * 3.0, (l - ly) * 3.0, 0.35));
  float diff = clamp(dot(n, normalize(vec3(-0.4, 0.6, 0.7))), 0.0, 1.0);
  float spec = pow(clamp(dot(reflect(vec3(0, 0, -1), n), normalize(vec3(-0.3, 0.5, 0.8))), 0.0, 1.0), 24.0);
  c = c * mix(1.0, 0.55 + 0.75 * diff, shade) + spec * shade * 0.35 * smoothstep(0.1, 0.6, l);
  c = c / (1.0 + c * 0.35); // 明るい所をなだらかに
  float a = clamp(max(c.r, max(c.g, c.b)) * 1.6, 0.0, 1.0);
  o = vec4(c * a, a); }`,
  // 浮動小数のテクスチャに描けない環境用：流体に似たノイズの流れ
  fake: `in vec2 uv; out vec4 o; uniform float time; uniform vec2 res; uniform vec3 ca; uniform vec3 cb; uniform vec3 cc; ${GLSL.hash} ${GLSL.noise}
void main(){ vec2 p = uv * vec2(res.x / res.y, 1.0) * 2.2; float t = time * 0.25;
  vec2 q = vec2(fbm(p + t), fbm(p + 5.2 - t)); vec2 r = vec2(fbm(p + 4.0 * q + vec2(1.7, 9.2) + 0.6 * t), fbm(p + 4.0 * q + vec2(8.3, 2.8) - 0.5 * t));
  float f = fbm(p + 4.0 * r); vec3 c = mix(ca, cb, clamp(f * f * 3.2, 0.0, 1.0)); c = mix(c, cc, clamp(length(q), 0.0, 1.0)); c *= f * 2.2;
  float a = clamp(max(c.r, max(c.g, c.b)), 0.0, 1.0); o = vec4(c * a, a); }`,
};

registerGen('fluid', {
  label: '流体（インク）', cat: 'hero', gl: true, heavy: true,
  desc: 'ナビエ–ストークス方程式を毎フレーム解いて、色のインクを流す',
  defaults: { emitters: 4, force: 1, swirl: 1, fade: 0.16, bright: 1.15, shade: 1, text: '', textSize: 0.42, font: 'gothic', hold: 0.6, colors: ['#ff5c5c', '#ff9a3d', '#ffd23d', '#ff3dbb', '#4c86ff', '#3ddcff'] },
  params: [
    { key: 'text', label: '文字から始める', type: 'text' },
    { key: 'textSize', label: '文字の大きさ', min: 0.1, max: 0.8, step: 0.01 },
    { key: 'hold', label: '文字が崩れ始めるまで', min: 0, max: 5, step: 0.1 },
    { key: 'emitters', label: 'インクの噴き出し口', min: 0, max: 10, step: 1 },
    { key: 'force', label: '勢い', min: 0.2, max: 3, step: 0.1 },
    { key: 'swirl', label: '渦の強さ', min: 0, max: 3, step: 0.1 },
    { key: 'fade', label: '消える速さ', min: 0, max: 2, step: 0.05 },
    { key: 'bright', label: '明るさ', min: 0.3, max: 3, step: 0.1 },
    { key: 'shade', label: 'つや', min: 0, max: 1, step: 0.05 },
  ],
  draw(c) {
    const { p, W, H, S } = c;
    const ca = mixColor(c.colors, 0), cb = mixColor(c.colors, 0.5), cc = mixColor(c.colors, 1);
    if (!S.float) {
      pass(program('fl:fake', FS.fake), { time: c.t, res: [W, H], ca, cb, cc });
      return;
    }
    const aspect = W / H;
    // シミュレーションの解像度は出力の大きさによらず固定（見た目をそろえるため）
    const sh = 160, sw = Math.round(sh * aspect), dh = 576, dw = Math.round(dh * aspect);
    const id = c.item.id;
    const fopt = { float: true, linear: true };
    const vel = doubleTarget(`fl:v:${id}`, sw, sh, fopt), dye = doubleTarget(`fl:d:${id}`, dw, dh, fopt), prs = doubleTarget(`fl:p:${id}`, sw, sh, fopt);
    const dv = target(`fl:dv:${id}`, sw, sh, fopt), cu = target(`fl:cu:${id}`, sw, sh, fopt);
    const px = [1 / sw, 1 / sh], asp = [1 / aspect, 1];
    const splat = (dbl, pt, val, rad) => { pass(program('fl:splat', FS.splat), { src: { tex: dbl.read.tex }, pt, val, rad, asp, px }, dbl.write); dbl.swap(); };
    const P = (k) => program('fl:' + k, FS[k]);

    c.sim(() => {
      for (const d of [vel, dye, prs]) for (const t of [d.a, d.b]) clear(t);
      if (p.text) {
        // 文字の形にインクを置く
        const { canvas } = textPoints(p.text, p.font, 768, Math.round(768 / aspect), p.textSize, { step: 4 });
        const mask = texture(`fl:mask:${id}`, canvas);
        pass(P('stamp'), { src: { tex: dye.read.tex }, mask: { tex: mask }, ca, cb, cc, amt: 0.8, px }, dye.write);
        dye.swap();
      }
      return { n: 0 };
    }, (st, dt, time) => {
      const active = !p.text || time >= p.hold;
      const n = Math.round(p.emitters);
      if (active) {
        // 噴き出し口：なめらかな軌道を動きながら、進む向きに力とインクを加える
        for (let i = 0; i < n; i++) {
          const f1 = 0.21 + rnd(i, 1, c.seed) * 0.33, f2 = 0.17 + rnd(i, 2, c.seed) * 0.31, ph1 = rnd(i, 3, c.seed) * 6.28, ph2 = rnd(i, 4, c.seed) * 6.28;
          const x = 0.5 + 0.42 * Math.sin(time * f1 * 2 + ph1), y = 0.5 + 0.38 * Math.sin(time * f2 * 2 + ph2);
          const vx = 0.42 * f1 * 2 * Math.cos(time * f1 * 2 + ph1), vy = 0.38 * f2 * 2 * Math.cos(time * f2 * 2 + ph2);
          const pulse = 0.55 + 0.45 * Math.sin(time * (0.9 + rnd(i, 5, c.seed)) + i * 2.1);
          splat(vel, [x, y], [vx * 2.6 * p.force * pulse, vy * 2.6 * p.force * pulse, 0], 0.0022);
          const col = mixColor(c.colors, (i / Math.max(1, n) + time * 0.03 + rnd(i, 6, c.seed) * 0.2) % 1);
          const k = 0.13 * pulse;
          splat(dye, [x, y], [col[0] * k, col[1] * k, col[2] * k], 0.0011);
        }
        // 文字を崩すための最初のひと押し（文字の中心から外へ、渦を混ぜて）
        if (p.text && time < p.hold + 0.5) {
          for (let i = 0; i < 6; i++) {
            const a = rnd(i, 30 + st.n % 7, c.seed) * 6.28, r = rnd(i, 40, c.seed) * 0.25;
            const x = 0.5 + Math.cos(a) * r * 1.4, y = 0.5 + Math.sin(a) * r * 0.5;
            splat(vel, [x, y], [Math.cos(a + 1.2) * 0.5 * p.force, Math.sin(a + 1.2) * 0.5 * p.force, 0], 0.004);
          }
        }
      }
      st.n++;
      // 渦を強める
      pass(P('curl'), { vel: { tex: vel.read.tex }, px }, cu);
      pass(P('vort'), { vel: { tex: vel.read.tex }, curl: { tex: cu.tex }, amt: 11 * p.swirl, dt, px }, vel.write); vel.swap();
      // 圧力を解いて、湧き出し・吸い込みをなくす
      pass(P('div'), { vel: { tex: vel.read.tex }, px }, dv);
      pass(P('clearp'), { src: { tex: prs.read.tex }, k: 0.8, px }, prs.write); prs.swap();
      for (let i = 0; i < 22; i++) { pass(P('jacobi'), { prs: { tex: prs.read.tex }, dv: { tex: dv.tex }, px }, prs.write); prs.swap(); }
      pass(P('grad'), { prs: { tex: prs.read.tex }, vel: { tex: vel.read.tex }, px }, vel.write); vel.swap();
      // 流れに乗せて運ぶ
      pass(P('advect'), { vel: { tex: vel.read.tex }, src: { tex: vel.read.tex }, dt, diss: 1 - 0.12 * dt, asp, px, cap: 30 }, vel.write); vel.swap();
      pass(P('advect'), { vel: { tex: vel.read.tex }, src: { tex: dye.read.tex }, dt, diss: active ? 1 - p.fade * dt : 1, asp, px, cap: 1.15 }, dye.write); dye.swap();
    }, 1 / 60);
    pass(P('show'), { dye: { tex: dye.read.tex }, px: [1 / dw, 1 / dh], shade: p.shade, bright: p.bright });
  },
});
