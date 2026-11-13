const $ = id => document.getElementById(id);
// ---------- числа с разделителями разрядов: 100000 → «100 000» ----------
const fmtNum = n => (n === '' || n == null || isNaN(n)) ? '' : Number(n).toLocaleString('ru-RU').replace(/[  ]/g, ' ');
const numOf = el => { const v = String(el.value).replace(/\D/g, ''); return v === '' ? '' : +v; };
const setNum = (el, v) => { el.value = v === '' || v == null ? '' : fmtNum(v); };
document.addEventListener('input', e => {
  const el = e.target; if (!el.classList || !el.classList.contains('num')) return;
  const pos = el.selectionStart, digitsBefore = el.value.slice(0, pos).replace(/\D/g, '').length;
  const raw = el.value.replace(/\D/g, '').replace(/^0+(?=\d)/, '');
  el.value = raw === '' ? '' : fmtNum(+raw);
  let i = 0, seen = 0; while (i < el.value.length && seen < digitsBefore) { if (/\d/.test(el.value[i])) seen++; i++; }
  el.setSelectionRange(i, i);
});
// числа в тексте статусов: «Проверено 1234 из 12000» → «1 234 из 12 000» (даты, координаты, имена файлов не трогаем)
const prettyNums = t => String(t).replace(/(?<![\d.,:\/\-\w])(\d{4,})(?![\d.,:\/\-\w])/g, m => fmtNum(+m));

function showPath(id, p) { $(id).textContent = p || ''; $(id).title = p || ''; }
const F = ['pages', 'delay', 'days', 'part'];
const NAMES = { avito: 'Авито', cian: 'Циан', winner: 'Baza Winner', ozon: 'Проверка зон' };
const lastDirs = {};
let running = false;      // идёт выгрузка с сайта
let ozonBusy = false;     // идёт проверка Ozon
let ozFiles = [];
const exportStatus = { text: 'Готово к работе.', kind: '' }, ozonStatusMsg = { text: 'Выберите площадки и нажмите «Проверить зоны» — проверятся новые выгрузки.', kind: '' };

// ---------- старт ----------
async function init() {
  const c = await pvz.getCfg();
  F.forEach(k => setNum($(k), c[k]));
  showPath('root', c.root);
  showPath('cianRoot', c.cianRoot);
  showPath('ozonOut', c.ozonOut);
  $('ozonAuto').checked = c.ozonAuto !== false;
  $('ozonCache').checked = c.ozonCache !== false;
  $('chkOzon').checked = c.chkOzon !== false; $('chkYandex').checked = !!c.chkYandex; $('chkWb').checked = !!c.chkWb;
  setNum($('ozonDays'), c.ozonDays); setNum($('ozonThreads'), c.ozonThreads); setNum($('ozonPause'), c.ozonPause);
  const st = await pvz.ozonState(); ozonBusy = st.running; refreshRunUI();
  $('cianOnlyNew').checked = c.cianOnlyNew !== false;
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
  if (site === 'order') { window.openWizard && window.openWizard(); return; }
  document.body.dataset.mode = 'work';
  setSite(site);
  pvz.nav(site);
  if (site !== 'ozon') pvz.setCfg({ lastSite: site });
}
document.querySelectorAll('[data-go]').forEach(b => (b.onclick = () => openSite(b.dataset.go)));
$('home').onclick = () => { if (running) return; document.body.dataset.mode = 'welcome'; pvz.nav('welcome'); };
$('ozonMini').onclick = () => openSite('ozon');


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
  const v = Math.max(1, numOf($(id)) || 1); setNum($(id), v); pvz.setCfg({ [id]: v }); if (id === 'ozonDays') rescan();
}));
$('ozRescan').onclick = () => rescan();
['chkOzon', 'chkYandex', 'chkWb'].forEach(id => ($(id).onchange = () => { pvz.setCfg({ [id]: $(id).checked }); setTimeout(rescan, 100); }));

// ---------- Ozon: список новых выгрузок ----------
const esc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
async function rescan() {
  const r = await pvz.ozonScan();
  ozFiles = r.files;
  $('ozCount').textContent = ozFiles.length ? ozFiles.length + ' шт.' : '';
  $('ozFiles').innerHTML = ozFiles.length
    ? ozFiles.map(f => `<div class="file${f.partial ? ' partial' : ''}" title="${esc(f.path)}"><b>${esc(f.name)}</b><span>${f.partial ? 'дозапуск' : esc(f.folder)}<span class="pf">${(f.platforms || []).map(p => ({ ozon: 'O', yandex: 'Я', wb: 'WB' })[p]).join(' ')}</span></span></div>`).join('')
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
  $('status').textContent = prettyNums(msg.text);
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
  $('goText').textContent = oz ? (ozonBusy ? 'Идёт проверка…' : 'Проверить зоны' + (ozFiles.length ? ` (${ozFiles.length})` : '')) : (running ? 'Идёт выгрузка…' : 'Выгрузить');
  $('stop').textContent = oz ? 'Остановить проверку' : 'Остановить и сохранить';
  paint(oz ? ozonStatusMsg : exportStatus, oz ? ozonProg : null);
  $('ozonMini').classList.toggle('on', ozonBusy && !oz);
}
pvz.onStatus(s => running && setStatus(s));
pvz.onOzonStatus(s => {
  ozonBusy = true;
  setOzon(s.text, '', s.total ? { done: s.done || 0, total: s.total } : null);
  $('ozonMini').textContent = 'Проверка: ' + prettyNums(s.text.split('\n')[0]);
  refreshRunUI();
});
function ozonText(r) {
  const z = r.stats;
  let t = `Ozon — ${r.reason}. Файлов: ${r.files}, адресов: ${r.addresses}.\n` +
    `Подходящих: зелёных ≥ ${r.greenMin || 60} м² ${z['зелёный']}, синих ${z['синий']}, голубых ${z['голубой']}, < 3 млн ${z['гарантия < 3 млн']}, ошибка запроса ${z['ошибка запроса']}.\n` +
    `Не подошли: вне зоны/недоступно ${z.out_zone}, зелёных < ${r.greenMin || 60} м² ${z.green_small}` + (z.unchecked ? `; не проверено ${z.unchecked}` : '') + '.';
  if (r.odd && r.odd.length) t += `\nСтранные цены (${r.odd.length}): ` + r.odd.slice(0, 5).join('; ');
  return t;
}
function platformText(r) {
  const parts = Object.entries(r.stats || {}).map(([k, v]) => `${k}: ${v}`);
  return `${r.label} — ${r.reason}. Файлов: ${r.files}, адресов: ${r.addresses}.\n` +
    `В «Результат»: ${r.main}` + (parts.length ? ` (${parts.join('; ')})` : '') + `; в «Исключённые»: ${r.excluded}` + (r.unchecked ? `; не проверено ${r.unchecked}` : '') + '.';
}
pvz.onOzonDone(res => {
  ozonBusy = false;
  if (!res.ok) { setOzon('Ошибка проверки: ' + res.error, 'err'); refreshRunUI(); rescan(); return; }
  if (!res.results.length) { setOzon('Новых файлов для выбранных площадок нет.', 'done'); refreshRunUI(); rescan(); return; }
  let bad = false; const saved = [], manual = [], errors = [];
  const blocks = res.results.map(r => {
    if (r.unchecked || (r.errors && r.errors.length) || /ограничил|не ответила/.test(r.reason)) bad = true;
    saved.push(...(r.saved || [])); manual.push(...(r.manual || []).map(x => `[${r.label}] ${x}`)); errors.push(...(r.errors || []));
    return r.kind === 'ozon' ? ozonText(r) : platformText(r);
  });
  let t = blocks.join('\n\n');
  if (saved.length) { t += `\n\nФайлы (${saved.length}):\n` + saved.map(f => '• ' + f.split(/[\\/]/).pop()).join('\n'); lastDirs.ozon = saved[0].replace(/[\\/][^\\/]+$/, ''); }
  if (manual.length) t += `\n\nПроверить вручную (${manual.length}):\n` + manual.slice(0, 15).map(x => '• ' + x).join('\n');
  if (errors.length) t += '\n\nОшибки чтения:\n' + errors.map(x => '• ' + x).join('\n');
  setOzon(t, bad ? 'err' : 'done');
  $('ozonMini').textContent = 'Проверка зон: готово — нажмите, чтобы посмотреть';
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
  F.forEach(k => (c[k] = Math.max(0, numOf($(k)) || 0)));
  if (c.delay < 3) { c.delay = 3; setNum($('delay'), 3); }
  if (!c.pages) c.pages = 1;
  if (!c.part) c.part = 300;
  if (bwGuid) {
    const nm = ($('bwName').textContent || '').split(' · ')[0];
    c.bw = { tag: $('bwTag').value.trim(), hide: $('bwHide').checked, name: nm };
    c.title = nm;
  }
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
let presets = {};

// что программа сделает сама, а что придётся ввести вручную
function avitoManual(p) {
  const m = [];
  if (p.types.length) m.push('Вид объекта: ' + p.types.map(k => TYPES.find(t => t.k === k).name).join(', '));
  if (p.areaFrom !== '' || p.areaTo !== '') m.push(`Площадь: ${p.areaFrom !== '' ? 'от ' + fmtNum(p.areaFrom) : ''} ${p.areaTo !== '' ? 'до ' + fmtNum(p.areaTo) : ''} м²`.replace(/\s+/g, ' '));
  if (p.floor1) m.push('Этаж: «Только первый», «Не подвал», «Не цоколь» (блок «Этаж» появляется после выбора вида объекта)');
  return m;
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

async function runOrder(p, presetName, opt = {}) {
  const extra = { days: p.days === '' ? 0 : p.days, forceCheck: !!opt.forceCheck };
  const report = [];
  document.body.dataset.mode = 'work';
  if (p.cian) {
    for (const reg of (p.region === 'msk_mo' ? ['1', '4593'] : ['1'])) {
      setSite('cian'); setStatus(`Открываю Циан (${reg === '1' ? 'Москва' : 'Московская область'})…`);
      await pvz.navUrl('cian', cianUrl(p, reg));
      const { r, text } = await runExport(Object.assign({ title: (presetName || 'Циан') + (reg === '1' ? ' · Москва' : ' · МО') }, extra));
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
    if (m.length && opt.unattended) { go = false; report.push('Авито: пропущено — фильтры (' + m.map(x => x.split(':')[0]).join(', ') + ') не сохранены в пресете'); }
    else if (m.length) {
      setStatus('Ждём, пока вы выставите фильтры на Авито…');
      go = await waitManual(m, presetName ? `Фильтры запомнятся в пресете «${presetName}» — в следующий раз вводить не придётся.` : 'Сохраните пресет в форме, чтобы в следующий раз не вводить это заново.');
      if (go && presetName) {
        const u = await pvz.currentUrl();
        if (/avito\.ru/.test(u)) { presets[presetName] = Object.assign({}, presets[presetName] || p, { avitoUrl: u }); pvz.setCfg({ presets }); }
      }
    }
    if (go) {
      const { r, text } = await runExport(Object.assign({ title: (presetName || 'Авито') }, extra));
      report.push('Авито: ' + (r.ok ? `${r.total} объявл., файлов ${r.saved.length}` : 'ошибка — ' + r.error));
      setStatus(text, r.ok ? 'done' : 'err');
    } else if (!opt.unattended) report.push('Авито: пропущено');
  }
  const summary = 'Итог по заказу' + (presetName ? ` «${presetName}»` : '') + ':\n' + report.map(x => '• ' + x).join('\n');
  setStatus(summary + (exportStatus.text.includes('Ozon') ? '\n\n→ Новые файлы отправлены на проверку зон.' : ''), 'done');
  return report;
}



// ================= страницы: Результаты, История, Расписание =================
function openPage(page) {
  document.body.dataset.mode = page;
  pvz.nav('welcome');
  if (page === 'results') loadResults();
  if (page === 'history') loadHistory();
  if (page === 'schedule') loadSchedule();
  if (page === 'settings') window.loadSettings && loadSettings();
}
document.querySelectorAll('[data-page]').forEach(el => (el.onclick = e => { e.preventDefault(); if (el.dataset.page === 'watch') { window.openWatch && openWatch(); return; } openPage(el.dataset.page); }));
// при возврате на главный экран центр всегда видим (раньше оставался класс анимации ухода — кнопки пропадали)
new MutationObserver(() => { if (document.body.dataset.mode === 'welcome') $('welcome').classList.remove('leave'); }).observe(document.body, { attributes: true, attributeFilter: ['data-mode'] });
document.querySelectorAll('.back-home').forEach(b => (b.onclick = () => { document.body.dataset.mode = 'welcome'; }));
pvz.onOpenPage(p => openPage(p));
window.addEventListener('error', e => pvz.logError('интерфейс', `${e.message} @ ${String(e.filename).split('/').pop()}:${e.lineno}`));
window.addEventListener('unhandledrejection', e => pvz.logError('интерфейс', String(e.reason && (e.reason.stack || e.reason.message) || e.reason)));
const fmtTime = t => { const d = new Date(t); return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' }) + ' ' + d.toTimeString().slice(0, 5); };

// ---------- Результаты ----------
const R = { rows: [], sort: { k: 'checked', dir: -1 }, map: null, layer: null, markers: new Map(), sel: null, list: [], day: 'all', up: 'all', marks: {}, seen: {}, watch: {}, dedup: true, onlyNew: false, onlyMatch: false };
const dayKey = t => { const d = new Date(t); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const markKey = x => x.url || (x.platform + '|' + x.address);
// одинаковые помещения: тот же адрес и та же площадь в один день (в рамках выгрузки и между выгрузками)
const normAddr = a => String(a || '').toLowerCase().replace(/ё/g, 'е').replace(/^\s*(россия|москва|г\.? ?москва)[, ]+/g, '').replace(/(улица|ул\.?|проспект|пр-т|переулок|пер\.?|шоссе|ш\.?|дом|д\.?)(?=[\s,]|$)/g, '').replace(/[^0-9a-zа-я/]+/g, '');
const dupKey = x => x.platform + '|' + dayKey(x.checked) + '|' + normAddr(x.address) + '|' + (x.areaMin ?? '');
const matchKey = x => normAddr(x.address) + '|' + (x.areaMin ?? '');
const upKey = x => x.file.replace(/^(OZON|ЯНДЕКС|WB) /i, '');
function renderDays() {
  const cnt = {}; let marked = 0, watched = 0, unseen = 0, matched = 0;
  for (const x of R.rows) { if (x.dupHidden && R.dedup) continue; const k = dayKey(x.checked); cnt[k] = (cnt[k] || 0) + 1; if (x.mark) marked++; if (!R.seen[markKey(x)]) unseen++; if (x.also && x.also.length) matched++; }
  watched = Object.keys(R.watch).length;
  const days = [];
  for (let i = 0; i < 5; i++) { const d = new Date(); d.setDate(d.getDate() - i); days.push([dayKey(d), i === 0 ? 'Сегодня' : i === 1 ? 'Вчера' : d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' }) + ', ' + d.toLocaleDateString('ru-RU', { weekday: 'short' })]); }
  const b = (k, label, n) => `<button data-day="${k}" class="${R.day === k ? 'on' : ''}${n ? '' : ' empty'}">${label}<span>${fmtNum(n)}</span></button>`;
  const total = R.rows.filter(x => !(x.dupHidden && R.dedup)).length;
  $('rDays').innerHTML = b('all', 'Все', total) + days.map(([k, l]) => b(k, l, cnt[k] || 0)).join('') + '<i></i>' + b('marked', '✓ Отмеченные', marked) + b('watch', '★ Отслеживаемые', watched)
    + `<span class="grow"></span><label class="tgl"><input type="checkbox" id="rNew"${R.onlyNew ? ' checked' : ''}><span>● Непросмотренные ${fmtNum(unseen)}</span></label>`
    + `<label class="tgl"><input type="checkbox" id="rMatch"${R.onlyMatch ? ' checked' : ''}><span>⇄ Есть в нескольких проверках ${fmtNum(matched)}</span></label>`
    + `<label class="tgl"><input type="checkbox" id="rDedup"${R.dedup ? ' checked' : ''}><span>Скрыть одинаковые${R.dupCount ? ' (' + fmtNum(R.dupCount) + ')' : ''}</span></label>`;
  $('rDays').querySelectorAll('button').forEach(x => (x.onclick = () => { R.day = x.dataset.day; R.up = 'all'; renderDays(); renderResults(true); }));
  $('rNew').onchange = e => { R.onlyNew = e.target.checked; renderResults(true); };
  $('rMatch').onchange = e => { R.onlyMatch = e.target.checked; renderResults(true); };
  $('rDedup').onchange = e => { R.dedup = e.target.checked; pvz.setCfg({ resDedup: R.dedup }); renderDays(); renderResults(true); };
  // выгрузки выбранного дня: «Все выгрузки за день» + по кнопке на каждую выгрузку
  const isDay = /^\d{4}-/.test(R.day);
  let ups = [];
  if (isDay) {
    const m = new Map();
    for (const x of R.rows) { if (dayKey(x.checked) !== R.day || (x.dupHidden && R.dedup)) continue; const k = upKey(x); const u = m.get(k) || { k, t: x.checked, n: 0 }; u.n++; u.t = Math.min(u.t, x.checked); m.set(k, u); }
    ups = [...m.values()].sort((a, b) => a.t - b.t);
  }
  $('rUps').classList.toggle('on', isDay && ups.length > 0);
  $('rUps').innerHTML = isDay ? `<button data-up="all" class="${R.up === 'all' ? 'on' : ''}">Все выгрузки за ${R.day === dayKey(Date.now()) ? 'сегодня' : 'день'}<span>${fmtNum(ups.reduce((s, u) => s + u.n, 0))}</span></button>` +
    ups.map((u, i) => `<button data-up="${esc(u.k)}" class="${R.up === u.k ? 'on' : ''}" title="${esc(u.k)}">№${i + 1} · ${esc(u.k.replace(/\.xlsx$/i, '').replace(/^export_excel\s*/i, ''))}<span>${fmtNum(u.n)}</span></button>`).join('') : '';
  $('rUps').querySelectorAll('button').forEach(x => (x.onclick = () => { R.up = x.dataset.up; renderDays(); renderResults(true); }));
}
const OZ_C = { 'зелёный': '#22c55e', 'синий': '#2563eb', 'голубой': '#60a5fa', 'гарантия < 3 млн': '#a78bfa', 'ошибка запроса': '#f59e0b' };
function zoneColor(r) {
  if (r.platform === 'Ozon') return OZ_C[r.zone] || '#9ca3af';
  if (r.platform === 'Яндекс') return /оранж/.test(r.zone) ? '#fb923c' : /фиолет/.test(r.zone) ? '#c084fc' : /синий/.test(r.zone) ? '#6b99f5' : /голуб/.test(r.zone) ? '#67e8f9' : '#9ca3af';
  return /гарантир/.test(r.zone) ? '#d8b4fe' : /без выплат/.test(r.zone) ? '#fde047' : /другой/.test(r.zone) ? '#fdba74' : '#d1d5db';
}
function prepRows(rows) {
  R.rows = rows.map((x, i) => Object.assign(x, { id: i, mark: R.marks[markKey(x)] ? 1 : 0 }));
  // отслеживаемые, которых уже нет в файлах результатов, — из сохранённой копии
  const have = new Set(R.rows.map(markKey));
  for (const [k, w] of Object.entries(R.watch)) if (!have.has(k) && w.row) R.rows.push(Object.assign({}, w.row, { id: R.rows.length, mark: R.marks[k] ? 1 : 0, archived: true }));
  // одинаковые помещения в один день: первое оставляем, остальные скрываем (переключатель «Скрыть одинаковые»)
  const firstOf = new Map(); R.dupCount = 0;
  [...R.rows].sort((a, b) => a.checked - b.checked).forEach(x => { const k = dupKey(x); if (firstOf.has(k)) { x.dupHidden = true; R.dupCount++; } else firstOf.set(k, x); });
  // одно и то же помещение в проверке Ozon и другой площадки
  const byMatch = new Map();
  for (const x of R.rows) { const k = matchKey(x); if (!byMatch.has(k)) byMatch.set(k, []); byMatch.get(k).push(x); }
  for (const x of R.rows) x.also = [...new Map(byMatch.get(matchKey(x)).filter(y => y.platform !== x.platform).map(y => [y.platform, y])).values()];
}
window.prepRows = prepRows;
async function loadResults() {
  $('rCount').textContent = 'загрузка…';
  const r = await pvz.results();
  const cfg = await pvz.getCfg();
  if (R.showLst === undefined) { R.showLst = cfg.resShowLst != null ? (cfg.resShowLst && lstAuto()) || (cfg.resShowLst && window.innerWidth >= 1400) : lstAuto(); R.base = cfg.resBase || '2gis'; $('rBase').value = R.base; R.mapMode = cfg.resMap || 'res'; $('rMapSel').value = R.mapMode; }
  R.marks = cfg.resMarks || {}; R.seen = cfg.resSeen || {}; R.watch = cfg.resWatch || {}; if (cfg.resDedup === false) R.dedup = false;
  prepRows(r.rows);
  renderDays();
  const zones = [...new Set(R.rows.map(x => x.platform + ' · ' + x.zone))].sort();
  const cur = $('rZone').value;
  $('rZone').innerHTML = '<option value="">все зоны</option>' + zones.map(z => `<option${z === cur ? ' selected' : ''}>${esc(z)}</option>`).join('');
  if (!R.map) {
    R.map = L.map('rMap', { zoomControl: true, attributionControl: true }).setView([55.75, 37.62], 10);
    R.tiles = baseTiles().addTo(R.map);
    R.layer = L.layerGroup().addTo(R.map);
  }
  setTimeout(() => R.map.invalidateSize(), 50);
  renderResults(true);
  applyLst(); if (R.mapMode !== 'res') setMapMode(R.mapMode);
  if (r.errors.length) pvz.logError('результаты', r.errors.join('; '));
}
function filteredResults() {
  const plats = [...$('rPlat').querySelectorAll('input:checked')].map(i => i.value);
  const zone = $('rZone').value, area = numOf($('rArea')), price = numOf($('rPrice')), day = R.day;
  const q = $('rSearch').value.trim().toLowerCase();
  return R.rows.filter(x => plats.includes(x.platform) && (!zone || zone === x.platform + ' · ' + x.zone)
    && !(R.dedup && x.dupHidden) && (!R.onlyNew || !R.seen[markKey(x)]) && (!R.onlyMatch || (x.also && x.also.length))
    && (R.up === 'all' || !/^\d{4}-/.test(day) || upKey(x) === R.up)
    && (day !== 'watch' || R.watch[markKey(x)]) && (day === 'watch' || !x.archived)
    && (area === '' || (x.areaMax ?? x.areaMin ?? 0) >= area) && (price === '' || x.price == null || x.price <= price)
    && (day === 'all' || day === 'watch' || (day === 'marked' ? x.mark : dayKey(x.checked) === day)) && (!q || (x.address + ' ' + x.metro + ' ' + x.source + ' ' + x.note).toLowerCase().includes(q)));
}
function renderResults(fit) {
  const list = filteredResults();
  const { k, dir } = R.sort;
  list.sort((a, b) => { const x = a[k], y = b[k]; if (x == null && y == null) return 0; if (x == null) return 1; if (y == null) return -1; return (typeof x === 'number' ? x - y : String(x).localeCompare(String(y), 'ru')) * dir; });
  R.list = list;
  document.querySelectorAll('.r-table th').forEach(th => th.classList.toggle('sorted', th.dataset.k === k));
  const shown = list.slice(0, 1000);
  $('rCount').textContent = `${fmtNum(list.length)} из ${fmtNum(R.rows.length)}`;
  const area = x => x.areaMin == null ? '' : (x.areaMax && x.areaMax !== x.areaMin ? `${fmtNum(x.areaMin)}–${fmtNum(x.areaMax)}` : fmtNum(x.areaMin)) + ' м²';
  $('rRows').innerHTML = shown.map((x, i) => `<tr data-id="${x.id}" class="${x.mark ? 'marked' : ''}${R.seen[markKey(x)] ? '' : ' unseen'}${x.also && x.also.length ? ' multi' : ''}">
    <td class="num-c">${i + 1}</td><td>${esc(x.platform)}</td>
    <td><span class="zb"><i style="background:${zoneColor(x)}"></i>${esc(x.zone)}</span></td>
    <td class="addr">${R.seen[markKey(x)] ? '' : '<b class="new-dot" title="Ещё не просмотрено">●</b>'}${esc(x.address)}${x.also && x.also.length ? x.also.map(y => `<span class="also" title="Это помещение есть и в проверке ${esc(y.platform)}"><i style="background:${zoneColor(y)}"></i>${esc(y.platform)}: ${esc(y.zone)}</span>`).join('') : ''}${x.archived ? '<span class="also">из архива</span>' : ''}${x.metro ? `<small>${esc(x.metro)}</small>` : ''}${x.note ? `<small>${esc(x.note)}</small>` : ''}</td>
    <td class="n">${area(x)}</td><td class="n flats" data-flats="${x.id}">${flatsCell(x)}</td><td class="n">${x.price != null ? fmtNum(x.price) + ' ₽' : ''}${x.money ? `<small class="pay">выплата ${fmtNum(x.money)} ₽</small>` : ''}</td>
    <td>${fmtTime(x.checked)}</td><td class="acts">${x.url ? '<a class="open" href="#">Открыть ↗</a>' : ''}<button class="star${R.watch[markKey(x)] ? ' on' : ''}" title="${R.watch[markKey(x)] ? 'Убрать из отслеживаемых' : 'Отслеживать'}">${R.watch[markKey(x)] ? '★' : '☆'}</button></td><td class="mk"><label class="mbox"><input type="checkbox"${x.mark ? ' checked' : ''}><span></span></label></td></tr>`).join('');
  $('rMore').textContent = list.length > shown.length ? `Показаны первые ${fmtNum(shown.length)} — уточните фильтры.` : (list.length ? '' : 'Ничего не найдено — измените фильтры или день.');
  R.layer.clearLayers(); R.markers.clear();
  const pts = [];
  for (const x of list.slice(0, 3000)) {
    if (x.lat == null) continue;
    const m = L.circleMarker([x.lat, x.lon], { radius: 7, color: '#0b0d11', weight: 1.5, fillColor: zoneColor(x), fillOpacity: .95 })
      .bindPopup(`<b>${esc(x.address)}</b><br>${esc(x.platform)}: ${esc(x.zone)}<br>${area(x)}${x.price != null ? ' · ' + fmtNum(x.price) + ' ₽/мес' : ''}${x.money ? '<br>Выплата: ' + fmtNum(x.money) + ' ₽' : ''}${x.url ? `<br><a href="#" data-url="${esc(x.url)}">Открыть объявление ↗</a>` : ''}`);
    m.on('click', () => selectRow(x.id, false));
    m.addTo(R.layer); R.markers.set(x.id, m); pts.push([x.lat, x.lon]);
  }
  if (fit && pts.length) R.map.fitBounds(pts, { padding: [30, 30], maxZoom: 14 });
  setTimeout(loadFlats, 300);
}
// ---- карта Ozon по выбранному объявлению ----
// что искать на карте Ozon: адрес, с которым сверялись при проверке (если Ozon уточнил его), иначе адрес объявления
function ozQuery(x) {
  const n = x.note || '';
  let m = n.match(/\(Ozon: ([^)]+)\)/);
  if (m) return m[1].trim();
  m = n.match(/проверить вручную: ([^;]+)/);
  if (m && !/нет номера дома|не нашёл дом|зелён|слой|контур/.test(m[1]) && /\d/.test(m[1])) return m[1].trim();
  const a = x.address.trim();
  return /москв|московск|область|г\.|город/i.test(a) ? a : 'Москва, ' + a;
}
const rectOf = id => { const b = $(id).getBoundingClientRect(); return { x: b.left, y: b.top, width: b.width, height: b.height }; };
const ozRect = () => rectOf('rOzHost');
// какая карта выбрана справа: «res» — точки (Leaflet), «ozon» — карта Ozon, остальные — сайты карт
R.mapMode = 'res';
const MAP_NAMES = { yandex: 'Яндекс.Карты', '2gis': '2ГИС', osm: 'OpenStreetMap', ozon: 'Карта Ozon', wb: 'Карта WB', ym: 'Карта Яндекс Маркета' };
const extPoint = x => x && x.lat != null ? { lat: x.lat, lon: x.lon } : null;
function mapQuery(x, mode) { return mode === 'ozon' ? ozQuery(x) : ozQuery(x); }
function setMapMode(m) {
  R.mapMode = m; R.ozon = m === 'ozon'; $('rMapSel').value = m; pvz.setCfg({ resMap: m }); $('rMapZoom').dataset.zoom = m === 'ozon' ? 'ozonmap' : m;
  const live = m !== 'res';
  $('rMap').style.display = live ? 'none' : ''; $('rOzHost').style.display = live ? 'block' : 'none';
  $('rOzReload').style.display = live ? '' : 'none'; $('rBase').style.display = live ? 'none' : ''; $('rMapZoom').style.display = live ? '' : 'none';
  if (m !== 'ozon') pvz.ozonMapRect(null);
  if (m === 'ozon' || m === 'res') pvz.extRect(null, null); else pvz.extRect(m, null);
  if (!live) { $('rOzQ').textContent = ''; pvz.extHideAll('map'); setTimeout(() => R.map && R.map.invalidateSize(), 30); return; }
  const x = R.sel != null ? R.rows[R.sel] : null;
  if (!x) { $('rOzQ').textContent = 'Выберите объявление в таблице'; return; }
  showOnMap(x);
}
async function showOnMap(x) {
  const m = R.mapMode; if (m === 'res') return;
  const q = mapQuery(x, m);
  $('rOzQ').textContent = 'Ищу: ' + q;
  await new Promise(r => requestAnimationFrame(r));
  const res = m === 'ozon' ? await pvz.ozonMapShow(ozRect(), q) : await pvz.extShow(m, ozRect(), q, extPoint(x));
  if (R.mapMode !== m || R.rows[R.sel] !== x) return;
  zoomShow(m === 'ozon' ? 'ozonmap' : m);
  if (res && res.ok) $('rOzQ').textContent = q + (res.how === 'enter' ? ' (подсказка не появилась — нажат Enter)' : '');
  else { $('rOzQ').textContent = 'Не удалось ввести адрес (' + ((res && res.why) || 'ошибка') + ') — он скопирован, вставьте в поиск Ctrl+V'; navigator.clipboard && navigator.clipboard.writeText(q).catch(() => {}); }
}
const showOnOzon = x => showOnMap(x);
$('rMapSel').onchange = () => setMapMode($('rMapSel').value);
$('rOzReload').onclick = async () => { if (R.mapMode === 'ozon') await pvz.ozonMapReload(); else await pvz.extReload(R.mapMode); const x = R.rows[R.sel]; if (x) setTimeout(() => showOnMap(x), 1800); };
$('rMapZoom').querySelectorAll('[data-z]').forEach(b => b.addEventListener('click', () => ($('rMapZoom').dataset.zoom = R.mapMode === 'ozon' ? 'ozonmap' : R.mapMode), true));
// сайт объявления — средняя колонка
function lstAuto() { return window.innerWidth >= 1700; }
function applyLst() {
  const on = R.showLst; $('rShowLst').checked = on;
  document.querySelector('.r-body').classList.toggle('with-lst', on);
  if (!on) pvz.extRect('listing', null);
  setTimeout(() => { R.map && R.map.invalidateSize(); syncRects(); }, 60);
  if (on && R.sel != null) showListing(R.rows[R.sel]);
}
async function showListing(x) {
  if (!R.showLst || !x) return;
  if (!x.url) { pvz.extRect('listing', null); $('rLstQ').textContent = 'у объявления нет ссылки'; return; }
  $('rLstQ').textContent = x.address;
  await new Promise(r => requestAnimationFrame(r));
  await pvz.extShow('listing', rectOf('rLstHost'), x.url);
  zoomShow('listing');
}
$('rShowLst').onchange = () => { R.showLst = $('rShowLst').checked; pvz.setCfg({ resShowLst: R.showLst }); applyLst(); };
$('rLstExt').onclick = () => { const x = R.rows[R.sel]; if (x && x.url) pvz.openExternal(x.url); };
function syncRects() {
  if (document.body.dataset.mode !== 'results' || modalIsOpen()) return;
  if (R.sel == null) return;
  if (R.mapMode === 'ozon') pvz.ozonMapRect(ozRect()); else if (R.mapMode !== 'res') pvz.extRect(R.mapMode, ozRect());
  if (R.showLst) pvz.extRect('listing', rectOf('rLstHost'));
}
const modalIsOpen = () => $('modal').classList.contains('on');
new ResizeObserver(syncRects).observe($('rOzHost'));
new ResizeObserver(syncRects).observe($('rLstHost'));
// уход со страницы или окно по центру — спрятать встроенные сайты
new MutationObserver(() => {
  if (document.body.dataset.mode !== 'results') { pvz.ozonMapRect(null); pvz.extHideAll(); }
  else setTimeout(syncRects, 50);
}).observe(document.body, { attributes: true, attributeFilter: ['data-mode'] });
new MutationObserver(() => { if (modalIsOpen()) { pvz.ozonMapRect(null); pvz.extHideAll(); } else syncRects(); }).observe($('modal'), { attributes: true, attributeFilter: ['class'] });
$('rBase').onchange = () => { R.base = $('rBase').value; pvz.setCfg({ resBase: R.base }); if (R.map) { R.map.removeLayer(R.tiles); R.tiles = baseTiles().addTo(R.map); } };
function baseTiles() {
  return R.base === 'osm' ? L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap', maxZoom: 19 })
    : L.tileLayer('https://tile{s}.maps.2gis.com/tiles?x={x}&y={y}&z={z}&v=1', { attribution: '© 2ГИС', subdomains: '0123', maxZoom: 18 });
}
function selectRow(id, fly) {
  R.sel = id; { const x = R.rows[id]; if (x && x.lat != null && (x.flats === undefined || (x.flats && x.flats.err))) pvz.flats(x.lat, x.lon).then(f => { x.flats = f || { n: null }; paintFlats(x); }).catch(() => {}); }
  if (R.rows[id]) markSeen(R.rows[id], document.querySelector(`#rRows tr[data-id="${id}"]`));
  if (R.mapMode && R.mapMode !== 'res') showOnMap(R.rows[id]);
  if (R.showLst) showListing(R.rows[id]);
  document.querySelectorAll('#rRows tr.sel').forEach(t => t.classList.remove('sel'));
  const tr = document.querySelector(`#rRows tr[data-id="${id}"]`);
  if (tr) { tr.classList.add('sel'); if (!fly) tr.scrollIntoView({ block: 'nearest' }); }
  const m = R.markers.get(id);
  if (m && fly) { R.map.flyTo(m.getLatLng(), Math.max(R.map.getZoom(), 15), { duration: .6 }); m.openPopup(); }
}
$('rRows').addEventListener('click', e => {
  const tr = e.target.closest('tr'); if (!tr) return;
  const x = R.rows[+tr.dataset.id];
  if (e.target.closest('.mbox')) {
    if (e.target.tagName !== 'INPUT') return;
    x.mark = e.target.checked ? 1 : 0; tr.classList.toggle('marked', !!x.mark);
    if (x.mark) R.marks[markKey(x)] = Date.now(); else delete R.marks[markKey(x)];
    pvz.setCfg({ resMarks: R.marks }); renderDays();
    if (R.day === 'marked' && !x.mark) renderResults(false);
    return;
  }
  if (e.target.closest('.star')) {
    const k = markKey(x);
    if (R.watch[k]) delete R.watch[k]; else { const row = Object.assign({}, x); delete row.also; delete row.id; R.watch[k] = { added: Date.now(), row }; }
    pvz.setCfg({ resWatch: R.watch }); renderDays(); renderResults(false); return;
  }
  markSeen(x, tr);
  if (e.target.closest('a.open')) { e.preventDefault(); pvz.openExternal(x.url); return; }
  selectRow(x.id, true);
});
$('rMap').addEventListener('click', e => { const a = e.target.closest('a[data-url]'); if (a) { e.preventDefault(); pvz.openExternal(a.dataset.url); } });
document.querySelectorAll('.r-table th[data-k]').forEach(th => (th.onclick = () => { R.sort = { k: th.dataset.k, dir: R.sort.k === th.dataset.k ? -R.sort.dir : (['price', 'areaMin', 'zone', 'address', 'platform'].includes(th.dataset.k) ? 1 : -1) }; renderResults(false); }));
['rZone'].forEach(id => ($(id).onchange = () => renderResults(true)));
['rArea', 'rPrice', 'rSearch'].forEach(id => $(id).addEventListener('input', () => renderResults(false)));
$('rPlat').querySelectorAll('input').forEach(i => (i.onchange = () => renderResults(true)));
$('rReload').onclick = () => loadResults();
// квартир в доме (OpenStreetMap): сначала из кэша, по выбору строки — запрос; видимые строки догружаются по одной
function flatsCell(x) {
  const f = x.flats; if (x.lat == null) return '';
  if (f === undefined) return '<span class="muted">…</span>';
  if (!f || f.n == null) return '<span class="muted" title="Нет данных в OpenStreetMap">—</span>';
  return f.exact ? fmtNum(f.n) : `<span title="Оценка: ${f.levels} эт. × ${f.entrances || 1} подъезд(а) × 4">≈${fmtNum(f.n)}</span>`;
}
let flatsBusy = false;
async function loadFlats() {
  const need = R.list.slice(0, 1000).filter(x => x.lat != null && x.flats === undefined);
  if (!need.length) return;
  const c = await pvz.flatsCached(need.map(x => [x.lat, x.lon]));
  need.forEach((x, i) => { if (c[i]) x.flats = c[i]; });
  paintFlats();
  if (flatsBusy) return; flatsBusy = true;
  try {
    for (const x of R.list.slice(0, 60)) {
      if (document.body.dataset.mode !== 'results') break;
      if (x.lat == null || x.flats !== undefined) continue;
      x.flats = await pvz.flats(x.lat, x.lon).catch(() => null) || { n: null }; paintFlats(x);
    }
  } finally { flatsBusy = false; }
}
function paintFlats(only) {
  for (const x of only ? [only] : R.list.slice(0, 1000)) { const td = document.querySelector(`td[data-flats="${x.id}"]`); if (td) td.innerHTML = flatsCell(x); }
}
// просмотренные: объявление считается просмотренным, когда вы его выбрали или открыли
let seenT = null;
function markSeen(x, tr) {
  const k = markKey(x); if (R.seen[k]) return;
  R.seen[k] = Date.now(); if (tr) { tr.classList.remove('unseen'); const d = tr.querySelector('.new-dot'); if (d) d.remove(); }
  clearTimeout(seenT); seenT = setTimeout(() => { pvz.setCfg({ resSeen: R.seen }); renderDays(); }, 800);
}
window.openWatch = () => { R.day = 'watch'; openPage('results'); };
// перепроверка зон: заново (без памяти результатов) для выгрузок, строки которых сейчас в списке
$('rRecheck').onclick = async () => {
  const files = [...new Set(R.list.filter(x => !x.archived).map(x => x.filePath))];
  const src = files.length ? await pvz.resultSources(files) : [];
  if (!src.length) { showModal({ kind: 'info', title: 'Нечего перепроверять', text: 'Не нашёл исходные выгрузки для строк в списке (возможно, файлы перенесены).' }); return; }
  const v = await showModal({ kind: 'info', title: 'Перепроверить зоны?', text: `Выгрузок: ${src.length}. Каждый адрес будет проверен заново на карте (это займёт время), файлы результатов обновятся.`, buttons: [{ label: 'Отмена', value: false }, { label: 'Перепроверить', cls: 'primary', value: true }] });
  if (!v) return;
  const r = await pvz.ozonStart(src, { fresh: true });
  if (!r.ok) { showModal({ kind: 'err', title: 'Не запустилось', text: r.error }); return; }
  $('rRecheck').disabled = true; $('rRecheck').textContent = '↻ Перепроверяю…';
};
pvz.onOzonStatus(s => { if (document.body.dataset.mode === 'results' && $('rRecheck').disabled) $('rRecheck').textContent = '↻ ' + String(s.text || '').split('\n')[0].slice(0, 40); });
pvz.onOzonDone(() => { if ($('rRecheck').disabled) { $('rRecheck').disabled = false; $('rRecheck').textContent = '↻ Перепроверить зоны'; if (document.body.dataset.mode === 'results') loadResults(); } });
// экспорт отмеченных
$('rExport').onclick = async () => {
  const list = R.rows.filter(x => x.mark && !(R.dedup && x.dupHidden));
  if (!list.length) { showModal({ kind: 'info', title: 'Нет отмеченных', text: 'Отметьте объявления галочкой справа в таблице.' }); return; }
  const v = await showModal({ kind: 'info', title: `Экспорт отмеченных (${fmtNum(list.length)})`, text: 'Как выгрузить?',
    buttons: [{ label: 'Отмена', value: null }, { label: 'Скопировать «адрес, ссылка»', value: 'copy' }, { label: 'В таблицу Excel', cls: 'primary', value: 'xlsx' }] });
  if (v === 'copy') {
    await navigator.clipboard.writeText(list.map((x, i) => `${i + 1}. ${x.address}, ${x.url || ''}`).join('\n'));
    showModal({ kind: 'ok', title: 'Скопировано', text: `${fmtNum(list.length)} строк в буфере обмена — вставьте куда нужно (Ctrl+V / ⌘V).` });
  } else if (v === 'xlsx') {
    const f = await pvz.exportRows(list.map(x => ({ platform: x.platform, zone: x.zone, address: x.address, metro: x.metro, areaMin: x.areaMin, areaMax: x.areaMax, price: x.price, money: x.money, source: x.source, date: x.date, note: x.note, url: x.url, lat: x.lat, lon: x.lon })));
    if (f) showModal({ kind: 'ok', title: 'Таблица сохранена', text: f });
  }
};

// ---------- История ----------
const H_COLOR = { winner: '#F97316', cian: '#14B8A6', avito: '#3B82F6' };
async function loadHistory() {
  const h = await pvz.history();
  $('hList').innerHTML = h.length ? h.map(x => {
    const kind = x.type === 'export' ? 'Выгрузка · ' + (NAMES[x.site] || '') : x.type === 'check' ? 'Проверка зон' : 'Расписание';
    const color = x.type === 'export' ? H_COLOR[x.site] : x.type === 'check' ? '#8B5CF6' : '#64748b';
    const files = (x.files || []).map(f => `<a data-file="${esc(f)}" title="${esc(f)}">${esc(f.split(/[\\/]/).pop())}</a>`).join('');
    return `<div class="h-item${x.ok === false ? ' bad' : ''}" style="--c:${color}">
      <div class="t"><b>${esc(kind)}</b>${x.title ? '<em class="muted">' + esc(x.title) + '</em>' : ''}<span>${fmtTime(x.time)}</span></div>
      <div class="r">${esc(prettyNums(x.reason || ''))}${x.total ? ` · ${x.type === 'check' ? 'адресов' : 'объявлений'}: ${fmtNum(x.total)}` : ''}</div>
      ${files ? `<div class="f">${files}</div>` : ''}</div>`;
  }).join('') : '<div class="s-empty">Запусков пока не было.</div>';
  const e = await pvz.errors();
  const n = (e.match(/^\d{4}-\d{2}-\d{2}T/gm) || []).length;
  $('eCount').textContent = n ? fmtNum(n) : '';
  $('eText').textContent = e ? e.trim().split('\n').slice(-300).join('\n') : 'Ошибок нет 👍';
}
$('hList').addEventListener('click', e => { const a = e.target.closest('a[data-file]'); if (a) pvz.showFile(a.dataset.file); });
$('hReload').onclick = () => loadHistory();
$('eCopy').onclick = async () => { await pvz.copyReport(); $('eMsg').textContent = 'Скопировано — вставьте в чат с Claude (Ctrl+V).'; };
$('eZip').onclick = async () => { const f = await pvz.makeReport(); if (f) $('eMsg').textContent = 'Архив сохранён: ' + f; };
$('eLogs').onclick = () => pvz.openLogs();
$('eClear').onclick = async () => { await pvz.clearErrors(); loadHistory(); };

// ---------- Расписание ----------
const S = { list: [], presets: {}, orders: [] };
const DAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
async function loadSchedule() {
  const c = await pvz.getCfg();
  S.list = c.schedules || [];
  S.presets = c.presets && Object.keys(c.presets).length ? c.presets : DEFAULT_PRESETS;
  S.orders = await pvz.bwOrders();
    renderSchedule();
}
const saveSchedule = () => pvz.setCfg({ schedules: S.list });
function whatOptions(s) {
  const cur = s.kind === 'winner' ? 'winner:' + s.guid : 'preset:' + s.preset;
  return `<optgroup label="Baza Winner — заказ">${S.orders.map(o => `<option value="winner:${o.guid}"${cur === 'winner:' + o.guid ? ' selected' : ''}>${esc(o.name)}</option>`).join('')}</optgroup>` +
    `<optgroup label="Циан и Авито — пресет">${Object.keys(S.presets).map(n => `<option value="preset:${esc(n)}"${cur === 'preset:' + n ? ' selected' : ''}>${esc(n)}</option>`).join('')}</optgroup>`;
}
function renderSchedule() {
  $('sList').innerHTML = S.list.length ? S.list.map((s, i) => `<div class="s-item${s.enabled ? '' : ' off'}" data-i="${i}">
      <label class="switch"><input type="checkbox" class="en"${s.enabled ? ' checked' : ''}><span></span></label>
      <input type="time" class="tm" value="${s.time}">
      <select class="what">${whatOptions(s)}</select>
      <div class="s-days">${DAYS.map((d, k) => `<button class="${(s.days || []).includes(k + 1) ? 'on' : ''}" data-d="${k + 1}">${d}</button>`).join('')}</div>
      <label class="chk"><input type="checkbox" class="ck"${s.check ? ' checked' : ''}>проверить зоны</label>
      <button class="del" title="Удалить">✕</button></div>`).join('')
    : '<div class="s-empty">Заданий нет. Нажмите «+ Добавить задание».</div>';
}
$('sList').addEventListener('change', e => {
  const it = e.target.closest('.s-item'); if (!it) return; const s = S.list[+it.dataset.i];
  if (e.target.classList.contains('en')) s.enabled = e.target.checked;
  if (e.target.classList.contains('tm')) s.time = e.target.value;
  if (e.target.classList.contains('ck')) s.check = e.target.checked;
  if (e.target.classList.contains('what')) {
    const [kind, ...rest] = e.target.value.split(':'); const v = rest.join(':');
    s.kind = kind; if (kind === 'winner') { s.guid = v; s.name = (S.orders.find(o => o.guid === v) || {}).name; delete s.preset; } else { s.preset = v; s.name = v; delete s.guid; }
  }
  saveSchedule(); renderSchedule();
});
$('sList').addEventListener('click', e => {
  const it = e.target.closest('.s-item'); if (!it) return; const i = +it.dataset.i, s = S.list[i];
  if (e.target.closest('.del')) { S.list.splice(i, 1); saveSchedule(); renderSchedule(); return; }
  const d = e.target.closest('[data-d]');
  if (d) { const n = +d.dataset.d; s.days = (s.days || []).includes(n) ? s.days.filter(x => x !== n) : [...(s.days || []), n].sort(); saveSchedule(); renderSchedule(); }
});
$('sAdd').onclick = () => {
  const o = S.orders[0];
  S.list.push(Object.assign({ id: Date.now().toString(36), enabled: true, time: '13:30', days: [1, 2, 3, 4, 5], check: true },
    o ? { kind: 'winner', guid: o.guid, name: o.name } : { kind: 'preset', preset: Object.keys(S.presets)[0], name: Object.keys(S.presets)[0] }));
  saveSchedule(); renderSchedule();
};

// запуск задания по расписанию
const wait = ms => new Promise(r => setTimeout(r, ms));
pvz.onRunSchedule(async s => {
  if (running) { pvz.notify('PVZ Master', `Задание «${s.name || ''}» пропущено: идёт другая выгрузка.`); return; }
  let report = [];
  try {
    if (s.kind === 'winner') {
      document.body.dataset.mode = 'work'; setSite('winner');
      setStatus(`По расписанию: ${s.name || 'заказ Winner'}…`);
      await pvz.navUrl('winner', `https://w7.baza-winner.ru/search/${s.guid}/params`);
      await wait(6000); bwGuid = null; await refreshBw();
      const { r, text } = await runExport({ title: s.name, forceCheck: !!s.check });
      setStatus(text, r.ok ? 'done' : 'err');
      report.push(r.ok ? `выгружено ${fmtNum(r.total)}, файлов ${r.saved.length}` : 'ошибка: ' + r.error);
    } else {
      const c = await pvz.getCfg();
      const all = c.presets && Object.keys(c.presets).length ? c.presets : DEFAULT_PRESETS;
      const p = all[s.preset];
      if (!p) { report.push('пресет не найден'); }
      else report = await runOrder(Object.assign({ cian: true, avito: true }, p), s.preset, { unattended: true, forceCheck: !!s.check });
    }
  } catch (e) { report.push('ошибка: ' + (e.message || e)); pvz.logError('расписание', e.stack || String(e)); }
  pvz.notify(`PVZ Master — ${s.name || 'задание'} (${s.time})`, prettyNums(report.join(' · ') || 'готово'));
});

// ручной режим (для опытных): прежняя панель с вкладками сайтов
$('expertBtn').onclick = async () => { const c = await pvz.getCfg(); openSite(c.lastSite && NAMES[c.lastSite] && c.lastSite !== 'ozon' ? c.lastSite : 'winner'); };
