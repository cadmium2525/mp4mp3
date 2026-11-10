/*
 * つなぐ：効果音の自動付け。
 * 映像の動き（切り替え・文字や図形の出現・エフェクト・ジェネレーター）を見て、合う効果音を提案する。
 * 効果音は「かなでる」のエンジンで作るので、素材ファイルはいらない。
 * 戻り値：[{ start, sfx: {...}, volume, why }]（audios にそのまま足せる形。auto: true の印つき）
 */
import { layoutClips, overlayEnd } from './project.js';

const TRANSITION_SFX = {
  fade: { preset: 'whoosh', length: 0.8, tone: -0.3, punch: 0.05, space: 0.3 },
  slide: { preset: 'swipe', length: 1.4 },
  wipe: { preset: 'swipe', length: 1.2, tone: 0.2 },
  zoom: { preset: 'whoosh', length: 0.9, punch: 0.5 },
  flip: { preset: 'swipe', length: 1.6, pitch: -3 },
  cube: { preset: 'whoosh', length: 1.0, pitch: -2 },
  black: { preset: 'downer', length: 0.45, space: 0.3 },
  white: { preset: 'riser', length: 0.3, space: 0.3 },
};
const EFFECT_SFX = {
  flash: { preset: 'shutter' }, glitch: { preset: 'glitch' }, shake: { preset: 'boom', length: 0.5 }, zoompulse: { preset: 'heartbeat' },
  confetti: { preset: 'success' }, sparkle: { preset: 'sparkle' }, hearts: { preset: 'bubble' }, shockwave: { preset: 'impact', length: 0.6 },
  zoomblur: { preset: 'whoosh', length: 0.7, punch: 0.6 }, rgbsplit: { preset: 'glitch', length: 0.6 },
};
const GEN_SFX = {
  particletext: [{ preset: 'riser', length: 0.6, space: 0.5 }, 0], text3d: [{ preset: 'braam', length: 0.7 }, 0], fluid: [{ preset: 'whoosh', length: 1.8, tone: -0.4, punch: 0.4 }, 0],
  galaxy: [{ preset: 'boom', length: 1.2, space: 0.6 }, 0], fractal: [{ preset: 'downer', length: 0.8, space: 0.5 }, 0], attractor: [{ preset: 'magic', length: 0.9 }, 0],
};
// 連続する「ポン」を、心地よい音階（ペンタトニック）で上がっていくようにする
const PENTA = [0, 2, 4, 7, 9, 12, 14, 16];

export function autoSfx(project, { volume = 0.5, density = 1 } = {}) {
  const out = [];
  const add = (start, sfx, vol, why) => { if (start >= 0) out.push({ start: Math.round(start * 1000) / 1000, sfx, volume: Math.round(volume * vol * 100) / 100, auto: true, why }); };
  // 切り替え
  for (const L of layoutClips(project)) {
    const s = TRANSITION_SFX[L.tIn.type];
    if (s && L.tIn.d > 0) add(Math.max(0, L.start - 0.05), s, 0.9, `切り替え（${L.tIn.type}）`);
  }
  // 文字
  let pop = 0, lastPop = -9;
  const texts = [...(project.texts || [])].sort((a, b) => a.start - b.start);
  for (const t of texts) {
    if (!String(t.text || '').trim()) continue;
    const big = (t.size || 0.07) >= 0.085;
    if (t.count) { add(t.start, { preset: 'type', length: 0.6, pitch: 7, seed: 3 }, 0.5, '数字のカウント'); add(t.start + (t.count.dur ?? 1.2), { preset: 'pon', pitch: 5 }, 0.7, 'カウント完了'); continue; }
    if (t.anim === 'typewriter') {
      const n = Math.min(40, [...String(t.text)].length), cps = t.typeSpeed || 14;
      for (let i = 0; i < n; i += 2) add(t.start + i / cps, { preset: 'type', seed: 1 + (i % 7), tone: -0.1 }, 0.45, 'タイプ音');
      continue;
    }
    if (t.anim === 'pop' || t.anim === 'slide') {
      if (t.start - lastPop > 2.5) pop = 0;
      lastPop = t.start;
      if (big && t.anim === 'pop') add(t.start, { preset: 'pon', pitch: PENTA[pop % PENTA.length] - 5 }, 0.8, '見出しの出現');
      else add(t.start, t.anim === 'slide' ? { preset: 'swipe', length: 0.8, tone: -0.2 } : { preset: 'pop', pitch: PENTA[pop % PENTA.length], seed: 1 + pop }, 0.6, '文字の出現');
      pop++;
    }
  }
  // 図形・ワイプ
  let sp = 0, lastS = -9;
  const pops = [...(project.shapes || []).map((s) => ({ ...s, _k: 'shape' })), ...(project.overlays || []).map((o) => ({ ...o, _k: 'overlay' }))].sort((a, b) => a.start - b.start);
  for (const s of pops) {
    if (s.anim === 'pop' || s.anim === 'spin') {
      if (s.start - lastS > 2) sp = 0;
      if (s.start - lastS < 0.06) continue; // 同時に出るものは 1 つにまとめる
      lastS = s.start;
      add(s.start, { preset: s._k === 'overlay' ? 'pop' : 'tap', pitch: PENTA[sp % PENTA.length], seed: 1 + sp }, s._k === 'overlay' ? 0.6 : 0.4 * density, `${s._k === 'overlay' ? 'ワイプ' : '図形'}の出現`);
      sp++;
    } else if (s.anim === 'wipe' || s.anim === 'slide') add(s.start, { preset: 'swipe', length: 0.7, tone: -0.2 }, 0.4 * density, '図形の出現');
    // 画面を横切る大きな動き（キーフレームで大きく移動するもの）
    const ks = s.keys || (s.to ? [{ t: 0 }, { t: (s.end ?? overlayEnd(s)) - s.start, ...s.to }] : null);
    if (ks && ks.length >= 2) {
      const xs = ks.map((k) => k.x).filter((v) => typeof v === 'number');
      if (xs.length >= 2 && Math.abs(xs[xs.length - 1] - xs[0]) > 0.8) add(s.start, { preset: 'whoosh', length: Math.min(1.6, Math.max(0.6, (ks[ks.length - 1].t - ks[0].t) / 0.65)) }, 0.7, '横切る動き');
    }
  }
  // エフェクト・ジェネレーター
  for (const e of project.effects || []) { const s = EFFECT_SFX[e.type]; if (s) add(e.start, s, 0.7, `エフェクト（${e.type}）`); }
  for (const g of project.gens || []) { const s = GEN_SFX[g.type]; if (s) add(g.start + s[1], s[0], 0.6, `ジェネレーター（${g.type}）`); }
  // 近すぎるもの（0.07 秒以内）は、先に決まった方だけ残す
  out.sort((a, b) => a.start - b.start);
  const res = [];
  for (const o of out) { const p = res[res.length - 1]; if (p && o.start - p.start < 0.07 && o.sfx.preset === p.sfx.preset) continue; res.push(o); }
  return res;
}
