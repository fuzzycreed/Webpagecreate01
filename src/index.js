// NetCheck Worker: /api/info（接続情報）、/api/dns（DNS伝播）、/api/ip（IP検索）、/api/domain（ドメイン検索）
// 静的ファイルは wrangler.jsonc の assets 設定で public/ から配信される。

import { parseIpRdap, parseDomainRdap, rdapIpUrls } from '../public/rdap.js';
import { normalizeCerts, certsUrl, normalizeSubdomains, subdomainsUrl } from '../public/certs.js';

const TYPES = { A: 1, NS: 2, CNAME: 5, SOA: 6, PTR: 12, MX: 15, TXT: 16, AAAA: 28, SRV: 33, CAA: 257 };
const TYPE_NAMES = Object.fromEntries(Object.entries(TYPES).map(([k, v]) => [v, k]));
const RCODES = ['NOERROR', 'FORMERR', 'SERVFAIL', 'NXDOMAIN', 'NOTIMP', 'REFUSED'];

// 公開DoHリゾルバー（RFC 8484 / application/dns-message）
const RESOLVERS = [
  { id: 'google', label: 'Google Public DNS', note: '8.8.8.8', url: 'https://dns.google/dns-query' },
  { id: 'cloudflare', label: 'Cloudflare', note: '1.1.1.1', url: 'https://cloudflare-dns.com/dns-query' },
  { id: 'quad9', label: 'Quad9', note: '9.9.9.9', url: 'https://dns.quad9.net/dns-query' },
  { id: 'opendns', label: 'OpenDNS (Cisco)', note: '208.67.222.222', url: 'https://doh.opendns.com/dns-query' },
  { id: 'adguard', label: 'AdGuard (unfiltered)', note: '94.140.14.140', url: 'https://unfiltered.adguard-dns.com/dns-query' },
  { id: 'nextdns', label: 'NextDNS', note: 'anycast', url: 'https://dns.nextdns.io/dns-query' },
  { id: 'mullvad', label: 'Mullvad', note: '194.242.2.2', url: 'https://dns.mullvad.net/dns-query' },
  { id: 'controld', label: 'Control D', note: '76.76.2.0', url: 'https://freedns.controld.com/p0' },
  { id: 'dnssb', label: 'DNS.SB', note: '185.222.222.222', url: 'https://doh.dns.sb/dns-query' },
  { id: 'iij', label: 'IIJ Public DNS', note: 'JP', url: 'https://public.dns.iij.jp/dns-query' },
  { id: 'alidns', label: 'AliDNS', note: 'CN · 223.5.5.5', url: 'https://dns.alidns.com/dns-query' },
  { id: 'dnspod', label: 'DNSPod (Tencent)', note: 'CN · 119.29.29.29', url: 'https://doh.pub/dns-query' },
];

// EDNS Client Subnet で「その地域のユーザーから来た問い合わせ」を擬似的に再現する。
// サブネットは各国の大手ISPの代表的な帯域（おおよその目安）。
// 緯度・経度は地図に印を置くための代表都市。1回の検索の外部リクエストは
// 「リゾルバー数 + 地域数 + 1（指定サブネット）」件で、無料枠の上限50件に収める。
const ECS_RESOLVER = 'https://dns.google/dns-query';
const LOCATIONS = [
  // アジア・オセアニア
  { id: 'jp', cc: 'JP', lat: 35.68, lon: 139.69, ecs: '126.0.0.0/24' },
  { id: 'kr', cc: 'KR', lat: 37.57, lon: 126.98, ecs: '121.128.0.0/24' },
  { id: 'tw', cc: 'TW', lat: 25.03, lon: 121.57, ecs: '114.32.0.0/24' },
  { id: 'hk', cc: 'HK', lat: 22.32, lon: 114.17, ecs: '1.64.0.0/24' },
  { id: 'vn', cc: 'VN', lat: 21.03, lon: 105.85, ecs: '14.160.0.0/24' },
  { id: 'th', cc: 'TH', lat: 13.75, lon: 100.5, ecs: '1.0.128.0/24' },
  { id: 'sg', cc: 'SG', lat: 1.35, lon: 103.82, ecs: '220.255.0.0/24' },
  { id: 'id', cc: 'ID', lat: -6.21, lon: 106.85, ecs: '36.72.0.0/24' },
  { id: 'in', cc: 'IN', lat: 19.08, lon: 72.88, ecs: '117.192.0.0/24' },
  { id: 'ae', cc: 'AE', lat: 25.2, lon: 55.27, ecs: '86.96.0.0/24' },
  { id: 'au', cc: 'AU', lat: -33.87, lon: 151.21, ecs: '58.160.0.0/24' },
  { id: 'nz', cc: 'NZ', lat: -36.85, lon: 174.76, ecs: '122.56.0.0/24' },
  // ヨーロッパ
  { id: 'gb', cc: 'GB', lat: 51.51, lon: -0.13, ecs: '86.128.0.0/24' },
  { id: 'fr', cc: 'FR', lat: 48.86, lon: 2.35, ecs: '90.0.0.0/24' },
  { id: 'es', cc: 'ES', lat: 40.42, lon: -3.7, ecs: '80.58.0.0/24' },
  { id: 'it', cc: 'IT', lat: 41.9, lon: 12.5, ecs: '79.0.0.0/24' },
  { id: 'nl', cc: 'NL', lat: 52.37, lon: 4.9, ecs: '194.109.0.0/24' },
  { id: 'de', cc: 'DE', lat: 50.11, lon: 8.68, ecs: '84.128.0.0/24' },
  { id: 'se', cc: 'SE', lat: 59.33, lon: 18.07, ecs: '81.224.0.0/24' },
  { id: 'pl', cc: 'PL', lat: 52.23, lon: 21.01, ecs: '83.0.0.0/24' },
  { id: 'tr', cc: 'TR', lat: 41.01, lon: 28.98, ecs: '88.224.0.0/24' },
  { id: 'ru', cc: 'RU', lat: 55.76, lon: 37.62, ecs: '77.88.8.0/24' },
  // 南北アメリカ
  { id: 'ca', cc: 'CA', lat: 51.05, lon: -114.07, ecs: '24.64.0.0/24' },
  { id: 'us-e', cc: 'US', isp: 'Comcast', lat: 39.95, lon: -75.17, ecs: '73.0.0.0/24' },
  { id: 'us-w', cc: 'US', isp: 'AT&T', lat: 32.78, lon: -96.8, ecs: '99.0.0.0/24' },
  { id: 'mx', cc: 'MX', lat: 19.43, lon: -99.13, ecs: '189.128.0.0/24' },
  { id: 'br', cc: 'BR', lat: -23.55, lon: -46.63, ecs: '177.0.0.0/24' },
  // アフリカ
  { id: 'eg', cc: 'EG', lat: 30.04, lon: 31.24, ecs: '41.32.0.0/24' },
  { id: 'ng', cc: 'NG', lat: 6.52, lon: 3.38, ecs: '197.210.0.0/24' },
  { id: 'za', cc: 'ZA', lat: -26.2, lon: 28.05, ecs: '41.0.0.0/24' },
];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/') return page(request, env, url);
    const limited = await rateLimit(request, env, url.pathname);
    if (limited) return limited;
    // エラーは短いコード（bad_name など）で返し、画面側が表示言語に合わせて文言にする
    try {
      if (url.pathname === '/api/info') return json(await info(request));
      if (url.pathname === '/api/dns') return json(await dns(url.searchParams));
      if (url.pathname === '/api/ip') return json(await ipLookup(url.searchParams));
      if (url.pathname === '/api/domain') return json(await domainLookup(url.searchParams));
      if (url.pathname === '/api/ports') return json(await portsCheck(url.searchParams));
      if (url.pathname === '/api/http') return json(await httpCheck(url.searchParams, url.hostname));
      if (url.pathname === '/api/certs') return json(await certsLookup(url.searchParams));
      if (url.pathname === '/api/subdomains') return json(await subdomainsLookup(url.searchParams));
      if (url.pathname === '/api/mail') return json(await mailCheck(url.searchParams));
      if (url.pathname === '/api/asn') return json(await asnLookup(url.searchParams));
      if (url.pathname === '/api/timing') return json(await timingCheck(url.searchParams, url.hostname));
      if (url.pathname === '/api/counter' || url.pathname === '/api/bbs') return await board(request, env, url);
    } catch (e) {
      return json({ error: e.message || String(e) }, 400);
    }
    return notFound(request, env, url);
  },
};

// トップページ。SNSなどで共有されたときに使われるメタ情報は「https://ドメイン/…」の完全なURLでないと
// 読んでもらえないので、配信するときに、いまアクセスされているドメインを使って書き換える
async function page(request, env, url) {
  if (!env?.ASSETS) return new Response('Not found', { status: 404 });
  const res = await env.ASSETS.fetch(request);
  if (typeof HTMLRewriter === 'undefined' || !(res.headers.get('content-type') || '').includes('text/html')) return res;
  const absolute = (attr) => ({
    element(el) {
      const value = el.getAttribute(attr);
      if (value?.startsWith('/')) el.setAttribute(attr, url.origin + value);
    },
  });
  return new HTMLRewriter()
    .on('link[rel="canonical"]', absolute('href'))
    .on('meta[property="og:url"]', absolute('content'))
    .on('meta[property="og:image"]', absolute('content'))
    .on('meta[name="twitter:image"]', absolute('content'))
    .transform(res);
}

// 存在しないパス。API以外なら、案内のページ（public/404.html）を 404 として返す
async function notFound(request, env, url) {
  if (!url.pathname.startsWith('/api/') && env?.ASSETS) {
    const res = await env.ASSETS.fetch(new Request(`${url.origin}/404.html`));
    if (res.ok) return new Response(res.body, { status: 404, headers: res.headers });
  }
  return new Response('Not found', { status: 404 });
}

// 回数制限。どの経路にどの制限をかけるかの対応表（制限の中身は wrangler.jsonc の ratelimits）
const RATE_LIMITS = {
  '/api/dns': 'LIMIT_LOOKUP',
  '/api/ip': 'LIMIT_LOOKUP',
  '/api/domain': 'LIMIT_LOOKUP',
  '/api/certs': 'LIMIT_LOOKUP',
  '/api/subdomains': 'LIMIT_LOOKUP',
  '/api/mail': 'LIMIT_LOOKUP',
  '/api/asn': 'LIMIT_LOOKUP',
  '/api/ports': 'LIMIT_PROBE',
  '/api/http': 'LIMIT_PROBE',
  '/api/timing': 'LIMIT_PROBE',
  'POST /api/bbs': 'LIMIT_POST', // 掲示板への書き込みだけを数える（読むのは数えない）
};

// 上限を超えていたら 429 の応答を返す。超えていなければ null
async function rateLimit(request, env, pathname) {
  const limiter = env?.[RATE_LIMITS[`${request.method} ${pathname}`] || RATE_LIMITS[pathname]];
  if (!limiter) return null; // 対象外の経路か、制限の設定が無い環境
  const key = request.headers.get('cf-connecting-ip') || 'unknown';
  const { success } = await limiter.limit({ key });
  if (success) return null;
  return new Response(JSON.stringify({ error: 'rate_limited' }), {
    status: 429,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'retry-after': '60' },
  });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
  });
}

// ---------- /api/info ----------

async function info(request) {
  const cf = request.cf || {};
  const h = request.headers;
  const ip = h.get('cf-connecting-ip') || h.get('x-real-ip') || '';
  const pick = (...keys) => Object.fromEntries(keys.map((k) => [k, cf[k] ?? null]));
  return {
    ip,
    ipVersion: ip.includes(':') ? 6 : ip ? 4 : null,
    geo: pick('country', 'isEUCountry', 'continent', 'region', 'regionCode', 'city', 'postalCode', 'latitude', 'longitude', 'timezone'),
    network: pick('asn', 'asOrganization', 'colo'),
    connection: pick('httpProtocol', 'tlsVersion', 'tlsCipher', 'clientAcceptEncoding'),
    tor: ip ? await isTorExit(ip, cf.country) : null,
    headers: [...h.entries()].map(([name, value]) => ({ name, value })),
  };
}

// ---------- /api/dns ----------

async function dns(params) {
  const type = (params.get('type') || 'A').toUpperCase();
  if (!TYPES[type]) throw new Error('bad_type');
  const name = normalizeName(params.get('name') || '');
  const customEcs = params.get('ecs');

  const jobs = [
    ...RESOLVERS.map((r) => ({ group: 'resolver', id: r.id, label: r.label, note: r.note, url: r.url })),
    ...LOCATIONS.map((l) => ({ group: 'geo', id: l.id, cc: l.cc, isp: l.isp, lat: l.lat, lon: l.lon, note: l.ecs, url: ECS_RESOLVER, ecs: l.ecs })),
  ];
  if (customEcs) {
    parseEcs(customEcs); // 不正ならここで例外
    jobs.push({ group: 'geo', id: 'custom', note: customEcs, url: ECS_RESOLVER, ecs: customEcs });
  }

  const results = await Promise.all(
    jobs.map(async ({ url, ecs, ...meta }) => {
      const started = Date.now();
      try {
        const msg = await dohQuery(url, name, type, ecs);
        return { ...meta, ms: Date.now() - started, ...msg };
      } catch (e) {
        const timeout = e.name === 'TimeoutError' || e.name === 'AbortError';
        return { ...meta, ms: Date.now() - started, error: timeout ? 'timeout' : e.message || String(e) };
      }
    }),
  );
  return { name, type, results };
}

async function dohQuery(url, name, type, ecs) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/dns-message', accept: 'application/dns-message' },
    body: encodeQuery(name, TYPES[type], ecs),
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return decodeResponse(new Uint8Array(await res.arrayBuffer()));
}

// 検索タブ用の名前解決。1つ目が失敗したら2つ目に切り替える。
async function resolve(name, type) {
  let lastError;
  for (const url of ['https://cloudflare-dns.com/dns-query', 'https://dns.google/dns-query']) {
    try {
      return await dohQuery(url, name, type);
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError;
}

function normalizeName(input) {
  let s = input.trim().replace(/^[a-z]+:\/\//i, '').replace(/[/?#].*$/, '').replace(/\.$/, '');
  if (!s) throw new Error('name_required');
  let host;
  try {
    host = new URL(`http://${s}`).hostname; // 日本語ドメインなどを punycode に変換
  } catch {
    throw new Error('bad_name');
  }
  if (host.length > 253 || !/^[a-z0-9_]([a-z0-9_-]*[a-z0-9_])?(\.[a-z0-9_]([a-z0-9_-]*[a-z0-9_])?)*$/i.test(host)) {
    throw new Error('bad_name');
  }
  return host;
}

function parseEcs(ecs) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?:\/(\d{1,2}))?$/.exec(ecs.trim());
  if (!m) throw new Error('bad_ecs');
  const bytes = m.slice(1, 5).map(Number);
  const prefix = m[5] === undefined ? 24 : Number(m[5]);
  if (bytes.some((b) => b > 255) || prefix < 8 || prefix > 32) throw new Error('bad_ecs');
  return { bytes, prefix };
}

// ---------- DNS ワイヤーフォーマット ----------

function encodeQuery(name, qtype, ecs) {
  const enc = new TextEncoder();
  const out = [0, 0, 0x01, 0x00, 0, 1, 0, 0, 0, 0, 0, 1]; // ID=0, RD=1, QD=1, AR=1(OPT)
  for (const label of name.split('.')) {
    const b = enc.encode(label);
    if (!b.length || b.length > 63) throw new Error('bad_name');
    out.push(b.length, ...b);
  }
  out.push(0, qtype >> 8, qtype & 255, 0, 1);

  let opt = [];
  if (ecs) {
    const { bytes, prefix } = parseEcs(ecs);
    const addr = bytes.slice(0, Math.ceil(prefix / 8));
    opt = [0, 8, 0, 4 + addr.length, 0, 1, prefix, 0, ...addr]; // option 8 = Client Subnet, family 1 = IPv4
  }
  out.push(0, 0, 41, 0x10, 0x00, 0, 0, 0, 0, opt.length >> 8, opt.length & 255, ...opt);
  return new Uint8Array(out);
}

function decodeResponse(buf) {
  if (buf.length < 12) throw new Error('bad_response');
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const rcode = buf[3] & 0x0f;
  const qd = view.getUint16(4);
  const an = view.getUint16(6);
  let off = 12;
  for (let i = 0; i < qd; i++) off = readName(buf, off)[1] + 4;

  const answers = [];
  for (let i = 0; i < an; i++) {
    off = readName(buf, off)[1];
    const type = view.getUint16(off);
    const ttl = view.getUint32(off + 4);
    const len = view.getUint16(off + 8);
    const start = off + 10;
    answers.push({ type: TYPE_NAMES[type] || `TYPE${type}`, ttl, data: formatRdata(buf, view, type, start, len) });
    off = start + len;
  }
  return { status: RCODES[rcode] || `RCODE${rcode}`, answers };
}

function readName(buf, off) {
  const labels = [];
  let end = -1;
  const dec = new TextDecoder();
  for (let jumps = 0; jumps < 50; ) {
    const len = buf[off];
    if (len === undefined) throw new Error('bad_response');
    if (len === 0) {
      off++;
      break;
    }
    if ((len & 0xc0) === 0xc0) {
      if (end < 0) end = off + 2;
      off = ((len & 0x3f) << 8) | buf[off + 1];
      jumps++;
      continue;
    }
    labels.push(dec.decode(buf.subarray(off + 1, off + 1 + len)));
    off += 1 + len;
  }
  return [labels.join('.') || '.', end < 0 ? off : end];
}

function formatRdata(buf, view, type, start, len) {
  const name = (o) => readName(buf, o)[0];
  switch (type) {
    case 1:
      return [...buf.subarray(start, start + 4)].join('.');
    case 28: {
      const groups = [];
      for (let i = 0; i < 16; i += 2) groups.push(view.getUint16(start + i).toString(16));
      return compressIPv6(groups);
    }
    case 2:
    case 5:
    case 12:
      return name(start);
    case 15:
      return `${view.getUint16(start)} ${name(start + 2)}`;
    case 16: {
      const dec = new TextDecoder();
      const parts = [];
      for (let o = start; o < start + len; o += 1 + buf[o]) parts.push(dec.decode(buf.subarray(o + 1, o + 1 + buf[o])));
      return parts.map((p) => `"${p}"`).join(' ');
    }
    case 6: {
      const [mname, o1] = readName(buf, start);
      const [rname, o2] = readName(buf, o1);
      const nums = [0, 4, 8, 12, 16].map((d) => view.getUint32(o2 + d));
      return `${mname} ${rname} ${nums.join(' ')}`;
    }
    case 33:
      return `${view.getUint16(start)} ${view.getUint16(start + 2)} ${view.getUint16(start + 4)} ${name(start + 6)}`;
    case 257: {
      const dec = new TextDecoder();
      const tagLen = buf[start + 1];
      const tag = dec.decode(buf.subarray(start + 2, start + 2 + tagLen));
      const value = dec.decode(buf.subarray(start + 2 + tagLen, start + len));
      return `${buf[start]} ${tag} "${value}"`;
    }
    default:
      return [...buf.subarray(start, start + len)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }
}

function compressIPv6(groups) {
  let best = { at: -1, len: 0 };
  for (let i = 0; i < 8; ) {
    if (groups[i] !== '0') {
      i++;
      continue;
    }
    let j = i;
    while (j < 8 && groups[j] === '0') j++;
    if (j - i > best.len && j - i > 1) best = { at: i, len: j - i };
    i = j;
  }
  if (best.at < 0) return groups.join(':');
  return `${groups.slice(0, best.at).join(':')}::${groups.slice(best.at + best.len).join(':')}`;
}

// ---------- /api/ip ----------

function parseIp(input) {
  const s = input.trim().replace(/^\[|\]$/g, '');
  const m4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s);
  if (m4) {
    const bytes = m4.slice(1).map(Number);
    return bytes.some((b) => b > 255) ? null : { version: 4, bytes, text: bytes.join('.') };
  }
  if (!s.includes(':') || !/^[0-9a-f:]+$/i.test(s)) return null;
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves[1] ? halves[1].split(':') : [];
  if (halves.length === 1 ? head.length !== 8 : head.length + tail.length > 7) return null;
  const groups = [...head, ...Array(8 - head.length - tail.length).fill('0'), ...tail];
  if (groups.some((g) => !/^[0-9a-f]{1,4}$/i.test(g))) return null;
  const nums = groups.map((g) => parseInt(g, 16));
  return { version: 6, groups: nums, text: compressIPv6(nums.map((n) => n.toString(16))) };
}

// インターネット上で使われない特別なアドレスなら、その種類のコードを返す（文言は画面側で言語ごとに出す）
function specialRange(ip) {
  if (ip.version === 4) {
    const [a, b, c] = ip.bytes;
    if (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) return 'private';
    if (a === 127) return 'loopback';
    if (a === 169 && b === 254) return 'linklocal';
    if (a === 100 && b >= 64 && b <= 127) return 'cgnat';
    if (a === 0) return 'thisnet';
    if ((a === 192 && b === 0 && c === 2) || (a === 198 && b === 51 && c === 100) || (a === 203 && b === 0 && c === 113)) return 'doc';
    if (a === 198 && (b === 18 || b === 19)) return 'benchmark';
    if (a >= 224 && a <= 239) return 'multicast';
    if (a >= 240) return 'reserved';
    return null;
  }
  const g = ip.groups;
  if (g.every((n) => n === 0)) return 'unspecified';
  if (g.slice(0, 7).every((n) => n === 0) && g[7] === 1) return 'loopback';
  if ((g[0] & 0xfe00) === 0xfc00) return 'ula';
  if ((g[0] & 0xffc0) === 0xfe80) return 'linklocal';
  if ((g[0] & 0xff00) === 0xff00) return 'multicast';
  if (g[0] === 0x2001 && g[1] === 0x0db8) return 'doc';
  return null;
}

// 逆引き用の名前の先頭部分（IPv4は逆順のオクテット、IPv6は逆順のニブル）
function reversedLabels(ip) {
  if (ip.version === 4) return [...ip.bytes].reverse().join('.');
  return ip.groups.map((n) => n.toString(16).padStart(4, '0')).join('').split('').reverse().join('.');
}

const txtFields = (answer) => answer.data.replace(/^"|"$/g, '').replace(/" "/g, '').split('|').map((f) => f.trim());

async function ipLookup(params) {
  const ip = parseIp(params.get('q') || '');
  if (!ip) throw new Error('bad_ip');
  return lookupIp(ip);
}

async function lookupIp(ip) {
  const special = specialRange(ip);
  // geo（所在地）はここでは埋めない。Workers は他の利用者と出口のIPを共有していて、無料の所在地サービスに
  // 回数制限で断られるため、訪問者のブラウザから直接問い合わせる（public/app.js の geoLookup）
  const out = { ip: ip.text, version: ip.version, special, ptr: [], asn: null, geo: null, rdap: null, whois: null, tor: null, errors: {} };
  if (special) return out;

  const rev = reversedLabels(ip);
  const [ptr, origin, rdap, tor] = await Promise.allSettled([
    resolve(`${rev}.${ip.version === 4 ? 'in-addr' : 'ip6'}.arpa`, 'PTR'),
    // Team Cymru のIP→AS番号対応表（DNSで引ける公開サービス）
    resolve(`${rev}.${ip.version === 4 ? 'origin' : 'origin6'}.asn.cymru.com`, 'TXT'),
    rdapFetch(`ip/${ip.text}`),
    isTorExit(ip.text),
  ]);
  out.tor = tor.status === 'fulfilled' ? tor.value : null;

  if (ptr.status === 'fulfilled') out.ptr = ptr.value.answers.filter((a) => a.type === 'PTR').map((a) => a.data);
  else out.errors.ptr = ptr.reason.message;

  if (origin.status === 'fulfilled') {
    const txt = origin.value.answers.find((a) => a.type === 'TXT');
    if (txt) {
      const [asns, prefix, country, registry, allocated] = txtFields(txt);
      const asn = asns.split(' ')[0];
      out.asn = { asn, prefix, country, registry, allocated, name: null };
      try {
        const named = (await resolve(`AS${asn}.asn.cymru.com`, 'TXT')).answers.find((a) => a.type === 'TXT');
        if (named) out.asn.name = txtFields(named)[4] || null;
      } catch {}
    }
  } else out.errors.asn = origin.reason.message;

  if (rdap.status === 'fulfilled') {
    if (rdap.value) out.rdap = parseIpRdap(rdap.value);
  } else {
    // rdap.org 経由で取れなかったときの予備の経路：
    // 1) 地域の登録機関（APNIC など）のRDAPへ直接  2) 同じ機関の従来のWHOIS（TCP 43番）
    const registry = out.asn?.registry;
    let error = rdap.reason;
    for (const url of rdapIpUrls(ip.text, registry).slice(1)) {
      try {
        const r = await rdapGet(url);
        if (r) out.rdap = parseIpRdap(r);
        error = null;
        break;
      } catch (e) {
        error = e;
      }
    }
    if (error) {
      try {
        out.whois = await ipWhois(ip.text, registry);
      } catch {
        out.errors.rdap = error.message; // どちらも駄目なら、画面側がブラウザから聞き直す
      }
    }
  }

  return out;
}

const RIR_WHOIS = { arin: 'whois.arin.net', ripencc: 'whois.ripe.net', apnic: 'whois.apnic.net', lacnic: 'whois.lacnic.net', afrinic: 'whois.afrinic.net' };

async function ipWhois(ipText, registry) {
  let server = RIR_WHOIS[String(registry || '').toLowerCase()];
  if (!server) {
    // 担当の登録機関が分からないときは、IANA に聞くと紹介先（refer）を教えてくれる
    const iana = await whoisQuery('whois.iana.org', ipText);
    server = /^(?:refer|whois):\s*(\S+)/im.exec(iana)?.[1];
    if (!server) throw new Error('no_whois_server');
  }
  const text = (await whoisQuery(server, server === 'whois.arin.net' ? `n + ${ipText}` : ipText)).trim();
  if (!text) throw new Error('bad_response');
  return { server, text: text.slice(0, 20000) };
}

// ---------- RDAP ----------

// RDAPの問い合わせ。転送を1段ずつ自分で追い、失敗したらどのサーバーで失敗したかをエラーに含める
// （rdap.org は正しい登録機関へ転送するだけなので、転送先で失敗することがある）
async function rdapGet(url) {
  for (let hop = 0; hop < 6; hop++) {
    const host = new URL(url).hostname;
    let res;
    try {
      res = await fetch(url, {
        redirect: 'manual',
        // Workers の fetch は User-Agent を付けないので明示する（無いと断るサーバーがある）
        headers: { accept: 'application/rdap+json, application/json', 'user-agent': 'NetCheck/1.0 (RDAP lookup)' },
        signal: AbortSignal.timeout(7000),
      });
    } catch (e) {
      const timeout = e.name === 'TimeoutError' || e.name === 'AbortError';
      throw new Error(`${timeout ? 'timeout' : e.message || e} (${host})`);
    }
    const location = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && location) {
      res.body?.cancel().catch(() => {});
      url = new URL(location, url).href;
      continue;
    }
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`HTTP ${res.status} (${host})`);
    return res.json();
  }
  throw new Error('too many redirects');
}

// rdap.org は、問い合わせ先の正しい登録機関へ転送してくれる公開の振り分けサービス
const rdapFetch = (path) => rdapGet(`https://rdap.org/${path}`);

// ---------- /api/domain ----------

const DOMAIN_RECORD_TYPES = ['A', 'AAAA', 'CNAME', 'NS', 'MX', 'TXT', 'SOA', 'CAA'];

async function domainLookup(params) {
  const name = normalizeName(params.get('q') || '');
  const labels = name.split('.');
  if (labels.length < 2) throw new Error('need_dot');
  if (parseIp(name)) throw new Error('name_required');

  // www.example.co.jp と入力されても登録情報が見つかるよう、左のラベルを順に外して試す
  const candidates = [];
  for (let i = 0; labels.length - i >= 2 && candidates.length < 4; i++) candidates.push(labels.slice(i).join('.'));

  const dnsJob = Promise.all(
    DOMAIN_RECORD_TYPES.map(async (type) => {
      try {
        const r = await resolve(name, type);
        return { type, status: r.status, answers: r.answers.filter((a) => a.type === type || (type === 'A' && a.type === 'CNAME')) };
      } catch (e) {
        return { type, error: e.message };
      }
    }),
  );
  // 最初のA（なければAAAA）レコードのIPについて、所在地なども合わせて調べる
  const ipJob = dnsJob
    .then((recs) => {
      const first = ['A', 'AAAA'].flatMap((t) => recs.find((r) => r.type === t)?.answers || []).find((a) => a.type === 'A' || a.type === 'AAAA');
      const ip = first && parseIp(first.data);
      return ip ? lookupIp(ip) : null;
    })
    .catch(() => null);
  const [dnsRecords, registration, ip] = await Promise.all([dnsJob, registrationLookup(candidates), ipJob]);

  // CNAMEはAの問い合わせにも付いてくるので、重複を除く
  const cname = dnsRecords.find((r) => r.type === 'CNAME');
  const a = dnsRecords.find((r) => r.type === 'A');
  if (a?.answers && cname?.answers?.length) a.answers = a.answers.filter((x) => x.type === 'A');

  return { query: name, ip, ...registration, dns: dnsRecords };
}

async function registrationLookup(candidates) {
  const out = { registered: null, rdap: null, whois: null, errors: {} };
  try {
    for (const domain of candidates) {
      const r = await rdapFetch(`domain/${domain}`);
      if (!r) continue;
      out.registered = domain;
      out.rdap = parseDomainRdap(r);
      return out;
    }
  } catch (e) {
    out.errors.rdap = e.message;
  }

  // RDAPに対応していないTLD（.jp など）は、従来のWHOIS（TCP 43番）で調べる
  try {
    const tld = candidates[0].split('.').pop();
    const iana = await whoisQuery('whois.iana.org', tld);
    const server = /^whois:\s*(\S+)/im.exec(iana)?.[1];
    if (!server) throw new Error('no_whois_server');
    for (const domain of candidates.slice(0, 3)) {
      const text = (await whoisQuery(server, server === 'whois.jprs.jp' ? `${domain}/e` : domain)).trim();
      if (!text || /no match|not found|no entries found|no data found|no object found|is available|status:\s*(free|available)/i.test(text)) continue;
      out.registered = domain;
      out.whois = { server, text: text.slice(0, 20000) };
      return out;
    }
  } catch (e) {
    out.errors.whois = e.message;
  }
  return out;
}

async function whoisQuery(hostname, query) {
  const { connect } = await import('cloudflare:sockets');
  const socket = connect({ hostname, port: 43 });
  const timer = setTimeout(() => socket.close().catch(() => {}), 7000);
  try {
    const writer = socket.writable.getWriter();
    await writer.write(new TextEncoder().encode(`${query}\r\n`));
    writer.releaseLock();
    const reader = socket.readable.getReader();
    const dec = new TextDecoder();
    let text = '';
    while (text.length < 65536) {
      const { value, done } = await reader.read();
      if (done) break;
      text += dec.decode(value, { stream: true });
    }
    return text;
  } finally {
    clearTimeout(timer);
    socket.close().catch(() => {});
  }
}

// ---------- Tor出口ノードの判定 ----------

// Tor Project が公開している出口ノードのIPv4一覧。同じ実行環境の中では30分使い回す
let torCache = { at: 0, set: null };
async function torExitSet() {
  if (torCache.set && Date.now() - torCache.at < 30 * 60 * 1000) return torCache.set;
  const res = await fetch('https://check.torproject.org/torbulkexitlist', {
    cf: { cacheTtl: 3600, cacheEverything: true },
    signal: AbortSignal.timeout(4000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const set = new Set((await res.text()).split('\n').map((line) => line.trim()).filter(Boolean));
  torCache = { at: Date.now(), set };
  return set;
}

// true / false を返す。分からないとき（IPv6や一覧の取得失敗）は null
async function isTorExit(ipText, country) {
  if (country === 'T1') return true; // Cloudflare は Tor 経由の接続に国コード T1 を付ける
  if (ipText.includes(':')) return null;
  try {
    return (await torExitSet()).has(ipText);
  } catch {
    return null;
  }
}

// ---------- 調べる先の検証（ポート・HTTP共通） ----------

// 外から調べる意味のない宛先（LAN内、ループバックなど）は断る
function assertPublicHost(hostname) {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  const ip = parseIp(host);
  if (ip) {
    if (specialRange(ip)) throw new Error('private_host');
    return ip.text;
  }
  if (host === 'localhost' || /\.(local|localhost|internal|lan|home\.arpa)$/.test(host)) throw new Error('private_host');
  let name;
  try {
    name = normalizeName(host);
  } catch {
    throw new Error('bad_host');
  }
  if (!name.includes('.')) throw new Error('bad_host');
  return name;
}

// ---------- /api/ports ----------

const MAX_PORTS = 12;
const PORT_BATCH = 4; // 同時に開けるTCP接続の数を抑える

async function portsCheck(params) {
  const raw = (params.get('host') || '').trim().replace(/^[a-z]+:\/\//i, '').replace(/[/?#].*$/, '');
  if (!raw) throw new Error('bad_host');
  const host = assertPublicHost(raw);

  const ports = [...new Set((params.get('ports') || '').split(/[\s,]+/).filter(Boolean).map(Number))];
  if (!ports.length || ports.length > MAX_PORTS || ports.some((p) => !Number.isInteger(p) || p < 1 || p > 65535)) throw new Error('bad_ports');

  // 名前で指定されたときは、存在するか・LAN内のアドレスを指していないかを先に確かめる
  if (!parseIp(host)) {
    const a = await resolve(host, 'A').catch(() => null);
    const aaaa = a && !a.answers.some((x) => x.type === 'A') ? await resolve(host, 'AAAA').catch(() => null) : null;
    const addrs = [...(a?.answers || []), ...(aaaa?.answers || [])].filter((x) => x.type === 'A' || x.type === 'AAAA');
    if (a && aaaa && !addrs.length) throw new Error('host_not_found');
    if (addrs.some((x) => specialRange(parseIp(x.data)))) throw new Error('private_host');
  }

  const results = [];
  for (let i = 0; i < ports.length; i += PORT_BATCH) {
    results.push(...(await Promise.all(ports.slice(i, i + PORT_BATCH).map((port) => probePort(host, port)))));
  }
  return { host, results };
}

// open = 接続できた、closed = 断られた、filtered = 3秒待っても応答なし、unsupported = Workers からは試せない
async function probePort(hostname, port) {
  if (port === 25) return { port, state: 'unsupported' }; // Workers は25番（メール送信）に接続できない
  const started = Date.now();
  let socket;
  let timer;
  try {
    const { connect } = await import('cloudflare:sockets');
    socket = connect({ hostname, port });
    const outcome = await Promise.race([socket.opened.then(() => 'open'), new Promise((done) => (timer = setTimeout(() => done('filtered'), 3000)))]);
    return { port, state: outcome, ms: Date.now() - started };
  } catch {
    return { port, state: 'closed', ms: Date.now() - started };
  } finally {
    clearTimeout(timer);
    socket?.close().catch(() => {});
  }
}

// ---------- /api/http ----------

const MAX_REDIRECTS = 8;

async function httpCheck(params, selfHost) {
  let raw = (params.get('url') || '').trim();
  if (!raw) throw new Error('bad_url');
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) raw = `https://${raw}`;
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('bad_url');
  }

  const hops = [];
  let tooMany = false;
  for (let i = 0; ; i++) {
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('bad_url');
    if (url.hostname === selfHost) throw new Error('self');
    assertPublicHost(url.hostname);

    const started = Date.now();
    let res;
    try {
      // 転送は自動で追わず、1段ずつ記録する。本文は読まない
      res = await fetch(url, {
        redirect: 'manual',
        headers: { 'user-agent': 'Mozilla/5.0 (compatible; NetCheck/1.0; HTTP header check)', accept: '*/*' },
        signal: AbortSignal.timeout(8000),
      });
    } catch (e) {
      const timeout = e.name === 'TimeoutError' || e.name === 'AbortError';
      hops.push({ url: url.href, error: timeout ? 'timeout' : e.message || String(e), ms: Date.now() - started });
      break;
    }
    res.body?.cancel().catch(() => {});
    const location = res.headers.get('location');
    hops.push({
      url: url.href,
      status: res.status,
      statusText: res.statusText,
      ms: Date.now() - started,
      location,
      headers: [...res.headers.entries()].map(([name, value]) => ({ name, value })),
    });
    if (!(res.status >= 300 && res.status < 400 && location)) break;
    if (i + 1 >= MAX_REDIRECTS) {
      tooMany = true;
      break;
    }
    try {
      url = new URL(location, url);
    } catch {
      break;
    }
  }
  // 最終応答が https で成功していれば、脆弱性の連絡先を書くファイル（security.txt）があるかも見る
  let securityTxt = null;
  const last = hops[hops.length - 1];
  if (last && !last.error && last.status < 400 && url.protocol === 'https:') {
    const target = `${url.origin}/.well-known/security.txt`;
    try {
      const res = await fetch(target, { headers: { 'user-agent': 'Mozilla/5.0 (compatible; NetCheck/1.0; HTTP header check)' }, signal: AbortSignal.timeout(5000) });
      const text = res.ok ? (await res.text()).slice(0, 4096) : '';
      securityTxt = { url: target, found: /^contact:/im.test(text) };
    } catch {
      securityTxt = { url: target, found: false };
    }
  }
  return { hops, tooMany, securityTxt };
}

// ---------- /api/certs ----------

// 証明書の発行記録（Certificate Transparency）を crt.sh から引く。
// crt.sh は混んでいて失敗しやすいので、失敗時は画面側がブラウザから直接聞き直す
async function certsLookup(params) {
  const name = normalizeName(params.get('q') || '');
  if (!name.includes('.')) throw new Error('need_dot');
  const res = await fetch(certsUrl(name), {
    headers: { accept: 'application/json', 'user-agent': 'NetCheck/1.0 (certificate history lookup)' },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return { query: name, ...normalizeCerts(await res.json()) };
}

// ---------- /api/subdomains ----------

// 証明書の発行記録に出てくる名前から、サブドメインを洗い出す
async function subdomainsLookup(params) {
  const name = normalizeName(params.get('q') || '');
  if (!name.includes('.')) throw new Error('need_dot');
  const res = await fetch(subdomainsUrl(name), {
    headers: { accept: 'application/json', 'user-agent': 'NetCheck/1.0 (certificate history lookup)' },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return { query: name, ...normalizeSubdomains(await res.json(), name) };
}

// ---------- /api/mail ----------

// DKIMの鍵は「セレクター名._domainkey.ドメイン」に置かれる。名前は自由なので、よく使われるものだけ試す
const DKIM_SELECTORS = ['default', 'google', 'selector1', 'selector2', 'k1', 'k2', 's1', 's2', 'mail', 'dkim', 'smtp', 'mandrill', 'sig1', 'protonmail', 'fm1'];

const txtValues = (res) => res.answers.filter((a) => a.type === 'TXT').map((a) => a.data.replace(/^"|"$/g, '').replace(/" "/g, ''));

async function mailCheck(params) {
  const domain = normalizeName(params.get('q') || '');
  if (!domain.includes('.')) throw new Error('need_dot');
  const txt = (name) => resolve(name, 'TXT').then(txtValues).catch(() => null);

  const [mxRes, root, dmarcTxt, mtaSts, tlsRpt, bimi, ...dkimTxt] = await Promise.all([
    resolve(domain, 'MX').catch(() => null),
    txt(domain),
    txt(`_dmarc.${domain}`),
    txt(`_mta-sts.${domain}`),
    txt(`_smtp._tls.${domain}`),
    txt(`default._bimi.${domain}`),
    ...DKIM_SELECTORS.map((s) => txt(`${s}._domainkey.${domain}`)),
  ]);
  if (!mxRes && !root) throw new Error('bad_response'); // DNSにまったく届かなかった

  const mx = (mxRes?.answers || [])
    .filter((a) => a.type === 'MX')
    .map((a) => {
      const [priority, host] = a.data.split(' ');
      return { priority: Number(priority), host };
    })
    .sort((a, b) => a.priority - b.priority);

  const spfRecords = (root || []).filter((v) => /^v=spf1(\s|$)/i.test(v));
  const spfRecord = spfRecords[0] || null;
  const spf = {
    records: spfRecords,
    // 末尾の all の付け方：- 拒否、~ 疑わしい扱い、? 判断しない、+ 誰でも許可
    all: spfRecord ? /(?:^|\s)([-~?+]?)all(?:\s|$)/i.exec(spfRecord)?.[1] ?? null : null,
    redirect: spfRecord ? /(?:^|\s)redirect=(\S+)/i.exec(spfRecord)?.[1] || null : null,
    // このレコード自体が引き起こすDNS問い合わせの数（include 先の分は数えていない）
    lookups: spfRecord ? (spfRecord.match(/(?:^|\s)[-~?+]?(?:include:|a(?=[:/\s]|$)|mx(?=[:/\s]|$)|exists:|ptr(?=[:\s]|$)|redirect=)/gi) || []).length : 0,
  };
  if (spf.all === '') spf.all = '+'; // 記号なしの all は + と同じ意味

  const dmarcRecord = (dmarcTxt || []).find((v) => /^v=DMARC1/i.test(v)) || null;
  const tag = (name) => (dmarcRecord ? new RegExp(`(?:^|;)\\s*${name}\\s*=\\s*([^;]+)`, 'i').exec(dmarcRecord)?.[1].trim() || null : null);
  const dmarc = { record: dmarcRecord, policy: tag('p')?.toLowerCase() || null, subdomainPolicy: tag('sp')?.toLowerCase() || null, pct: tag('pct'), rua: tag('rua') };

  const dkim = DKIM_SELECTORS.map((selector, i) => ({ selector, record: (dkimTxt[i] || []).find((v) => /(^|;)\s*p=/i.test(v) || /^v=DKIM1/i.test(v)) || null })).filter((d) => d.record);
  const first = (list, re) => (list || []).find((v) => re.test(v)) || null;

  return {
    domain,
    mx,
    nullMx: mx.length === 1 && mx[0].host === '.', // 「メールを受け取らない」と宣言している
    spf,
    dmarc,
    dkim: dkim.map((d) => ({ selector: d.selector, record: d.record.length > 160 ? `${d.record.slice(0, 160)}…` : d.record })),
    dkimTried: DKIM_SELECTORS.length,
    mtaSts: first(mtaSts, /^v=STSv1/i),
    tlsRpt: first(tlsRpt, /^v=TLSRPTv1/i),
    bimi: first(bimi, /^v=BIMI1/i),
  };
}

// ---------- /api/asn ----------

async function asnLookup(params) {
  const m = /^(?:as)?\s*(\d{1,10})$/i.exec((params.get('q') || '').trim());
  if (!m || Number(m[1]) < 1 || Number(m[1]) > 4294967295) throw new Error('bad_asn');
  const asn = String(Number(m[1]));
  const res = await resolve(`AS${asn}.asn.cymru.com`, 'TXT');
  const record = res.answers.find((a) => a.type === 'TXT');
  if (!record) return { asn, found: false };
  const [, country, registry, allocated, name] = txtFields(record);
  return { asn, found: true, name: name || null, country: country || null, registry: registry || null, allocated: allocated || null };
}

// ---------- /api/timing ----------

// 同じURLに5回続けてアクセスし、応答までの時間を測る（転送は追わない。本文は読まない）
async function timingCheck(params, selfHost) {
  let raw = (params.get('url') || '').trim();
  if (!raw) throw new Error('bad_url');
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) raw = `https://${raw}`;
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('bad_url');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('bad_url');
  if (url.hostname === selfHost) throw new Error('self');
  assertPublicHost(url.hostname);

  const runs = [];
  for (let i = 0; i < 5; i++) {
    const started = Date.now();
    try {
      const res = await fetch(url, {
        redirect: 'manual',
        headers: { 'user-agent': 'Mozilla/5.0 (compatible; NetCheck/1.0; response time check)', accept: '*/*', 'cache-control': 'no-cache' },
        signal: AbortSignal.timeout(8000),
      });
      res.body?.cancel().catch(() => {});
      runs.push({ ms: Date.now() - started, status: res.status });
    } catch (e) {
      const timeout = e.name === 'TimeoutError' || e.name === 'AbortError';
      runs.push({ ms: Date.now() - started, error: timeout ? 'timeout' : e.message || String(e) });
    }
  }
  return { url: url.href, runs };
}

// ---------- /api/counter と /api/bbs（訪問数と掲示板） ----------
// データは Durable Object「Board」1つに持つ（Cloudflare の無料枠で使える、小さな専用データベース）。
// 保存するのは、訪問数（数字だけ）と、掲示板の書き込み（名前・本文・日時）。IPアドレスは保存しない。

const BBS_MAX_NAME = 20;
const BBS_MAX_MESSAGE = 200;

async function board(request, env, url) {
  if (!env?.BOARD) return json({ error: 'no_board' }, 503);
  const stub = env.BOARD.get(env.BOARD.idFromName('main'));
  const call = (path, init) => stub.fetch(`https://board${path}`, init);
  const method = request.method;

  if (url.pathname === '/api/counter') {
    // POST は1回の訪問として数える。GET は数字を読むだけ
    return call(method === 'POST' ? '/hit' : '/stats', { method: method === 'POST' ? 'POST' : 'GET' });
  }

  if (method === 'GET') return call('/posts');

  if (method === 'POST') {
    let body;
    try {
      body = JSON.parse((await request.text()).slice(0, 4000));
    } catch {
      return json({ error: 'bbs_bad' }, 400);
    }
    // 制御文字を落として前後の空白を取る
    const clean = (v, max) => String(v ?? '').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').trim().slice(0, max);
    const name = clean(body.name, BBS_MAX_NAME) || '名無しさん';
    const message = clean(body.message, BBS_MAX_MESSAGE);
    if (body.website) return json({ ok: true }); // 人には見えない入力欄。埋まっていたら自動投稿とみなし、成功したふりだけする
    if (!message) return json({ error: 'bbs_empty' }, 400);
    if (/https?:\/\/|www\./i.test(`${name} ${message}`)) return json({ error: 'bbs_no_links' }, 400); // 宣伝の書き込み対策
    return call('/posts', { method: 'POST', body: JSON.stringify({ name, message }) });
  }

  if (method === 'DELETE') {
    // 管理用：シークレット ADMIN_KEY を設定したときだけ使える
    if (!env.ADMIN_KEY || url.searchParams.get('key') !== env.ADMIN_KEY) return json({ error: 'forbidden' }, 403);
    return call(`/posts?id=${encodeURIComponent(url.searchParams.get('id') || '')}`, { method: 'DELETE' });
  }
  return json({ error: 'method' }, 405);
}

export class Board {
  constructor(state) {
    this.sql = state.storage.sql;
    this.sql.exec('CREATE TABLE IF NOT EXISTS counts (k TEXT PRIMARY KEY, v INTEGER NOT NULL)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS posts (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, message TEXT NOT NULL, created INTEGER NOT NULL)');
  }

  // 日本時間の日付（YYYY-MM-DD）。「本日」「昨日」の区切りに使う
  day(offsetDays = 0) {
    return new Date(Date.now() + 9 * 3600 * 1000 - offsetDays * 86400 * 1000).toISOString().slice(0, 10);
  }

  count(key) {
    return this.sql.exec('SELECT v FROM counts WHERE k = ?', key).toArray()[0]?.v || 0;
  }

  stats() {
    return { total: this.count('total'), today: this.count(`day:${this.day()}`), yesterday: this.count(`day:${this.day(1)}`) };
  }

  posts() {
    return this.sql.exec('SELECT id, name, message, created FROM posts ORDER BY id DESC LIMIT 50').toArray();
  }

  async fetch(request) {
    const url = new URL(request.url);
    const reply = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });

    if (url.pathname === '/hit') {
      for (const key of ['total', `day:${this.day()}`]) this.sql.exec('INSERT INTO counts (k, v) VALUES (?, 1) ON CONFLICT(k) DO UPDATE SET v = v + 1', key);
      this.sql.exec("DELETE FROM counts WHERE k LIKE 'day:%' AND k < ?", `day:${this.day(7)}`); // 古い日別の数は消す
      return reply(this.stats());
    }
    if (url.pathname === '/stats') return reply(this.stats());

    if (url.pathname === '/posts') {
      if (request.method === 'POST') {
        const { name, message } = await request.json();
        this.sql.exec('INSERT INTO posts (name, message, created) VALUES (?, ?, ?)', name, message, Date.now());
        this.sql.exec('DELETE FROM posts WHERE id NOT IN (SELECT id FROM posts ORDER BY id DESC LIMIT 200)'); // 新しい200件だけ残す
      } else if (request.method === 'DELETE') {
        this.sql.exec('DELETE FROM posts WHERE id = ?', Number(url.searchParams.get('id')));
      }
      return reply({ posts: this.posts() });
    }
    return reply({ error: 'not_found' }, 404);
  }
}
