/*
 * タイムライン。中央の再生ヘッドは固定で、下のトラックを横スクロールして位置を合わせる（スマホ向け）。
 */
import { layoutClips, TRANSITIONS, overlayEnd } from './engine/project.js';
import { SHAPES, EFFECTS } from './engine/fx.js';
import { catalogSync, normRef } from './engine/motionlib.js';

const el = (tag, cls, attrs = {}) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
};

const fmtShort = (s) => {
  const m = Math.floor(s / 60);
  const ss = s % 60;
  return m ? `${m}:${String(Math.floor(ss)).padStart(2, '0')}` : `${Math.round(ss * 10) / 10}s`.replace('.0s', 's');
};

/** 時間が重なるものを段（レーン）に振り分ける */
function assignLanes(items) {
  const ends = [];
  const lane = new Map();
  for (const it of [...items].sort((a, b) => a.start - b.start)) {
    let i = ends.findIndex((e) => e <= it.start + 1e-6);
    if (i < 0) { i = ends.length; ends.push(0); }
    ends[i] = it.end;
    lane.set(it.id, i);
  }
  return { lane, count: Math.max(1, ends.length) };
}

const TR_ICON = { none: '＋', fade: '◐', black: '■', white: '□', slide: '⇢', wipe: '▥', zoom: '⤢', flip: '⟲', cube: '◧' };

/** ブロックにキーフレームの印（◆）を付ける */
function addKeyMarks(b, item, len, pps) {
  for (const k of item.keys || []) {
    if (!(k.t >= 0) || k.t > len + 1e-6) continue;
    const d = el('i', 'kf');
    d.style.left = `${k.t * pps}px`;
    b.append(d);
  }
}

export class Timeline {
  constructor(root, app) {
    this.app = app;
    this.root = root;
    this.pps = 60;
    this.scroller = root.querySelector('.tl-scroll');
    this.content = root.querySelector('.tl-content');
    this.ruler = root.querySelector('.tl-ruler');
    this.rows = {
      clip: root.querySelector('.tl-video'),
      text: root.querySelector('.tl-text'),
      ov: root.querySelector('.tl-ov'),
      fx: root.querySelector('.tl-fx'),
      audio: root.querySelector('.tl-audio'),
    };
    this.expectScroll = null; // プログラムで動かしたスクロール位置（ユーザー操作と区別する）
    this.selection = null;
    this.scroller.addEventListener('scroll', () => {
      const x = this.scroller.scrollLeft;
      if (this.expectScroll != null && Math.abs(x - this.expectScroll) <= 1) { this.expectScroll = null; return; }
      this.expectScroll = null;
      this.app.scrub(x / this.pps);
    }, { passive: true });
    this.#pinch();
    new ResizeObserver(() => this.render()).observe(this.scroller);
  }

  get pad() { return this.scroller.clientWidth / 2; }

  setTime(t) {
    const x = Math.round(t * this.pps);
    if (Math.abs(this.scroller.scrollLeft - x) < 1) return;
    this.expectScroll = x;
    this.scroller.scrollLeft = x;
  }

  zoom(f, keepT = this.app.player.t) {
    this.pps = Math.max(8, Math.min(400, this.pps * f));
    this.render();
    this.setTime(keepT);
  }

  #pinch() {
    let d0 = 0, pps0 = 0, t0 = 0;
    const dist = (e) => Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
    this.scroller.addEventListener('touchstart', (e) => {
      if (e.touches.length === 2) { d0 = dist(e); pps0 = this.pps; t0 = this.app.player.t; }
    }, { passive: true });
    this.scroller.addEventListener('touchmove', (e) => {
      if (e.touches.length !== 2 || !d0) return;
      e.preventDefault();
      this.pps = Math.max(8, Math.min(400, pps0 * (dist(e) / d0)));
      this.render();
      this.setTime(t0);
    }, { passive: false });
    this.scroller.addEventListener('touchend', () => { d0 = 0; });
  }

  render() {
    const p = this.app.project;
    if (!p) return;
    const layout = layoutClips(p);
    const dur = this.app.player.duration;
    const pad = this.pad;
    const pps = this.pps;
    const width = Math.max(dur, 1) * pps;
    this.content.style.width = `${width + pad * 2}px`;
    this.content.style.setProperty('--pad', `${pad}px`);

    // 目盛り
    this.ruler.textContent = '';
    const steps = [0.5, 1, 2, 5, 10, 15, 30, 60, 120];
    const step = steps.find((s) => s * pps >= 56) || 300;
    for (let t = 0; t <= dur + 1e-6; t += step) {
      const tick = el('span', 'tick');
      tick.style.left = `${pad + t * pps}px`;
      tick.textContent = fmtShort(t);
      this.ruler.append(tick);
    }

    // 動画トラック
    const vrow = this.rows.clip;
    vrow.textContent = '';
    if (!layout.length) {
      const add = el('button', 'tl-empty', { type: 'button' });
      add.textContent = '＋ 動画・写真を追加';
      add.style.left = `${pad}px`;
      add.addEventListener('click', () => this.app.addMediaDialog());
      vrow.append(add);
    }
    layout.forEach((L) => {
      const c = L.clip;
      const media = p.media[c.media];
      const b = this.#block('clip', c.id, L.start, L.dur);
      b.classList.add('clip');
      const strip = el('div', 'thumbs');
      b.append(strip);
      this.#fillThumbs(strip, c, media, L.dur * pps);
      const info = el('span', 'blabel');
      const tags = [];
      if (c.speed !== 1) tags.push(`${c.speed}x`);
      if (!(c.volume > 0) && media?.kind === 'video') tags.push('🔇');
      info.textContent = `${fmtShort(L.dur)}${tags.length ? ' ' + tags.join(' ') : ''}`;
      b.append(info);
      vrow.append(b);
    });
    // トランジションボタン
    layout.forEach((L, i) => {
      if (i === 0) return;
      const t = L.tIn;
      const x = pad + (TRANSITIONS[t.type]?.overlap ? L.start + t.d / 2 : L.start) * pps;
      const btn = el('button', 'tl-trans' + (t.type !== 'none' ? ' on' : ''), { type: 'button', 'aria-label': 'トランジション' });
      btn.textContent = TR_ICON[t.type] || '＋';
      btn.style.left = `${x}px`;
      btn.addEventListener('click', (e) => { e.stopPropagation(); this.app.openTransition(L.clip.id); });
      vrow.append(btn);
    });

    // 文字・図形トラック（重なるものは段を分ける）
    const trow = this.rows.text;
    trow.textContent = '';
    const overlays = [
      ...p.texts.map((x) => ({ type: 'text', item: x, label: x.text.replace(/\n/g, ' ') || '（空）' })),
      ...(p.shapes || []).map((x) => ({ type: 'shape', item: x, label: `◆ ${SHAPES[x.kind] || '図形'}` })),
    ];
    const ol = assignLanes(overlays.map((o) => o.item));
    for (const o of overlays) {
      const b = this.#block(o.type, o.item.id, o.item.start, o.item.end - o.item.start, ol.lane.get(o.item.id), ol.count);
      const lab = el('span', 'blabel');
      lab.textContent = o.label;
      b.append(lab);
      addKeyMarks(b, o.item, o.item.end - o.item.start, this.pps);
      trow.append(b);
    }

    // 重ねた映像（ワイプ）トラック
    const vrow2 = this.rows.ov;
    vrow2.textContent = '';
    const ovs = p.overlays || [];
    const mos = p.motions || [];
    const vl = assignLanes([...ovs.map((o) => ({ id: o.id, start: o.start, end: overlayEnd(o) })), ...mos]);
    const cat = catalogSync();
    for (const m of mos) {
      const b = this.#block('motion', m.id, m.start, m.end - m.start, vl.lane.get(m.id), vl.count);
      const lab = el('span', 'blabel');
      const e = cat?.byId[normRef(m.ref)];
      lab.textContent = `✦ #${normRef(m.ref)} ${e ? e.name.ja : ''}`;
      b.append(lab);
      addKeyMarks(b, m, m.end - m.start, this.pps);
      vrow2.append(b);
    }
    for (const o of ovs) {
      const len = overlayEnd(o) - o.start;
      const b = this.#block('overlay', o.id, o.start, len, vl.lane.get(o.id), vl.count);
      const lab = el('span', 'blabel');
      const m = p.media[o.media];
      lab.textContent = `${o.cutout?.mode ? '✂ ' : '▣ '}${m?.name || ''}`;
      b.append(lab);
      addKeyMarks(b, o, len, this.pps);
      vrow2.append(b);
    }

    // エフェクトトラック
    const frow = this.rows.fx;
    frow.textContent = '';
    const effects = p.effects || [];
    const fl = assignLanes(effects);
    for (const e of effects) {
      const b = this.#block('effect', e.id, e.start, e.end - e.start, fl.lane.get(e.id), fl.count);
      const lab = el('span', 'blabel');
      lab.textContent = `${EFFECTS[e.type]?.icon || ''} ${EFFECTS[e.type]?.label || e.type}`;
      b.append(lab);
      frow.append(b);
    }

    // 音声トラック
    const arow = this.rows.audio;
    arow.textContent = '';
    const alen = (a) => (a.loop ? Math.max(0.1, dur - a.start) : Math.max(0.1, a.out - a.in));
    const al = assignLanes(p.audios.map((a) => ({ id: a.id, start: a.start, end: a.start + alen(a) })));
    for (const a of p.audios) {
      const len = alen(a);
      const b = this.#block('audio', a.id, a.start, len, al.lane.get(a.id), al.count);
      const cv = el('canvas', 'wave');
      b.append(cv);
      const lab = el('span', 'blabel');
      lab.textContent = `${a.loop ? '🔁 ' : '♪ '}${p.media[a.media]?.name || ''}`;
      b.append(lab);
      arow.append(b);
      requestAnimationFrame(() => this.#drawWave(cv, a, len));
    }
    this.#applySelection();
  }

  #block(type, id, start, len, lane = 0, lanes = 1) {
    const b = el('div', `blk ${type}`);
    b.dataset.type = type;
    b.dataset.id = id;
    b.style.left = `${this.pad + start * this.pps}px`;
    b.style.width = `${Math.max(6, len * this.pps)}px`;
    if (lanes > 1) {
      b.style.top = `calc(${(lane * 100) / lanes}% + ${lane ? 1 : 0}px)`;
      b.style.height = `calc(${100 / lanes}% - 1px)`;
      b.classList.add('thin');
    }
    const hl = el('div', 'handle l');
    const hr = el('div', 'handle r');
    b.append(hl, hr);
    this.#gestures(b, hl, hr, type, id);
    return b;
  }

  #fillThumbs(strip, clip, media, widthPx) {
    if (!media) return;
    const tileW = 48;
    const n = Math.max(1, Math.ceil(widthPx / tileW));
    this.app.lib.thumbnails(media.id, media.kind === 'video' ? 10 : 1).then((thumbs) => {
      if (!thumbs.length || !strip.isConnected) return;
      const frag = document.createDocumentFragment();
      for (let i = 0; i < n; i++) {
        let src = thumbs[0];
        if (media.kind === 'video' && media.duration > 0) {
          const t = clip.in + ((i + 0.5) / n) * (clip.out - clip.in);
          src = thumbs[Math.min(thumbs.length - 1, Math.floor((t / media.duration) * thumbs.length))];
        }
        const img = el('img');
        img.src = src;
        img.alt = '';
        img.draggable = false;
        frag.append(img);
      }
      strip.append(frag);
    });
  }

  #drawWave(cv, a, len) {
    const e = this.app.lib.get(a.media);
    const w = cv.clientWidth, h = cv.clientHeight;
    if (!w || !h) return;
    const dpr = Math.min(2, devicePixelRatio || 1);
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(h * dpr);
    const ctx = cv.getContext('2d');
    ctx.scale(dpr, dpr);
    const draw = () => {
      const peaks = e?.peaks;
      if (!peaks) return;
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      const perSec = 100;
      const loopLen = a.out - a.in;
      for (let x = 0; x < w; x += 2) {
        let t = (x / w) * len;
        if (a.loop && loopLen > 0) t %= loopLen;
        const v = peaks[Math.min(peaks.length - 1, Math.floor((a.in + t) * perSec))] || 0;
        const bh = Math.max(1, v * (h - 4));
        ctx.fillRect(x, (h - bh) / 2, 1.5, bh);
      }
    };
    if (e?.peaks) draw();
    else this.app.lib.previewAudio(a.media).then(draw);
  }

  select(sel) {
    this.selection = sel;
    this.#applySelection();
  }

  #applySelection() {
    // クリップ選択中は境目のトランジションボタンがつまみと重なるので隠す（ツールバーから開ける）
    this.rows.clip.classList.toggle('has-sel', this.selection?.type === 'clip');
    for (const b of this.content.querySelectorAll('.blk')) {
      const on = this.selection && b.dataset.type === this.selection.type && b.dataset.id === this.selection.id;
      b.classList.toggle('sel', !!on);
    }
  }

  /* ---------- タップ・ドラッグ ---------- */

  #gestures(b, hl, hr, type, id) {
    // タップで選択（スクロールと区別するため、ほとんど動かなかったときだけ）
    let sx = 0, sy = 0, moved = false;
    b.addEventListener('pointerdown', (e) => { sx = e.clientX; sy = e.clientY; moved = false; });
    b.addEventListener('pointermove', (e) => { if (Math.hypot(e.clientX - sx, e.clientY - sy) > 8) moved = true; });
    b.addEventListener('click', (e) => {
      if (moved) return;
      e.stopPropagation();
      const cur = this.selection;
      if (cur && cur.type === type && cur.id === id) this.app.openInspector();
      else this.app.select({ type, id });
    });

    // ドラッグ中はタイムラインの DOM が作り直されるので、移動・終了は window で受ける
    const track = (e, onStart, onMove) => {
      const x0 = e.clientX;
      const id0 = e.pointerId;
      let started = false;
      const move = (ev) => {
        if (ev.pointerId !== id0) return;
        if (!started) {
          if (onStart.threshold && Math.abs(ev.clientX - x0) < onStart.threshold) return;
          started = true;
          onStart();
        }
        ev.preventDefault();
        onMove((ev.clientX - x0) / this.pps);
      };
      const up = (ev) => {
        if (ev.pointerId !== id0) return;
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', up);
        if (started) { moved = true; this.app.endEdit(); }
      };
      window.addEventListener('pointermove', move, { passive: false });
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', up);
    };

    const drag = (handle, mode) => {
      handle.addEventListener('pointerdown', (e) => {
        if (!b.classList.contains('sel')) return;
        e.preventDefault();
        e.stopPropagation();
        let item, orig;
        const start = () => {
          this.app.beginEdit();
          item = this.app.findItem(type, id);
          orig = JSON.parse(JSON.stringify(item));
        };
        track(e, start, (dt) => this.app.applyDrag(type, item, orig, mode, dt));
      });
    };
    drag(hl, 'left');
    drag(hr, 'right');
    if (type !== 'clip') {
      // 選択中のテキスト・音声は本体をドラッグして移動
      b.addEventListener('pointerdown', (e) => {
        if (!b.classList.contains('sel') || e.target.classList.contains('handle')) return;
        let item, orig;
        const start = () => {
          this.app.beginEdit();
          item = this.app.findItem(type, id);
          orig = JSON.parse(JSON.stringify(item));
        };
        start.threshold = 6;
        track(e, start, (dt) => this.app.applyDrag(type, item, orig, 'move', dt));
      });
    }
  }
}
