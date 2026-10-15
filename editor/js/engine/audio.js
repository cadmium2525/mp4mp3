/*
 * 音声のミックス。プレビュー（AudioContext）と書き出し（OfflineAudioContext）で同じスケジュールを使う。
 */
import { projectDuration, TRANSITIONS, overlayEnd } from './project.js';

/** [時刻, 値] の折れ線で表した音量カーブ */
function envelope(points) {
  points.sort((a, b) => a[0] - b[0]);
  return {
    points,
    at(t) {
      if (t <= points[0][0]) return points[0][1];
      for (let i = 1; i < points.length; i++) {
        const [t1, v1] = points[i];
        if (t <= t1) {
          const [t0, v0] = points[i - 1];
          return t1 === t0 ? v1 : v0 + ((v1 - v0) * (t - t0)) / (t1 - t0);
        }
      }
      return points[points.length - 1][1];
    },
  };
}

/** 区間 [s, e] でフェードイン fi 秒・フェードアウト fo 秒する音量カーブ */
function fadeEnv(s, e, fi, fo, vol) {
  const pts = [[s, fi > 0 ? 0 : vol]];
  if (fi > 0) pts.push([Math.min(e, s + fi), vol]);
  if (fo > 0) pts.push([Math.max(s, e - fo), vol]);
  pts.push([e, fo > 0 ? 0 : vol]);
  return pts;
}

/** 動画の最後のフェードアウトを掛け合わせる */
function withProjectFade(points, project, total) {
  if (!(project.fadeOut > 0)) return points;
  const fs = total - project.fadeOut;
  const env = envelope(points.map((p) => [...p]));
  const extra = [fs, total, ...points.map((p) => p[0])].filter((t, i, a) => a.indexOf(t) === i).sort((a, b) => a - b);
  return extra.map((t) => [t, env.at(t) * (t <= fs ? 1 : Math.max(0, 1 - (t - fs) / project.fadeOut))]);
}

/**
 * 音声ソースを ctx にスケジュールする。
 * @param {BaseAudioContext} ctx
 * @param {(mediaId: string) => AudioBuffer | null} getBuffer
 * @param {number} t0 タイムライン上の開始位置（秒）
 * @param {number} ctxStart t0 に対応する ctx.currentTime
 * @returns {AudioScheduledSourceNode[]}
 */
export function scheduleAudio(ctx, project, layout, getBuffer, t0, ctxStart, dest = ctx.destination) {
  const total = projectDuration(project, layout);
  const nodes = [];
  const toCtx = (t) => ctxStart + (t - t0);

  const play = (buf, opts) => {
    const { start, end, offset, rate = 1, points, loop } = opts;
    if (end <= t0 || end <= start) return;
    const s = ctx.createBufferSource();
    s.buffer = buf;
    s.playbackRate.value = rate;
    if (loop) { s.loop = true; s.loopStart = loop[0]; s.loopEnd = loop[1]; }
    const g = ctx.createGain();
    const env = envelope(points);
    const from = Math.max(t0, start);
    g.gain.setValueAtTime(env.at(from), toCtx(from));
    for (const [t, v] of env.points) if (t > from) g.gain.linearRampToValueAtTime(v, toCtx(t));
    s.connect(g).connect(dest);
    let off = offset + (from - start) * rate;
    if (loop) off = loop[0] + ((off - loop[0]) % (loop[1] - loop[0]));
    s.start(toCtx(from), Math.max(0, off));
    s.stop(toCtx(end));
    nodes.push(s);
  };

  // メイントラックの動画の音
  layout.forEach((L, i) => {
    const c = L.clip;
    if (!(c.volume > 0)) return;
    const buf = getBuffer(c.media);
    if (!buf) return;
    const vol = c.volume;
    const next = layout[i + 1];
    let fi = 0, fo = 0;
    const tin = L.tIn;
    if (tin.d > 0) fi = TRANSITIONS[tin.type].overlap ? tin.d : (i === 0 ? tin.d : tin.d / 2);
    if (next && next.tIn.d > 0) fo = TRANSITIONS[next.tIn.type].overlap ? next.tIn.d : next.tIn.d / 2;
    // 短いフェードで切り替え時のプチノイズを防ぐ
    fi = Math.max(fi, 0.01);
    fo = Math.max(fo, 0.01);
    const end = Math.min(L.end, total);
    play(buf, {
      start: L.start,
      end,
      offset: c.in,
      rate: c.speed || 1,
      points: withProjectFade(fadeEnv(L.start, end, fi, fo, vol), project, total),
    });
  });

  // 重ねた映像（ワイプ）の音
  for (const o of project.overlays || []) {
    if (!(o.volume > 0)) continue;
    const buf = getBuffer(o.media);
    if (!buf) continue;
    const end = Math.min(overlayEnd(o), total);
    play(buf, {
      start: o.start,
      end,
      offset: o.in,
      rate: o.speed || 1,
      points: withProjectFade(fadeEnv(o.start, end, 0.02, 0.02, o.volume), project, total),
    });
  }

  // BGM・効果音
  for (const a of project.audios) {
    const buf = getBuffer(a.media);
    if (!buf || !(a.volume > 0)) continue;
    const len = a.out - a.in;
    if (len <= 0) continue;
    const end = Math.min(a.loop ? total : a.start + len, total || a.start + len);
    play(buf, {
      start: a.start,
      end,
      offset: a.in,
      loop: a.loop ? [a.in, a.out] : null,
      points: withProjectFade(fadeEnv(a.start, end, a.fadeIn || 0.01, a.fadeOut || 0.01, a.volume), project, total),
    });
  }
  return nodes;
}

/** 書き出し用：全体の音声を1本の AudioBuffer にミックスする */
export async function mixdown(project, layout, getBuffer, sampleRate = 48000) {
  const total = projectDuration(project, layout);
  const C = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const ctx = new C(2, Math.max(1, Math.ceil(total * sampleRate)), sampleRate);
  scheduleAudio(ctx, project, layout, getBuffer, 0, 0);
  return ctx.startRendering();
}
