/*
 * かなでる：クリップの中身の編集（ピアノロール / ドラムのマス目）。
 */
import { $, el, toast, seg } from './ui.js';
import { S, commit } from './app.js';
import { call, playBuffer, audio } from './player.js';
import { beatsPerBar } from './engine/song.js';
import { pitchesOf, midiToName, chordToMidi } from './engine/dsp.js';
import { DRUM_NAMES } from './engine/sfx.js';
import { trackType, clipLen } from './arrange.js';

const KEYW = 46, RULER = 22, ROWH = 18;
const LOW = 24, HIGH = 96; // C1〜C7
const BLACK = new Set([1, 3, 6, 8, 10]);
const DRUM_LABEL = { kick: 'キック', kick808: '808キック', sub: 'サブ', snare: 'スネア', clap: 'クラップ', rim: 'リム', snap: 'スナップ', hat: 'ハイハット', ohat: 'オープンHH', ride: 'ライド', crash: 'クラッシュ', tom1: 'タム高', tom2: 'タム中', tom3: 'タム低', shaker: 'シェイカー', tamb: 'タンバリン', cowbell: 'カウベル', perc: 'パーカッション' };
const CORE_DRUMS = ['kick', 'snare', 'clap', 'hat', 'ohat', 'crash'];

/** 編集対象（パターンを使っていればパターン） */
function target(ti, ci) {
  const clip = S.song.tracks[ti].clips[ci];
  if (clip.pattern) return { kind: 'pattern', obj: S.song.patterns[clip.pattern], clip };
  return { kind: 'clip', obj: clip, clip };
}

export function openClipEditor(ti, ci) {
  const tr = S.song.tracks[ti];
  if (trackType(tr) === 'drums') return drumEditor(ti, ci);
  return pianoRoll(ti, ci);
}

/* ---------------- ピアノロール ---------------- */

function pianoRoll(ti, ci) {
  const tr = S.song.tracks[ti];
  const tg = target(ti, ci);
  const bpb = beatsPerBar(S.song);
  let len = tg.obj.len ?? clipLen(S.song, { ...tg.clip, repeat: 1 });
  // 音符を 1 音ずつに展開
  let notes = [];
  for (const x of tg.obj.notes || []) {
    const n = Array.isArray(x) ? { t: x[0], n: x[1], d: x[2] ?? 1, v: x[3] ?? 0.8 } : { t: x.t, n: x.n, d: x.d ?? 1, v: x.v ?? 0.8 };
    for (const m of pitchesOf(n.n)) notes.push({ t: n.t, m, d: n.d, v: n.v });
  }
  let sel = new Set();
  let snap = 0.5, dur = 1, vel = 0.8, chordType = '', ppb = 56;
  const allMidi = notes.map((n) => n.m);
  const center = allMidi.length ? Math.round((Math.min(...allMidi) + Math.max(...allMidi)) / 2) : 60;

  const full = $('#full');
  const wrap = el('div', { class: 'roll-wrap' });
  const space = el('div', { class: 'roll-space' });
  const cv = el('canvas');
  wrap.append(cv, space);

  const save = () => {
    const out = notes.slice().sort((a, b) => a.t - b.t || a.m - b.m).map((n) => [round(n.t), midiToName(n.m), round(n.d), round(n.v)]);
    commit((s) => {
      const o = tg.kind === 'pattern' ? s.patterns[tg.clip.pattern] : s.tracks[ti].clips[ci];
      o.notes = out;
      o.len = len;
    });
  };
  const close = () => { full.hidden = true; full.replaceChildren(); window.removeEventListener('resize', draw); };

  const top = el('div', { class: 'full-top' }, [
    el('button', { class: 'icon-btn', type: 'button', 'aria-label': '閉じる', onclick: close, html: '<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>' }),
    el('h2', {}, `${tr.name || tr.id}${tg.kind === 'pattern' ? `（パターン ${tg.clip.pattern}）` : ''}`),
    el('button', { class: 'btn sm', type: 'button', onclick: () => previewClip(ti, ci) }, '▶ 試聴'),
  ]);
  const selSnap = el('select', { onchange: (e) => (snap = Number(e.target.value), draw()) }, [['0.25', '1/16'], ['0.5', '1/8'], ['1', '1/4'], ['2', '1/2'], [String(bpb), '1小節']].map(([v, l]) => el('option', { value: v, selected: Number(v) === snap }, l)));
  const selDur = el('select', { onchange: (e) => (dur = Number(e.target.value)) }, [['0.25', '16分'], ['0.5', '8分'], ['1', '4分'], ['1.5', '付点4分'], ['2', '2分'], ['4', '全音']].map(([v, l]) => el('option', { value: v, selected: Number(v) === dur }, l)));
  const selVel = el('select', { onchange: (e) => (vel = Number(e.target.value)) }, [['0.45', '弱'], ['0.65', 'やや弱'], ['0.8', '中'], ['1', '強']].map(([v, l]) => el('option', { value: v, selected: Number(v) === vel }, l)));
  const selChord = el('select', { onchange: (e) => (chordType = e.target.value) }, [['', '単音'], ['maj', 'メジャー'], ['m', 'マイナー'], ['7', '7th'], ['M7', 'M7'], ['m7', 'm7'], ['sus4', 'sus4'], ['add9', 'add9'], ['5', 'パワー']].map(([v, l]) => el('option', { value: v }, l)));
  const tools = el('div', { class: 'roll-tools' }, [el('span', { class: 'lbl' }, 'グリッド'), selSnap, el('span', { class: 'lbl' }, '長さ'), selDur, el('span', { class: 'lbl' }, '強さ'), selVel, el('span', { class: 'lbl' }, '和音'), selChord,
    el('button', { class: 'icon-btn sm', type: 'button', onclick: () => { ppb = Math.max(20, ppb / 1.3); draw(); }, html: '<svg viewBox="0 0 24 24"><path d="M5 12h14"/></svg>' }),
    el('button', { class: 'icon-btn sm', type: 'button', onclick: () => { ppb = Math.min(160, ppb * 1.3); draw(); }, html: '<svg viewBox="0 0 24 24"><path d="M5 12h14M12 5v14"/></svg>' })]);
  const bottom = el('div', { class: 'roll-bottom' }, [
    el('button', { class: 'btn sm', type: 'button', onclick: () => transpose(1) }, '↑ 半音'),
    el('button', { class: 'btn sm', type: 'button', onclick: () => transpose(-1) }, '↓ 半音'),
    el('button', { class: 'btn sm', type: 'button', onclick: () => transpose(12) }, '↑ 1oct'),
    el('button', { class: 'btn sm', type: 'button', onclick: () => transpose(-12) }, '↓ 1oct'),
    el('button', { class: 'btn sm', type: 'button', onclick: () => { sel = sel.size === notes.length ? new Set() : new Set(notes); draw(); } }, '全選択'),
    el('button', { class: 'btn sm danger', type: 'button', onclick: () => { if (!sel.size) return toast('音をタップして選んでください'); notes = notes.filter((n) => !sel.has(n)); sel.clear(); save(); draw(); } }, '削除'),
    el('button', { class: 'btn sm', type: 'button', onclick: () => { len += bpb; save(); draw(); } }, '＋1小節'),
    el('button', { class: 'btn sm', type: 'button', onclick: () => { if (len > bpb) { len -= bpb; notes = notes.filter((n) => n.t < len); save(); draw(); } } }, '−1小節'),
  ]);
  full.replaceChildren(top, tools, wrap, bottom);
  full.hidden = false;
  if (tg.kind === 'pattern') toast(`パターン「${tg.clip.pattern}」を使うすべてのクリップが変わります`, 3000);

  function transpose(k) {
    const list = sel.size ? [...sel] : notes;
    for (const n of list) n.m = Math.max(LOW, Math.min(HIGH, n.m + k));
    save(); draw();
    if (list.length) preview(list.slice(0, 6).map((n) => n.m), 0.4);
  }

  const yOf = (m) => RULER + (HIGH - m) * ROWH;
  const xOf = (t) => KEYW + t * ppb;

  function draw() {
    const W = wrap.clientWidth, H = wrap.clientHeight;
    const totalW = KEYW + (len + bpb) * ppb, totalH = RULER + (HIGH - LOW + 1) * ROWH;
    space.style.width = `${totalW}px`; space.style.height = `${totalH}px`;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = W * dpr; cv.height = H * dpr; cv.style.width = `${W}px`; cv.style.height = `${H}px`;
    cv.style.marginBottom = `${-H}px`;
    const g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const sx = wrap.scrollLeft, sy = wrap.scrollTop;
    g.fillStyle = '#0f1115'; g.fillRect(0, 0, W, H);
    g.save(); g.translate(-sx, -sy);
    // 鍵盤の段
    for (let m = LOW; m <= HIGH; m++) {
      const y = yOf(m);
      if (y + ROWH < sy || y > sy + H) continue;
      g.fillStyle = BLACK.has(m % 12) ? '#13161c' : '#191c23';
      g.fillRect(KEYW, y, (len + bpb) * ppb, ROWH);
      g.fillStyle = '#232731'; g.fillRect(KEYW, y + ROWH - 1, (len + bpb) * ppb, 1);
      if (m % 12 === 0) { g.fillStyle = '#2f3442'; g.fillRect(KEYW, y + ROWH - 1, (len + bpb) * ppb, 1); }
    }
    // 拍・小節の線
    for (let t = 0; t <= len + bpb; t += snap) {
      const x = xOf(t);
      g.fillStyle = t % bpb === 0 ? '#3d4456' : t % 1 === 0 ? '#2a2f3c' : '#1f232c';
      g.fillRect(x, RULER, 1, (HIGH - LOW + 1) * ROWH);
    }
    // クリップの終わり
    g.fillStyle = 'rgba(0,0,0,0.45)'; g.fillRect(xOf(len), RULER, bpb * ppb, (HIGH - LOW + 1) * ROWH);
    // 音符
    for (const n of notes) {
      const x = xOf(n.t), y = yOf(n.m), w = Math.max(4, n.d * ppb - 1);
      g.fillStyle = sel.has(n) ? '#ffcc33' : `rgba(61,220,151,${0.45 + n.v * 0.55})`;
      roundRect(g, x + 0.5, y + 1, w, ROWH - 2, 4); g.fill();
      g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(x + w - 5, y + 4, 2, ROWH - 8);
    }
    g.restore();
    // 上の目盛り（縦スクロールしても見える）
    g.fillStyle = '#0f1115'; g.fillRect(0, 0, W, RULER);
    g.font = '11px -apple-system, sans-serif'; g.textBaseline = 'middle';
    for (let b = 0; b * bpb <= len; b++) {
      const x = xOf(b * bpb) - sx;
      if (x < KEYW - 2 || x > W) continue;
      g.fillStyle = '#959cb0'; g.fillText(String(b + 1), x + 3, RULER / 2);
      g.fillStyle = '#3d4456'; g.fillRect(x, 0, 1, RULER);
    }
    // 左の鍵盤（横スクロールしても見える）
    for (let m = LOW; m <= HIGH; m++) {
      const y = yOf(m) - sy;
      if (y + ROWH < RULER || y > H) continue;
      const black = BLACK.has(m % 12);
      g.fillStyle = black ? '#2a2e38' : '#d9dce4';
      g.fillRect(0, y, KEYW - 2, ROWH - 1);
      if (m % 12 === 0 || !black) { g.fillStyle = black ? '#ccc' : '#222'; g.font = m % 12 === 0 ? 'bold 10px sans-serif' : '9px sans-serif'; g.fillText(m % 12 === 0 ? midiToName(m) : '', 4, y + ROWH / 2); }
    }
    g.fillStyle = '#0f1115'; g.fillRect(0, 0, KEYW, RULER);
  }

  // 操作
  let drag = null;
  const hit = (x, y) => {
    const t = (x - KEYW) / ppb, m = HIGH - Math.floor((y - RULER) / ROWH);
    for (let k = notes.length - 1; k >= 0; k--) {
      const n = notes[k];
      if (n.m === m && t >= n.t && t <= n.t + n.d) return { n, edge: (n.t + n.d - t) * ppb < 12 };
    }
    return { t, m };
  };
  const local = (e) => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left + wrap.scrollLeft, e.clientY - r.top + wrap.scrollTop]; };
  cv.addEventListener('pointerdown', (e) => {
    const [x, y] = local(e);
    if (x - wrap.scrollLeft < KEYW || y - wrap.scrollTop < RULER) {
      // 鍵盤をタップ：その音を鳴らす
      if (x - wrap.scrollLeft < KEYW) preview([HIGH - Math.floor((y - RULER) / ROWH)], 0.6);
      return;
    }
    const h = hit(x, y);
    drag = { x0: e.clientX, y0: e.clientY, h, moved: false, pid: e.pointerId, orig: h.n ? { t: h.n.t, m: h.n.m, d: h.n.d } : null, list: null };
    if (h.n) {
      drag.list = sel.has(h.n) ? [...sel].map((n) => ({ n, t: n.t, m: n.m, d: n.d })) : [{ n: h.n, t: h.n.t, m: h.n.m, d: h.n.d }];
      cv.setPointerCapture(e.pointerId);
    }
  });
  cv.addEventListener('pointermove', (e) => {
    if (!drag || drag.pid !== e.pointerId || !drag.h.n) return;
    const dx = e.clientX - drag.x0, dy = e.clientY - drag.y0;
    if (!drag.moved && Math.hypot(dx, dy) < 8) return;
    drag.moved = true;
    e.preventDefault();
    const dt = Math.round(dx / ppb / snap) * snap, dm = -Math.round(dy / ROWH);
    for (const it of drag.list) {
      if (drag.h.edge) it.n.d = Math.max(snap, it.d + dt);
      else { it.n.t = Math.max(0, Math.min(len - snap, it.t + dt)); it.n.m = Math.max(LOW, Math.min(HIGH, it.m + dm)); }
    }
    draw();
  });
  cv.addEventListener('pointerup', (e) => {
    if (!drag || drag.pid !== e.pointerId) return;
    const d = drag;
    drag = null;
    if (d.moved) { save(); if (!d.h.edge) preview(d.list.slice(0, 6).map((it) => it.n.m), 0.3); return; }
    if (d.h.n) {
      // タップ：選択 → もう一度で削除
      if (sel.has(d.h.n) && sel.size === 1) { notes = notes.filter((n) => n !== d.h.n); sel.clear(); save(); }
      else { sel = new Set([d.h.n]); preview([d.h.n.m], d.h.n.d * 60 / S.song.bpm); }
      draw();
      return;
    }
    // 空いたところ：音（和音）を置く
    const t = Math.floor(d.h.t / snap) * snap;
    if (t < 0 || t >= len) return;
    const root = d.h.m;
    const ms = chordType ? chordToMidi(`${midiToName(root).replace(/-?\d+$/, '')}${chordType === 'maj' ? '' : chordType}:${Math.floor(root / 12) - 1}`) : [root];
    const added = ms.filter((m) => m >= LOW && m <= HIGH).map((m) => ({ t, m, d: Math.min(dur, len - t), v: vel }));
    notes.push(...added);
    sel = new Set(added);
    save(); draw();
    preview(ms, Math.min(dur, 2) * 60 / S.song.bpm);
  });
  wrap.addEventListener('scroll', () => requestAnimationFrame(draw));
  window.addEventListener('resize', draw);
  requestAnimationFrame(() => {
    draw();
    wrap.scrollTop = Math.max(0, yOf(center) - wrap.clientHeight / 2);
  });

  function preview(midis, sec) {
    audio();
    call('note', { inst: tr.inst, midis, dur: Math.max(0.15, Math.min(1.5, sec)), vel }).then((m) => playBuffer(m.L, m.R, m.sr)).catch(() => {});
  }
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y); g.lineTo(x + w - r, y); g.quadraticCurveTo(x + w, y, x + w, y + r);
  g.lineTo(x + w, y + h - r); g.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  g.lineTo(x + r, y + h); g.quadraticCurveTo(x, y + h, x, y + h - r);
  g.lineTo(x, y + r); g.quadraticCurveTo(x, y, x + r, y);
  g.closePath();
}
const round = (v) => Math.round(v * 1000) / 1000;

/** クリップだけを鳴らす */
export async function previewClip(ti, ci) {
  audio();
  const s = S.song, tr = s.tracks[ti], clip = tr.clips[ci];
  const mini = { ...s, bars: undefined, tracks: [{ ...tr, mute: false, solo: false, clips: [{ ...clip, at: 0 }] }], master: { ...(s.master || {}), fadeOut: 0 } };
  delete mini.bars;
  try {
    const m = await call('render', { song: mini });
    playBuffer(m.L, m.R, m.sr);
  } catch (e) { toast(e.message, 4000); }
}

/* ---------------- ドラムのマス目 ---------------- */

const HIT = { X: 1, x: 0.8, o: 0.55, g: 0.35 };

function drumEditor(ti, ci) {
  const tr = S.song.tracks[ti];
  const tg = target(ti, ci);
  const bpb = beatsPerBar(S.song);
  const res = tg.obj.res ?? 0.25;
  let len = tg.obj.len ?? clipLen(S.song, { ...tg.clip, repeat: 1 });
  let steps = Math.round(len / res);
  // マス目に読み込む（notes にドラムがあれば合わせる）
  const grid = {};
  const put = (name, k, ch) => { if (!grid[name]) grid[name] = Array(steps).fill('.'); if (k >= 0 && k < steps) grid[name][k] = ch; };
  for (const [name, line] of Object.entries(tg.obj.grid || {})) {
    let k = 0;
    for (const c of String(line)) { if (c === '|') continue; put(name, k, c === '-' || c === '_' || c === ' ' ? '.' : c); k++; }
  }
  for (const x of tg.obj.notes || []) {
    const n = Array.isArray(x) ? { t: x[0], n: x[1], v: x[3] ?? 0.8 } : x;
    put(String(n.n), Math.round(n.t / res), n.v >= 0.95 ? 'X' : n.v >= 0.7 ? 'x' : n.v >= 0.5 ? 'o' : 'g');
  }
  const rows = [...new Set([...Object.keys(grid), ...CORE_DRUMS])].filter((r) => DRUM_NAMES.includes(r));
  rows.sort((a, b) => DRUM_NAMES.indexOf(a) - DRUM_NAMES.indexOf(b));
  for (const r of rows) if (!grid[r]) grid[r] = Array(steps).fill('.');
  let brush = 'x';

  const save = () => {
    const out = {};
    for (const r of Object.keys(grid)) {
      const line = grid[r].slice(0, steps).join('');
      if (/[^.]/.test(line)) out[r] = line.match(new RegExp(`.{1,${Math.round(bpb / res)}}`, 'g')).join('|');
    }
    commit((s) => {
      const o = tg.kind === 'pattern' ? s.patterns[tg.clip.pattern] : s.tracks[ti].clips[ci];
      o.grid = out;
      delete o.notes;
      o.len = len;
      if (res !== 0.25) o.res = res;
    });
  };
  const full = $('#full');
  const close = () => { full.hidden = true; full.replaceChildren(); };
  const table = el('div', { class: 'roll-wrap' });
  let cellW = 30;
  const cellH = 40, labW = 72;
  const cv = el('canvas');
  const space = el('div', { class: 'roll-space' });
  table.append(cv, space);

  function draw() {
    const W = table.clientWidth, H = table.clientHeight;
    // 1小節がちょうど画面に入る幅（狭すぎるときは横にスクロール）
    cellW = Math.max(20, Math.min(40, Math.floor((W - labW - 4) / Math.round(bpb / res))));
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    space.style.width = `${labW + steps * cellW + 20}px`; space.style.height = `${RULER + rows.length * cellH + 20}px`;
    cv.width = W * dpr; cv.height = H * dpr; cv.style.width = `${W}px`; cv.style.height = `${H}px`; cv.style.marginBottom = `${-H}px`;
    const g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const sx = table.scrollLeft, sy = table.scrollTop;
    g.fillStyle = '#0f1115'; g.fillRect(0, 0, W, H);
    const perBeat = Math.round(1 / res);
    rows.forEach((r, ri) => {
      const y = RULER + ri * cellH - sy;
      if (y + cellH < RULER || y > H) return;
      for (let k = 0; k < steps; k++) {
        const x = labW + k * cellW - sx;
        if (x + cellW < labW || x > W) continue;
        const beatIdx = Math.floor(k / perBeat);
        g.fillStyle = beatIdx % 2 ? '#1c2029' : '#222733';
        g.fillRect(x + 1, y + 2, cellW - 2, cellH - 4);
        const c = grid[r][k];
        if (c !== '.') {
          const v = HIT[c] ?? 0.8;
          g.fillStyle = `rgba(61,220,151,${0.35 + v * 0.65})`;
          const s = 6 + v * (cellW - 14);
          g.fillRect(x + (cellW - s) / 2, y + (cellH - s * 1.2) / 2, s, s * 1.2);
        }
        if (k % (perBeat * bpb) === 0) { g.fillStyle = '#5a6278'; g.fillRect(x, y, 1, cellH); }
      }
      g.fillStyle = '#191c23'; g.fillRect(0, y, labW, cellH - 1);
      g.fillStyle = '#f1f3f8'; g.font = '12px -apple-system, sans-serif'; g.textBaseline = 'middle';
      g.fillText(DRUM_LABEL[r] || r, 8, y + cellH / 2);
    });
    g.fillStyle = '#0f1115'; g.fillRect(0, 0, W, RULER);
    for (let b = 0; b * bpb < len; b++) {
      const x = labW + (b * bpb / res) * cellW - sx;
      if (x < labW - 2 || x > W) continue;
      g.fillStyle = '#959cb0'; g.font = '11px sans-serif'; g.fillText(String(b + 1), x + 3, RULER / 2);
    }
  }
  cv.addEventListener('click', (e) => {
    const r = cv.getBoundingClientRect();
    const x = e.clientX - r.left + table.scrollLeft, y = e.clientY - r.top + table.scrollTop;
    const ri = Math.floor((y - RULER) / cellH), k = Math.floor((x - labW) / cellW);
    if (ri < 0 || ri >= rows.length) return;
    const name = rows[ri];
    if (x - table.scrollLeft < labW) { hitPreview(name, 0.9); return; }
    if (k < 0 || k >= steps) return;
    const cur = grid[name][k];
    grid[name][k] = cur === brush ? '.' : brush;
    if (grid[name][k] !== '.') hitPreview(name, HIT[brush]);
    save(); draw();
  });
  table.addEventListener('scroll', () => requestAnimationFrame(draw));

  const top = el('div', { class: 'full-top' }, [
    el('button', { class: 'icon-btn', type: 'button', 'aria-label': '閉じる', onclick: close, html: '<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>' }),
    el('h2', {}, `${tr.name || tr.id}${tg.kind === 'pattern' ? `（パターン ${tg.clip.pattern}）` : ''}`),
    el('button', { class: 'btn sm', type: 'button', onclick: () => previewClip(ti, ci) }, '▶ 試聴'),
  ]);
  const addSel = el('select', { onchange: (e) => { const v = e.target.value; if (v && !rows.includes(v)) { rows.push(v); grid[v] = Array(steps).fill('.'); rows.sort((a, b) => DRUM_NAMES.indexOf(a) - DRUM_NAMES.indexOf(b)); draw(); } e.target.value = ''; } },
    [el('option', { value: '' }, '＋ 楽器を追加')].concat(DRUM_NAMES.map((n) => el('option', { value: n }, DRUM_LABEL[n] || n))));
  const tools = el('div', { class: 'roll-tools' }, [
    el('span', { class: 'lbl' }, '強さ'),
    seg([['X', '強'], ['x', '中'], ['o', '弱'], ['g', 'ゴースト']], brush, (v) => (brush = v)),
    addSel,
  ]);
  const bottom = el('div', { class: 'roll-bottom' }, [
    el('button', { class: 'btn sm', type: 'button', onclick: () => { for (const r of rows) grid[r] = Array(steps).fill('.'); save(); draw(); } }, 'すべて消す'),
    el('button', { class: 'btn sm', type: 'button', onclick: () => { const per = Math.round(bpb / res); for (const r of rows) for (let k = per; k < steps; k++) grid[r][k] = grid[r][k % per]; save(); draw(); } }, '1小節目をくり返す'),
    el('button', { class: 'btn sm', type: 'button', onclick: () => { len += bpb; steps = Math.round(len / res); for (const r of rows) while (grid[r].length < steps) grid[r].push('.'); save(); draw(); } }, '＋1小節'),
    el('button', { class: 'btn sm', type: 'button', onclick: () => { if (len > bpb) { len -= bpb; steps = Math.round(len / res); save(); draw(); } } }, '−1小節'),
  ]);
  full.replaceChildren(top, tools, table, bottom);
  full.hidden = false;
  requestAnimationFrame(draw);
  if (tg.kind === 'pattern') toast(`パターン「${tg.clip.pattern}」を使うすべてのクリップが変わります`, 3000);

  function hitPreview(name, v) {
    audio();
    call('drum', { kit: tr.kit, name, vel: v }).then((m) => playBuffer(m.L, m.R, m.sr, 0.8)).catch(() => {});
  }
}
