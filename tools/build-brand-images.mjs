// アイコンと、SNSで共有したときに出る画像（og.png）を作り直すスクリプト。
// 使い方: node tools/build-brand-images.mjs   （Playwright と Chromium が入っている環境で実行する）
import { createRequire } from 'node:module';
import fs from 'node:fs';
const { chromium } = createRequire(import.meta.url)('playwright');
const out = new URL('../public/', import.meta.url).pathname;
const svg = fs.readFileSync(out + 'favicon.svg', 'utf8');
const browser = await chromium.launch();

// アイコン：favicon.svg を各サイズのPNGにする
for (const [name, size] of [['favicon-32.png', 32], ['apple-touch-icon.png', 180], ['icon-192.png', 192], ['icon-512.png', 512]]) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.setContent(`<body style="margin:0">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body>`);
  await page.screenshot({ path: out + name, omitBackground: true });
  await page.close();
}

// 共有用の画像（1200×630）：標準テーマと同じ、白と灰色のブロック模様
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await page.setContent(`<body style="margin:0;width:1200px;height:630px;display:grid;place-items:center;font-family:'Helvetica Neue',Arial,sans-serif;color:#333;
  background:conic-gradient(from 90deg at 50% 50%,#e6e6e3 25%,#f2f2f0 0 50%,#dededa 0 75%,#ececea 0) 0 0/60px 60px">
  <div style="width:1000px;padding:56px 60px;background:#fff;border:2px solid #cfcfcb;box-shadow:12px 12px 0 #d2d2ce;text-align:center">
    <div style="display:flex;justify-content:center;align-items:center;gap:28px">
      ${svg.replace('<svg ', '<svg width="110" height="110" ')}
      <div style="font-size:92px;font-weight:800;letter-spacing:16px;color:#4a4a4a">NETCHECK</div>
    </div>
    <div style="margin-top:22px;font-size:34px;letter-spacing:4px;color:#666">Connection · Browser · DNS diagnostics</div>
    <div style="margin-top:34px;display:flex;flex-wrap:wrap;justify-content:center;gap:12px;font-size:25px">
      ${['IP &amp; location', 'Fingerprint', 'WebRTC leak', 'DNS propagation', 'Mail check', 'Ports', 'HTTP headers', 'Certificates'].map((x) => `<span style="padding:6px 18px;border:2px solid #dcdcd8;background:#f7f7f5">${x}</span>`).join('')}
    </div>
  </div></body>`);
await page.screenshot({ path: out + 'og.png' });
await browser.close();
