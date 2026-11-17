// NetCheck フロントエンド。タブ（狭い画面ではプルダウン）で各診断を切り替える。

const $ = (sel, root = document) => root.querySelector(sel);
const TABS = ['ip', 'browser', 'fp', 'webrtc', 'dns', 'lookup'];

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
const loading = (text = '取得中…') => el('p', { class: 'muted' }, text);

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

// ---------- IP・接続 ----------

async function initIp() {
  const hero = $('#ip-hero');
  const body = $('#ip-body');
  body.replaceChildren(loading());
  let info;
  try {
    info = await getInfo();
  } catch (e) {
    body.replaceChildren(note('bad', `接続情報を取得できませんでした（${e.message}）`));
    return;
  }
  const { geo, network, connection } = info;
  const place = [geo.city, geo.region, geo.country].filter(Boolean).join(', ');

  hero.replaceChildren(
    stat('IPアドレス', info.ip, info.ipVersion ? `IPv${info.ipVersion}` : null, true),
    stat('場所（推定）', place || null, geo.timezone),
    stat('プロバイダー', network.asOrganization, network.asn ? `AS${network.asn}` : null),
    stat('通信', connection.httpProtocol, connection.tlsVersion),
  );

  const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const tzNote =
    geo.timezone && browserTz && geo.timezone !== browserTz
      ? note('warn', `IPから推定したタイムゾーン（${geo.timezone}）と、ブラウザのタイムゾーン（${browserTz}）が違います。VPNやプロキシを使っていると、サイト側からこの食い違いが見えます。`)
      : null;

  const map =
    geo.latitude && geo.longitude
      ? el('a', { href: `https://www.openstreetmap.org/?mlat=${geo.latitude}&mlon=${geo.longitude}#map=9/${geo.latitude}/${geo.longitude}`, target: '_blank', rel: 'noopener' }, `${geo.latitude}, ${geo.longitude}`)
      : null;

  body.replaceChildren(
    ...[tzNote,
    info.ip ? el('p', { style: 'margin:14px 0 0' }, el('a', { href: `#lookup?q=${encodeURIComponent(info.ip)}` }, 'このIPの登録情報を調べる →')) : null].filter(Boolean),
    ...section(
      '位置情報（IPからの推定）',
      kvTable([
        ['国', geo.country ? `${geo.country}${geo.isEUCountry ? '（EU）' : ''}` : null],
        ['地域', [geo.region, geo.regionCode && `(${geo.regionCode})`].filter(Boolean).join(' ')],
        ['市区町村', geo.city],
        ['郵便番号', geo.postalCode],
        ['緯度・経度', map],
        ['タイムゾーン', geo.timezone],
        ['大陸', geo.continent],
      ]),
    ),
    ...section(
      'ネットワーク',
      kvTable([
        ['AS番号', network.asn ? `AS${network.asn}` : null],
        ['事業者', network.asOrganization],
        ['接続先のCloudflare拠点', network.colo],
      ]),
    ),
    ...section(
      '接続',
      kvTable([
        ['HTTPバージョン', connection.httpProtocol],
        ['TLSバージョン', connection.tlsVersion],
        ['暗号スイート', connection.tlsCipher],
        ['TCP往復時間', connection.clientTcpRtt ? `${connection.clientTcpRtt} ms` : null],
        ['対応する圧縮方式', connection.clientAcceptEncoding],
      ]),
    ),
    ...section('リクエストヘッダー', kvTable(info.headers.map((h) => [h.name, h.value]))),
  );
}

// ---------- ブラウザ ----------

async function initBrowser() {
  const body = $('#browser-body');
  const n = navigator;
  const s = screen;
  const intl = Intl.DateTimeFormat().resolvedOptions();
  const yn = (v) => (v === undefined || v === null ? null : v ? 'はい' : 'いいえ');
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
      'ブラウザ',
      kvTable([
        ['ユーザーエージェント', n.userAgent],
        uaHints && ['ブランドとバージョン', (uaHints.fullVersionList || uaHints.brands || []).map((b) => `${b.brand} ${b.version}`).join(', ')],
        uaHints && ['OS', [uaHints.platform, uaHints.platformVersion].filter(Boolean).join(' ')],
        uaHints && ['CPUの種類', [uaHints.architecture, uaHints.bitness && `${uaHints.bitness}bit`].filter(Boolean).join(' ')],
        uaHints?.model && ['機種', uaHints.model],
        ['プラットフォーム', n.platform],
        ['ベンダー', n.vendor],
        ['言語', (n.languages || [n.language]).join(', ')],
        ['Cookie', yn(n.cookieEnabled)],
        ['Do Not Track', n.doNotTrack === '1' ? '有効' : n.doNotTrack === '0' ? '無効' : '未設定'],
        ['Global Privacy Control', n.globalPrivacyControl === undefined ? '非対応' : n.globalPrivacyControl ? '有効' : '無効'],
        ['自動操作（webdriver）', yn(n.webdriver)],
        ['PDFビューアー内蔵', yn(n.pdfViewerEnabled)],
        ['プラグイン数', n.plugins?.length],
      ]),
    ),
    ...section(
      '端末',
      kvTable([
        ['CPUの論理コア数', n.hardwareConcurrency],
        ['メモリー（概算）', n.deviceMemory ? `${n.deviceMemory} GB 以上` : null],
        ['タッチ点数', n.maxTouchPoints],
        ['使えるストレージ（概算）', storage],
        conn && ['回線の種類', [conn.effectiveType, conn.downlink && `${conn.downlink} Mbps`, conn.rtt !== undefined && `RTT ${conn.rtt} ms`].filter(Boolean).join(' / ')],
        conn && ['データセーバー', yn(conn.saveData)],
      ]),
    ),
    ...section(
      '画面',
      kvTable([
        ['画面の解像度', `${s.width} × ${s.height}`],
        ['使える領域', `${s.availWidth} × ${s.availHeight}`],
        ['ウィンドウの表示領域', `${innerWidth} × ${innerHeight}`],
        ['ピクセル比', devicePixelRatio],
        ['色深度', `${s.colorDepth} bit`],
        ['画面の向き', s.orientation?.type],
        ['配色の設定', mq('(prefers-color-scheme: dark)') ? 'ダーク' : 'ライト'],
        ['動きを減らす設定', yn(mq('(prefers-reduced-motion: reduce)'))],
        ['広色域（P3）', yn(mq('(color-gamut: p3)'))],
        ['HDR', yn(mq('(dynamic-range: high)'))],
        ['主な入力', mq('(pointer: coarse)') ? 'タッチ' : mq('(pointer: fine)') ? 'マウス' : 'なし'],
      ]),
    ),
    ...section(
      '地域と時刻',
      kvTable([
        ['タイムゾーン', `${intl.timeZone}（${offset}）`],
        ['ロケール', intl.locale],
        ['暦', intl.calendar],
        ['数字の体系', intl.numberingSystem],
        ['現在時刻', new Date().toLocaleString()],
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
  body.replaceChildren(loading('計算中…'));

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
    stat('この端末の識別ID', short(id), '下の値をすべて組み合わせたもの', true),
    stat('Canvas', short(canvas?.hash), null, true),
    stat('WebGL', short(webgl?.hash), null, true),
    stat('Audio', short(audio?.hash), null, true),
  );

  body.replaceChildren(
    note('info', '同じ端末・同じブラウザなら、Cookieを消してもシークレットモードにしても、ここのIDは基本的に変わりません。IDが毎回変わるなら、ブラウザのフィンガープリント対策が効いています。'),
    ...section(
      'Canvas',
      kvTable([
        ['ハッシュ', canvas?.hash ?? '取得できません'],
        canvas && ['描画結果', canvas.canvas],
      ]),
    ),
    ...section(
      'WebGL',
      webgl
        ? kvTable([
            ['ハッシュ', webgl.hash],
            ['GPUベンダー', webgl.vendor],
            ['GPU', webgl.renderer],
            ['API', webgl.api],
            ['バージョン', webgl.version],
            ['シェーダー言語', webgl.shading],
            ['最大テクスチャーサイズ', webgl.maxTexture],
            ['最大ビューポート', webgl.maxViewport],
            ['拡張機能の数', webgl.extensions],
          ])
        : note('warn', 'WebGLが使えないか、無効になっています。'),
    ),
    ...section(
      'Audio',
      audio ? kvTable([['ハッシュ', audio.hash], ['計算値', audio.value]]) : note('warn', 'オーディオのフィンガープリントを取得できません。'),
    ),
    ...section(
      `フォント（候補${FONT_CANDIDATES.length}個中 ${fonts.length}個を検出）`,
      el('div', { class: 'card' }, el('div', { class: 'chips' }, fonts.length ? fonts.map((f) => el('span', { class: 'chip' }, f)) : el('span', { class: 'muted' }, '検出なし'))),
      kvTable([['ハッシュ', fontsHash]]),
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
    body.replaceChildren(note('ok', 'このブラウザではWebRTCが無効になっています。WebRTC経由でIPが漏れることはありません。'));
    return;
  }
  btn.disabled = true;
  body.replaceChildren(loading('テスト中…（数秒かかります）'));
  try {
    const [cands, info] = await Promise.all([gatherCandidates(), getInfo().catch(() => null)]);
    const serverIp = info?.ip || null;
    const TYPE_LABEL = { host: 'ローカル', srflx: '外部（STUN）', prflx: '外部（ピア）', relay: 'リレー' };

    const rows = cands.map((c) => {
      const mdns = c.address.endsWith('.local');
      let verdict;
      if (mdns) verdict = badge('ok', '隠されている');
      else if (c.type === 'host') verdict = isPrivateIp(c.address) ? badge('warn', 'ローカルIPが見える') : badge('warn', '端末のIPが見える');
      else if (serverIp && c.address === serverIp) verdict = badge('info', 'サイトから見えるIPと同じ');
      else verdict = badge('bad', 'サイトから見えるIPと違う');
      return el('tr', {}, el('td', { class: 'mono' }, c.address), el('td', {}, TYPE_LABEL[c.type] || c.type), el('td', {}, c.protocol.toUpperCase()), el('td', {}, verdict));
    });

    const publicIps = [...new Set(cands.filter((c) => c.type !== 'host' && !c.address.endsWith('.local')).map((c) => c.address))];
    const leaked = serverIp ? publicIps.filter((ip) => ip !== serverIp) : [];
    // IPv4とIPv6は元々別アドレスなので、同じ種類のIPが食い違う場合だけ「漏れ」とみなす
    const sameFamilyLeak = leaked.filter((ip) => ip.includes(':') === serverIp.includes(':'));

    let summary;
    if (!cands.length) summary = note('ok', 'WebRTCからIPアドレスは取得されませんでした。');
    else if (sameFamilyLeak.length) summary = note('bad', `サイトから見えるIP（${serverIp}）とは別の外部IP（${sameFamilyLeak.join(', ')}）がWebRTC経由で見えています。VPNやプロキシを使っているなら、本来のIPが漏れています。`);
    else if (leaked.length) summary = note('warn', `サイトから見えるIP（${serverIp}）とは種類の違う外部IP（${leaked.join(', ')}）が見えています。IPv4とIPv6の違いによるものなら通常の動作ですが、VPNが片方しか通していない場合は漏れになります。`);
    else if (publicIps.length) summary = note('ok', 'WebRTCで見える外部IPは、サイトから見えるIPと同じです。追加の漏れはありません。');
    else summary = note('ok', '外部IPはWebRTCから取得されませんでした。');

    body.replaceChildren(
      summary,
      ...section(
        '見つかったアドレス',
        cands.length
          ? el('div', { class: 'card' }, el('table', { class: 'list' }, el('thead', {}, el('tr', {}, el('th', {}, 'アドレス'), el('th', {}, '種類'), el('th', {}, 'プロトコル'), el('th', {}, '判定'))), el('tbody', {}, rows)))
          : el('p', { class: 'muted' }, 'なし'),
      ),
      ...section('サイトから見えるIP', kvTable([['IPアドレス', serverIp]])),
    );
  } catch (e) {
    body.replaceChildren(note('bad', `テストに失敗しました（${e.message}）`));
  } finally {
    btn.disabled = false;
  }
}

// ---------- DNS伝播 ----------

const answerKey = (r) => (r.error ? null : r.status !== 'NOERROR' ? r.status : r.answers.map((a) => `${a.type} ${a.data}`.toLowerCase()).sort().join('\n'));

function dnsTable(title, hint, results, majority) {
  const rows = results.map((r) => {
    let state;
    let answer;
    if (r.error) {
      state = badge('bad', 'エラー');
      answer = el('span', { class: 'muted' }, r.error);
    } else {
      const key = answerKey(r);
      state = key === majority ? badge('ok', '多数派と一致') : badge('warn', '他と違う');
      if (r.status !== 'NOERROR') answer = el('span', { class: 'muted' }, r.status === 'NXDOMAIN' ? 'NXDOMAIN（存在しない）' : r.status);
      else if (!r.answers.length) answer = el('span', { class: 'muted' }, 'レコードなし');
      else answer = r.answers.map((a) => el('div', {}, a.type === results.queryType ? a.data : `${a.type} ${a.data}`));
    }
    const ttl = r.answers?.length ? Math.min(...r.answers.map((a) => a.ttl)) : null;
    return el(
      'tr',
      {},
      el('td', {}, r.flag ? `${r.flag} ` : '', r.label, el('div', { class: 'sub' }, r.note)),
      el('td', { class: 'ans' }, answer),
      el('td', { class: 'num' }, ttl === null ? '—' : `${ttl}秒`),
      el('td', { class: 'num' }, `${r.ms} ms`),
      el('td', {}, state),
    );
  });
  return [
    el('h2', {}, title),
    el('p', { class: 'sub', style: 'margin:-4px 0 8px' }, hint),
    el(
      'div',
      { class: 'card' },
      el(
        'table',
        { class: 'list' },
        el('thead', {}, el('tr', {}, el('th', {}, '問い合わせ元'), el('th', {}, '回答'), el('th', { class: 'num' }, 'TTL'), el('th', { class: 'num' }, '応答'), el('th', {}, '状態'))),
        el('tbody', {}, rows),
      ),
    ),
  ];
}

async function runDns(name, type, ecs) {
  const body = $('#dns-body');
  const btn = $('#dns-form button[type="submit"]');
  btn.disabled = true;
  body.replaceChildren(loading('問い合わせ中…'));
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
    if (!ok.length) summary = note('bad', 'すべての問い合わせが失敗しました。');
    else if (counts.size === 1) summary = note('ok', `応答した${ok.length}か所すべてが同じ回答です。${failed ? `（${failed}か所は応答なし）` : ''}`);
    else summary = note('warn', `${ok.length}か所中${agree}か所が同じ回答で、${ok.length - agree}か所は違う回答です。変更直後なら伝播の途中です。CDNなど地域ごとに回答を変えるサービスでは、違っていて正常です。`);

    const byGroup = (g) => Object.assign(data.results.filter((r) => r.group === g), { queryType: data.type });
    body.replaceChildren(
      el('p', { class: 'sub', style: 'margin:12px 0 0' }, `${data.name} の ${data.type} レコード`),
      summary,
      ...dnsTable('公開DNSリゾルバー', '各社の公開DNSに同じ問い合わせを送った結果です。', byGroup('resolver'), majority),
      ...dnsTable('地域別（擬似）', 'Google Public DNSに「その地域のユーザーからの問い合わせ」として送った結果です。括弧内のサブネットは目安です。', byGroup('geo'), majority),
    );
  } catch (e) {
    body.replaceChildren(note('bad', e.message));
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

const regionNames = new Intl.DisplayNames(['ja'], { type: 'region' });
function regionName(cc) {
  if (!cc) return null;
  try {
    return `${regionNames.of(cc.toUpperCase())}（${cc.toUpperCase()}）`;
  } catch {
    return cc;
  }
}

function fmtDate(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric' });
}

const ROLE_LABEL = {
  registrant: '登録者', administrative: '管理担当', technical: '技術担当', abuse: '不正利用の連絡先',
  registrar: 'レジストラ', billing: '請求担当', noc: 'ネットワーク運用', reseller: '再販業者', sponsor: 'スポンサー',
};

function entitiesTable(entities) {
  const rows = entities
    .filter((e) => e.name || e.org || e.email || e.tel || e.address)
    .map((e) =>
      el(
        'tr',
        {},
        el('td', {}, e.roles.map((r) => ROLE_LABEL[r] || r).join('、') || '—'),
        el('td', {}, e.name || e.org || '—', e.name && e.org && e.org !== e.name ? el('div', { class: 'sub' }, e.org) : null, e.handle ? el('div', { class: 'sub' }, e.handle) : null),
        el('td', { class: 'ans' }, [e.email, e.tel, e.address].filter(Boolean).map((v) => el('div', {}, v))),
      ),
    );
  if (!rows.length) return el('p', { class: 'muted' }, '公開されている連絡先はありません。');
  return el('div', { class: 'card' }, el('table', { class: 'list' }, el('thead', {}, el('tr', {}, el('th', {}, '役割'), el('th', {}, '名前'), el('th', {}, '連絡先'))), el('tbody', {}, rows)));
}

const lines = (items) => (items?.length ? items.map((v) => el('div', {}, v)) : null);
const ipLink = (ip) => el('a', { href: `#lookup?q=${encodeURIComponent(ip)}` }, ip);
const domainLink = (name) => el('a', { href: `#lookup?q=${encodeURIComponent(name)}` }, name);

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
  body.replaceChildren(loading('検索中…'));
  try {
    const res = await fetch(`${api}?${new URLSearchParams({ q })}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    render(data, hero, body);
  } catch (e) {
    body.replaceChildren(note('bad', e.message));
  } finally {
    btn.disabled = false;
  }
}

// ---------- IPアドレスの結果 ----------

function renderIp(d, hero, body) {
  if (d.special) {
    hero.replaceChildren(stat('IPアドレス', d.ip, `IPv${d.version}`, true));
    body.replaceChildren(note('info', `${d.ip} は${d.special}です。インターネット上の登録情報はありません。`));
    return;
  }
  const { asn, rdap } = d;
  const country = asn?.country || rdap?.country;
  hero.replaceChildren(
    stat('IPアドレス', d.ip, `IPv${d.version}`, true),
    stat('事業者', asn?.name || rdap?.name, asn ? `AS${asn.asn}` : null),
    stat('登録国', regionName(country)),
    stat('逆引きホスト名', d.ptr[0] || null, d.ptr.length > 1 ? `ほか${d.ptr.length - 1}件` : null),
  );

  const failed = Object.keys(d.errors);
  const LABEL = { ptr: '逆引き', asn: 'AS番号', rdap: '登録情報' };
  fill(body,
    failed.length ? note('warn', `一部の情報を取得できませんでした（${failed.map((k) => `${LABEL[k]}: ${d.errors[k]}`).join('、')}）`) : null,
    ...section(
      '経路とAS',
      kvTable([
        ['逆引きホスト名', lines(d.ptr.map(domainLink))],
        ['AS番号', asn ? `AS${asn.asn}` : null],
        ['AS名', asn?.name],
        ['経路（プレフィックス）', asn?.prefix],
        ['割り当て元', asn?.registry?.toUpperCase()],
        ['割り当て日', fmtDate(asn?.allocated)],
        ['登録国', regionName(country)],
      ]),
      el('p', { class: 'sub', style: 'margin:6px 2px 0' }, '登録国はアドレスが割り当てられた先の国で、実際に使われている場所とは限りません。'),
    ),
    ...(rdap
      ? [
          ...section(
            'ネットワークの登録情報',
            kvTable([
              ['ネットワーク名', rdap.name],
              ['範囲', rdap.start && rdap.end ? `${rdap.start} – ${rdap.end}` : null],
              ['CIDR', lines(rdap.cidr)],
              ['種別', rdap.type],
              ['ハンドル', rdap.handle],
              ['上位ネットワーク', rdap.parent],
              ['登録日', fmtDate(rdap.events.registration)],
              ['最終更新', fmtDate(rdap.events['last changed'])],
              ['WHOISサーバー', rdap.source],
            ]),
          ),
          ...section('連絡先', entitiesTable(rdap.entities)),
          ...(rdap.remarks.length ? section('備考', el('div', { class: 'card' }, el('pre', { class: 'raw' }, rdap.remarks.join('\n')))) : []),
        ]
      : d.errors.rdap
        ? []
        : [note('warn', 'このIPの登録情報は見つかりませんでした。')]),
  );
}

// ---------- ドメインの結果 ----------

function renderDomain(d, hero, body) {
  const r = d.rdap;
  const expires = r?.events.expiration;
  let remaining = null;
  if (expires && !Number.isNaN(new Date(expires).getTime())) {
    const days = Math.ceil((new Date(expires) - Date.now()) / 864e5);
    remaining = days < 0 ? badge('bad', '期限切れ') : badge(days < 30 ? 'warn' : 'ok', `残り${days}日`);
  }
  hero.replaceChildren(
    stat('ドメイン', d.registered || d.query, d.registered && d.registered !== d.query ? `${d.query} の登録元` : null, true),
    ...(r ? [stat('レジストラ', r.registrar?.name, r.registrar?.ianaId ? `IANA ID ${r.registrar.ianaId}` : null), stat('登録日', fmtDate(r.events.registration)), stat('有効期限', fmtDate(expires), remaining)] : []),
  );

  const records = d.dns.flatMap((g) => (g.answers || []).map((a) => ({ ...a })));
  const dnsFailed = d.dns.filter((g) => g.error).map((g) => g.type);
  const nx = d.dns.some((g) => g.status === 'NXDOMAIN');
  const value = (a) => (a.type === 'A' || a.type === 'AAAA' ? ipLink(a.data) : a.data);

  const errs = Object.values(d.errors);
  let regNote = null;
  if (!d.registered) regNote = note('warn', `登録情報が見つかりませんでした。未登録か、このドメインの種類では登録情報が公開されていない可能性があります。${errs.length ? `（${errs.join('、')}）` : ''}`);

  fill(body,
    regNote,
    ...(r
      ? [
          ...section(
            '登録情報',
            kvTable([
              ['状態', lines(r.status)],
              ['ネームサーバー', lines(r.nameservers)],
              ['DNSSEC', r.dnssec === null ? null : r.dnssec ? '署名あり' : '署名なし'],
              ['登録日', fmtDate(r.events.registration)],
              ['有効期限', fmtDate(expires)],
              ['最終更新', fmtDate(r.events['last changed'])],
              ['レジストリのID', r.handle],
              ['WHOISサーバー', r.source],
            ]),
          ),
          ...section('連絡先', entitiesTable(r.entities)),
        ]
      : []),
    ...(d.whois ? section(`WHOIS（${d.whois.server}）`, el('div', { class: 'card' }, el('pre', { class: 'raw' }, d.whois.text))) : []),
    ...section(
      `DNSレコード（${d.query}）`,
      records.length
        ? el(
            'div',
            { class: 'card' },
            el(
              'table',
              { class: 'list' },
              el('thead', {}, el('tr', {}, el('th', {}, '種類'), el('th', {}, '値'), el('th', { class: 'num' }, 'TTL'))),
              el('tbody', {}, records.map((a) => el('tr', {}, el('td', {}, badge('info', a.type)), el('td', { class: 'ans' }, value(a)), el('td', { class: 'num' }, `${a.ttl}秒`)))),
            ),
          )
        : el('p', { class: 'muted' }, nx ? 'この名前はDNSに存在しません（NXDOMAIN）。' : 'レコードが見つかりませんでした。'),
      dnsFailed.length ? el('p', { class: 'sub' }, `取得に失敗した種類: ${dnsFailed.join(', ')}`) : null,
    ),
  );
}

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
