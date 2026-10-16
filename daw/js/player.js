/*
 * かなでる：ワーカーとのやりとりと、再生（Web Audio）。
 * 曲はワーカーで最後まで描画してから、AudioBuffer として再生する（iPhone でも音が途切れない）。
 */

let worker = null, mp3w = null, seq = 0;
const pending = new Map();

function onMsg(e) {
  const m = e.data;
  const p = pending.get(m.id);
  if (!p) return;
  if (m.type === 'progress') return p.onProgress?.(m.p, m.label);
  pending.delete(m.id);
  if (m.type === 'error') p.reject(new Error(m.message));
  else p.resolve(m);
}

/** ワーカーに頼む。戻り値は結果のメッセージ */
export function call(type, payload = {}, onProgress, transfer = []) {
  if (!worker) { worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' }); worker.onmessage = onMsg; worker.onerror = (e) => console.error(e); }
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, onProgress });
    worker.postMessage({ type, id, ...payload }, transfer);
  });
}

export function encodeMp3(L, R, sr, bitrate, onProgress) {
  if (!mp3w) { mp3w = new Worker(new URL('./mp3worker.js', import.meta.url)); mp3w.onmessage = onMsg; }
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, onProgress });
    mp3w.postMessage({ id, L, R, sr, bitrate });
  });
}

/* ---------------- 再生 ---------------- */

let ctx = null, out = null, analyser = null, splitter = null, anL = null, anR = null, phoneChain = null;

/** 最初のタップで呼ぶ（iPhone は操作のあとでないと音が出ない） */
export function audio() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    ctx = new AC({ latencyHint: 'interactive' });
    out = ctx.createGain();
    analyser = ctx.createAnalyser();
    analyser.fftSize = 8192;
    analyser.smoothingTimeConstant = 0.6;
    splitter = ctx.createChannelSplitter(2);
    anL = ctx.createAnalyser(); anR = ctx.createAnalyser();
    anL.fftSize = anR.fftSize = 2048;
    out.connect(analyser);
    out.connect(splitter);
    splitter.connect(anL, 0); splitter.connect(anR, 1);
    out.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

export const analysers = () => ({ analyser, anL, anR, ctx });

/** スマホのスピーカーのシミュレーション（250Hz 以下を削り、少しこもらせる） */
export function setPhoneSim(on) {
  audio();
  out.disconnect(ctx.destination);
  if (phoneChain) { phoneChain.at(-1).disconnect(); phoneChain = null; }
  if (on) {
    const hp1 = ctx.createBiquadFilter(), hp2 = ctx.createBiquadFilter(), pk = ctx.createBiquadFilter(), lp = ctx.createBiquadFilter();
    hp1.type = hp2.type = 'highpass'; hp1.frequency.value = hp2.frequency.value = 250; hp1.Q.value = hp2.Q.value = 0.7;
    pk.type = 'peaking'; pk.frequency.value = 1800; pk.gain.value = 3; pk.Q.value = 0.8;
    lp.type = 'lowpass'; lp.frequency.value = 12000;
    out.connect(hp1); hp1.connect(hp2); hp2.connect(pk); pk.connect(lp); lp.connect(ctx.destination);
    phoneChain = [hp1, hp2, pk, lp];
  } else out.connect(ctx.destination);
}

export class Transport {
  constructor() {
    this.buffer = null;
    this.src = null;
    this.startCtx = 0;
    this.startPos = 0;
    this.playing = false;
    this.loop = null; // [開始秒, 終了秒]
    this.onEnd = null;
  }
  setBuffer(L, R, sr) {
    const c = audio();
    const b = c.createBuffer(2, L.length, sr);
    b.copyToChannel(L, 0);
    b.copyToChannel(R, 1);
    this.buffer = b;
  }
  get duration() { return this.buffer?.duration || 0; }
  position() {
    if (!this.playing) return this.startPos;
    let p = this.startPos + (ctx.currentTime - this.startCtx);
    if (this.loop && p >= this.loop[1]) {
      const len = this.loop[1] - this.loop[0];
      p = this.loop[0] + ((p - this.loop[0]) % len);
    }
    return p;
  }
  play(from = this.startPos) {
    if (!this.buffer) return;
    const c = audio();
    this.stopSource();
    const s = c.createBufferSource();
    s.buffer = this.buffer;
    if (this.loop) { s.loop = true; s.loopStart = this.loop[0]; s.loopEnd = Math.min(this.loop[1], this.buffer.duration); if (from < this.loop[0] || from >= this.loop[1]) from = this.loop[0]; }
    s.connect(out);
    from = Math.max(0, Math.min(from, this.buffer.duration - 0.01));
    s.start(c.currentTime + 0.03, from);
    this.startCtx = c.currentTime + 0.03;
    this.startPos = from;
    this.src = s;
    this.playing = true;
    s.onended = () => { if (this.src === s) { this.playing = false; this.startPos = 0; this.src = null; this.onEnd?.(); } };
  }
  pause() {
    if (!this.playing) return;
    this.startPos = this.position();
    this.stopSource();
    this.playing = false;
  }
  seek(t) {
    const was = this.playing;
    if (was) this.stopSource();
    this.startPos = Math.max(0, t);
    if (was) this.play(this.startPos);
  }
  stopSource() {
    if (this.src) { const s = this.src; this.src = null; try { s.stop(); } catch { /* 済み */ } }
  }
}

/** 短い音をすぐに鳴らす（試聴用） */
let previewSrc = null;
export function playBuffer(L, R, sr, gain = 1) {
  const c = audio();
  const b = c.createBuffer(2, L.length, sr);
  b.copyToChannel(L, 0);
  b.copyToChannel(R, 1);
  if (previewSrc) { try { previewSrc.stop(); } catch { /* 済み */ } }
  const s = c.createBufferSource();
  const g = c.createGain();
  g.gain.value = gain;
  s.buffer = b;
  s.connect(g).connect(out);
  s.start();
  previewSrc = s;
  return s;
}
export function stopPreview() { if (previewSrc) { try { previewSrc.stop(); } catch { /* 済み */ } previewSrc = null; } }
