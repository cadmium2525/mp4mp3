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
     size(0.3〜2) decay(秒) damp(Hz, 響きの高域の減衰) predelay(秒) mix lowcut highcut width early(初期反射) */
  reverb(s, ctx) {
    const sr = ctx.sr;
    const size = clamp(s.size ?? 1, 0.2, 2.5);
    const decay = Math.max(0.1, s.decay ?? 2);
    const mix = param(ctx, s.mix, 0.25);
    const width = clamp(s.width ?? 1, 0, 1.5);
    const early = s.early ?? 0.3;
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
        modDepth: k % 3 === 0 ? 0.0006 * sr : 0,
        modRate: 0.3 + k * 0.17,
        ph: k * 1.3,
      };
    });
    // 初期反射のタップ（ms, 左右のゲイン）
    const taps = [[7.1, 0.8, 0.5], [11.3, 0.5, 0.75], [17.9, 0.6, 0.4], [23.5, 0.35, 0.55], [31.7, 0.4, 0.3], [41.3, 0.25, 0.35]]
      .map(([ms, gl, gr]) => [Math.round((ms / 1000) * sr * size) + preS, gl, gr]);
    const lc = s.lowcut ?? 180, hc = s.highcut ?? 12000;
    const fl = [new Biquad(sr, 'hp', lc, 0, 0.6), new Biquad(sr, 'lp', hc, 0, 0.6)];
    const fr = [new Biquad(sr, 'hp', lc, 0, 0.6), new Biquad(sr, 'lp', hc, 0, 0.6)];
    const N = lines.length;
    const outs = new Float64Array(N);
    return {
      process(L, R) {
        const n = L.length;
        for (let i = 0; i < n; i++) {
          let x = (L[i] + R[i]) * 0.5;
          pre.write(x);
          let erl = 0, err = 0;
          for (const [d, gl, gr] of taps) { const v = pre.readInt(d); erl += v * gl; err += v * gr; }
          x = pre.readInt(preS);
          for (const ap of aps) {
            const dv = ap.d.readInt(ap.n - 1);
            const y = -0.6 * x + dv;
            ap.d.write(x + 0.6 * y);
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
          wl = wl * 0.5 + erl * early * 0.5;
          wr = wr * 0.5 + err * early * 0.5;
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
