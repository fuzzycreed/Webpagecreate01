// RDAP（WHOISの後継）の応答を、画面で使う形に整える。
// サーバー（src/index.js）とブラウザ（app.js）の両方から読み込む。

const events = (obj) => Object.fromEntries((obj.events || []).map((e) => [e.eventAction, e.eventDate]));

// 連絡先（entities）は入れ子になっているので、平らな一覧にする
function entities(list, depth = 0, out = []) {
  for (const e of list || []) {
    const item = { roles: e.roles || [], handle: e.handle || null, name: null, org: null, email: null, tel: null, address: null, url: null };
    for (const [key, vparams, , value] of e.vcardArray?.[1] || []) {
      if (key === 'fn') item.name = value;
      else if (key === 'org') item.org = Array.isArray(value) ? value.join(' ') : value;
      else if (key === 'email') item.email ??= value;
      else if (key === 'tel') item.tel ??= String(value).replace(/^tel:/, '');
      else if (key === 'contact-uri' || key === 'url') item.url ??= /^(https?:|mailto:)/i.test(String(value)) ? String(value) : null; // 連絡用フォームなど
      else if (key === 'adr') item.address = (vparams?.label || (Array.isArray(value) ? value.flat().filter(Boolean).join(', ') : '')).replace(/\s*\n\s*/g, ', ') || null;
    }
    const iana = (e.publicIds || []).find((p) => /iana/i.test(p.type || ''));
    if (iana) item.ianaId = iana.identifier;
    out.push(item);
    if (depth < 2) entities(e.entities, depth + 1, out);
  }
  return out;
}

export function parseIpRdap(r) {
  return {
    name: r.name || null,
    handle: r.handle || null,
    start: r.startAddress || null,
    end: r.endAddress || null,
    cidr: (r.cidr0_cidrs || []).map((c) => `${c.v4prefix || c.v6prefix}/${c.length}`),
    country: r.country || null,
    type: r.type || null,
    parent: r.parentHandle || null,
    events: events(r),
    entities: entities(r.entities),
    remarks: (r.remarks || []).flatMap((m) => m.description || []).slice(0, 8),
    source: r.port43 || null,
  };
}

export function parseDomainRdap(r) {
  const list = entities(r.entities);
  const registrar = list.find((e) => e.roles.includes('registrar')) || null;
  return {
    handle: r.handle || null,
    status: r.status || [],
    events: events(r),
    nameservers: (r.nameservers || []).map((n) => (n.ldhName || '').toLowerCase()).filter(Boolean),
    dnssec: r.secureDNS?.delegationSigned ?? null,
    registrar: registrar && { name: registrar.name || registrar.org, ianaId: registrar.ianaId || null },
    entities: list,
    source: r.port43 || null,
  };
}

// 各地域の登録機関（RIR）のRDAP。registry は Team Cymru が返す名前（apnic、ripencc など）
const RIR_RDAP = {
  arin: 'https://rdap.arin.net/registry/ip/',
  ripencc: 'https://rdap.db.ripe.net/ip/',
  apnic: 'https://rdap.apnic.net/ip/',
  lacnic: 'https://rdap.lacnic.net/rdap/ip/',
  afrinic: 'https://rdap.afrinic.net/rdap/ip/',
};

// IPの登録情報を聞く先の候補。先頭から順に試す
export function rdapIpUrls(ip, registry) {
  const urls = [`https://rdap.org/ip/${ip}`];
  const direct = RIR_RDAP[String(registry || '').toLowerCase()];
  if (direct) urls.push(direct + ip);
  return urls;
}

// ---------- レジストラ側の登録情報 ----------
// .com や .net などでは、レジストリ（ドメイン全体の管理元）の応答には登録者や技術担当の情報が入っておらず、
// レジストラ（販売業者）のRDAPへのリンク（rel="related"）だけが書かれている。そのリンク先を返す
export function relatedRdapUrl(r) {
  const link = (r.links || []).find((l) => l.rel === 'related' && /rdap|json/i.test(l.type || 'rdap') && /^https:\/\//i.test(l.href || ''));
  return link ? link.href : null;
}

// レジストリの情報（base）に、レジストラの情報（extra）を重ねる。連絡先はレジストラ側のほうが詳しい
export function mergeDomainRdap(base, extra) {
  const same = (a, b) => a.roles.join() === b.roles.join() && a.name === b.name && a.email === b.email;
  return {
    ...base,
    status: [...new Set([...base.status, ...extra.status])],
    events: { ...extra.events, ...base.events },
    registrar: base.registrar || extra.registrar,
    entities: [...base.entities, ...extra.entities.filter((e) => !base.entities.some((b) => same(b, e)))],
  };
}
