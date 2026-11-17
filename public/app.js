// NetCheck フロントエンド。タブ（狭い画面ではプルダウン）で各診断を切り替える。
// 表示言語は英語が標準で、ヘッダー右上の Lang プルダウンで切り替える（I18N に言語を足せば増やせる）。

const $ = (sel, root = document) => root.querySelector(sel);
const TABS = ['ip', 'browser', 'fp', 'webrtc', 'dns', 'lookup'];

const store = {
  get(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch {}
  },
};

// ---------- 文言 ----------

const I18N = {
  en: {
    locale: 'en-US',
    docTitle: 'NetCheck — Connection, Browser & DNS Checks',
    tagline: 'Connection · Browser · DNS diagnostics',
    'tabs.aria': 'Tools',
    'tab.ip': 'IP & Connection',
    'tab.browser': 'Browser',
    'tab.fp': 'Fingerprint',
    'tab.webrtc': 'WebRTC',
    'tab.dns': 'DNS Propagation',
    'tab.lookup': 'IP / Domain Lookup',
    'theme.label': 'Theme:',
    'theme.mono': 'White / Gray (default)',
    'theme.jp': '🇯🇵 Japan (2000s)',
    'theme.us': '🇺🇸 USA (1990s)',
    'theme.ru': '🇷🇺 Russia (2000s)',
    'theme.cn': '🇨🇳 China (modern)',
    go: 'Check',
    'foot.honest': 'Nothing shown here is stored anywhere. Only the IP & connection info and the DNS, IP and domain lookups go through the server.',
    'foot.honestRetro': '* It looks shady, but nothing shown here is stored anywhere. Only the IP & connection info and the DNS, IP and domain lookups go through the server. The visit counter lives only in this browser.',

    loading: 'Loading…',
    computing: 'Computing…',
    searching: 'Searching…',
    querying: 'Querying…',
    none: 'None',
    yes: 'Yes',
    no: 'No',
    listSep: ', ',
    paren: (s) => ` (${s})`,

    'h.ip': 'IP & Connection',
    'lead.ip': "What this site's server can see about your connection.",
    'ip.fail': (m) => `Could not load connection info (${m})`,
    'ip.address': 'IP address',
    'ip.location': 'Location (estimated)',
    'ip.provider': 'Provider',
    'ip.transport': 'Transport',
    'ip.tzMismatch': (a, b) => `The time zone estimated from your IP (${a}) differs from your browser's time zone (${b}). With a VPN or proxy, websites can see this mismatch.`,
    'ip.lookupOwn': 'Look up registration details for this IP →',
    'ip.secGeo': 'Location (estimated from IP)',
    'ip.country': 'Country',
    'ip.eu': ' (EU)',
    'ip.region': 'Region',
    'ip.city': 'City',
    'ip.postal': 'Postal code',
    'ip.coords': 'Coordinates',
    'ip.timezone': 'Time zone',
    'ip.continent': 'Continent',
    'ip.secMap': 'Your location (estimated from IP)',
    'ip.secNetwork': 'Network',
    'ip.asn': 'AS number',
    'ip.operator': 'Operator',
    'ip.colo': 'Cloudflare data center',
    'ip.secConn': 'Connection',
    'ip.http': 'HTTP version',
    'ip.tls': 'TLS version',
    'ip.cipher': 'Cipher suite',
    'ip.rtt': 'TCP round-trip time',
    'ip.encodings': 'Accepted encodings',
    'ip.secHeaders': 'Request headers',
    mapTitle: 'Map',

    'h.browser': 'Browser',
    'lead.browser': 'What a website can read about your browser and device with JavaScript.',
    'br.secBrowser': 'Browser',
    'br.ua': 'User agent',
    'br.brands': 'Brands and versions',
    'br.os': 'OS',
    'br.cpu': 'CPU architecture',
    'br.model': 'Model',
    'br.platform': 'Platform',
    'br.vendor': 'Vendor',
    'br.languages': 'Languages',
    'br.cookie': 'Cookies enabled',
    'br.on': 'On',
    'br.off': 'Off',
    'br.unset': 'Not set',
    'br.unsupported': 'Not supported',
    'br.webdriver': 'Automated (webdriver)',
    'br.pdf': 'Built-in PDF viewer',
    'br.plugins': 'Plugins',
    'br.secDevice': 'Device',
    'br.cores': 'Logical CPU cores',
    'br.memory': 'Memory (approx.)',
    'br.memoryVal': (n) => `${n} GB or more`,
    'br.touch': 'Touch points',
    'br.storage': 'Available storage (approx.)',
    'br.netType': 'Connection type',
    'br.saveData': 'Data saver',
    'br.secScreen': 'Screen',
    'br.res': 'Screen resolution',
    'br.avail': 'Available area',
    'br.viewport': 'Viewport',
    'br.dpr': 'Pixel ratio',
    'br.depth': 'Color depth',
    'br.orientation': 'Orientation',
    'br.scheme': 'Color scheme',
    'br.dark': 'Dark',
    'br.light': 'Light',
    'br.reducedMotion': 'Reduced motion',
    'br.p3': 'Wide gamut (P3)',
    'br.pointer': 'Primary input',
    'br.pTouch': 'Touch',
    'br.pMouse': 'Mouse',
    'br.pNone': 'None',
    'br.secLocale': 'Region and time',
    'br.locale': 'Locale',
    'br.calendar': 'Calendar',
    'br.numbering': 'Numbering system',
    'br.now': 'Current time',

    'h.fp': 'Fingerprint',
    'lead.fp': 'Values that can tell your device apart without cookies. Everything is computed in your browser and sent nowhere.',
    'fp.id': 'Device ID',
    'fp.idSub': 'All values below combined',
    'fp.intro': 'On the same device and browser, this ID usually stays the same even if you clear cookies or use a private window. If it changes every time, your browser’s fingerprinting protection is working.',
    'fp.hash': 'Hash',
    'fp.unavailable': 'Unavailable',
    'fp.rendering': 'Rendering',
    'fp.gpuVendor': 'GPU vendor',
    'fp.version': 'Version',
    'fp.shading': 'Shading language',
    'fp.maxTex': 'Max texture size',
    'fp.maxView': 'Max viewport',
    'fp.extCount': 'Extensions',
    'fp.noWebgl': 'WebGL is unavailable or disabled.',
    'fp.value': 'Computed value',
    'fp.noAudio': 'Could not compute an audio fingerprint.',
    'fp.fonts': (total, n) => `Fonts (${n} of ${total} candidates detected)`,
    'fp.noFonts': 'None detected',

    'h.webrtc': 'WebRTC Leak Test',
    'lead.webrtc': 'Checks which IP addresses are visible through WebRTC. If you use a VPN and your real IP shows up here, it is leaking.',
    'webrtc.rerun': 'Run again',
    'rtc.testing': 'Testing… (takes a few seconds)',
    'rtc.disabled': 'WebRTC is disabled in this browser, so it cannot leak your IP.',
    'rtc.host': 'Local',
    'rtc.srflx': 'Public (STUN)',
    'rtc.prflx': 'Public (peer)',
    'rtc.relay': 'Relay',
    'rtc.vHidden': 'Hidden',
    'rtc.vLocal': 'Local IP visible',
    'rtc.vDevice': 'Device IP visible',
    'rtc.vSame': 'Same as the IP this site sees',
    'rtc.vDiff': 'Differs from the IP this site sees',
    'rtc.sNone': 'No IP addresses were obtained through WebRTC.',
    'rtc.sLeak': (server, ips) => `WebRTC exposes a public IP (${ips}) that differs from the one this site sees (${server}). If you are using a VPN or proxy, your real IP is leaking.`,
    'rtc.sFamily': (server, ips) => `WebRTC shows a public IP of a different kind (${ips}) from the one this site sees (${server}). That is normal if it is just IPv4 vs IPv6, but it is a leak if your VPN only tunnels one of them.`,
    'rtc.sSame': 'The public IP visible through WebRTC matches the one this site sees. No additional leak.',
    'rtc.sNoPublic': 'No public IP was obtained through WebRTC.',
    'rtc.secFound': 'Addresses found',
    'rtc.thAddress': 'Address',
    'rtc.thType': 'Type',
    'rtc.thProtocol': 'Protocol',
    'rtc.thVerdict': 'Verdict',
    'rtc.secServer': 'IP this site sees',
    'rtc.fail': (m) => `The test failed (${m})`,

    'h.dns': 'DNS Propagation Check',
    'lead.dns': 'Compares answers from several public DNS resolvers and simulated regions to see whether a DNS change has spread.',
    'dns.adv': 'Add a region',
    'dns.ecsLabel': 'Client subnet (IPv4)',
    'dns.nameAria': 'Domain name',
    'dns.typeAria': 'Record type',
    'dns.error': 'Error',
    'dns.match': 'Matches majority',
    'dns.differs': 'Differs',
    'dns.nx': 'NXDOMAIN (does not exist)',
    'dns.noRecords': 'No records',
    'dns.thSource': 'Source',
    'dns.thAnswer': 'Answer',
    'dns.thTime': 'Time',
    'dns.thState': 'Status',
    'dns.ttl': (n) => `${n}s`,
    'dns.allFailed': 'Every query failed.',
    'dns.allSame': (n, failed) => `All ${n} sources that responded gave the same answer.${failed ? ` (${failed} did not respond.)` : ''}`,
    'dns.mixed': (total, agree) => `${agree} of ${total} sources agree and ${total - agree} differ. Right after a change, that means propagation is still in progress. For CDNs and other services that answer differently per region, differences are normal.`,
    'dns.recordOf': (name, type) => `${type} records for ${name}`,
    'dns.secResolvers': 'Public DNS resolvers',
    'dns.hintResolvers': 'The same query sent to each public resolver.',
    'dns.secGeo': 'By region (simulated)',
    'dns.hintGeo': 'Sent to Google Public DNS as if the query came from a user in that region. The subnets shown are approximate.',
    'dns.custom': 'Custom subnet',

    'h.lookup': 'IP / Domain Lookup',
    'lead.lookup': 'Enter an IP address or a domain name. The type is detected automatically.',
    'lookup.ph': '8.8.8.8 or example.com',
    'lookup.aria': 'IP address or domain name',
    'role.registrant': 'Registrant',
    'role.administrative': 'Administrative',
    'role.technical': 'Technical',
    'role.abuse': 'Abuse contact',
    'role.registrar': 'Registrar',
    'role.billing': 'Billing',
    'role.noc': 'NOC',
    'role.reseller': 'Reseller',
    'role.sponsor': 'Sponsor',
    'lk.thRole': 'Role',
    'lk.thName': 'Name',
    'lk.thContact': 'Contact',
    'lk.noContacts': 'No public contacts.',
    'lk.secIp': 'IP address',
    'lk.ptr': 'Hostname (reverse DNS)',
    'lk.secGeo': 'IP location (estimated)',
    'lk.state': 'State / Region',
    'lk.isp': 'ISP',
    'lk.org': 'Organization',
    'lk.network': 'Network',
    'lk.prefix': 'Route (prefix)',
    'lk.localTime': 'Local time',
    'lk.geoNote': 'The location is estimated from the IP and can be far from the real place.',
    'lk.countryNote': 'This is the country the address is registered in, not necessarily where it is used.',
    'lk.secMap': 'Where this IP is',
    'lk.secNetReg': 'Network registration',
    'lk.netName': 'Network name',
    'lk.range': 'Range',
    'lk.kind': 'Type',
    'lk.handle': 'Handle',
    'lk.parent': 'Parent network',
    'lk.rir': 'Allocated by',
    'lk.registered': 'Registered',
    'lk.updated': 'Last changed',
    'lk.whoisServer': 'WHOIS server',
    'lk.secContacts': 'Contacts',
    'lk.secRemarks': 'Remarks',
    'lk.noIpReg': 'No registration record was found for this IP.',
    'lk.errPtr': 'reverse DNS',
    'lk.errAsn': 'AS number',
    'lk.errRdap': 'registration',
    'lk.errGeo': 'location',
    'lk.partial': (list) => `Some information could not be loaded (${list})`,
    'lk.special': (ip, kind) => `${ip} is ${kind}. It has no registration on the public internet.`,
    'lk.hostname': 'Hostname',
    'lk.more': (n) => `+${n} more`,
    'special.private': 'a private address (LAN only)',
    'special.loopback': 'a loopback address (this device itself)',
    'special.linklocal': 'a link-local address',
    'special.cgnat': 'a shared address used for carrier-grade NAT',
    'special.thisnet': 'a special “this network” address',
    'special.doc': 'an address reserved for documentation examples',
    'special.benchmark': 'an address reserved for benchmark testing',
    'special.multicast': 'a multicast address',
    'special.reserved': 'a reserved address',
    'special.unspecified': 'the unspecified address',
    'special.ula': 'a unique local address (LAN only)',

    'dm.domain': 'Domain',
    'dm.registeredFor': (q) => `Registered domain for ${q}`,
    'dm.registrar': 'Registrar',
    'dm.expires': 'Expires',
    'dm.expired': 'Expired',
    'dm.daysLeft': (n) => `${n} days left`,
    'dm.notFound': (errs) => `No registration record was found. The domain may be unregistered, or this kind of domain may not publish registration data.${errs ? ` (${errs})` : ''}`,
    'dm.moreIp': (ip) => `More registration details for ${ip} →`,
    'dm.secReg': 'Domain registration',
    'dm.name': 'Domain name',
    'dm.status': 'Status',
    'dm.nameservers': 'Name servers',
    'dm.signed': 'Signed',
    'dm.unsigned': 'Not signed',
    'dm.registryId': 'Registry ID',
    'dm.secDns': (q) => `DNS records (${q})`,
    'dm.thKind': 'Type',
    'dm.thValue': 'Value',
    'dm.nxdomain': 'This name does not exist in DNS (NXDOMAIN).',
    'dm.noRecords': 'No records found.',
    'dm.failedTypes': (list) => `Types that failed to load: ${list}`,

    'err.bad_type': 'Unsupported record type.',
    'err.name_required': 'Enter a domain name.',
    'err.bad_name': 'That is not a valid domain name.',
    'err.bad_ecs': 'Enter the subnet as IPv4 in the form 203.0.113.0/24 (prefix 8–32).',
    'err.timeout': 'Timed out',
    'err.bad_response': 'Invalid response',
    'err.bad_ip': 'That is not a valid IP address (examples: 8.8.8.8, 2001:4860:4860::8888).',
    'err.geo_failed': 'Location unavailable',
    'err.need_dot': 'Enter a domain name that contains a dot, such as example.com.',
    'err.no_whois_server': 'No WHOIS server found for this TLD',
  },

  ja: {
    locale: 'ja-JP',
    docTitle: 'NetCheck — 接続・ブラウザ・DNS診断',
    tagline: '接続・ブラウザ・DNS診断',
    'tabs.aria': '診断ツール',
    'tab.ip': 'IP・接続',
    'tab.browser': 'ブラウザ',
    'tab.fp': 'フィンガープリント',
    'tab.webrtc': 'WebRTC',
    'tab.dns': 'DNS伝播',
    'tab.lookup': 'IP・ドメイン検索',
    'theme.label': 'テーマ：',
    'theme.mono': '白・灰色（標準）',
    'theme.jp': '🇯🇵 日本風（平成）',
    'theme.us': '🇺🇸 アメリカ風（90年代）',
    'theme.ru': '🇷🇺 ロシア風（2000年代）',
    'theme.cn': '🇨🇳 中国風（現代）',
    go: '調べる',
    'foot.honest': '表示した情報はどこにも保存していません。IP・接続情報と、DNS・IP・ドメインの検索だけがサーバーを経由します。',
    'foot.honestRetro': '※ 見た目は怪しいですが、表示した情報はどこにも保存していません。IP・接続情報と、DNS・IP・ドメインの検索だけがサーバーを経由します。訪問回数はこのブラウザの中だけで数えています。',

    loading: '取得中…',
    computing: '計算中…',
    searching: '検索中…',
    querying: '問い合わせ中…',
    none: 'なし',
    yes: 'はい',
    no: 'いいえ',
    listSep: '、',
    paren: (s) => `（${s}）`,

    'h.ip': 'IP・接続情報',
    'lead.ip': 'このサイトのサーバーから見えている、あなたの接続の情報です。',
    'ip.fail': (m) => `接続情報を取得できませんでした（${m}）`,
    'ip.address': 'IPアドレス',
    'ip.location': '場所（推定）',
    'ip.provider': 'プロバイダー',
    'ip.transport': '通信',
    'ip.tzMismatch': (a, b) => `IPから推定したタイムゾーン（${a}）と、ブラウザのタイムゾーン（${b}）が違います。VPNやプロキシを使っていると、サイト側からこの食い違いが見えます。`,
    'ip.lookupOwn': 'このIPの登録情報を調べる →',
    'ip.secGeo': '位置情報（IPからの推定）',
    'ip.country': '国',
    'ip.eu': '（EU）',
    'ip.region': '地域',
    'ip.city': '市区町村',
    'ip.postal': '郵便番号',
    'ip.coords': '緯度・経度',
    'ip.timezone': 'タイムゾーン',
    'ip.continent': '大陸',
    'ip.secMap': 'あなたの場所（IPからの推定）',
    'ip.secNetwork': 'ネットワーク',
    'ip.asn': 'AS番号',
    'ip.operator': '事業者',
    'ip.colo': '接続先のCloudflare拠点',
    'ip.secConn': '接続',
    'ip.http': 'HTTPバージョン',
    'ip.tls': 'TLSバージョン',
    'ip.cipher': '暗号スイート',
    'ip.rtt': 'TCP往復時間',
    'ip.encodings': '対応する圧縮方式',
    'ip.secHeaders': 'リクエストヘッダー',
    mapTitle: '地図',

    'h.browser': 'ブラウザ情報',
    'lead.browser': 'JavaScriptからサイト側が読み取れる、ブラウザと端末の情報です。',
    'br.secBrowser': 'ブラウザ',
    'br.ua': 'ユーザーエージェント',
    'br.brands': 'ブランドとバージョン',
    'br.os': 'OS',
    'br.cpu': 'CPUの種類',
    'br.model': '機種',
    'br.platform': 'プラットフォーム',
    'br.vendor': 'ベンダー',
    'br.languages': '言語',
    'br.cookie': 'Cookie',
    'br.on': '有効',
    'br.off': '無効',
    'br.unset': '未設定',
    'br.unsupported': '非対応',
    'br.webdriver': '自動操作（webdriver）',
    'br.pdf': 'PDFビューアー内蔵',
    'br.plugins': 'プラグイン数',
    'br.secDevice': '端末',
    'br.cores': 'CPUの論理コア数',
    'br.memory': 'メモリー（概算）',
    'br.memoryVal': (n) => `${n} GB 以上`,
    'br.touch': 'タッチ点数',
    'br.storage': '使えるストレージ（概算）',
    'br.netType': '回線の種類',
    'br.saveData': 'データセーバー',
    'br.secScreen': '画面',
    'br.res': '画面の解像度',
    'br.avail': '使える領域',
    'br.viewport': 'ウィンドウの表示領域',
    'br.dpr': 'ピクセル比',
    'br.depth': '色深度',
    'br.orientation': '画面の向き',
    'br.scheme': '配色の設定',
    'br.dark': 'ダーク',
    'br.light': 'ライト',
    'br.reducedMotion': '動きを減らす設定',
    'br.p3': '広色域（P3）',
    'br.pointer': '主な入力',
    'br.pTouch': 'タッチ',
    'br.pMouse': 'マウス',
    'br.pNone': 'なし',
    'br.secLocale': '地域と時刻',
    'br.locale': 'ロケール',
    'br.calendar': '暦',
    'br.numbering': '数字の体系',
    'br.now': '現在時刻',

    'h.fp': 'フィンガープリント',
    'lead.fp': 'Cookieを使わずに端末を見分ける手がかりになる値です。計算はすべてブラウザ内で行い、どこにも送信しません。',
    'fp.id': 'この端末の識別ID',
    'fp.idSub': '下の値をすべて組み合わせたもの',
    'fp.intro': '同じ端末・同じブラウザなら、Cookieを消してもシークレットモードにしても、ここのIDは基本的に変わりません。IDが毎回変わるなら、ブラウザのフィンガープリント対策が効いています。',
    'fp.hash': 'ハッシュ',
    'fp.unavailable': '取得できません',
    'fp.rendering': '描画結果',
    'fp.gpuVendor': 'GPUベンダー',
    'fp.version': 'バージョン',
    'fp.shading': 'シェーダー言語',
    'fp.maxTex': '最大テクスチャーサイズ',
    'fp.maxView': '最大ビューポート',
    'fp.extCount': '拡張機能の数',
    'fp.noWebgl': 'WebGLが使えないか、無効になっています。',
    'fp.value': '計算値',
    'fp.noAudio': 'オーディオのフィンガープリントを取得できません。',
    'fp.fonts': (total, n) => `フォント（候補${total}個中 ${n}個を検出）`,
    'fp.noFonts': '検出なし',

    'h.webrtc': 'WebRTC漏れテスト',
    'lead.webrtc': 'WebRTC経由で見えるIPアドレスを調べます。VPN利用中に、ここへVPNではない本来のIPが出ていたら漏れています。',
    'webrtc.rerun': 'もう一度テストする',
    'rtc.testing': 'テスト中…（数秒かかります）',
    'rtc.disabled': 'このブラウザではWebRTCが無効になっています。WebRTC経由でIPが漏れることはありません。',
    'rtc.host': 'ローカル',
    'rtc.srflx': '外部（STUN）',
    'rtc.prflx': '外部（ピア）',
    'rtc.relay': 'リレー',
    'rtc.vHidden': '隠されている',
    'rtc.vLocal': 'ローカルIPが見える',
    'rtc.vDevice': '端末のIPが見える',
    'rtc.vSame': 'サイトから見えるIPと同じ',
    'rtc.vDiff': 'サイトから見えるIPと違う',
    'rtc.sNone': 'WebRTCからIPアドレスは取得されませんでした。',
    'rtc.sLeak': (server, ips) => `サイトから見えるIP（${server}）とは別の外部IP（${ips}）がWebRTC経由で見えています。VPNやプロキシを使っているなら、本来のIPが漏れています。`,
    'rtc.sFamily': (server, ips) => `サイトから見えるIP（${server}）とは種類の違う外部IP（${ips}）が見えています。IPv4とIPv6の違いによるものなら通常の動作ですが、VPNが片方しか通していない場合は漏れになります。`,
    'rtc.sSame': 'WebRTCで見える外部IPは、サイトから見えるIPと同じです。追加の漏れはありません。',
    'rtc.sNoPublic': '外部IPはWebRTCから取得されませんでした。',
    'rtc.secFound': '見つかったアドレス',
    'rtc.thAddress': 'アドレス',
    'rtc.thType': '種類',
    'rtc.thProtocol': 'プロトコル',
    'rtc.thVerdict': '判定',
    'rtc.secServer': 'サイトから見えるIP',
    'rtc.fail': (m) => `テストに失敗しました（${m}）`,

    'h.dns': 'DNS伝播チェック',
    'lead.dns': '複数の公開DNSと、地域ごとの問い合わせ結果を並べて、DNSの変更が行き渡ったかを確認します。',
    'dns.adv': '地域を追加で指定する',
    'dns.ecsLabel': 'クライアントのサブネット（IPv4）',
    'dns.nameAria': 'ドメイン名',
    'dns.typeAria': 'レコードタイプ',
    'dns.error': 'エラー',
    'dns.match': '多数派と一致',
    'dns.differs': '他と違う',
    'dns.nx': 'NXDOMAIN（存在しない）',
    'dns.noRecords': 'レコードなし',
    'dns.thSource': '問い合わせ元',
    'dns.thAnswer': '回答',
    'dns.thTime': '応答',
    'dns.thState': '状態',
    'dns.ttl': (n) => `${n}秒`,
    'dns.allFailed': 'すべての問い合わせが失敗しました。',
    'dns.allSame': (n, failed) => `応答した${n}か所すべてが同じ回答です。${failed ? `（${failed}か所は応答なし）` : ''}`,
    'dns.mixed': (total, agree) => `${total}か所中${agree}か所が同じ回答で、${total - agree}か所は違う回答です。変更直後なら伝播の途中です。CDNなど地域ごとに回答を変えるサービスでは、違っていて正常です。`,
    'dns.recordOf': (name, type) => `${name} の ${type} レコード`,
    'dns.secResolvers': '公開DNSリゾルバー',
    'dns.hintResolvers': '各社の公開DNSに同じ問い合わせを送った結果です。',
    'dns.secGeo': '地域別（擬似）',
    'dns.hintGeo': 'Google Public DNSに「その地域のユーザーからの問い合わせ」として送った結果です。表示しているサブネットは目安です。',
    'dns.custom': '指定サブネット',

    'h.lookup': 'IP・ドメイン検索',
    'lead.lookup': 'IPアドレスかドメイン名を入力してください。どちらかを自動で判別して、登録情報を調べます。',
    'lookup.ph': '8.8.8.8 または example.com',
    'lookup.aria': 'IPアドレスまたはドメイン名',
    'role.registrant': '登録者',
    'role.administrative': '管理担当',
    'role.technical': '技術担当',
    'role.abuse': '不正利用の連絡先',
    'role.registrar': 'レジストラ',
    'role.billing': '請求担当',
    'role.noc': 'ネットワーク運用',
    'role.reseller': '再販業者',
    'role.sponsor': 'スポンサー',
    'lk.thRole': '役割',
    'lk.thName': '名前',
    'lk.thContact': '連絡先',
    'lk.noContacts': '公開されている連絡先はありません。',
    'lk.secIp': 'IPアドレス',
    'lk.ptr': 'ホスト名（逆引き）',
    'lk.secGeo': 'IPの所在地（推定）',
    'lk.state': '都道府県・州',
    'lk.isp': 'ISP',
    'lk.org': '組織',
    'lk.network': 'ネットワーク',
    'lk.prefix': '経路（プレフィックス）',
    'lk.localTime': '現地時刻',
    'lk.geoNote': '位置はIPからの推定です。実際の場所と大きくずれることがあります。',
    'lk.countryNote': '国はアドレスの登録上のもので、実際に使われている場所とは限りません。',
    'lk.secMap': 'このIPの場所',
    'lk.secNetReg': 'ネットワークの登録情報',
    'lk.netName': 'ネットワーク名',
    'lk.range': '範囲',
    'lk.kind': '種別',
    'lk.handle': 'ハンドル',
    'lk.parent': '上位ネットワーク',
    'lk.rir': '割り当て元',
    'lk.registered': '登録日',
    'lk.updated': '最終更新',
    'lk.whoisServer': 'WHOISサーバー',
    'lk.secContacts': '連絡先',
    'lk.secRemarks': '備考',
    'lk.noIpReg': 'このIPの登録情報は見つかりませんでした。',
    'lk.errPtr': '逆引き',
    'lk.errAsn': 'AS番号',
    'lk.errRdap': '登録情報',
    'lk.errGeo': '所在地',
    'lk.partial': (list) => `一部の情報を取得できませんでした（${list}）`,
    'lk.special': (ip, kind) => `${ip} は${kind}です。インターネット上の登録情報はありません。`,
    'lk.hostname': 'ホスト名',
    'lk.more': (n) => `ほか${n}件`,
    'special.private': 'プライベートアドレス（LAN内専用）',
    'special.loopback': 'ループバックアドレス（自分自身）',
    'special.linklocal': 'リンクローカルアドレス',
    'special.cgnat': 'キャリアグレードNAT用の共有アドレス',
    'special.thisnet': '「このネットワーク」を表す特別なアドレス',
    'special.doc': '文書の例示用アドレス',
    'special.benchmark': 'ベンチマーク試験用アドレス',
    'special.multicast': 'マルチキャストアドレス',
    'special.reserved': '予約済みアドレス',
    'special.unspecified': '未指定アドレス',
    'special.ula': 'ユニークローカルアドレス（LAN内専用）',

    'dm.domain': 'ドメイン',
    'dm.registeredFor': (q) => `${q} の登録元`,
    'dm.registrar': 'レジストラ',
    'dm.expires': '有効期限',
    'dm.expired': '期限切れ',
    'dm.daysLeft': (n) => `残り${n}日`,
    'dm.notFound': (errs) => `登録情報が見つかりませんでした。未登録か、このドメインの種類では登録情報が公開されていない可能性があります。${errs ? `（${errs}）` : ''}`,
    'dm.moreIp': (ip) => `${ip} の登録情報をさらに詳しく →`,
    'dm.secReg': 'ドメインの登録情報',
    'dm.name': 'ドメイン名',
    'dm.status': '状態',
    'dm.nameservers': 'ネームサーバー',
    'dm.signed': '署名あり',
    'dm.unsigned': '署名なし',
    'dm.registryId': 'レジストリのID',
    'dm.secDns': (q) => `DNSレコード（${q}）`,
    'dm.thKind': '種類',
    'dm.thValue': '値',
    'dm.nxdomain': 'この名前はDNSに存在しません（NXDOMAIN）。',
    'dm.noRecords': 'レコードが見つかりませんでした。',
    'dm.failedTypes': (list) => `取得に失敗した種類: ${list}`,

    'err.bad_type': '未対応のレコードタイプです。',
    'err.name_required': 'ドメイン名を入力してください。',
    'err.bad_name': 'ドメイン名の形式が正しくありません。',
    'err.bad_ecs': 'サブネットは 203.0.113.0/24 の形式（IPv4、プレフィックス8〜32）で指定してください。',
    'err.timeout': 'タイムアウト',
    'err.bad_response': '応答が不正です',
    'err.bad_ip': 'IPアドレスの形式が正しくありません（例: 8.8.8.8、2001:4860:4860::8888）。',
    'err.geo_failed': '所在地を取得できません',
    'err.need_dot': 'example.com のように、ドットを含むドメイン名を入力してください。',
    'err.no_whois_server': 'このTLDのWHOISサーバーが見つかりません',
  },
};

// 標準は英語。選んだ言語はブラウザに保存する
let lang = store.get('netcheck-lang');
if (!I18N[lang]) lang = 'en';

function t(key, ...args) {
  const v = I18N[lang][key] ?? I18N.en[key] ?? key;
  return typeof v === 'function' ? v(...args) : v;
}
// サーバーが返すエラーコード（bad_name など）を文言にする。知らないものはそのまま出す
const errText = (code) => (I18N.en[`err.${code}`] ? t(`err.${code}`) : code);

function applyStaticText() {
  document.documentElement.lang = lang;
  document.title = t('docTitle');
  for (const n of document.querySelectorAll('[data-i18n]')) n.textContent = t(n.dataset.i18n);
  for (const n of document.querySelectorAll('[data-i18n-ph]')) n.placeholder = t(n.dataset.i18nPh);
  for (const n of document.querySelectorAll('[data-i18n-aria]')) n.setAttribute('aria-label', t(n.dataset.i18nAria));
  $('#lang-select').value = lang;
}
applyStaticText();
$('#lang-select').addEventListener('change', (e) => {
  store.set('netcheck-lang', e.target.value);
  location.reload(); // 検索条件はURLに残っているので、読み込み直すだけで同じ画面が新しい言語で出る
});

// ---------- 小さなDOMヘルパー ----------

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') node.className = v;
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    node.append(c instanceof Node ? c : String(c));
  }
  return node;
}

const show = (v) => (v === null || v === undefined || v === '' ? el('span', { class: 'muted' }, '—') : v);

function kvTable(rows) {
  return el(
    'div',
    { class: 'card' },
    el('table', { class: 'kv' }, el('tbody', {}, rows.filter(Boolean).map(([k, v]) => el('tr', {}, el('th', {}, k), el('td', {}, show(v)))))),
  );
}

const section = (title, ...body) => [el('h2', {}, title), ...body];
const stat = (k, v, s, mono) => el('div', { class: 'stat' }, el('div', { class: 'k' }, k), el('div', { class: `v${mono ? ' mono' : ''}` }, show(v)), s ? el('div', { class: 's' }, s) : null);
const note = (kind, text) => el('p', { class: `note ${kind}` }, text);
const badge = (kind, text) => el('span', { class: `badge ${kind}` }, text);
// replaceChildren は null を文字列として描画してしまうので、空の要素を除いてから入れる
const fill = (node, ...kids) => node.replaceChildren(...kids.flat().filter(Boolean));
const loading = (text = t('loading')) => el('p', { class: 'muted' }, text);
const listTable = (heads, rows) =>
  el('div', { class: 'card' }, el('table', { class: 'list' }, el('thead', {}, el('tr', {}, heads.map((h) => (Array.isArray(h) ? el('th', { class: 'num' }, h[0]) : el('th', {}, h))))), el('tbody', {}, rows)));

async function sha256(input) {
  const data = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// /api/info は IP タブと WebRTC タブの両方で使うので一度だけ取得する
let infoPromise;
function getInfo() {
  infoPromise ??= fetch('/api/info').then((r) => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  });
  infoPromise.catch(() => (infoPromise = undefined));
  return infoPromise;
}

// 国コード（JP など）を、国旗の絵文字と表示言語での国名にする
const regionNames = new Intl.DisplayNames([lang], { type: 'region' });
const flag = (cc) => (/^[a-z]{2}$/i.test(cc || '') ? String.fromCodePoint(...[...cc.toUpperCase()].map((c) => 0x1f1a5 + c.charCodeAt(0))) : '');
function regionName(cc) {
  if (!cc) return null;
  try {
    return `${regionNames.of(cc.toUpperCase())}${t('paren', cc.toUpperCase())}`;
  } catch {
    return cc;
  }
}

function fmtDate(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString(t('locale'), { year: 'numeric', month: 'long', day: 'numeric' });
}

function localTime(timeZone) {
  try {
    return new Date().toLocaleString(t('locale'), { timeZone, dateStyle: 'medium', timeStyle: 'medium' });
  } catch {
    return null;
  }
}

function mapFrame(lat, lon) {
  lat = Number(lat);
  lon = Number(lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const bbox = [lon - 6, Math.max(lat - 3.2, -85), lon + 6, Math.min(lat + 3.2, 85)].map((n) => n.toFixed(4)).join(',');
  const src = `https://www.openstreetmap.org/export/embed.html?bbox=${encodeURIComponent(bbox)}&layer=mapnik&marker=${lat},${lon}`;
  return el('div', { class: 'map' }, el('iframe', { src, loading: 'lazy', title: t('mapTitle'), referrerpolicy: 'no-referrer' }));
}

// ---------- IP・接続 ----------

async function initIp() {
  const hero = $('#ip-hero');
  const body = $('#ip-body');
  body.replaceChildren(loading());
  let info;
  try {
    info = await getInfo();
  } catch (e) {
    body.replaceChildren(note('bad', t('ip.fail', e.message)));
    return;
  }
  const { geo, network, connection } = info;
  const place = [geo.city, geo.region, geo.country].filter(Boolean).join(', ');

  hero.replaceChildren(
    stat(t('ip.address'), info.ip, info.ipVersion ? `IPv${info.ipVersion}` : null, true),
    stat(t('ip.location'), place || null, geo.timezone),
    stat(t('ip.provider'), network.asOrganization, network.asn ? `AS${network.asn}` : null),
    stat(t('ip.transport'), connection.httpProtocol, connection.tlsVersion),
  );

  const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const tzNote = geo.timezone && browserTz && geo.timezone !== browserTz ? note('warn', t('ip.tzMismatch', geo.timezone, browserTz)) : null;
  const coords =
    geo.latitude && geo.longitude
      ? el('a', { href: `https://www.openstreetmap.org/?mlat=${geo.latitude}&mlon=${geo.longitude}#map=9/${geo.latitude}/${geo.longitude}`, target: '_blank', rel: 'noopener' }, `${geo.latitude}, ${geo.longitude}`)
      : null;
  const map = mapFrame(geo.latitude, geo.longitude);

  fill(
    body,
    tzNote,
    info.ip ? el('p', { style: 'margin:14px 0 0' }, el('a', { href: `#lookup?q=${encodeURIComponent(info.ip)}` }, t('ip.lookupOwn'))) : null,
    ...section(
      t('ip.secGeo'),
      kvTable([
        [t('ip.country'), geo.country ? `${flag(geo.country)} ${regionName(geo.country)}${geo.isEUCountry ? t('ip.eu') : ''}` : null],
        [t('ip.region'), [geo.region, geo.regionCode && `(${geo.regionCode})`].filter(Boolean).join(' ')],
        [t('ip.city'), geo.city],
        [t('ip.postal'), geo.postalCode],
        [t('ip.coords'), coords],
        [t('ip.timezone'), geo.timezone],
        [t('ip.continent'), geo.continent],
      ]),
    ),
    ...(map ? section(t('ip.secMap'), map) : []),
    ...section(
      t('ip.secNetwork'),
      kvTable([
        [t('ip.asn'), network.asn ? `AS${network.asn}` : null],
        [t('ip.operator'), network.asOrganization],
        [t('ip.colo'), network.colo],
      ]),
    ),
    ...section(
      t('ip.secConn'),
      kvTable([
        [t('ip.http'), connection.httpProtocol],
        [t('ip.tls'), connection.tlsVersion],
        [t('ip.cipher'), connection.tlsCipher],
        [t('ip.rtt'), connection.clientTcpRtt ? `${connection.clientTcpRtt} ms` : null],
        [t('ip.encodings'), connection.clientAcceptEncoding],
      ]),
    ),
    ...section(t('ip.secHeaders'), kvTable(info.headers.map((h) => [h.name, h.value]))),
  );
}

// ---------- ブラウザ ----------

async function initBrowser() {
  const body = $('#browser-body');
  const n = navigator;
  const s = screen;
  const intl = Intl.DateTimeFormat().resolvedOptions();
  const yn = (v) => (v === undefined || v === null ? null : v ? t('yes') : t('no'));
  const mq = (q) => matchMedia(q).matches;

  let uaHints = null;
  if (n.userAgentData?.getHighEntropyValues) {
    try {
      uaHints = await n.userAgentData.getHighEntropyValues(['architecture', 'bitness', 'model', 'platformVersion', 'fullVersionList']);
    } catch {}
  }

  let storage = null;
  try {
    const est = await n.storage?.estimate?.();
    if (est?.quota) storage = `${(est.quota / 1024 ** 3).toFixed(1)} GB`;
  } catch {}

  const conn = n.connection;
  const offsetMin = -new Date().getTimezoneOffset();
  const offset = `UTC${offsetMin >= 0 ? '+' : '-'}${String(Math.floor(Math.abs(offsetMin) / 60)).padStart(2, '0')}:${String(Math.abs(offsetMin) % 60).padStart(2, '0')}`;

  body.replaceChildren(
    ...section(
      t('br.secBrowser'),
      kvTable([
        [t('br.ua'), n.userAgent],
        uaHints && [t('br.brands'), (uaHints.fullVersionList || uaHints.brands || []).map((b) => `${b.brand} ${b.version}`).join(', ')],
        uaHints && [t('br.os'), [uaHints.platform, uaHints.platformVersion].filter(Boolean).join(' ')],
        uaHints && [t('br.cpu'), [uaHints.architecture, uaHints.bitness && `${uaHints.bitness}bit`].filter(Boolean).join(' ')],
        uaHints?.model && [t('br.model'), uaHints.model],
        [t('br.platform'), n.platform],
        [t('br.vendor'), n.vendor],
        [t('br.languages'), (n.languages || [n.language]).join(', ')],
        [t('br.cookie'), yn(n.cookieEnabled)],
        ['Do Not Track', n.doNotTrack === '1' ? t('br.on') : n.doNotTrack === '0' ? t('br.off') : t('br.unset')],
        ['Global Privacy Control', n.globalPrivacyControl === undefined ? t('br.unsupported') : n.globalPrivacyControl ? t('br.on') : t('br.off')],
        [t('br.webdriver'), yn(n.webdriver)],
        [t('br.pdf'), yn(n.pdfViewerEnabled)],
        [t('br.plugins'), n.plugins?.length],
      ]),
    ),
    ...section(
      t('br.secDevice'),
      kvTable([
        [t('br.cores'), n.hardwareConcurrency],
        [t('br.memory'), n.deviceMemory ? t('br.memoryVal', n.deviceMemory) : null],
        [t('br.touch'), n.maxTouchPoints],
        [t('br.storage'), storage],
        conn && [t('br.netType'), [conn.effectiveType, conn.downlink && `${conn.downlink} Mbps`, conn.rtt !== undefined && `RTT ${conn.rtt} ms`].filter(Boolean).join(' / ')],
        conn && [t('br.saveData'), yn(conn.saveData)],
      ]),
    ),
    ...section(
      t('br.secScreen'),
      kvTable([
        [t('br.res'), `${s.width} × ${s.height}`],
        [t('br.avail'), `${s.availWidth} × ${s.availHeight}`],
        [t('br.viewport'), `${innerWidth} × ${innerHeight}`],
        [t('br.dpr'), devicePixelRatio],
        [t('br.depth'), `${s.colorDepth} bit`],
        [t('br.orientation'), s.orientation?.type],
        [t('br.scheme'), mq('(prefers-color-scheme: dark)') ? t('br.dark') : t('br.light')],
        [t('br.reducedMotion'), yn(mq('(prefers-reduced-motion: reduce)'))],
        [t('br.p3'), yn(mq('(color-gamut: p3)'))],
        ['HDR', yn(mq('(dynamic-range: high)'))],
        [t('br.pointer'), mq('(pointer: coarse)') ? t('br.pTouch') : mq('(pointer: fine)') ? t('br.pMouse') : t('br.pNone')],
      ]),
    ),
    ...section(
      t('br.secLocale'),
      kvTable([
        [t('ip.timezone'), `${intl.timeZone}${t('paren', offset)}`],
        [t('br.locale'), intl.locale],
        [t('br.calendar'), intl.calendar],
        [t('br.numbering'), intl.numberingSystem],
        [t('br.now'), new Date().toLocaleString()],
      ]),
    ),
  );
}

// ---------- フィンガープリント ----------

async function canvasFingerprint() {
  const c = el('canvas', { width: 280, height: 60, class: 'canvas-preview' });
  const ctx = c.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = '#f60';
  ctx.fillRect(100, 5, 80, 30);
  ctx.textBaseline = 'alphabetic';
  ctx.font = '16px Arial, sans-serif';
  ctx.fillStyle = '#069';
  ctx.fillText('NetCheck 日本語 😃 fingerprint', 4, 24);
  ctx.fillStyle = 'rgba(102, 204, 0, 0.7)';
  ctx.font = '18px "Times New Roman", serif';
  ctx.fillText('NetCheck 日本語 😃 fingerprint', 8, 46);
  ctx.globalCompositeOperation = 'multiply';
  for (const [color, x] of [['#f0f', 40], ['#0ff', 70], ['#ff0', 55]]) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x + 170, 30, 22, 0, Math.PI * 2);
    ctx.fill();
  }
  return { canvas: c, hash: await sha256(c.toDataURL()) };
}

async function webglFingerprint() {
  const c = document.createElement('canvas');
  const gl = c.getContext('webgl2') || c.getContext('webgl');
  if (!gl) return null;
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  const exts = gl.getSupportedExtensions() || [];
  const out = {
    api: gl instanceof (window.WebGL2RenderingContext || Object) ? 'WebGL 2' : 'WebGL 1',
    vendor: dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
    renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
    version: gl.getParameter(gl.VERSION),
    shading: gl.getParameter(gl.SHADING_LANGUAGE_VERSION),
    maxTexture: gl.getParameter(gl.MAX_TEXTURE_SIZE),
    maxViewport: [...gl.getParameter(gl.MAX_VIEWPORT_DIMS)].join(' × '),
    extensions: exts.length,
  };
  out.hash = await sha256(JSON.stringify([out, exts]));
  return out;
}

async function audioFingerprint() {
  const Ctx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (!Ctx) return null;
  const ctx = new Ctx(1, 5000, 44100);
  const osc = ctx.createOscillator();
  osc.type = 'triangle';
  osc.frequency.value = 10000;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -50;
  comp.knee.value = 40;
  comp.ratio.value = 12;
  comp.attack.value = 0;
  comp.release.value = 0.25;
  osc.connect(comp);
  comp.connect(ctx.destination);
  osc.start(0);
  const buffer = await ctx.startRendering();
  const samples = buffer.getChannelData(0).subarray(4500);
  let sum = 0;
  for (const v of samples) sum += Math.abs(v);
  return { value: sum.toFixed(10), hash: await sha256(sum.toString()) };
}

const FONT_CANDIDATES = [
  'Arial', 'Helvetica', 'Helvetica Neue', 'Times New Roman', 'Courier New', 'Verdana', 'Georgia', 'Tahoma', 'Trebuchet MS',
  'Impact', 'Comic Sans MS', 'Segoe UI', 'Calibri', 'Cambria', 'Consolas', 'San Francisco', 'Menlo', 'Monaco', 'Lucida Grande',
  'Roboto', 'Noto Sans', 'Ubuntu', 'DejaVu Sans', 'Liberation Sans', 'Cantarell',
  'Meiryo', 'Yu Gothic', 'Yu Mincho', 'MS Gothic', 'MS PGothic', 'MS Mincho', 'BIZ UDGothic', 'Hiragino Sans',
  'Hiragino Kaku Gothic ProN', 'Hiragino Mincho ProN', 'Osaka', 'Noto Sans JP', 'Noto Sans CJK JP', 'Noto Serif JP', 'IPAGothic', 'TakaoGothic',
  'Microsoft YaHei', 'SimSun', 'PingFang SC', 'Malgun Gothic', 'Apple SD Gothic Neo',
];

function detectFonts() {
  const bases = ['monospace', 'sans-serif', 'serif'];
  const span = el('span', { style: 'position:absolute;left:-9999px;top:0;font-size:72px;white-space:nowrap;visibility:hidden' }, 'mmmmmmmmmmlli 日本語あ永');
  document.body.append(span);
  const measure = (family) => {
    span.style.fontFamily = family;
    return `${span.offsetWidth}x${span.offsetHeight}`;
  };
  const baseline = Object.fromEntries(bases.map((b) => [b, measure(b)]));
  const found = FONT_CANDIDATES.filter((f) => bases.some((b) => measure(`"${f}", ${b}`) !== baseline[b]));
  span.remove();
  return found;
}

async function initFp() {
  const hero = $('#fp-hero');
  const body = $('#fp-body');
  body.replaceChildren(loading(t('computing')));

  const safe = async (fn) => {
    try {
      return await fn();
    } catch {
      return null;
    }
  };
  const [canvas, webgl, audio] = await Promise.all([safe(canvasFingerprint), safe(webglFingerprint), safe(audioFingerprint)]);
  const fonts = (await safe(detectFonts)) || [];
  const fontsHash = await sha256(fonts.join(','));

  const stable = [
    canvas?.hash, webgl?.hash, audio?.hash, fontsHash,
    navigator.userAgent, navigator.languages?.join(','), navigator.hardwareConcurrency, navigator.deviceMemory,
    screen.width, screen.height, screen.colorDepth, devicePixelRatio,
    Intl.DateTimeFormat().resolvedOptions().timeZone,
  ];
  const id = await sha256(JSON.stringify(stable));
  const short = (h) => (h ? h.slice(0, 16) : null);

  hero.replaceChildren(
    stat(t('fp.id'), short(id), t('fp.idSub'), true),
    stat('Canvas', short(canvas?.hash), null, true),
    stat('WebGL', short(webgl?.hash), null, true),
    stat('Audio', short(audio?.hash), null, true),
  );

  body.replaceChildren(
    note('info', t('fp.intro')),
    ...section(
      'Canvas',
      kvTable([
        [t('fp.hash'), canvas?.hash ?? t('fp.unavailable')],
        canvas && [t('fp.rendering'), canvas.canvas],
      ]),
    ),
    ...section(
      'WebGL',
      webgl
        ? kvTable([
            [t('fp.hash'), webgl.hash],
            [t('fp.gpuVendor'), webgl.vendor],
            ['GPU', webgl.renderer],
            ['API', webgl.api],
            [t('fp.version'), webgl.version],
            [t('fp.shading'), webgl.shading],
            [t('fp.maxTex'), webgl.maxTexture],
            [t('fp.maxView'), webgl.maxViewport],
            [t('fp.extCount'), webgl.extensions],
          ])
        : note('warn', t('fp.noWebgl')),
    ),
    ...section('Audio', audio ? kvTable([[t('fp.hash'), audio.hash], [t('fp.value'), audio.value]]) : note('warn', t('fp.noAudio'))),
    ...section(
      t('fp.fonts', FONT_CANDIDATES.length, fonts.length),
      el('div', { class: 'card' }, el('div', { class: 'chips' }, fonts.length ? fonts.map((f) => el('span', { class: 'chip' }, f)) : el('span', { class: 'muted' }, t('fp.noFonts')))),
      kvTable([[t('fp.hash'), fontsHash]]),
    ),
  );
}

// ---------- WebRTC ----------

const isPrivateIp = (ip) => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|f[cd][0-9a-f]{2}:|fe80:)/i.test(ip);

function gatherCandidates(timeoutMs = 4000) {
  return new Promise((resolve, reject) => {
    let pc;
    try {
      pc = new RTCPeerConnection({ iceServers: [{ urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302'] }] });
    } catch (e) {
      reject(e);
      return;
    }
    const found = new Map();
    const finish = () => {
      clearTimeout(timer);
      pc.close();
      resolve([...found.values()]);
    };
    const timer = setTimeout(finish, timeoutMs);
    pc.onicecandidate = (e) => {
      if (!e.candidate) return finish();
      const parts = e.candidate.candidate.split(' ');
      if (parts.length < 8) return;
      const [, , protocol, , address, , , type] = parts;
      const key = `${address}|${type}`;
      if (!found.has(key)) found.set(key, { address, type, protocol: protocol.toLowerCase() });
    };
    pc.createDataChannel('netcheck');
    pc.createOffer().then((o) => pc.setLocalDescription(o)).catch(reject);
  });
}

async function runWebrtc() {
  const body = $('#webrtc-body');
  const btn = $('#webrtc-run');
  if (!window.RTCPeerConnection) {
    body.replaceChildren(note('ok', t('rtc.disabled')));
    return;
  }
  btn.disabled = true;
  body.replaceChildren(loading(t('rtc.testing')));
  try {
    const [cands, info] = await Promise.all([gatherCandidates(), getInfo().catch(() => null)]);
    const serverIp = info?.ip || null;

    const rows = cands.map((c) => {
      const mdns = c.address.endsWith('.local');
      let verdict;
      if (mdns) verdict = badge('ok', t('rtc.vHidden'));
      else if (c.type === 'host') verdict = badge('warn', isPrivateIp(c.address) ? t('rtc.vLocal') : t('rtc.vDevice'));
      else if (serverIp && c.address === serverIp) verdict = badge('info', t('rtc.vSame'));
      else verdict = badge('bad', t('rtc.vDiff'));
      const typeLabel = ['host', 'srflx', 'prflx', 'relay'].includes(c.type) ? t(`rtc.${c.type}`) : c.type;
      return el('tr', {}, el('td', { class: 'mono' }, c.address), el('td', {}, typeLabel), el('td', {}, c.protocol.toUpperCase()), el('td', {}, verdict));
    });

    const publicIps = [...new Set(cands.filter((c) => c.type !== 'host' && !c.address.endsWith('.local')).map((c) => c.address))];
    const leaked = serverIp ? publicIps.filter((ip) => ip !== serverIp) : [];
    // IPv4とIPv6は元々別アドレスなので、同じ種類のIPが食い違う場合だけ「漏れ」とみなす
    const sameFamilyLeak = leaked.filter((ip) => ip.includes(':') === serverIp.includes(':'));

    let summary;
    if (!cands.length) summary = note('ok', t('rtc.sNone'));
    else if (sameFamilyLeak.length) summary = note('bad', t('rtc.sLeak', serverIp, sameFamilyLeak.join(', ')));
    else if (leaked.length) summary = note('warn', t('rtc.sFamily', serverIp, leaked.join(', ')));
    else if (publicIps.length) summary = note('ok', t('rtc.sSame'));
    else summary = note('ok', t('rtc.sNoPublic'));

    body.replaceChildren(
      summary,
      ...section(t('rtc.secFound'), cands.length ? listTable([t('rtc.thAddress'), t('rtc.thType'), t('rtc.thProtocol'), t('rtc.thVerdict')], rows) : el('p', { class: 'muted' }, t('none'))),
      ...section(t('rtc.secServer'), kvTable([[t('ip.address'), serverIp]])),
    );
  } catch (e) {
    body.replaceChildren(note('bad', t('rtc.fail', e.message)));
  } finally {
    btn.disabled = false;
  }
}

// ---------- DNS伝播 ----------

const answerKey = (r) => (r.error ? null : r.status !== 'NOERROR' ? r.status : r.answers.map((a) => `${a.type} ${a.data}`.toLowerCase()).sort().join('\n'));

function dnsSourceLabel(r) {
  if (r.id === 'custom') return `📍 ${t('dns.custom')}`;
  if (r.cc) {
    let name = r.cc;
    try {
      name = regionNames.of(r.cc);
    } catch {}
    return `${flag(r.cc)} ${name}${r.isp ? ` (${r.isp})` : ''}`;
  }
  return r.label;
}

function dnsTable(title, hint, results, majority, queryType) {
  const rows = results.map((r) => {
    let state;
    let answer;
    if (r.error) {
      state = badge('bad', t('dns.error'));
      answer = el('span', { class: 'muted' }, errText(r.error));
    } else {
      state = answerKey(r) === majority ? badge('ok', t('dns.match')) : badge('warn', t('dns.differs'));
      if (r.status !== 'NOERROR') answer = el('span', { class: 'muted' }, r.status === 'NXDOMAIN' ? t('dns.nx') : r.status);
      else if (!r.answers.length) answer = el('span', { class: 'muted' }, t('dns.noRecords'));
      else answer = r.answers.map((a) => el('div', {}, a.type === queryType ? a.data : `${a.type} ${a.data}`));
    }
    const ttl = r.answers?.length ? Math.min(...r.answers.map((a) => a.ttl)) : null;
    return el(
      'tr',
      {},
      el('td', {}, dnsSourceLabel(r), el('div', { class: 'sub' }, r.note)),
      el('td', { class: 'ans' }, answer),
      el('td', { class: 'num' }, ttl === null ? '—' : t('dns.ttl', ttl)),
      el('td', { class: 'num' }, `${r.ms} ms`),
      el('td', {}, state),
    );
  });
  return [
    el('h2', {}, title),
    el('p', { class: 'sub', style: 'margin:-4px 0 8px' }, hint),
    listTable([t('dns.thSource'), t('dns.thAnswer'), ['TTL'], [t('dns.thTime')], t('dns.thState')], rows),
  ];
}

async function runDns(name, type, ecs) {
  const body = $('#dns-body');
  const btn = $('#dns-form button[type="submit"]');
  btn.disabled = true;
  body.replaceChildren(loading(t('querying')));
  try {
    const qs = new URLSearchParams({ name, type });
    if (ecs) qs.set('ecs', ecs);
    const res = await fetch(`/api/dns?${qs}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

    const ok = data.results.filter((r) => !r.error);
    const counts = new Map();
    for (const r of ok) counts.set(answerKey(r), (counts.get(answerKey(r)) || 0) + 1);
    const majority = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    const agree = counts.get(majority) || 0;
    const failed = data.results.length - ok.length;

    let summary;
    if (!ok.length) summary = note('bad', t('dns.allFailed'));
    else if (counts.size === 1) summary = note('ok', t('dns.allSame', ok.length, failed));
    else summary = note('warn', t('dns.mixed', ok.length, agree));

    const byGroup = (g) => data.results.filter((r) => r.group === g);
    body.replaceChildren(
      el('p', { class: 'sub', style: 'margin:12px 0 0' }, t('dns.recordOf', data.name, data.type)),
      summary,
      ...dnsTable(t('dns.secResolvers'), t('dns.hintResolvers'), byGroup('resolver'), majority, data.type),
      ...dnsTable(t('dns.secGeo'), t('dns.hintGeo'), byGroup('geo'), majority, data.type),
    );
  } catch (e) {
    body.replaceChildren(note('bad', errText(e.message)));
  } finally {
    btn.disabled = false;
  }
}

function initDns() {
  $('#dns-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = $('#dns-name').value.trim();
    if (!name) return;
    const qs = new URLSearchParams({ name, type: $('#dns-type').value });
    if ($('#dns-ecs').value.trim()) qs.set('ecs', $('#dns-ecs').value.trim());
    go('dns', qs);
  });
}

// #dns?name=example.com&type=A の形のURLを共有できる
function queryDns(qs) {
  if (!qs.get('name')) return;
  $('#dns-name').value = qs.get('name');
  if ([...$('#dns-type').options].some((o) => o.value === qs.get('type'))) $('#dns-type').value = qs.get('type');
  $('#dns-ecs').value = qs.get('ecs') || '';
  if (qs.get('ecs')) $('.dns-adv').open = true;
  runDns(qs.get('name'), $('#dns-type').value, qs.get('ecs') || '');
}

// ---------- IP・ドメイン検索 ----------

const looksLikeIp = (q) => /^\[?[0-9a-f:.]+\]?$/i.test(q) && (q.includes(':') || /^\d+\.\d+\.\d+\.\d+$/.test(q));
const ROLES = ['registrant', 'administrative', 'technical', 'abuse', 'registrar', 'billing', 'noc', 'reseller', 'sponsor'];

function entitiesTable(entities) {
  const rows = entities
    .filter((e) => e.name || e.org || e.email || e.tel || e.address)
    .map((e) =>
      el(
        'tr',
        {},
        el('td', {}, e.roles.map((r) => (ROLES.includes(r) ? t(`role.${r}`) : r)).join(t('listSep')) || '—'),
        el('td', {}, e.name || e.org || '—', e.name && e.org && e.org !== e.name ? el('div', { class: 'sub' }, e.org) : null, e.handle ? el('div', { class: 'sub' }, e.handle) : null),
        el('td', { class: 'ans' }, [e.email, e.tel, e.address].filter(Boolean).map((v) => el('div', {}, v))),
      ),
    );
  if (!rows.length) return el('p', { class: 'muted' }, t('lk.noContacts'));
  return listTable([t('lk.thRole'), t('lk.thName'), t('lk.thContact')], rows);
}

const lines = (items) => (items?.length ? items.map((v) => el('div', {}, v)) : null);
const lookupLink = (value) => el('a', { href: `#lookup?q=${encodeURIComponent(value)}` }, value);

function initSearch(tab) {
  $(`#${tab}-form`).addEventListener('submit', (e) => {
    e.preventDefault();
    const q = $(`#${tab}-q`).value.trim();
    if (q) go(tab, new URLSearchParams({ q }));
  });
}

async function runSearch(tab, api, q, render) {
  const body = $(`#${tab}-body`);
  const hero = $(`#${tab}-hero`);
  const btn = $(`#${tab}-form button`);
  $(`#${tab}-q`).value = q;
  btn.disabled = true;
  hero.replaceChildren();
  body.replaceChildren(loading(t('searching')));
  try {
    const res = await fetch(`${api}?${new URLSearchParams({ q })}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    render(data, hero, body);
  } catch (e) {
    body.replaceChildren(note('bad', errText(e.message)));
  } finally {
    btn.disabled = false;
  }
}

// IPの結果の本体。ドメイン検索では brief=true で登録情報を省く
function ipSections(d, { brief = false } = {}) {
  const { asn, rdap, geo } = d;
  const cc = geo?.countryCode || asn?.country || rdap?.country;
  const out = [
    ...section(
      t('lk.secIp'),
      kvTable([
        [t('ip.address'), brief ? lookupLink(d.ip) : `${d.ip}${t('paren', `IPv${d.version}`)}`],
        [t('lk.ptr'), lines(d.ptr.map(lookupLink))],
      ]),
    ),
    ...section(
      t('lk.secGeo'),
      kvTable([
        [t('ip.country'), cc ? `${flag(cc)} ${regionName(cc)}` : null],
        geo && [t('lk.state'), geo.region],
        geo && [t('ip.city'), geo.city],
        geo && [t('lk.isp'), geo.isp],
        [t('lk.org'), geo?.org || rdap?.name],
        [t('lk.network'), asn ? `AS${asn.asn} ${asn.name || ''}` : null],
        [t('lk.prefix'), asn?.prefix],
        geo?.timezone && [t('ip.timezone'), geo.timezone],
        geo?.timezone && [t('lk.localTime'), localTime(geo.timezone)],
        geo?.lat !== null && geo?.lat !== undefined && [t('ip.coords'), `${geo.lat}, ${geo.lon}`],
      ]),
      el('p', { class: 'sub', style: 'margin:6px 2px 0' }, geo ? t('lk.geoNote') : t('lk.countryNote')),
    ),
  ];
  const map = geo && mapFrame(geo.lat, geo.lon);
  if (map) out.push(...section(t('lk.secMap'), map));
  if (brief) return out;

  if (rdap) {
    out.push(
      ...section(
        t('lk.secNetReg'),
        kvTable([
          [t('lk.netName'), rdap.name],
          [t('lk.range'), rdap.start && rdap.end ? `${rdap.start} – ${rdap.end}` : null],
          ['CIDR', lines(rdap.cidr)],
          [t('lk.kind'), rdap.type],
          [t('lk.handle'), rdap.handle],
          [t('lk.parent'), rdap.parent],
          [t('lk.rir'), asn?.registry?.toUpperCase()],
          [t('lk.registered'), fmtDate(rdap.events.registration || asn?.allocated)],
          [t('lk.updated'), fmtDate(rdap.events['last changed'])],
          [t('lk.whoisServer'), rdap.source],
        ]),
      ),
      ...section(t('lk.secContacts'), entitiesTable(rdap.entities)),
      ...(rdap.remarks.length ? section(t('lk.secRemarks'), el('div', { class: 'card' }, el('pre', { class: 'raw' }, rdap.remarks.join('\n')))) : []),
    );
  } else if (!d.errors.rdap) out.push(note('warn', t('lk.noIpReg')));
  return out;
}

const IP_ERROR_KEY = { ptr: 'lk.errPtr', asn: 'lk.errAsn', rdap: 'lk.errRdap', geo: 'lk.errGeo' };
const ipErrors = (d) => Object.keys(d.errors).map((k) => `${t(IP_ERROR_KEY[k])}: ${errText(d.errors[k])}`).join(t('listSep'));

function renderIp(d, hero, body) {
  if (d.special) {
    hero.replaceChildren(stat(t('ip.address'), d.ip, `IPv${d.version}`, true));
    body.replaceChildren(note('info', t('lk.special', d.ip, t(`special.${d.special}`))));
    return;
  }
  const { asn, rdap, geo } = d;
  const cc = geo?.countryCode || asn?.country || rdap?.country;
  hero.replaceChildren(
    stat(t('ip.address'), d.ip, `IPv${d.version}`, true),
    stat(t('ip.operator'), geo?.isp || asn?.name || rdap?.name, asn ? `AS${asn.asn}` : null),
    stat(t('ip.location'), [geo?.city, geo?.region].filter(Boolean).join(', ') || regionName(cc), geo?.city ? regionName(cc) : null),
    stat(t('lk.hostname'), d.ptr[0] || null, d.ptr.length > 1 ? t('lk.more', d.ptr.length - 1) : null),
  );
  fill(body, ipErrors(d) ? note('warn', t('lk.partial', ipErrors(d))) : null, ...ipSections(d));
}

function renderDomain(d, hero, body) {
  const r = d.rdap;
  const expires = r?.events.expiration;
  let remaining = null;
  if (expires && !Number.isNaN(new Date(expires).getTime())) {
    const days = Math.ceil((new Date(expires) - Date.now()) / 864e5);
    remaining = days < 0 ? badge('bad', t('dm.expired')) : badge(days < 30 ? 'warn' : 'ok', t('dm.daysLeft', days));
  }
  hero.replaceChildren(
    stat(t('dm.domain'), d.registered || d.query, d.registered && d.registered !== d.query ? t('dm.registeredFor', d.query) : null, true),
    ...(r ? [stat(t('dm.registrar'), r.registrar?.name, r.registrar?.ianaId ? `IANA ID ${r.registrar.ianaId}` : null), stat(t('lk.registered'), fmtDate(r.events.registration)), stat(t('dm.expires'), fmtDate(expires), remaining)] : []),
  );

  const records = d.dns.flatMap((g) => g.answers || []);
  const dnsFailed = d.dns.filter((g) => g.error).map((g) => g.type);
  const nx = d.dns.some((g) => g.status === 'NXDOMAIN');
  const value = (a) => (a.type === 'A' || a.type === 'AAAA' ? lookupLink(a.data) : a.data);
  const ip = d.ip && !d.ip.special ? d.ip : null;

  fill(
    body,
    d.registered ? null : note('warn', t('dm.notFound', Object.values(d.errors).map(errText).join(t('listSep')))),
    ...(ip ? [...ipSections(ip, { brief: true }), el('p', { style: 'margin:8px 2px 0' }, el('a', { href: `#lookup?q=${encodeURIComponent(ip.ip)}` }, t('dm.moreIp', ip.ip)))] : []),
    ...(r
      ? [
          ...section(
            t('dm.secReg'),
            kvTable([
              [t('dm.name'), d.registered],
              [t('dm.registrar'), r.registrar?.name],
              [t('dm.status'), lines(r.status)],
              [t('dm.nameservers'), lines(r.nameservers)],
              ['DNSSEC', r.dnssec === null ? null : r.dnssec ? t('dm.signed') : t('dm.unsigned')],
              [t('lk.registered'), fmtDate(r.events.registration)],
              [t('dm.expires'), fmtDate(expires)],
              [t('lk.updated'), fmtDate(r.events['last changed'])],
              [t('dm.registryId'), r.handle],
              [t('lk.whoisServer'), r.source],
            ]),
          ),
          ...section(t('lk.secContacts'), entitiesTable(r.entities)),
        ]
      : []),
    ...(d.whois ? section(`WHOIS${t('paren', d.whois.server)}`, el('div', { class: 'card' }, el('pre', { class: 'raw' }, d.whois.text))) : []),
    ...section(
      t('dm.secDns', d.query),
      records.length
        ? listTable(
            [t('dm.thKind'), t('dm.thValue'), ['TTL']],
            records.map((a) => el('tr', {}, el('td', {}, badge('info', a.type)), el('td', { class: 'ans' }, value(a)), el('td', { class: 'num' }, t('dns.ttl', a.ttl)))),
          )
        : el('p', { class: 'muted' }, nx ? t('dm.nxdomain') : t('dm.noRecords')),
      dnsFailed.length ? el('p', { class: 'sub' }, t('dm.failedTypes', dnsFailed.join(', '))) : null,
    ),
  );
}

// ---------- テーマ ----------
// 標準は白と灰色（mono）。タイトル部分を続けて10回クリックすると、隠しテーマのプルダウンが出る。
// 隠しテーマの飾りの文言はそのテーマの国の言語で固定。診断結果の表示は Lang の設定に従う。

const THEMES = {
  mono: { tagline: () => t('tagline'), copyright: '© 2026 NetCheck' },
  jp: {
    marquee: '★☆★ ようこそ NetCheck へ ★☆★　あなたのIPアドレス・ブラウザ・画面サイズ・フォントまで、ぜ～んぶ見えちゃいます　……　ブックマークはトップページにお願いします　……　キリ番を踏んだ方はご一報ください　★☆★',
    tagline: '～ あなたの接続情報 まるみえ診断 ～',
    peekLabel: '！警告！',
    peek: (ip, detail) => `あなたのIPアドレス ${ip}${detail ? `（${detail}）` : ''} は、このサイトから丸見えです！！`,
    counterPre: 'あなたは',
    counterPost: '回目のご訪問です',
    kiriban: '☆ キリ番ゲット！おめでとうございます ☆',
    linkFree: 'このページはリンクフリーです',
    bestViewed: 'Sorry, this page is Japanese only. ／ 推奨環境: 800×600 以上、Internet Explorer 5.5 以上（うそです）',
    copyright: 'Copyright (C) 2026 NetCheck All Rights Reserved.',
  },
  us: {
    marquee: "*** WELCOME 2 NetCheck!!! *** Your IP address, your browser, your screen size, even your FONTS are ALL VISIBLE to this page!!! *** Don't forget to bookmark this site *** Tell ur friends!!! ***",
    tagline: '~*~ The #1 Place On The Web To See What THEY See ~*~',
    peekLabel: '!!! WARNING !!!',
    peek: (ip, detail) => `Your IP address ${ip}${detail ? ` (${detail})` : ''} is EXPOSED to this website!!!`,
    counterPre: 'You have visited this page',
    counterPost: 'times!',
    kiriban: '*** CONGRATS!!! You hit a LUCKY NUMBER! ***',
    linkFree: 'Link to us! Copy our button!',
    bestViewed: 'Best viewed with Netscape Navigator 4.0 at 800x600 (just kidding) :: Made with Notepad',
    copyright: 'Copyright (C) 2026 NetCheck. All Rights Reserved. This page is always under construction.',
  },
  ru: {
    marquee: '★ Добро пожаловать на NetCheck! ★ Ваш IP-адрес, браузер, разрешение экрана и даже шрифты — всё видно как на ладони ★ Добавьте сайт в закладки! ★ Расскажите друзьям! ★',
    tagline: '~ Узнай, что о тебе знает Интернет ~',
    peekLabel: 'ВНИМАНИЕ!',
    peek: (ip, detail) => `Ваш IP-адрес ${ip}${detail ? ` (${detail})` : ''} виден этому сайту!!!`,
    counterPre: 'Вы заходили сюда уже',
    counterPost: 'раз',
    kiriban: '★ Поздравляем! Вам выпало красивое число! ★',
    linkFree: 'Наша кнопка — ставьте ссылку!',
    bestViewed: 'Сайт оптимизирован под Internet Explorer 5.5, разрешение 800×600 (шутка)',
    copyright: 'Copyright © 2026 NetCheck. Все права защищены.',
  },
  // 現代の怪しいサイト風：偽の「利用者の声」が流れ、当選バナーや丸い広告ボタンが浮く（どれも冗談と明記）
  cn: {
    marquee: '📢 用户 138****5521 刚刚查询了自己的IP　·　用户 186****0937 刚刚完成了指纹检测　·　用户 159****7742 领取了新人红包（并没有红包）　·　已有 9,999,999+ 用户信赖本站（数字是编的）',
    tagline: '安全 · 高速 · 永久免费 ｜ 官方正版（自封的）',
    peekLabel: '⚠ 高危',
    peek: (ip, detail) => `检测到您的IP地址 ${ip}${detail ? `（${detail}）` : ''} 已暴露！详情见下方 ↓`,
    counterPre: '您是第',
    counterPost: '次访问本站',
    kiriban: '🎉 恭喜！幸运数字！（没有奖品）',
    linkFree: '扫码下载APP（其实没有APP）',
    bestViewed: '沪ICP备00000000号（假的）｜ 7×24小时在线客服（没有客服）',
    copyright: '© 2026 NetCheck 版权所有',
  },
};

let peekInfo = null; // 警告バナーに出す、訪問者自身のIPと場所

function applyTheme(name) {
  if (!THEMES[name]) name = 'mono';
  const theme = THEMES[name];
  const text = (key) => (typeof theme[key] === 'function' ? theme[key]() : theme[key]);
  document.documentElement.dataset.theme = name;
  for (const node of document.querySelectorAll('[data-t]')) node.textContent = typeof text(node.dataset.t) === 'string' ? text(node.dataset.t) : '';
  $('#theme-select').value = name;
  $('#peek-text').textContent = peekInfo && theme.peek ? theme.peek(peekInfo.ip, peekInfo.detail) : '';
  $('#peek').hidden = !(peekInfo && theme.peek);
  store.set('netcheck-theme', name);
}

// 見えている情報をそのまま出すだけで、保存はしない
getInfo()
  .then((info) => {
    if (!info.ip) return;
    const where = [info.geo.city, info.geo.country].filter(Boolean).join(', ');
    peekInfo = { ip: info.ip, detail: [where, info.network.asOrganization].filter(Boolean).join(' / ') };
    applyTheme(document.documentElement.dataset.theme);
  })
  .catch(() => {});

// 隠しプルダウン：タイトル部分を続けて10回クリックで出す。一度出したら、このブラウザでは出たままにする
const UNLOCK_CLICKS = 10;
let clicks = 0;
let clickTimer;
function unlockThemes() {
  $('#theme-pick').hidden = false;
  store.set('netcheck-unlocked', '1');
}
$('#title-row').addEventListener('click', (e) => {
  if (e.target.closest('#theme-pick, #lang-pick')) return;
  clearTimeout(clickTimer);
  clickTimer = setTimeout(() => (clicks = 0), 2000); // 2秒あいたら数え直し
  if (++clicks >= UNLOCK_CLICKS) {
    clicks = 0;
    unlockThemes();
    $('#theme-select').focus();
  }
});
$('#theme-select').addEventListener('change', (e) => applyTheme(e.target.value));
if (store.get('netcheck-unlocked') === '1') unlockThemes();
applyTheme(document.documentElement.dataset.theme);

// 訪問回数はこのブラウザの中だけで数える（サーバーには送らない）
const visits = Number(store.get('netcheck-visits') || 0) + 1;
store.set('netcheck-visits', String(visits));
$('#counter').replaceChildren(...String(visits).padStart(6, '0').split('').map((n) => el('span', {}, n)));
if (visits % 100 === 0 || (visits > 10 && /^(\d)\1+$/.test(String(visits)))) $('#kiriban').hidden = false;

// 中国テーマの飾りボタン：押しても何も起きず、冗談だと知らせるだけ
let toastTimer;
function toast(message) {
  const box = $('#toast');
  box.textContent = message;
  box.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (box.hidden = true), 2200);
}
for (const btn of document.querySelectorAll('[data-joke]')) btn.addEventListener('click', () => toast('开玩笑的，这里什么都没有 :)'));
$('#cn-bar-close').addEventListener('click', () => ($('#cn-bar').hidden = true));

// ---------- タブ切り替え ----------

const INIT = {
  ip: initIp,
  browser: initBrowser,
  fp: initFp,
  webrtc: () => {
    $('#webrtc-run').addEventListener('click', runWebrtc);
    runWebrtc();
  },
  dns: initDns,
  lookup: () => initSearch('lookup'),
};
// ハッシュの「?」以降（検索条件）を受け取って実行するタブ
const QUERY = {
  dns: queryDns,
  lookup: (qs) => {
    const q = (qs.get('q') || '').trim();
    if (!q) return;
    // 入力がIPアドレスの形ならIP検索、それ以外はドメイン検索に振り分ける
    if (looksLikeIp(q)) runSearch('lookup', '/api/ip', q, renderIp);
    else runSearch('lookup', '/api/domain', q, renderDomain);
  },
};
const started = new Set();
const lastQuery = {};

function activate() {
  let [tab, query = ''] = location.hash.slice(1).split('?');
  if (!TABS.includes(tab)) tab = 'ip';
  for (const panel of document.querySelectorAll('[data-panel]')) panel.hidden = panel.dataset.panel !== tab;
  for (const btn of document.querySelectorAll('.tabs [data-tab]')) btn.setAttribute('aria-selected', String(btn.dataset.tab === tab));
  $('.tab-select').value = tab;
  if (!started.has(tab)) {
    started.add(tab); // 各タブの診断は初めて開いたときに一度だけ走らせる
    INIT[tab]();
  }
  if (query && QUERY[tab] && lastQuery[tab] !== query) {
    lastQuery[tab] = query;
    QUERY[tab](new URLSearchParams(query));
    scrollTo(0, 0);
  }
}

// 検索の実行。条件をURLに残すので、そのまま共有や「戻る」ができる
function go(tab, qs) {
  lastQuery[tab] = undefined;
  const before = location.href;
  location.hash = `${tab}?${qs}`;
  if (location.href === before) activate(); // 同じ条件での再検索は hashchange が起きない
}

// タブを切り替えても、そのタブで最後に見ていた検索結果のURLに戻す
const tabHash = (tab) => (lastQuery[tab] ? `${tab}?${lastQuery[tab]}` : tab);
for (const btn of document.querySelectorAll('.tabs [data-tab]')) btn.addEventListener('click', () => (location.hash = tabHash(btn.dataset.tab)));
$('.tab-select').addEventListener('change', (e) => (location.hash = tabHash(e.target.value)));
addEventListener('hashchange', activate);
activate();
