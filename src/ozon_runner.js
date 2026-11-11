// ===== PVZ: проверка адресов на карте ПВЗ Ozon во встроенном браузере =====
// Вставить ЦЕЛИКОМ одним вызовом javascript_tool на вкладке https://pvz-map.ozon.ru/ (вход в аккаунт не нужен).
// Логика классификации — 1:1 из export_excel__2__ozon_script.js (с зелёной зоной). Отличия: очередь + N потоков,
// результаты в window.__out и в localStorage (переживают перезагрузку вкладки).
//
// API после вставки:
//   __addS("адрес\tшир,долг\nадрес\tшир,долг...")  — добавить порцию адресов (≈130 строк за вызов)
//   __start(потоки=3)                              — запустить (повторный вызов безопасен)
//   __prog()                                       — {queue, done, busy, errors, failed}
//   __failed() / __retry()                         — адреса без ответа сайта (TSV) / вернуть их в очередь
//   __stop() / __resume(потоки) / __delay(мс)      — остановить / продолжить (неудачные — в начало очереди) / пауза между запросами
//   После 3 неудач подряд (Ozon отвечает 404 = ограничение частоты) очередь САМА останавливается: подождать 20–40 мин,
//   проверить один запрос (статус 200) и __resume(1) с __delay(2500) — медленнее.
//   __res()                                        — ВСЕ результаты строками "шир,долг\tзона\tсверка" (для pvz_tool.py apply)
//   __counts()                                     — сколько каких зон
//   __reset()                                      — очистить сохранённые результаты (новая партия)
//   __pad(s)                                       — дополнить строку '#' до 105000 символов (чтобы результат инструмента ушёл в файл)
(() => {
if (window.__ozonRunnerLoaded) { console.log("ozon_runner уже загружен"); return; }
window.__ozonRunnerLoaded = true;
let DELAY_MS = 1000;   // меняется через __delay(мс)
const TIMEOUT_MS = 25000;              // сколько ждать ответ сайта
const MAX_DIST_M = 1000;               // поиск по адресу — не дальше 1 км от координат
const BLUE = 3000000, DARK = 5000000;
const API = "/p-api/orp-agent-api/task/creation-availability?layer=PvzGroup&withNearestPoints=true";
const SUGGEST = "https://geoproxy.ozon.ru/Suggest?clientName=orp-map-api&count=10&lang=ru"
  + "&contextLocationUID=42fb1c32-0cfe-5c96-9fb5-7f8e8449f28c&removeDisallowedCountries=true"
  + "&preferredProviders=maps_general_misspell_v6&preferredProviders=maps_general_misspell"
  + "&preferredProviders=maps_registry&preferredProviders=maps_suggester_faiss"
  + "&preferredProviders=maps_fallback_blocker&preferredProviders=yandex";
// ---------- зелёные зоны («вечная» поддержка в ЖК, с 05.10.2026) ----------
// Контуры зон карта берёт из векторных тайлов /p-api/orp-agent-api/map/render-vtile (слой RecommendedZone);
// зелёная зона — полигоны с group = "InfiniteSupportZhk". API creation-availability про неё ничего не говорит
// по точке клика (tariffs пустой), но по точке дома даёт флаг flags[infiniteSupportZhk].show = true и сумму
// поддержки (без проверки зелёного такие дома попадали бы в «синий»). Поэтому проверяем оба признака: флаг и контур.
const ZONE_TILE = "/p-api/orp-agent-api/map/render-vtile";
const GREEN_GROUP = "InfiniteSupportZhk";
const ZONE_Z = 14;            // максимальный zoom тайлов зон
const GREEN_NEAR_M = 20;      // до 20 м от зелёного контура — тоже «зелёный», но с пометкой «проверить вручную»
const MVT = (() => {
  const td = new TextDecoder();
  function Rd(b) { this.b = b; this.p = 0; }
  Rd.prototype.v = function () { let r = 0, s = 0, b; do { b = this.b[this.p++]; r += (b & 0x7f) * 2 ** s; s += 7; } while (b & 0x80); return r; };
  Rd.prototype.bytes = function () { const l = this.v(); const x = this.b.subarray(this.p, this.p + l); this.p += l; return x; };
  Rd.prototype.skip = function (t) { if (t === 0) this.v(); else if (t === 2) this.p += this.v(); else if (t === 5) this.p += 4; else if (t === 1) this.p += 8; };
  const packed = r => { const x = r.bytes(), q = new Rd(x), o = []; while (q.p < x.length) o.push(q.v()); return o; };
  function val(b) { const r = new Rd(b); let v = null; while (r.p < b.length) { const k = r.v(), f = k >> 3, t = k & 7;
    if (f === 1) v = td.decode(r.bytes()); else if (f >= 4 && f <= 6) v = r.v(); else if (f === 7) v = !!r.v(); else r.skip(t); } return v; }
  function layer(b) { const r = new Rd(b), L = {name: "", extent: 4096, keys: [], vals: [], raw: []};
    while (r.p < b.length) { const k = r.v(), f = k >> 3, t = k & 7;
      if (f === 1) L.name = td.decode(r.bytes()); else if (f === 2) L.raw.push(r.bytes()); else if (f === 3) L.keys.push(td.decode(r.bytes()));
      else if (f === 4) L.vals.push(val(r.bytes())); else if (f === 5) L.extent = r.v(); else r.skip(t); }
    L.features = L.raw.map(fb => { const r = new Rd(fb); let tags = [], type = 0, g = [];
      while (r.p < fb.length) { const k = r.v(), f = k >> 3, t = k & 7; if (f === 2) tags = packed(r); else if (f === 3) type = r.v(); else if (f === 4) g = packed(r); else r.skip(t); }
      const props = {}; for (let i = 0; i < tags.length; i += 2) props[L.keys[tags[i]]] = L.vals[tags[i + 1]];
      const rings = []; let x = 0, y = 0, ring = null, i = 0;
      while (i < g.length) { const c = g[i++], cmd = c & 7, n = c >> 3; if (cmd === 7) { if (ring) ring.push(ring[0]); continue; }
        for (let j = 0; j < n; j++) { const dx = g[i++], dy = g[i++]; x += (dx >>> 1) ^ -(dx & 1); y += (dy >>> 1) ^ -(dy & 1);
          if (cmd === 1) { ring = [[x, y]]; rings.push(ring); } else ring.push([x, y]); } }
      return {props, type, rings}; });
    delete L.raw; return L; }
  function decode(ab) { const b = new Uint8Array(ab), r = new Rd(b), out = {}; while (r.p < b.length) { const k = r.v(), f = k >> 3, t = k & 7;
    if (f === 3) { const L = layer(r.bytes()); out[L.name] = L; } else r.skip(t); } return out; }
  return {decode};
})();
const zoneTiles = new Map();
function zoneTile(x, y) {
  const key = x + "/" + y; if (zoneTiles.has(key)) return zoneTiles.get(key);
  const pr = (async () => { for (let a = 1; a <= 3; a++) { try {
      const r = await fetch(`${ZONE_TILE}?x=${x}&y=${y}&z=${ZONE_Z}&layerName=RecommendedZone&tt=${Date.now()}`, {credentials: "include"});
      if (r.status === 204 || r.status === 404) return {};
      if (r.ok) return MVT.decode(await r.arrayBuffer());
    } catch (e) {} await sleep(1500 * a); } zoneTiles.delete(key); return null; })();
  zoneTiles.set(key, pr); return pr;
}
// {inside: true/false, distM: расстояние до ближайшей зелёной зоны (0 — внутри)} или null при ошибке загрузки тайла
async function greenAt(lat, lon) {
  const n = 2 ** ZONE_Z, fx = (lon + 180) / 360 * n, s = Math.sin(lat * Math.PI / 180);
  const fy = (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n, tx = Math.floor(fx), ty = Math.floor(fy);
  const mTile = 40075016.686 * Math.cos(lat * Math.PI / 180) / n; let best = Infinity, inside = false;
  for (const dx of [-1, 0, 1]) for (const dy of [-1, 0, 1]) {
    const t = await zoneTile(tx + dx, ty + dy); if (t === null) return null; const L = t.RecommendedZone; if (!L) continue;
    const px = (fx - (tx + dx)) * L.extent, py = (fy - (ty + dy)) * L.extent, m = mTile / L.extent;
    for (const F of L.features) { if (F.type !== 3 || F.props.group !== GREEN_GROUP) continue; let ins = false;
      for (const ring of F.rings) for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i], [xj, yj] = ring[j];
        if ((yi > py) !== (yj > py) && px < (xj - xi) * (py - yi) / (yj - yi) + xi) ins = !ins;
        const vx = xj - xi, vy = yj - yi, l2 = vx * vx + vy * vy; let u = l2 ? ((px - xi) * vx + (py - yi) * vy) / l2 : 0; u = Math.max(0, Math.min(1, u));
        best = Math.min(best, Math.hypot(px - (xi + u * vx), py - (yi + u * vy)) * m); }
      if (ins) inside = true; }
  }
  return {inside, distM: inside ? 0 : (isFinite(best) ? Math.round(best) : null)};
}
// зелёная зона: точка дома Ozon ИЛИ координаты объявления внутри зелёного полигона
async function greenInfo(final, lat, lon) {
  const pt = final && final.geocode && final.geocode.point;
  const a = pt ? await greenAt(pt.lat, pt.lon) : null, b = await greenAt(lat, lon);
  if (!a && !b) return null;
  const ds = [a, b].filter(Boolean).map(x => x.distM).filter(x => x !== null);
  return {inside: !!((a && a.inside) || (b && b.inside)), distM: ds.length ? Math.min(...ds) : null};
}

// ---------- сравнение адресов (та же логика, что в ноутбуке) ----------
const STREET_TYPES = {"ул":"улица","улица":"улица","просп":"проспект","пр-т":"проспект","проспект":"проспект",
  "пер":"переулок","переулок":"переулок","пр-д":"проезд","проезд":"проезд","ш":"шоссе","шоссе":"шоссе",
  "бул":"бульвар","б-р":"бульвар","бульвар":"бульвар","наб":"набережная","набережная":"набережная",
  "пл":"площадь","площадь":"площадь","туп":"тупик","тупик":"тупик","ал":"аллея","аллея":"аллея",
  "мкр":"микрорайон","микрорайон":"микрорайон","кв-л":"квартал","квартал":"квартал"};
const TYPE_WORDS = new Set(Object.values(STREET_TYPES));
const NOISE = new Set(["г","город","пос","поселок","поселение","д","деревня","с","село","кп","р-н","район","москва","жк"]);
const clean = s => String(s ?? "").toLowerCase().replace(/ё/g, "е").replace(/\(.*?\)/g, " ").replace(/["«»]/g, " ");
function streetWords(street) {
  const out = new Set();
  for (let w of clean(street).match(/[a-zа-я0-9\-№]+/g) || []) {
    w = w.replace(/^-+|-+$/g, "");
    if (!w || NOISE.has(w)) continue;
    w = STREET_TYPES[w] || w;
    const m = w.match(/^(\d+)-?(я|й|е|ая|ый|ий|ой)?$/);
    out.add(m ? m[1] : w);
  }
  for (const t of TYPE_WORDS) out.delete(t);
  return out;
}
function houseKey(h) {
  let s = clean(h).replace(/корпус/g, "к").replace(/строение/g, "с").replace(/владение/g, "вл");
  s = s.replace(/[^0-9a-zа-я/]/g, "");
  return s.replace(/(\d)к([а-я])$/, "$1$2");
}
function splitAddr(a) {
  const p = String(a ?? "").split(",").map(x => x.trim()).filter(Boolean);
  if (p.length >= 2 && /^\d/.test(p[p.length - 1])) return [p[p.length - 2], p[p.length - 1]];
  return [p.length ? p[p.length - 1] : "", ""];
}
function addrMatch(addr, geo) {
  if (!geo || !geo.isHouse) return false;
  const [st, h] = splitAddr(addr);
  if (!h || houseKey(h) !== houseKey(geo.house)) return false;
  const a = streetWords(st), b = streetWords(geo.street);
  return a.size > 0 && [...a].every(x => b.has(x));
}
function maxSupport(r) {
  let g = 0;
  for (const f of Object.values((r && r.tariffs) || {})) for (const o of f.flexSupport || []) g = Math.max(g, o.totalSupport || 0);
  return g;
}
// зелёная зона: флаг API infiniteSupportZhk (приходит по точке дома) ИЛИ точка внутри / ближе GREEN_NEAR_M к зелёному контуру карты
const zhkFlag = r => !!(r && (r.zhk || (r.flags || []).some(f => f.type === "infiniteSupportZhk" && f.show)));
const isGreen = (r, green) => zhkFlag(r) || !!(green && (green.inside || (green.distM !== null && green.distM <= GREEN_NEAR_M)));
function classify(r, green) {
  if (!r || !r.geocode) return "ошибка запроса";
  if (r.allowed === false || r.problem === "PvzAlreadyExists") return "открытие пвз недоступно";
  if (r.problem === "AtProtectedZone") return "пока нельзя (охранная зона)";
  if (isGreen(r, green)) return "зелёный";
  let g = 0;
  for (const f of Object.values(r.tariffs || {})) for (const o of f.flexSupport || []) g = Math.max(g, o.totalSupport || 0);
  return g >= DARK ? "синий" : g >= BLUE ? "голубой" : g > 0 ? "гарантия < 3 млн" : "вне зоны";
}

function checkNote(addr, rec) {
  const base = addrNote(addr, rec), r = rec && rec.final, gr = rec && rec.green, extra = [];
  const zone = rec ? classify(r, gr) : "";
  if (rec && rec.green === null && zone !== "ошибка запроса") extra.push("проверить вручную: не загрузился слой зелёных зон");
  if (zone === "зелёный" && maxSupport(r) > 0) extra.push(`в зелёной зоне; поддержка по API ${(maxSupport(r) / 1e6).toFixed(2)} млн ₽`);
  if (zone === "зелёный" && !zhkFlag(r) && gr && !gr.inside) extra.push(`проверить вручную: точка в ${gr.distM} м от зелёной зоны`);
  if (zone === "зелёный" && !zhkFlag(r) && gr && gr.inside) extra.push("проверить вручную: внутри зелёного контура, но Ozon не дал флаг зелёной зоны");
  return [base, ...extra].filter(Boolean).join("; ");
}
function addrNote(addr, rec) {
  const r = rec && rec.final, geo = r && r.geocode;
  if (!r || rec.found_by === "адрес" || addrMatch(addr, geo)) return "";
  if (!splitAddr(addr)[1]) return "проверить вручную: в таблице нет номера дома" + (geo && geo.isHouse && geo.fullText ? ` (Ozon: ${geo.fullText})` : "");
  if (!geo || !geo.isHouse) return "проверить вручную: Ozon не нашёл дом ни по координатам, ни по адресу";
  return "проверить вручную: " + (geo.fullText || "");
}

// ---------- запросы ----------
const sleep = ms => new Promise(r => setTimeout(r, ms));
const distM = (la1, lo1, la2, lo2) => 111000 * Math.hypot(la1 - la2, (lo1 - lo2) * Math.cos(la1 * Math.PI / 180));
async function get(url) {
  for (let a = 1; a <= 3; a++) {
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const r = await fetch(url, {signal: ctrl.signal, credentials: "include", headers: {Accept: "application/json"}});
      if (r.ok) return await r.json();
      console.warn(`   ⚠ сайт ответил HTTP ${r.status} (попытка ${a}/3)`);
    } catch (e) { console.warn(`   ⚠ нет ответа: ${e.name} (попытка ${a}/3)`); }
    finally { clearTimeout(t); }
    if (a < 3) await sleep(5000 * a);
  }
  return null;
}
const query = (lat, lon) => get(`${API}&location.lat=${lat}&location.lon=${lon}`);
async function findByAddress(addr, lat, lon) {
  const bbox = `&bbox.leftLowerCorner.lat=${lat - 0.01}&bbox.leftLowerCorner.lon=${lon - 0.02}`
             + `&bbox.rightUpperCorner.lat=${lat + 0.01}&bbox.rightUpperCorner.lon=${lon + 0.02}`;
  const body = await get(SUGGEST + bbox + "&query=" + encodeURIComponent(regionPrefix(addr) + String(addr).replace(/\(.*?\)/g, "")));
  for (const s of (body && body.suggestions) || []) {
    const a = s.address || {}, c = a.components || {}, pt = (a.geometry || {}).point;
    const cand = {isHouse: true, street: (c.street || {}).name || "", house: (c.house || {}).number || ""};
    if (pt && addrMatch(addr, cand) && distM(lat, lon, pt.lat, pt.lon) <= MAX_DIST_M) return [pt, a.formattedFullText || a.fullText];
  }
  return null;
}
const slim = r => r && ({allowed: r.allowed, problem: r.problem, tariffs: r.tariffs, zhk: zhkFlag(r), geocode: r.geocode && {
  isHouse: r.geocode.isHouse, street: r.geocode.street, house: r.geocode.house, fullText: r.geocode.fullText, point: r.geocode.point}});


// ---------- регион для поиска по адресу (Suggest) ----------
// Адреса Подмосковья: есть «гор. округ», «пгт», «обл.» или «<город> г.,» — кроме Зеленограда, Троицка, Щербинки, Московского.
function regionPrefix(addr) {
  const a = String(addr || "");
  if (/Зеленоград|Троицк|Щербинк|Московский/i.test(a)) return "Москва, ";
  if (/гор\. ?округ|пгт|обл\.|(^|,\s*)[А-ЯЁ][а-яё\-]+ г\.,/i.test(a)) return "Московская обл., ";
  return (window.__REGION_PREFIX || "Москва, ");
}

// ---------- очередь ----------
const LS = "pvz_ozon_runner_v1";
let OUT = {}; try { OUT = JSON.parse(localStorage.getItem(LS) || "{}"); } catch (e) {}
const Q = [], FAILED = []; let busy = 0, errors = 0, streak = 0;
const persist = () => { try { localStorage.setItem(LS, JSON.stringify(OUT)); } catch (e) {} };
window.__out = OUT;
window.__addS = (text) => {
  let n = 0;
  for (const line of String(text).split("\n")) {
    const [addr, c] = line.split("\t"); if (!addr || !c) continue;
    const key = c.replace(/\s/g, "");
    if (OUT[key] || Q.some(x => x[1] === key)) continue;
    Q.push([addr.trim(), key]); n++;
  }
  return {added: n, queue: Q.length};
};
async function one(addr, c) {
  const [lat, lon] = c.split(",").map(Number);
  const first = await query(lat, lon); await sleep(DELAY_MS);
  let final = first, foundBy = "координаты";
  if (first && first.geocode && first.geocode.point) { final = await query(first.geocode.point.lat, first.geocode.point.lon); await sleep(DELAY_MS); }
  if (final && !addrMatch(addr, final.geocode) && splitAddr(addr)[1]) {
    const hit = await findByAddress(addr, lat, lon); await sleep(DELAY_MS);
    if (hit) { const byAddr = await query(hit[0].lat, hit[0].lon); await sleep(DELAY_MS); if (byAddr) { final = byAddr; foundBy = "адрес"; } }
  }
  if (!final) return null;
  const green = await greenInfo(final, lat, lon);
  const rec = {final: slim(final), found_by: foundBy, green};
  return [classify(rec.final, green), checkNote(addr, rec)];
}
let STOP = false;
async function worker() {
  busy++;
  try {
    while (Q.length && !STOP) {
      const [addr, c] = Q.shift();
      let r = null;
      try { r = await one(addr, c); } catch (e) { r = null; }
      if (!r) {
        // нет ответа (часто — ограничение частоты запросов, сайт отвечает 404): не записываем, откладываем
        errors++; streak++; FAILED.push([addr, c]);
        if (streak >= 3) {   // Ozon ограничил запросы (404) — останавливаемся, чтобы не продлевать блокировку
          STOP = true; window.__blocked = new Date().toISOString();
          console.warn("Ozon отвечает 404 — проверка остановлена; __prog().blocked, продолжить позже: __resume()");
        }
        continue;
        continue;
      }
      streak = 0; OUT[c] = r; persist();
    }
  } finally { busy--; }
}
window.__retry = () => { const n = FAILED.length; while (FAILED.length) Q.push(FAILED.shift()); errors = 0; return {requeued: n}; };
window.__failed = () => FAILED.map(([a, c]) => a + "\t" + c).join("\n");
window.__stop = () => { STOP = true; return window.__prog(); };
window.__resume = (n = 1) => { STOP = false; streak = 0; window.__blocked = null; while (FAILED.length) Q.unshift(FAILED.pop()); return window.__start(n); };
window.__delay = (ms) => { DELAY_MS = ms; return ms; };
window.__start = (n = 3) => { for (let i = busy; i < n; i++) worker(); return window.__prog(); };
window.__prog = () => ({queue: Q.length, done: Object.keys(OUT).length, busy, errors, failed: FAILED.length, stopped: STOP, blocked: window.__blocked || null});
const GOOD = new Set(["зелёный", "синий", "голубой", "гарантия < 3 млн", "ошибка запроса"]);  // остальные зоны отсеиваются
window.__res = (onlyGood = false) => Object.entries(OUT).filter(([, v]) => !onlyGood || GOOD.has(v[0]))
  .map(([c, v]) => c + "\t" + v[0] + "\t" + (v[1] || "")).join("\n");
window.__counts = () => Object.values(OUT).reduce((m, v) => (m[v[0]] = (m[v[0]] || 0) + 1, m), {});
window.__reset = () => { for (const k of Object.keys(OUT)) delete OUT[k]; Q.length = 0; errors = 0; persist(); return "ok"; };
window.__pad = (s) => s + "\n" + "#".repeat(Math.max(0, 105000 - s.length));
// для отладки
window.__ozon = {query, classify, addrMatch, greenAt, regionPrefix};
console.log("ozon_runner загружен; сохранено результатов:", Object.keys(OUT).length);
})();
