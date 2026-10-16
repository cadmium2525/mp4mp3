/*
 * かなでる：トラックの設定（楽器・音量・エフェクト）と、楽器・効果音の選択。
 */
import { el, openSheet, closeSheet, slider, seg, fmtDb, fmtPct, fmtPan, toast } from './ui.js';
import { S, commit } from './app.js';
import { call, playBuffer, audio } from './player.js';
import { INST_PRESETS, INST_CATEGORIES, KITS } from './engine/presets.js';
import { SFX_PRESETS, SFX_CATEGORIES } from './engine/sfx.js';
import { FX_TYPES } from './engine/fx.js';
import { trackType, instLabel } from './arrange.js';

/* エフェクトのつまみ：[キー, ラベル, 最小, 最大, 刻み, 既定, 表示] */
const pct = fmtPct, db = fmtDb, hz = (v) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : Math.round(v)) + 'Hz', sec = (v) => `${v.toFixed(2)}s`, num = (v) => String(Math.round(v * 100) / 100);
export const FX_PARAMS = {
  reverb: [['mix', '量', 0, 1, 0.01, 0.25, pct], ['decay', '長さ', 0.2, 8, 0.1, 2, sec], ['size', '広さ', 0.3, 2, 0.05, 1, num], ['damp', '響きの明るさ', 1500, 14000, 100, 6000, hz], ['predelay', 'プリディレイ', 0, 0.15, 0.005, 0.02, sec]],
  delay: [['mix', '量', 0, 1, 0.01, 0.25, pct], ['feedback', 'くり返し', 0, 0.9, 0.01, 0.35, pct], ['tone', '明るさ', 800, 12000, 100, 5000, hz]],
  eq: [],
  comp: [['threshold', 'しきい値', -40, 0, 0.5, -18, db], ['ratio', '比率', 1, 20, 0.5, 4, (v) => `${v}:1`], ['attack', 'アタック', 0.0005, 0.1, 0.0005, 0.01, sec], ['release', 'リリース', 0.02, 1, 0.01, 0.15, sec], ['makeup', '持ち上げ', 0, 18, 0.5, 0, db]],
  chorus: [['mix', '量', 0, 1, 0.01, 0.5, pct], ['rate', '速さ', 0.05, 6, 0.05, 0.6, (v) => `${v.toFixed(2)}Hz`]],
  dist: [['drive', '歪み', 0, 36, 0.5, 12, db], ['mix', '量', 0, 1, 0.01, 1, pct], ['tone', '明るさ', 800, 16000, 100, 12000, hz]],
  filter: [['freq', '周波数', 40, 18000, 10, 1000, hz], ['q', 'クセ（Q）', 0.3, 12, 0.1, 0.9, num], ['mix', '量', 0, 1, 0.01, 1, pct]],
  widen: [['amount', '広さ', 0, 2.5, 0.05, 1.4, num], ['lowmono', '低音をモノラルに', 0, 300, 10, 120, hz]],
  tremolo: [['rate', '速さ', 0.5, 16, 0.1, 5, (v) => `${v.toFixed(1)}Hz`], ['depth', '深さ', 0, 1, 0.01, 0.5, pct]],
  pump: [['amount', '深さ', 0, 1, 0.01, 0.6, pct], ['release', '戻り', 0.1, 1, 0.01, 0.6, pct]],
  transient: [['attack', '立ち上がり', -12, 12, 0.5, 4, db], ['sustain', '余韻', -12, 12, 0.5, 0, db]],
  lofi: [['mix', '量', 0, 1, 0.01, 1, pct], ['wow', '揺れ', 0, 1.5, 0.05, 0.4, num], ['noise', 'ヒスノイズ', 0, 1.5, 0.05, 0.3, num], ['crackle', 'レコードのプチ', 0, 2, 0.05, 0.3, num], ['tone', 'こもり', 1500, 12000, 100, 5500, hz]],
  crush: [['bits', 'ビット', 2, 16, 1, 8, num], ['rate', '間引き', 1, 32, 1, 4, num], ['mix', '量', 0, 1, 0.01, 1, pct]],
  gain: [['db', '音量', -24, 24, 0.5, 0, db]],
  limiter: [['ceiling', '上限', -12, 0, 0.1, -1, db]],
};
const FX_DEFAULT_EXTRA = {
  eq: { bands: [{ type: 'hp', freq: 80 }, { type: 'peak', freq: 400, gain: -2, q: 1 }, { type: 'highshelf', freq: 8000, gain: 2 }] },
  delay: { time: '1/8d' },
  filter: { kind: 'lp' },
  pump: { rate: '1/4' },
};

/* ---------------- トラックの設定 ---------------- */

export function openTrackSettings(ti) {
  const tr = S.song.tracks[ti];
  const type = trackType(tr);
  const up = (fn, quiet) => commit((s) => fn(s.tracks[ti]), { quiet });
  const name = el('input', { type: 'text', value: tr.name || '' });
  name.addEventListener('change', () => up((t) => { t.name = name.value.trim() || t.id; }, true));
  const body = [el('div', { class: 'field' }, [el('label', {}, 'トラック名'), name])];
  if (type === 'inst') {
    body.push(el('div', { class: 'field' }, [el('div', { class: 'lbl' }, '楽器'),
      el('button', { class: 'btn wide', type: 'button', onclick: () => pickInstrument(typeof tr.inst === 'string' ? tr.inst : tr.inst?.preset, (n) => { up((t) => { t.inst = typeof t.inst === 'object' && t.inst ? { ...t.inst, preset: n } : n; }); openTrackSettings(ti); }) }, `${instLabel(tr)}　›`)]));
  }
  if (type === 'drums') {
    body.push(el('div', { class: 'field' }, [el('div', { class: 'lbl' }, 'ドラムキット'), seg(Object.entries(KITS).map(([k, v]) => [k, v.label]), tr.kit || 'acoustic', (v) => up((t) => { t.kit = v; }))]));
    body.push(slider({ label: 'スウィング（はね具合）', min: 0, max: 0.5, step: 0.01, value: tr.swing ?? 0, fmt: pct, onChange: (v) => up((t) => { t.swing = v; }) }));
  }
  body.push(
    slider({ label: '音量', min: -40, max: 12, step: 0.5, value: tr.volume ?? 0, fmt: db, onChange: (v) => up((t) => { t.volume = v; }) }),
    slider({ label: 'パン（左右）', min: -1, max: 1, step: 0.05, value: tr.pan ?? 0, fmt: fmtPan, onChange: (v) => up((t) => { t.pan = v; }) }),
    slider({ label: 'リバーブに送る量', min: 0, max: 1, step: 0.01, value: tr.sends?.reverb ?? 0, fmt: pct, onChange: (v) => up((t) => { t.sends = { ...(t.sends || {}), reverb: v }; }) }),
    slider({ label: 'ディレイに送る量', min: 0, max: 1, step: 0.01, value: tr.sends?.delay ?? 0, fmt: pct, onChange: (v) => up((t) => { t.sends = { ...(t.sends || {}), delay: v }; }) }),
  );
  if (type !== 'sfx') {
    body.push(slider({ label: '人間らしいずれ（タイミング）', min: 0, max: 0.03, step: 0.001, value: tr.humanize?.time ?? 0, fmt: (v) => `${Math.round(v * 1000)} ms`, onChange: (v) => up((t) => { t.humanize = { ...(t.humanize || {}), time: v }; }) }));
    body.push(slider({ label: '人間らしいずれ（強さ）', min: 0, max: 0.3, step: 0.01, value: tr.humanize?.vel ?? 0, fmt: pct, onChange: (v) => up((t) => { t.humanize = { ...(t.humanize || {}), vel: v }; }) }));
  }
  if (type === 'inst') body.push(slider({ label: '移調', min: -24, max: 24, step: 1, value: tr.transpose ?? 0, fmt: (v) => `${v > 0 ? '+' : ''}${v} 半音`, onChange: (v) => up((t) => { t.transpose = v; }) }));
  body.push(el('h3', { class: 'cat-h' }, 'エフェクト'), fxList(tr.fx || [], (fn) => up((t) => { t.fx = t.fx || []; fn(t.fx); }), () => openTrackSettings(ti)));
  body.push(el('div', { class: 'row', style: { marginTop: '14px' } }, [
    el('button', { class: 'btn', type: 'button', onclick: () => { commit((s) => { const c = structuredClone(s.tracks[ti]); c.id = 't' + Math.random().toString(36).slice(2, 7); c.name = (c.name || '') + ' 2'; s.tracks.splice(ti + 1, 0, c); }); closeSheet(); } }, '複製'),
    el('button', { class: 'btn', type: 'button', disabled: ti === 0, onclick: () => { commit((s) => { const [t] = s.tracks.splice(ti, 1); s.tracks.splice(ti - 1, 0, t); }); closeSheet(); } }, '上へ'),
    el('span', { class: 'spacer' }),
    el('button', { class: 'btn danger', type: 'button', onclick: () => { if (!confirm(`「${tr.name}」を削除しますか？`)) return; commit((s) => { s.tracks.splice(ti, 1); }); S.sel = null; closeSheet(); } }, '削除'),
  ]));
  openSheet(tr.name || tr.id, body, { tall: true });
}

/** エフェクトの一覧と編集 */
export function fxList(list, mutate, reopen) {
  const wrap = el('div');
  list.forEach((f, k) => {
    const params = FX_PARAMS[f.type] || [];
    const card = el('div', { class: 'fx-card' }, [
      el('div', { class: 'fx-h' }, [
        el('b', {}, FX_TYPES[f.type]?.label || f.type),
        el('button', { class: 'chip', type: 'button', 'aria-pressed': String(!f.off), onclick: () => { mutate((fx) => { fx[k].off = !fx[k].off; }); reopen(); } }, f.off ? 'オフ' : 'オン'),
        el('button', { class: 'chip', type: 'button', onclick: () => { mutate((fx) => { fx.splice(k, 1); }); reopen(); } }, '外す'),
      ]),
    ]);
    for (const [key, label, min, max, step, def, fmt] of params) {
      const v = f[key];
      if (Array.isArray(v)) { card.append(el('p', { class: 'note' }, `${label}：時間で変化（JSON で編集）`)); continue; }
      card.append(slider({ label, min, max, step, value: v ?? def, fmt, onChange: (x) => mutate((fx) => { fx[k][key] = x; }) }));
    }
    if (f.type === 'eq') card.append(el('p', { class: 'note' }, (f.bands || []).map((b) => `${b.type} ${hz(b.freq)}${b.gain ? ` ${db(b.gain)}` : ''}`).join(' / ') + '（細かい設定は JSON で）'));
    if (f.type === 'filter') card.append(seg([['lp', 'ローパス'], ['hp', 'ハイパス'], ['bp', 'バンドパス']], f.kind || 'lp', (v) => mutate((fx) => { fx[k].kind = v; })));
    if (f.type === 'delay' || f.type === 'pump') card.append(seg([['1/16', '16分'], ['1/8', '8分'], ['1/8d', '付点8分'], ['1/4', '4分'], ['1/2', '2分']], f.time ?? f.rate ?? (f.type === 'pump' ? '1/4' : '1/8d'), (v) => mutate((fx) => { fx[k][f.type === 'pump' ? 'rate' : 'time'] = v; })));
    wrap.append(card);
  });
  const add = el('select', { onchange: (e) => {
    const t = e.target.value;
    if (!t) return;
    const spec = { type: t, ...(FX_DEFAULT_EXTRA[t] || {}) };
    for (const [key, , , , , def] of FX_PARAMS[t] || []) spec[key] = def;
    mutate((fx) => { fx.push(spec); });
    reopen();
  } }, [el('option', { value: '' }, '＋ エフェクトを追加')].concat(Object.entries(FX_TYPES).map(([k, v]) => el('option', { value: k }, v.label))));
  wrap.append(add);
  return wrap;
}

/* ---------------- 楽器を選ぶ ---------------- */

export function pickInstrument(current, onPick) {
  const body = [];
  for (const cat of INST_CATEGORIES) {
    body.push(el('h3', { class: 'cat-h' }, cat.label));
    const list = el('div', { class: 'list' });
    for (const [k, p] of Object.entries(INST_PRESETS)) {
      if (p.cat !== cat.id) continue;
      list.append(el('div', { class: `item${k === current ? ' on' : ''}`, onclick: () => { closeSheet(); onPick(k); } }, [
        el('div', { class: 'grow' }, p.label),
        el('button', { class: 'chip', type: 'button', onclick: (e) => { e.stopPropagation(); previewInst(k); } }, '▶'),
      ]));
    }
    body.push(list);
  }
  openSheet('楽器を選ぶ', body, { tall: true });
}

function previewInst(name) {
  audio();
  const cat = INST_PRESETS[name].cat;
  const base = cat === 'bass' ? 36 : cat === 'lead' ? 67 : 60;
  const midis = cat === 'bass' || cat === 'lead' ? [base] : [base, base + 4, base + 7, base + 11];
  call('note', { inst: name, midis, dur: cat === 'pad' ? 1.6 : 0.9, vel: 0.8 }).then((m) => playBuffer(m.L, m.R, m.sr)).catch((e) => toast(e.message));
}

/* ---------------- 効果音のクリップ ---------------- */

export function openSfxClip(ti, ci) {
  const clip = S.song.tracks[ti].clips[ci];
  const spec = { preset: 'whoosh', ...(clip.sfx || {}) };
  const up = (fn) => commit((s) => fn(s.tracks[ti].clips[ci]));
  const play = () => { audio(); call('sfx', { spec: S.song.tracks[ti].clips[ci].sfx }).then((m) => playBuffer(m.L, m.R, m.sr)).catch((e) => toast(e.message)); };
  const body = [];
  for (const cat of SFX_CATEGORIES) {
    body.push(el('h3', { class: 'cat-h' }, cat.label));
    body.push(seg(Object.entries(SFX_PRESETS).filter(([, p]) => p.cat === cat.id).map(([k, p]) => [k, p.label]), spec.preset, (v) => { up((c) => { c.sfx = { ...c.sfx, preset: v }; }); play(); }));
  }
  body.push(el('h3', { class: 'cat-h' }, '調整'));
  const knob = (key, label, min, max, step, def, fmt) => slider({ label, min, max, step, value: spec[key] ?? def, fmt, onChange: (v) => { up((c) => { c.sfx = { ...c.sfx, [key]: v }; }); play(); } });
  body.push(
    knob('pitch', '高さ', -12, 12, 1, 0, (v) => `${v > 0 ? '+' : ''}${v} 半音`),
    knob('length', '長さ', 0.3, 3, 0.05, 1, (v) => `×${v.toFixed(2)}`),
    knob('tone', '明るさ', -1, 1, 0.05, 0, (v) => v.toFixed(2)),
    knob('space', '響き', 0, 1, 0.01, 0.3, pct),
    knob('punch', '迫力', 0, 1, 0.01, 0.5, pct),
    slider({ label: 'クリップの音量', min: -24, max: 12, step: 0.5, value: clip.gain ?? 0, fmt: db, onChange: (v) => up((c) => { c.gain = v; }) }),
    el('div', { class: 'row', style: { marginTop: '10px' } }, [
      el('button', { class: 'btn', type: 'button', onclick: play }, '▶ 試聴'),
      el('button', { class: 'btn', type: 'button', onclick: () => { up((c) => { c.sfx = { ...c.sfx, seed: Math.floor(Math.random() * 9999) }; }); play(); } }, '🎲 ばらつき'),
    ]),
  );
  openSheet('効果音', body, { tall: true });
}
