/*
 * かなでる：エフェクト。トラック・センド・マスター・効果音のどこでも同じものを使う。
 * どれも process(L, R) でステレオのバッファをその場で書き換える。
 * パラメーターの多くは数値のほかにカーブ [[時刻, 値], ...] も受け付ける（曲では拍、効果音では秒）。
 */
import { Biquad, SVF, OnePole, Delay, DCBlock, Noise, rng, curve, clamp, dbToGain, softClip, noteValue, TAU } from './dsp.js';

const BLOCK = 32; // カーブを評価する間隔（サンプル）

/** 数値またはカーブを「サンプル位置 → 値」の関数にする */
function param(ctx, spec, def, shape = 'lin') {
  if (spec == null) spec = def;
  if (typeof spec === 'number') return () => spec;
  if (typeof spec === 'string') return () => Number(spec);
  const c = curve(spec, shape);
  return (i) => c(ctx.timeAt(i));
}

/** 秒、または "1/8d" のような音価（曲のテンポで秒に換算） */
function timeSec(ctx, v, def) {
  if (v == null) v = def;
  if (typeof v === 'string' && v.includes('/')) return (noteValue(v) * 60) / (ctx.bpm || 120);
  return Number(v);
}

/** 速さ：数値は Hz、"1/8" のような音価は曲のテンポに合わせた周期（1 周 = その音価） */
function rateHz(ctx, v, def) {
  if (v == null) v = def;
  if (typeof v === 'string' && v.includes('/')) return 1 / Math.max(1e-4, timeSec(ctx, v));
  return Number(v);
}

/** カーブと同じ時刻の単位（曲では拍、効果音では秒）→ サンプル位置 */
function sampleAt(ctx, t) {
  const u = ctx.timeAt(ctx.sr);
  return Math.round(u > 0 ? (t * ctx.sr) / u : t * ctx.sr);
}

/** LFO の形（ph は周、戻り値 -1〜1）：sine / tri / saw（下降）/ ramp（上昇）/ square */
function lfoWave(shape, ph) {
  const p = ph - Math.floor(ph);
  switch (shape) {
    case 'tri': return p < 0.5 ? 4 * p - 1 : 3 - 4 * p;
    case 'saw': return 1 - 2 * p;
    case 'ramp': return 2 * p - 1;
    case 'square': return p < 0.5 ? 1 : -1;
    default: return Math.sin(TAU * p);
  }
}

/** NaN・無限大・異常に大きな値を 0 にする（1 サンプルでも混ざるとミックス全体が壊れるため） */
function sanitize(L, R) {
  for (let i = 0; i < L.length; i++) {
    if (!(L[i] > -1e3 && L[i] < 1e3)) L[i] = 0;
    if (!(R[i] > -1e3 && R[i] < 1e3)) R[i] = 0;
  }
}

/* リバーブの種類（mode）ごとの既定値。個別のパラメーターを書けばそちらが優先される */
export const REVERB_MODES = {
  room: { label: 'ルーム', size: 0.5, decay: 0.7, damp: 8000, predelay: 0.004, early: 0.7, lowcut: 150, highcut: 13000 },
  hall: { label: 'ホール', size: 1.5, decay: 2.8, damp: 6000, predelay: 0.028, early: 0.3 },
  plate: { label: 'プレート', size: 0.75, decay: 1.8, damp: 11000, predelay: 0, early: 0, lowcut: 220, highcut: 15000, diffusion: 0.72, mod: 2 },
  cathedral: { label: '大聖堂', size: 2.3, decay: 6.5, damp: 4200, predelay: 0.055, early: 0.2, lowcut: 120, highcut: 9000 },
  spring: { label: 'スプリング', size: 0.45, decay: 1.6, damp: 4500, predelay: 0, early: 0, lowcut: 250, highcut: 5500, diffusion: 0.7, spring: 1 },
};

/**
 * リバーブの本体（8 本の遅延線によるフィードバック・ディレイ・ネットワーク）。
 * step(x) で 1 サンプル進め、l / r に響きだけ（ウェット）が入る。reverb と shimmer で共有する。
 */
function verbCore(sr, s) {
  const size = clamp(s.size ?? 1, 0.2, 2.5);
  const decay = Math.max(0.1, s.decay ?? 2);
  const early = s.early ?? 0.3;
  const dif = clamp(s.diffusion ?? 0.6, 0, 0.85);
  const mod = s.mod ?? 1;
  const pre = new Delay(Math.ceil(sr * 0.5));
  const preS = Math.round(clamp(s.predelay ?? 0.02, 0, 0.45) * sr);
  // 入力を拡散するオールパス
  const apLens = [142, 107, 379, 277].map((n) => Math.round((n * sr * size) / 44100) | 1);
  const aps = apLens.map((n) => ({ d: new Delay(n + 2), n }));
  const lineMs = [29.7, 37.1, 41.1, 43.7, 53.3, 59.9, 67.7, 73.1];
  const lines = lineMs.map((ms, k) => {
    const n = Math.round((ms / 1000) * sr * size);
    return {
      d: new Delay(n + 64), n,
      g: Math.pow(10, (-3 * n) / (decay * sr)),
      lp: new OnePole(sr, s.damp ?? 6000),
      modDepth: k % 3 === 0 ? 0.0006 * sr * mod : 0,
      modRate: 0.3 + k * 0.17,
      ph: k * 1.3,
    };
  });
  // 初期反射のタップ（ms, 左右のゲイン）
  const taps = [[7.1, 0.8, 0.5], [11.3, 0.5, 0.75], [17.9, 0.6, 0.4], [23.5, 0.35, 0.55], [31.7, 0.4, 0.3], [41.3, 0.25, 0.35]]
    .map(([ms, gl, gr]) => [Math.round((ms / 1000) * sr * size) + preS, gl, gr]);
  // スプリング：伸ばしたオールパスを何段も通して高い音ほど遅らせる（「ピチョン」という揺れ）
  const K = Math.max(2, Math.round((6 * sr) / 48000));
  const springs = s.spring ? Array.from({ length: Math.round(28 * s.spring) }, () => ({ x: new Float32Array(K), y: new Float32Array(K) })) : null;
  let sp = 0;
  const N = lines.length;
  const outs = new Float64Array(N);
  const core = {
    l: 0, r: 0,
    /** 入力と出力の音量比のめやす（ノイズを入れ続けたときの実効値）。shimmer の戻し量を決めるのに使う */
    gain: (() => {
      let g2 = 0;
      for (const ln of lines) g2 += ln.g * ln.g;
      g2 /= N;
      return Math.sqrt((0.0077 * N * g2) / Math.max(1e-3, 1 - g2));
    })(),
    step(x0) {
      let x = x0;
      pre.write(x);
      let erl = 0, err = 0;
      for (const [d, gl, gr] of taps) { const v = pre.readInt(d); erl += v * gl; err += v * gr; }
      x = pre.readInt(preS);
      if (springs) {
        for (const a of springs) {
          const y = 0.62 * x + a.x[sp] - 0.62 * a.y[sp];
          a.x[sp] = x; a.y[sp] = y;
          x = y;
        }
        sp = (sp + 1) % K;
      }
      for (const ap of aps) {
        const dv = ap.d.readInt(ap.n - 1);
        const y = -dif * x + dv;
        ap.d.write(x + dif * y);
        x = y;
      }
      let sum = 0;
      for (let k = 0; k < N; k++) {
        const ln = lines[k];
        let d = ln.n;
        if (ln.modDepth) { ln.ph += (TAU * ln.modRate) / sr; d += ln.modDepth * (1 + Math.sin(ln.ph)); }
        outs[k] = ln.lp.next(ln.d.read(d)) * ln.g;
        sum += outs[k];
      }
      // ハウスホルダー行列で混ぜて戻す
      const h = (2 / N) * sum;
      let wl = 0, wr = 0;
      for (let k = 0; k < N; k++) {
        lines[k].d.write(outs[k] - h + x * 0.35);
        if (k & 1) wr += outs[k]; else wl += outs[k];
      }
      core.l = wl * 0.5 + erl * early * 0.5;
      core.r = wr * 0.5 + err * early * 0.5;
    },
  };
  return core;
}

export const FX_TYPES = {
  eq: { label: 'イコライザー' },
  comp: { label: 'コンプレッサー' },
  reverb: { label: 'リバーブ' },
  delay: { label: 'ディレイ' },
  chorus: { label: 'コーラス' },
  dist: { label: '歪み' },
  filter: { label: 'フィルター' },
  widen: { label: 'ステレオ幅' },
  tremolo: { label: 'トレモロ' },
  pump: { label: 'ポンピング' },
  transient: { label: 'トランジェント' },
  lofi: { label: 'ローファイ' },
  crush: { label: 'ビットクラッシュ' },
  gain: { label: '音量' },
  limiter: { label: 'リミッター' },
  phaser: { label: 'フェイザー' },
  flanger: { label: 'フランジャー' },
  vibrato: { label: 'ビブラート' },
  autopan: { label: 'オートパン' },
  autofilter: { label: 'オートフィルター（ワウ）' },
  ringmod: { label: 'リングモジュレーター' },
  exciter: { label: 'エキサイター（こもり解消）' },
  multiband: { label: 'マルチバンドコンプ' },
  shimmer: { label: 'シマーリバーブ' },
  gate: { label: 'トランスゲート' },
  stutter: { label: 'スタッター（くり返し）' },
  tapestop: { label: 'テープストップ' },
};

/**
 * エフェクトを作る。
 * ctx = { sr, bpm, timeAt(i) → カーブの時刻, sidechain(id) → [L,R] | null }
 */
export function createFx(spec, ctx) {
  const f = MAKERS[spec.type];
  if (!f) throw new Error(`不明なエフェクト: ${spec.type}`);
  return f(spec, ctx);
}

/** エフェクトの列を順にかける */
export function applyChain(chain, L, R, ctx) {
  for (const spec of chain || []) {
    if (!spec || spec.off) continue;
    createFx(spec, ctx).process(L, R);
    sanitize(L, R);
  }
}

/** ドライとウェットを混ぜる（mix は関数） */
function mixInto(L, R, wl, wr, mix, i) {
  const m = mix(i);
  L[i] = L[i] * (1 - m) + wl * m;
  R[i] = R[i] * (1 - m) + wr * m;
}

const MAKERS = {
  /* イコライザー：bands = [{type:'hp'|'lp'|'peak'|'lowshelf'|'highshelf'|'notch', freq, gain, q}] */
  eq(s, ctx) {
    const bands = (s.bands || []).map((b) => [new Biquad(ctx.sr, b.type || 'peak', b.freq || 1000, b.gain || 0, b.q || 0.707), new Biquad(ctx.sr, b.type || 'peak', b.freq || 1000, b.gain || 0, b.q || 0.707), b]);
    return {
      process(L, R) {
        for (const [fl, fr, b] of bands) {
          // 急なカット（slope 24）は2段重ねる
          const steep = b.slope === 24 && (b.type === 'hp' || b.type === 'lp');
          const fl2 = steep && new Biquad(ctx.sr, b.type, b.freq, 0, b.q || 0.707);
          const fr2 = steep && new Biquad(ctx.sr, b.type, b.freq, 0, b.q || 0.707);
          for (let i = 0; i < L.length; i++) {
            let l = fl.next(L[i]), r = fr.next(R[i]);
            if (steep) { l = fl2.next(l); r = fr2.next(r); }
            L[i] = l; R[i] = r;
          }
        }
      },
    };
  },

  /* コンプレッサー：threshold(dB) ratio attack(秒) release(秒) knee(dB) makeup(dB) sidechain(トラックID) mix */
  comp(s, ctx) {
    const th = s.threshold ?? -18, ratio = Math.max(1, s.ratio ?? 4), knee = s.knee ?? 6;
    const at = Math.exp(-1 / (Math.max(0.0001, s.attack ?? 0.01) * ctx.sr));
    const rt = Math.exp(-1 / (Math.max(0.001, s.release ?? 0.15) * ctx.sr));
    const makeup = dbToGain(s.makeup ?? 0);
    const mix = param(ctx, s.mix, 1);
    const sc = s.sidechain ? ctx.sidechain?.(s.sidechain) : null;
    return {
      process(L, R) {
        let env = 0; // ゲインリダクション（dB, 正の値）
        for (let i = 0; i < L.length; i++) {
          const kl = sc ? sc[0][i] || 0 : L[i], kr = sc ? sc[1][i] || 0 : R[i];
          const lvl = Math.max(Math.abs(kl), Math.abs(kr));
          const db = lvl > 1e-6 ? 20 * Math.log10(lvl) : -120;
          const over = db - th;
          let gr;
          if (over <= -knee / 2) gr = 0;
          else if (over >= knee / 2) gr = over * (1 - 1 / ratio);
          else { const x = over + knee / 2; gr = ((1 - 1 / ratio) * x * x) / (2 * knee); }
          env = gr > env ? at * env + (1 - at) * gr : rt * env + (1 - rt) * gr;
          const g = dbToGain(-env) * makeup;
          const m = mix(i);
          L[i] = L[i] * (1 - m + m * g);
          R[i] = R[i] * (1 - m + m * g);
        }
      },
    };
  },

  /* リバーブ（8本の遅延線によるフィードバック・ディレイ・ネットワーク）
     mode(room/hall/plate/cathedral/spring：下の値の既定をまとめて決める)
     size(0.3〜2) decay(秒) damp(Hz, 響きの高域の減衰) predelay(秒) mix lowcut highcut width early(初期反射) */
  reverb(s0, ctx) {
    const sr = ctx.sr;
    const s = s0.mode && REVERB_MODES[s0.mode] ? { ...REVERB_MODES[s0.mode], ...s0 } : s0;
    const mix = param(ctx, s.mix, 0.25);
    const width = clamp(s.width ?? 1, 0, 1.5);
    const core = verbCore(sr, s);
    const lc = s.lowcut ?? 180, hc = s.highcut ?? 12000;
    const fl = [new Biquad(sr, 'hp', lc, 0, 0.6), new Biquad(sr, 'lp', hc, 0, 0.6)];
    const fr = [new Biquad(sr, 'hp', lc, 0, 0.6), new Biquad(sr, 'lp', hc, 0, 0.6)];
    return {
      process(L, R) {
        const n = L.length;
        for (let i = 0; i < n; i++) {
          core.step((L[i] + R[i]) * 0.5);
          let wl = core.l, wr = core.r;
          // 幅（中央と左右の差）
          const mid = (wl + wr) * 0.5, side = (wl - wr) * 0.5 * width;
          wl = fl[1].next(fl[0].next(mid + side));
          wr = fr[1].next(fr[0].next(mid - side));
          mixInto(L, R, wl, wr, mix, i);
        }
      },
    };
  },

  /* ディレイ：time（秒 または "1/8d"）feedback mix pingpong tone(Hz) lowcut */
  delay(s, ctx) {
    const sr = ctx.sr;
    const t = timeSec(ctx, s.time, '1/8d');
    const tr = timeSec(ctx, s.timeR ?? s.time, '1/8d');
    const fb = clamp(s.feedback ?? 0.35, 0, 0.95);
    const mix = param(ctx, s.mix, 0.25);
    const dl = new Delay(Math.ceil(sr * Math.max(t, tr)) + 64), dr = new Delay(Math.ceil(sr * Math.max(t, tr)) + 64);
    const nl = t * sr, nr = tr * sr;
    const tl = new OnePole(sr, s.tone ?? 5000), tR = new OnePole(sr, s.tone ?? 5000);
    const hl = new Biquad(sr, 'hp', s.lowcut ?? 150), hr = new Biquad(sr, 'hp', s.lowcut ?? 150);
    const ping = !!s.pingpong;
    return {
      process(L, R) {
        let ph = 0;
        for (let i = 0; i < L.length; i++) {
          ph += (TAU * 0.4) / sr;
          const wob = Math.sin(ph) * 0.0004 * sr;
          const yl = tl.next(dl.read(nl - 1 + wob)), yr = tR.next(dr.read(nr - 1 - wob));
          if (ping) {
            dl.write(hl.next((L[i] + R[i]) * 0.5 + yr * fb));
            dr.write(hr.next(yl * fb));
          } else {
            dl.write(hl.next(L[i] + yl * fb));
            dr.write(hr.next(R[i] + yr * fb));
          }
          mixInto(L, R, yl, yr, mix, i);
        }
      },
    };
  },

  /* コーラス：rate depth(秒) mix */
  chorus(s, ctx) {
    const sr = ctx.sr;
    const rate = s.rate ?? 0.6, depth = (s.depth ?? 0.004) * sr, base = (s.delay ?? 0.012) * sr;
    const mix = param(ctx, s.mix, 0.5);
    const dl = new Delay(Math.ceil(base + depth * 2 + 8)), dr = new Delay(Math.ceil(base + depth * 2 + 8));
    return {
      process(L, R) {
        let ph = 0;
        const inc = (TAU * rate) / sr;
        for (let i = 0; i < L.length; i++) {
          dl.write(L[i]); dr.write(R[i]);
          ph += inc;
          const a = base + depth * (1 + Math.sin(ph)), b = base + depth * (1 + Math.sin(ph + Math.PI / 2));
          const c = base + depth * (1 + Math.sin(ph + Math.PI)), d = base + depth * (1 + Math.sin(ph + (3 * Math.PI) / 2));
          const wl = (dl.read(a) + dr.read(c)) * 0.5, wr = (dr.read(b) + dl.read(d)) * 0.5;
          mixInto(L, R, wl, wr, mix, i);
        }
      },
    };
  },

  /* 歪み：drive(dB) kind('soft'|'tape'|'hard'|'fold') tone(Hz) mix out(dB)。2倍オーバーサンプリング */
  dist(s, ctx) {
    const sr = ctx.sr;
    const drive = param(ctx, s.drive, 12);
    const mix = param(ctx, s.mix, 1);
    const out = dbToGain(s.out ?? 0);
    const kind = s.kind || 'soft';
    const shape = (x) => {
      switch (kind) {
        case 'hard': return clamp(x, -1, 1);
        case 'fold': { let y = x; for (let k = 0; k < 4 && (y > 1 || y < -1); k++) y = y > 1 ? 2 - y : -2 - y; return y; }
        case 'tape': return softClip(x + 0.15 * x * x) - softClip(0.15 * 0) ;
        default: return softClip(x);
      }
    };
    const aa = [0, 1].map(() => [new Biquad(sr * 2, 'lp', sr * 0.45, 0, 0.54), new Biquad(sr * 2, 'lp', sr * 0.45, 0, 1.31)]);
    const tone = [new Biquad(sr, 'lp', s.tone ?? 12000), new Biquad(sr, 'lp', s.tone ?? 12000)];
    const dc = [new DCBlock(), new DCBlock()];
    const prev = [0, 0];
    return {
      process(L, R) {
        const chs = [L, R];
        for (let i = 0; i < L.length; i++) {
          const g = dbToGain(drive(i));
          const comp = 1 / Math.max(1, Math.sqrt(g)); // 歪ませても大きくなりすぎないように
          const m = mix(i);
          for (let c = 0; c < 2; c++) {
            const x = chs[c][i];
            const mid = (x + prev[c]) * 0.5; // 2倍に補間
            prev[c] = x;
            const [f1, f2] = aa[c];
            f2.next(f1.next(shape(mid * g)));
            const y = f2.next(f1.next(shape(x * g)));
            const w = tone[c].next(dc[c].next(y)) * comp * out;
            chs[c][i] = x * (1 - m) + w * m;
          }
        }
      },
    };
  },

  /* フィルター：kind('lp'|'hp'|'bp') freq(Hz またはカーブ) q mix。曲中のフィルタースイープに */
  filter(s, ctx) {
    const freq = param(ctx, s.freq, 1000, 'exp');
    const q = param(ctx, s.q, 0.9);
    const mix = param(ctx, s.mix, 1);
    const kind = s.kind || 'lp';
    const poles = s.poles === 4 ? 2 : 1;
    const fs = [0, 1].map(() => Array.from({ length: poles }, () => new SVF(ctx.sr, kind)));
    return {
      process(L, R) {
        for (let i = 0; i < L.length; i++) {
          if (i % BLOCK === 0) { const f = freq(i), qq = q(i); for (const ch of fs) for (const x of ch) x.set(f, qq); }
          let l = L[i], r = R[i];
          for (const x of fs[0]) l = x.next(l);
          for (const x of fs[1]) r = x.next(r);
          mixInto(L, R, l, r, mix, i);
        }
      },
    };
  },

  /* ステレオ幅：amount（0=モノラル 1=そのまま 2=広い）。lowmono(Hz) より下はモノラルにして低音を安定させる */
  widen(s, ctx) {
    const amt = param(ctx, s.amount, 1.4);
    const lm = s.lowmono ?? 0;
    const sl = lm ? new Biquad(ctx.sr, 'hp', lm, 0, 0.707) : null;
    return {
      process(L, R) {
        for (let i = 0; i < L.length; i++) {
          const m = (L[i] + R[i]) * 0.5;
          let sd = ((L[i] - R[i]) * 0.5) * amt(i);
          if (sl) sd = sl.next(sd);
          L[i] = m + sd; R[i] = m - sd;
        }
      },
    };
  },

  /* トレモロ：rate（Hz または "1/8"）depth stereo(左右の位相ずれ 0〜1) */
  tremolo(s, ctx) {
    const rate = typeof s.rate === 'string' ? 1 / timeSec(ctx, s.rate) : s.rate ?? 5;
    const depth = param(ctx, s.depth, 0.5);
    const st = (s.stereo ?? 0) * Math.PI;
    return {
      process(L, R) {
        for (let i = 0; i < L.length; i++) {
          const ph = (TAU * rate * i) / ctx.sr, d = depth(i);
          L[i] *= 1 - d * 0.5 * (1 + Math.sin(ph));
          R[i] *= 1 - d * 0.5 * (1 + Math.sin(ph + st));
        }
      },
    };
  },

  /* ポンピング（キックに合わせて音量が沈む、EDM のサイドチェイン風）：amount rate("1/4") release(拍の割合) */
  pump(s, ctx) {
    const period = timeSec(ctx, s.rate, '1/4') * ctx.sr;
    const amount = param(ctx, s.amount, 0.6);
    const rel = clamp(s.release ?? 0.6, 0.05, 1);
    const offset = (s.offset ?? 0) * period;
    const atk = 0.004 * ctx.sr;
    return {
      process(L, R) {
        for (let i = 0; i < L.length; i++) {
          const p = (((i + (ctx.start || 0) - offset) % period) + period) % period;
          let e;
          if (p < atk) e = p / atk;
          else { const u = Math.min(1, (p - atk) / (period * rel)); e = 1 - u * u * (3 - 2 * u); }
          const g = 1 - amount(i) * e;
          L[i] *= g; R[i] *= g;
        }
      },
    };
  },

  /* トランジェント：attack(dB) sustain(dB)。音の立ち上がりと余韻を別々に強める/弱める */
  transient(s, ctx) {
    const sr = ctx.sr;
    const fa = Math.exp(-1 / (0.0015 * sr)), sa = Math.exp(-1 / (0.025 * sr));
    const rel = Math.exp(-1 / (0.12 * sr));
    const ga = s.attack ?? 4, gs = s.sustain ?? 0;
    return {
      process(L, R) {
        let fast = 0, slow = 0;
        for (let i = 0; i < L.length; i++) {
          const x = Math.max(Math.abs(L[i]), Math.abs(R[i]));
          fast = x > fast ? fa * fast + (1 - fa) * x : rel * fast + (1 - rel) * x;
          slow = x > slow ? sa * slow + (1 - sa) * x : rel * slow + (1 - rel) * x;
          const diff = clamp((fast - slow) / (slow + 1e-4), 0, 1); // 立ち上がりのとき 1 に近い
          const g = dbToGain(ga * diff + gs * (1 - diff));
          L[i] *= g; R[i] *= g;
        }
      },
    };
  },

  /* ローファイ：wow(揺れ) noise(ヒス) crackle(レコードのプチ) tone(Hz) mix */
  lofi(s, ctx) {
    const sr = ctx.sr;
    const wow = (s.wow ?? 0.4) * 0.0025 * sr, flutter = (s.wow ?? 0.4) * 0.0003 * sr;
    const noiseAmt = (s.noise ?? 0.3) * 0.01, crackle = s.crackle ?? 0.3;
    const dl = new Delay(Math.ceil(wow * 2 + flutter * 2 + 16)), dr = new Delay(Math.ceil(wow * 2 + flutter * 2 + 16));
    const tl = new Biquad(sr, 'lp', s.tone ?? 5500, 0, 0.6), tr = new Biquad(sr, 'lp', s.tone ?? 5500, 0, 0.6);
    const hl = new Biquad(sr, 'hp', 60), hr = new Biquad(sr, 'hp', 60);
    const nz = new Noise('pink', 7), r = rng(11);
    const mix = param(ctx, s.mix, 1);
    let cr = 0, crl = 0;
    return {
      process(L, R) {
        for (let i = 0; i < L.length; i++) {
          dl.write(L[i]); dr.write(R[i]);
          const t = i / sr;
          const d = wow * (1 + Math.sin(TAU * 0.55 * t)) + flutter * (1 + Math.sin(TAU * 7.3 * t)) + 4;
          if (r() < crackle * 0.0004) cr = (r() - 0.5) * 0.5;
          cr *= 0.82; // 数サンプルで減衰する粒（1サンプルの針より耳に痛くない）
          crl = crl + 0.35 * (cr - crl);
          let n = nz.next() * noiseAmt + crl;
          const wl = softClip(tl.next(hl.next(dl.read(d))) * 1.2) / 1.1 + n;
          const wr = softClip(tr.next(hr.next(dr.read(d))) * 1.2) / 1.1 + n;
          mixInto(L, R, wl, wr, mix, i);
        }
      },
    };
  },

  /* ビットクラッシュ：bits rate(何サンプルごとに間引くか) mix */
  crush(s, ctx) {
    const steps = Math.pow(2, clamp(s.bits ?? 8, 1, 16) - 1);
    const hold = Math.max(1, Math.round(s.rate ?? 4));
    const mix = param(ctx, s.mix, 1);
    return {
      process(L, R) {
        let hl = 0, hr = 0;
        for (let i = 0; i < L.length; i++) {
          if (i % hold === 0) { hl = Math.round(L[i] * steps) / steps; hr = Math.round(R[i] * steps) / steps; }
          mixInto(L, R, hl, hr, mix, i);
        }
      },
    };
  },

  /* フェイザー：rate（Hz または "1/2"）depth(0〜1) freq(中心 Hz) feedback stages(2〜12) stereo(左右の位相ずれ 0〜1) mix */
  phaser(s, ctx) {
    const sr = ctx.sr;
    const rate = rateHz(ctx, s.rate, 0.4);
    const depth = param(ctx, s.depth, 0.7);
    const freq = param(ctx, s.freq, 800, 'exp');
    const fb = clamp(s.feedback ?? 0.5, -0.95, 0.95);
    const stages = clamp(Math.round(s.stages ?? 6), 2, 12);
    const mix = param(ctx, s.mix, 0.5);
    const st = (s.stereo ?? 0.25) * 0.5;
    const shape = s.shape || 'sine';
    const zx = [new Float64Array(stages), new Float64Array(stages)], zy = [new Float64Array(stages), new Float64Array(stages)];
    const last = [0, 0], a = [0, 0];
    return {
      process(L, R) {
        const chs = [L, R], t0 = ctx.start || 0;
        for (let i = 0; i < L.length; i++) {
          if (i % 8 === 0) {
            const ph = ((i + t0) / sr) * rate, f = freq(i), d = depth(i);
            for (let c = 0; c < 2; c++) {
              // オールパスの折れ点を中心から上下 2 オクターブまで動かす
              const w = Math.tan((Math.PI * clamp(f * Math.pow(2, 2 * d * lfoWave(shape, ph + c * st)), 30, sr * 0.45)) / sr);
              a[c] = (w - 1) / (w + 1);
            }
          }
          const m = mix(i), nrm = 1 / Math.sqrt((1 - m) * (1 - m) + m * m); // 混ぜても音量が下がらないように
          for (let c = 0; c < 2; c++) {
            const x = chs[c][i];
            let y = x + last[c] * fb;
            const X = zx[c], Y = zy[c], ac = a[c];
            for (let k = 0; k < stages; k++) { const o = ac * y + X[k] - ac * Y[k]; X[k] = y; Y[k] = o; y = o; }
            last[c] = y;
            chs[c][i] = (x * (1 - m) + y * m) * nrm;
          }
        }
      },
    };
  },

  /* フランジャー：rate（Hz または音価）depth(0〜1) delay(秒, 中心) feedback(-0.95〜0.95) stereo mix */
  flanger(s, ctx) {
    const sr = ctx.sr;
    const rate = rateHz(ctx, s.rate, 0.25);
    const depth = param(ctx, s.depth, 0.7);
    const base = clamp(s.delay ?? 0.003, 0.0005, 0.02) * sr;
    const fb = clamp(s.feedback ?? 0.5, -0.95, 0.95);
    const mix = param(ctx, s.mix, 0.5);
    const st = (s.stereo ?? 0.25) * 0.5;
    const shape = s.shape || 'sine';
    const d = [new Delay(Math.ceil(base * 2 + 16)), new Delay(Math.ceil(base * 2 + 16))];
    return {
      process(L, R) {
        const chs = [L, R], t0 = ctx.start || 0;
        for (let i = 0; i < L.length; i++) {
          const ph = ((i + t0) / sr) * rate, dp = depth(i), m = mix(i);
          const nrm = 1 / Math.sqrt((1 - m) * (1 - m) + m * m);
          for (let c = 0; c < 2; c++) {
            const x = chs[c][i];
            const y = d[c].read(Math.max(1, base * (1 + 0.95 * dp * lfoWave(shape, ph + c * st))));
            d[c].write(x + y * fb);
            chs[c][i] = (x * (1 - m) + y * m) * nrm;
          }
        }
      },
    };
  },

  /* ビブラート（音程の揺れ）：rate（Hz または音価）depth(半音) mix */
  vibrato(s, ctx) {
    const sr = ctx.sr;
    const rate = Math.max(0.05, rateHz(ctx, s.rate, 5.5));
    const depth = param(ctx, s.depth, 0.3);
    const mix = param(ctx, s.mix, 1);
    // 遅延を A·sin で揺らすと、音程は A·2π·rate の割合で上下する
    const amp = (semi) => ((Math.pow(2, semi / 12) - 1) / (TAU * rate)) * sr;
    const maxA = amp(2.5);
    const d = [new Delay(Math.ceil(maxA * 2 + 16)), new Delay(Math.ceil(maxA * 2 + 16))];
    return {
      process(L, R) {
        const t0 = ctx.start || 0;
        for (let i = 0; i < L.length; i++) {
          d[0].write(L[i]); d[1].write(R[i]);
          const A = Math.min(maxA, amp(clamp(depth(i), 0, 2.5)));
          const dl = maxA + 2 + A * Math.sin((TAU * rate * (i + t0)) / sr);
          mixInto(L, R, d[0].read(dl), d[1].read(dl), mix, i);
        }
      },
    };
  },

  /* オートパン（左右に動く）：rate（Hz または "1/4"）depth(0〜1) shape(sine/tri/square) */
  autopan(s, ctx) {
    const sr = ctx.sr;
    const rate = rateHz(ctx, s.rate, '1/2');
    const depth = param(ctx, s.depth, 0.8);
    const shape = s.shape || 'sine';
    const phase = s.phase ?? 0;
    const sm = new OnePole(sr, 60); // 矩形でもプチッと言わないように
    return {
      process(L, R) {
        const t0 = ctx.start || 0;
        for (let i = 0; i < L.length; i++) {
          const p = sm.next(lfoWave(shape, ((i + t0) / sr) * rate + phase)) * clamp(depth(i), 0, 1);
          const a = ((p + 1) * Math.PI) / 4;
          L[i] *= Math.cos(a) * Math.SQRT2;
          R[i] *= Math.sin(a) * Math.SQRT2;
        }
      },
    };
  },

  /* オートフィルター：mode('lfo' 周期で動く / 'env' 音量に合わせて開く＝ワウ)
     kind(lp/bp/hp) freq(いちばん閉じたとき Hz) range(動く幅, オクターブ) rate q sens(dB, env の感度) attack release mix */
  autofilter(s, ctx) {
    const sr = ctx.sr;
    const mode = s.mode || 'lfo';
    const rate = rateHz(ctx, s.rate, '1/4');
    const freq = param(ctx, s.freq, 300, 'exp');
    const range = param(ctx, s.range, 3.5);
    const q = param(ctx, s.q, 3);
    const mix = param(ctx, s.mix, 1);
    const sens = dbToGain(s.sens ?? 12);
    const at = Math.exp(-1 / (Math.max(0.0005, s.attack ?? 0.008) * sr)), rl = Math.exp(-1 / (Math.max(0.005, s.release ?? 0.12) * sr));
    const shape = s.shape || 'sine';
    const poles = s.poles === 4 ? 2 : 1;
    const fs = [0, 1].map(() => Array.from({ length: poles }, () => new SVF(sr, s.kind || 'lp')));
    return {
      process(L, R) {
        let env = 0;
        const t0 = ctx.start || 0;
        for (let i = 0; i < L.length; i++) {
          const lv = Math.max(Math.abs(L[i]), Math.abs(R[i]));
          env = lv > env ? at * env + (1 - at) * lv : rl * env + (1 - rl) * lv;
          if (i % 8 === 0) {
            const u = mode === 'env' ? clamp(env * sens, 0, 1) : 0.5 + 0.5 * lfoWave(shape, ((i + t0) / sr) * rate + (s.phase ?? 0));
            const f = freq(i) * Math.pow(2, range(i) * u), qq = q(i);
            for (const ch of fs) for (const x of ch) x.set(f, qq);
          }
          let l = L[i], r = R[i];
          for (const x of fs[0]) l = x.next(l);
          for (const x of fs[1]) r = x.next(r);
          mixInto(L, R, l, r, mix, i);
        }
      },
    };
  },

  /* リングモジュレーター（金属的・ロボット声）：freq(Hz またはカーブ) mix */
  ringmod(s, ctx) {
    const freq = param(ctx, s.freq, 440, 'exp');
    const mix = param(ctx, s.mix, 1);
    return {
      process(L, R) {
        let ph = 0;
        for (let i = 0; i < L.length; i++) {
          ph += freq(i) / ctx.sr;
          if (ph >= 1) ph -= 1;
          const c = Math.sin(TAU * ph);
          mixInto(L, R, L[i] * c, R[i] * c, mix, i);
        }
      },
    };
  },

  /* エキサイター：こもった音に高い倍音を足す。amount(0〜1) freq(足す帯域の下限 Hz) drive(dB)
     中域（freq/3〜freq×2）を取り出して歪ませ、できた倍音のうち freq より上だけを足す。
     元の音量に合わせて働くので、小さな音にも同じように効く */
  exciter(s, ctx) {
    const sr = ctx.sr;
    const f = clamp(s.freq ?? 3000, 800, 9000);
    const k = dbToGain(clamp(s.drive ?? 9, 0, 30));
    const amount = param(ctx, s.amount, 0.4);
    const mk = () => ({ a: new Biquad(sr, 'hp', f / 3, 0, 0.707), b: new Biquad(sr, 'lp', Math.min(sr * 0.2, f * 2), 0, 0.707), c: new Biquad(sr, 'hp', f, 0, 0.707), d: new Biquad(sr, 'hp', f, 0, 0.707), e: new Biquad(sr, 'lp', Math.min(sr * 0.42, 17000), 0, 0.707) });
    const ch = [mk(), mk()];
    const at = Math.exp(-1 / (0.001 * sr)), rl = Math.exp(-1 / (0.06 * sr));
    return {
      process(L, R) {
        let env = 0;
        for (let i = 0; i < L.length; i++) {
          const bl = ch[0].b.next(ch[0].a.next(L[i])), br = ch[1].b.next(ch[1].a.next(R[i]));
          const lv = Math.max(Math.abs(bl), Math.abs(br));
          env = lv > env ? at * env + (1 - at) * lv : rl * env + (1 - rl) * lv;
          const g = 1 / (env + 1e-5), a = amount(i) * env * 1.5;
          // 非対称に歪ませて偶数・奇数の両方の倍音を作る
          const ul = bl * g, ur = br * g;
          const hl = softClip(k * (ul + 0.4 * ul * ul)), hr = softClip(k * (ur + 0.4 * ur * ur));
          L[i] += ch[0].e.next(ch[0].d.next(ch[0].c.next(hl))) * a;
          R[i] += ch[1].e.next(ch[1].d.next(ch[1].c.next(hr))) * a;
        }
      },
    };
  },

  /* マルチバンドコンプ（低・中・高の 3 帯域を別々に圧縮）：
     low high(分け目 Hz) threshold(dB) ratio attack release(倍率) makeup(dB, 省略で自動) gains([低,中,高] dB) mix
     bands: [{ threshold, ratio, attack, release, gain }] で帯域ごとに上書き */
  multiband(s, ctx) {
    const sr = ctx.sr;
    const f1 = clamp(s.low ?? 200, 40, 1000), f2 = clamp(s.high ?? 2500, f1 * 1.5, 12000);
    const mix = param(ctx, s.mix, 1);
    const th0 = s.threshold ?? -24, ra0 = Math.max(1, s.ratio ?? 3);
    const defs = [[0.003, 0.16], [0.0015, 0.1], [0.0008, 0.06]];
    const bands = [0, 1, 2].map((k) => {
      const b = s.bands?.[k] || {};
      const th = b.threshold ?? th0, ratio = Math.max(1, b.ratio ?? ra0);
      return {
        th, slope: 1 - 1 / ratio, knee: 6,
        at: Math.exp(-1 / (Math.max(0.0002, (b.attack ?? defs[k][0]) * (s.attack ?? 1)) * sr)),
        rt: Math.exp(-1 / (Math.max(0.002, (b.release ?? defs[k][1]) * (s.release ?? 1)) * sr)),
        // 自動の持ち上げ：しきい値より上で圧縮される分の半分ほどを戻す
        g: dbToGain((b.gain ?? s.gains?.[k] ?? 0) + (s.makeup ?? -th * (1 - 1 / ratio) * 0.4)),
        env: 0,
      };
    });
    // リンクウィッツ・ライリー（24dB/oct）で分ける。低域には上の分け目と同じ位相回りを通して、足すと元に戻るようにする
    const lr = (type, f) => [new Biquad(sr, type, f, 0, Math.SQRT1_2), new Biquad(sr, type, f, 0, Math.SQRT1_2)];
    const mk = () => ({ lo: lr('lp', f1), hi: lr('hp', f1), mid: lr('lp', f2), top: lr('hp', f2), cl: lr('lp', f2), ch: lr('hp', f2) });
    const X = [mk(), mk()];
    const two = (f, x) => f[1].next(f[0].next(x));
    const v = [new Float64Array(3), new Float64Array(3)];
    // 先読み：音量を測るのは今の音、ゲインをかけるのは少し前の音（立ち上がりが飛び出さない。曲の中での遅れは出ない）
    const la = Math.max(1, Math.round(clamp(s.lookahead ?? 0.004, 0, 0.02) * sr));
    const hist = [0, 1].map(() => [0, 1, 2].map(() => new Float32Array(la)));
    return {
      process(L, R) {
        const n = L.length;
        for (let i = 0; i < n + la; i++) {
          for (let c = 0; c < 2; c++) {
            const x = i < n ? (c ? R[i] : L[i]) : 0, F = X[c];
            const lo = two(F.lo, x), rest = two(F.hi, x);
            v[c][0] = two(F.cl, lo) + two(F.ch, lo);
            v[c][1] = two(F.mid, rest);
            v[c][2] = two(F.top, rest);
          }
          let l = 0, r = 0;
          const h = i % la;
          for (let k = 0; k < 3; k++) {
            const b = bands[k];
            const lvl = Math.max(Math.abs(v[0][k]), Math.abs(v[1][k]));
            const over = (lvl > 1e-6 ? 20 * Math.log10(lvl) : -120) - b.th;
            let gr;
            if (over <= -b.knee / 2) gr = 0;
            else if (over >= b.knee / 2) gr = over * b.slope;
            else { const u = over + b.knee / 2; gr = (b.slope * u * u) / (2 * b.knee); }
            b.env = gr > b.env ? b.at * b.env + (1 - b.at) * gr : b.rt * b.env + (1 - b.rt) * gr;
            const g = dbToGain(-b.env) * b.g;
            l += hist[0][k][h] * g; r += hist[1][k][h] * g;
            hist[0][k][h] = v[0][k]; hist[1][k][h] = v[1][k];
          }
          if (i >= la) mixInto(L, R, l, r, mix, i - la);
        }
      },
    };
  },

  /* シマーリバーブ：響きを 1 オクターブ上にずらして戻し続ける（天上の輝き）。
     mix decay size damp predelay shimmer(戻す量 0〜0.9) pitch(半音, 既定 12) tone(戻す音の高域 Hz) width */
  shimmer(s0, ctx) {
    const sr = ctx.sr;
    const s = { size: 1.6, decay: 4, damp: 7000, predelay: 0.03, early: 0.15, ...(s0.mode && REVERB_MODES[s0.mode] ? REVERB_MODES[s0.mode] : {}), ...s0 };
    const mix = param(ctx, s.mix, 0.35);
    const amt = param(ctx, s.shimmer, 0.5);
    const width = clamp(s.width ?? 1, 0, 1.5);
    const core = verbCore(sr, s);
    // 1 回まわるごとの音量が 1 を超えないように、リバーブ本体の音量比で割る
    const norm = Math.min(3, 1 / Math.max(0.05, core.gain));
    const ratio = Math.pow(2, clamp(s.pitch ?? 12, -12, 24) / 12);
    const W = Math.round(0.085 * sr); // ピッチシフトの窓（2 つの読み出しを交互にフェード）
    const ps = new Delay(W + 8);
    const hp = new Biquad(sr, 'hp', 250, 0, 0.707), lp = new Biquad(sr, 'lp', s.tone ?? 7000, 0, 0.707);
    const lc = s.lowcut ?? 180, hc = s.highcut ?? 13000;
    const fl = [new Biquad(sr, 'hp', lc, 0, 0.6), new Biquad(sr, 'lp', hc, 0, 0.6)];
    const fr = [new Biquad(sr, 'hp', lc, 0, 0.6), new Biquad(sr, 'lp', hc, 0, 0.6)];
    return {
      process(L, R) {
        let fb = 0, ph = 0;
        for (let i = 0; i < L.length; i++) {
          core.step((L[i] + R[i]) * 0.5 + fb);
          let wl = core.l, wr = core.r;
          // 響きを上にずらす（読み出し位置を書き込みより速く進める）
          ps.write((wl + wr) * 0.5);
          ph += (ratio - 1) / W;
          ph -= Math.floor(ph);
          const p2 = ph + 0.5 - Math.floor(ph + 0.5);
          const w1 = Math.sin(Math.PI * ph), w2 = Math.sin(Math.PI * p2);
          const sh = ps.read((1 - ph) * W) * w1 * w1 + ps.read((1 - p2) * W) * w2 * w2;
          fb = softClip(lp.next(hp.next(sh)) * clamp(amt(i), 0, 0.9) * norm);
          if (!(fb > -2 && fb < 2)) fb = 0;
          const mid = (wl + wr) * 0.5, side = (wl - wr) * 0.5 * width;
          wl = fl[1].next(fl[0].next(mid + side));
          wr = fr[1].next(fr[0].next(mid - side));
          mixInto(L, R, wl, wr, mix, i);
        }
      },
    };
  },

  /* トランスゲート（リズムで音を刻む）：pattern("x.x.xx.x"：x 開く / o 半分 / . 閉じる) rate(1 文字の長さ "1/16")
     depth(閉じたときの下げ幅 0〜1) duty(1 文字のうち開いている割合) smooth(秒, 開閉のなめらかさ) mix */
  gate(s, ctx) {
    const sr = ctx.sr;
    const pat = String(s.pattern ?? 'x.x.x.xxx.x.xx.x').replace(/[|\s]/g, '').split('').map((c) => (c === 'X' || c === 'x' ? 1 : c === 'o' ? 0.6 : c === 'g' ? 0.3 : 0));
    if (!pat.length) pat.push(1);
    const step = Math.max(8, timeSec(ctx, s.rate, '1/16') * sr);
    const depth = param(ctx, s.depth, 1);
    const duty = clamp(s.duty ?? 0.8, 0.05, 1);
    const sm = Math.exp(-1 / (clamp(s.smooth ?? 0.004, 0.0005, 0.2) * sr));
    const mix = param(ctx, s.mix, 1);
    const offset = (s.offset ?? 0) * step;
    return {
      process(L, R) {
        let g = pat[0];
        const t0 = (ctx.start || 0) - offset;
        for (let i = 0; i < L.length; i++) {
          const p = (i + t0) / step, k = Math.floor(p);
          const on = p - k < duty ? pat[((k % pat.length) + pat.length) % pat.length] : 0;
          g = on + (g - on) * sm;
          const a = 1 - clamp(depth(i), 0, 1) * (1 - g), m = mix(i);
          L[i] *= 1 - m + m * a;
          R[i] *= 1 - m + m * a;
        }
      },
    };
  },

  /* スタッター（短く切り取ってくり返す）：at(始まる時刻。曲では拍・効果音では秒。配列も可) every(この間隔で毎回かける "4/1")
     length(かかっている長さ "1/2") rate(くり返す 1 片の長さ "1/16") decay(1 回ごとの音量 0〜1) pitch(1 回ごとの半音) mix */
  stutter(s, ctx) {
    const sr = ctx.sr;
    const slice = Math.max(64, Math.round(timeSec(ctx, s.rate, '1/16') * sr));
    const total = Math.max(slice, Math.round(timeSec(ctx, s.length, '1/2') * sr));
    const every = s.every ? Math.max(total, Math.round(timeSec(ctx, s.every) * sr)) : 0;
    const decay = clamp(s.decay ?? 1, 0, 1), semi = s.pitch ?? 0;
    const mix = param(ctx, s.mix, 1);
    const fade = Math.min(slice >> 2, Math.round(0.003 * sr));
    return {
      process(L, R) {
        const n = L.length, sl = L.slice(), sR = R.slice();
        const starts = [];
        for (const a of [].concat(s.at ?? 0)) {
          const i0 = sampleAt(ctx, a) - (ctx.start || 0);
          if (every) for (let p = i0; p < n; p += every) starts.push(p); else starts.push(i0);
        }
        for (const i0 of starts) {
          if (i0 < 0 || i0 >= n) continue;
          const end = Math.min(n, i0 + total);
          for (let i = i0; i < end; i++) {
            const k = Math.floor((i - i0) / slice), j = i - i0 - k * slice;
            const pos = j * Math.pow(2, (k * semi) / 12);
            let wl = 0, wr = 0;
            if (pos < slice - 1 && i0 + pos + 1 < n) {
              const a = i0 + Math.floor(pos), f = pos - Math.floor(pos);
              // 1 片の頭とお尻を数 ms でフェード（1 回目の頭は元の音のまま）
              const e = Math.min(1, k === 0 ? 1 : j / fade, (slice - j) / fade) * Math.pow(decay, k);
              wl = (sl[a] + (sl[a + 1] - sl[a]) * f) * e;
              wr = (sR[a] + (sR[a + 1] - sR[a]) * f) * e;
            }
            // 終わりは元の音へなめらかに戻す
            const m = mix(i) * Math.min(1, (end - i) / (fade * 2 || 1));
            L[i] = sl[i] * (1 - m) + wl * m;
            R[i] = sR[i] * (1 - m) + wr * m;
          }
        }
      },
    };
  },

  /* テープストップ（回転が落ちて音程が下がりながら止まる）：at(始まる時刻。曲では拍・効果音では秒。配列も可)
     time(止まるまでの長さ。秒 または "1/2") hold(止まっている長さ。省略で最後まで無音) curve(落ち方 1=一定) kind('stop' | 'start' 回り始める) */
  tapestop(s, ctx) {
    const sr = ctx.sr;
    const dur = Math.max(64, Math.round(timeSec(ctx, s.time, 0.6) * sr));
    const hold = s.hold != null ? Math.round(timeSec(ctx, s.hold) * sr) : Infinity;
    const cv = clamp(s.curve ?? 1.3, 0.3, 4);
    const start = s.kind === 'start';
    const fade = Math.round(0.005 * sr);
    return {
      process(L, R) {
        const n = L.length, sl = L.slice(), sR = R.slice();
        const rd = (x, p) => { const a = Math.floor(p); return a + 1 < n && a >= 0 ? x[a] + (x[a + 1] - x[a]) * (p - a) : 0; };
        for (const at of [].concat(s.at ?? 0)) {
          const i0 = sampleAt(ctx, at) - (ctx.start || 0);
          if (i0 >= n || i0 + dur < 0) continue;
          const end = i0 + dur;
          for (let i = Math.max(0, i0); i < Math.min(n, end); i++) {
            const u = (i - i0) / dur;
            // 速さ：止まるときは (1-u)^cv、回り始めは u^cv。読み出し位置はその積分
            const sp = start ? Math.pow(u, cv) : Math.pow(1 - u, cv);
            const pos = start ? end - (dur * (1 - Math.pow(u, cv + 1))) / (cv + 1) : i0 + (dur * (1 - Math.pow(1 - u, cv + 1))) / (cv + 1);
            const g = Math.min(1, sp * 6); // 止まりかけは音量も絞る（直流が残らないように）
            L[i] = rd(sl, pos) * g;
            R[i] = rd(sR, pos) * g;
          }
          if (start) continue;
          // 止まっている間は無音、そのあと元の音に戻る
          const back = end + hold;
          for (let i = Math.max(0, end); i < Math.min(n, back + fade); i++) {
            const g = i < back ? 0 : (i - back) / fade;
            L[i] = sl[i] * g; R[i] = sR[i] * g;
          }
        }
      },
    };
  },

  /* 音量：db（数値またはカーブ） */
  gain(s, ctx) {
    const db = param(ctx, s.db, 0);
    return {
      process(L, R) {
        for (let i = 0; i < L.length; i++) { const g = dbToGain(db(i)); L[i] *= g; R[i] *= g; }
      },
    };
  },

  /* リミッター：ceiling(dB) release(秒)。先読みして、音を潰さずに上限を超えないようにする */
  limiter(s, ctx) {
    return { process(L, R) { limit(L, R, ctx.sr, s.ceiling ?? -1, s.release ?? 0.08, s.lookahead ?? 0.004); } };
  },
};

/** 先読みリミッター（マスター用にも外から使う） */
export function limit(L, R, sr, ceilingDb = -1, release = 0.08, lookahead = 0.004) {
  const n = L.length;
  const ceil = dbToGain(ceilingDb);
  const la = Math.max(1, Math.round(lookahead * sr));
  // 各サンプルで必要なゲイン
  const need = new Float32Array(n);
  // サンプルの間の山（トゥルーピーク）も見積もる（3次補間で 1/4・1/2・3/4 の位置）
  const ip = (x, i) => {
    const a = x[i - 1] ?? x[i], b = x[i], c = x[i + 1] ?? x[i], d = x[i + 2] ?? c;
    let m = Math.abs(b);
    for (const t of [0.25, 0.5, 0.75]) {
      const v = b + 0.5 * t * (c - a + t * (2 * a - 5 * b + 4 * c - d + t * (3 * (b - c) + d - a)));
      if (Math.abs(v) > m) m = Math.abs(v);
    }
    return m;
  };
  for (let i = 0; i < n; i++) {
    let p = Math.max(Math.abs(L[i]), Math.abs(R[i]));
    if (p > ceil * 0.7) p = Math.max(ip(L, i), ip(R, i));
    need[i] = p > ceil ? ceil / p : 1;
  }
  // 先読み区間の最小値（単調キュー）
  const minAhead = new Float32Array(n);
  const q = new Int32Array(n + la + 1);
  let h = 0, t = 0;
  for (let i = n - 1 + la; i >= 0; i--) {
    if (i < n) {
      while (t > h && need[q[t - 1]] >= need[i]) t--;
      q[t++] = i;
    }
    while (t > h && q[h] > i + la) h++;
    if (i < n) minAhead[i] = t > h ? need[q[h]] : 1;
  }
  // なめらかに追従（下げるときは先読み区間で間に合うように、戻すときはゆっくり）
  const atk = Math.exp(-1 / (la / 3));
  const rel = Math.exp(-1 / (release * sr));
  let g = 1;
  for (let i = 0; i < n; i++) {
    const target = minAhead[i];
    g = target < g ? atk * g + (1 - atk) * target : rel * g + (1 - rel) * target;
    const gg = Math.min(g, need[i] < g ? need[i] : g);
    L[i] *= gg;
    R[i] *= gg;
  }
}
