# つなぐ プロジェクト形式（JSON）

「つなぐ」の編集内容はすべて 1 つの JSON で表せます。アプリの「…」→「JSONをコピー」で取り出し、
「JSONを貼り付け」で反映できるので、Claude などの AI に「テロップを付けて」「無音部分をカットして」と頼み、
返ってきた JSON をそのまま貼り付ける、という使い方ができます。

素材ファイル（動画・写真・音声）そのものは JSON に含まれず、`media` のファイル名で対応付けます。

## 全体

```jsonc
{
  "version": 1,
  "name": "旅行vlog",
  "width": 1080, "height": 1920,   // 9:16（ショート）。16:9 なら 1920×1080
  "fps": 30,                        // 24 / 30 / 60
  "background": "#000000",          // 「全体を表示」のときの余白の色
  "fadeOut": 1,                     // 最後に黒へフェードアウトする秒数（0 でなし）
  "media":  { "<id>": Media, ... },
  "clips":  [ Clip, ... ],          // メイントラック。上から順に隙間なくつながる
  "overlays":[ Overlay, ... ],      // 画面に重ねる動画・写真（ワイプ / PiP / 切り抜き）
  "motions": [ Motion, ... ],       // Motion Prompt の要素（#001〜#120 の名前つきの動き）
  "texts":  [ Text, ... ],          // テロップ・字幕。時刻で自由に配置
  "shapes": [ Shape, ... ],         // 図形（四角・丸・矢印・吹き出し…）
  "effects":[ Effect, ... ],        // エフェクト（ぼかし・手ぶれ・紙吹雪…）
  "audios": [ Audio, ... ]          // BGM・効果音・ナレーション
}
```

描画の重なり順は 下から「映像 → 映像系エフェクト → 重ねた映像 → Motion Prompt の要素 → 図形 → テキスト → 上乗せ系エフェクト」。
`overlays` / `motions` / `shapes` / `texts` は配列の後ろのものほど手前に描かれます。

`clips` が空でも、図形・テキスト・エフェクトだけで動画を作れます（長さは一番遅く終わるものまで）。

時間の単位はすべて **秒**、位置・大きさは **画面に対する割合（0〜1）** です。

## Media（素材）

```jsonc
"m1": { "name": "IMG_0123.MOV" }
```

`name` だけ書けば十分です（`kind`・`duration`・`width`・`height`・`hasAudio` は読み込み時に実ファイルから補われます）。
アプリから書き出した JSON にはそれらも入っています。

アプリの「JSONをコピー」では、音のある素材に **`silences`**（話していない・音がない区間、`[[開始, 終了], ...]` 秒、-40dB 未満が 0.6 秒以上）
も付きます。無音カットやテロップのタイミング合わせに使えます（読み込み時は無視されます）。

## Clip（メイントラックの動画・写真）

| キー | 既定値 | 説明 |
| --- | --- | --- |
| `media` | — | 素材の ID |
| `in` / `out` | 0 / 素材の長さ | 使う範囲（素材の中の時刻）。写真は `out - in` が表示秒数（既定 3 秒） |
| `speed` | 1 | 再生速度（0.25〜4）。タイムライン上の長さは `(out - in) / speed` |
| `volume` | 1 | このクリップの音量（0 でミュート、2 で 200%） |
| `fit` | `"cover"` | `cover` 画面いっぱい（はみ出しは切る）／ `contain` 全体を表示 |
| `zoom` | 1 | 追加の拡大率 |
| `x` / `y` | 0 | 位置のずらし（画面幅・高さに対する割合、-0.5〜0.5 程度） |
| `kenburns` | 写真は true | ゆっくりズームイン |
| `filter` | `{brightness:1, contrast:1, saturation:1}` | 色調整（1 が元のまま、saturation 0 でモノクロ） |
| `transition` | `{type:"none", duration:0.5}` | **このクリップの始まり**の切り替え効果 |
| `cutout` | なし | 切り抜き（下の「切り抜き」）。`"bg": "blur"` で背景を元映像のぼかしに、省略すると背景色 |

`transition.type`：

- `none` … なし（カット）
- `fade` … クロスフェード（前のクリップと duration 秒重なる）
- `black` / `white` … 黒・白を経由してフェード（重ならない）。先頭クリップなら黒/白からのフェードイン
- `slide` / `wipe` / `zoom` … スライド・ワイプ・ズーム（重なる）
- `flip` / `cube` … 3D フリップ（カードが裏返る）/ 3D キューブ（立方体が回る）（重なる）

重なる効果を使うと、そのぶん動画全体が短くなります。

## Text（テロップ・字幕）

| キー | 既定値 | 説明 |
| --- | --- | --- |
| `text` | — | 文字。`\n` で改行。画面幅の 90% を超えると自動で折り返し |
| `start` / `end` | — | 表示する時刻（動画全体の中での秒） |
| `style` | `"telop"` | 下の表のスタイル名。指定すると色・書体などの既定値がまとめて入る |
| `x` / `y` | 0.5 / 0.8 | 文字の中心の位置（左上が 0,0 / 右下が 1,1） |
| `size` | スタイルによる | 文字の高さ（画面の短い辺に対する割合。0.075 ≒ 1080px 幅で 81px） |
| `font` | `gothic` | `gothic`（太ゴシック）/ `rounded`（丸ゴシック）/ `mincho`（明朝） |
| `color` | `#ffffff` | 文字色 |
| `stroke` / `strokeWidth` | スタイルによる | ふちの色と太さ（文字サイズに対する割合、0.15〜0.25 が目安。`null` でなし） |
| `bg` | `null` | 背景の帯の色（例 `"rgba(0,0,0,0.6)"`） |
| `shadow` | false | ぼかし影 |
| `anim` | `pop` | 出かた：`none` / `fade` / `pop` / `slide` / `typewriter` |
| `opacity` / `rotation` / `scale` | 1 / 0 / 1 | 不透明度・回転（度）・拡大率 |
| `strokes` | なし | 追加のふち `[{ "color": "#111", "width": 0.24 }]`（二重・三重ふち。太い順に重なる） |
| `glow` | なし | 光彩 `{ "color": "#ff2bd6", "size": 0.5 }`（size は文字の大きさに対する割合） |
| `extrude` | なし | 立体文字 `{ "depth": 0.12, "color": "#333", "angle": 135 }`（angle は奥へ伸びる向き、度） |
| `rx` / `ry` / `perspective` | 0 / 0 / 1.2 | 3D 回転（下の「3D」） |
| `to` / `keys` / `ease` | なし | 動き（下の「動き」を参照） |

`color`・`bg`・図形の `fill` は単色のほか、グラデーションも使えます：
`"gradient:gold"`（`gold` / `silver` / `rainbow` / `sunset` / `ocean` / `sakura` / `neon`）、
または `{ "colors": ["#ff4f8b", "#ffb84f"], "angle": 0 }`（angle 0 で左→右、90 で上→下）。

スタイル：`telop`（白文字＋黒ふち）、`yellow`（黄色の強調）、`subtitle`（半透明の帯の字幕）、`title`（大きいタイトル）、
`pop`（丸ゴシック＋ピンクふち）、`elegant`（明朝＋影）、`label`（黄色い帯ラベル）、
`gold`（金色・立体）、`neon`（ネオン）、`rainbow`（虹色）、`pop3d`（黄色の立体）、`double`（二重ふち）。

## Shape（図形）

| キー | 既定値 | 説明 |
| --- | --- | --- |
| `kind` | `round` | `rect` 四角 / `round` 角丸 / `circle` 丸 / `ring` 輪 / `triangle` / `star` / `heart` / `arrow` 右向き矢印 / `line` / `bubble` 吹き出し / `burst` ギザギザ / `check` |
| `start` / `end` | — | 表示する時刻 |
| `x` / `y` | 0.5 | 中心の位置（画面の割合） |
| `w` / `h` | 形による | 幅・高さ（**画面の短い辺**に対する割合。`w:0.3, h:0.3` はどの比率でも正円・正方形） |
| `rotation` | 0 | 回転（度）。矢印の向きはこれで変える（90 で下向き） |
| `fill` | `#ff7a3d` | 塗り（`null` で塗りなし） |
| `stroke` / `strokeWidth` | なし / 0.01 | ふちの色と太さ（短い辺に対する割合）。`ring`・`check` は線の色・太さ |
| `radius` | 0.3 | `round` の角の丸み（0〜0.5） |
| `opacity` | 1 | 不透明度 |
| `shadow` | false | 影 |
| `anim` | `pop` | 出かた：`none` / `fade` / `pop` / `slide` / `spin` / `wipe`（左から描かれる） |
| `loop` | `none` | 表示中ずっと続く動き：`pulse` 鼓動 / `float` ふわふわ / `spin` 回転 / `blink` 点滅 / `shake` ゆれる |
| `scale` / `rx` / `ry` | 1 / 0 / 0 | 拡大率・3D 回転 |
| `to` / `keys` / `ease` | なし | 動き（下を参照） |

## Overlay（重ねた映像・写真 / ワイプ・PiP）

| キー | 既定値 | 説明 |
| --- | --- | --- |
| `media` | — | 素材の ID（動画・写真） |
| `start` | 0 | 表示し始める時刻（動画全体の中での秒） |
| `in` / `out` | 0 / 素材の長さ | 使う範囲（写真は `out - in` が表示秒数）。表示の終わり = `start + (out - in) / speed` |
| `speed` / `volume` | 1 / 1 | 再生速度・音量（動画の音も鳴る） |
| `x` / `y` | 0.72 / 0.28 | 中心の位置 |
| `w` | 0.42 | 幅（画面の短い辺に対する割合）。高さは素材の縦横比から決まる |
| `mask` | `round` | `none` 四角 / `round` 角丸 / `circle` 丸（丸は正円に切り取る） |
| `radius` | 0.08 | 角丸の丸み |
| `border` / `borderColor` | 0.006 / `#fff` | ふち（短い辺に対する割合）と色 |
| `shadow` | true | 影（切り抜き時は人物の輪郭に沿った影） |
| `rotation` / `opacity` / `scale` / `rx` / `ry` | | 回転・不透明度・拡大率・3D |
| `anim` / `loop` | `pop` / `none` | 出かた・続く動き（図形と同じ） |
| `keys` / `to` / `ease` | なし | 動き |
| `cutout` | なし | 切り抜き（下を参照） |

## Motion（Motion Prompt の要素）

[Motion Prompt](https://github.com/showheyohtaki/motion-prompt)（MIT License © 2026 Shohei Ohtaki）の 120 個の「名前つきの動き」を、
番号を書くだけでそのまま使えます（コードは `editor/lib/motion-prompt/` に同梱）。
各要素は「時刻 u だけで絵が決まる Canvas 2D の関数」なので、見本と同じ動き・同じタイミングで描かれます。

| 番号 | パック | 内容 |
| --- | --- | --- |
| #001–024 | `motion` | モーショングラフィックスの動き（ポップイン、タイプライター、カウントアップ、モーフィング、グリッチ…） |
| #025–048 | `camera` | カメラワークと切り替え（ドリー、オービット、ホイップパン、スマッシュカット…） |
| #049–072 | `ui` | UI パーツ（トースト、モーダル、スケルトン…） |
| #073–096 | `lp` | LP・Web サイトの演出（パララックス、スクロール連動…） |
| #097–120 | `photo` | 写真の表現・光と画風（ゴールデンアワー、ボケ…） |

```jsonc
{ "ref": "007", "start": 1, "end": 5, "y": 0.4, "w": 0.9, "mode": "hold", "hold": 2.5, "transparent": true }
```

| キー | 既定値 | 説明 |
| --- | --- | --- |
| `ref` | — | 要素の番号（`"012"`、`"#012"`、`12` どれでも） |
| `start` / `end` | — | 表示する時刻（動画全体の中での秒） |
| `mode` | `loop` | `loop` くり返す / `once` 1周だけ（最後の絵で止まる） / `hold` 要素の中の `hold` 秒で止める / `still` `hold` 秒の静止画 |
| `hold` | 1周の半分 | `hold` / `still` で止める位置（**要素の中の秒**）。登場が終わって落ち着いた瞬間を選ぶ（仕様の時間から読む） |
| `speed` | 1 | 速さ（2 で倍速） |
| `offset` | 0 | 要素の中のどこから始めるか（秒） |
| `x` / `y` / `w` | 0.5 / 0.5 / 1 | 中心の位置、カードの幅（**画面の幅**に対する割合。カードは横長 539×208） |
| `cover` | false | true でカードを画面いっぱいに広げる（はみ出しは切れる） |
| `transparent` | false | true でカードの背景（全面の塗り）を描かず、下の映像を見せる |
| `colors` | なし | パレットの差し替え `{ "navy": "#000000", "blue": "#ff4f8b" }`（キーはパックごと。一部の色だけ変わる要素もある） |
| `opacity` / `rotation` / `scale` / `rx` / `ry` | | 不透明度・回転・拡大率・3D |
| `anim` / `keys` / `ease` | `none` / なし | 出かた・キーフレーム（ほかの要素と同じ） |

- 要素の中の文字・数字はサンプルです。言葉を変えたいときは、透明にした要素の上に `texts` を重ねてください。
- 一覧・仕様は `node editor/tools/motion-catalog.mjs list | search 言葉 | get 番号`（仕様・1周の秒数・パレットのキーが出る）。
- 見本：`https://showheyohtaki.github.io/motion-prompt/#番号`

## 切り抜き（cutout）

clips・overlays に付けられます。

```jsonc
{ "mode": "person" }                                          // AI で人物だけ残す
{ "mode": "object", "x": 0.55, "y": 0.6 }                      // AI で、素材の中の (x, y) にある物を残す
{ "mode": "chroma", "color": "#00b140", "tolerance": 0.3, "softness": 0.1 }   // グリーンバック
{ "mode": "person", "invert": true }                          // 反転（人物を消して背景を残す）
```

- `person` / `object` は MediaPipe（Google）の AI モデルを端末内で動かします（初回のみ読み込みに数秒）。
- `object` の動画は、毎コマ同じ位置にある物を切り抜きます。大きく動く物は外れることがあります。
- clips の切り抜きでは `"bg": "blur"` で背景を元映像のぼかしにできます（省略時は `background` の色）。
  別の映像の上に人物を重ねるには、背景を clips に、人物を overlays（`mask: "none"`）に置いて切り抜きます。

## 3D（rx / ry）

テキスト・図形・重ねた映像は、遠近感つきで 3D 回転できます。

- `ry`：縦軸まわり（左右を向く）。180 で裏返り、裏面は鏡写しで表示されます（コインのように回せる）
- `rx`：横軸まわり（前後に倒れる）。正の値で上側が奥へ
- `perspective`：遠近の強さ（既定 1.2。小さいほど強い）

`keys` で角度を変えれば、3D で回り込んで登場する・くるっと回転する、などの動きになります。

```json
{ "type": "confetti", "start": 3, "end": 6, "intensity": 0.6 }
```

| type | かかる層 | 内容 |
| --- | --- | --- |
| `blur` | 映像 | ぼかし |
| `shake` | 映像 | 手ぶれ・カメラの揺れ |
| `zoompulse` | 映像 | 1秒に2回、ドンと拡大する |
| `glitch` | 映像 | ノイズ・ずれ（ときどき） |
| `rgbsplit` | 映像 | 赤と青緑がずれる |
| `mono` | 映像 | モノクロ（intensity で度合い） |
| `vignette` | 映像 | 周辺を暗く |
| `grain` | 映像 | フィルムの粒子 |
| `letterbox` | 映像 | 上下の黒帯（シネマ風） |
| `flash` | 一番上 | 白く光って消える（短めに 0.3〜0.8 秒） |
| `confetti` / `snow` / `sparkle` / `hearts` | 一番上 | 紙吹雪 / 雪 / キラキラ / 昇るハート |

`intensity` は 0〜1（既定 0.6）。始まりと終わりは 0.15 秒でなめらかに切り替わります。

## 動き（keys / to）

Text・Shape・Overlay は **キーフレーム** `keys` で自由に動かせます。
`t` は **その要素の表示開始からの秒**。書いていない項目は前のキーの値を引き継ぎ、キーとキーの間はなめらかにつながります。
動かせる項目：`x`, `y`, `w`, `h`, `size`, `rotation`, `opacity`, `scale`, `rx`, `ry`。

```json
{ "kind": "circle", "start": 1, "end": 5, "x": 0.2, "y": 0.5, "w": 0.2, "h": 0.2,
  "keys": [
    { "t": 0,   "x": 0.2, "scale": 0 },
    { "t": 0.5, "scale": 1, "ease": "back" },
    { "t": 2,   "x": 0.8, "y": 0.3 },
    { "t": 3.5, "y": 0.7, "ry": 180, "ease": "linear" }
  ] }
```

各キーの `ease` は「前のキーからそのキーまで」の変化の仕方です。

簡単な動きだけなら `to` に「表示の終わりの時点の値」を書く省略形も使えます（`keys` があればそちらが優先）。

```json
{ "kind": "arrow", "start": 1, "end": 3, "x": 0.1, "y": 0.7, "w": 0.4, "h": 0.12, "to": { "x": 0.6 }, "ease": "out" }
{ "text": "ドーン", "start": 2, "end": 4, "size": 0.05, "to": { "size": 0.12, "rotation": -8 }, "ease": "back" }
```

`ease`：`linear`（一定）/ `ease`（ゆっくり→速く→ゆっくり、既定）/ `out`（速く始まって止まる）/ `in`（だんだん速く）/ `back`（行き過ぎて戻る）。
いくつかの区間に分けて別々の `to` を付けると、折れ線のような複雑な動きも作れます。

## Audio（BGM・効果音）

| キー | 既定値 | 説明 |
| --- | --- | --- |
| `media` | — | 素材の ID（動画ファイルを指定すると、その音声だけを使う） |
| `start` | 0 | 鳴り始める時刻（動画全体の中での秒） |
| `in` / `out` | 0 / 素材の長さ | 使う範囲 |
| `volume` | 0.6 | 音量（1 が元のまま） |
| `fadeIn` / `fadeOut` | 0 / 1 | フェード秒数 |
| `loop` | false | true なら動画の最後までくり返す |

## 例：ショート動画（テロップ＋BGM）

```json
{
  "name": "カフェ巡り",
  "width": 1080, "height": 1920, "fps": 30, "fadeOut": 0.8,
  "media": {
    "a": { "name": "IMG_0001.MOV" },
    "b": { "name": "IMG_0002.MOV" },
    "p": { "name": "IMG_0003.JPG" },
    "bgm": { "name": "music.mp3" }
  },
  "clips": [
    { "media": "a", "in": 1.2, "out": 4.0, "transition": { "type": "black", "duration": 0.6 } },
    { "media": "p", "in": 0, "out": 2.5, "transition": { "type": "fade", "duration": 0.4 } },
    { "media": "b", "in": 0.5, "out": 6.0, "speed": 1.5, "volume": 0.4 }
  ],
  "texts": [
    { "text": "休日のカフェ巡り☕", "start": 0.3, "end": 2.6, "style": "title", "y": 0.42, "anim": "fade" },
    { "text": "1軒目は駅前のお店", "start": 2.6, "end": 5.0, "style": "telop", "y": 0.8 },
    { "text": "ラテアートかわいい！", "start": 5.0, "end": 8.0, "style": "yellow", "y": 0.2, "anim": "pop" }
  ],
  "audios": [
    { "media": "bgm", "start": 0, "volume": 0.35, "fadeIn": 0.5, "fadeOut": 1.5, "loop": true }
  ]
}
```

## Claude と一緒に作る流れ

1. つなぐに素材を入れて、ざっくり並べる（素材は端末から出さなくてよい）
2. 「…」→「JSONをコピー」と「コマ一覧の画像」を Claude に送る
   - JSON：素材名・長さ・今の編集内容・無音区間
   - コマ一覧：素材を数秒おきに並べた時刻つきの画像（映像の中身が伝わる）
3. 「無音をカットしてテンポよく」「この内容でテロップを付けて」「最後に紙吹雪」「冒頭を Motion Prompt の #005 に」などと頼む
4. 返ってきた JSON を「JSONを貼り付け」で反映 → 確認・微調整 → 書き出し

## コマンドで書き出す（PC・Claude 向け）

ブラウザと同じ描画エンジンを、ヘッドレス Chromium（Playwright）で動かして書き出します。

```sh
node editor/tools/validate.mjs project.json                                # JSON のチェック（書き間違いを日本語で指摘）
node editor/tools/motion-catalog.mjs search 文字 登場                        # Motion Prompt の要素を探す（get 番号 で仕様）
node editor/tools/render.mjs project.json 素材フォルダ out.mp4            # 動画
node editor/tools/render.mjs project.json 素材フォルダ still.png --still 3 # 3秒地点の静止画（構図の確認）
node editor/tools/render.mjs project.json 素材フォルダ sheet.png --sheet 16 # 全体を16コマに分けた一覧（動きの確認）
# オプション: --short 720|1080|1440|2160  --quality standard|high|max  --force（エラーがあっても書き出す）
```

render.mjs は書き出し前に自動でチェックし、エラーがあれば止まります。アプリの「JSONを貼り付け」でも同じチェックが働きます。

Chromium が H.264 に対応していない環境では VP9/Opus で書き出され、ffmpeg があれば自動で H.264/AAC の MP4 に変換されます。
