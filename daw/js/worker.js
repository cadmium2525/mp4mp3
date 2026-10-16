/*
 * かなでる：重い計算（曲の描画・解析・効果音・書き出し）を画面の外で行うワーカー。
 */
import { renderSong, autoMix } from './engine/mix.js';
import { renderAnySfx, sfxFromPreset, drum } from './engine/sfx.js';
import { renderSfx } from './engine/sfx.js';
import { renderNotes } from './engine/instruments.js';
import { resolveInst, KITS, DRUM_PEAK } from './engine/presets.js';
import { applyChain } from './engine/fx.js';
import { analyzeAudio, reportText, phoneLoss } from './engine/analyze.js';
import { sfxStats } from './engine/viz.js';
import { encodeWav } from './engine/wav.js';
import { validateSong } from './engine/validate.js';
import { beatsPerBar } from './engine/song.js';
import { dbToGain } from './engine/dsp.js';

const cache = new Map(); // トラックの描画結果の使い回し（編集していないトラックは計算しない）

const post = (m, t) => self.postMessage(m, t || []);

self.onmessage = (e) => {
  const m = e.data;
  try {
    handle(m);
  } catch (err) {
    post({ type: 'error', id: m.id, message: err?.message || String(err) });
  }
};

function handle(m) {
  switch (m.type) {
    case 'render': {
      const chk = validateSong(m.song);
      if (chk.errors.length) throw new Error(chk.errors.join('\n'));
      if (cache.size > 40) cache.clear();
      const out = renderSong(m.song, { sr: m.sr || 48000, cache, stems: !!m.stems, onProgress: (p, label) => post({ type: 'progress', id: m.id, p, label }) });
      const transfer = [out.L.buffer, out.R.buffer];
      const msg = { type: 'done', id: m.id, L: out.L, R: out.R, sr: out.sr, duration: out.duration };
      if (m.stems) { msg.stems = out.stems; for (const [a, b] of Object.values(out.stems)) transfer.push(a.buffer, b.buffer); }
      // subarray のままだと全体のバッファが転送されるので、ちょうどの長さに切り出す
      msg.L = out.L.slice(); msg.R = out.R.slice();
      return post(msg, [msg.L.buffer, msg.R.buffer]);
    }
    case 'note': {
      // 1音だけ鳴らす（ピアノロールの試聴用）
      const sr = 48000, inst = resolveInst(m.inst);
      const n = Math.round(sr * (m.dur + 1.2));
      const L = new Float32Array(n), R = new Float32Array(n);
      renderNotes(inst, m.midis.map((mm) => ({ s: 0, len: Math.round(m.dur * sr), m: mm, v: m.vel ?? 0.8 })), L, R, sr, 7);
      applyChain(inst.fx, L, R, { sr, bpm: 120, timeAt: (i) => i / sr });
      const g = dbToGain(-14);
      for (let i = 0; i < n; i++) { L[i] *= g; R[i] *= g; }
      return post({ type: 'done', id: m.id, L, R, sr }, [L.buffer, R.buffer]);
    }
    case 'drum': {
      const kit = KITS[m.kit || 'acoustic'] || KITS.acoustic;
      const opt = { ...(kit.map[m.name] || {}) };
      const def = drum(opt.piece || m.name, { ...opt, vel: m.vel ?? 0.9 });
      def.normalize = DRUM_PEAK[m.name] ?? -10;
      def.loudCap = 0;
      const [L, R] = renderSfx(def, 48000);
      return post({ type: 'done', id: m.id, L, R, sr: 48000 }, [L.buffer, R.buffer]);
    }
    case 'sfx': {
      const def = m.spec.preset ? sfxFromPreset(m.spec) : m.spec;
      const [L, R] = renderAnySfx(m.spec, 48000);
      const stats = { ...sfxStats(L, R, 48000), phoneLoss: phoneLoss(L, R, 48000) };
      return post({ type: 'done', id: m.id, L, R, sr: 48000, stats, def }, [L.buffer, R.buffer]);
    }
    case 'analyze': {
      const song = m.song;
      const opts = song ? { bpm: song.bpm, beatsPerBar: beatsPerBar(song), targetLufs: song.master?.loudness ?? -14, stems: m.stems || null, chordStep: song.chordStep } : {};
      const a = analyzeAudio(m.L, m.R, m.sr, opts);
      a.chordStep = song?.chordStep;
      const text = reportText(a);
      return post({ type: 'done', id: m.id, analysis: a, text });
    }
    case 'automix': {
      const vols = autoMix(m.song, { onProgress: (p, label) => post({ type: 'progress', id: m.id, p, label: '測定中… ' + label }) });
      return post({ type: 'done', id: m.id, vols });
    }
    case 'wav': {
      const bytes = encodeWav(m.L, m.R, m.sr, m.bits || 24);
      return post({ type: 'done', id: m.id, bytes }, [bytes.buffer]);
    }
    case 'validate':
      return post({ type: 'done', id: m.id, ...validateSong(m.song) });
    default:
      throw new Error(`不明な処理: ${m.type}`);
  }
}
