// crt.sh（証明書の発行記録の検索サービス）の応答を、画面で使う形に整える。
// サーバー（src/index.js）とブラウザ（app.js）の両方から読み込む。

export const certsUrl = (name) => `https://crt.sh/?q=${encodeURIComponent(name)}&output=json&deduplicate=Y`;

const MAX_SHOWN = 40;

// 発行者の識別名（C=US, O=Let's Encrypt, CN=R3 など）から、組織名か共通名を取り出す
function issuerName(dn) {
  const pick = (key) => new RegExp(`(?:^|,\\s*)${key}=("([^"]+)"|[^,]+)`).exec(dn || '');
  const o = pick('O');
  const cn = pick('CN');
  const text = (m) => (m ? (m[2] || m[1]).trim() : '');
  return [text(o), text(cn)].filter(Boolean).join(' / ') || dn || '';
}

export function normalizeCerts(raw) {
  const seen = new Set();
  const list = [];
  for (const c of Array.isArray(raw) ? raw : []) {
    // 事前証明書と本証明書は同じシリアル番号で2件出るので、1件にまとめる
    const key = c.serial_number || c.id;
    if (seen.has(key)) continue;
    seen.add(key);
    list.push({
      id: c.id,
      notBefore: c.not_before || null,
      notAfter: c.not_after || null,
      issuer: issuerName(c.issuer_name),
      names: [...new Set(String(c.name_value || c.common_name || '').split('\n').map((n) => n.trim()).filter(Boolean))],
    });
  }
  list.sort((a, b) => String(b.notBefore).localeCompare(String(a.notBefore)));
  return { total: list.length, certs: list.slice(0, MAX_SHOWN) };
}

// ---------- サブドメインの洗い出し ----------

export const subdomainsUrl = (name) => `https://crt.sh/?q=${encodeURIComponent(`%.${name}`)}&output=json&deduplicate=Y`;

const MAX_SUBDOMAINS = 500;

// 証明書に書かれた名前のうち、調べたドメインの下にあるものを重複なく集める
export function normalizeSubdomains(raw, name) {
  const suffix = `.${name.toLowerCase()}`;
  const found = new Set();
  for (const c of Array.isArray(raw) ? raw : []) {
    for (const line of String(c.name_value || c.common_name || '').split('\n')) {
      const host = line.trim().toLowerCase().replace(/^\*\./, '');
      if (host.endsWith(suffix) && /^[a-z0-9._-]+$/.test(host)) found.add(host);
    }
  }
  const list = [...found].sort((a, b) => a.split('.').reverse().join('.').localeCompare(b.split('.').reverse().join('.')));
  return { total: list.length, subdomains: list.slice(0, MAX_SUBDOMAINS) };
}
