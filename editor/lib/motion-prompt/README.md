# Motion Prompt（取り込み）

[Motion Prompt](https://github.com/showheyohtaki/motion-prompt)（MIT License © 2026 Shohei Ohtaki）の 120 個の要素を、つなぐ で使えるように取り込んだものです。
カタログのバージョン: 1.3ecb2619b4

- `<pack>.js` … 各パックの kit と要素（元の `packs/<pack>/pack.js`）。つなぐで色を差し替えられるよう、パレット `C` があるパックは最後の `return` に `C` を足しています（変更はこの1行のみ）。
- `catalog.json` … 名前・意味・仕様・1周の秒数などの一覧（元の `packs/<pack>/meta.json` と `api/v1/ja/e/*.txt` から生成）。
- 更新するとき: `node editor/tools/vendor-motion-prompt.mjs <motion-prompt のクローン>`
