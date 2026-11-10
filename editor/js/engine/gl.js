/*
 * つなぐ：WebGL2 の小さな道具箱。
 * ジェネレーター（シェーダー・流体・粒子）と仕上げ（ブルームなど）が共有する 1 つのコンテキストを持つ。
 * GL のキャンバスに描いた結果は、そのつど 2D キャンバスへ drawImage で写す。
 */

let state = null;

/** 共有の GL コンテキスト（使えない環境では null） */
export function GL() {
  if (state) return state.lost ? null : state;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 16;
  const gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
  if (!gl) { state = { lost: true }; return null; }
  const floatExt = gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float');
  gl.getExtension('OES_texture_float_linear');
  state = { gl, canvas, float: !!floatExt, programs: new Map(), targets: new Map(), textures: new Map(), buffers: new Map(), lost: false, gen: 1 };
  canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); state.lost = true; });
  canvas.addEventListener('webglcontextrestored', () => { state = null; });
  // 全画面を覆う三角形
  state.tri = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, state.tri);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
  return state;
}

export const glAvailable = () => !!GL();

const VS = `#version 300 es
in vec2 p; out vec2 uv;
void main(){ uv = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }`;

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(s);
    const lines = src.split('\n').map((l, i) => `${i + 1}: ${l}`).join('\n');
    throw new Error(`シェーダーのコンパイルに失敗: ${log}\n${lines}`);
  }
  return s;
}

/** プログラムを作る（key ごとに使い回す）。vs を省くと全画面用 */
export function program(key, fs, vs = VS) {
  const S = GL();
  let pr = S.programs.get(key);
  if (pr) return pr;
  const { gl } = S;
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs.startsWith('#version') ? fs : `#version 300 es\nprecision highp float;\n${fs}`));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`シェーダーのリンクに失敗: ${gl.getProgramInfoLog(p)}`);
  pr = { p, uni: new Map() };
  S.programs.set(key, pr);
  return pr;
}

function loc(gl, pr, name) {
  if (!pr.uni.has(name)) pr.uni.set(name, gl.getUniformLocation(pr.p, name));
  return pr.uni.get(name);
}

/** ユニフォームをまとめて設定。値：数値 / 配列（長さで型を決める）/ { tex } / { int } */
export function setUniforms(pr, uniforms) {
  const { gl } = GL();
  let unit = 0;
  for (const [k, v] of Object.entries(uniforms)) {
    const l = loc(gl, pr, k);
    if (l == null) continue;
    if (typeof v === 'number') gl.uniform1f(l, v);
    else if (v && v.tex !== undefined) {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, v.tex);
      gl.uniform1i(l, unit++);
    } else if (v && v.int !== undefined) gl.uniform1i(l, v.int);
    else if (v && v.length === 2) gl.uniform2f(l, v[0], v[1]);
    else if (v && v.length === 3) gl.uniform3f(l, v[0], v[1], v[2]);
    else if (v && v.length === 4) gl.uniform4f(l, v[0], v[1], v[2], v[3]);
    else if (v && v.length === 9) gl.uniformMatrix3fv(l, false, v);
    else if (v && v.length === 16) gl.uniformMatrix4fv(l, false, v);
    else if (v && v.length > 4) gl.uniform1fv(l, v);
  }
}

/** 描画先を切り替える（target = null でキャンバス） */
export function bind(target, w, h) {
  const { gl, canvas } = GL();
  if (target) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.fb);
    gl.viewport(0, 0, target.w, target.h);
  } else {
    if (w && h && (canvas.width !== w || canvas.height !== h)) { canvas.width = w; canvas.height = h; }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
  }
}

/** 全画面にシェーダーをかける */
export function pass(pr, uniforms, target = null, { blend = false, clear = false } = {}) {
  const S = GL();
  const { gl } = S;
  bind(target);
  gl.useProgram(pr.p);
  setUniforms(pr, uniforms);
  if (blend) { gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, blend === 'add' ? gl.ONE : gl.ONE_MINUS_SRC_ALPHA); } else gl.disable(gl.BLEND);
  if (clear) { gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); }
  gl.bindBuffer(gl.ARRAY_BUFFER, S.tri);
  const a = gl.getAttribLocation(pr.p, 'p');
  gl.enableVertexAttribArray(a);
  gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}

export function clear(target = null, w, h) {
  const { gl } = GL();
  bind(target, w, h);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
}

/** 描画先のテクスチャ（float: 16bit 浮動小数。使えない環境では 8bit） */
export function target(key, w, h, { float = false, linear = true, repeat = false } = {}) {
  const S = GL();
  const { gl } = S;
  let t = S.targets.get(key);
  const useFloat = float && S.float;
  if (t && t.w === w && t.h === h && t.float === useFloat) return t;
  if (t) { gl.deleteTexture(t.tex); gl.deleteFramebuffer(t.fb); }
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  if (useFloat) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
  else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  const f = linear ? gl.LINEAR : gl.NEAREST;
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, f);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, f);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE);
  const fb = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  t = { tex, fb, w, h, float: useFloat };
  S.targets.set(key, t);
  return t;
}

/** 交互に使う 2 枚組（シミュレーション用）。swap() で入れ替える */
export function doubleTarget(key, w, h, opts) {
  const S = GL();
  let d = S.targets.get('dbl:' + key);
  const a = target(key + ':a', w, h, opts), b = target(key + ':b', w, h, opts);
  if (!d || d.a !== a || d.b !== b) {
    d = { a, b, flip: false, get read() { return this.flip ? this.b : this.a; }, get write() { return this.flip ? this.a : this.b; }, swap() { this.flip = !this.flip; } };
    S.targets.set('dbl:' + key, d);
  }
  return d;
}

/** キャンバスや画像をテクスチャにする（同じ key は上書き） */
export function texture(key, source, { linear = true, repeat = false, flip = true } = {}) {
  const S = GL();
  const { gl } = S;
  let tex = S.textures.get(key);
  if (!tex) { tex = gl.createTexture(); S.textures.set(key, tex); }
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, flip);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  const f = linear ? gl.LINEAR : gl.NEAREST;
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, f);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, f);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE);
  return tex;
}

/** 生のデータ（Float32Array / Uint8Array）からテクスチャを作る */
export function dataTexture(key, w, h, data, { float = false, linear = true } = {}) {
  const S = GL();
  const { gl } = S;
  let tex = S.textures.get(key);
  if (!tex) { tex = gl.createTexture(); S.textures.set(key, tex); }
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  if (float) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, w, h, 0, gl.RGBA, gl.FLOAT, data);
  else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
  const f = linear && !float ? gl.LINEAR : gl.NEAREST;
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, f);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, f);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return tex;
}

/**
 * 点の集まりを描く（粒子・星・軌跡）。
 * data: Float32Array [x, y, 大きさ(px), r, g, b, a] × n（x, y は -1〜1、色は加算合成）
 */
const POINT_VS = `#version 300 es
in vec2 pos; in float size; in vec4 col; out vec4 vcol;
void main(){ vcol = col; gl_Position = vec4(pos, 0.0, 1.0); gl_PointSize = size; }`;
const POINT_FS = `
in vec4 vcol; out vec4 o;
uniform float soft;
void main(){
  vec2 d = gl_PointCoord - 0.5;
  float r = length(d) * 2.0;
  float a = soft > 0.5 ? exp(-r * r * 3.5) * smoothstep(1.0, 0.75, r) : smoothstep(1.0, 0.7, r);
  o = vec4(vcol.rgb * vcol.a * a, vcol.a * a);
}`;

export function points(key, data, n, { target: tg = null, additive = true, soft = true } = {}) {
  const S = GL();
  const { gl } = S;
  const pr = program('points', POINT_FS, POINT_VS);
  let buf = S.buffers.get(key);
  if (!buf) { buf = { b: gl.createBuffer(), size: 0 }; S.buffers.set(key, buf); }
  bind(tg);
  gl.useProgram(pr.p);
  gl.bindBuffer(gl.ARRAY_BUFFER, buf.b);
  if (buf.size < data.byteLength) { gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW); buf.size = data.byteLength; } else gl.bufferSubData(gl.ARRAY_BUFFER, 0, data, 0, n * 7);
  const stride = 28;
  const a0 = gl.getAttribLocation(pr.p, 'pos'), a1 = gl.getAttribLocation(pr.p, 'size'), a2 = gl.getAttribLocation(pr.p, 'col');
  gl.enableVertexAttribArray(a0); gl.vertexAttribPointer(a0, 2, gl.FLOAT, false, stride, 0);
  gl.enableVertexAttribArray(a1); gl.vertexAttribPointer(a1, 1, gl.FLOAT, false, stride, 8);
  gl.enableVertexAttribArray(a2); gl.vertexAttribPointer(a2, 4, gl.FLOAT, false, stride, 12);
  setUniforms(pr, { soft: soft ? 1 : 0 });
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, additive ? gl.ONE : gl.ONE_MINUS_SRC_ALPHA);
  gl.drawArrays(gl.POINTS, 0, n);
  gl.disableVertexAttribArray(a1);
  gl.disableVertexAttribArray(a2);
  gl.disable(gl.BLEND);
}

/** よく使う GLSL の部品 */
export const GLSL = {
  hash: `
float hash11(float p){ p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }
float hash21(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec2 hash22(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }`,
  noise: `
float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i), hash21(i + vec2(1, 0)), u.x), mix(hash21(i + vec2(0, 1)), hash21(i + vec2(1, 1)), u.x), u.y); }
float fbm(vec2 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 5; i++) { s += a * vnoise(p); p = p * 2.03 + 17.3; a *= 0.5; } return s; }`,
  palette: `
vec3 pal(float t, vec3 a, vec3 b, vec3 c, vec3 d){ return a + b * cos(6.28318 * (c * t + d)); }`,
};

/** "#rrggbb" → [r, g, b]（0〜1） */
export function rgb(hex) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(hex || '');
  if (!m) return [1, 1, 1];
  return [parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255];
}
