/*
 * つなぐ：かなでる（../daw）のエンジンで、効果音や曲をその場で作る。
 * プロジェクトの JSON に音の「作り方」を書いておけば、素材ファイルなしで音が付く。
 *   audios: [{ "sfx": { "preset": "whoosh" }, "start": 3 }, { "song": { ...かなでるの曲... }, "start": 0 }]
 *   media:  { "bgm": { "gen": { "song": {...} } } } と書いて audios から参照してもよい
 */

let worker = null, seq = 0;
const pending = new Map();

function call(type, payload, onProgress) {
  if (!worker) {
    worker = new Worker(new URL('../../../daw/js/worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => {
      const m = e.data, p = pending.get(m.id);
      if (!p) return;
      if (m.type === 'progress') return p.onProgress?.(m.p, m.label);
      pending.delete(m.id);
      m.type === 'error' ? p.reject(new Error(m.message)) : p.resolve(m);
    };
  }
  const id = ++seq;
  return new Promise((resolve, reject) => { pending.set(id, { resolve, reject, onProgress }); worker.postMessage({ type, id, ...payload }); });
}

const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return (h >>> 0).toString(36); };

/** 作り方（{ sfx } か { song }）から WAV のファイルを作る */
export async function synthFile(gen, name, onProgress) {
  const r = gen.song ? await call('render', { song: gen.song }, onProgress) : await call('sfx', { spec: gen.sfx });
  const w = await call('wav', { L: r.L, R: r.R, sr: r.sr, bits: 16 });
  return new File([w.bytes], name || `kanaderu_${hash(JSON.stringify(gen))}.wav`, { type: 'audio/wav' });
}

/** 効果音を試しに鳴らすためのデータ（L, R, sr） */
export const synthSfx = (spec) => call('sfx', { spec });
export const synthCompose = (opts) => call('compose', { opts });

/**
 * audios の中の { sfx } / { song } を、media の項目（gen つき）への参照に書き換える。
 * 同じ作り方の音は 1 つの素材にまとめる。
 */
export function expandGenerated(project) {
  const media = { ...(project.media || {}) };
  const audios = (project.audios || []).map((a) => {
    if (a.media || (!a.sfx && !a.song)) return a;
    const gen = a.sfx ? { sfx: a.sfx } : { song: a.song };
    const id = (a.sfx ? 'sfx_' : 'song_') + hash(JSON.stringify(gen));
    if (!media[id]) media[id] = { name: `${id}.wav`, kind: 'audio', gen };
    const { sfx, song, ...rest } = a;
    return { ...rest, media: id };
  });
  return { ...project, media, audios };
}
