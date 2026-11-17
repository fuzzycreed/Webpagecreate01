// NetCheck フロントエンド。タブ（狭い画面ではプルダウン）で各診断を切り替える。
// 表示言語は英語が標準で、ヘッダー右上の Lang プルダウンで切り替える（I18N に言語を足せば増やせる）。

import { I18N } from './i18n.js';
import { parseIpRdap, parseDomainRdap, rdapIpUrls } from './rdap.js';
import { normalizeCerts, certsUrl } from './certs.js';

const $ = (sel, root = document) => root.querySelector(sel);
const TABS = ['ip', 'browser', 'fp', 'webrtc', 'dns', 'lookup', 'ports', 'http', 'certs'];

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

// 見出しつきのまとまり。配列で返すのは、呼び出し側が ...section(...) と並べて書けるようにするため
const section = (title, ...body) => [el('section', { class: 'sec' }, el('h2', {}, title), ...body)];
// PC幅では横に2列、スマホ幅では縦に並ぶ入れ物。各引数が1列になる
const cols = (...columns) => el('div', { class: 'cols' }, columns.map((c) => el('div', {}, c)));
const stat = (k, v, s, mono) => el('div', { class: 'stat' }, el('div', { class: 'k' }, k), el('div', { class: `v${mono ? ' mono' : ''}` }, show(v)), s ? el('div', { class: 's' }, s) : null);
// Tor出口ノードかどうかの表示。分からないとき（null）は空欄にする
const torCell = (tor) => (tor === true ? badge('warn', t('yes')) : tor === false ? t('no') : null);
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
  infoPromise ??= (async () => {
    const started = performance.now();
    const r = await fetch('/api/info');
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    data.measuredMs = Math.round(performance.now() - started); // ブラウザ側で測った、問い合わせ1回の所要時間
    return data;
  })();
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

// 地図は Leaflet（public/vendor/leaflet に同梱）で描く。必要になるまで読み込まない
let leafletPromise;
function loadLeaflet() {
  leafletPromise ??= new Promise((resolve, reject) => {
    document.head.append(el('link', { rel: 'stylesheet', href: '/vendor/leaflet/leaflet.css' }));
    const script = el('script', { src: '/vendor/leaflet/leaflet.js' });
    script.onload = () => {
      window.L.Icon.Default.imagePath = '/vendor/leaflet/images/';
      resolve(window.L);
    };
    script.onerror = () => reject(new Error('leaflet'));
    document.head.append(script);
  });
  return leafletPromise;
}

async function drawMap(box) {
  try {
    const L = await loadLeaflet();
    const pos = [Number(box.dataset.lat), Number(box.dataset.lon)];
    const map = L.map(box, { scrollWheelZoom: false, attributionControl: false }).setView(pos, 6);
    // 出典は「© OpenStreetMap contributors」だけを出す（表示言語に関係なく固定）
    L.control.attribution({ prefix: false }).addTo(map);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 18,
      attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors',
    }).addTo(map);
    L.marker(pos, { keyboard: false }).addTo(map);
  } catch {
    box.remove();
  }
}

// 画面に入ったときに初めて描く（隠れているタブの中では大きさが決まらないため）
const mapObserver = new IntersectionObserver((entries) => {
  for (const entry of entries) {
    if (!entry.isIntersecting) continue;
    mapObserver.unobserve(entry.target);
    drawMap(entry.target);
  }
});

function mapFrame(lat, lon) {
  lat = Number(lat);
  lon = Number(lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const box = el('div', { class: 'map', 'aria-label': t('mapTitle'), 'data-lat': lat, 'data-lon': lon });
  mapObserver.observe(box);
  return box;
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
    cols(
      [
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
        ...section(
          t('ip.secNetwork'),
          kvTable([
            [t('ip.asn'), network.asn ? `AS${network.asn}` : null],
            [t('ip.operator'), network.asOrganization],
            [t('ip.colo'), network.colo],
            [t('ip.tor'), torCell(info.tor)],
          ]),
        ),
      ],
      [
        ...(map ? section(t('ip.secMap'), map) : []),
        ...section(
          t('ip.secConn'),
          kvTable([
            [t('ip.http'), connection.httpProtocol],
            [t('ip.tls'), connection.tlsVersion],
            [t('ip.cipher'), connection.tlsCipher],
            [t('ip.latency'), `${info.measuredMs} ms`],
            [t('ip.encodings'), connection.clientAcceptEncoding],
          ]),
        ),
      ],
    ),
    ...section(t('ip.secHeaders'), kvTable(info.headers.map((h) => [h.name, h.value]))),
  );
}

// ---------- ブラウザ ----------

async function initBrowser() {
  const body = $('#browser-body');
  body.classList.add('masonry');
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
  body.classList.add('masonry');

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
  return section(title, el('p', { class: 'sub', style: 'margin:0 0 6px' }, hint), listTable([t('dns.thSource'), t('dns.thAnswer'), ['TTL'], [t('dns.thTime')], t('dns.thState')], rows));
}

// 世界地図（国境の線画。public/world-110m.json、Natural Earth 由来）に、地域別の結果を印で置く
let worldPromise;
const loadWorld = () =>
  (worldPromise ??= fetch('/world-110m.json').then((r) => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  }));

function svg(tag, attrs = {}, ...children) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  node.append(...children);
  return node;
}

const PIN_MARK = { ok: '✓', warn: '!', bad: '✕' };
// ok = 多数派と同じ回答、warn = 違う回答、bad = エラーか回答なし
const pinState = (r, majority) => (r.error || r.status !== 'NOERROR' || !r.answers.length ? 'bad' : answerKey(r) === majority ? 'ok' : 'warn');

function dnsMap(results, majority) {
  const placed = results.filter((r) => Number.isFinite(r.lat) && Number.isFinite(r.lon));
  if (!placed.length) return [];
  const box = el('div', { class: 'worldmap' });
  loadWorld()
    .then((world) => {
      const root = svg('svg', { viewBox: world.viewBox, role: 'img', 'aria-label': t('dns.secMap') }, svg('path', { class: 'land', d: world.d }));
      // 回答なし・違う回答の印を上に重ねて、埋もれないようにする
      const order = { ok: 0, warn: 1, bad: 2 };
      const pins = placed.map((r) => ({ r, state: pinState(r, majority) })).sort((a, b) => order[a.state] - order[b.state]);
      for (const { r, state } of pins) {
        const x = ((r.lon + 180) / 360) * world.width;
        const y = ((90 - r.lat) / 180) * world.height;
        const answer = r.error ? errText(r.error) : r.status !== 'NOERROR' ? r.status : r.answers.map((a) => a.data).join(', ') || t('dns.noRecords');
        root.append(svg('g', { class: `pin ${state}`, transform: `translate(${x.toFixed(1)} ${y.toFixed(1)})` }, svg('title', {}, `${dnsSourceLabel(r)}: ${answer}`), svg('circle', {}), svg('text', {}, PIN_MARK[state])));
      }
      box.append(root);
    })
    .catch(() => box.closest('.sec')?.remove());
  const legend = el(
    'p',
    { class: 'legend' },
    [['ok', t('dns.match')], ['warn', t('dns.differs')], ['bad', `${t('dns.error')} / ${t('dns.noRecords')}`]].map(([state, label]) => el('span', {}, el('span', { class: `dot ${state}` }, PIN_MARK[state]), ` ${label}`)),
  );
  return section(t('dns.secMap'), box, legend);
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
      ...dnsMap(byGroup('geo'), majority),
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

// ---------- ブラウザから直接引く情報 ----------
// サーバー（Cloudflare Workers）は他の利用者と出口のIPを共有しているので、無料の公開サービスに
// 回数制限（429）や拒否（403）で断られやすい。訪問者のブラウザから直接聞けば、制限は訪問者ごとになる。

async function fetchJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(7000), referrerPolicy: 'no-referrer' });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// IPのおおよその所在地。1つ目が断られたら2つ目を試す（どちらも鍵の要らない無料サービス）
async function geoLookup(ip) {
  try {
    const g = await fetchJson(`https://ipwho.is/${encodeURIComponent(ip)}`);
    if (!g || g.success === false) throw new Error('geo_failed');
    return {
      countryCode: g.country_code || null,
      region: g.region || null,
      city: g.city || null,
      lat: typeof g.latitude === 'number' ? g.latitude : null,
      lon: typeof g.longitude === 'number' ? g.longitude : null,
      timezone: g.timezone?.id || null,
      isp: g.connection?.isp || null,
      org: g.connection?.org || null,
    };
  } catch {
    const g = await fetchJson(`https://ipapi.co/${encodeURIComponent(ip)}/json/`);
    if (!g || g.error) throw new Error('geo_failed');
    return {
      countryCode: g.country_code || null,
      region: g.region || null,
      city: g.city || null,
      lat: typeof g.latitude === 'number' ? g.latitude : null,
      lon: typeof g.longitude === 'number' ? g.longitude : null,
      timezone: g.timezone || null,
      isp: g.org || null,
      org: null,
    };
  }
}

// IPの結果に所在地を足す。サーバーが登録情報を取れなかったときは、それもブラウザから取り直す
async function enrichIp(d, { registration = true } = {}) {
  if (!d || d.special) return;
  const jobs = [
    geoLookup(d.ip)
      .then((geo) => (d.geo = geo))
      .catch(() => (d.errors.geo = 'geo_failed')),
  ];
  if (registration && d.errors.rdap) {
    jobs.push(
      (async () => {
        // rdap.org、だめなら地域の登録機関へ直接、の順に試す
        for (const url of rdapIpUrls(d.ip, d.asn?.registry)) {
          try {
            const r = await fetchJson(url);
            if (r) d.rdap = parseIpRdap(r);
            delete d.errors.rdap;
            return;
          } catch {}
        }
      })(),
    );
  }
  await Promise.all(jobs);
}

async function enrichDomain(d) {
  const jobs = [enrichIp(d.ip, { registration: false })];
  if (!d.rdap && d.errors.rdap) {
    jobs.push(
      (async () => {
        // サーバーと同じく、www.example.co.jp → example.co.jp → co.jp の順に登録元を探す
        const labels = d.query.split('.');
        for (let i = 0; labels.length - i >= 2 && i < 4; i++) {
          const domain = labels.slice(i).join('.');
          const r = await fetchJson(`https://rdap.org/domain/${domain}`);
          if (!r) continue;
          d.rdap = parseDomainRdap(r);
          d.registered = domain;
          d.whois = null;
          break;
        }
        delete d.errors.rdap;
        if (d.rdap) delete d.errors.whois;
      })().catch(() => {}),
    );
  }
  await Promise.all(jobs);
}

async function runSearch(tab, api, q, render, enrich) {
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
    await enrich(data);
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
  const map = geo && mapFrame(geo.lat, geo.lon);
  const where = [
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
        d.tor !== null && d.tor !== undefined && [t('ip.tor'), torCell(d.tor)],
        geo?.timezone && [t('ip.timezone'), geo.timezone],
        geo?.timezone && [t('lk.localTime'), localTime(geo.timezone)],
        geo?.lat !== null && geo?.lat !== undefined && [t('ip.coords'), `${geo.lat}, ${geo.lon}`],
      ]),
      el('p', { class: 'sub', style: 'margin:6px 2px 0' }, geo ? t('lk.geoNote') : t('lk.countryNote')),
    ),
  ];
  // 地図があれば、所在地の表と横に並べる
  const out = map ? [cols(where, section(t('lk.secMap'), map))] : [...where];
  if (brief) return out;

  if (rdap) {
    out.push(
      cols(
        section(
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
        [
          ...section(t('lk.secContacts'), entitiesTable(rdap.entities)),
          ...(rdap.remarks.length ? section(t('lk.secRemarks'), el('div', { class: 'card' }, el('pre', { class: 'raw' }, rdap.remarks.join('\n')))) : []),
        ],
      ),
    );
  } else if (d.whois) {
    // RDAPで取れず、従来のWHOISで取れたときは、その生のテキストを出す
    out.push(...section(`WHOIS${t('paren', d.whois.server)}`, el('div', { class: 'card' }, el('pre', { class: 'raw' }, d.whois.text))));
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
    cols(
      [
        ...(r
          ? section(
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
            )
          : []),
        ...(r ? section(t('lk.secContacts'), entitiesTable(r.entities)) : []),
        ...(d.whois ? section(`WHOIS${t('paren', d.whois.server)}`, el('div', { class: 'card' }, el('pre', { class: 'raw' }, d.whois.text))) : []),
      ],
      section(
        t('dm.secDns', d.query),
        records.length
          ? listTable(
              [t('dm.thKind'), t('dm.thValue'), ['TTL']],
              records.map((a) => el('tr', {}, el('td', {}, badge('info', a.type)), el('td', { class: 'ans' }, value(a)), el('td', { class: 'num' }, t('dns.ttl', a.ttl)))),
            )
          : el('p', { class: 'muted' }, nx ? t('dm.nxdomain') : t('dm.noRecords')),
        dnsFailed.length ? el('p', { class: 'sub' }, t('dm.failedTypes', dnsFailed.join(', '))) : null,
      ),
    ),
  );
}

// ---------- ポート開放チェック ----------

const PORT_NAMES = {
  21: 'FTP', 22: 'SSH', 23: 'Telnet', 25: 'SMTP', 53: 'DNS', 80: 'HTTP', 110: 'POP3', 143: 'IMAP', 443: 'HTTPS', 465: 'SMTPS',
  587: 'SMTP (submission)', 993: 'IMAPS', 995: 'POP3S', 1433: 'MSSQL', 3306: 'MySQL', 3389: 'RDP', 5432: 'PostgreSQL',
  5900: 'VNC', 6379: 'Redis', 8080: 'HTTP (alt)', 8443: 'HTTPS (alt)', 27017: 'MongoDB',
};
const PORT_BADGE = { open: 'ok', closed: 'info', filtered: 'warn', unsupported: 'bad' };

function initPorts() {
  $('#ports-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const host = $('#ports-host').value.trim();
    if (host) go('ports', new URLSearchParams({ host, ports: $('#ports-list').value.replace(/[^0-9,]+/g, ',').replace(/,{2,}/g, ',').replace(/^,|,$/g, '') }));
  });
  $('#ports-mine').addEventListener('click', async () => {
    const info = await getInfo().catch(() => null);
    if (info?.ip) $('#ports-host').value = info.ip;
  });
}

async function queryPorts(qs) {
  const host = (qs.get('host') || '').trim();
  if (!host) return;
  const body = $('#ports-body');
  const btn = $('#ports-form button[type="submit"]');
  $('#ports-host').value = host;
  if (qs.get('ports')) $('#ports-list').value = qs.get('ports').split(',').join(', ');
  btn.disabled = true;
  body.replaceChildren(loading(t('querying')));
  try {
    const data = await apiJson('/api/ports', { host, ports: qs.get('ports') || '' });
    const open = data.results.filter((r) => r.state === 'open').length;
    const rows = data.results.map((r) =>
      el('tr', {}, el('td', { class: 'mono' }, r.port), el('td', {}, PORT_NAMES[r.port] || '—'), el('td', {}, badge(PORT_BADGE[r.state] || 'info', t(`ports.${r.state}`))), el('td', { class: 'num' }, r.ms === undefined ? '—' : `${r.ms} ms`)),
    );
    fill(
      body,
      note(open ? 'ok' : 'info', t('ports.summary', data.host, open, data.results.length)),
      ...section(data.host, listTable([t('ports.thPort'), t('ports.thService'), t('dns.thState'), [t('dns.thTime')]], rows), el('p', { class: 'sub', style: 'margin:6px 2px 0' }, t('ports.note'))),
    );
  } catch (e) {
    body.replaceChildren(note('bad', errText(e.message)));
  } finally {
    btn.disabled = false;
  }
}

// ---------- HTTPヘッダー確認 ----------

const SECURITY_HEADERS = ['strict-transport-security', 'content-security-policy', 'x-frame-options', 'x-content-type-options', 'referrer-policy', 'permissions-policy'];

function renderHttp(d, hero, body) {
  const last = d.hops[d.hops.length - 1];
  const header = (hop, name) => hop.headers?.find((h) => h.name.toLowerCase() === name)?.value || null;
  const statusBadge = (hop) => (hop.error ? badge('bad', errText(hop.error)) : badge(hop.status >= 400 ? 'bad' : hop.status >= 300 ? 'warn' : 'ok', `${hop.status} ${hop.statusText || ''}`.trim()));
  hero.replaceChildren(
    stat(t('http.status'), statusBadge(last)),
    stat(t('http.redirects'), String(d.hops.filter((h) => h.status >= 300 && h.status < 400 && h.location).length)),
    stat(t('http.total'), `${d.hops.reduce((sum, h) => sum + (h.ms || 0), 0)} ms`),
    stat(t('http.server'), last.headers ? header(last, 'server') : null),
  );
  fill(
    body,
    last.error ? note('bad', t('http.failed', errText(last.error))) : null,
    d.tooMany ? note('warn', t('http.tooMany')) : null,
    ...section(
      t('http.secChain'),
      listTable(
        [t('http.thStep'), t('http.thStatus'), 'URL', [t('dns.thTime')]],
        d.hops.map((h, i) => el('tr', {}, el('td', {}, i + 1), el('td', {}, statusBadge(h)), el('td', { class: 'url' }, h.url), el('td', { class: 'num' }, `${h.ms} ms`))),
      ),
      el('p', { class: 'sub', style: 'margin:6px 2px 0' }, t('http.note')),
    ),
    last.headers
      ? cols(
          section(
            t('http.secSecurity'),
            listTable(
              [t('http.thHeader'), t('dns.thState')],
              SECURITY_HEADERS.map((name) => el('tr', {}, el('td', { class: 'mono' }, name), el('td', {}, header(last, name) ? badge('ok', t('http.present')) : badge('warn', t('http.missing'))))),
            ),
          ),
          section(t('http.secHeaders', d.hops.length, last.url), kvTable(last.headers.map((h) => [h.name, h.value]))),
        )
      : null,
    // 途中の転送の応答ヘッダーも、最終応答に近い順に並べる
    ...d.hops
      .slice(0, -1)
      .map((h, i) => (h.headers ? section(t('http.secHeaders', i + 1, h.url), kvTable(h.headers.map((x) => [x.name, x.value]))) : []))
      .reverse()
      .flat(),
  );
}

// ---------- 証明書の発行履歴 ----------

// サーバー経由で取れなかったときは、ブラウザから crt.sh に直接聞き直す
async function loadCerts(q) {
  const res = await fetch(`/api/certs?${new URLSearchParams({ q })}`);
  const data = await res.json();
  if (res.ok) return data;
  if (I18N.en[`err.${data.error}`]) throw new Error(data.error); // 入力の誤りは聞き直しても同じ
  try {
    const raw = await fetch(certsUrl(q), { signal: AbortSignal.timeout(20000), referrerPolicy: 'no-referrer' }).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))));
    return { query: q, ...normalizeCerts(raw) };
  } catch {
    throw new Error(t('certs.failed'));
  }
}

function renderCerts(d, hero, body) {
  if (!d.certs.length) {
    body.replaceChildren(note('info', t('certs.none')));
    return;
  }
  const now = Date.now();
  // crt.sh の日時はUTCだがタイムゾーンの印が無いので、Z を補って読む
  const utc = (v) => (v && !/[zZ]$|[+-]\d\d:?\d\d$/.test(v) ? `${v}Z` : v);
  const rows = d.certs.map((c) => {
    const expired = c.notAfter && new Date(utc(c.notAfter)).getTime() < now;
    return el(
      'tr',
      {},
      el('td', {}, el('a', { href: `https://crt.sh/?id=${encodeURIComponent(c.id)}`, target: '_blank', rel: 'noopener' }, fmtDate(utc(c.notBefore)) || '—')),
      el('td', {}, fmtDate(utc(c.notAfter)), ' ', expired ? badge('info', t('dm.expired')) : badge('ok', t('certs.valid'))),
      el('td', {}, c.issuer),
      el('td', { class: 'ans' }, c.names.slice(0, 4).map((n) => el('div', {}, n)), c.names.length > 4 ? el('div', { class: 'sub' }, t('lk.more', c.names.length - 4)) : null),
    );
  });
  fill(body, el('p', { class: 'sub', style: 'margin:0 0 6px' }, t('certs.count', d.total, d.certs.length)), listTable([t('certs.thIssued'), t('dm.expires'), t('certs.thIssuer'), t('certs.thNames')], rows));
}

// 入力欄1つ・結果1つの検索タブ（HTTP・証明書）に共通の実行部分
async function runSimple(tab, q, load, render) {
  const body = $(`#${tab}-body`);
  const hero = $(`#${tab}-hero`);
  const btn = $(`#${tab}-form button`);
  $(`#${tab}-q`).value = q;
  btn.disabled = true;
  hero.replaceChildren();
  body.replaceChildren(loading(t('searching')));
  try {
    render(await load(q), hero, body);
  } catch (e) {
    body.replaceChildren(note('bad', errText(e.message)));
  } finally {
    btn.disabled = false;
  }
}

async function apiJson(path, params) {
  const res = await fetch(`${path}?${new URLSearchParams(params)}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
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
  // とても怪しいロシアのサイト風：黒地に蛍光緑、偽のダウンロードボタンと警告（どれも冗談と明記）
  ru2: {
    marquee: '☠☠☠ СКАЧАТЬ БЕСПЛАТНО БЕЗ СМС И РЕГИСТРАЦИИ ☠☠☠ ВЗЛОМ ИНТЕРНЕТА 2026 ☠☠☠ ТВОЙ IP УЖЕ У НАС (на самом деле нет) ☠☠☠ КРЯКИ · КЕЙГЕНЫ · СЕРИЙНИКИ (их тут нет) ☠☠☠',
    tagline: '[ WAREZ · ВЗЛОМ · СОФТ ] — мы видим тебя, %username%',
    peekLabel: '!!! ТРЕВОГА !!!',
    peek: (ip, detail) => `Твой IP ${ip}${detail ? ` (${detail})` : ''} ЗАСВЕЧЕН!!! Срочно скачай защиту (шутка, ничего не качай)`,
    counterPre: 'Ты заходил сюда уже',
    counterPost: 'раз, хакер',
    kiriban: '☠ Красивое число! Ты избранный! ☠',
    linkFree: 'Наша кнопка — вешай на свой сайт!',
    bestViewed: 'Оптимизировано под Internet Explorer 6 и Windows XP SP2 (пиратскую) :: Все файлы проверены антивирусом (файлов нет)',
    copyright: '© 2026 NetCheck WAREZ TEAM. Все права взломаны.',
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
  it: {
    marquee: '★ Benvenuti su NetCheck! ★ Il tuo indirizzo IP, il browser, la risoluzione dello schermo e perfino i font: qui si vede tutto ★ Aggiungi il sito ai preferiti! ★ Dillo anche agli amici! ★',
    tagline: '~ Scopri cosa sa di te Internet ~',
    peekLabel: 'ATTENZIONE!',
    peek: (ip, detail) => `Il tuo indirizzo IP ${ip}${detail ? ` (${detail})` : ''} è visibile a questo sito!!!`,
    counterPre: 'Hai visitato questa pagina',
    counterPost: 'volte',
    kiriban: '★ Complimenti! Hai beccato un numero fortunato! ★',
    linkFree: 'Scambio link? Prendi il nostro bottone!',
    bestViewed: 'Sito ottimizzato per Internet Explorer 5.5 a 800×600 (si scherza) :: Fatto con il Blocco note',
    copyright: 'Copyright © 2026 NetCheck. Tutti i diritti riservati.',
  },
  de: {
    marquee: '+++ Herzlich willkommen bei NetCheck! +++ Ihre IP-Adresse, Ihr Browser, Ihre Bildschirmauflösung und sogar Ihre Schriftarten – hier ist alles sichtbar +++ Bitte tragen Sie sich ins Gästebuch ein (gibt es nicht) +++',
    tagline: '~ Was das Internet über Sie weiß ~',
    peekLabel: 'ACHTUNG!',
    peek: (ip, detail) => `Ihre IP-Adresse ${ip}${detail ? ` (${detail})` : ''} ist für diese Seite sichtbar!!!`,
    counterPre: 'Sie haben diese Seite schon',
    counterPost: 'Mal besucht',
    kiriban: '★ Glückwunsch! Sie haben eine Schnapszahl erwischt! ★',
    linkFree: 'Linktausch erwünscht – nehmen Sie unseren Button!',
    bestViewed: 'Optimiert für Internet Explorer 5.5 bei 800×600 (kleiner Scherz) | Impressum (gibt es nicht)',
    copyright: 'Copyright © 2026 NetCheck. Alle Rechte vorbehalten.',
  },
  // イングランド：テレビの文字放送（Ceefax / Teletext）風。黒地に原色の文字
  gb: {
    marquee: '*** WELCOME TO NETCHECK *** YOUR IP ADDRESS, BROWSER, SCREEN SIZE AND EVEN YOUR FONTS ARE ALL ON SHOW *** HEADLINES 101 *** WEATHER 401 *** FOOTBALL 302 (NOT REALLY) ***',
    tagline: 'P100 · See what the internet knows about you',
    peekLabel: 'NEWSFLASH',
    peek: (ip, detail) => `Your IP address ${ip}${detail ? ` (${detail})` : ''} is visible to this website!`,
    counterPre: 'You have visited this page',
    counterPost: 'times',
    kiriban: '*** Congratulations! A lucky number! ***',
    linkFree: 'Fancy a link swap? Use our button',
    bestViewed: 'Best viewed on a 14-inch telly, or Internet Explorer 5.5 at 800×600 (only joking)',
    copyright: 'Copyright © 2026 NetCheck. All rights reserved.',
  },
  // とても堅いイングランドのサイト風：白黒、セリフ体、動きなし、回りくどい公用文
  gb2: {
    marquee: 'NOTICE TO VISITORS — Your Internet Protocol address, browser particulars, screen dimensions and installed typefaces are disclosed to this page in the ordinary course of its operation. Visitors are respectfully reminded to conduct themselves accordingly.',
    tagline: 'Diagnostics of Connection, Browser and Domain Name System — Established 2026',
    peekLabel: 'NOTICE.',
    peek: (ip, detail) => `It is hereby recorded that Internet Protocol address ${ip}${detail ? ` (${detail})` : ''} is visible to this service.`,
    counterPre: 'This page has been consulted on',
    counterPost: 'occasions',
    kiriban: 'The Management observes, without undue excitement, that a notable number has been reached.',
    linkFree: 'Requests for reciprocal hyperlinks should be submitted in writing',
    bestViewed: 'Visitors are kindly requested to form an orderly queue. No ball games. Terms and Conditions apply (there are none).',
    copyright: '© 2026 NetCheck. All rights reserved. Registered in no jurisdiction whatsoever.',
  },
};

// ---------- 日本風・中国風だけの動く飾り ----------
// テーマを切り替えるたびに、前のテーマの飾り（タイマーやマウスの追跡）を止めてから新しいものを始める

let stopEffects = () => {};
const calmMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

let effectsFor = null;
function themeEffects(name) {
  if (name === effectsFor) return; // 同じテーマの再適用（IPが分かったときなど）では、動いている飾りをやり直さない
  effectsFor = name;
  stopEffects();
  stopEffects = () => {};
  if (name === 'jp') stopEffects = jpEffects();
  if (name === 'cn') stopEffects = cnEffects();
  if (name === 'ru2') stopEffects = ru2Effects();
}

// 日本風：マウスを追いかける星と、TOPへ戻るボタン
function jpEffects() {
  const layer = $('#jp-trail');
  const stars = ['★', '☆', '✦', '✧'];
  const colors = ['#ffff00', '#ff66cc', '#66ffff', '#ffffff', '#99ff66'];
  let last = 0;
  const onMove = (e) => {
    if (e.pointerType === 'touch' || calmMotion() || e.timeStamp - last < 55) return;
    last = e.timeStamp;
    const star = el('span', { style: `left:${e.clientX + 6}px;top:${e.clientY + 8}px;color:${colors[Math.floor(Math.random() * colors.length)]}` }, stars[Math.floor(Math.random() * stars.length)]);
    layer.append(star);
    setTimeout(() => star.remove(), 800);
  };
  const toTop = () => scrollTo({ top: 0, behavior: calmMotion() ? 'auto' : 'smooth' });
  addEventListener('pointermove', onMove);
  $('#jp-top').addEventListener('click', toTop);
  return () => {
    removeEventListener('pointermove', onMove);
    $('#jp-top').removeEventListener('click', toTop);
    layer.replaceChildren();
  };
}

// ロシア（とても怪しい）：でたらめな「オンライン人数」、偽のミニチャット、偽のウイルス警告（1回の訪問につき1度）
function ru2Effects() {
  const alertBox = $('#ru2-alert');
  const chat = $('#ru2-chat');
  const timers = [];
  const close = () => {
    alertBox.hidden = true;
    toast('Шутка. Вирусов нет :)');
  };
  const closers = [$('#ru2-alert-x'), ...document.querySelectorAll('[data-ru2-close]')];
  closers.forEach((b) => b.addEventListener('click', close));

  let shown = false;
  try {
    shown = sessionStorage.getItem('netcheck-ru2-alert') === '1';
  } catch {}
  if (!shown) {
    timers.push(
      setTimeout(() => {
        alertBox.hidden = false;
        try {
          sessionStorage.setItem('netcheck-ru2-alert', '1');
        } catch {}
      }, 1500),
    );
  }

  let online = 1337;
  timers.push(
    setInterval(() => {
      online = Math.max(1000, online + Math.floor(Math.random() * 41) - 20);
      $('#ru2-online').textContent = online;
    }, 1800),
  );

  const NICKS = ['xXx_HaCkEr_xXx', 'Vasya1999', 'DarkLord', 'admin', 'Kotik_777', 'L33T'];
  const LINES = ['админ, залей ещё', 'кряк не работает!!!', 'спасибо, всё скачалось (нет)', 'первый нах', 'где ссылка???', 'сайт супер, добавил в закладки', 'у кого есть серийник?'];
  const pick = (list) => list[Math.floor(Math.random() * list.length)];
  const say = () => {
    chat.append(el('div', {}, el('b', {}, `${pick(NICKS)}: `), pick(LINES)));
    while (chat.children.length > 5) chat.firstChild.remove();
  };
  say();
  say();
  timers.push(setInterval(say, 3500));

  return () => {
    timers.forEach((id) => {
      clearTimeout(id);
      clearInterval(id);
    });
    closers.forEach((b) => b.removeEventListener('click', close));
    alertBox.hidden = true;
    chat.replaceChildren();
  };
}

// 中国風：当選ポップアップ（1回の訪問につき1度だけ）、カウントダウン、偽の「利用者の声」
function cnEffects() {
  const modal = $('#cn-modal');
  const feed = $('#cn-feed');
  const timers = [];
  const closeModal = () => (modal.hidden = true);
  const claim = () => {
    closeModal();
    toast('开玩笑的，没有礼包 :)');
  };
  const onBackdrop = (e) => e.target === modal && closeModal();
  const onKey = (e) => e.key === 'Escape' && closeModal();
  $('#cn-modal-x').addEventListener('click', closeModal);
  $('#cn-modal-btn').addEventListener('click', claim);
  modal.addEventListener('click', onBackdrop);
  addEventListener('keydown', onKey);

  let shown = false;
  try {
    shown = sessionStorage.getItem('netcheck-cn-modal') === '1';
  } catch {}
  if (!shown) {
    timers.push(
      setTimeout(() => {
        modal.hidden = false;
        try {
          sessionStorage.setItem('netcheck-cn-modal', '1');
        } catch {}
      }, 1200),
    );
  }

  // 「限时」のカウントダウン。0になったら何事もなかったように最初へ戻る
  let left = 599;
  timers.push(
    setInterval(() => {
      left = left > 0 ? left - 1 : 599;
      $('#cn-countdown').textContent = `${String(Math.floor(left / 60)).padStart(2, '0')}:${String(left % 60).padStart(2, '0')}`;
    }, 1000),
  );

  const FEED = ['刚刚领取了 88 元红包', '刚刚升级了 VIP 会员', '刚刚查询了自己的 IP', '刚刚完成了端口检测', '刚刚抽中了一等奖'];
  const PREFIX = ['138', '186', '159', '177', '135', '188'];
  const say = () => {
    const phone = `${PREFIX[Math.floor(Math.random() * PREFIX.length)]}****${String(Math.floor(Math.random() * 10000)).padStart(4, '0')}`;
    feed.textContent = `🔔 用户 ${phone} ${FEED[Math.floor(Math.random() * FEED.length)]}（假的）`;
    feed.hidden = false;
    timers.push(setTimeout(() => (feed.hidden = true), 3600));
  };
  timers.push(setTimeout(say, 3500), setInterval(say, 7000));

  return () => {
    timers.forEach((id) => {
      clearTimeout(id);
      clearInterval(id);
    });
    $('#cn-modal-x').removeEventListener('click', closeModal);
    $('#cn-modal-btn').removeEventListener('click', claim);
    modal.removeEventListener('click', onBackdrop);
    removeEventListener('keydown', onKey);
    modal.hidden = true;
    feed.hidden = true;
  };
}

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
  themeEffects(name);
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
for (const btn of document.querySelectorAll('[data-joke]')) btn.addEventListener('click', () => toast(btn.dataset.joke || '开玩笑的，这里什么都没有 :)'));
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
  ports: initPorts,
  http: () => initSearch('http'),
  certs: () => initSearch('certs'),
};
// ハッシュの「?」以降（検索条件）を受け取って実行するタブ
const QUERY = {
  dns: queryDns,
  lookup: (qs) => {
    const q = (qs.get('q') || '').trim();
    if (!q) return;
    // 入力がIPアドレスの形ならIP検索、それ以外はドメイン検索に振り分ける
    if (looksLikeIp(q)) runSearch('lookup', '/api/ip', q, renderIp, enrichIp);
    else runSearch('lookup', '/api/domain', q, renderDomain, enrichDomain);
  },
  ports: queryPorts,
  http: (qs) => qs.get('q') && runSimple('http', qs.get('q').trim(), (url) => apiJson('/api/http', { url }), renderHttp),
  certs: (qs) => qs.get('q') && runSimple('certs', qs.get('q').trim(), loadCerts, renderCerts),
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
