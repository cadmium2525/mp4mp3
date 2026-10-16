# かなでる 曲・効果音の形式（JSON）

「かなでる」の曲と効果音は、すべて 1 つの JSON で表せます。アプリの「…」→「JSON をコピー」で取り出し、
「JSON を貼り付け」で反映できるので、Claude などの AI に「サビを足して」「もっと明るく」と頼み、
返ってきた JSON をそのまま貼り付ける、という使い方ができます。

同じ JSON は PC からも同じエンジンで音にできます（ブラウザと Node で結果は完全に同じ）：

```sh
node daw/tools/render.mjs song.json out.wav --mp3 out.mp3 --sheet sheet.png --report --stems
node daw/tools/render.mjs sfx.json  sfx.wav  --sheet sfx.png --report
node daw/tools/analyze.mjs 参考曲.mp3 --sheet ref.png        # 手元の音声・動画を解析
node daw/tools/audition.mjs inst|sfx 一覧.png                 # プリセットの総点検
```

例：`examples/japan2070_bgm.json`（ドキュメンタリー動画の BGM。10 トラック・7 つの場面に合わせた構成。`*.gen.mjs` はそれを作るスクリプト）。

## 時間の単位

曲の中の時間は **拍**（4 分音符 = 1）。4/4 拍子なら 1 小節 = 4 拍、`at: 16` は 5 小節目の頭。
効果音の中の時間は **秒**。

## 曲

```jsonc
{
  "name": "曲名",
  "bpm": 100,
  "sig": [4, 4],                 // 拍子
  "bars": 16,                    // 曲の長さ（省略すると最後の音まで）
  "key": "C major",              // メモ（表示用）
  "sends": {                     // 全トラック共有のリバーブ・ディレイ
    "reverb": { "size": 1.2, "decay": 2.2, "damp": 7000, "predelay": 0.025, "volume": 0 },
    "delay":  { "time": "1/8d", "feedback": 0.35, "tone": 4500, "volume": 0 }
  },
  "master": { "loudness": -14, "ceiling": -1, "fadeOut": 0, "fx": [ ... ] },
  "patterns": { "<名前>": Pattern, ... },   // 使い回す音符のまとまり
  "tracks": [ Track, ... ]
}
```

- `master.loudness`：仕上がりの音量（LUFS）。YouTube・配信は -14、BGM を控えめにするなら -20。`null` で調整しない。
- `master.ceiling`：トゥルーピークの上限（dBTP）。既定 -1。
- `master.fx`：省略時は「25Hz のローカット + ゆるいコンプ」。

## トラック

```jsonc
{
  "id": "keys",                 // 英数字の ID（サイドチェインや解析で使う）
  "name": "エレピ",
  "inst": "epiano",             // 楽器プリセット名（下の一覧）、または { "preset": "epiano", "amp": {"r": 1} }
  "type": "inst",               // inst（楽器）/ drums / sfx（効果音）。kit があれば drums
  "kit": "acoustic",            // ドラムキット（drums のとき）
  "volume": -3,                 // dB
  "pan": 0,                     // -1（左）〜 1（右）
  "sends": { "reverb": 0.2, "delay": 0.1 },
  "fx": [ Effect, ... ],
  "humanize": { "time": 0.01, "vel": 0.06 },   // 人間らしいずれ（秒・強さ）
  "swing": 0.15,                // 裏の 16 分を後ろにずらす（0〜0.5）
  "transpose": 0,               // 半音
  "strum": 0.02,                // 和音を下から順にずらして弾く（秒）
  "mute": false, "solo": false,
  "auto": { "volume": [[0, -12], [16, 0]], "pan": [[0, -0.5], [8, 0.5]] },  // 拍ごとの変化（dB は volume に足される）
  "clips": [ Clip, ... ]
}
```

## クリップとパターン

```jsonc
{ "at": 0, "notes": [[0, "C4", 1, 0.8], [1, "Am9:3", 2, 0.6]], "len": 8 }
{ "at": 16, "pattern": "verse", "repeat": 2, "transpose": 2, "vel": 0.9 }
{ "at": 0, "len": 4, "grid": { "kick": "x...x...x...x...", "snare": "....x.......x..." }, "res": 0.25 }
{ "at": 12, "sfx": { "preset": "riser", "length": 0.8 }, "gain": -4 }     // 効果音トラック
```

- 音符：`[開始拍, 音, 長さ(拍), 強さ0〜1]`。`{ "t", "n", "d", "v" }` でも可。
- 音：`"C4"`（C4 = MIDI 60）`"F#3"` `"Bb2"`、MIDI 番号、`["C4","E4","G4"]`、和音記号 `"Am9:3"`（ルートを 3 オクターブ目に積む）`"C/E:3"`（分数コード）。
  和音記号：`M m 7 M7 m7 mM7 m7b5 dim dim7 aug sus2 sus4 7sus4 6 m6 add9 madd9 9 M9 m9 11 m11 13 M13 m13 7b9 7#9 69 m69 5`
- `pattern`：`patterns` に書いた音符を使う（`len` はパターンの長さ）。同じパターンを使うクリップはまとめて変わる。
- `repeat`：くり返し回数。`len`（拍）ごとにくり返す。
- ドラムの譜面（`grid`）：1 文字 = `res` 拍（既定 0.25 = 16 分）。`X` 強 / `x` 中 / `o` 弱 / `g` ゴースト / `.` `-` 休み / `|` 区切り（読みやすさ用、無視される）。

## 楽器プリセット（inst）

| 分類 | 名前 |
| --- | --- |
| ピアノ・キー | piano, softpiano, epiano（ローズ風）, organ, bellkeys, chordstab |
| マレット・ベル | marimba, vibraphone, glock, musicbox, kalimba, tubular, celesta |
| 弦・プラック | guitar, nylon, harp, koto, pluck（シンセ）, pizz |
| パッド・ストリングス | pad, darkpad, airpad, strings, choir, choiroo, glasspad |
| ベース | subbass, synthbass, reese, bass808, fmbass, pluckbass, ebass（指弾き） |
| リード・ブラス | sawlead, squarelead, softlead, chip（8bit）, flute, brass, supersaw |

どのプリセットも、同じフレーズで -20 LUFS になるよう音量がそろえてあります。
`{ "preset": "pad", "amp": { "a": 2 }, "filter": { "cutoff": 800 } }` のように一部だけ変えられます。
音源の種類（`type`）：`synth`（減算）/ `fm` / `pluck`（弦の物理モデル）/ `partials`（倍音合成）。中身は `js/engine/presets.js` を参照。

## ドラム

キット：`acoustic`（スタンダード）/ `808` / `house` / `lofi` / `cinematic`。
パーツ：`kick kick808 sub snare clap rim snap hat ohat ride crash tom1 tom2 tom3 shaker tamb cowbell perc`。
パーツごとの調整：`"tune": { "snare": { "tone": 0.3, "length": 0.8, "pitch": -2 } }`。
オープンハイハットは次のハイハットで自動的に止まります（チョーク）。同じ音の連打も毎回わずかに変わります。

## エフェクト（fx）

数値の代わりに `[[拍, 値], ...]` を書くと時間で変化します（例：フィルターを開いていく）。

| type | 主なパラメーター |
| --- | --- |
| eq | `bands: [{ type: hp/lp/peak/lowshelf/highshelf/notch, freq, gain, q, slope: 24 }]` |
| comp | `threshold ratio attack release knee makeup mix sidechain:"kick のトラック ID"` |
| reverb | `mix size decay damp predelay lowcut highcut width early` |
| delay | `mix time("1/8d" か秒) feedback pingpong tone lowcut` |
| chorus | `mix rate depth delay` |
| dist | `drive(dB) kind(soft/tape/hard/fold) tone mix out` |
| filter | `kind(lp/hp/bp) freq q poles(2/4) mix` |
| widen | `amount lowmono(Hz)` |
| tremolo | `rate depth stereo` |
| pump | `amount rate("1/4") release` … キックに合わせて沈むポンピング |
| transient | `attack(dB) sustain(dB)` … 立ち上がりと余韻を別々に |
| lofi | `mix wow noise crackle tone` |
| crush | `bits rate mix` |
| gain | `db` |
| limiter | `ceiling release` |

## 効果音

プリセット：

```jsonc
{ "preset": "impact", "pitch": 0, "length": 1, "tone": 0, "space": 0.4, "punch": 0.6, "seed": 1 }
```

`pitch`（半音）`length`（倍率）`tone`（-1 暗い〜1 明るい）`space`（響き 0〜1）`punch`（迫力 0〜1）`seed`（ばらつき）。

| 分類 | プリセット |
| --- | --- |
| UI・操作 | click tap pop bubble toggle chime success error coin blip type pon |
| トランジション | whoosh swipe riser downer revcymbal glitch transition |
| 衝撃・アクセント | impact boom braam punch explosion heartbeat |
| バラエティ・ゲーム | sparkle magic boing jump powerup laser slide bell drumroll |
| 生活音・環境 | shutter drop footstep wind rain page |
| ドラム | kick kick808 snare clap hat ohat crash tom |

層を直接書くこともできます（音響デザイン：立ち上がり＋胴鳴り＋余韻＋空間を重ねる）：

```jsonc
{
  "layers": [
    { "src": "sine", "freq": [[0, 180], [0.05, 60, "exp"]], "amp": { "a": 0.001, "h": 0.01, "d": 0.3 }, "drive": 9 },
    { "src": "noise", "filter": { "type": "bp", "freq": [[0, 6000], [0.2, 800, "exp"]], "q": 1 }, "amp": { "a": 0.0005, "d": 0.15 }, "gain": -6, "width": 0.8 },
    { "at": 0.02, "src": "metal", "freq": 300, "filter": { "type": "hp", "freq": 3000 }, "amp": { "d": 0.8 }, "gain": -14 }
  ],
  "fx": [{ "type": "transient", "attack": 4 }, { "type": "reverb", "size": 1.4, "decay": 2, "mix": 0.25 }],
  "normalize": -1, "seed": 3
}
```

- `src`：`sine tri saw square pulse supersaw noise pink brown metal`（808 のシンバルの金属音）`modal`（叩いた物の共鳴、`modes: [[倍率, 減衰秒, 音量]]`）`crackle`（粒、`density` 個/秒）`click`
- `freq`：Hz またはカーブ `[[秒, Hz, 形]]`。形は `lin exp smooth in out hold`（周波数の既定は `exp`）
- `amp`：`{ a: 立ち上がり, h: 保持, d: 減衰（-60dB まで）}` またはカーブ `[[秒, 0〜1]]`
- `filter` / `filter2`：`{ type: lp/hp/bp/notch, freq（カーブ可）, q, poles: 4 }`、省略形 `hp` `lp`（Hz）
- `drive`（dB の歪み）`gain`（dB）`pan`（カーブ可）`width`（左右の広がり 0〜1）`voices` `detune`（ユニゾン）
- `fm: { ratio, index（カーブ可）}` `wobble: { rate, depth(半音), decay }` `vibrato: { rate, depth }`
- `normalize`：ピーク（dBFS、既定 -1）。`null` で正規化しない。`loudCap`：瞬間ラウドネスの上限（既定 -10 LUFS）

## 解析（見える化）

`render.mjs --report --stems` やアプリの「全体を解析」で、次を数値と図で確認できます。耳で聞けなくても音の状態がわかります。

- ラウドネス（LUFS）・LRA・ピーク・トゥルーピーク・クレスト・直流・頭とお尻の無音
- **スマホのスピーカー想定**：iPhone のスピーカーで鳴らしたときに何 dB 小さく聞こえるか（8 以下が目安。低音に頼りすぎていると大きくなる）
- 帯域バランス（6 帯域・1/3 オクターブ）と、バランスのよいポップスの平均との比較
- 小節ごとの和音の推定（`--expect "Am,F,C,G"` で予定との照合）、調、テンポ
- トラック別のラウドネス・帯域と、低域〜中低域のかぶり
- クリックノイズ（波形の不連続）の疑いのある時刻
- 見える化シート：波形＋短時間ラウドネス、スペクトログラム、クロマ（音名ごとの強さ）と和音、ピアノロール、帯域バランス、トラック別
