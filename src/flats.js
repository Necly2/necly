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
async function overpass(q, ms = 15000) {
  for (let i = 0; i < MIRRORS.length; i++) {
    const k = (good + i) % MIRRORS.length, ctl = new AbortController(), t = setTimeout(() => ctl.abort(), ms);
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
const ROBOT = /не робот/i;
// МинЖКХ иногда просит подтвердить, что вы не робот (простой пример). Программа её НЕ решает сама:
// ответ { captcha: true } — интерфейс показывает кнопку, и вы проходите проверку в окне сайта (verifyMingkh)
const mkState = { captcha: false, at: 0 };
const mkFull = address => {
  const q = String(address || '').replace(/^\s*(г\.?\s*)?москва[, ]*/i, '').trim();
  if (!q) return '';
  return /област|обл\.|г\.о\.|гор\. ?округ/i.test(q) ? q : 'Москва, ' + q;   // адреса Подмосковья — без «Москва,»
};
async function mingkh(address) {
  const full = mkFull(address); if (!full) return null;
  // ответы МинЖКХ по адресу запоминаются на 180 дней (число квартир в доме не меняется)
  const c = load(), ck = 'mk:' + full.toLowerCase();
  if (c[ck] && Date.now() - c[ck].t < 180 * 864e5) return c[ck].n ? { n: c[ck].n, exact: true, src: 'МинЖКХ', url: c[ck].url } : null;
  if (mkState.captcha) return { captcha: true };
  const { BrowserWindow } = require('electron');
  if (!mkWin || mkWin.isDestroyed()) mkWin = new BrowserWindow({ show: false, width: 1200, height: 900, webPreferences: { partition: 'persist:maps', backgroundThrottling: false } });
  const wc = mkWin.webContents, sleep = ms => new Promise(r => setTimeout(r, ms));
  const remember = (n, url) => { c[ck] = { t: Date.now(), n: n || 0, url: url || '' }; save(); };
  await wc.loadURL('https://dom.mingkh.ru/search?searchtype=house&address=' + encodeURIComponent(full)).catch(() => {});
  let link = null;
  for (let i = 0; i < 12 && link === null; i++) {
    await sleep(1500);
    if (ROBOT.test(wc.getTitle())) { mkState.captcha = true; mkState.at = Date.now(); mkState.url = wc.getURL(); return { captcha: true }; }
    link = await wc.executeJavaScript(`(() => { const a = [...document.querySelectorAll('a[href]')].find(a => /\/[a-z-]+\/[a-z-]+\/\d+\/?$/.test(a.getAttribute('href')) && /\d/.test(a.textContent)); return a ? a.href : (document.body && /ничего не найдено|не найден/i.test(document.body.innerText) ? '' : null); })()`).catch(() => null);
  }
  if (link === '') { remember(0); return null; }   // такого дома в МинЖКХ нет
  if (!link) return null;
  await wc.loadURL(link).catch(() => {});
  for (let i = 0; i < 10; i++) {
    await sleep(1200);
    if (ROBOT.test(wc.getTitle())) { mkState.captcha = true; mkState.at = Date.now(); mkState.url = wc.getURL(); return { captcha: true }; }
    const n = await wc.executeJavaScript(`(() => { const t = document.body ? document.body.innerText : '';
      const m = t.match(/(Количество квартир|Жилых помещений|Количество жилых помещений)[^\d\n]{0,20}(\d[\d\s]*)/i); return m ? +m[2].replace(/\s/g, '') : 0; })()`).catch(() => null);
    if (n !== null) { remember(n, link); return n > 0 ? { n, exact: true, src: 'МинЖКХ', url: link } : null; }
  }
  return null;
}
// окно МинЖКХ для проверки «не робот» — проходит человек; закрывается само, когда сайт пропустил (или по крестику)
let vWin = null;
function verifyMingkh(parent) {
  const { BrowserWindow } = require('electron');
  if (vWin && !vWin.isDestroyed()) { vWin.focus(); return vWin.__done; }
  vWin = new BrowserWindow({ width: 760, height: 560, parent: parent || undefined, title: 'МинЖКХ — подтвердите, что вы не робот', autoHideMenuBar: true, webPreferences: { partition: 'persist:maps' } });
  vWin.loadURL(mkState.url || 'https://dom.mingkh.ru/search?searchtype=house&address=' + encodeURIComponent('Москва, Тверская улица, 7')).catch(() => {});
  vWin.__done = new Promise(res => {
    const t = setInterval(() => {
      if (!vWin || vWin.isDestroyed()) { clearInterval(t); res(!mkState.captcha); return; }
      const title = vWin.webContents.getTitle();
      if (title && !ROBOT.test(title) && !/^about:|^$/.test(title) && !vWin.webContents.isLoading()) { mkState.captcha = false; clearInterval(t); setTimeout(() => { try { vWin.close(); } catch {} }, 600); res(true); }
    }, 700);
    vWin.on('closed', () => { vWin = null; });
  });
  return vWin.__done;
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
const M2_PER_FLAT = 62;   // площадь этажа на одну квартиру (с лестницами и общими помещениями)
const HOUSE = /^(house|detached|semidetached_house|terrace|bungalow)$/;
// квартир в одном здании: точно (building:flats) или оценка (этажи × площадь / 62 м²); не жилое или без данных — null
// c = { t (теги), lv (этажи), area (м²) }; entrances — отмеченные подъезды (если известны)
function flatsOf(c, entrances = 0) {
  const t = c.t;
  if (+t['building:flats'] > 0) return { n: +t['building:flats'], exact: true };
  if (HOUSE.test(t.building)) return { n: 1, exact: false, house: true };
  const res = RES.test(t.building) && c.lv >= 2, yes = t.building === 'yes' && c.lv >= 5 && !t.amenity && !t.office && !t.shop && !t.tourism;
  if (!res && !yes) return null;
  const byArea = c.area > 60 && c.area < 30000 ? Math.round(c.lv * c.area / M2_PER_FLAT) : 0;
  const n = entrances ? Math.round(c.lv * entrances * 4) : byArea;
  return n ? { n, exact: false, unsure: yes } : null;
}
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
  const f = flatsOf(pick, entrances), n = f ? f.n : 0;
  if (!n) return { n: null, why: 'Не удалось оценить: нет площади дома' };
  return { n, exact: false, levels: pick.lv, entrances, unsure: pick.t.building === 'yes',
    how: (entrances ? `${pick.lv} эт. × ${entrances} подъезд(а) × 4` : `${pick.lv} эт. × ${Math.round(pick.area)} м² / 62 м² на квартиру`) + (pick.t.building === 'yes' ? '; тип дома не указан — возможно, нежилой' : '') };
}
// ---------- квартир вокруг помещения (поток клиентов пункта) ----------
const AROUND_R = 400;   // м — около 5 минут пешком
// elements — здания с геометрией в радиусе; считаются дома, центр которых ближе r
// → { n, exact (квартир в домах с точным числом), est, houses, buildings, unknown (жилые без этажности), r }
function around(elements, lat, lon, r = AROUND_R) {
  const o = { n: 0, exact: 0, est: 0, houses: 0, buildings: 0, unknown: 0, r, cands: [] };
  // адрес дома из OpenStreetMap — для запроса в МинЖКХ (без номера дома не спрашиваем)
  const addrOf = t => { const st = t['addr:street'], hn = t['addr:housenumber']; if (!st || !hn) return ''; const city = t['addr:city'] || '';
    return (city && !/москва/i.test(city) ? 'Московская обл., ' + city + ', ' : '') + st + ', ' + hn; };
  for (const e of elements) {
    if (e.type === 'node' || !e.tags || !e.tags.building) continue;
    const rings = ringsOf(e); if (!rings.length) continue;
    const pts = rings[0], cLat = pts.reduce((a, p) => a + p[0], 0) / pts.length, cLon = pts.reduce((a, p) => a + p[1], 0) / pts.length;
    if (dist(lat, lon, cLat, cLon) > r) continue;
    const c = { t: e.tags, lv: parseFloat(e.tags['building:levels']) || 0, area: rings.reduce((a, g) => a + ringArea(g, lat), 0) };
    const f = flatsOf(c), a = addrOf(e.tags);
    if (!f) { if (RES.test(e.tags.building)) { o.unknown++; if (a) o.cands.push({ a, est: 0 }); } continue; }
    o.n += f.n; o.buildings++;
    if (f.house) o.houses++; else if (f.exact) o.exact += f.n; else { o.est += f.n; if (a) o.cands.push({ a, est: f.n }); }
  }
  return o;
}
async function lookupAround(lat, lon) {
  const k = 'r' + AROUND_R + ':' + key(lat, lon), c = load();
  if (c[k] && Date.now() - c[k].t < 90 * 864e5) return c[k];
  const run = async () => {
    const j = await overpass(`[out:json][timeout:40];wr(around:${AROUND_R + 60},${lat},${lon})["building"];out tags geom;`, 45000);
    if (!j) return { n: null, err: 'OpenStreetMap не ответил — повторю позже' };
    c[k] = Object.assign({ t: Date.now() }, around(j.elements || [], lat, lon)); save(); return c[k];
  };
  // своя очередь: выбранное объявление не ждёт фоновый подсчёт квартир по всему списку (Overpass допускает 2 запроса одновременно)
  const p = aqueue.then(run, run); aqueue = p.then(() => new Promise(r => setTimeout(r, 1500)), () => {}); return p;
}
let aqueue = Promise.resolve();
// уточнение «вокруг» по МинЖКХ: дома с оценкой или без этажности — по адресу; самые крупные первыми, не больше 30 за раз.
// onProgress(результат) — после каждого дома; капча — остановка (result.captcha), продолжится после проверки
const refining = new Set();
async function refineAround(lat, lon, onProgress) {
  const k = 'r' + AROUND_R + ':' + key(lat, lon), c = load(), o = c[k];
  if (!o || !o.cands || refining.has(k)) return o;
  refining.add(k);
  try {
    o.mk = o.mk || {};   // адрес → квартир по МинЖКХ (0 — не нашлось)
    const todo = o.cands.filter(x => !(x.a in o.mk)).sort((a, b) => (b.est || 1e9) - (a.est || 1e9)).slice(0, 30);
    o.mkTotal = o.cands.length; delete o.captcha;
    for (const x of todo) {
      const m = await mingkh(x.a).catch(() => null);
      if (m && m.captcha) { o.captcha = true; break; }
      o.mk[x.a] = m && m.n ? m.n : 0;
      if (m && m.n) { o.exact += m.n; o.mkExact = (o.mkExact || 0) + 1; if (x.est) o.est -= x.est; else { o.unknown--; o.buildings++; } o.n = o.exact + o.est + o.houses; }
      o.mkDone = Object.keys(o.mk).length; save();
      onProgress && onProgress(o);
      await new Promise(r => setTimeout(r, 1500));
    }
    o.mkDone = Object.keys(o.mk).length; save(); onProgress && onProgress(o);
    return o;
  } finally { refining.delete(k); }
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
    if (!res.exact && address) {
      try {
        const m = await mingkh(address);
        if (m && m.captcha) res = Object.assign({}, res, { captcha: true });   // нужна проверка «не робот» — повторим после неё
        else { mk = Date.now(); if (m && m.n) res = m; }
      } catch {}
    }
    // OpenStreetMap не ответил и запасной источник ничего не дал — не запоминаем «нет данных», повторим позже
    if (osmFail && res.n == null) return { k, n: null, err: 'OpenStreetMap не ответил — повторю позже' };
    const { captcha, ...keep } = res;
    c[k] = Object.assign({ t: fresh ? old.t : Date.now(), tried: true, v: V, src: keep.src || (keep.n != null ? 'OpenStreetMap' : '') }, keep, mk ? { mk } : {}); save();
    return captcha ? Object.assign({}, c[k], { captcha: true }) : c[k];
  };
  const p = queue.then(run, run); queue = p.then(() => new Promise(r => setTimeout(r, 1100)), () => {}); return p;
}
module.exports = { lookup, estimate, around, lookupAround, refineAround, verifyMingkh, mkState, mingkh, AROUND_R, aroundCached: (lat, lon) => load()['r' + AROUND_R + ':' + key(lat, lon)] || null, cached: (lat, lon) => { const x = load()[key(lat, lon)]; return x && (x.exact || x.v === V) ? x : null; } };
