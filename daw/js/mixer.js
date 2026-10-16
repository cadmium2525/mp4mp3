/*
 * かなでる：ミキサー（音量・パン・センド）と自動ミックス。
 */
import { $, el, slider, fmtDb, fmtPan, fmtPct, toast, TRACK_COLORS } from './ui.js';
import { S, commit } from './app.js';
import { call, analysers } from './player.js';
import { instLabel } from './arrange.js';

export function renderMixer() {
  const v = $('#mixerView');
  const rows = S.song.tracks.map((tr, ti) => {
    const up = (fn) => commit((s) => fn(s.tracks[ti]));
    const val = el('div', { class: 'mv' }, fmtDb(tr.volume ?? 0));
    const vol = el('input', { type: 'range', min: -40, max: 12, step: 0.5, value: tr.volume ?? 0 });
    vol.oninput = () => (val.textContent = fmtDb(Number(vol.value)));
    vol.onchange = () => up((t) => { t.volume = Number(vol.value); });
    const pan = el('input', { type: 'range', min: -1, max: 1, step: 0.05, value: tr.pan ?? 0 });
    const panL = el('span', {}, fmtPan(tr.pan ?? 0));
    pan.oninput = () => (panL.textContent = fmtPan(Number(pan.value)));
    pan.onchange = () => up((t) => { t.pan = Number(pan.value); });
    const rev = el('input', { type: 'range', min: 0, max: 1, step: 0.01, value: tr.sends?.reverb ?? 0 });
    rev.onchange = () => up((t) => { t.sends = { ...(t.sends || {}), reverb: Number(rev.value) }; });
    return el('div', { class: 'mix-row', style: { '--tc': TRACK_COLORS[ti % TRACK_COLORS.length] } }, [
      el('div', {}, [el('div', { class: 'mn' }, tr.name || tr.id), el('div', { class: 'mv', style: { textAlign: 'left' } }, instLabel(tr))]),
      vol, val,
      el('div', { class: 'sub' }, [panL, pan]),
      el('div', { class: 'sub' }, ['響き', rev]),
    ]);
  });
  const master = S.song.master || {};
  v.replaceChildren(
    el('div', { class: 'mix-head' }, [el('h3', {}, 'トラック'), el('span', { class: 'spacer' }), el('button', { class: 'btn sm primary', type: 'button', onclick: autoMixClick }, '自動ミックス')]),
    el('p', { class: 'note' }, '自動ミックスは、各トラックの音の大きさを測って、ドラム・ベース・メロディ・伴奏などの役割に合った音量に整えます。'),
    ...rows,
    el('div', { class: 'mix-head', style: { marginTop: '16px' } }, [el('h3', {}, 'マスター')]),
    el('div', { class: 'viz-card' }, [
      slider({ label: '仕上がりの音量（ラウドネス）', min: -24, max: -8, step: 0.5, value: master.loudness ?? -14, fmt: (x) => `${x} LUFS`, onChange: (x) => commit((s) => { s.master = { ...(s.master || {}), loudness: x }; }) }),
      slider({ label: 'ピークの上限', min: -3, max: -0.1, step: 0.1, value: master.ceiling ?? -1, fmt: (x) => `${x} dBTP`, onChange: (x) => commit((s) => { s.master = { ...(s.master || {}), ceiling: x }; }) }),
      slider({ label: '共有リバーブの音量', min: -24, max: 6, step: 0.5, value: S.song.sends?.reverb?.volume ?? 0, fmt: fmtDb, onChange: (x) => commit((s) => { s.sends = { ...(s.sends || {}), reverb: { ...(s.sends?.reverb || {}), volume: x } }; }) }),
      el('div', { class: 'meter', style: { marginTop: '8px' } }, el('i', { id: 'masterMeter' })),
    ]),
  );
}

async function autoMixClick(e) {
  const b = e.currentTarget;
  b.disabled = true;
  try {
    const m = await call('automix', { song: S.song }, (p) => (b.textContent = `測定中 ${Math.round(p * 100)}%`));
    commit((s) => { for (const t of s.tracks) if (m.vols[t.id || t.name] != null) t.volume = m.vols[t.id || t.name]; });
    toast('トラックの音量を整えました');
  } catch (err) { toast(err.message, 4000); } finally { b.disabled = false; b.textContent = '自動ミックス'; }
}

const buf = new Float32Array(2048);
export function updateMeters() {
  const { anL } = analysers();
  const m = document.getElementById('masterMeter');
  if (!anL || !m) return;
  anL.getFloatTimeDomainData(buf);
  let pk = 0;
  for (const x of buf) pk = Math.max(pk, Math.abs(x));
  const dbv = 20 * Math.log10(pk + 1e-9);
  m.style.width = `${Math.max(0, Math.min(100, ((dbv + 48) / 48) * 100))}%`;
}

export { fmtPct };
