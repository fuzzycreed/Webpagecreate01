// RDAP（WHOISの後継）の応答を、画面で使う形に整える。
// サーバー（src/index.js）とブラウザ（app.js）の両方から読み込む。

const events = (obj) => Object.fromEntries((obj.events || []).map((e) => [e.eventAction, e.eventDate]));

// 連絡先（entities）は入れ子になっているので、平らな一覧にする
function entities(list, depth = 0, out = []) {
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
