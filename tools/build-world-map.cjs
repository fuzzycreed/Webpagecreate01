// public/world-110m.json を作り直すスクリプト。
// 使い方: npm i --no-save world-atlas topojson-client && node tools/build-world-map.cjs public/world-110m.json
// Natural Earth 110m の国境データ（world-atlas、パブリックドメイン）を、正距円筒図法のSVGパス1本に変換する
const topojson = require('topojson-client'); const fs = require('fs');
const topo = require('world-atlas/countries-110m.json');
const W = 1000, H = 500; const r = (n) => Math.round(n * 10) / 10;
let d = '';
for (const f of topojson.feature(topo, topo.objects.countries).features) {
  if (f.id === '010') continue; // 南極は省く
  const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
  for (const poly of polys) for (const ring of poly) {
    let prev = '', prevLon = null;
    // 日付変更線をまたぐ輪（フィジーなど）は、地図を横切る線にならないよう、またぐ所で線を切る
    ring.forEach(([lon, lat], i) => { const p = `${r((lon + 180) / 360 * W)},${r((90 - lat) / 180 * H)}`; const jump = prevLon !== null && Math.abs(lon - prevLon) > 180; if (p !== prev) d += (i && !jump ? 'L' : 'M') + p; prev = p; prevLon = lon; });
    d += 'Z';
  }
}
fs.writeFileSync(process.argv[2], JSON.stringify({ width: W, height: H, viewBox: '0 18 1000 395', d }));
console.log('bytes', d.length);
