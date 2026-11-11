// PVZ Master — мастер выгрузки:
// главный экран → «Выбор» (источники + проверки) → шаги выбранных сайтов (Циан → Авито → Winner) →
// «Выгрузка и проверка» (выгрузить объявления; затем отдельной кнопкой — проверка зон).
(() => {
const SRC = {
  cian: { name: 'Циан', color: '#0468FF', desc: 'Коммерческая аренда. Все параметры поиска подставляются автоматически, большой поиск сам делится по площади.' },
  avito: { name: 'Авито', color: '#00AAFF', cls: 'avito', desc: 'Регион, цена и сортировка — автоматически. Вид объекта, площадь и этаж выставляются на сайте один раз и запоминаются.' },
  winner: { name: 'Baza Winner', color: '#F97316', desc: 'Ваши сохранённые заказы, выгрузка порциями по 300 через мастер экспорта. Вход на сайт — ваш.' }
};
const CHK = {
  ozon: { name: 'Ozon', color: '#005BFF', desc: 'Зелёный (от 49 м²), синий, голубой, гарантия < 3 млн.' },
  yandex: { name: 'Яндекс Маркет', color: '#FFCC00', cls: 'ym', desc: 'Группы субсидий 1–4: до 300 / 250 / 200 / 140 тыс. ₽.' },
  wb: { name: 'Wildberries', color: '#CB11AB', cls: 'wb', desc: 'Где можно открыть ПВЗ: гарантия и тариф, от 25 м².' }
};
const STEP_INFO = { select: ['Выбор', '#8B5CF6'], cian: ['Циан', '#0468FF'], avito: ['Авито', '#00AAFF'], winner: ['Winner', '#F97316'], center: ['Выгрузка и проверка', '#14B8A6'] };
const ICON_OK = '<svg viewBox="0 0 24 24"><path d="M5 12l5 5 9-10"/></svg>';
const DEF_PARAMS = { region: 'msk', types: ['shop', 'psn', 'food', 'serv'], areaFrom: 24, areaTo: 130, priceFrom: '', priceTo: '', floor1: true, floorsFrom: 3, days: 7 };
const W = { sources: { cian: true, avito: true, winner: true }, checks: { ozon: true, yandex: false, wb: false }, params: Object.assign({}, DEF_PARAMS),
  avitoUrl: null, orders: {}, scenario: '', step: 0, steps: [], siteOpen: false, siteKind: null, run: null, ordersList: [] };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const tick = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

// ---------------- сохранение состояния ----------------
let saveT = null;
const snapshot = () => ({ sources: W.sources, checks: W.checks, params: W.params, avitoUrl: W.avitoUrl, orders: W.orders, scenario: W.scenario });
const persist = () => { clearTimeout(saveT); saveT = setTimeout(() => pvz.setCfg({ wizard: snapshot() }), 300); };

// ---------------- окно по центру ----------------
let modalOpen = false;
window.showModal = function ({ kind = 'info', title = '', text = '', html = false, buttons = [{ label: 'Понятно', cls: 'primary', value: true }], input = null }) {
  return new Promise(res => {
    const m = $('modal');
    m.className = 'modal on ' + kind;
    $('mIco').textContent = { err: '!', warn: '!', ok: '✓', info: 'i' }[kind] || 'i';
    $('mTitle').textContent = title;
    $('mText')[html ? 'innerHTML' : 'textContent'] = html ? text : prettyNums(text);
    if (input) { const i = document.createElement('input'); i.type = 'text'; i.id = 'mInput'; i.value = input.value || ''; i.placeholder = input.placeholder || ''; $('mText').appendChild(i); setTimeout(() => i.focus(), 50); }
    $('mBtns').innerHTML = '';
    const close = v => { m.className = 'modal'; modalOpen = false; sendRect(); res(v); };
    buttons.forEach(b => {
      const el = document.createElement('button'); el.className = b.cls || 'ghost'; el.textContent = b.label;
      el.onclick = () => close(input && b.value !== null && b.value !== false ? { value: b.value, input: $('mInput').value.trim() } : b.value);
      $('mBtns').appendChild(el);
    });
    $('mX').onclick = () => close(null);
    modalOpen = true; sendRect();
  });
};
// ошибки ручного режима — тоже окном по центру
if (typeof setStatus === 'function') {
  const _s = setStatus;
  setStatus = function (t, k) { _s(t, k); if (k === 'err' && document.body.dataset.mode === 'work') showModal({ kind: 'err', title: 'Ошибка', text: t }); };
}
if (typeof setOzon === 'function') {
  const _o = setOzon;
  setOzon = function (t, k, p) { _o(t, k, p); if (k === 'err' && document.body.dataset.mode === 'work' && !(W.run && W.run.check && W.run.check.st === 'run')) showModal({ kind: 'err', title: 'Проверка зон', text: t }); };
}

// ---------------- сайт справа ----------------
function sendRect() {
  if (document.body.dataset.mode !== 'wizard') return;
  if (W.siteOpen && !modalOpen) { const r = $('wzSiteHost').getBoundingClientRect(); if (r.width > 50) { pvz.siteRect({ x: r.left, y: r.top, width: r.width, height: r.height }); return; } }
  pvz.siteRect(null);
}
new ResizeObserver(() => sendRect()).observe($('wzSiteHost'));
window.addEventListener('resize', sendRect);
async function openSiteView(kind, url) {
  W.siteOpen = true; W.siteKind = kind;
  document.body.classList.add('site-open');
  $('wzSiteName').textContent = SRC[kind] ? SRC[kind].name : kind;
  await tick(); sendRect();
  if (url) await pvz.navUrl(kind, url, true);
}
function closeSiteView() { W.siteOpen = false; document.body.classList.remove('site-open'); pvz.siteRect(null); }
$('wzSiteClose').onclick = () => { W.liveSite = false; closeSiteView(); if (cur() === 'center') rerender(); };
$('wzSiteBack').onclick = () => pvz.siteBack();
$('wzSiteReload').onclick = () => pvz.siteReload();

// ---------------- шаги ----------------
const buildSteps = () => (W.steps = ['select', ...['cian', 'avito', 'winner'].filter(s => W.sources[s]), 'center']);
const paramsStep = () => W.steps.find(s => s === 'cian' || s === 'avito');
const cur = () => W.steps[W.step];
function renderRibbon() {
  const busy = W.run && (W.run.phase === 'export' || (W.run.check && W.run.check.st === 'run'));
  $('wzSteps').innerHTML = W.steps.map((s, i) => `<li class="${i < W.step ? 'done' : i === W.step ? 'cur' : ''}" data-i="${i}" style="--sc:${STEP_INFO[s][1]}"><b>${i < W.step ? '✓' : i + 1}</b>${STEP_INFO[s][0]}</li>`).join('');
  $('wzSteps').querySelectorAll('li.done').forEach(li => (li.onclick = () => { if (!busy) goTo(+li.dataset.i); }));
}
function paramChips(p) {
  const t = TYPES.filter(x => p.types.includes(x.k)).map(x => x.name).join(', ') || 'все виды';
  const a = (p.areaFrom !== '' || p.areaTo !== '') ? `${p.areaFrom !== '' ? fmtNum(p.areaFrom) : '…'}–${p.areaTo !== '' ? fmtNum(p.areaTo) : '…'} м²` : 'любая площадь';
  const pr = (p.priceFrom !== '' || p.priceTo !== '') ? `${p.priceFrom !== '' ? 'от ' + fmtNum(p.priceFrom) + ' ' : ''}${p.priceTo !== '' ? 'до ' + fmtNum(p.priceTo) : ''} ₽/мес` : 'любая цена';
  return [p.region === 'msk_mo' ? 'Москва и МО' : 'Москва', t, a, pr, p.floor1 ? '1-й этаж' : null, p.floorsFrom !== '' ? `дом от ${p.floorsFrom} эт.` : null, p.days ? `не старше ${p.days} дн.` : 'любая дата'].filter(Boolean);
}
function renderBar() {
  const ps = paramsStep(), s = cur();
  const show = ps && s !== 'select' && W.steps.indexOf(s) > W.steps.indexOf(ps);
  $('wzBar').classList.toggle('on', !!show);
  if (show) {
    $('wzBar').innerHTML = '<span class="lb">Ваши вводные:</span>' + paramChips(W.params).map(c => `<span class="pc">${esc(c)}</span>`).join('') + '<a id="wzEdit">Изменить</a>';
    $('wzEdit').onclick = () => { if (!(W.run && W.run.phase === 'export')) goTo(W.steps.indexOf(ps)); };
  }
  setTimeout(sendRect, 30);
}
async function goTo(i, dir) {
  const el = $('wzStep');
  el.classList.remove('enter'); el.classList.add('leave');
  await sleep(180);
  if (cur() !== 'center') closeSiteView();
  W.step = i; W.justEntered = true;
  el.classList.remove('leave');
  render();
  void el.offsetWidth; el.classList.add('enter');
}
function render() {
  buildSteps();
  if (W.step >= W.steps.length) W.step = W.steps.length - 1;
  renderRibbon(); renderBar();
  const s = cur();
  $('wzStep').style.setProperty('--sc', STEP_INFO[s][1]);
  ({ select: renderSelect, cian: renderCian, avito: renderAvito, winner: renderWinner, center: renderCenter })[s]();
  $('wzStep').scrollTop = 0;
}
const nav = (back, next, nextLabel = 'Далее →', nextDisabled = false) =>
  `<div class="wz-nav"><button class="ghost" id="wzBack">${back}</button><button class="primary" id="wzNext"${nextDisabled ? ' disabled' : ''}>${nextLabel}</button></div>`;
function bindNav(onNext) {
  $('wzBack').onclick = () => (W.step > 0 ? goTo(W.step - 1) : goHome());
  $('wzNext').onclick = onNext || (() => goTo(W.step + 1));
}

// ---------------- шаг 1: выбор ----------------
function card(key, info, on) {
  return `<button class="pc-card ${info.cls || ''}${on ? ' on' : ''}" data-k="${key}" style="--b:${info.color}"><span class="ck">${ICON_OK}</span><span class="nm">${info.name}</span><span class="ds">${info.desc}</span></button>`;
}
async function renderSelect() {
  const c = await pvz.getCfg();
  presets = c.presets && Object.keys(c.presets).length ? c.presets : JSON.parse(JSON.stringify(DEFAULT_PRESETS));
  $('wzStep').innerHTML = `<h2>Где работаем?</h2>
    <p class="lead">Отметьте, где искать объявления и на каких картах потом проверять помещения. Выгрузка и проверка запускаются только вашими кнопками на последнем шаге.</p>
    <div class="scen"><label class="field">Сценарий<select id="wzScen"><option value="">— текущие настройки —</option>${Object.keys(presets).map(n => `<option${n === W.scenario ? ' selected' : ''}>${esc(n)}</option>`).join('')}</select></label>
      <span class="hint">Сценарий — сохранённый набор: источники, проверки, параметры, фильтры Авито и заказы Winner.</span></div>
    <h3>Источники объявлений</h3><div class="pick" id="wzSrc">${Object.entries(SRC).map(([k, v]) => card(k, v, W.sources[k])).join('')}</div>
    <h3>Проверка зон</h3><div class="pick" id="wzChk">${Object.entries(CHK).map(([k, v]) => card(k, v, W.checks[k])).join('')}</div>
    ${nav('Отмена', null, 'Далее →', !Object.values(W.sources).some(Boolean))}`;
  $('wzSrc').querySelectorAll('.pc-card').forEach(b => (b.onclick = () => { W.sources[b.dataset.k] = !W.sources[b.dataset.k]; b.classList.toggle('on'); buildSteps(); renderRibbon(); $('wzNext').disabled = !Object.values(W.sources).some(Boolean); persist(); }));
  $('wzChk').querySelectorAll('.pc-card').forEach(b => (b.onclick = () => { W.checks[b.dataset.k] = !W.checks[b.dataset.k]; b.classList.toggle('on'); persist(); }));
  $('wzScen').onchange = () => { applyScenario($('wzScen').value); render(); };
  bindNav();
}
function applyScenario(name) {
  W.scenario = name;
  const p = presets[name]; if (!p) { persist(); return; }
  W.params = Object.assign({}, DEF_PARAMS, ...Object.keys(DEF_PARAMS).filter(k => k in p).map(k => ({ [k]: p[k] })));
  if ('cian' in p || 'avito' in p) W.sources = { cian: p.cian !== false, avito: p.avito !== false, winner: !!p.winner };
  if (p.checks) W.checks = Object.assign({ ozon: false, yandex: false, wb: false }, p.checks);
  W.avitoUrl = p.avitoUrl || null;
  if (p.orders) W.orders = p.orders;
  persist();
}

// ---------------- параметры поиска (общие для Циана и Авито) ----------------
function paramsForm() {
  const p = W.params;
  return `<div class="o-seg" id="fRegion"><button data-v="msk"${p.region === 'msk' ? ' class="on"' : ''}>Москва</button><button data-v="msk_mo"${p.region === 'msk_mo' ? ' class="on"' : ''}>Москва и МО</button></div>
    <h3>Вид помещения</h3><div class="o-types" id="fTypes">${TYPES.map(t => `<label><input type="checkbox" value="${t.k}"${p.types.includes(t.k) ? ' checked' : ''}><span>${t.name}</span></label>`).join('')}</div>
    <h3>Параметры</h3><div class="fgrid">
      <label class="field">Площадь от, м²<input id="fAreaFrom" type="text" class="num" inputmode="numeric" autocomplete="off"></label>
      <label class="field">Площадь до, м²<input id="fAreaTo" type="text" class="num" inputmode="numeric" autocomplete="off"></label>
      <label class="field">Не старше, дней<input id="fDays" type="text" class="num" inputmode="numeric" autocomplete="off"></label>
      <label class="field">Цена от, ₽/мес<input id="fPriceFrom" type="text" class="num" inputmode="numeric" autocomplete="off"></label>
      <label class="field">Цена до, ₽/мес<input id="fPriceTo" type="text" class="num" inputmode="numeric" autocomplete="off"></label>
      <label class="field">Дом от, этажей<input id="fFloorsFrom" type="text" class="num" inputmode="numeric" autocomplete="off"></label></div>
    <div style="margin-top:12px"><label class="switch"><input type="checkbox" id="fFloor1"${p.floor1 ? ' checked' : ''}><span></span>Только 1-й этаж</label></div>`;
}
function bindParams(onChange) {
  const p = W.params;
  [['fAreaFrom', 'areaFrom'], ['fAreaTo', 'areaTo'], ['fPriceFrom', 'priceFrom'], ['fPriceTo', 'priceTo'], ['fFloorsFrom', 'floorsFrom'], ['fDays', 'days']].forEach(([id, k]) => {
    setNum($(id), p[k]);
    $(id).addEventListener('input', () => { p[k] = numOf($(id)); persist(); onChange && onChange(); });
  });
  $('fRegion').querySelectorAll('button').forEach(b => (b.onclick = () => { $('fRegion').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); p.region = b.dataset.v; persist(); onChange && onChange(); }));
  $('fTypes').querySelectorAll('input').forEach(i => (i.onchange = () => { p.types = [...$('fTypes').querySelectorAll('input:checked')].map(x => x.value); persist(); onChange && onChange(); }));
  $('fFloor1').onchange = () => { p.floor1 = $('fFloor1').checked; persist(); onChange && onChange(); };
}

// ---------------- шаг: Циан ----------------
function cianList() {
  const p = W.params, items = [];
  items.push(['auto', 'Регион: ' + (p.region === 'msk_mo' ? 'Москва и Московская область — два поиска подряд' : 'Москва')]);
  items.push(['auto', 'Вид помещения: ' + (TYPES.filter(x => p.types.includes(x.k)).map(x => x.name).join(', ') || 'все')]);
  items.push(['auto', 'Площадь, цена, «только 1-й этаж», этажность дома, сортировка по дате — подставляются в поиск']);
  items.push(['auto', p.days ? `Объявления старше ${p.days} дн. программа отбросит сама` : 'Все объявления, без ограничения по дате']);
  return items;
}
const listHtml = items => `<ul class="chk-list">${items.map(([k, t]) => `<li class="${k}"><i>${k === 'auto' ? '✓' : k === 'hand' ? '✎' : '—'}</i><span>${esc(t)}</span></li>`).join('')}</ul>`;
function renderCian() {
  const first = paramsStep() === 'cian';
  $('wzStep').innerHTML = `<h2>Циан <span class="tag">шаг ${W.step + 1}</span></h2>
    <p class="lead">${first ? 'Задайте параметры поиска. Они же будут вводными для Авито.' : 'Параметры уже заданы.'} На Циане всё подставляется автоматически — проверьте и жмите «Далее».</p>
    ${first ? paramsForm() : ''}
    <h3>Что будет на Циане</h3><div id="cList">${listHtml(cianList())}</div>
    <button class="bigbtn" id="cOpen"><svg viewBox="0 0 24 24"><path d="M14 4h6v6"/><path d="M20 4l-9 9"/><path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/></svg>Посмотреть этот поиск на Циане</button>
    ${nav('← Назад')}`;
  if (first) bindParams(() => ($('cList').innerHTML = listHtml(cianList())));
  $('cOpen').onclick = () => openSiteView('cian', cianUrl(W.params, '1'));
  bindNav(() => { closeSiteView(); goTo(W.step + 1); });
}

// ---------------- шаг: Авито ----------------
function avitoItems() {
  const p = W.params, items = [];
  items.push(['auto', 'Регион, цена и сортировка по дате — подставятся автоматически']);
  if (W.avitoUrl) items.push(['auto', 'Вид объекта, площадь и этаж — из сохранённых фильтров']);
  else avitoManual(p).forEach(m => items.push(['hand', m]));
  if (p.floorsFrom !== '') items.push(['na', 'Этажность дома — на Авито такого фильтра нет, условие не применится']);
  items.push(['auto', p.days ? `Объявления старше ${p.days} дн. программа отбросит сама` : 'Все объявления, без ограничения по дате']);
  return items;
}
function renderAvito() {
  const first = paramsStep() === 'avito';
  const manual = !W.avitoUrl && avitoManual(W.params).length;
  $('wzStep').innerHTML = `<h2>Авито <span class="tag">шаг ${W.step + 1}</span></h2>
    <p class="lead">${first ? 'Задайте параметры поиска. ' : ''}Авито не даёт задать часть фильтров из программы — их нужно один раз выставить на сайте (отмечены ✎). Программа запомнит их.</p>
    ${first ? paramsForm() : ''}
    <h3>Что будет на Авито</h3><div id="aList">${listHtml(avitoItems())}</div>
    ${W.avitoUrl ? `<div class="okline">✓ Фильтры Авито сохранены. <a id="aReset">Выставить заново</a></div>` : ''}
    <button class="bigbtn" id="aOpen"><svg viewBox="0 0 24 24"><path d="M14 4h6v6"/><path d="M20 4l-9 9"/><path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/></svg>${W.avitoUrl ? 'Открыть Авито с сохранёнными фильтрами' : 'Открыть Авито и выставить фильтры'}</button>
    <p class="hint" id="aHint" style="margin-top:10px">${manual ? 'На сайте справа выберите вид объекта, площадь и этаж (блок «Этаж» появляется после выбора вида), дождитесь выдачи и нажмите «Далее» — фильтры запомнятся.' : ''}</p>
    ${nav('← Назад')}`;
  if (first) bindParams(() => ($('aList').innerHTML = listHtml(avitoItems())));
  if ($('aReset')) $('aReset').onclick = () => { W.avitoUrl = null; persist(); render(); };
  $('aOpen').onclick = () => openSiteView('avito', W.avitoUrl || avitoUrl(W.params));
  bindNav(async () => {
    if (W.siteOpen && W.siteKind === 'avito') {
      const u = await pvz.currentUrl();
      if (/avito\.ru\/[^?]*kommercheskaya_nedvizhimost/.test(u) && !/_\d{8,}(\?|$)/.test(u)) {
        const x = new URL(u); x.searchParams.delete('context'); x.searchParams.delete('localPriority'); W.avitoUrl = x.href; persist();
      }
    }
    if (!W.avitoUrl && avitoManual(W.params).length) {
      const v = await showModal({ kind: 'warn', title: 'Фильтры Авито не выставлены',
        text: 'На Авито не будут учтены:\n' + avitoManual(W.params).map(x => '• ' + x).join('\n') + '\n\nОткройте Авито и выставьте их или продолжите без них (будет больше лишних объявлений).',
        buttons: [{ label: 'Назад', value: 'back' }, { label: 'Продолжить без них', value: 'skip' }, { label: 'Открыть Авито', cls: 'primary', value: 'open' }] });
      if (v === 'open') { openSiteView('avito', avitoUrl(W.params)); return; }
      if (v !== 'skip') return;
    }
    closeSiteView(); goTo(W.step + 1);
  });
}

// ---------------- шаг: Winner ----------------
async function renderWinner() {
  $('wzStep').innerHTML = `<h2>Baza Winner <span class="tag">шаг ${W.step + 1}</span></h2>
    <p class="lead">Отметьте заказы для выгрузки. Параметры самих заказов (площадь, цена, виды) хранятся в Winner. Если вход на сайт слетел — откройте Winner и войдите сами.</p>
    <div id="oList"><p class="hint">Загружаю заказы…</p></div>
    <button class="bigbtn" id="wOpen"><svg viewBox="0 0 24 24"><path d="M14 4h6v6"/><path d="M20 4l-9 9"/><path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/></svg>Открыть Winner (вход, просмотр заказов)</button>
    <p class="hint" style="margin-top:10px">«В скрытые»: после проверки записанного файла выгруженные объявления помещаются в скрытые (как для заказов #3 и #5). Без галочки (как #4) выгружается весь заказ, объявления остаются в ленте.</p>
    ${nav('← Назад')}`;
  W.ordersList = await pvz.bwOrders();
  const known = { 'f6fcd57a-013b-45c8-abcd-89f04b3bf28b': { tag: '', hide: true }, 'bde0dac7-35da-4e41-92d9-a94b78552bdb': { tag: '#4', hide: false }, '3daabb2d-e169-4789-91c9-7b2cb677f87c': { tag: 'МО', hide: true } };
  const c = await pvz.getCfg();
  for (const o of W.ordersList) if (!W.orders[o.guid]) { const s = (c.bwOrders || {})[o.guid] || known[o.guid] || { tag: '', hide: true }; W.orders[o.guid] = { on: false, tag: s.tag || '', hide: s.hide !== false, name: o.name }; }
  $('oList').innerHTML = W.ordersList.map(o => { const s = W.orders[o.guid]; return `<div class="order-row" data-g="${o.guid}">
      <label class="switch"><input type="checkbox" class="on"${s.on ? ' checked' : ''}><span></span></label>
      <div><b>${esc(o.name)}</b><div class="hint">${o.guid.slice(0, 8)}…</div></div>
      <label class="field">Метка файлов<input type="text" class="tg" value="${esc(s.tag)}" placeholder="пусто"></label>
      <label class="switch"><input type="checkbox" class="hd"${s.hide ? ' checked' : ''}><span></span><span class="lbl">в скрытые</span></label></div>`; }).join('') || '<p class="hint">Заказы не найдены — откройте Winner и зайдите в нужный заказ, он появится здесь.</p>';
  $('oList').querySelectorAll('.order-row').forEach(r => {
    const s = W.orders[r.dataset.g];
    r.querySelector('.on').onchange = e => { s.on = e.target.checked; persist(); };
    r.querySelector('.tg').oninput = e => { s.tag = e.target.value.trim(); persist(); };
    r.querySelector('.hd').onchange = e => { s.hide = e.target.checked; persist(); };
  });
  $('wOpen').onclick = () => openSiteView('winner', 'https://w7.baza-winner.ru/');
  bindNav(async () => {
    if (!Object.values(W.orders).some(o => o.on && W.ordersList.find(x => x.name === o.name))) {
      await showModal({ kind: 'warn', title: 'Не выбран ни один заказ', text: 'Отметьте хотя бы один заказ Winner или вернитесь на шаг «Выбор» и отключите Winner.' });
      return;
    }
    closeSiteView(); goTo(W.step + 1);
  });
}

// ---------------- шаг: выгрузка и проверка ----------------
const chosenOrders = () => W.ordersList.filter(o => W.orders[o.guid] && W.orders[o.guid].on).map(o => Object.assign({ guid: o.guid }, W.orders[o.guid]));
function newRun() {
  const src = {};
  for (const k of ['cian', 'avito', 'winner']) if (W.sources[k]) src[k] = { st: 'wait', text: 'ожидает', files: [], total: 0 };
  W.run = { phase: 'idle', src, files: [], check: { st: 'wait', text: 'Запустится после выгрузки по кнопке «Начать проверку».' }, stop: false, cur: null };
}
function srcSummary(k) {
  if (k === 'winner') return chosenOrders().map(o => `${o.name}${o.tag ? ' · метка ' + o.tag : ''}${o.hide ? ' · в скрытые' : ' · без скрытия'}`).join('\n') || 'заказы не выбраны';
  if (k === 'avito') return paramChips(W.params).join(' · ') + (W.avitoUrl ? '\nФильтры Авито: сохранены ✓' : (avitoManual(W.params).length ? '\nФильтры Авито: не выставлены (вид объекта, площадь, этаж не учтутся)' : ''));
  return paramChips(W.params).join(' · ');
}
const ST = { wait: ['ожидает', ''], run: ['идёт…', 'run'], ok: ['готово', 'ok'], err: ['ошибка', 'err'], skip: ['пропущено', ''] };
function renderCenter() {
  if (!W.run) newRun();
  const R = W.run;
  const checks = Object.entries(CHK).filter(([k]) => W.checks[k]);
  const exporting = R.phase === 'export', checking = R.check.st === 'run';
  const hasErr = Object.values(R.src).some(s => s.st === 'err');
  $('wzStep').innerHTML = `<h2>Выгрузка и проверка</h2>
    <p class="lead">Проверьте, что всё верно. Сначала нажмите «Выгрузить объявления» — появятся Excel-файлы. Затем отдельной кнопкой «Начать проверку».</p>
    <div class="cc-grid">
      ${Object.entries(R.src).map(([k, s]) => `<div class="cc-card ${SRC[k].cls || ''}" style="--b:${SRC[k].color}" id="cc_${k}">
        <div class="h"><b>${SRC[k].name}</b><span class="st ${ST[s.st][1]}">${s.st === 'run' ? 'идёт…' : s.st === 'ok' ? 'готово · ' + fmtNum(s.total) : ST[s.st][0]}</span></div>
        <div class="p">${esc(s.st === 'wait' ? srcSummary(k) : prettyNums(s.text))}</div>
        ${s.st === 'run' ? '<div class="bar ind"><i></i></div>' : ''}
        ${s.files.length ? `<div class="cc-files">${s.files.map(f => `<a data-file="${esc(f)}" title="${esc(f)}">📄 ${esc(f.split(/[\\/]/).pop())}</a>`).join('')}</div>` : ''}</div>`).join('')}
      <div class="cc-card" style="--b:#8B5CF6" id="cc_check">
        <div class="h"><b>Проверка зон</b><div class="chips-inline" style="margin-left:8px">${checks.map(([k, v]) => `<span style="--b:${v.color}">${v.name}</span>`).join('') || '<span style="--b:#64748b">не выбрана</span>'}</div>
          <span class="st ${ST[R.check.st][1]}">${ST[R.check.st][0]}</span></div>
        <div class="p">${esc(prettyNums(R.check.text))}</div>
        ${checking ? `<div class="bar ${R.check.total ? '' : 'ind'}"><i style="${R.check.total ? `width:${Math.round(100 * (R.check.done || 0) / R.check.total)}%;transform:none` : ''}"></i></div>` : ''}
        ${R.check.saved && R.check.saved.length ? `<div class="cc-files">${R.check.saved.map(f => `<a data-file="${esc(f)}" title="${esc(f)}">📄 ${esc(f.split(/[\\/]/).pop())}</a>`).join('')}</div>` : ''}
      </div>
    </div>
    <div class="cc-actions" style="margin-top:16px">
      ${R.phase === 'exported' && hasErr && !checking ? '<button class="ghost" id="ccRetryExp">↻ Повторить выгрузку с ошибкой</button>' : ''}
      ${R.phase === 'exported' && !checking ? '<button class="ghost" id="ccExportAgain">⬇ Выгрузить ещё раз</button>' : ''}
      ${R.check.st === 'err' && !checking ? '<button class="ghost" id="ccContinue">▶ Продолжить проверку</button>' : ''}
      ${(R.check.st === 'ok' || R.check.st === 'err') && !checking && checks.length ? '<button class="ghost" id="ccCheckAgain">↻ Проверить снова</button>' : ''}
      ${exporting ? `<button class="ghost" id="ccLive">${W.siteOpen ? '▣ Свернуть сайт' : '👁 Показать сайт'}</button>` : ''}
      <button class="ghost" id="ccSave">Сохранить сценарий</button>
      ${R.files.length ? '<button class="ghost" id="ccFolder">Открыть папку</button>' : ''}
      ${R.check.st === 'ok' || R.check.st === 'err' ? '<button class="ghost" id="ccResults">Результаты</button>' : ''}
    </div>
    ${(() => {
      // справа внизу — всегда следующее действие по порядку (там, где на прошлых шагах была «Далее»)
      const allDone = R.phase === 'exported' && (!checks.length || R.check.st === 'ok' || R.check.st === 'err');
      let main;
      if (exporting) main = '<button class="danger cc-main" id="ccStop">■ Остановить выгрузку</button>';
      else if (checking) main = '<button class="danger cc-main" id="ccStop">■ Остановить проверку</button>';
      else if (R.phase === 'idle') main = '<button class="primary go-export cc-main" id="ccExport">⬇ Выгрузить объявления</button>';
      else if (R.phase === 'exported' && checks.length && R.check.st === 'wait') main = `<button class="primary go-check cc-main" id="ccCheck"${!R.files.length ? ' disabled title="Нет файлов для проверки"' : ''}>✓ Начать проверку</button>`;
      else if (allDone) main = '<button class="primary cc-main" id="wzNext">Готово ✓</button>';
      else main = '';
      const hint = R.phase === 'idle' ? 'Шаг 1 из 2: выгрузка объявлений в Excel' : R.phase === 'exported' && checks.length && R.check.st === 'wait' ? 'Шаг 2 из 2: проверка зон по выгруженным файлам' : allDone ? 'Всё сделано — можно закрыть мастер' : '';
      return `<div class="wz-nav"><div class="nav-left"><button class="ghost" id="wzBack"${exporting || checking ? ' disabled' : ''}>← Назад</button>
        <button class="link-btn" id="ccHome"${exporting || checking ? ' disabled' : ''}>На главный экран</button></div>
        <div class="nav-right"><span class="nav-hint">${hint}</span>${main}</div></div>`;
    })()}`;
  const on = (id, f) => { const e = $(id); if (e) e.onclick = f; };
  // защита от двойного щелчка: сразу после перехода на шаг главная кнопка недолго неактивна
  const mainBtn = document.querySelector('.cc-main');
  if (mainBtn && W.justEntered) { mainBtn.disabled = true; setTimeout(() => { if (!mainBtn.hasAttribute('title')) mainBtn.disabled = false; }, 700); }
  W.justEntered = false;
  on('ccExport', () => runExportAll(false));
  on('ccExportAgain', () => { newRun(); runExportAll(false); });
  on('ccRetryExp', () => runExportAll(true));
  on('ccStop', () => { if (W.run.phase === 'export') { W.run.stop = true; pvz.stop(); } if (W.run.check.st === 'run') pvz.ozonStop(); });
  on('ccCheck', () => runCheck(false));
  on('ccCheckAgain', () => runCheck(true));
  on('ccHome', () => goHome());
  on('ccContinue', () => runCheck(false));
  on('ccSave', saveScenario);
  on('ccLive', async () => {
    if (W.siteOpen) { W.liveSite = false; closeSiteView(); }
    else { W.liveSite = true; await openSiteView(W.siteKind || 'cian'); }
    rerender();
  });
  on('ccFolder', () => pvz.showFile(R.files[0]));
  on('ccResults', () => openPage('results'));
  $('wzStep').querySelectorAll('a[data-file]').forEach(a => (a.onclick = () => pvz.showFile(a.dataset.file)));
  $('wzBack').onclick = () => goTo(W.step - 1);
  on('wzNext', () => goHome());
}
const rerender = () => { if (cur() === 'center') renderCenter(); renderRibbon(); };

async function baseCfg(extra) {
  const c = await pvz.getCfg();
  return Object.assign({ pages: c.pages || 40, delay: Math.max(3, c.delay || 4), part: c.part || 300, days: W.params.days === '' ? 0 : W.params.days }, extra);
}
const isBad = r => !r.ok || /ошибк|робот|войти|не удалось|не найден/i.test(r.reason || '');
async function exportOne(k) {
  const S = W.run.src[k];
  S.st = 'run'; S.text = 'Открываю сайт…'; S.files = []; S.total = 0; W.run.cur = k; rerender();
  const parts = [];
  const go = async (url, extra, label, waitMs) => {
    // сайт работает в фоне; показывается только если вы нажали «Показать сайт»
    W.siteKind = k;
    if (W.liveSite) await openSiteView(k, url); else await pvz.navUrl(k, url, true);
    if (waitMs) await sleep(waitMs);
    if (W.run.stop) return null;
    S.text = (label ? label + ': ' : '') + 'выгрузка…'; rerender();
    const r = await pvz.start(await baseCfg(extra));
    if (r.saved) S.files.push(...r.saved);
    S.total += r.total || 0;
    parts.push((label ? label + ': ' : '') + (r.ok ? `${r.reason}. Объявлений ${fmtNum(r.total)}, файлов ${r.saved.length}` : 'ошибка — ' + r.error));
    return r;
  };
  let bad = null;
  try {
    if (k === 'cian') {
      for (const reg of (W.params.region === 'msk_mo' ? ['1', '4593'] : ['1'])) {
        const r = await go(cianUrl(W.params, reg), { title: (W.scenario || 'Циан') + (reg === '1' ? ' · Москва' : ' · МО') }, reg === '1' ? 'Москва' : 'МО');
        if (!r) break; if (isBad(r)) { bad = r; break; }
      }
    } else if (k === 'avito') {
      const r = await go(W.avitoUrl || avitoUrl(W.params), { title: W.scenario || 'Авито' });
      if (r && isBad(r)) bad = r;
    } else {
      for (const o of chosenOrders()) {
        const r = await go(`https://w7.baza-winner.ru/search/${o.guid}/params`, { title: o.name, bw: { tag: o.tag, hide: o.hide, name: o.name } }, o.name, 6000);
        if (!r) break; if (isBad(r)) { bad = r; break; }
      }
    }
  } catch (e) { bad = { ok: false, error: e.message || String(e) }; pvz.logError('мастер ' + k, e.stack || String(e)); }
  S.text = parts.join('\n') || (W.run.stop ? 'остановлено' : '');
  S.st = W.run.stop && !parts.length ? 'skip' : bad ? 'err' : 'ok';
  if (bad) S.err = bad.error || bad.reason;
  W.run.files.push(...S.files);
  W.run.cur = null; rerender();
}
async function runExportAll(onlyFailed) {
  const R = W.run; R.phase = 'export'; R.stop = false; W.liveSite = false; closeSiteView(); rerender();
  if (!onlyFailed) R.files = [];
  for (const k of Object.keys(R.src)) {
    if (onlyFailed && R.src[k].st !== 'err') continue;
    if (onlyFailed) R.files = R.files.filter(f => !R.src[k].files.includes(f));
    if (R.stop) { R.src[k].st = 'skip'; R.src[k].text = 'остановлено'; continue; }
    await exportOne(k);
  }
  closeSiteView();
  R.phase = 'exported'; rerender();
  const errs = Object.entries(R.src).filter(([, s]) => s.st === 'err');
  const n = R.files.length;
  if (errs.length) {
    const v = await showModal({ kind: 'err', title: 'Выгрузка завершилась с ошибкой',
      text: errs.map(([k, s]) => `${SRC[k].name}: ${s.err || s.text}`).join('\n') + `\n\nСохранено файлов: ${n}.`,
      buttons: [{ label: 'Закрыть', value: 'close' }, { label: 'Продолжить к проверке', value: 'go' }, { label: '↻ Попробовать снова', cls: 'primary', value: 'retry' }] });
    if (v === 'retry') return runExportAll(true);
  } else if (!R.stop) {
    pvz.notify('PVZ Master — выгрузка завершена', `Файлов: ${n}`);
    await showModal({ kind: 'ok', title: 'Выгрузка завершена', text: `Сохранено файлов: ${n}.` + (Object.values(W.checks).some(Boolean) ? '\nТеперь можно нажать «Начать проверку».' : ''),
      buttons: [{ label: 'Хорошо', cls: 'primary', value: true }] });
  }
}
async function runCheck(fresh) {
  const R = W.run;
  if (!R.files.length) return;
  await pvz.setCfg({ chkOzon: !!W.checks.ozon, chkYandex: !!W.checks.yandex, chkWb: !!W.checks.wb });
  R.check = { st: 'run', text: 'Запуск проверки…', saved: [] }; rerender();
  const r = await pvz.ozonStart(R.files, { fresh: !!fresh });
  if (!r.ok) { R.check = { st: 'err', text: r.error }; rerender(); showModal({ kind: 'err', title: 'Проверка не запустилась', text: r.error }); }
}
pvz.onStatus(s => { if (W.run && W.run.cur) { const S = W.run.src[W.run.cur]; S.text = s; const el = document.querySelector(`#cc_${W.run.cur} .p`); if (el) el.textContent = prettyNums(s); } });
pvz.onOzonStatus(s => {
  if (!(W.run && W.run.check && W.run.check.st === 'run')) return;
  Object.assign(W.run.check, { text: s.text, done: s.done, total: s.total });
  const el = document.querySelector('#cc_check .p'); if (el) el.textContent = prettyNums(s.text);
  const bar = document.querySelector('#cc_check .bar'); if (bar && s.total) { bar.classList.remove('ind'); bar.firstChild.style.width = Math.round(100 * (s.done || 0) / s.total) + '%'; bar.firstChild.style.transform = 'none'; }
});
pvz.onOzonDone(async res => {
  if (!(W.run && W.run.check && W.run.check.st === 'run')) return;
  const C = W.run.check;
  if (!res.ok) { C.st = 'err'; C.text = res.error; rerender(); }
  else {
    const blocks = res.results.map(r => r.kind === 'ozon' ? ozonText(r) : platformText(r));
    const bad = res.results.some(r => r.unchecked || (r.stats && r.stats.unchecked) || (r.errors && r.errors.length) || /ограничил|не ответила|остановлено/.test(r.reason));
    C.st = bad ? 'err' : 'ok'; C.text = blocks.join('\n\n') || 'Новых файлов для проверки нет.'; C.saved = res.results.flatMap(r => r.saved || []);
    rerender();
  }
  if (C.st === 'err') {
    const v = await showModal({ kind: 'err', title: 'Проверка завершилась не полностью', text: C.text,
      buttons: [{ label: 'Закрыть', value: 'close' }, { label: '↻ Попробовать снова', value: 'retry' }, { label: '▶ Продолжить проверку', cls: 'primary', value: 'cont' }] });
    if (v === 'cont') runCheck(false); else if (v === 'retry') runCheck(true);
  } else {
    const v = await showModal({ kind: 'ok', title: 'Проверка завершена', text: C.text, buttons: [{ label: 'Закрыть', value: 'close' }, { label: 'Открыть результаты', cls: 'primary', value: 'res' }] });
    if (v === 'res') openPage('results');
  }
});
async function saveScenario() {
  const v = await showModal({ kind: 'info', title: 'Сохранить сценарий', text: 'Сохранятся источники, проверки, параметры, фильтры Авито и выбранные заказы Winner.', input: { value: W.scenario, placeholder: 'Название, например «Заказ #4»' },
    buttons: [{ label: 'Отмена', value: null }, { label: 'Сохранить', cls: 'primary', value: 'save' }] });
  if (!v || !v.input) return;
  presets[v.input] = Object.assign({}, W.params, { cian: !!W.sources.cian, avito: !!W.sources.avito, winner: !!W.sources.winner, checks: W.checks, avitoUrl: W.avitoUrl, orders: W.orders });
  W.scenario = v.input; await pvz.setCfg({ presets, lastPreset: v.input }); persist();
  showModal({ kind: 'ok', title: 'Сценарий сохранён', text: `«${v.input}» — выберите его на шаге «Выбор» в следующий раз.` });
}

// ---------------- вход и выход ----------------
async function goHome() {
  const busy = W.run && (W.run.phase === 'export' || W.run.check.st === 'run');
  if (busy) {
    const v = await showModal({ kind: 'warn', title: 'Идёт работа', text: 'Выгрузка или проверка ещё идёт. Остановить и выйти на главный экран?', buttons: [{ label: 'Остаться', value: false }, { label: 'Остановить и выйти', cls: 'primary', value: true }] });
    if (!v) return;
    W.run.stop = true; pvz.stop(); pvz.ozonStop();
  }
  closeSiteView();
  document.body.dataset.mode = 'welcome'; $('welcome').classList.remove('leave');
  pvz.nav('welcome');
}
window.openWizard = async function () {
  const c = await pvz.getCfg();
  if (c.wizard) { Object.assign(W, { sources: c.wizard.sources || W.sources, checks: c.wizard.checks || W.checks, params: Object.assign({}, DEF_PARAMS, c.wizard.params || {}), avitoUrl: c.wizard.avitoUrl || null, orders: c.wizard.orders || {}, scenario: c.wizard.scenario || '' }); }
  W.step = 0; W.run = null; closeSiteView();
  document.body.dataset.mode = 'wizard'; pvz.siteRect(null);
  render(); $('wzStep').classList.add('enter');
};
$('startBtn').onclick = () => { $('welcome').classList.add('leave'); setTimeout(() => window.openWizard(), 320); };
$('wzHome').onclick = goHome;
})();
