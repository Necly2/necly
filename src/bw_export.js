// ===== PVZ: выгрузка объявлений из Baza Winner (w7.baza-winner.ru) без окна сохранения Windows =====
// Вставить ЦЕЛИКОМ одним вызовом javascript_tool на вкладке w7.baza-winner.ru (пользователь уже вошёл).
// Все элементы сайта — в shadow DOM, поэтому обычный find/read_page их не видит: работаем через JS.
//
// API (все функции async, возвращают JSON-совместимые объекты):
//   await __bw.open(guid)            — после navigate на /search/<guid>/params: открыть «Список»; {ok, login_required}
//   await __bw.info(guid)            — {guid, userId, total, selected, hidden, sp}  (total = сколько НЕскрытых объявлений осталось)
//   await __bw.mark(guid, 300)       — отметить красным следующие ≤300 объявлений → {ids, marked}
//   await __bw.wizardOpen()          — открыть «Мастер экспорта/Печати» (значок принтера)
//   __bw.wizardCheck()               — проверить настройки мастера → {ok, problems[], rows, busy}
//   await __bw.wizardFix()           — исправить настройки (Вид «Краткий», галочки, «Примечание» = убрать)
//   await __bw.exportXlsx()          — «Экспорт в Excel», перехват файла → {bytes}
//   await __bw.b64()                 — последний файл в base64, дополнен '#' до >105000 символов (результат уйдёт в файл)
//   await __bw.hide(guid, ids)       — ТОЛЬКО после проверки файла: ids → «в скрытые», снять «отмеченные»
//   __bw.wizardClose()               — закрыть мастер (крестик)
// Режим без скрытия (заказ с hide:false): planAll(guid) → nextSlice() → [wizardFix()] → stepSlices(3) … до done → dumpSlices(0,11)…
//   unhideAll(guid) — вернуть все скрытые заказа в ленту (только по просьбе пользователя)
(() => {
const W = window;
const sleep = ms => new Promise(r => setTimeout(r, ms));
function walk(root, out = []) { for (const e of root.querySelectorAll("*")) { if (e.shadowRoot) walk(e.shadowRoot, out); out.push(e); } return out; }
const all = () => walk(document);
const vis = e => e && e.offsetParent !== null;
const byTag = (tag) => all().filter(e => e.tagName === tag);
const visTag = (tag) => byTag(tag).find(vis);

// ---- перехват файла экспорта: Blob сохраняется в window.__blobs, клик по blob:-ссылке блокируется (окна «Сохранить как» нет)
if (!W.__bwHooked) {
  W.__bwHooked = true; W.__blobs = [];
  const orig = URL.createObjectURL.bind(URL);
  URL.createObjectURL = (b) => { try { if (b instanceof Blob) W.__blobs.push(b); } catch (e) {} return orig(b); };
  const oc = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () { if (String(this.href).startsWith("blob:")) return; return oc.call(this); };
  const od = EventTarget.prototype.dispatchEvent;
  EventTarget.prototype.dispatchEvent = function (ev) {
    if (this instanceof HTMLAnchorElement && ev && ev.type === "click" && String(this.href).startsWith("blob:")) return true;
    return od.call(this, ev);
  };
}

function ctx() {
  const g = visTag("BW-WIDE-SEARCH-FORM-GRID-PAGE");
  if (!g) throw new Error("Не открыт список заказа (вкладка «Список»). Вызовите __bw.open(guid).");
  const api = g.__data.itemStore.api, gate = api.mlsGate.api;
  const sp = {...g.__data.searchParams}; delete sp.selected_offers;
  const sess = (visTag("BW-SESSION") || byTag("BW-SESSION")[0]);
  let userId = W.__bwUserId;
  try { userId = userId || sess.__data._sessionData.userId; } catch (e) {}
  return {g, api, gate, sp, userId};
}
async function total(guid, extra = {}) {
  const {api, sp} = ctx();
  const r = await api.getItemsBySearch(guid, {search: {...sp, ...extra}, fields: ["offerId"], size: 1}, {hideRestricted: true});
  return r.total;
}

const bw = {};
bw.open = async (guid) => {
  // Перед вызовом: navigate на https://w7.baza-winner.ru/search/<guid>/params, подождать ~6 с, вставить этот скрипт.
  // (прямой переход на /list при свежей загрузке даёт пустой список — поэтому через «Параметры заказа» → «Список»)
  if (all().some(e => vis(e) && e.children.length === 0 && /До окончания подписки/.test(e.textContent)))   // окно о подписке: «Отмена», НЕ продлевать
    for (const b of all().filter(e => vis(e) && e.tagName === "BW-BUTTON" && e.textContent.trim() === "Отмена")) b.click();
  if (!location.href.includes(guid)) return {ok: false, href: location.href, hint: "сначала navigate на /search/" + guid + "/params"};
  if (!visTag("BW-WIDE-SEARCH-FORM-GRID-PAGE")) {
    const lt = all().find(e => vis(e) && e.classList && e.classList.contains("tab") && e.textContent.trim() === "Список");
    if (lt) { lt.click(); await sleep(5000); }
  }
  const ok = !!visTag("BW-WIDE-SEARCH-FORM-GRID-PAGE");
  const login = all().some(e => vis(e) && e.children.length === 0 && /бесплатном режиме|Вход в WinNER7/.test(e.textContent));
  return {ok, href: location.href, login_required: login};
};
bw.info = async (guid) => {
  const {sp, userId} = ctx();
  return {guid, userId, total: await total(guid), selected: await total(guid, {is_selected: true}),
          hidden: await total(guid, {is_hidden: true}), sp};
};
bw.mark = async (guid, size = 300) => {
  const {g, api, gate, sp, userId} = ctx();
  if (!userId) throw new Error("userId не найден — задайте window.__bwUserId = <число из config>");
  const r = await api.getItemsBySearch(guid, {search: sp, fields: ["offerId"], size}, {hideRestricted: true});
  const ids = r.items.map(i => i.offerId);
  if (!ids.length) return {ids, marked: 0, total: r.total};
  await gate.setOffersMark({offerIds: ids, markType: "is_selected", markValue: true, userId, orderGuid: guid});
  g.set("markedRows.selected", ids);
  W.__bwIds = ids;
  await sleep(1500);
  return {ids, marked: await total(guid, {is_selected: true}), total: r.total};
};

// ---- мастер экспорта
const wiz = () => visTag("BW-EXPORT-WIZARD") || byTag("BW-EXPORT-WIZARD")[0];
bw.wizardOpen = async () => {
  const icon = all().filter(e => e.tagName === "IRON-ICON" && e.getAttribute("icon") === "print").find(vis);
  if (!icon) throw new Error("Значок принтера не найден (внизу слева в списке)");
  icon.parentElement.click();
  await sleep(10000);   // таблица мастера строится ~10 с
  return bw.wizardCheck();
};
function cbByLabel(w, re) {
  return walk(w.shadowRoot || w).filter(e => e.tagName === "BW-CHECKBOX").find(c => re.test((c.textContent || "") + " " + (c.getAttribute("label") || "")));
}
function selByLabel(w, re) {
  return walk(w.shadowRoot || w).filter(e => e.tagName === "BW-SELECT").find(s => s.previousElementSibling && re.test(s.previousElementSibling.textContent || ""));
}
const WANT_ON = [/Координаты/, /Ссылка на первоисточник/];
const WANT_OFF = [/Место для заметок/, /Телефоны/, /№ дома/, /Заголовок/];
bw.wizardCheck = () => {
  const w = wiz(); if (!w || !vis(w)) return {ok: false, problems: ["мастер не открыт"]};
  const p = [];
  for (const re of WANT_ON) { const c = cbByLabel(w, re); if (!c) p.push("нет галочки " + re.source); else if (!c.checked) p.push("включить: " + re.source); }
  for (const re of WANT_OFF) { const c = cbByLabel(w, re); if (c && c.checked) p.push("выключить: " + re.source); }
  const note = selByLabel(w, /^\s*Примечание/); if (note && String(note.value) !== "2") p.push("Примечание ≠ «убрать» (" + note.value + ")");
  const own = selByLabel(w, /Собственное примечание/); if (own && String(own.value) !== "0") p.push("Собственное примечание ≠ «не показывать»");
  const t = w.__data && w.__data.table; const cols = t && t[0] ? Object.keys(t[0]).length : null;
  return {ok: p.length === 0, problems: p, rows: t ? t.length : null, cols, busy: !!(w.__data && w.__data._busy)};
};
bw.wizardFix = async () => {
  const w = wiz(); const root = w.shadowRoot || w;
  // Вид: «Краткий» (code d:0)
  const lbl = walk(root).find(e => e.classList && e.classList.contains("label") && /Вид:/.test(e.textContent));
  if (lbl) {
    const link = lbl.querySelector("bw-link"); if (link) { link.click(); await sleep(1500); }
    // в документе два набора «видов» (для списка и для мастера) — берём только внутри мастера
    const it = walk(root).find(e => e.tagName === "BW-GRID-SETTINGS-LIST-ITEM" && e.__data && e.__data.data && e.__data.data.code === "d:0");
    if (it && !it.__data.selected) { const l = walk(it.shadowRoot || it).find(e => e.tagName === "BW-LINK") || it; l.click(); await sleep(2000); }
  }
  for (const re of WANT_ON) { const c = cbByLabel(w, re); if (c && !c.checked) { c.shadowRoot.querySelector("#checkbox").click(); await sleep(2500); } }
  for (const re of WANT_OFF) { const c = cbByLabel(w, re); if (c && c.checked) { c.shadowRoot.querySelector("#checkbox").click(); await sleep(2500); } }
  const note = selByLabel(w, /^\s*Примечание/); if (note && String(note.value) !== "2") { note.value = 2; await sleep(1500); }
  const own = selByLabel(w, /Собственное примечание/); if (own && String(own.value) !== "0") { own.value = 0; await sleep(1500); }
  // таблица мастера обновляется только после закрытия и повторного открытия
  bw.wizardClose(); await sleep(1500);
  return bw.wizardOpen();
};
bw.wizardClose = () => {
  const w = wiz(); if (!w) return false;
  const x = walk(w.shadowRoot || w).find(e => e.id === "closeButton" && vis(e)); if (x) { x.click(); return true; }
  return false;
};
bw.exportXlsx = async () => {
  const w = wiz(); const n0 = W.__blobs.length;
  const b = walk(w.shadowRoot || w).find(e => e.tagName === "BW-BUTTON" && /Экспорт в Excel/.test(e.textContent));
  if (!b) throw new Error("Кнопка «Экспорт в Excel» не найдена");
  b.click();
  for (let i = 0; i < 40 && W.__blobs.length === n0; i++) await sleep(500);
  if (W.__blobs.length === n0) throw new Error("Файл не сформировался за 20 с");
  return {bytes: W.__blobs[W.__blobs.length - 1].size};
};
bw.b64 = async () => {
  const blob = W.__blobs[W.__blobs.length - 1];
  const buf = new Uint8Array(await blob.arrayBuffer());
  let s = ""; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
  const b = btoa(s);
  return "B64START" + b + "B64END" + "#".repeat(Math.max(0, 105000 - b.length));
};
bw.hide = async (guid, ids) => {
  const {g, gate, userId} = ctx();
  ids = ids || W.__bwIds || [];
  await gate.setOffersMark({offerIds: ids, markType: "is_hidden", markValue: true, userId, orderGuid: guid});
  await gate.setOffersMark({offerIds: ids, markType: "is_selected", markValue: false, userId, orderGuid: guid});
  g.set("markedRows.selected", []);
  await sleep(2000);
  return {hidden: ids.length, selected_left: await total(guid, {is_selected: true}), total_left: await total(guid)};
};

// ---- режим «без скрытия» (config.orders[].hide = false, например Заказ #4): объявления остаются в ленте,
// выгрузка идёт по заранее взятому списку id: отметить порцию → экспорт → снять отметку → следующая порция.
bw.unhideAll = async (guid) => {          // вернуть ВСЕ скрытые объявления заказа в ленту (только по просьбе пользователя)
  const {api, gate, sp, userId} = ctx();
  const r = await api.getItemsBySearch(guid, {search: {...sp, is_hidden: true}, fields: ["offerId"], size: 11000}, {hideRestricted: true});
  const ids = r.items.map(i => i.offerId);
  for (let i = 0; i < ids.length; i += 500)
    await gate.setOffersMark({offerIds: ids.slice(i, i + 500), markType: "is_hidden", markValue: false, userId, orderGuid: guid});
  await sleep(2000);
  return {unhidden: ids.length, hidden_left: await total(guid, {is_hidden: true}), in_feed: await total(guid)};
};
bw.planAll = async (guid) => {             // взять id всех объявлений ленты (до 11000)
  const {api, sp} = ctx();
  const r = await api.getItemsBySearch(guid, {search: sp, fields: ["offerId"], size: 11000}, {hideRestricted: true});
  W.__plan = {guid, ids: r.items.map(i => i.offerId), k: 0, cur: [], store: []};
  return {ids: W.__plan.ids.length};
};
bw.nextSlice = async (n = 300) => {        // снять отметку с прошлой порции, отметить следующую, открыть мастер
  const {g, gate, userId} = ctx(); const P = W.__plan;
  if (P.cur.length) await gate.setOffersMark({offerIds: P.cur, markType: "is_selected", markValue: false, userId, orderGuid: P.guid});
  bw.wizardClose();
  const ids = P.ids.slice(P.k, P.k + n); P.cur = ids;
  if (!ids.length) { g.set("markedRows.selected", []); return {done: true, stored: P.store.length}; }
  await gate.setOffersMark({offerIds: ids, markType: "is_selected", markValue: true, userId, orderGuid: P.guid});
  g.set("markedRows.selected", ids); P.k += ids.length;
  await sleep(1500);
  return {k: P.k, of: P.ids.length, n: ids.length, w: await bw.wizardOpen()};
};
bw.stepSlices = async (count = 3) => {     // ≈37 с на 3 порции: экспорт открытой порции в память + следующая порция
  const P = W.__plan, res = [];
  for (let i = 0; i < count; i++) {
    const c = bw.wizardCheck(); if (!c.ok || c.cols !== 14) { res.push({err: "мастер", c}); break; }
    await bw.exportXlsx(); P.store.push({k: P.k, n: P.cur.length, rows: c.rows, blob: W.__blobs[W.__blobs.length - 1]});
    const r = await bw.nextSlice(); res.push(r.done ? r : {k: r.k, ok: r.w.ok, rows: r.w.rows});
    if (r.done) break;
  }
  return {res, stored: P.store.length};
};
bw.dumpSlices = async (from, to) => {      // файлы из памяти: строки «FILE k n rows B64START…B64END» (результат уйдёт в файл; ≤11 файлов за вызов)
  let out = "";
  for (const it of W.__plan.store.slice(from, to)) {
    const buf = new Uint8Array(await it.blob.arrayBuffer()); let s = "";
    for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
    out += "FILE " + it.k + " " + it.n + " " + it.rows + " B64START" + btoa(s) + "B64END\n";
  }
  return out + "#".repeat(Math.max(0, 105000 - out.length));
};
W.__bw = bw;
return "bw_export загружен";
})();
