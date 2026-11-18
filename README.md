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

- `public/` — 画面（HTML / CSS / JS）。タブは `#ip` `#privacy` `#browser` `#fp` `#webrtc` `#dns` `#lookup` `#mail` `#ports` `#http` `#certs` `#tools`（日本風のみ `#bbs`）で切り替わる
- `src/index.js` — API
  - `GET /api/info` — 接続元IP、位置、ASN、TLSなど
  - `GET /api/dns?name=example.com&type=A[&ecs=203.0.113.0/24]` — 公開DoHリゾルバーと地域別（EDNS Client Subnet）の問い合わせ結果
  - `GET /api/ip?q=8.8.8.8` — 逆引き、AS番号（Team Cymru）、ネットワークの登録情報（RDAP）。所在地は返さない（下の「ブラウザから直接引く情報」を参照）
  - `GET /api/domain?q=example.com` — 登録情報（RDAP。未対応のTLDはWHOISで補う）と現在のDNSレコード
  - `GET /api/ports?host=203.0.113.5&ports=22,80,443` — TCPポートが開いているか（1回12個まで。25番は不可）
  - `GET /api/http?url=https://example.com` — 応答ヘッダーと転送の経路（本文は読まない）
  - `GET /api/certs?q=example.com` — 証明書の発行履歴（crt.sh）
  - `/api/info` と `/api/ip` は、Tor出口ノードかどうか（`tor`）も返す
  - `GET /api/mail?q=example.com` — MX、SPF、DMARC、DKIM（よくあるセレクター名15個を試す）、MTA-STS など
  - `GET /api/asn?q=AS13335` — AS番号の名前・国・割り当て元（Team Cymru）。広報しているIP帯はブラウザが stat.ripe.net に聞く
  - `GET /api/subdomains?q=example.com` — 証明書の発行記録に出てくるサブドメイン（crt.sh）
  - `GET /api/timing?url=https://example.com` — 同じURLに5回アクセスして応答時間を測る
  - `/api/http` は security.txt の有無も返す（採点は画面側の `httpGrade`）
  - `POST /api/counter`（訪問を1回数える）/ `GET /api/counter`、`GET` `POST` `DELETE /api/bbs`（掲示板）

「IP・ドメイン検索」タブは入力欄が1つで、IPアドレスの形なら `/api/ip`、それ以外は `/api/domain` を呼ぶ。

リゾルバーや地域を増減するときは `src/index.js` 冒頭の `RESOLVERS` と `LOCATIONS` を編集する。
1回の検索で「リゾルバー数 + 地域数」件の外部リクエストを送るので、無料枠の上限（1リクエストあたり50件）に収めること。

## 表示言語

標準は英語（アメリカ）。ヘッダー右上の Lang プルダウンで、英語（イギリス）・日本語・ロシア語・中国語・イタリア語・ドイツ語に切り替えられる（選択はブラウザに保存）。
イギリス英語は、アメリカ英語との違いだけを `I18N['en-GB']` に書いてある。
文言は `public/i18n.js` の `I18N` にまとめてあり、同じキーで言語を足せば選択肢を増やせる
（`public/index.html` の `#lang-select` にも `<option>` を足す）。
サーバーはエラーを `bad_name` のようなコードで返し、画面側が表示言語の文言にする。

## テーマ

標準は白と灰色の細かいブロック模様（地図だけ色付き）。タイトル部分を続けて10回クリックすると隠しプルダウンが出て
（もう一度10回クリックすると隠れる。選んだテーマは残る）、
日本風（平成）・アメリカ風（90年代）・ロシア風（2000年代）・ロシア風（とても怪しい）・中国風（現代）・
イタリア風（2000年代）・ドイツ風（2000年代）・イングランド風（文字放送）・イングランド風（とても堅い）に切り替えられる
（選択はブラウザに保存）。配色は `public/style.css` 冒頭のテーマ別の変数、飾りの文言は `public/app.js` の `THEMES` で決まる。
隠しテーマの飾りの文言はその国の言語で固定で、診断結果の表示だけが Lang の設定に従う。

日本風・中国風・ロシア風（とても怪しい）には、そのテーマのときだけ出る「やかましい」飾りがある（意味のないバナー、星のマウス追従、
当選ポップアップ、偽の利用者通知など）。HTMLでは `jp-only` / `cn-only` / `ru2-only` クラスの要素、CSSは `public/style.css` 末尾、
動きは `public/app.js` の `jpEffects` / `cnEffects` / `ru2Effects`。押せるものは `data-joke` つきで、押すと「飾りです」と出るだけ。
他のテーマでは表示も動作もしない。
例外として、中国風の「APP」と「立即打开」は飾りではなく、ランダム文字列の生成ポップアップを開く
（文字数と、大文字・小文字・数字・記号を選ぶ。生成はブラウザ内で行い、`public/app.js` の `randomString`）。
ロシア風（2000年代）・イタリア風・イングランド風（とても堅い）は点滅なし。イングランド風（とても堅い）は流れる文字も止めている。

## 地図

- IPの位置：Leaflet（`public/vendor/leaflet/` に同梱）と OpenStreetMap のタイルで表示する。出典表記は「© OpenStreetMap contributors」のみ。
- DNS伝播：`public/world-110m.json`（Natural Earth 由来の国境の線画）に、地域別の結果を印で置く。
  印の位置は `src/index.js` の `LOCATIONS` の緯度・経度。線画は `tools/build-world-map.cjs` で作り直せる。

## レイアウト

画面幅で3段階に変わる（`public/style.css` の「レイアウトは3段階」のコメント以下）。
スマホ（〜640px）は1列でタブはプルダウン、中間（641〜959px）は1列でタブは上に横並び、
PC（960px〜）は左に縦メニュー・右に本文で、本文の中は2列に並べられるところを並べる。

## ブラウザから直接引く情報

Workers は他の利用者と出口のIPを共有しているため、無料の公開サービスに回数制限（429）や拒否（403）で断られやすい。
そこで次の2つは、訪問者のブラウザから直接問い合わせる（`public/app.js` の `geoLookup` / `enrichIp` / `enrichDomain`）。

- IPの所在地：ipwho.is、断られたら ipapi.co
- 登録情報（RDAP）：サーバーが rdap.org → 地域の登録機関のRDAP → 従来のWHOIS（TCP 43番）の順に試す。
  全部失敗したときだけ、ブラウザが rdap.org → 登録機関のRDAP の順に聞き直す。
  失敗時のエラー文には、失敗したサーバー名が入る（例: `HTTP 525 (rdap.apnic.net)`）
- 証明書の発行履歴：まずサーバーが crt.sh に聞き、失敗したときだけブラウザが crt.sh に聞き直す

RDAPの応答を整える処理は `public/rdap.js` にあり、サーバーとブラウザの両方が読み込む。

## 外から調べる機能の制限

ポートチェックとHTTPヘッダー確認は、踏み台にされにくいよう次の制限を入れている（`src/index.js` の `assertPublicHost` ほか）。
プライベートアドレスやループバックなどは断る。ポートは1回12個まで、転送は8回まで。このサイト自身のアドレスは調べない。

## 回数制限

訪問者のIPごとに、1分あたりの回数を制限している。超えると 429（`rate_limited`）を返し、画面には「1分ほど待って」と出る。

| 制限 | 対象 | 上限 |
|---|---|---|
| `LIMIT_LOOKUP` | `/api/dns` `/api/ip` `/api/domain` `/api/certs` | 1分に30回 |
| `LIMIT_PROBE` | `/api/ports` `/api/http` | 1分に10回 |

上限は `wrangler.jsonc` の `ratelimits`、どの経路にどの制限をかけるかは `src/index.js` の `RATE_LIMITS` で決まる。
`/api/info` とページ本体には制限をかけていない。数え方は Cloudflare の拠点ごとで、多少の誤差がある。
それでも悪用が目立つようなら、Cloudflare の Turnstile（人間確認）を足すこと。

## 訪問カウンターと掲示板（日本風テーマ）

データは Durable Object（`src/index.js` の `Board` クラス、`wrangler.jsonc` の `durable_objects` と `migrations`）に保存する。
外部のデータベースを別に作る必要はなく、デプロイ時に自動で用意される。保存するのは訪問数（数字だけ）と、
掲示板の書き込み（名前・本文・日時）で、IPアドレスは保存しない。

- 訪問数は全テーマの訪問を数えるが、表示するのは日本風テーマだけ（他の隠しテーマは、そのブラウザで開いた回数を出す）。
- 掲示板の荒らし対策：URLを含む書き込みは拒否、1分に3回まで（`LIMIT_POST`）、本文200文字・名前20文字まで、
  人には見えない入力欄が埋まっていたら捨てる、新しい200件だけ残す。表示は文字として扱い、HTMLは解釈しない。
- 書き込みを消すには、Worker のシークレットに `ADMIN_KEY` を設定してから
  `curl -X DELETE "https://<サイト>/api/bbs?id=<番号>&key=<ADMIN_KEY>"` を実行する。未設定なら削除はできない。

## ツールタブ

サブネット計算・MACアドレスのメーカー検索（`public/oui.json`）・変換ツール・QRコード（`public/vendor/qrcode/`）はブラウザの中だけで動く。
変換ツールはドイツ風、QRコードはロシア風（とても怪しい）テーマのときだけ表示される（`de-only` / `ru2-only`）。
検索履歴（各タブ最近8件）もブラウザの中だけに保存する。広告ブロッカーの検出は、サイト内のおとり（`public/adsbygoogle.js` と要素1つ）だけで行う。
