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
