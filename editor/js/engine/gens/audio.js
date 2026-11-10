/*
 * つなぐ：音の可視化（スペクトラム・波形・円形・ピアノロール）。
 * 動画の音（BGM・効果音・動画の音声のミックス）に合わせて動く。
 */
import { registerGen, mixColor, css, noise1 } from './index.js';
import { trackNotes, beatsPerBar, secPerBeat } from '../../../../daw/js/engine/song.js';
import { pitchesOf } from '../../../../daw/js/engine/dsp.js';

const NB = 48;
const tmpS = new Float32Array(NB), tmpW = new Float32Array(512);

/** 音がないとき（まだ解析前など）は、それらしく動く仮の値を返す */
function spectrumOf(c, out) {
  if (c.audio) return c.audio.spectrum(c.T, out);
  for (let b = 0; b < NB; b++) out[b] = Math.max(0, 0.45 - b * 0.006 + 0.3 * noise1(c.T * 3 + b * 0.37, b, c.seed));
  return out;
}

registerGen('spectrum', {
  label: 'スペクトラム', cat: 'audio', audio: true,
  desc: '音の高さごとの強さを棒や線で表示',
  defaults: { style: 'bars', bars: 48, mirror: false, gap: 0.25, round: true, base: 0.5, colors: ['#3ddc97', '#3ddcff', '#4c86ff', '#b14dff', '#ff3dbb'] },
  params: [
    { key: 'style', label: '形', type: 'select', options: [['bars', '棒'], ['line', '線'], ['dots', '点'], ['area', '面']] },
    { key: 'bars', label: '本数', min: 8, max: 48, step: 1 },
    { key: 'mirror', label: '上下対称', type: 'toggle' },
    { key: 'gap', label: 'すき間', min: 0, max: 0.8, step: 0.05 },
    { key: 'base', label: '基準の高さ', min: 0, max: 1, step: 0.05 },
  ],
  draw(c) {
    const { ctx, W, H, p } = c;
    const s = spectrumOf(c, tmpS);
    const n = Math.round(p.bars), bw = W / n;
    const val = (i) => { const a = (i / n) * NB, b = ((i + 1) / n) * NB; let m = 0; for (let k = Math.floor(a); k < Math.ceil(b) && k < NB; k++) m = Math.max(m, s[k]); return m; };
    const baseY = p.mirror ? H / 2 : H * (0.5 + p.base * 0.5);
    const maxH = p.mirror ? H / 2 : baseY;
    if (p.style === 'line' || p.style === 'area') {
      ctx.beginPath();
      for (let i = 0; i <= n; i++) { const x = (i / n) * W, y = baseY - val(Math.min(n - 1, i)) * maxH * 0.95; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
      const g = ctx.createLinearGradient(0, 0, W, 0);
      c.colors.forEach((col, i) => g.addColorStop(i / Math.max(1, c.colors.length - 1), col));
      if (p.style === 'area') { ctx.lineTo(W, baseY); ctx.lineTo(0, baseY); ctx.closePath(); ctx.globalAlpha = 0.55; ctx.fillStyle = g; ctx.fill(); ctx.globalAlpha = 1; }
      ctx.strokeStyle = g; ctx.lineWidth = Math.max(2, H * 0.008); ctx.lineJoin = 'round'; ctx.stroke();
      return;
    }
    for (let i = 0; i < n; i++) {
      const v = val(i), h = Math.max(H * 0.006, v * maxH * 0.95), x = i * bw + (bw * p.gap) / 2, w = bw * (1 - p.gap);
      ctx.fillStyle = css(mixColor(c.colors, i / (n - 1)));
      if (p.style === 'dots') {
        const r = w / 2, cnt = Math.floor(h / (w * 1.25));
        for (let k = 0; k <= cnt; k++) { ctx.globalAlpha = 0.35 + 0.65 * (k / Math.max(1, cnt)); ctx.beginPath(); ctx.arc(x + r, baseY - k * w * 1.25 - r, r * 0.8, 0, 6.283); ctx.fill(); if (p.mirror) { ctx.beginPath(); ctx.arc(x + r, baseY + k * w * 1.25 + r, r * 0.8, 0, 6.283); ctx.fill(); } }
        ctx.globalAlpha = 1;
        continue;
      }
      const y = baseY - h, hh = p.mirror ? h * 2 : h, r = p.round ? Math.min(w / 2, hh / 2) : 0;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(x, y, w, hh, r); else ctx.rect(x, y, w, hh);
      ctx.fill();
    }
  },
});

registerGen('wave', {
  label: '波形', cat: 'audio', audio: true,
  desc: '音の波そのものを線で表示（オシロスコープ）',
  defaults: { span: 0.045, thickness: 1, amp: 1, style: 'line', colors: ['#ffd9a8', '#ff9a3d'] },
  params: [
    { key: 'style', label: '形', type: 'select', options: [['line', '線'], ['mirror', '上下対称の面'], ['bars', '棒']] },
    { key: 'span', label: '見せる長さ（秒）', min: 0.005, max: 0.5, step: 0.005 },
    { key: 'amp', label: '振れ幅', min: 0.2, max: 4, step: 0.1 },
    { key: 'thickness', label: '線の太さ', min: 0.3, max: 4, step: 0.1 },
  ],
  draw(c) {
    const { ctx, W, H, p } = c;
    const n = 400;
    let w = tmpW.subarray(0, n);
    if (c.audio) c.audio.wave(c.T, n, p.span, w);
    else for (let i = 0; i < n; i++) w[i] = 0.25 * Math.sin(i * 0.11 + c.T * 9) * Math.sin(i * 0.013 + c.T * 2) + 0.08 * noise1(i * 0.2 + c.T * 20, 1, c.seed);
    const g = ctx.createLinearGradient(0, 0, W, 0);
    c.colors.forEach((col, i) => g.addColorStop(i / Math.max(1, c.colors.length - 1), col));
    const yv = (v) => H / 2 - Math.max(-1, Math.min(1, v * p.amp * 1.6)) * H * 0.46;
    if (p.style === 'bars') {
      const m = 96, bw = W / m; ctx.fillStyle = g;
      for (let i = 0; i < m; i++) { let pk = 0; for (let k = 0; k < n / m; k++) pk = Math.max(pk, Math.abs(w[Math.floor((i * n) / m + k)])); const h = Math.max(2, pk * p.amp * 1.6 * H * 0.92); ctx.fillRect(i * bw + bw * 0.15, H / 2 - h / 2, bw * 0.7, h); }
      return;
    }
    ctx.beginPath();
    for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * W; i ? ctx.lineTo(x, yv(w[i])) : ctx.moveTo(x, yv(w[i])); }
    if (p.style === 'mirror') { for (let i = n - 1; i >= 0; i--) ctx.lineTo((i / (n - 1)) * W, H - yv(Math.abs(w[i]))); ctx.closePath(); ctx.fillStyle = g; ctx.globalAlpha = 0.8; ctx.fill(); return; }
    ctx.strokeStyle = g; ctx.lineWidth = Math.max(1.5, H * 0.012 * p.thickness); ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.shadowColor = c.colors[c.colors.length - 1]; ctx.shadowBlur = H * 0.03;
    ctx.stroke();
  },
});

registerGen('radial', {
  label: '円形スペクトラム', cat: 'audio', audio: true,
  desc: '円のまわりに音の強さが伸びる。中心はキックで脈打つ',
  defaults: { radius: 0.22, length: 0.22, bars: 96, rotate: 0.05, colors: ['#ffd23d', '#ff7a3d', '#ff3dbb', '#b14dff', '#4c86ff'] },
  params: [
    { key: 'radius', label: '円の大きさ', min: 0.05, max: 0.45, step: 0.01 },
    { key: 'length', label: '棒の長さ', min: 0.05, max: 0.5, step: 0.01 },
    { key: 'bars', label: '本数', min: 24, max: 192, step: 4 },
    { key: 'rotate', label: '回転', min: -1, max: 1, step: 0.01 },
  ],
  draw(c) {
    const { ctx, W, H, p } = c;
    const s = spectrumOf(c, tmpS);
    const kick = c.audio ? c.audio.band('kick', c.T) : 0.3 + 0.3 * Math.sin(c.T * 4);
    const m = Math.min(W, H), R = m * p.radius * (1 + 0.12 * kick), n = Math.round(p.bars);
    ctx.translate(W / 2, H / 2);
    ctx.rotate(c.t * p.rotate);
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(1.5, ((2 * Math.PI * R) / n) * 0.55);
    for (let i = 0; i < n; i++) {
      // 左右対称に並べる（低い音が上、高い音が下）
      const u = i < n / 2 ? i / (n / 2) : (n - i) / (n / 2);
      const v = s[Math.min(NB - 1, Math.floor(u * (NB - 1)))];
      const a = (i / n) * Math.PI * 2 - Math.PI / 2, len = m * p.length * (0.04 + v);
      ctx.strokeStyle = css(mixColor(c.colors, u));
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * R, Math.sin(a) * R);
      ctx.lineTo(Math.cos(a) * (R + len), Math.sin(a) * (R + len));
      ctx.stroke();
    }
    ctx.beginPath(); ctx.arc(0, 0, R * 0.9, 0, 6.283);
    ctx.strokeStyle = css(mixColor(c.colors, 0.1), 0.5 + 0.5 * kick); ctx.lineWidth = m * 0.004; ctx.stroke();
  },
});

/** かなでるの曲（JSON）の音符を、時間に沿って流れるピアノロールとして描く */
registerGen('pianoroll', {
  label: 'ピアノロール', cat: 'audio',
  desc: 'かなでるの曲の音符が流れていく（params.song に曲の JSON、または media に生成した曲の ID）',
  defaults: { window: 8, song: null, media: null, offset: 0, playhead: 0.35, colors: ['#ff6b5c', '#4c86ff', '#2edba8', '#ffc83d', '#ba78ff', '#ff8cc8', '#64dcff', '#ffa03c'] },
  params: [
    { key: 'window', label: '見せる長さ（秒）', min: 2, max: 30, step: 0.5 },
    { key: 'playhead', label: '再生位置（左からの割合）', min: 0, max: 1, step: 0.01 },
    { key: 'offset', label: '曲の開始時刻（動画の秒）', min: 0, max: 600, step: 0.1 },
  ],
  draw(c) {
    const { ctx, W, H, p, state } = c;
    const md = c.project?.media || {};
    const song = p.song || md[p.media]?.gen?.song || Object.values(md).find((m) => m.gen?.song)?.gen.song;
    if (!song) { ctx.fillStyle = 'rgba(255,255,255,0.4)'; ctx.font = `${H * 0.06}px sans-serif`; ctx.textAlign = 'center'; ctx.fillText('かなでるの曲を指定してください', W / 2, H / 2); return; }
    if (!state.notes) {
      const spb = secPerBeat(song);
      const notes = [], drums = [];
      (song.tracks || []).forEach((tr, ti) => {
        let list = [];
        try { list = trackNotes(song, tr); } catch { /* 読めないトラックは飛ばす */ }
        const isDrum = tr.type === 'drums' || tr.kit;
        if (tr.type === 'sfx') return;
        for (const n of list) {
          if (isDrum) drums.push({ t: n.t * spb, n: String(n.n), ti, v: n.v });
          else { let ms = []; try { ms = pitchesOf(n.n); } catch { /* */ } for (const m of ms) notes.push({ t: n.t * spb, d: n.d * spb, m: m + (tr.transpose || 0) + (n.tr || 0), ti, v: n.v }); }
        }
      });
      state.notes = notes; state.drums = drums;
      state.lo = Math.min(...notes.map((n) => n.m), 48) - 1; state.hi = Math.max(...notes.map((n) => n.m), 72) + 1;
      state.dnames = [...new Set(drums.map((d) => d.n))];
      state.bar = beatsPerBar(song) * spb;
    }
    const now = c.T - (p.offset || 0), t0 = now - p.window * p.playhead, t1 = t0 + p.window;
    const xOf = (t) => ((t - t0) / p.window) * W;
    const dh = state.dnames.length ? H * 0.16 : 0, ph = H - dh, rowH = ph / (state.hi - state.lo + 1);
    // 小節線
    ctx.fillStyle = 'rgba(255,255,255,0.07)';
    for (let b = Math.ceil(t0 / state.bar); b * state.bar < t1; b++) if (b >= 0) ctx.fillRect(xOf(b * state.bar), 0, 1, H);
    for (const n of state.notes) {
      if (n.t > t1 || n.t + n.d < t0) continue;
      const col = mixColor([c.colors[n.ti % c.colors.length]], 0), on = now >= n.t && now < n.t + n.d;
      ctx.fillStyle = css(on ? [Math.min(1, col[0] + 0.35), Math.min(1, col[1] + 0.35), Math.min(1, col[2] + 0.35)] : col, on ? 1 : 0.4 + n.v * 0.4);
      const x = xOf(n.t), w = Math.max(2, (n.d / p.window) * W - 1.5), y = (state.hi - n.m) * rowH;
      if (on) { ctx.shadowColor = css(col); ctx.shadowBlur = rowH * 2.5; }
      ctx.fillRect(x, y, w, Math.max(2, rowH * 0.8));
      ctx.shadowBlur = 0;
    }
    const rh = dh / Math.max(1, state.dnames.length);
    for (const d of state.drums) {
      if (d.t > t1 || d.t < t0 - 0.2) continue;
      const k = state.dnames.indexOf(d.n), age = now - d.t;
      const col = mixColor([c.colors[d.ti % c.colors.length]], 0);
      ctx.fillStyle = css(col, age >= 0 && age < 0.12 ? 1 : 0.35 + d.v * 0.4);
      ctx.fillRect(xOf(d.t), ph + k * rh + rh * 0.15, Math.max(2, W * 0.003), rh * 0.7);
    }
    // 再生位置
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(W * p.playhead, 0, Math.max(1.5, W * 0.0015), H);
  },
});
