/*
 * つなぐ：シェーダーで描く 3D（レイマーチング）。
 * ポリゴンを 1 枚も使わず、「この点から形までの距離」を返す数式だけで立体を描く。
 *   fractal … マンデルバルブなどの 3D フラクタル
 *   text3d  … 立体の文字（床への映り込み・カメラワークつき）
 */
import { registerGen, mixColor } from './index.js';
import { program, pass, texture, dataTexture } from '../gl.js';
import { FONTS } from '../fonts.js';

/* ---------------- 3D フラクタル ---------------- */

const FRACTAL_FS = `
in vec2 uv; out vec4 o;
uniform vec2 res; uniform float time; uniform float power; uniform float rotY; uniform float rotX; uniform float zoom;
uniform vec3 colA; uniform vec3 colB; uniform vec3 colC; uniform int kind; uniform float steps; uniform vec4 jc;

mat2 rot(float a){ float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }

// 形までの距離と、色付け用の値（軌道がどこまで近づいたか）
vec2 mandelbulb(vec3 p){
  vec3 z = p; float dr = 1.0, r = 0.0, trap = 1e9;
  for (int i = 0; i < 9; i++) {
    r = length(z); if (r > 2.2) break;
    float th = acos(clamp(z.z / r, -1.0, 1.0)) * power, ph = atan(z.y, z.x) * power, zr = pow(r, power);
    dr = pow(r, power - 1.0) * power * dr + 1.0;
    z = zr * vec3(sin(th) * cos(ph), sin(ph) * sin(th), cos(th)) + p;
    trap = min(trap, length(z));
  }
  return vec2(0.5 * log(r) * r / dr, trap);
}
vec2 mandelbox(vec3 p){
  float sc = 2.0 + 0.6 * sin(time * 0.15 + power); vec3 z = p * 5.0; vec3 c0 = z; float dr = 1.0, trap = 1e9;
  for (int i = 0; i < 10; i++) {
    z = clamp(z, -1.0, 1.0) * 2.0 - z;
    float r2 = dot(z, z);
    if (r2 < 0.25) { z *= 4.0; dr *= 4.0; } else if (r2 < 1.0) { z /= r2; dr /= r2; }
    z = sc * z + c0; dr = dr * abs(sc) + 1.0;
    trap = min(trap, length(z) * 0.12);
  }
  return vec2(length(z) / abs(dr) / 5.0, trap);
}
vec2 julia(vec3 p){
  vec4 z = vec4(p, 0.0); float md2 = 1.0, mz2 = dot(z, z), trap = 1e9;
  for (int i = 0; i < 10; i++) {
    md2 *= 4.0 * mz2;
    z = vec4(z.x * z.x - dot(z.yzw, z.yzw), 2.0 * z.x * z.yzw) + jc;
    mz2 = dot(z, z); trap = min(trap, length(z.xz));
    if (mz2 > 8.0) break;
  }
  return vec2(0.25 * sqrt(mz2 / md2) * log(mz2), trap);
}
vec2 map(vec3 p){
  p.xz *= rot(rotY); p.yz *= rot(rotX);
  if (kind == 1) return mandelbox(p);
  if (kind == 2) return julia(p * 1.15) / vec2(1.15, 1.0);
  return mandelbulb(p);
}
vec3 normal(vec3 p, float e){
  vec2 k = vec2(1.0, -1.0);
  return normalize(k.xyy * map(p + k.xyy * e).x + k.yyx * map(p + k.yyx * e).x + k.yxy * map(p + k.yxy * e).x + k.xxx * map(p + k.xxx * e).x);
}
void main(){
  vec2 q = (uv * 2.0 - 1.0) * vec2(res.x / res.y, 1.0);
  vec3 ro = vec3(0.0, 0.0, -2.6 / zoom), rd = normalize(vec3(q, 1.9));
  float t = 0.0, trap = 0.0, glow = 0.0; bool hit = false; float n = 0.0;
  for (int i = 0; i < 110; i++) {
    if (float(i) >= steps) break;
    vec2 d = map(ro + rd * t);
    float eps = 0.0007 * t;
    glow += exp(-d.x * 14.0) * 0.012;
    if (d.x < eps) { hit = true; trap = d.y; break; }
    t += d.x * 0.9; n += 1.0;
    if (t > 6.0) break;
  }
  vec3 col = vec3(0.0); float a = 0.0;
  if (hit) {
    vec3 p = ro + rd * t; vec3 nr = normal(p, 0.0006 * t);
    float ao = clamp(1.0 - n / steps * 1.15, 0.0, 1.0); ao = ao * ao;
    vec3 l1 = normalize(vec3(-0.6, 0.7, -0.6)), l2 = normalize(vec3(0.7, -0.2, -0.5));
    float d1 = clamp(dot(nr, l1), 0.0, 1.0), d2 = clamp(dot(nr, l2), 0.0, 1.0);
    float fres = pow(1.0 - clamp(dot(nr, -rd), 0.0, 1.0), 3.0);
    float tr = smoothstep(0.45, 1.25, trap);
    vec3 base = mix(colA, colB, smoothstep(0.0, 0.55, tr)); base = mix(base, colC, smoothstep(0.55, 1.0, tr));
    col = base * (0.1 + 0.8 * d1 * ao) + colB * d2 * 0.22 * ao + base * fres * 0.35;
    col += pow(clamp(dot(reflect(rd, nr), l1), 0.0, 1.0), 24.0) * 0.2 * ao;
    a = 1.0;
  }
  col += colB * glow * 0.6 * (1.0 - a);
  a = max(a, clamp(glow * 0.6, 0.0, 1.0));
  col = pow(col, vec3(0.9));
  o = vec4(col * (hit ? 1.0 : 1.0), a) * vec4(vec3(1.0), 1.0);
  o.rgb = min(o.rgb, vec3(1.0)) * (hit ? 1.0 : 1.0);
}`;

registerGen('fractal', {
  label: '3D フラクタル', cat: 'hero', gl: true, heavy: true,
  desc: 'ポリゴン 0 枚。数式だけで描く立体（マンデルバルブなど）',
  defaults: { kind: 'mandelbulb', power: 8, morph: 1.5, rotate: 0.3, tilt: 0.35, zoom: 1, detail: 90, colors: ['#3b1d5e', '#ff7a3d', '#ffe9c2'] },
  params: [
    { key: 'kind', label: '種類', type: 'select', options: [['mandelbulb', 'マンデルバルブ'], ['mandelbox', 'マンデルボックス'], ['julia', 'ジュリア集合（4次元）']] },
    { key: 'power', label: '形（べき）', min: 2, max: 12, step: 0.1 },
    { key: 'morph', label: '形のゆらぎ', min: 0, max: 4, step: 0.1 },
    { key: 'rotate', label: '回転の速さ', min: -1.5, max: 1.5, step: 0.05 },
    { key: 'tilt', label: '傾き', min: -1.5, max: 1.5, step: 0.05 },
    { key: 'zoom', label: '大きさ', min: 0.3, max: 3, step: 0.05 },
    { key: 'detail', label: '細かさ', min: 40, max: 110, step: 5 },
  ],
  draw(c) {
    const { p, W, H } = c;
    const kind = { mandelbulb: 0, mandelbox: 1, julia: 2 }[p.kind] ?? 0;
    const t = c.t;
    pass(program('g:fractal', FRACTAL_FS), {
      res: [W, H], time: t, power: p.power + Math.sin(t * 0.35) * p.morph, rotY: t * p.rotate + 0.4, rotX: p.tilt + Math.sin(t * 0.21) * 0.15, zoom: p.zoom,
      colA: mixColor(c.colors, 0), colB: mixColor(c.colors, 0.5), colC: mixColor(c.colors, 1), kind: { int: kind }, steps: p.detail * (c.q < 1 ? 0.75 : 1),
      jc: [-0.2 + 0.25 * Math.sin(t * 0.31), 0.6 + 0.15 * Math.cos(t * 0.23), 0.2 * Math.sin(t * 0.17 + 1), 0.15 * Math.cos(t * 0.29)],
    });
  },
});

/* ---------------- 立体の文字 ---------------- */

/** 文字の輪郭までの距離（符号つき）を画像にする。8 方向の逐次距離変換（8SSEDT） */
function sdfFromAlpha(alpha, w, h, range) {
  const INF = 1e9;
  const pass2 = (inside) => {
    const dx = new Float32Array(w * h), dy = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) { const on = alpha[i] > 127; if (on === inside) { dx[i] = 0; dy[i] = 0; } else { dx[i] = INF; dy[i] = INF; } }
    const cmp = (i, x, y, ox, oy) => {
      const xx = x + ox, yy = y + oy;
      if (xx < 0 || yy < 0 || xx >= w || yy >= h) return;
      const j = yy * w + xx, nx = dx[j] + ox, ny = dy[j] + oy;
      if (nx * nx + ny * ny < dx[i] * dx[i] + dy[i] * dy[i]) { dx[i] = nx; dy[i] = ny; }
    };
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) { const i = y * w + x; cmp(i, x, y, -1, 0); cmp(i, x, y, 0, -1); cmp(i, x, y, -1, -1); cmp(i, x, y, 1, -1); }
      for (let x = w - 1; x >= 0; x--) cmp(y * w + x, x, y, 1, 0);
    }
    for (let y = h - 1; y >= 0; y--) {
      for (let x = w - 1; x >= 0; x--) { const i = y * w + x; cmp(i, x, y, 1, 0); cmp(i, x, y, 0, 1); cmp(i, x, y, -1, 1); cmp(i, x, y, 1, 1); }
      for (let x = 0; x < w; x++) cmp(y * w + x, x, y, -1, 0);
    }
    const d = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) d[i] = Math.hypot(dx[i], dy[i]);
    return d;
  };
  const dOut = pass2(true), dIn = pass2(false); // 外側の点から文字まで / 内側の点から外まで
  const out = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const sd = alpha[i] > 127 ? -(dIn[i] - 0.5) : dOut[i] - 0.5;
    const v = Math.max(0, Math.min(255, Math.round((0.5 + sd / (2 * range)) * 255)));
    out[i * 4] = v; out[i * 4 + 1] = v; out[i * 4 + 2] = v; out[i * 4 + 3] = 255;
  }
  return out;
}

const TEXT3D_FS = `
in vec2 uv; out vec4 o;
uniform vec2 res; uniform sampler2D sdf; uniform sampler2D colT; uniform vec2 tsize; uniform float range; uniform float depth; uniform float bevel;
uniform vec3 camPos; uniform vec3 camTgt; uniform float fov; uniform float floorY; uniform float refl; uniform vec3 bg; uniform float lightAng; uniform float emis; uniform float fog;

// 文字の板（xy 平面、幅 tsize.x・高さ tsize.y）までの 2D の距離
float d2(vec2 p){
  vec2 q = p / tsize + 0.5;
  vec2 cq = clamp(q, 0.0, 1.0);
  float d = (texture(sdf, vec2(cq.x, 1.0 - cq.y)).r - 0.5) * 2.0 * range; // 画像は上が先頭なので上下を合わせる
  return d + length((q - cq) * tsize);
}
float map(vec3 p){
  float d = d2(p.xy);
  vec2 w = vec2(d, abs(p.z) - depth);
  return min(max(w.x, w.y), 0.0) + length(max(w, 0.0)) - bevel;
}
vec3 normal(vec3 p){
  vec2 e = vec2(0.004, 0.0);
  return normalize(vec3(map(p + e.xyy) - map(p - e.xyy), map(p + e.yxy) - map(p - e.yxy), map(p + e.yyx) - map(p - e.yyx)));
}
float march(vec3 ro, vec3 rd, out float glow){
  float t = 0.0; glow = 0.0;
  for (int i = 0; i < 90; i++) {
    float d = map(ro + rd * t);
    glow += exp(-max(d, 0.0) * 9.0) * 0.02;
    if (d < 0.0015) return t;
    t += d * 0.85;
    if (t > 30.0) break;
  }
  return -1.0;
}
vec3 shade(vec3 p, vec3 rd){
  vec3 n = normal(p);
  vec2 q = clamp(p.xy / tsize + 0.5, 0.0, 1.0);
  vec3 base = texture(colT, q).rgb;
  vec3 l = normalize(vec3(sin(lightAng) * 0.7, 0.75, -cos(lightAng) * 0.9));
  float diff = clamp(dot(n, l), 0.0, 1.0);
  float front = smoothstep(0.5, 0.95, -n.z);               // 正面の面
  float side = 1.0 - front;
  float rim = pow(1.0 - clamp(dot(n, -rd), 0.0, 1.0), 2.5);
  float spec = pow(clamp(dot(reflect(rd, n), l), 0.0, 1.0), 40.0);
  vec3 c = base * (0.18 + 0.82 * diff);
  c = mix(c, base * (0.35 + 0.25 * diff), side * 0.75);     // 側面は暗めに（立体感）
  c += base * front * emis;                                  // 正面は自分で光る
  c += rim * base * 0.5 + spec * 0.5;
  return c;
}
void main(){
  vec2 q = (uv * 2.0 - 1.0) * vec2(res.x / res.y, 1.0);
  vec3 fw = normalize(camTgt - camPos), rt = normalize(cross(vec3(0, 1, 0), fw)), up = cross(fw, rt);
  vec3 rd = normalize(fw * fov + rt * q.x + up * q.y), ro = camPos;
  float glow; float t = march(ro, rd, glow);
  vec3 col = vec3(0.0); float a = 0.0;
  // 床（鏡のように映り込む）
  float tf = rd.y < 0.0 ? (floorY - ro.y) / rd.y : -1.0;
  if (t > 0.0 && (tf < 0.0 || t < tf)) {
    col = shade(ro + rd * t, rd); a = 1.0;
  } else if (tf > 0.0) {
    vec3 p = ro + rd * tf; vec3 r = reflect(rd, vec3(0, 1, 0)); float g2; float t2 = march(p + vec3(0, 0.002, 0), r, g2);
    float fall = exp(-tf * fog * 0.12);
    float fres = 0.25 + 0.75 * pow(1.0 - clamp(-rd.y, 0.0, 1.0), 3.0);
    vec3 rc = vec3(0.0);
    if (t2 > 0.0) { rc = shade(p + r * t2, r) * exp(-t2 * 0.55); }
    rc += g2 * texture(colT, clamp((p.xy + r.xy * 0.5) / tsize + 0.5, 0.0, 1.0)).rgb * 0.5;
    col = (bg * 0.5 + rc * refl * fres) * fall; a = clamp((0.35 + refl * fres * (t2 > 0.0 ? 1.0 : 0.25)) * fall, 0.0, 1.0);
    col /= max(a, 0.001);
  }
  // 文字のまわりの光
  vec3 gc = texture(colT, clamp((ro.xy + rd.xy * 4.0) / tsize + 0.5, 0.0, 1.0)).rgb;
  col += gc * glow * 0.35 * emis; a = max(a, clamp(glow * 0.4 * emis, 0.0, 1.0));
  o = vec4(min(col, vec3(1.6)) * a, a);
}`;

const CAMERAS = {
  // [始点 → 終点]（角度 az, 仰角 el, 距離 dist）
  dolly: [{ az: 0.05, el: 0.12, dist: 9 }, { az: -0.05, el: 0.1, dist: 5.2 }],
  orbit: [{ az: -0.9, el: 0.18, dist: 6 }, { az: 0.5, el: 0.12, dist: 5.4 }],
  rise: [{ az: 0.25, el: -0.02, dist: 5.5 }, { az: 0.0, el: 0.28, dist: 6 }],
  flyby: [{ az: -1.25, el: 0.1, dist: 2.6 }, { az: 0.1, el: 0.12, dist: 5.6 }],
  still: [{ az: 0, el: 0.12, dist: 5.6 }, { az: 0, el: 0.12, dist: 5.6 }],
};

registerGen('text3d', {
  label: '立体の文字', cat: 'text', gl: true, heavy: true,
  desc: '厚みのある 3D の文字。床に映り込み、カメラが動く',
  defaults: { text: 'TSUNAGU', font: 'gothic', depth: 0.35, camera: 'dolly', camDur: 0, reflect: 0.8, emissive: 0.3, light: 0.6, zoom: 1, colors: ['#ffffff', '#ffe9c2', '#ff9a3d', '#ff6a3d'], colorBy: 'x' },
  params: [
    { key: 'text', label: '文字', type: 'text' },
    { key: 'font', label: '書体', type: 'select', options: [['gothic', 'ゴシック'], ['rounded', '丸ゴシック'], ['mincho', '明朝']] },
    { key: 'depth', label: '厚み', min: 0.02, max: 1.2, step: 0.01 },
    { key: 'camera', label: 'カメラ', type: 'select', options: [['dolly', '近づく'], ['orbit', '回り込む'], ['rise', '持ち上がる'], ['flyby', '横から通過'], ['still', '固定']] },
    { key: 'camDur', label: 'カメラの時間（0=全体）', min: 0, max: 20, step: 0.5 },
    { key: 'reflect', label: '床の映り込み', min: 0, max: 1.5, step: 0.05 },
    { key: 'emissive', label: '発光', min: 0, max: 2, step: 0.05 },
    { key: 'zoom', label: '大きさ', min: 0.4, max: 2.5, step: 0.05 },
    { key: 'colorBy', label: '色の付け方', type: 'select', options: [['x', '左→右'], ['y', '上→下'], ['flat', '単色']] },
  ],
  draw(c) {
    const { p, W, H, state } = c;
    const id = c.item.id;
    if (!state.ready) {
      // 文字を描いて、距離の画像と色の画像を作る
      const th = 256, f = FONTS[p.font] || FONTS.gothic;
      const cv = document.createElement('canvas');
      let g = cv.getContext('2d');
      const px = th * 0.62;
      g.font = `${f.weight} ${px}px ${f.family}`;
      const lines = String(p.text).split('\n');
      const tw = Math.min(4096, Math.ceil(Math.max(...lines.map((l) => g.measureText(l).width)) + th * 0.5));
      cv.width = tw; cv.height = Math.round(th * (0.4 + lines.length * 0.72));
      g = cv.getContext('2d', { willReadFrequently: true });
      g.font = `${f.weight} ${px}px ${f.family}`;
      g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#fff';
      lines.forEach((ln, i) => g.fillText(ln, cv.width / 2, cv.height / 2 + (i - (lines.length - 1) / 2) * px * 1.12));
      const img = g.getImageData(0, 0, cv.width, cv.height);
      const alpha = new Uint8Array(cv.width * cv.height);
      for (let i = 0; i < alpha.length; i++) alpha[i] = img.data[i * 4 + 3];
      state.range = 24;
      dataTexture(`t3:sdf:${id}`, cv.width, cv.height, sdfFromAlpha(alpha, cv.width, cv.height, state.range));
      // 色（文字の位置に沿ったグラデーション）
      const cc = document.createElement('canvas');
      cc.width = 256; cc.height = 64;
      const cg = cc.getContext('2d');
      const grad = p.colorBy === 'y' ? cg.createLinearGradient(0, 0, 0, 64) : cg.createLinearGradient(0, 0, 256, 0);
      const cols = p.colorBy === 'flat' ? [c.colors[0], c.colors[0]] : c.colors;
      cols.forEach((col, i) => grad.addColorStop(cols.length === 1 ? 0 : i / (cols.length - 1), col));
      cg.fillStyle = grad; cg.fillRect(0, 0, 256, 64);
      texture(`t3:col:${id}`, cc, { flip: false });
      state.w = cv.width; state.h = cv.height; state.ready = true;
    }
    const S = c.S;
    // 文字の板の大きさ（世界の単位）。幅が 7 を超えないように縮める
    const th = 1.6 * p.zoom * (state.h / 256), tw = th * (state.w / state.h);
    const k = Math.min(7.2 / tw, 2.8 / th);
    const tsize = [tw * k, th * k];
    const cam = CAMERAS[p.camera] || CAMERAS.dolly;
    const u = Math.min(1, c.t / Math.max(0.1, p.camDur || c.dur));
    const e = 1 - (1 - u) ** 3;
    const az = cam[0].az + (cam[1].az - cam[0].az) * e, el = cam[0].el + (cam[1].el - cam[0].el) * e, dist = (cam[0].dist + (cam[1].dist - cam[0].dist) * e) * Math.max(1, (9 / 16) * (W / H) > 1 ? 1 : 1.9 / (W / H));
    const floorY = -tsize[1] * 0.5 + (state.range / 256) * 0.2 * tsize[1];
    const tgt = [0, floorY * 0.25, 0];
    const camPos = [Math.sin(az) * Math.cos(el) * dist, tgt[1] + Math.sin(el) * dist + 0.25, -Math.cos(az) * Math.cos(el) * dist];
    pass(program('g:text3d', TEXT3D_FS), {
      res: [W, H], sdf: { tex: S.textures.get(`t3:sdf:${id}`) }, colT: { tex: S.textures.get(`t3:col:${id}`) }, tsize,
      range: (state.range / state.h) * tsize[1], depth: p.depth * 0.5 * k, bevel: 0.012,
      camPos, camTgt: tgt, fov: 1.6, floorY, refl: p.reflect, bg: [0.02, 0.025, 0.04], lightAng: p.light + c.t * 0.15, emis: p.emissive, fog: 1,
    });
  },
});
