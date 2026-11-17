// NetCheck Worker: /api/info（接続情報）、/api/dns（DNS伝播）、/api/ip（IP検索）、/api/domain（ドメイン検索）
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
const ECS_RESOLVER = 'https://dns.google/dns-query';
const LOCATIONS = [
  { id: 'jp', cc: 'JP', ecs: '126.0.0.0/24' },
  { id: 'kr', cc: 'KR', ecs: '121.128.0.0/24' },
  { id: 'sg', cc: 'SG', ecs: '220.255.0.0/24' },
  { id: 'in', cc: 'IN', ecs: '117.192.0.0/24' },
  { id: 'au', cc: 'AU', ecs: '58.160.0.0/24' },
  { id: 'de', cc: 'DE', ecs: '84.128.0.0/24' },
  { id: 'gb', cc: 'GB', ecs: '86.128.0.0/24' },
  { id: 'fr', cc: 'FR', ecs: '90.0.0.0/24' },
  { id: 'us-e', cc: 'US', isp: 'Comcast', ecs: '73.0.0.0/24' },
  { id: 'us-w', cc: 'US', isp: 'AT&T', ecs: '99.0.0.0/24' },
  { id: 'br', cc: 'BR', ecs: '177.0.0.0/24' },
  { id: 'za', cc: 'ZA', ecs: '41.0.0.0/24' },
];

export default {
  async fetch(request) {
    const url = new URL(request.url);
    // エラーは短いコード（bad_name など）で返し、画面側が表示言語に合わせて文言にする
    try {
      if (url.pathname === '/api/info') return json(info(request));
      if (url.pathname === '/api/dns') return json(await dns(url.searchParams));
      if (url.pathname === '/api/ip') return json(await ipLookup(url.searchParams));
      if (url.pathname === '/api/domain') return json(await domainLookup(url.searchParams));
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
  if (!TYPES[type]) throw new Error('bad_type');
  const name = normalizeName(params.get('name') || '');
  const customEcs = params.get('ecs');

  const jobs = [
    ...RESOLVERS.map((r) => ({ group: 'resolver', id: r.id, label: r.label, note: r.note, url: r.url })),
    ...LOCATIONS.map((l) => ({ group: 'geo', id: l.id, cc: l.cc, isp: l.isp, note: l.ecs, url: ECS_RESOLVER, ecs: l.ecs })),
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
  const out = { ip: ip.text, version: ip.version, special, ptr: [], asn: null, geo: null, rdap: null, errors: {} };
  if (special) return out;

  const rev = reversedLabels(ip);
  const [ptr, origin, rdap, geo] = await Promise.allSettled([
    resolve(`${rev}.${ip.version === 4 ? 'in-addr' : 'ip6'}.arpa`, 'PTR'),
    // Team Cymru のIP→AS番号対応表（DNSで引ける公開サービス）
    resolve(`${rev}.${ip.version === 4 ? 'origin' : 'origin6'}.asn.cymru.com`, 'TXT'),
    rdapFetch(`ip/${ip.text}`),
    geoLookup(ip.text),
  ]);

  if (geo.status === 'fulfilled') out.geo = geo.value;
  else out.errors.geo = geo.reason.message;

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
    const r = rdap.value;
    if (r) {
      out.rdap = {
        name: r.name || null,
        handle: r.handle || null,
        start: r.startAddress || null,
        end: r.endAddress || null,
        cidr: (r.cidr0_cidrs || []).map((c) => `${c.v4prefix || c.v6prefix}/${c.length}`),
        country: r.country || null,
        type: r.type || null,
        parent: r.parentHandle || null,
        events: rdapEvents(r),
        entities: rdapEntities(r.entities),
        remarks: (r.remarks || []).flatMap((m) => m.description || []).slice(0, 8),
        source: r.port43 || null,
      };
    }
  } else out.errors.rdap = rdap.reason.message;

  return out;
}

// IPのおおよその所在地。無料で鍵の要らない ipwho.is を使う（別のサービスに替えるならこの関数だけ直す）
async function geoLookup(ipText) {
  const res = await fetch(`https://ipwho.is/${encodeURIComponent(ipText)}`, { signal: AbortSignal.timeout(6000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const g = await res.json();
  if (g.success === false) throw new Error(g.message || 'geo_failed');
  return {
    countryCode: g.country_code || null,
    region: g.region || null,
    city: g.city || null,
    postal: g.postal || null,
    lat: typeof g.latitude === 'number' ? g.latitude : null,
    lon: typeof g.longitude === 'number' ? g.longitude : null,
    timezone: g.timezone?.id || null,
    isp: g.connection?.isp || null,
    org: g.connection?.org || null,
  };
}

// ---------- RDAP ----------

// rdap.org は、問い合わせ先の正しいレジストリへ転送してくれる公開の振り分けサービス
async function rdapFetch(path) {
  const res = await fetch(`https://rdap.org/${path}`, {
    headers: { accept: 'application/rdap+json, application/json' },
    signal: AbortSignal.timeout(8000),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

const rdapEvents = (obj) => Object.fromEntries((obj.events || []).map((e) => [e.eventAction, e.eventDate]));

function rdapEntities(list, depth = 0, out = []) {
  for (const e of list || []) {
    const item = { roles: e.roles || [], handle: e.handle || null, name: null, org: null, email: null, tel: null, address: null };
    for (const [key, vparams, , value] of e.vcardArray?.[1] || []) {
      if (key === 'fn') item.name = value;
      else if (key === 'org') item.org = Array.isArray(value) ? value.join(' ') : value;
      else if (key === 'email') item.email ??= value;
      else if (key === 'tel') item.tel ??= String(value).replace(/^tel:/, '');
      else if (key === 'adr') item.address = (vparams?.label || (Array.isArray(value) ? value.flat().filter(Boolean).join(', ') : '')).replace(/\s*\n\s*/g, ', ') || null;
    }
    const iana = (e.publicIds || []).find((p) => /iana/i.test(p.type || ''));
    if (iana) item.ianaId = iana.identifier;
    out.push(item);
    if (depth < 2) rdapEntities(e.entities, depth + 1, out);
  }
  return out;
}

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
      const entities = rdapEntities(r.entities);
      const registrar = entities.find((e) => e.roles.includes('registrar')) || null;
      out.registered = domain;
      out.rdap = {
        handle: r.handle || null,
        status: r.status || [],
        events: rdapEvents(r),
        nameservers: (r.nameservers || []).map((n) => (n.ldhName || '').toLowerCase()).filter(Boolean),
        dnssec: r.secureDNS?.delegationSigned ?? null,
        registrar: registrar && { name: registrar.name || registrar.org, ianaId: registrar.ianaId || null },
        entities,
        source: r.port43 || null,
      };
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
