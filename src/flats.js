// Сколько квартир в доме — по данным OpenStreetMap (Overpass): тег building:flats у здания по координатам.
// Если тега нет — грубая оценка: этажи × подъезды × 4 (с пометкой «≈»). Результаты кэшируются в flats.json.
const fs = require('fs');
const path = require('path');
const { app, net } = require('electron');
const MIRRORS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter'];
const file = () => path.join(app.getPath('userData'), 'flats.json');
let cache = null;
const load = () => { if (!cache) { try { cache = JSON.parse(fs.readFileSync(file(), 'utf8')); } catch { cache = {}; } } return cache; };
let saveT = null; const save = () => { clearTimeout(saveT); saveT = setTimeout(() => { try { fs.writeFileSync(file(), JSON.stringify(cache)); } catch {} }, 1500); };
const key = (lat, lon) => (+lat).toFixed(5) + ',' + (+lon).toFixed(5);
let queue = Promise.resolve();   // по одному запросу (Overpass не любит частые запросы)
async function overpass(q) {
  for (const u of MIRRORS) {
    try {
      const r = await net.fetch(u, { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'PVZMaster/1.0 (+https://github.com/Necly2/necly)' } });
      if (r.ok) return await r.json();
    } catch {}
  }
  return null;
}
const dist = (a, b, c, d) => Math.hypot((a - c) * 111320, (b - d) * 111320 * Math.cos(a * Math.PI / 180));
// запасной источник — МинЖКХ (dom.mingkh.ru): поиск дома по адресу в скрытом окне браузера (сайт проверяет «не робот ли»)
let mkWin = null;
async function mingkh(address) {
  const { BrowserWindow } = require('electron');
  if (!mkWin || mkWin.isDestroyed()) mkWin = new BrowserWindow({ show: false, width: 1200, height: 900, webPreferences: { partition: 'persist:maps', backgroundThrottling: false } });
  const wc = mkWin.webContents, sleep = ms => new Promise(r => setTimeout(r, ms));
  const q = String(address || '').replace(/^\s*(г\.?\s*)?москва[, ]*/i, '');
  if (!q) return null;
  await wc.loadURL('https://dom.mingkh.ru/search?searchtype=house&address=' + encodeURIComponent('Москва, ' + q)).catch(() => {});
  let link = null;
  for (let i = 0; i < 12 && !link; i++) {
    await sleep(1500);
    link = await wc.executeJavaScript(`(() => { if (/не робот/i.test(document.title)) return null; const a = [...document.querySelectorAll('a[href]')].find(a => /\/[a-z-]+\/[a-z-]+\/\d+\/?$/.test(a.getAttribute('href')) && /\d/.test(a.textContent)); return a ? a.href : (document.body && /ничего не найдено|не найден/i.test(document.body.innerText) ? '' : null); })()`).catch(() => null);
  }
  if (!link) return null;
  await wc.loadURL(link).catch(() => {});
  for (let i = 0; i < 10; i++) {
    await sleep(1200);
    const n = await wc.executeJavaScript(`(() => { const t = document.body ? document.body.innerText : ''; if (/не робот/i.test(document.title)) return null;
      const m = t.match(/(Количество квартир|Жилых помещений|Количество жилых помещений)[^\d\n]{0,20}(\d[\d\s]*)/i); return m ? +m[2].replace(/\s/g, '') : 0; })()`).catch(() => null);
    if (n !== null) return n > 0 ? { n, exact: true, src: 'МинЖКХ', url: link } : null;
  }
  return null;
}
async function lookup(lat, lon, address) {
  const k = key(lat, lon), c = load();
  if (c[k] && Date.now() - c[k].t < 90 * 864e5 && (c[k].n != null || c[k].tried)) return c[k];
  const run = async () => {
    const q = `[out:json][timeout:20];way(around:25,${lat},${lon})["building"]->.b;.b out tags center;node(w.b)["entrance"];out ids;`;
    const j = await overpass(q);
    if (!j && !address) return { k, n: null, err: 'OpenStreetMap не ответил' };
    const els = (j && j.elements) || [];
    const ways = els.filter(e => e.type === 'way');
    const entrances = els.filter(e => e.type === 'node').length;
    // ближайшее здание с данными: сначала с building:flats, потом с этажностью
    ways.sort((a, b) => dist(lat, lon, a.center.lat, a.center.lon) - dist(lat, lon, b.center.lat, b.center.lon));
    const withFlats = ways.find(w => +w.tags['building:flats'] > 0);
    let res;
    if (withFlats) res = { n: +withFlats.tags['building:flats'], exact: true };
    else {
      const w = ways.find(x => /apartments|residential|house|yes/.test(x.tags.building) && +x.tags['building:levels'] > 0) || null;
      const lv = w ? +w.tags['building:levels'] : 0;
      res = lv >= 3 && /apartments|residential/.test(w.tags.building) ? { n: Math.round(lv * Math.max(1, entrances) * 4), exact: false, levels: lv, entrances } : { n: null };
    }
    if ((res.n == null || !res.exact) && address) { try { const m = await mingkh(address); if (m) res = m; } catch {} }
    c[k] = Object.assign({ t: Date.now(), tried: true, src: res.src || (res.n != null ? 'OpenStreetMap' : '') }, res); save(); return c[k];
  };
  const p = queue.then(run, run); queue = p.then(() => new Promise(r => setTimeout(r, 1100)), () => {}); return p;
}
module.exports = { lookup, cached: (lat, lon) => load()[key(lat, lon)] || null };
