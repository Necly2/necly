const $ = id => document.getElementById(id);
function showPath(id, p) { $(id).textContent = p || ''; $(id).title = p || ''; }
const F = ['pages', 'delay', 'days', 'part'];
const NAMES = { avito: 'Авито', cian: 'Циан', winner: 'Baza Winner', ozon: 'Проверка Ozon' };
const lastDirs = {};
let running = false;      // идёт выгрузка с сайта
let ozonBusy = false;     // идёт проверка Ozon
let ozFiles = [];
const exportStatus = { text: 'Готово к работе.', kind: '' }, ozonStatusMsg = { text: 'Нажмите «Проверить на Ozon» — проверятся новые выгрузки.', kind: '' };

// ---------- старт ----------
async function init() {
  const c = await pvz.getCfg();
  F.forEach(k => ($(k).value = c[k]));
  showPath('root', c.root);
  showPath('cianRoot', c.cianRoot);
  showPath('ozonOut', c.ozonOut);
  $('ozonAuto').checked = c.ozonAuto !== false;
  $('ozonCache').checked = c.ozonCache !== false;
  $('ozonDays').value = c.ozonDays; $('ozonThreads').value = c.ozonThreads; $('ozonPause').value = c.ozonPause;
  const st = await pvz.ozonState(); ozonBusy = st.running; refreshRunUI();
  $('cianOnlyNew').checked = c.cianOnlyNew !== false;
  if (c.lastSite && NAMES[c.lastSite]) $('lastHint').textContent = '· в прошлый раз: ' + NAMES[c.lastSite];
}
init();
pvz.version().then(v => document.querySelectorAll('.ver').forEach(e => (e.textContent = v)));
document.querySelectorAll('.upd').forEach(a => (a.onclick = e => { e.preventDefault(); pvz.checkUpdate(); }));

// ---------- выбор сайта ----------
function setSite(site) {
  document.body.dataset.site = site || 'none';
  $('siteName').textContent = NAMES[site] || '—';
  refreshRunUI();
  if (site === 'ozon') rescan();
}
function openSite(site) {
  if (running) return;
  if (site === 'order') { openOrder(); return; }
  document.body.dataset.mode = 'work';
  setSite(site);
  pvz.nav(site);
  if (site !== 'ozon') pvz.setCfg({ lastSite: site });
}
document.querySelectorAll('[data-go]').forEach(b => (b.onclick = () => openSite(b.dataset.go)));
$('home').onclick = () => { if (running) return; document.body.dataset.mode = 'welcome'; pvz.nav('welcome'); };
$('ozonMini').onclick = () => openSite('ozon');
document.addEventListener('keydown', e => {
  if (document.body.dataset.mode !== 'welcome') return;
  const k = { '1': 'winner', '2': 'order', '3': 'ozon' }[e.key]; if (k) openSite(k);
});

$('back').onclick = () => pvz.nav('back');
$('reload').onclick = () => pvz.nav('reload');

// ---------- папки и настройки ----------
$('pick').onclick = async () => { const c = await pvz.pickFolder('avito'); showPath('root', c.root); };
$('pickC').onclick = async () => { const c = await pvz.pickFolder('cian'); showPath('cianRoot', c.cianRoot); };
$('open').onclick = () => pvz.openFolder(lastDirs[document.body.dataset.site] || $('root').title);
$('openC').onclick = () => pvz.openFolder(lastDirs.cian || $('cianRoot').title);
$('cianOnlyNew').onchange = () => pvz.setCfg({ cianOnlyNew: $('cianOnlyNew').checked });
$('pickO').onclick = async () => { const c = await pvz.pickFolder('ozon'); showPath('ozonOut', c.ozonOut); rescan(); };
$('openO').onclick = () => pvz.openFolder(lastDirs.ozon || $('ozonOut').title);
$('ozonAuto').onchange = () => pvz.setCfg({ ozonAuto: $('ozonAuto').checked });
$('ozonCache').onchange = () => pvz.setCfg({ ozonCache: $('ozonCache').checked });
$('ozClear').onclick = async () => { const n = await pvz.ozonClearCache(); $('ozClearMsg').textContent = n ? `забыто адресов: ${n}` : 'память пуста'; };
['ozonDays', 'ozonThreads', 'ozonPause'].forEach(id => ($(id).onchange = () => {
  const v = Math.max(1, parseInt($(id).value, 10) || 1); $(id).value = v; pvz.setCfg({ [id]: v }); if (id === 'ozonDays') rescan();
}));
$('ozRescan').onclick = () => rescan();

// ---------- Ozon: список новых выгрузок ----------
const esc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
async function rescan() {
  const r = await pvz.ozonScan();
  ozFiles = r.files;
  $('ozCount').textContent = ozFiles.length ? ozFiles.length + ' шт.' : '';
  $('ozFiles').innerHTML = ozFiles.length
    ? ozFiles.map(f => `<div class="file${f.partial ? ' partial' : ''}" title="${esc(f.path)}"><b>${esc(f.name)}</b><span>${f.partial ? 'дозапуск' : esc(f.folder)}</span></div>`).join('')
    : '<div class="hint">Новых выгрузок нет — всё проверено.</div>';
  refreshRunUI();
}

// ---------- Winner: текущий заказ ----------
let bwGuid = null;
async function refreshBw() {
  const o = await pvz.bwOrder();
  if (!o) { bwGuid = null; $('bwName').textContent = 'Заказ не открыт'; return; }
  if (o.guid === bwGuid) return;
  bwGuid = o.guid;
  $('bwName').textContent = (o.name || 'Заказ') + ' · ' + o.guid.slice(0, 8) + '…';
  $('bwTag').value = o.tag || '';
  $('bwHide').checked = !!o.hide;
}

pvz.onUrl(u => {
  $('url').textContent = u; $('url').title = u;
  const site = /avito\.ru/.test(u) ? 'avito' : /cian\.ru/.test(u) ? 'cian' : /baza-winner\.ru/.test(u) ? 'winner' : null;
  if (site && document.body.dataset.mode === 'work' && !isOzonSite()) setSite(site);
  refreshBw();
});

// ---------- статус и прогресс ----------
const box = $('statusBox'), fill = $('barFill');
const isOzonSite = () => document.body.dataset.site === 'ozon';
function paint(msg, prog) {
  $('status').textContent = msg.text;
  box.classList.toggle('err', msg.kind === 'err');
  box.classList.toggle('done', msg.kind === 'done');
  const bar = fill.parentElement;
  let m = prog && prog.total ? [0, prog.done, prog.total] : msg.text.match(/(?:страница|Порция|Проверено)\s+(\d+)\s+из\s+(?:максимум\s+)?(\d+)/i);
  if (m && +m[2] > 0) { bar.classList.remove('ind'); fill.style.width = Math.min(100, Math.round(+m[1] / +m[2] * 100)) + '%'; fill.style.transform = 'none'; }
  else { bar.classList.add('ind'); fill.style.width = '30%'; fill.style.transform = ''; }
}
function setStatus(text, kind) { exportStatus.text = text; exportStatus.kind = kind || ''; if (!isOzonSite()) paint(exportStatus); }
let ozonProg = null;
function setOzon(text, kind, prog) { ozonStatusMsg.text = text; ozonStatusMsg.kind = kind || ''; ozonProg = prog || null; if (isOzonSite()) paint(ozonStatusMsg, ozonProg); }
function refreshRunUI() {
  const oz = isOzonSite();
  const busy = oz ? ozonBusy : running;
  $('work').classList.toggle('running', busy);
  $('go').disabled = busy || (oz && !ozFiles.length && !ozonBusy);
  $('goText').textContent = oz ? (ozonBusy ? 'Идёт проверка…' : 'Проверить на Ozon' + (ozFiles.length ? ` (${ozFiles.length})` : '')) : (running ? 'Идёт выгрузка…' : 'Выгрузить');
  $('stop').textContent = oz ? 'Остановить проверку' : 'Остановить и сохранить';
  paint(oz ? ozonStatusMsg : exportStatus, oz ? ozonProg : null);
  $('ozonMini').classList.toggle('on', ozonBusy && !oz);
}
pvz.onStatus(s => running && setStatus(s));
pvz.onOzonStatus(s => {
  ozonBusy = true;
  setOzon(s.text, '', s.total ? { done: s.done || 0, total: s.total } : null);
  $('ozonMini').textContent = 'Ozon: ' + s.text.split('\n')[0];
  refreshRunUI();
});
pvz.onOzonDone(r => {
  ozonBusy = false;
  if (!r.ok) { setOzon('Ошибка проверки Ozon: ' + r.error, 'err'); refreshRunUI(); rescan(); return; }
  const z = r.stats;
  let t = `Ozon — ${r.reason}.\nФайлов: ${r.files}, адресов: ${r.addresses}.\n` +
    `Подходящих: зелёных ≥ 49 м² ${z['зелёный']}, синих ${z['синий']}, голубых ${z['голубой']}, < 3 млн ${z['гарантия < 3 млн']}, ошибка запроса ${z['ошибка запроса']}.\n` +
    `Не подошли: вне зоны/недоступно ${z.out_zone}, зелёных < 49 м² ${z.green_small}` + (z.unchecked ? `; не проверено ${z.unchecked}` : '') + '.';
  if (r.saved.length) { t += `\n\nФайлы (${r.saved.length}):\n` + r.saved.map(f => '• ' + f.split(/[\\/]/).pop()).join('\n'); lastDirs.ozon = r.saved[0].replace(/[\\/][^\\/]+$/, ''); }
  if (r.manual.length) t += `\n\nПроверить вручную (${r.manual.length}):\n` + r.manual.slice(0, 15).map(x => '• ' + x).join('\n');
  if (r.odd.length) t += `\n\nСтранные цены (${r.odd.length}):\n` + r.odd.slice(0, 10).map(x => '• ' + x).join('\n');
  if (r.errors.length) t += '\n\nОшибки чтения:\n' + r.errors.map(x => '• ' + x).join('\n');
  setOzon(t, z.unchecked || r.errors.length ? 'err' : 'done');
  $('ozonMini').textContent = 'Ozon: ' + r.reason + ' — нажмите, чтобы посмотреть';
  $('ozonMini').classList.toggle('on', !isOzonSite());
  refreshRunUI(); rescan();
});

$('stop').onclick = () => {
  if (isOzonSite()) { pvz.ozonStop(); setOzon('Останавливаю проверку — проверенное сохранится…'); return; }
  pvz.stop(); setStatus('Останавливаю…');
};

$('go').onclick = async () => {
  if (isOzonSite()) {
    if (ozonBusy || !ozFiles.length) return;
    ozonBusy = true; setOzon('Запуск проверки…'); refreshRunUI();
    const r = await pvz.ozonStart(ozFiles.map(f => f.path));
    if (!r.ok) { ozonBusy = false; setOzon('Ошибка: ' + r.error, 'err'); refreshRunUI(); }
    return;
  }
  if (running) return;
  const { r, text } = await runExport();
  setStatus(text, !r.ok || /ошибк/i.test(r.reason || '') ? 'err' : 'done');
};

// выгрузка с открытого сайта; extra — переопределения настроек (например, свежесть из формы заказа)
async function runExport(extra) {
  await refreshBw();
  const c = {};
  F.forEach(k => (c[k] = Math.max(0, parseInt($(k).value, 10) || 0)));
  if (c.delay < 3) { c.delay = 3; $('delay').value = 3; }
  if (!c.pages) c.pages = 1;
  if (!c.part) c.part = 300;
  if (bwGuid) c.bw = { tag: $('bwTag').value.trim(), hide: $('bwHide').checked };
  Object.assign(c, extra || {});
  running = true; refreshRunUI();
  setStatus('Запуск…');
  const r = await pvz.start(c);
  running = false; refreshRunUI();
  if (!r.ok) return { r, text: 'Ошибка: ' + r.error };
  if (r.dir) lastDirs[r.site] = r.dir;
  let t = `${NAMES[r.site] || ''} — ${r.reason}.\nОбъявлений: ${r.total}` + (r.site !== 'winner' ? `, с координатами: ${r.withCoords}.` : '.');
  if (r.extra) t += '\n' + r.extra;
  t += r.saved.length ? `\n\nСохранено файлов: ${r.saved.length}\n` + r.saved.map(f => '• ' + f.split(/[\\/]/).pop()).join('\n') : '\nНичего не сохранено.';
  if (r.site !== 'winner' && r.total && r.withCoords < r.total * 0.8) t += '\n⚠ Координаты не у всех объявлений — сообщите Claude.';
  if (r.ozonQueued) t += `\n\n→ Отправлено на проверку Ozon: ${r.ozonQueued} файл(ов). Ход — во вкладке «Ozon».`;
  return { r, text: t };
}


// ================= Циан и Авито: параметры заказа в программе =================
const TYPES = [
  { k: 'shop', name: 'Торговая площадь', cian: 2 },
  { k: 'psn', name: 'Свободного назначения', cian: 5 },
  { k: 'food', name: 'Общепит', cian: 4 },
  { k: 'serv', name: 'Бытовые услуги', cian: 12 },
  { k: 'office', name: 'Офис', cian: 1 },
  { k: 'store', name: 'Склад', cian: 3 }
];
const DEFAULT_PRESETS = {
  'Заказ #4 (Москва)': { cian: true, avito: true, region: 'msk', types: ['shop', 'psn', 'food', 'serv'], areaFrom: 24, areaTo: 130, priceFrom: '', priceTo: '', floor1: true, floorsFrom: 3, days: 7 },
  'Заказ #5 (Москва и МО, до 120 тыс.)': { cian: true, avito: true, region: 'msk_mo', types: ['shop', 'psn', 'food', 'serv'], areaFrom: 24, areaTo: 130, priceFrom: '', priceTo: 120000, floor1: true, floorsFrom: 3, days: 7 }
};
let presets = {}, curAvitoUrl = null;
$('oTypes').innerHTML = TYPES.map(t => `<label><input type="checkbox" value="${t.k}"><span>${t.name}</span></label>`).join('');

const val = id => { const v = $(id).value.trim(); return v === '' ? '' : Math.max(0, +v || 0); };
function readForm() {
  return {
    cian: $('oCian').checked, avito: $('oAvito').checked,
    region: $('oRegion').querySelector('.on').dataset.v,
    types: [...$('oTypes').querySelectorAll('input:checked')].map(i => i.value),
    areaFrom: val('oAreaFrom'), areaTo: val('oAreaTo'), priceFrom: val('oPriceFrom'), priceTo: val('oPriceTo'),
    floor1: $('oFloor1').checked, floorsFrom: val('oFloorsFrom'), days: val('oDays'),
    avitoUrl: curAvitoUrl || null
  };
}
function fillForm(p) {
  $('oCian').checked = p.cian !== false; $('oAvito').checked = p.avito !== false;
  $('oRegion').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.v === (p.region || 'msk')));
  $('oTypes').querySelectorAll('input').forEach(i => (i.checked = (p.types || []).includes(i.value)));
  $('oAreaFrom').value = p.areaFrom ?? ''; $('oAreaTo').value = p.areaTo ?? '';
  $('oPriceFrom').value = p.priceFrom ?? ''; $('oPriceTo').value = p.priceTo ?? '';
  $('oFloor1').checked = !!p.floor1; $('oFloorsFrom').value = p.floorsFrom ?? ''; $('oDays').value = p.days ?? 7;
  curAvitoUrl = p.avitoUrl || null;
  renderNotice();
}
function fillSelect(sel) {
  $('pSelect').innerHTML = '<option value="">— новый —</option>' + Object.keys(presets).map(n => `<option>${esc(n)}</option>`).join('');
  $('pSelect').value = sel || '';
}
async function openOrder() {
  const c = await pvz.getCfg();
  presets = c.presets && Object.keys(c.presets).length ? c.presets : JSON.parse(JSON.stringify(DEFAULT_PRESETS));
  const last = c.lastPreset && presets[c.lastPreset] ? c.lastPreset : Object.keys(presets)[0];
  fillSelect(last); $('pName').value = last || '';
  fillForm(last ? presets[last] : DEFAULT_PRESETS['Заказ #4 (Москва)']);
  document.body.dataset.mode = 'order';
  pvz.nav('welcome');
}
$('pSelect').onchange = () => { const n = $('pSelect').value; $('pName').value = n; if (n) fillForm(presets[n]); pvz.setCfg({ lastPreset: n }); };
$('pSave').onclick = () => {
  const n = $('pName').value.trim();
  if (!n) { $('pMsg').textContent = 'введите название'; return; }
  presets[n] = readForm(); pvz.setCfg({ presets, lastPreset: n }); fillSelect(n);
  $('pMsg').textContent = 'сохранено ✓'; setTimeout(() => ($('pMsg').textContent = ''), 2500);
};
$('pDel').onclick = () => {
  const n = $('pSelect').value; if (!n) return;
  delete presets[n]; pvz.setCfg({ presets }); fillSelect(''); $('pName').value = ''; $('pMsg').textContent = 'удалено';
};
$('oRegion').querySelectorAll('button').forEach(b => (b.onclick = () => { $('oRegion').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); renderNotice(); }));
document.querySelectorAll('#order input').forEach(i => i.addEventListener('change', renderNotice));
['oBack', 'oCancel'].forEach(id => ($(id).onclick = () => { document.body.dataset.mode = 'welcome'; }));

// что программа сделает сама, а что придётся ввести вручную
function avitoManual(p) {
  const m = [];
  if (p.types.length) m.push('Вид объекта: ' + p.types.map(k => TYPES.find(t => t.k === k).name).join(', '));
  if (p.areaFrom !== '' || p.areaTo !== '') m.push(`Площадь: ${p.areaFrom !== '' ? 'от ' + p.areaFrom : ''} ${p.areaTo !== '' ? 'до ' + p.areaTo : ''} м²`.replace(/\s+/g, ' '));
  return m;
}
function renderNotice() {
  const p = readForm(), warn = [], info = [];
  if (!p.cian && !p.avito) warn.push('Не выбран ни один сайт.');
  if (!p.types.length) warn.push('Не выбран вид помещения — будут все виды коммерческой аренды.');
  if (p.avito) {
    if (p.avitoUrl) info.push('Авито: используются фильтры, сохранённые в пресете (вид объекта, площадь). Если поменяли их в форме — нажмите «Забыть фильтры Авито» и выставьте заново.');
    else {
      const m = avitoManual(p);
      if (m.length) warn.push('<b>Авито — нужно ввести вручную на сайте</b> (Авито не даёт задать это из программы):<ul>' + m.map(x => '<li>' + esc(x) + '</li>').join('') + '</ul>Регион, цену и сортировку по дате программа подставит сама. После ввода нажмите «Готово — выгружать». Если сохраните пресет — в следующий раз вводить не придётся.');
    }
    if (p.floor1 || p.floorsFrom !== '') info.push('Авито: в выдаче нет этажа и этажности дома — эти условия на Авито не применяются.');
  }
  if (p.cian) {
    info.push('Циан: все параметры задаются автоматически' + (p.region === 'msk_mo' ? '; «Москва и МО» — два поиска подряд (Москва, затем область).' : '.'));
  }
  if (p.days !== '' && p.days > 0) info.push(`Свежесть: объявления старше ${p.days} дн. отбрасываются программой.`);
  $('oNotice').innerHTML = warn.map(x => `<div class="note warn">${x}</div>`).join('') +
    (info.length ? `<div class="note info"><b>К сведению</b><ul>${info.map(x => '<li>' + x + '</li>').join('')}</ul></div>` : '');
  $('oAvitoState').innerHTML = p.avito ? (p.avitoUrl
    ? '<span class="ok">✓ Фильтры Авито сохранены в пресете.</span> <a id="oForgetAvito">Забыть фильтры Авито</a>'
    : 'Фильтры Авито (вид объекта, площадь) не сохранены — при запуске нужно будет выставить их на сайте один раз.') : '';
  const fa = document.getElementById('oForgetAvito'); if (fa) fa.onclick = () => { curAvitoUrl = null; renderNotice(); };
}

function cianUrl(p, region) {
  const u = new URL('https://www.cian.ru/cat.php');
  const q = u.searchParams;
  q.set('deal_type', 'rent'); q.set('engine_version', '2'); q.set('offer_type', 'offices');
  TYPES.filter(t => p.types.includes(t.k)).forEach((t, i) => q.set(`office_type[${i}]`, t.cian));
  q.set('region', region);
  if (p.areaFrom !== '') q.set('minarea', p.areaFrom); if (p.areaTo !== '') q.set('maxarea', p.areaTo);
  if (p.priceFrom !== '') q.set('minprice', p.priceFrom); if (p.priceTo !== '') q.set('maxprice', p.priceTo);
  if (p.floor1) { q.set('minfloor', 1); q.set('maxfloor', 1); }
  if (p.floorsFrom !== '') q.set('minfloorn', p.floorsFrom);
  q.set('sort', 'creation_date_desc');
  return u.href;
}
function avitoUrl(p) {
  const u = new URL(`https://www.avito.ru/${p.region === 'msk_mo' ? 'moskva_i_mo' : 'moskva'}/kommercheskaya_nedvizhimost/sdam-ASgBAgICAUSwCNRW`);
  if (p.priceFrom !== '') u.searchParams.set('pmin', p.priceFrom); if (p.priceTo !== '') u.searchParams.set('pmax', p.priceTo);
  u.searchParams.set('s', '104');   // сортировка по дате
  return u.href;
}

// ожидание ручного ввода на сайте (баннер в панели)
function waitManual(lines, hint) {
  $('manualList').innerHTML = lines.map(x => '<li>' + esc(x) + '</li>').join('');
  $('manualHint').textContent = hint || '';
  $('manual').classList.add('on');
  return new Promise(res => {
    $('manualOk').onclick = () => { $('manual').classList.remove('on'); res(true); };
    $('manualSkip').onclick = () => { $('manual').classList.remove('on'); res(false); };
  });
}

$('oRun').onclick = async () => {
  const p = readForm();
  if (!p.cian && !p.avito) { renderNotice(); return; }
  const presetName = $('pSelect').value || null;
  const extra = { days: p.days === '' ? 0 : p.days };
  const report = [];
  document.body.dataset.mode = 'work';
  if (p.cian) {
    for (const reg of (p.region === 'msk_mo' ? ['1', '4593'] : ['1'])) {
      setSite('cian'); setStatus(`Открываю Циан (${reg === '1' ? 'Москва' : 'Московская область'})…`);
      await pvz.navUrl('cian', cianUrl(p, reg));
      const { r, text } = await runExport(extra);
      report.push(`Циан ${reg === '1' ? '(Москва)' : '(МО)'}: ` + (r.ok ? `${r.total} объявл., файлов ${r.saved.length}` : 'ошибка — ' + r.error));
      setStatus(text, r.ok ? 'done' : 'err');
      if (!r.ok || /остановлено вручную/.test(r.reason || '')) break;
    }
  }
  if (p.avito) {
    setSite('avito'); setStatus('Открываю Авито…');
    await pvz.navUrl('avito', p.avitoUrl || avitoUrl(p));
    let go = true;
    const m = p.avitoUrl ? [] : avitoManual(p);
    if (m.length) {
      setStatus('Ждём, пока вы выставите фильтры на Авито…');
      go = await waitManual(m, presetName ? `Фильтры запомнятся в пресете «${presetName}» — в следующий раз вводить не придётся.` : 'Сохраните пресет в форме, чтобы в следующий раз не вводить это заново.');
      if (go && presetName) {
        const u = await pvz.currentUrl();
        if (/avito\.ru/.test(u)) { presets[presetName] = Object.assign({}, presets[presetName] || p, { avitoUrl: u }); pvz.setCfg({ presets }); }
      }
    }
    if (go) {
      const { r, text } = await runExport(extra);
      report.push('Авито: ' + (r.ok ? `${r.total} объявл., файлов ${r.saved.length}` : 'ошибка — ' + r.error));
      setStatus(text, r.ok ? 'done' : 'err');
    } else report.push('Авито: пропущено');
  }
  setStatus('Итог по заказу' + (presetName ? ` «${presetName}»` : '') + ':\n' + report.map(x => '• ' + x).join('\n') +
    (exportStatus.text.includes('Ozon') ? '\n\n→ Новые файлы отправлены на проверку Ozon.' : ''), 'done');
};
