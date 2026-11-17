# NetCheck

IP・接続情報、ブラウザ情報、フィンガープリント、WebRTC漏れ、DNS伝播、IP・ドメインの登録情報を1つのページで切り替えて確認できるツール。
Cloudflare Workers（静的アセット付き）の無料枠で動く。

## 使い方

```bash
npm install
npm run dev      # http://localhost:8787
npm run deploy   # 初回は wrangler login が必要
```

## 構成

- `public/` — 画面（HTML / CSS / JS）。タブは `#ip` `#browser` `#fp` `#webrtc` `#dns` `#lookup` で切り替わる
- `src/index.js` — API
  - `GET /api/info` — 接続元IP、位置、ASN、TLSなど
  - `GET /api/dns?name=example.com&type=A[&ecs=203.0.113.0/24]` — 公開DoHリゾルバーと地域別（EDNS Client Subnet）の問い合わせ結果
  - `GET /api/ip?q=8.8.8.8` — 逆引き、AS番号（Team Cymru）、ネットワークの登録情報（RDAP）
  - `GET /api/domain?q=example.com` — 登録情報（RDAP。未対応のTLDはWHOISで補う）と現在のDNSレコード

「IP・ドメイン検索」タブは入力欄が1つで、IPアドレスの形なら `/api/ip`、それ以外は `/api/domain` を呼ぶ。

リゾルバーや地域を増減するときは `src/index.js` 冒頭の `RESOLVERS` と `LOCATIONS` を編集する。
1回の検索で「リゾルバー数 + 地域数」件の外部リクエストを送るので、無料枠の上限（1リクエストあたり50件）に収めること。

## 表示言語

標準は英語。ヘッダー右上の Lang プルダウンで日本語・ロシア語・中国語に切り替えられる（選択はブラウザに保存）。
文言は `public/i18n.js` の `I18N` にまとめてあり、同じキーで言語を足せば選択肢を増やせる
（`public/index.html` の `#lang-select` にも `<option>` を足す）。
サーバーはエラーを `bad_name` のようなコードで返し、画面側が表示言語の文言にする。

## テーマ

標準は白と灰色のブロック模様。タイトル部分を続けて10回クリックすると隠しプルダウンが出て、
日本風（平成）・アメリカ風（90年代）・ロシア風（2000年代）・中国風（現代）の「怪しいサイト」に切り替えられる
（選択はブラウザに保存）。配色は `public/style.css` 冒頭のテーマ別の変数、飾りの文言は `public/app.js` の `THEMES` で決まる。
隠しテーマの飾りの文言はその国の言語で固定で、診断結果の表示だけが Lang の設定に従う。

## 地図

- IPの位置：Leaflet（`public/vendor/leaflet/` に同梱）と OpenStreetMap のタイルで表示する。出典表記は「© OpenStreetMap contributors」のみ。
- DNS伝播：`public/world-110m.json`（Natural Earth 由来の国境の線画）に、地域別の結果を印で置く。
  印の位置は `src/index.js` の `LOCATIONS` の緯度・経度。線画は `tools/build-world-map.cjs` で作り直せる。

## レイアウト

画面幅で3段階に変わる（`public/style.css` の「レイアウトは3段階」のコメント以下）。
スマホ（〜640px）は1列でタブはプルダウン、中間（641〜959px）は1列でタブは上に横並び、
PC（960px〜）は左に縦メニュー・右に本文で、本文の中は2列に並べられるところを並べる。
