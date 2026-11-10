/*
 * つなぐ：仕上げのエフェクト（GPU で画面全体にかける）。
 * ブルーム（光のにじみ）・カラーグレーディング・レンズの色ずれ・放射ブラー・衝撃波など。
 * 2D キャンバスの絵をテクスチャにして、シェーダーを順にかけ、結果を 2D キャンバスへ戻す。
 */
import { EFFECTS, withMotion } from './fx.js';
import { GL, program, pass, target, texture, bind, GLSL, rgb } from './gl.js';

/** 仕上げエフェクトの一覧（EFFECTS に layer: 'post' として登録する） */
const DEFS = {
  bloom: { label: 'ブルーム（光のにじみ）', icon: '✺', params: [['threshold', 'しきい値', 0, 1, 0.01, 0.55], ['radius', '広がり', 0.3, 2, 0.05, 1]] },
  grade: { label: 'カラーグレーディング', icon: '◐', params: [], presets: true },
  chroma: { label: 'レンズの色ずれ', icon: '◍' },
  lens: { label: 'レンズのゆがみ', icon: '◯' },
  zoomblur: { label: '放射ブラー', icon: '✹' },
  dirblur: { label: '方向ブラー', icon: '⇶', params: [['angle', '向き', 0, 360, 1, 0]] },
  tiltshift: { label: 'ミニチュア風ぼかし', icon: '▤', params: [['focus', 'ピントの位置', 0, 1, 0.01, 0.5], ['band', 'ピントの幅', 0.05, 0.6, 0.01, 0.2]] },
  shockwave: { label: '衝撃波', icon: '◎', params: [['cx', '中心 X', 0, 1, 0.01, 0.5], ['cy', '中心 Y', 0, 1, 0.01, 0.5]] },
  ripple: { label: '波ゆらぎ', icon: '≋' },
  godrays: { label: '光芒', icon: '☀', params: [['cx', '光源 X', 0, 1, 0.01, 0.5], ['cy', '光源 Y', 0, 1, 0.01, 0.3]] },
  lightleak: { label: '光漏れ', icon: '☼' },
  scanlines: { label: 'ブラウン管', icon: '▦' },
  vhs: { label: 'VHS', icon: '▣' },
  halftone: { label: 'ハーフトーン', icon: '⣿' },
  pixelate: { label: 'モザイク', icon: '▩' },
  kaleido: { label: '万華鏡', icon: '✳', params: [['sides', '枚数', 2, 16, 1, 6]] },
  mirror: { label: '鏡', icon: '◧' },
  edge: { label: 'ネオン輪郭', icon: '⬡' },
  duotone: { label: '2 色', icon: '◒' },
  hue: { label: '色相ずらし', icon: '🎨' },
  posterize: { label: 'ポスタライズ', icon: '▥' },
  invert: { label: '反転', icon: '◓' },
  sharpen: { label: 'シャープ', icon: '◆' },
  camera: { label: 'カメラワーク', icon: '🎥', noRamp: true },
};
for (const [k, v] of Object.entries(DEFS)) EFFECTS[k] = { ...v, layer: 'post' };

export const GRADES = {
  cinematic: { label: 'シネマ（ティール＆オレンジ）', contrast: 1.12, sat: 1.05, temp: 0.02, shadows: [0.0, 0.07, 0.1], highlights: [0.1, 0.05, -0.03], gamma: 0.97 },
  warm: { label: 'あたたかい', contrast: 1.05, sat: 1.08, temp: 0.12, shadows: [0.03, 0.01, 0], highlights: [0.06, 0.03, -0.02], gamma: 1 },
  cool: { label: 'クール', contrast: 1.06, sat: 0.96, temp: -0.12, shadows: [0, 0.02, 0.06], highlights: [-0.02, 0.01, 0.05], gamma: 1 },
  vivid: { label: 'あざやか', contrast: 1.15, sat: 1.35, temp: 0, shadows: [0, 0, 0], highlights: [0, 0, 0], gamma: 0.98 },
  fade: { label: 'フィルム（淡い）', contrast: 0.9, sat: 0.85, temp: 0.04, shadows: [0.06, 0.05, 0.06], highlights: [0.02, 0.01, -0.02], gamma: 1.03, lift: 0.05 },
  noir: { label: 'モノクロ（硬め）', contrast: 1.3, sat: 0, temp: 0, shadows: [0, 0, 0], highlights: [0, 0, 0], gamma: 0.95 },
  dream: { label: 'ドリーミー', contrast: 0.95, sat: 1.1, temp: 0.03, shadows: [0.05, 0.02, 0.08], highlights: [0.06, 0.02, 0.04], gamma: 1.05, lift: 0.03 },
  cyber: { label: 'サイバー', contrast: 1.18, sat: 1.2, temp: -0.05, shadows: [0.06, 0, 0.12], highlights: [-0.04, 0.06, 0.08], gamma: 0.96 },
  sepia: { label: 'セピア', contrast: 1.05, sat: 0.25, temp: 0.2, shadows: [0.05, 0.03, 0], highlights: [0.08, 0.05, 0], gamma: 1 },
};

const HEAD = `in vec2 uv; out vec4 o; uniform sampler2D src; uniform vec2 res; uniform float k; uniform float time;`;

const FS = {
  copy: `${HEAD} void main(){ o = texture(src, uv); }`,
  bright: `${HEAD} uniform float th;
void main(){ vec3 c = texture(src, uv).rgb; float l = max(c.r, max(c.g, c.b)); o = vec4(c * smoothstep(th, th + 0.25, l), 1.0); }`,
  down: `${HEAD} uniform vec2 px;
void main(){ vec4 s = texture(src, uv) * 4.0;
  s += texture(src, uv + px * vec2(-1, -1)); s += texture(src, uv + px * vec2(1, -1)); s += texture(src, uv + px * vec2(-1, 1)); s += texture(src, uv + px * vec2(1, 1));
  o = s / 8.0; }`,
  up: `${HEAD} uniform vec2 px; uniform sampler2D add; uniform float w;
void main(){ vec4 s = texture(src, uv + px * vec2(-1, 0)) + texture(src, uv + px * vec2(1, 0)) + texture(src, uv + px * vec2(0, -1)) + texture(src, uv + px * vec2(0, 1));
  s += (texture(src, uv + px * vec2(-0.7, -0.7)) + texture(src, uv + px * vec2(0.7, -0.7)) + texture(src, uv + px * vec2(-0.7, 0.7)) + texture(src, uv + px * vec2(0.7, 0.7)));
  o = s / 8.0 * w + texture(add, uv); }`,
  bloomMix: `${HEAD} uniform sampler2D glow;
void main(){ vec4 c = texture(src, uv); vec3 g = texture(glow, uv).rgb * k * 1.6;
  // スクリーン合成に近い足し方（白飛びしにくい）
  o = vec4(c.rgb + g * (1.0 - c.rgb * 0.45), c.a); }`,
  grade: `${HEAD} uniform float contrast; uniform float sat; uniform float temp; uniform float gamma; uniform float lift; uniform vec3 sh; uniform vec3 hi;
void main(){ vec4 c0 = texture(src, uv); vec3 c = c0.rgb;
  c.r *= 1.0 + temp; c.b *= 1.0 - temp;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(l), c, sat);
  c = (c - 0.5) * contrast + 0.5;
  l = clamp(dot(c, vec3(0.2126, 0.7152, 0.0722)), 0.0, 1.0);
  c += sh * (1.0 - l) * (1.0 - l) + hi * l * l;
  c = pow(max(c, 0.0), vec3(gamma));
  c = c * (1.0 - lift) + lift;
  o = vec4(mix(c0.rgb, clamp(c, 0.0, 1.0), k), c0.a); }`,
  chroma: `${HEAD}
void main(){ vec2 d = uv - 0.5; float r2 = dot(d, d); vec2 off = d * r2 * k * 0.25;
  o = vec4(texture(src, uv + off).r, texture(src, uv).g, texture(src, uv - off).b, 1.0); }`,
  lens: `${HEAD}
void main(){ vec2 d = uv - 0.5; float r2 = dot(d, d); vec2 p = 0.5 + d * (1.0 + k * 0.6 * r2) / (1.0 + k * 0.3);
  vec3 c = texture(src, p).rgb; if (p.x < 0.0 || p.x > 1.0 || p.y < 0.0 || p.y > 1.0) c = vec3(0.0);
  o = vec4(c * (1.0 - r2 * k * 0.9), 1.0); }`,
  zoomblur: `${HEAD} uniform vec2 ctr; ${GLSL.hash}
void main(){ vec2 d = uv - ctr; vec3 c = vec3(0.0); float n = hash21(uv * res + time);
  for (int i = 0; i < 24; i++) { float s = 1.0 - k * 0.35 * (float(i) + n) / 24.0; c += texture(src, ctr + d * s).rgb; }
  o = vec4(c / 24.0, 1.0); }`,
  dirblur: `${HEAD} uniform vec2 dir; ${GLSL.hash}
void main(){ vec3 c = vec3(0.0); float n = hash21(uv * res + time);
  for (int i = 0; i < 24; i++) { float s = ((float(i) + n) / 24.0 - 0.5) * k * 0.12; c += texture(src, uv + dir * s).rgb; }
  o = vec4(c / 24.0, 1.0); }`,
  tiltshift: `${HEAD} uniform float focus; uniform float band; ${GLSL.hash}
void main(){ float d = smoothstep(band * 0.5, band * 0.5 + 0.3, abs(uv.y - focus)); float rad = d * k * 0.02;
  vec3 c = vec3(0.0); float a = hash21(uv * res) * 6.283;
  for (int i = 0; i < 16; i++) { float r = sqrt((float(i) + 0.5) / 16.0) * rad; a += 2.39996; c += texture(src, uv + vec2(cos(a), sin(a) * res.x / res.y) * r).rgb; }
  c /= 16.0; float l = dot(c, vec3(0.3, 0.6, 0.1)); c = mix(vec3(l), c, 1.0 + 0.25 * k);
  o = vec4(c, 1.0); }`,
  shockwave: `${HEAD} uniform vec2 ctr; uniform float prog;
void main(){ vec2 d = uv - ctr; d.x *= res.x / res.y; float r = length(d); float rad = prog * 1.2; float w = 0.09;
  float e = (r - rad) / w; float amp = exp(-e * e) * k * 0.06 * (1.0 - prog);
  vec2 dir = r > 0.0 ? d / r : vec2(0.0); dir.x *= res.y / res.x;
  vec2 p = uv - dir * amp * sign(e + 0.0001) * 1.0;
  vec3 c = vec3(texture(src, p + dir * amp * 0.25).r, texture(src, p).g, texture(src, p - dir * amp * 0.25).b);
  o = vec4(c + exp(-e * e * 4.0) * 0.12 * k * (1.0 - prog), 1.0); }`,
  ripple: `${HEAD}
void main(){ vec2 p = uv + vec2(sin(uv.y * 28.0 + time * 3.0), cos(uv.x * 22.0 + time * 2.4)) * k * 0.012; o = vec4(texture(src, p).rgb, 1.0); }`,
  godrays: `${HEAD} uniform vec2 ctr; ${GLSL.hash}
void main(){ vec3 base = texture(src, uv).rgb; vec2 d = (uv - ctr); vec3 acc = vec3(0.0); float n = hash21(uv * res + time); float w = 1.0;
  for (int i = 0; i < 32; i++) { float s = 1.0 - 0.9 * (float(i) + n) / 32.0; vec3 c = texture(src, ctr + d * s).rgb; float l = max(c.r, max(c.g, c.b)); acc += c * smoothstep(0.55, 1.0, l) * w; w *= 0.96; }
  o = vec4(base + acc / 32.0 * k * 3.0, 1.0); }`,
  lightleak: `${HEAD} ${GLSL.hash} ${GLSL.noise}
void main(){ vec3 c = texture(src, uv).rgb; float t = time * 0.25;
  float a = fbm(vec2(uv.x * 1.3 + t, uv.y * 0.6 - t * 0.7)); float b = fbm(vec2(uv.x * 0.8 - t * 0.6 + 7.0, uv.y * 1.1 + 3.0));
  vec3 leak = vec3(1.0, 0.45, 0.15) * smoothstep(0.45, 0.9, a) * smoothstep(0.2, 1.0, 1.0 - uv.x) + vec3(1.0, 0.2, 0.5) * smoothstep(0.5, 0.95, b) * smoothstep(0.3, 1.0, uv.x) * 0.7;
  o = vec4(1.0 - (1.0 - c) * (1.0 - leak * k), 1.0); }`,
  scanlines: `${HEAD}
void main(){ vec2 d = uv - 0.5; vec2 p = 0.5 + d * (1.0 + k * 0.12 * dot(d, d));
  vec3 c = vec3(texture(src, p + vec2(0.0015 * k, 0.0)).r, texture(src, p).g, texture(src, p - vec2(0.0015 * k, 0.0)).b);
  float line = 0.5 + 0.5 * sin(p.y * res.y * 3.14159 / max(1.0, res.y / 360.0)); c *= 1.0 - k * 0.35 * line;
  float mask = 0.9 + 0.1 * sin(p.x * res.x * 2.094); c *= mix(1.0, mask, k);
  if (p.x < 0.0 || p.x > 1.0 || p.y < 0.0 || p.y > 1.0) c = vec3(0.0);
  o = vec4(c * (1.0 + 0.15 * k), 1.0); }`,
  vhs: `${HEAD} ${GLSL.hash}
void main(){ float ln = floor(uv.y * 240.0); float jit = (hash21(vec2(ln, floor(time * 30.0))) - 0.5) * 0.004 * k;
  float band = smoothstep(0.0, 0.02, abs(fract(uv.y * 1.0 - time * 0.23) - 0.5) - 0.47); jit += band * 0.02 * k * (hash21(vec2(ln, time)) - 0.3);
  vec2 p = uv + vec2(jit, 0.0);
  float y = dot(texture(src, p).rgb, vec3(0.299, 0.587, 0.114));
  vec3 cb = texture(src, p + vec2(0.006 * k, 0.0)).rgb, cr = texture(src, p - vec2(0.006 * k, 0.0)).rgb;
  vec3 c = vec3(y) + (vec3(cr.r, (cb.g + cr.g) * 0.5, cb.b) - vec3(dot(cr, vec3(0.299, 0.587, 0.114)), dot((cb + cr) * 0.5, vec3(0.299, 0.587, 0.114)), dot(cb, vec3(0.299, 0.587, 0.114)))) * 1.2;
  c += (hash21(uv * res + time * 60.0) - 0.5) * 0.08 * k; c = mix(c, c * vec3(1.02, 0.98, 1.06), k);
  o = vec4(c, 1.0); }`,
  halftone: `${HEAD}
void main(){ float cell = mix(4.0, 14.0, k) * res.y / 720.0; mat2 m = mat2(0.7071, -0.7071, 0.7071, 0.7071); vec2 p = m * (uv * res);
  vec2 g = floor(p / cell) * cell + cell * 0.5; vec2 c0 = (transpose(m) * g) / res; vec3 col = texture(src, c0).rgb; float l = dot(col, vec3(0.3, 0.6, 0.1));
  float r = length(p - g) / (cell * 0.5); float dotv = smoothstep(sqrt(l) * 1.25, sqrt(l) * 1.25 - 0.15, r);
  o = vec4(mix(vec3(0.04), col * 1.15, dotv), 1.0); }`,
  pixelate: `${HEAD}
void main(){ float n = mix(240.0, 24.0, k); vec2 g = vec2(n * res.x / res.y, n); o = vec4(texture(src, (floor(uv * g) + 0.5) / g).rgb, 1.0); }`,
  kaleido: `${HEAD} uniform float sides;
void main(){ vec2 d = uv - 0.5; d.x *= res.x / res.y; float a = atan(d.y, d.x) + time * 0.1 * k; float r = length(d); float seg = 6.28318 / sides;
  a = mod(a, seg); a = abs(a - seg * 0.5); vec2 p = vec2(cos(a), sin(a)) * r; p.x *= res.y / res.x; o = vec4(texture(src, fract(p + 0.5)).rgb, 1.0); }`,
  mirror: `${HEAD}
void main(){ vec2 p = uv; p.x = p.x > 0.5 ? 1.0 - p.x : p.x; o = vec4(texture(src, p).rgb, 1.0); }`,
  edge: `${HEAD} uniform vec3 col;
void main(){ vec2 px = 1.0 / res; float l[9]; int n = 0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) { l[n++] = dot(texture(src, uv + vec2(float(i), float(j)) * px * 1.5).rgb, vec3(0.3, 0.6, 0.1)); }
  float gx = l[2] + 2.0 * l[5] + l[8] - l[0] - 2.0 * l[3] - l[6]; float gy = l[6] + 2.0 * l[7] + l[8] - l[0] - 2.0 * l[1] - l[2];
  float e = smoothstep(0.08, 0.5, length(vec2(gx, gy))); vec3 c = texture(src, uv).rgb;
  o = vec4(mix(c, c * 0.12 + col * e * 1.6, k), 1.0); }`,
  duotone: `${HEAD} uniform vec3 colA; uniform vec3 colB;
void main(){ vec3 c = texture(src, uv).rgb; float l = dot(c, vec3(0.2126, 0.7152, 0.0722)); o = vec4(mix(c, mix(colA, colB, smoothstep(0.05, 0.95, l)), k), 1.0); }`,
  hue: `${HEAD}
void main(){ vec3 c = texture(src, uv).rgb; float a = k * 6.28318; vec3 kk = vec3(0.57735); float ca = cos(a);
  o = vec4(c * ca + cross(kk, c) * sin(a) + kk * dot(kk, c) * (1.0 - ca), 1.0); }`,
  posterize: `${HEAD}
void main(){ vec3 c = texture(src, uv).rgb; float n = mix(16.0, 3.0, k); o = vec4(floor(c * n + 0.5) / n, 1.0); }`,
  invert: `${HEAD}
void main(){ vec3 c = texture(src, uv).rgb; o = vec4(mix(c, 1.0 - c, k), 1.0); }`,
  sharpen: `${HEAD}
void main(){ vec2 px = 1.0 / res; vec3 c = texture(src, uv).rgb; vec3 b = (texture(src, uv + vec2(px.x, 0)).rgb + texture(src, uv - vec2(px.x, 0)).rgb + texture(src, uv + vec2(0, px.y)).rgb + texture(src, uv - vec2(0, px.y)).rgb) * 0.25;
  o = vec4(c + (c - b) * k * 2.5, 1.0); }`,
  camera: `${HEAD} uniform vec2 pos; uniform float zoom; uniform float rot;
void main(){ vec2 d = uv - 0.5; d.x *= res.x / res.y; float cs = cos(rot), sn = sin(rot); d = mat2(cs, -sn, sn, cs) * d / zoom; d.x *= res.y / res.x;
  vec2 p = d + 0.5 + pos; vec2 m = abs(fract(p * 0.5) * 2.0 - 1.0); // はみ出した所は鏡写しで埋める
  o = vec4(texture(src, m).rgb, 1.0); }`,
};

/** 強さ（始まりと終わりを 0.15 秒でなめらかに） */
function strength(e, t) {
  if (EFFECTS[e.type]?.noRamp) return e.intensity ?? 1;
  const r = Math.min(0.15, (e.end - e.start) / 3);
  const k = Math.min(1, (t - e.start) / r, (e.end - t) / r);
  return Math.max(0, Math.min(1, k)) * (e.intensity ?? 0.6);
}

const P = (e, key, def) => (e.params && e.params[key] != null ? e.params[key] : e[key] != null ? e[key] : def);

/** 1 つのエフェクトを inT → outT にかける */
function run(e, k, t, W, H, inT, outT) {
  const u = { src: { tex: inT.tex }, res: [W, H], k, time: t };
  switch (e.type) {
    case 'bloom': {
      const radius = P(e, 'radius', 1);
      let w = Math.max(8, Math.round(W / 2)), h = Math.max(8, Math.round(H / 2));
      const levels = [];
      let cur = target('bloom0', w, h);
      pass(program('p:bright', FS.bright), { ...u, th: P(e, 'threshold', 0.55) }, cur);
      levels.push(cur);
      const n = Math.max(3, Math.min(6, Math.round(Math.log2(Math.min(W, H) / 24))));
      for (let i = 1; i <= n; i++) {
        w = Math.max(4, w >> 1); h = Math.max(4, h >> 1);
        const d = target('bloomd' + i, w, h);
        pass(program('p:down', FS.down), { src: { tex: cur.tex }, px: [radius / cur.w, radius / cur.h] }, d);
        levels.push(d); cur = d;
      }
      // 小さい方から足し合わせながら拡大
      for (let i = n; i >= 1; i--) {
        const up = target('bloomu' + i, levels[i - 1].w, levels[i - 1].h);
        pass(program('p:up', FS.up), { src: { tex: cur.tex }, add: { tex: levels[i - 1].tex }, px: [radius * 1.5 / cur.w, radius * 1.5 / cur.h], w: 1.0 }, up);
        cur = up;
      }
      pass(program('p:bloomMix', FS.bloomMix), { ...u, glow: { tex: cur.tex } }, outT);
      return;
    }
    case 'grade': {
      const g = { ...(GRADES[P(e, 'preset', 'cinematic')] || GRADES.cinematic), ...(e.params || {}) };
      pass(program('p:grade', FS.grade), { ...u, contrast: g.contrast ?? 1, sat: g.sat ?? 1, temp: g.temp ?? 0, gamma: g.gamma ?? 1, lift: g.lift ?? 0, sh: g.shadows || [0, 0, 0], hi: g.highlights || [0, 0, 0] }, outT);
      return;
    }
    case 'zoomblur': case 'godrays':
      pass(program('p:' + e.type, FS[e.type]), { ...u, ctr: [P(e, 'cx', 0.5), 1 - P(e, 'cy', e.type === 'godrays' ? 0.3 : 0.5)] }, outT);
      return;
    case 'dirblur': { const a = (P(e, 'angle', 0) * Math.PI) / 180; pass(program('p:dirblur', FS.dirblur), { ...u, dir: [Math.cos(a), Math.sin(a) * W / H] }, outT); return; }
    case 'tiltshift': pass(program('p:tiltshift', FS.tiltshift), { ...u, focus: 1 - P(e, 'focus', 0.5), band: P(e, 'band', 0.2) }, outT); return;
    case 'shockwave': {
      const prog = Math.min(1, Math.max(0, (t - e.start) / Math.max(0.05, e.end - e.start)));
      pass(program('p:shockwave', FS.shockwave), { ...u, k: e.intensity ?? 0.8, ctr: [P(e, 'cx', 0.5), 1 - P(e, 'cy', 0.5)], prog: 1 - (1 - prog) ** 2 }, outT);
      return;
    }
    case 'kaleido': pass(program('p:kaleido', FS.kaleido), { ...u, sides: Math.max(2, Math.round(P(e, 'sides', 6))) }, outT); return;
    case 'edge': pass(program('p:edge', FS.edge), { ...u, col: rgb(P(e, 'color', '#3ddcff')) }, outT); return;
    case 'duotone': pass(program('p:duotone', FS.duotone), { ...u, colA: rgb(P(e, 'colorA', '#1b1464')), colB: rgb(P(e, 'colorB', '#ffd23d')) }, outT); return;
    case 'camera': {
      // キーフレーム（keys / to）で scale（ズーム）・x・y（移動）・rotation（回転）を動かす
      const m = withMotion({ scale: 1, x: 0, y: 0, rotation: 0, ...e }, t);
      pass(program('p:camera', FS.camera), { ...u, zoom: Math.max(0.05, m.scale ?? 1), pos: [m.x || 0, -(m.y || 0)], rot: ((m.rotation || 0) * Math.PI) / 180 }, outT);
      return;
    }
    default:
      pass(program('p:' + e.type, FS[e.type]), u, outT);
  }
}

/**
 * 仕上げエフェクトをまとめてかける。
 * phase: 'video'（on: 'video' のもの。映像だけにかかる）/ 'all'（それ以外。文字や図形も含めた全体）
 * react: 音に反応する量を返す関数（なければ 1）
 */
export function applyPost(ctx, W, H, effects, t, phase, audio) {
  const list = [];
  for (const e of effects) {
    if (t < e.start || t >= e.end) continue;
    const def = EFFECTS[e.type];
    if (!def || def.layer !== 'post' || !FS[e.type] && e.type !== 'bloom') continue;
    if (((e.on || 'all') === 'video') !== (phase === 'video')) continue;
    let k = strength(e, t);
    if (e.react && audio) k *= Math.max(0, 1 + (e.react.amount ?? 1) * (audio.band(e.react.src || 'kick', t) - (e.react.base ?? 0.5)));
    if (k <= 0 && e.type !== 'camera') continue;
    list.push([e, k]);
  }
  if (!list.length) return;
  const S = GL();
  if (!S) return;
  try {
    const srcTex = texture('post:src', ctx.canvas);
    let inT = { tex: srcTex };
    const A = target('post:a', W, H), B = target('post:b', W, H);
    let flip = false;
    list.forEach(([e, k], i) => {
      const last = i === list.length - 1;
      const outT = last ? null : flip ? B : A;
      if (last) bind(null, W, H);
      run(e, k, t, W, H, inT, outT);
      if (!last) { inT = outT; flip = !flip; }
    });
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'copy';
    ctx.drawImage(S.canvas, 0, 0, W, H);
    ctx.restore();
  } catch (err) {
    if (!applyPost.failed) { applyPost.failed = true; console.error('仕上げエフェクトでエラー:', err); }
  }
}
