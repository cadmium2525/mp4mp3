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
  "texts":  [ Text, ... ],          // テロップ・字幕。時刻で自由に配置
  "audios": [ Audio, ... ]          // BGM・効果音・ナレーション
}
```

時間の単位はすべて **秒**、位置・大きさは **画面に対する割合（0〜1）** です。

## Media（素材）

```jsonc
"m1": { "name": "IMG_0123.MOV" }
```

`name` だけ書けば十分です（`kind`・`duration`・`width`・`height`・`hasAudio` は読み込み時に実ファイルから補われます）。
アプリから書き出した JSON にはそれらも入っています。

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

`transition.type`：

- `none` … なし（カット）
- `fade` … クロスフェード（前のクリップと duration 秒重なる）
- `black` / `white` … 黒・白を経由してフェード（重ならない）。先頭クリップなら黒/白からのフェードイン
- `slide` / `wipe` / `zoom` … スライド・ワイプ・ズーム（重なる）

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
| `anim` | `pop` | `none` / `fade` / `pop` / `slide` / `typewriter` |

スタイル：`telop`（白文字＋黒ふち）、`yellow`（黄色の強調）、`subtitle`（半透明の帯の字幕）、`title`（大きいタイトル）、
`pop`（丸ゴシック＋ピンクふち）、`elegant`（明朝＋影）、`label`（黄色い帯ラベル）。

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

## コマンドで書き出す（PC・Claude 向け）

ブラウザと同じ描画エンジンを、ヘッドレス Chromium（Playwright）で動かして書き出します。

```sh
node editor/tools/render.mjs project.json 素材フォルダ out.mp4            # 動画
node editor/tools/render.mjs project.json 素材フォルダ still.png --still 3 # 3秒地点の静止画（構図の確認）
# オプション: --short 720|1080|1440|2160  --quality standard|high|max
```

Chromium が H.264 に対応していない環境では VP9/Opus で書き出され、ffmpeg があれば自動で H.264/AAC の MP4 に変換されます。
