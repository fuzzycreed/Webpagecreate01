// NetCheck Worker: /api/info（接続情報）と /api/dns（DNS伝播チェック）
// 静的ファイルは wrangler.jsonc の assets 設定で public/ から配信される。

const TYPES = { A: 1, NS: 2, CNAME: 5, SOA: 6, PTR: 12, MX: 15, TXT: 16, AAAA: 28, SRV: 33, CAA: 257 };
const TYPE_NAMES = Object.fromEntries(Object.entries(TYPES).map(([k, v]) => [v, k]));
const RCODES = ['NOERROR', 'FORMERR', 'SERVFAIL', 'NXDOMAIN', 'NOTIMP', 'REFUSED'];

// 公開DoHリゾルバー（RFC 8484 / application/dns-message）
const RESOLVERS = [
  { id: 'google', label: 'Google Public DNS', note: '8.8.8.8', url: 'https://dns.google/dns-query' },
  { id: 'cloudflare', label: 'Cloudflare', note: '1.1.1.1', url: 'https://cloudflare-dns.com/dns-query' },
  { id: 'quad9', label: 'Quad9', note: '9.9.9.9', url: 'https://dns.quad9.net/dns-query' },
  { id: 'opendns', label: 'OpenDNS (Cisco)', note: '208.67.222.222', url: 'https://doh.opendns.com/dns-query' },
  { id: 'adguard', label: 'AdGuard (フィルターなし)', note: '94.140.14.140', url: 'https://unfiltered.adguard-dns.com/dns-query' },
  { id: 'nextdns', label: 'NextDNS', note: 'anycast', url: 'https://dns.nextdns.io/dns-query' },
  { id: 'mullvad', label: 'Mullvad', note: '194.242.2.2', url: 'https://dns.mullvad.net/dns-query' },
  { id: 'controld', label: 'Control D', note: '76.76.2.0', url: 'https://freedns.controld.com/p0' },
  { id: 'dnssb', label: 'DNS.SB', note: '185.222.222.222', url: 'https://doh.dns.sb/dns-query' },
  { id: 'iij', label: 'IIJ Public DNS', note: '日本', url: 'https://public.dns.iij.jp/dns-query' },
  { id: 'alidns', label: 'AliDNS', note: '中国 223.5.5.5', url: 'https://dns.alidns.com/dns-query' },
  { id: 'dnspod', label: 'DNSPod (Tencent)', note: '中国 119.29.29.29', url: 'https://doh.pub/dns-query' },
];

// EDNS Client Subnet で「その地域のユーザーから来た問い合わせ」を擬似的に再現する。
// サブネットは各国の大手ISPの代表的な帯域（おおよその目安）。
const ECS_RESOLVER = 'https://dns.google/dns-query';
const LOCATIONS = [
  { id: 'jp', label: '日本', flag: '🇯🇵', ecs: '126.0.0.0/24' },
  { id: 'kr', label: '韓国', flag: '🇰🇷', ecs: '121.128.0.0/24' },
  { id: 'sg', label: 'シンガポール', flag: '🇸🇬', ecs: '220.255.0.0/24' },
  { id: 'in', label: 'インド', flag: '🇮🇳', ecs: '117.192.0.0/24' },
  { id: 'au', label: 'オーストラリア', flag: '🇦🇺', ecs: '58.160.0.0/24' },
  { id: 'de', label: 'ドイツ', flag: '🇩🇪', ecs: '84.128.0.0/24' },
  { id: 'gb', label: 'イギリス', flag: '🇬🇧', ecs: '86.128.0.0/24' },
  { id: 'fr', label: 'フランス', flag: '🇫🇷', ecs: '90.0.0.0/24' },
  { id: 'us-e', label: 'アメリカ (Comcast)', flag: '🇺🇸', ecs: '73.0.0.0/24' },
  { id: 'us-w', label: 'アメリカ (AT&T)', flag: '🇺🇸', ecs: '99.0.0.0/24' },
  { id: 'br', label: 'ブラジル', flag: '🇧🇷', ecs: '177.0.0.0/24' },
  { id: 'za', label: '南アフリカ', flag: '🇿🇦', ecs: '41.0.0.0/24' },
];

export default {
  async fetch(request) {
    const url = new URL(request.url);
    try {
      if (url.pathname === '/api/info') return json(info(request));
      if (url.pathname === '/api/dns') return json(await dns(url.searchParams));
    } catch (e) {
      return json({ error: e.message || String(e) }, 400);
    }
    return new Response('Not found', { status: 404 });
  },
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

// ---------- /api/info ----------

function info(request) {
  const cf = request.cf || {};
  const h = request.headers;
  const ip = h.get('cf-connecting-ip') || h.get('x-real-ip') || '';
  const pick = (...keys) => Object.fromEntries(keys.map((k) => [k, cf[k] ?? null]));
  return {
    ip,
    ipVersion: ip.includes(':') ? 6 : ip ? 4 : null,
    geo: pick('country', 'isEUCountry', 'continent', 'region', 'regionCode', 'city', 'postalCode', 'latitude', 'longitude', 'timezone'),
    network: pick('asn', 'asOrganization', 'colo'),
    connection: pick('httpProtocol', 'tlsVersion', 'tlsCipher', 'clientTcpRtt', 'clientAcceptEncoding'),
    headers: [...h.entries()].map(([name, value]) => ({ name, value })),
  };
}

// ---------- /api/dns ----------

async function dns(params) {
  const type = (params.get('type') || 'A').toUpperCase();
  if (!TYPES[type]) throw new Error(`未対応のレコードタイプです: ${type}`);
  const name = normalizeName(params.get('name') || '');
  const customEcs = params.get('ecs');

  const jobs = [
    ...RESOLVERS.map((r) => ({ group: 'resolver', id: r.id, label: r.label, note: r.note, url: r.url })),
    ...LOCATIONS.map((l) => ({ group: 'geo', id: l.id, label: l.label, flag: l.flag, note: l.ecs, url: ECS_RESOLVER, ecs: l.ecs })),
  ];
  if (customEcs) {
    parseEcs(customEcs); // 不正ならここで例外
    jobs.push({ group: 'geo', id: 'custom', label: '指定サブネット', flag: '📍', note: customEcs, url: ECS_RESOLVER, ecs: customEcs });
  }

  const results = await Promise.all(
    jobs.map(async ({ url, ecs, ...meta }) => {
      const started = Date.now();
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/dns-message', accept: 'application/dns-message' },
          body: encodeQuery(name, TYPES[type], ecs),
          signal: AbortSignal.timeout(5000),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const msg = decodeResponse(new Uint8Array(await res.arrayBuffer()));
        return { ...meta, ms: Date.now() - started, ...msg };
      } catch (e) {
        const timeout = e.name === 'TimeoutError' || e.name === 'AbortError';
        return { ...meta, ms: Date.now() - started, error: timeout ? 'タイムアウト' : e.message || String(e) };
      }
    }),
  );
  return { name, type, results };
}

function normalizeName(input) {
  let s = input.trim().replace(/^[a-z]+:\/\//i, '').replace(/[/?#].*$/, '').replace(/\.$/, '');
  if (!s) throw new Error('ドメイン名を入力してください');
  let host;
  try {
    host = new URL(`http://${s}`).hostname; // 日本語ドメインなどを punycode に変換
  } catch {
    throw new Error('ドメイン名の形式が正しくありません');
  }
  if (host.length > 253 || !/^[a-z0-9_]([a-z0-9_-]*[a-z0-9_])?(\.[a-z0-9_]([a-z0-9_-]*[a-z0-9_])?)*$/i.test(host)) {
    throw new Error('ドメイン名の形式が正しくありません');
  }
  return host;
}

function parseEcs(ecs) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?:\/(\d{1,2}))?$/.exec(ecs.trim());
  if (!m) throw new Error('サブネットは 203.0.113.0/24 の形式（IPv4）で指定してください');
  const bytes = m.slice(1, 5).map(Number);
  const prefix = m[5] === undefined ? 24 : Number(m[5]);
  if (bytes.some((b) => b > 255) || prefix < 8 || prefix > 32) throw new Error('サブネットの値が範囲外です');
  return { bytes, prefix };
}

// ---------- DNS ワイヤーフォーマット ----------

function encodeQuery(name, qtype, ecs) {
  const enc = new TextEncoder();
  const out = [0, 0, 0x01, 0x00, 0, 1, 0, 0, 0, 0, 0, 1]; // ID=0, RD=1, QD=1, AR=1(OPT)
  for (const label of name.split('.')) {
    const b = enc.encode(label);
    if (!b.length || b.length > 63) throw new Error('ドメイン名の形式が正しくありません');
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
  if (buf.length < 12) throw new Error('応答が不正です');
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
    if (len === undefined) throw new Error('応答が不正です');
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
