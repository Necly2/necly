// Сколько квартир в доме — по данным OpenStreetMap (Overpass): тег building:flats у здания по координатам.
// Если тега нет — грубая оценка: этажи × подъезды × 4 (с пометкой «≈»). Результаты кэшируются в flats.json.
const fs = require('fs');
const path = require('path');
let app, net; try { ({ app, net } = require("electron")); } catch {}
const MIRRORS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://overpass.private.coffee/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter'];
const file = () => path.join(app.getPath('userData'), 'flats.json');
let cache = null;
const load = () => { if (!cache) { try { cache = JSON.parse(fs.readFileSync(file(), 'utf8')); } catch { cache = {}; } } return cache; };
let saveT = null; const save = () => { clearTimeout(saveT); saveT = setTimeout(() => { try { fs.writeFileSync(file(), JSON.stringify(cache)); } catch {} }, 1500); };
const key = (lat, lon) => (+lat).toFixed(5) + ',' + (+lon).toFixed(5);
let queue = Promise.resolve();   // по одному запросу (Overpass не любит частые запросы)
// у каждого зеркала — срок ответа (раньше зависший сервер останавливал всю очередь, и «Квартир» оставалось пустым);
// ответившее зеркало пробуется первым
let good = 0;
async function overpass(q) {
  for (let i = 0; i < MIRRORS.length; i++) {
    const k = (good + i) % MIRRORS.length, ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 15000);
    try {
      const r = await net.fetch(MIRRORS[k], { method: 'POST', body: 'data=' + encodeURIComponent(q), signal: ctl.signal, headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'PVZMaster/1.0 (+https://github.com/Necly2/necly)' } });
      if (r.ok) { const j = await r.json(); good = k; return j; }
    } catch {} finally { clearTimeout(t); }
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
  const full = /област|обл\.|г\.о\.|гор\. ?округ/i.test(q) ? q : 'Москва, ' + q;   // адреса Подмосковья — без «Москва,»
  await wc.loadURL('https://dom.mingkh.ru/search?searchtype=house&address=' + encodeURIComponent(full)).catch(() => {});
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
// ---------- выбор здания и оценка числа квартир (чистые функции — проверяются tools/flats_test.js) ----------
const M = (lat, lon, lat0) => [(lon) * 111320 * Math.cos(lat0 * Math.PI / 180), lat * 111320];   // градусы → метры (локально)
const ringsOf = e => (e.type === 'way' ? [e.geometry || []] : (e.members || []).filter(m => m.type === 'way' && m.role !== 'inner' && m.geometry).map(m => m.geometry))
  .map(g => g.filter(Boolean).map(p => [p.lat, p.lon])).filter(r => r.length >= 3);
function ringArea(r, lat0) { let a = 0; for (let i = 0; i < r.length; i++) { const [x1, y1] = M(r[i][0], r[i][1], lat0), [x2, y2] = M(r[(i + 1) % r.length][0], r[(i + 1) % r.length][1], lat0); a += x1 * y2 - x2 * y1; } return Math.abs(a) / 2; }
function inRing(r, lat, lon) { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [a, b] = r[i], [d, e] = r[j]; if ((b > lon) !== (e > lon) && lat < (d - a) * (lon - b) / (e - b) + a) c = !c; } return c; }
function distRing(r, lat, lon) {
  const [px, py] = M(lat, lon, lat); let best = Infinity;
  for (let i = 0; i < r.length; i++) {
    const [x1, y1] = M(r[i][0], r[i][1], lat), [x2, y2] = M(r[(i + 1) % r.length][0], r[(i + 1) % r.length][1], lat);
    const dx = x2 - x1, dy = y2 - y1, l = dx * dx + dy * dy, t = l ? Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / l)) : 0;
    best = Math.min(best, Math.hypot(px - x1 - t * dx, py - y1 - t * dy));
  }
  return best;
}
const RES = /^(apartments|residential|dormitory)$/, NOT_RES = /^(commercial|retail|office|industrial|warehouse|school|kindergarten|hospital|university|college|church|garage|garages|service|kiosk|shed|roof|hotel|supermarket|public|civic|government|train_station|transportation|parking|construction|sports_centre|stadium)$/;
// elements — ответ Overpass (здания с геометрией и узлы-подъезды); → { n, exact, how, levels, entrances } или { n: null, why }
function estimate(elements, lat, lon) {
  const entIds = new Set(elements.filter(e => e.type === 'node').map(e => e.id));
  const cand = elements.filter(e => e.type !== 'node' && e.tags && e.tags.building).map(e => {
    const rings = ringsOf(e); if (!rings.length) return null;
    const d = rings.some(r => inRing(r, lat, lon)) ? 0 : Math.min(...rings.map(r => distRing(r, lat, lon)));
    return { e, t: e.tags, d, area: rings.reduce((a, r) => a + ringArea(r, lat), 0), lv: parseFloat(e.tags['building:levels']) || 0 };
  }).filter(Boolean).sort((a, b) => a.d - b.d);
  if (!cand.length) return { n: null, why: 'Рядом с точкой объявления нет здания в OpenStreetMap' };
  // дом объявления — ближайший; точка объявления часто стоит у фасада или на тротуаре, поэтому берём всё в 12 м от ближайшего
  const near = cand.filter(c => c.d <= cand[0].d + 12);
  const flats = near.find(c => +c.t['building:flats'] > 0);
  if (flats) return { n: +flats.t['building:flats'], exact: true };
  const pick = near.find(c => RES.test(c.t.building) && c.lv >= 2) || near.find(c => c.t.building === 'yes' && c.lv >= 5 && !c.t.amenity && !c.t.office && !c.t.shop && !c.t.tourism) || null;
  if (!pick) return { n: null, why: near.some(c => NOT_RES.test(c.t.building)) ? 'Здание нежилое (по OpenStreetMap)' : 'В OpenStreetMap у дома не указаны тип и этажность' };
  const entrances = pick.e.type === 'way' ? (pick.e.nodes || []).filter(id => entIds.has(id)).length : 0;
  // подъезды отмечены — этажи × подъезды × 4; иначе по площади дома: этажи × площадь / 62 м² на квартиру (с общими помещениями)
  const byArea = pick.area > 60 && pick.area < 30000 ? Math.round(pick.lv * pick.area / 62) : 0;
  const n = entrances ? Math.round(pick.lv * entrances * 4) : byArea;
  if (!n) return { n: null, why: 'Не удалось оценить: нет площади дома' };
  return { n, exact: false, levels: pick.lv, entrances, unsure: pick.t.building === 'yes',
    how: (entrances ? `${pick.lv} эт. × ${entrances} подъезд(а) × 4` : `${pick.lv} эт. × ${Math.round(pick.area)} м² / 62 м² на квартиру`) + (pick.t.building === 'yes' ? '; тип дома не указан — возможно, нежилой' : '') };
}
const V = 3;   // версия способа подсчёта: старые записи пересчитываются
// address задан — при неточном числе пробуем МинЖКХ (медленно: открывается страница сайта); без адреса — только OpenStreetMap
async function lookup(lat, lon, address) {
  const k = key(lat, lon), c = load();
  const old = c[k], fresh = old && Date.now() - old.t < 90 * 864e5 && (old.exact || old.v === V);
  if (fresh && (old.exact || !address || (old.mk && Date.now() - old.mk < 864e5))) return old;
  const run = async () => {
    let res = fresh ? old : null, osmFail = false;
    if (!res) {
      const j = await overpass(`[out:json][timeout:20];wr(around:40,${lat},${lon})["building"]->.b;.b out body geom;node(w.b)["entrance"];out ids;`);
      if (j) res = estimate(j.elements || [], lat, lon); else { osmFail = true; res = { n: null }; }
    }
    let mk = old && old.mk;
    if (!res.exact && address) { mk = Date.now(); try { const m = await mingkh(address); if (m) res = m; } catch {} }
    // OpenStreetMap не ответил и запасной источник ничего не дал — не запоминаем «нет данных», повторим позже
    if (osmFail && res.n == null) return { k, n: null, err: 'OpenStreetMap не ответил — повторю позже' };
    c[k] = Object.assign({ t: fresh ? old.t : Date.now(), tried: true, v: V, src: res.src || (res.n != null ? 'OpenStreetMap' : '') }, res, mk ? { mk } : {}); save(); return c[k];
  };
  const p = queue.then(run, run); queue = p.then(() => new Promise(r => setTimeout(r, 1100)), () => {}); return p;
}
module.exports = { lookup, estimate, cached: (lat, lon) => { const x = load()[key(lat, lon)]; return x && (x.exact || x.v === V) ? x : null; } };
