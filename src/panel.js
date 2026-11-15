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
  let t = `Ozon — ${r.reason}. Файлов: ${r.files}` + (r.rowsTotal != null ? `, объявлений: ${r.rowsTotal}` : '') + `, разных адресов: ${r.addresses}` + (r.fromCache ? ` (из них ${r.fromCache} уже проверялись за последние дни — взяты из памяти)` : '') + (r.noCoords ? `; без координат, не проверялись: ${r.noCoords}` : '') + `.\n` +
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
  if (bwGuid && !(extra && extra.bw)) {
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
  const extra = Object.assign({ days: p.days === '' ? 0 : p.days, forceCheck: !!opt.forceCheck, noNewMoscow: p.region === 'msk_nonew' }, opt.job ? { job: opt.job } : {});
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
        if (/avito\.ru/.test(u)) { if (opt.job) pvz.jobSave({ id: opt.job, avitoUrl: u }); else { presets[presetName] = Object.assign({}, presets[presetName] || p, { avitoUrl: u }); pvz.setCfg({ presets }); } }
      }
    }
    if (go) {
      const { r, text } = await runExport(Object.assign({ title: (presetName || 'Авито') }, extra));
      report.push('Авито: ' + (r.ok ? `${r.total} объявл., файлов ${r.saved.length}` : 'ошибка — ' + r.error));
      setStatus(text, r.ok ? 'done' : 'err');
    } else if (!opt.unattended) report.push('Авито: пропущено');
  }
  // сценарий из мастера может включать заказы Baza Winner — по расписанию выгружаются и они
  if (p.winner && p.orders) {
    for (const [guid, o] of Object.entries(p.orders)) {
      if (!o || !o.on) continue;
      setSite('winner'); setStatus(`Winner: ${o.name || 'заказ'}…`);
      await pvz.navUrl('winner', `https://w7.baza-winner.ru/search/${guid}/params`);
      await wait(6000); bwGuid = null; await refreshBw();
      const { r, text } = await runExport(Object.assign({ title: o.name, forceCheck: !!opt.forceCheck, bw: { tag: o.tag || '', hide: o.hide !== false, name: o.name || '' } }, opt.job ? { job: opt.job } : {}));
      report.push(`Winner «${o.name || guid.slice(0, 8)}»: ` + (r.ok ? `${r.total} объявл., файлов ${r.saved.length}` : 'ошибка — ' + r.error));
      setStatus(text, r.ok ? 'done' : 'err');
    }
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
document.querySelectorAll('[data-page]').forEach(el => (el.onclick = e => { e.preventDefault(); if (el.dataset.page === 'watch') { window.openWatch && openWatch(); return; } if (el.dataset.page === 'results') R.jobF = ''; openPage(el.dataset.page); }));
// при возврате на главный экран центр всегда видим (раньше оставался класс анимации ухода — кнопки пропадали)
new MutationObserver(() => { if (document.body.dataset.mode === 'welcome') $('welcome').classList.remove('leave'); }).observe(document.body, { attributes: true, attributeFilter: ['data-mode'] });
let backTo = 'welcome';
document.querySelectorAll('.back-home').forEach(b => (b.onclick = () => {
  if (b.closest('#settings') && backTo !== 'welcome' && backTo !== 'settings') { const t = backTo; backTo = 'welcome'; if (t === 'wizard') { window.wizResume && wizResume(); } else openPage(t); return; }
  document.body.dataset.mode = 'welcome';
}));
document.querySelectorAll('[data-settings]').forEach(b => (b.onclick = () => { backTo = document.body.dataset.mode; openPage('settings'); }));
pvz.onOpenPage(p => openPage(p));
window.addEventListener('error', e => pvz.logError('интерфейс', `${e.message} @ ${String(e.filename).split('/').pop()}:${e.lineno}`));
window.addEventListener('unhandledrejection', e => pvz.logError('интерфейс', String(e.reason && (e.reason.stack || e.reason.message) || e.reason)));
const fmtTime = t => { const d = new Date(t); return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' }) + ' ' + d.toTimeString().slice(0, 5); };

// ---------- Результаты ----------
const R = { jobF: '', jobs: [], rows: [], sort: { k: 'checked', dir: -1 }, map: null, layer: null, markers: new Map(), sel: null, list: [], day: 'all', up: 'all', marks: {}, seen: {}, watch: {}, dedup: true, onlyNew: false, onlyMatch: false };
const dayKey = t => { const d = new Date(t); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const markKey = x => x.url || (x.platform + '|' + x.address);
// одинаковые помещения: тот же адрес и та же площадь в один день (в рамках выгрузки и между выгрузками)
const normAddr = a => String(a || '').toLowerCase().replace(/ё/g, 'е').replace(/^\s*(россия|москва|г\.? ?москва)[, ]+/g, '').replace(/(улица|ул\.?|проспект|пр-т|переулок|пер\.?|шоссе|ш\.?|дом|д\.?)(?=[\s,]|$)/g, '').replace(/[^0-9a-zа-я/]+/g, '');
// день — по времени выгрузки (перепроверка зон не переносит строки в «Сегодня»)
const upDay = x => dayKey(x.exported || x.checked);
const dupKey = x => x.platform + '|' + upDay(x) + '|' + normAddr(x.address) + '|' + (x.areaMin ?? '');
const matchKey = x => normAddr(x.address) + '|' + (x.areaMin ?? '');
const upKey = x => x.file.replace(/^(OZON|ЯНДЕКС|WB) /i, '');
// фильтр «Заказ»: '' — все, '-' — общие папки, иначе id заказа
const inJob = x => !R.jobF || (R.jobF === '-' ? !x.job : x.job === R.jobF);
function renderDays() {
  const cnt = {}; let marked = 0, watched = 0, unseen = 0, matched = 0;
  for (const x of R.rows) { if ((x.dupHidden && R.dedup) || x.archived || !inJob(x)) continue; const k = upDay(x); cnt[k] = (cnt[k] || 0) + 1; if (x.mark) marked++; if (!R.seen[markKey(x)]) unseen++; if (x.also && x.also.length) matched++; }
  watched = Object.keys(R.watch).length;
  const days = [];
  for (let i = 0; i < 5; i++) { const d = new Date(); d.setDate(d.getDate() - i); days.push([dayKey(d), i === 0 ? 'Сегодня' : i === 1 ? 'Вчера' : d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' }) + ', ' + d.toLocaleDateString('ru-RU', { weekday: 'short' })]); }
  const b = (k, label, n) => `<button data-day="${k}" class="${R.day === k ? 'on' : ''}${n ? '' : ' empty'}">${label}<span>${fmtNum(n)}</span></button>`;
  const total = R.rows.filter(x => !(x.dupHidden && R.dedup) && !x.archived && inJob(x)).length;
  $('rDays').innerHTML = b('all', 'Все', total) + days.map(([k, l]) => b(k, l, cnt[k] || 0)).join('') + '<i></i>' + b('marked', '✓ Отмеченные', marked) + b('watch', '★ Отслеживаемые', watched)
    + `<span class="grow"></span><label class="tgl"><input type="checkbox" id="rNew"${R.onlyNew ? ' checked' : ''}><span>● Непросмотренные ${fmtNum(unseen)}</span></label>`
    + `<label class="tgl"><input type="checkbox" id="rMatch"${R.onlyMatch ? ' checked' : ''}><span>⇄ Есть в нескольких проверках ${fmtNum(matched)}</span></label>`;
  $('rDedup').checked = R.dedup; $('rDupN').textContent = R.dupCount ? '(' + fmtNum(R.dupCount) + ')' : '';
  $('rDays').querySelectorAll('button').forEach(x => (x.onclick = () => { R.day = x.dataset.day; R.up = 'all'; renderDays(); renderResults(true); }));
  $('rNew').onchange = e => { R.onlyNew = e.target.checked; renderResults(true); };
  $('rMatch').onchange = e => { R.onlyMatch = e.target.checked; renderResults(true); };
  // выгрузки выбранного дня: «Все выгрузки за день» + по кнопке на каждую выгрузку
  const isDay = /^\d{4}-/.test(R.day);
  let ups = [];
  if (isDay) {
    const m = new Map();
    for (const x of R.rows) { if (upDay(x) !== R.day || (x.dupHidden && R.dedup) || x.archived || !inJob(x)) continue; const k = upKey(x); const t = x.exported || x.checked, u = m.get(k) || { k, t, n: 0 }; u.n++; u.t = Math.min(u.t, t); m.set(k, u); }
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
// адрес для показа: если в объявлении не было номера дома (или стояло метро), а Ozon определил дом по координатам — показываем его
function fixAddr(x) {
  const m = String(x.note || '').match(/(?:нет номера дома|адрес по координатам объявления) \(Ozon: ([^)]+)\)/);
  x.addrSrc = ''; x.noteShow = x.note || '';
  if (m && /\d/.test(m[1])) { x.addrSrc = x.address; x.address = m[1].trim().replace(/^город\s+/i, ''); x.noteShow = x.noteShow.replace(/(проверить вручную: в таблице нет номера дома|адрес по координатам объявления) \(Ozon: [^)]+\);?\s*/, '').trim(); x.byCoords = true; }
  return x;
}
function prepRows(rows) {
  R.sel = null;   // после перезагрузки списка старый номер строки указывал бы на другое объявление
  R.rows = rows.map((x, i) => Object.assign(x.addrSrc === undefined ? fixAddr(x) : x, { id: i, mark: R.marks[markKey(x)] ? 1 : 0 }));
  // отслеживаемые, которых уже нет в файлах результатов, — из сохранённой копии
  const have = new Set(R.rows.map(markKey));
  for (const [k, w] of Object.entries(R.watch)) if (!have.has(k) && w.row) { const r0 = Object.assign({}, w.row); R.rows.push(Object.assign(r0.addrSrc === undefined ? fixAddr(r0) : r0, { id: R.rows.length, mark: R.marks[k] ? 1 : 0, archived: true })); }
  // одинаковые помещения в один день: первое оставляем, остальные скрываем (переключатель «Скрыть одинаковые»)
  const firstOf = new Map(); R.dupCount = 0;
  [...R.rows].sort((a, b) => (a.exported || a.checked) - (b.exported || b.checked)).forEach(x => { const k = dupKey(x); if (firstOf.has(k)) { x.dupHidden = true; R.dupCount++; } else firstOf.set(k, x); });
  // одно и то же помещение в проверке Ozon и другой площадки
  const byMatch = new Map();
  for (const x of R.rows) { const k = matchKey(x); if (!byMatch.has(k)) byMatch.set(k, []); byMatch.get(k).push(x); }
  for (const x of R.rows) x.also = [...new Map(byMatch.get(matchKey(x)).filter(y => y.platform !== x.platform).map(y => [y.platform, y])).values()];
}
window.prepRows = prepRows;
// синхронизация с другим компьютером что-то поменяла — обновить открытую страницу
pvz.onSynced(async d => {
  const m = document.body.dataset.mode;
  if (m === 'results') { const c = await pvz.getCfg(); R.watch = c.resWatch || {}; R.watchDel = c.resWatchDel || {}; if (d.files) loadResults(); else { renderDays(); renderResults(false); } }
  if (m === 'jobs' && window.openJobs) openJobs(window.jobsOpenId && jobsOpenId());
  if (m === 'schedule') loadSchedule();
});
async function loadResults() {
  $('rCount').textContent = 'загрузка…';
  const r = await pvz.results();
  const cfg = await pvz.getCfg();
  if (R.showLst === undefined) { R.showLst = cfg.resShowLst != null ? (cfg.resShowLst && lstAuto()) || (cfg.resShowLst && window.innerWidth >= 1400) : lstAuto(); R.base = cfg.resBase || '2gis'; $('rBase').value = R.base; R.mapMode = cfg.resMap || 'yandex'; }
  setMapLists(cfg.resMapsGen, cfg.resMapsAgg);
  R.split = !!cfg.resSplit;   // «Разделить» — постоянная функция (была тестовой)
  R.testSup = cfg.testSupport !== false;
  R.marks = cfg.resMarks || {}; R.seen = cfg.resSeen || {}; R.watch = cfg.resWatch || {}; R.watchDel = cfg.resWatchDel || {}; if (cfg.resDedup === false) R.dedup = false;
  prepRows(r.rows);
  // заказы со своими папками — фильтр «Заказ»
  R.jobs = (await pvz.jobs().catch(() => [])).filter(j => !j.shared);
  const hasGen = R.rows.some(x => !x.job && !x.archived);
  if (R.jobF && R.jobF !== '-' && !R.jobs.some(j => j.id === R.jobF)) R.jobF = '';
  $('rJobF').style.display = R.jobs.length ? '' : 'none';
  $('rJob').innerHTML = '<option value="">все</option>' + (hasGen ? '<option value="-">общие папки</option>' : '') + R.jobs.map(j => `<option value="${esc(j.id)}">${esc(j.name)}${j.archived ? ' (архив)' : ''}</option>`).join('');
  $('rJob').value = R.jobF;
  renderDays();
  const zones = [...new Set(R.rows.map(x => x.platform + ' · ' + x.zone))].sort();
  const cur = $('rZone').value;
  $('rZone').innerHTML = '<option value="">все зоны</option>' + zones.map(z => `<option${z === cur ? ' selected' : ''}>${esc(z)}</option>`).join('');
  if (!R.map) {
    R.map = L.map('rMap', { zoomControl: true, attributionControl: true }).setView([55.75, 37.62], 10);
    R.tiles = baseTiles().addTo(R.map);
    R.layer = L.layerGroup().addTo(R.map);
  }
  setTimeout(fixMap, 50);
  renderResults(true);
  applyLst(); setMapMode(R.mapMode);
  if (r.errors.length) pvz.logError('результаты', r.errors.join('; '));
}
function filteredResults() {
  const plats = [...$('rPlat').querySelectorAll('input:checked')].map(i => i.value);
  const zone = $('rZone').value, area = numOf($('rArea')), price = numOf($('rPrice')), day = R.day;
  const q = $('rSearch').value.trim().toLowerCase();
  return R.rows.filter(x => plats.includes(x.platform) && inJob(x) && (!zone || zone === x.platform + ' · ' + x.zone)
    && !(R.dedup && x.dupHidden) && (!R.onlyNew || !R.seen[markKey(x)]) && (!R.onlyMatch || (x.also && x.also.length))
    && (R.up === 'all' || !/^\d{4}-/.test(day) || upKey(x) === R.up)
    && (day !== 'watch' || R.watch[markKey(x)]) && (day === 'watch' || !x.archived)
    && (area === '' || (x.areaMax ?? x.areaMin ?? 0) >= area) && (price === '' || x.price == null || x.price <= price)
    && (day === 'all' || day === 'watch' || (day === 'marked' ? x.mark : upDay(x) === day)) && (!q || (x.address + ' ' + x.metro + ' ' + x.source + ' ' + x.note).toLowerCase().includes(q)));
}
function renderResults(fit) {
  const list = filteredResults();
  const { k, dir } = R.sort;
  list.sort((a, b) => { const x = a[k], y = b[k]; if (x == null && y == null) return 0; if (x == null) return 1; if (y == null) return -1; return (typeof x === 'number' ? x - y : String(x).localeCompare(String(y), 'ru')) * dir; });
  R.list = list;
  document.querySelectorAll('.r-table th').forEach(th => th.classList.toggle('sorted', th.dataset.k === k));
  const shown = list.slice(0, 1000);
  const jf = R.jobF && R.jobF !== '-' ? (R.jobs.find(j => j.id === R.jobF) || {}).name : R.jobF === '-' ? 'общие папки' : '';
  $('rCount').textContent = `${fmtNum(list.length)} из ${fmtNum(R.rows.length)}` + (jf ? ' · ' + jf : '');
  filtCount();
  const area = x => x.areaMin == null ? '' : (x.areaMax && x.areaMax !== x.areaMin ? `${fmtNum(x.areaMin)}–${fmtNum(x.areaMax)}` : fmtNum(x.areaMin)) + ' м²';
  $('rRows').innerHTML = shown.map((x, i) => `<tr data-id="${x.id}" class="${x.mark ? 'marked' : ''}${x.id === R.sel ? ' sel' : ''}${R.seen[markKey(x)] ? '' : ' unseen'}${x.also && x.also.length ? ' multi' : ''}">
    <td class="num-c">${i + 1}</td><td>${esc(x.platform)}</td>
    <td>${zoneCell(x)}</td>
    <td class="addr">${R.seen[markKey(x)] ? '' : '<b class="new-dot" title="Ещё не просмотрено">●</b>'}<span class="addr-t">${esc(x.address)}</span><button class="copy-a" title="Скопировать адрес"><svg viewBox="0 0 24 24"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/></svg></button>${x.also && x.also.length ? x.also.map(y => `<span class="also" title="Это помещение есть и в проверке ${esc(y.platform)}"><i style="background:${zoneColor(y)}"></i>${esc(y.platform)}: ${esc(y.zone)}</span>`).join('') : ''}${x.archived ? '<span class="also">из архива</span>' : ''}${watchBadges(x)}${x.metro ? `<small>${esc(x.metro)}</small>` : ''}${x.noteShow ? `<small class="note">${esc(x.noteShow)}</small>` : ''}</td>
    <td class="n">${area(x)}</td><td class="n flats" data-flats="${x.id}">${flatsCell(x)}</td><td class="n">${x.price != null ? fmtNum(x.price) + ' ₽' : ''}${x.money ? `<small class="pay">выплата ${fmtNum(x.money)} ₽</small>` : ''}</td>
    <td>${fmtTime(x.checked)}</td><td class="acts">${x.url ? '<a class="open" href="#" title="Открыть объявление в браузере">↗</a>' : ''}<button class="star${R.watch[markKey(x)] ? ' on' : ''}" title="${R.watch[markKey(x)] ? 'Убрать из отслеживаемых' : 'Отслеживать'}">${R.watch[markKey(x)] ? '★' : '☆'}</button></td><td class="mk"><label class="mbox"><input type="checkbox"${x.mark ? ' checked' : ''}><span></span></label></td></tr>`).join('');
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
  // карта с точками может быть скрыта (выбрана другая карта) — тогда подогнать при показе
  if (fit && pts.length) { if (mapOn()) R.map.fitBounds(pts, { padding: [30, 30], maxZoom: 14 }); else R.fitLater = pts; }
  renderDetail();
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
// карта «Точки результатов» видна? (у скрытой Leaflet считает размеры от нуля — NaN)
const mapOn = () => !!R.map && $('rMap').offsetWidth > 0 && $('rMap').offsetHeight > 0;
function fixMap() { if (!mapOn()) return; R.map.invalidateSize(); if (R.fitLater) { R.map.fitBounds(R.fitLater, { padding: [30, 30], maxZoom: 14 }); R.fitLater = null; } }
const rectOf = id => { const b = $(id).getBoundingClientRect(); return { x: b.left, y: b.top, width: b.width, height: b.height }; };
const ozRect = () => rectOf('rOzHost');
// справа карты: обычная (точки / Яндекс / 2ГИС / OSM) или карта площадки (Ozon / WB / Яндекс Маркет);
// тест «Разделить»: сверху карта площадки, снизу обычная
const AGG = ['ozon', 'wb', 'ym'], GEN_EXT = ['yandex', '2gis', 'osm'];
R.mapMode = 'yandex'; R.gen = 'yandex'; R.agg = 'ozon'; R.split = false;
// какие карты в списках над картой — выбираются в «Настройки → Карты в «Результатах»» (по умолчанию Яндекс.Карты и Ozon)
const MAPS_GEN = [['yandex', 'Яндекс.Карты'], ['2gis', '2ГИС'], ['osm', 'OpenStreetMap'], ['res', 'Точки результатов']];
const MAPS_AGG = [['ozon', 'Ozon'], ['wb', 'Wildberries'], ['ym', 'Яндекс Маркет']];
const DEF_MAPS_GEN = ['yandex'], DEF_MAPS_AGG = ['ozon'];
R.mapsGen = DEF_MAPS_GEN.slice(); R.mapsAgg = DEF_MAPS_AGG.slice();
function setMapLists(gen, agg) {
  R.mapsGen = MAPS_GEN.map(m => m[0]).filter(k => (gen && gen.length ? gen : DEF_MAPS_GEN).includes(k));
  R.mapsAgg = MAPS_AGG.map(m => m[0]).filter(k => (agg && agg.length ? agg : DEF_MAPS_AGG).includes(k));
  if (!R.mapsGen.includes(R.gen)) R.gen = R.mapsGen[0];
  if (!R.mapsAgg.includes(R.agg)) R.agg = R.mapsAgg[0];
  $('rMapSel').innerHTML = MAPS_GEN.filter(m => R.mapsGen.includes(m[0])).map(([k, n]) => `<option value="${k}">${n}</option>`).join('');
  $('rAggSel').innerHTML = MAPS_AGG.filter(m => R.mapsAgg.includes(m[0])).map(([k, n]) => `<option value="${k}">${n}</option>`).join('');
  $('rMapSel').value = R.gen; $('rAggSel').value = R.agg;
}
window.setMapLists = setMapLists;
setMapLists();
const extPoint = x => x && x.lat != null ? { lat: x.lat, lon: x.lon } : null;
const shown = () => R.mapMode === 'lst' ? { agg: null, gen: null, lst: true } : R.split ? { agg: R.agg, gen: R.gen } : AGG.includes(R.mapMode) ? { agg: R.mapMode, gen: null } : { agg: null, gen: R.mapMode };
// «Карта | Ozon | Объявление» — одно место, одно нажатие: обычная карта, карта площадки или сайт объявления
const AGG_SHORT = { ozon: 'Ozon', wb: 'WB', ym: 'Маркет' };
function paintView() {
  const s = shown(), v = s.lst ? 'lst' : R.split ? '' : s.agg ? 'agg' : 'gen';
  $('rView').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.v === v));
  $('rView').querySelector('[data-v=agg]').textContent = AGG_SHORT[R.agg] || 'Ozon';
  // списки карт нужны, только когда в настройках включено больше одной
  $('rMapSel').style.display = R.mapsGen.length > 1 ? '' : 'none'; $('rAggSel').style.display = R.mapsAgg.length > 1 ? '' : 'none';
}
function setView(v) {
  if (R.split) { R.split = false; pvz.setCfg({ resSplit: false }); }
  if (v !== 'lst') { setMapMode(v === 'agg' ? R.agg : R.gen); return; }
  // сайт объявления на месте карты (отдельная колонка при этом не нужна)
  if (R.showLst) { R.showLst = false; pvz.setCfg({ resShowLst: false }); applyLst(); }
  R.mapMode = 'lst'; R.ozon = false; pvz.setCfg({ resMap: 'lst' });
  layoutMaps(); showLstIn(R.sel != null ? R.rows[R.sel] : null);
}
async function showLstIn(x) {
  const w = $('rLstIn').querySelector('.oz-wait');
  if (!x || !x.url) { pvz.extRect('listing', null); w.textContent = x ? 'У объявления нет ссылки' : 'Выберите объявление в таблице'; return; }
  w.textContent = 'Загружаю объявление…';
  await new Promise(r => requestAnimationFrame(r));
  await pvz.extShow('listing', rectOf('rLstIn'), x.url);
  zoomShow('listing'); syncRects();
}
$('rView').querySelectorAll('button').forEach(b => (b.onclick = () => setView(b.dataset.v)));
function setMapMode(m) {
  if (m === 'lst') return setView('lst');
  // карта, убранная в настройках, — заменяется первой из включённых того же вида
  if (AGG.includes(m) ? !R.mapsAgg.includes(m) : !R.mapsGen.includes(m)) m = AGG.includes(m) ? R.mapsAgg[0] : R.mapsGen[0];
  if (AGG.includes(m)) R.agg = m; else R.gen = m;
  R.mapMode = m; R.ozon = m === 'ozon';
  $('rAggSel').value = R.agg; $('rMapSel').value = R.gen;
  pvz.setCfg({ resMap: m });
  layoutMaps();
  const x = R.sel != null ? R.rows[R.sel] : null;
  if (!x) { $('rOzQ').textContent = ''; showIdleMaps(); return; }
  showOnMap(x);
}
// объявление ещё не выбрано — всё равно открыть выбранные карты (раньше они не показывались и висело «Загружаю карту…»)
async function showIdleMaps() {
  if (document.body.dataset.mode !== 'results') return;
  const s = shown(); await new Promise(r => requestAnimationFrame(r));
  if (s.agg === 'ozon') pvz.ozonMapShow(null, null).then(syncRects);
  else if (s.agg && s.agg !== 'ym') pvz.extShow(s.agg, null, null).then(syncRects);
  if (GEN_EXT.includes(s.gen)) pvz.extShow(s.gen, null, null).then(syncRects);
}
// карта не загрузилась — показать причину вместо вечного «Загружаю карту…»
R.fail = {};
const hostOf = k => (k === 'ozon' || AGG.includes(k)) ? 'rOzHost' : GEN_EXT.includes(k) ? 'rGenHost' : k === 'listing' ? 'rLstHost' : null;
pvz.onMapFail(d => {
  R.fail[d.key] = d.why; const h = d.key === 'listing' && R.mapMode === 'lst' ? 'rLstIn' : hostOf(d.key); if (!h) return;
  const w = $(h).querySelector('.oz-wait');
  if (w) w.textContent = d.why ? `Карта не загрузилась: ${d.why}. Проверьте интернет и VPN, затем нажмите ↻ над картой.` : (h === 'rLstHost' ? 'Выберите объявление в таблице' : 'Загружаю карту…');
  syncRects();
});
// карта Яндекс Маркета: своя карта (проекция Яндекса EPSG:3395) — подложка Яндекс.Карт + слои зон ПВЗ Маркета
// (те же тайлы, что читает проверка: available_v2, only_subsidy_v2, security) и точка выбранного объявления
let ymMap = null, ymMarker = null;
function ymInit() {
  if (ymMap) return ymMap;
  ymMap = L.map('rYmMap', { crs: L.CRS.EPSG3395, zoomControl: true }).setView([55.75, 37.62], 12);
  L.tileLayer('https://core-renderer-tiles.maps.yandex.net/tiles?l=map&x={x}&y={y}&z={z}&scale=1&lang=ru_RU', { maxZoom: 19, attribution: '© Яндекс' }).addTo(ymMap);
  const ov = { 'Зоны ПВЗ': 'available_v2', 'Только субсидия': 'only_subsidy_v2', 'Охранные (красные)': 'security' }, layers = {};
  for (const [name, l] of Object.entries(ov)) layers[name] = L.tileLayer(`https://tiles.s3.yandex.net/RU/${l}/{z}/{x}/{y}.png`, { maxNativeZoom: 13, maxZoom: 19, opacity: .75, errorTileUrl: 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==' }).addTo(ymMap);
  L.control.layers(null, layers, { collapsed: true }).addTo(ymMap);
  return ymMap;
}
function ymShow(x) {
  const m = ymInit(); setTimeout(() => m.invalidateSize(), 30);
  if (!x || x.lat == null) { $('rOzQ').textContent = 'У объявления нет координат'; return; }
  if (ymMarker) ymMarker.remove();
  ymMarker = L.marker([x.lat, x.lon]).addTo(m).bindPopup(`<b>${esc(x.address)}</b>${x.platform === 'Яндекс' ? '<br>' + esc(x.zone) : ''}`).openPopup();
  m.setView([x.lat, x.lon], 16);
  $('rOzQ').textContent = '';
}
function layoutMaps() {
  const s = shown(), live = !!s.agg || GEN_EXT.includes(s.gen);
  $('rMapArea').classList.toggle('split', R.split);
  $('rOzHost').style.display = s.agg && s.agg !== 'ym' ? 'block' : 'none';
  $('rYmMap').style.display = s.agg === 'ym' ? '' : 'none'; if (s.agg === 'ym') { ymInit(); setTimeout(() => ymMap.invalidateSize(), 50); }
  $('rMap').style.display = s.gen === 'res' ? '' : 'none';
  $('rGenHost').style.display = GEN_EXT.includes(s.gen) ? 'block' : 'none';
  $('rLstIn').style.display = s.lst ? 'block' : 'none'; paintView();
  $('rAggSel').classList.toggle('active', !!s.agg); $('rMapSel').classList.toggle('active', !!s.gen);
  $('rSplit').classList.toggle('on', R.split); if (!R.split) { $('rOzHost').style.flex = ''; $('rMap').style.flex = ''; $('rGenHost').style.flex = ''; } setTimeout(restoreSizes, 0);
  $('rOzReload').style.display = live ? '' : 'none'; $('rBase').style.display = s.gen === 'res' ? '' : 'none'; $('rMapZoom').style.display = live ? '' : 'none';
  $('rMapZoom').dataset.zoom = s.agg === 'ozon' ? 'ozonmap' : (s.agg && s.agg !== 'ym' ? s.agg : s.gen);
  if (s.agg === 'ym' && !GEN_EXT.includes(s.gen)) { $('rMapZoom').style.display = 'none'; $('rOzReload').style.display = 'none'; }
  // «Разделить»: у верхней карты (площадка) и нижней (Яндекс / 2ГИС / OSM) — свой масштаб
  const both = R.split && s.agg && s.agg !== 'ym' && GEN_EXT.includes(s.gen);
  $('rMapZoom2').style.display = both ? '' : 'none'; $('rMapZoom2').dataset.zoom = s.gen;
  if (both) { $('rMapZoom').dataset.zoom = s.agg === 'ozon' ? 'ozonmap' : s.agg; $('rMapZoom').title = 'Масштаб верхней карты'; }
  else if (R.split && s.agg === 'ym' && GEN_EXT.includes(s.gen)) { $('rMapZoom').style.display = ''; $('rMapZoom').dataset.zoom = s.gen; }
  if (!live) $('rOzQ').textContent = '';
  if (s.lst) { $('rMapZoom').style.display = ''; $('rMapZoom').dataset.zoom = 'listing'; $('rOzReload').style.display = ''; $('rMapZoom2').style.display = 'none'; }
  if (live && R.sel == null) showIdleMaps();
  setTimeout(() => { fixMap(); syncRects(); }, 40);
}
async function showOnMap(x) {
  const s = shown(), q = ozQuery(x);
  if (s.lst) return showLstIn(x);
  if (s.agg === 'ym') ymShow(x);
  if (!(s.agg && s.agg !== 'ym') && !GEN_EXT.includes(s.gen)) return;
  $('rOzQ').textContent = '';   // строка над картой — только для ошибок (иначе карта «прыгает»)
  await new Promise(r => requestAnimationFrame(r));
  const jobs = [];
  if (s.agg === 'ozon') jobs.push(pvz.ozonMapShow(rectOf('rOzHost'), q));
  else if (s.agg && s.agg !== 'ym') jobs.push(pvz.extShow(s.agg, rectOf('rOzHost'), q, extPoint(x)));
  if (GEN_EXT.includes(s.gen)) jobs.push(pvz.extShow(s.gen, rectOf('rGenHost'), q, extPoint(x)));
  const res = (await Promise.all(jobs))[0];
  if (R.rows[R.sel] !== x) return;
  zoomShow($('rMapZoom').dataset.zoom); if ($('rMapZoom2').style.display !== 'none') zoomShow($('rMapZoom2').dataset.zoom); syncRects();
  if (!res || res.ok) $('rOzQ').textContent = res && res.how === 'enter' ? q + ' (подсказка не появилась — нажат Enter)' : '';
  else { $('rOzQ').textContent = 'Не удалось ввести адрес (' + (res.why || 'ошибка') + ') — он скопирован, вставьте в поиск Ctrl+V'; navigator.clipboard && navigator.clipboard.writeText(q).catch(() => {}); }
}
const showOnOzon = x => showOnMap(x);
$('rMapSel').onchange = () => setMapMode($('rMapSel').value);
$('rAggSel').onchange = () => setMapMode($('rAggSel').value);
$('rMapSel').addEventListener('mousedown', () => { if (!$('rMapSel').classList.contains('active')) setMapMode($('rMapSel').value); });
$('rAggSel').addEventListener('mousedown', () => { if (!$('rAggSel').classList.contains('active')) setMapMode($('rAggSel').value); });
$('rSplit').onclick = () => { if (R.mapMode === 'lst') { R.mapMode = R.gen; } R.split = !R.split; pvz.setCfg({ resSplit: R.split }); layoutMaps(); const x = R.rows[R.sel]; if (x) showOnMap(x); };
$('rOzReload').onclick = async () => { const s = shown(); R.fail = {}; if (s.lst) { await pvz.extReload('listing'); syncRects(); return; } document.querySelectorAll('#rOzHost .oz-wait, #rGenHost .oz-wait').forEach(w => (w.textContent = 'Загружаю карту…')); if (s.agg === 'ozon') await pvz.ozonMapReload(); else if (s.agg) await pvz.extReload(s.agg); if (GEN_EXT.includes(s.gen)) await pvz.extReload(s.gen); const x = R.rows[R.sel]; if (x) setTimeout(() => showOnMap(x), 1800); };
// сайт объявления — средняя колонка
function lstAuto() { return window.innerWidth >= 1700; }
function applyLst() {
  const on = R.showLst; $('rShowLst').checked = on;
  document.querySelector('.r-body').classList.toggle('with-lst', on); restoreSizes();
  setTimeout(() => { fixMap(); syncRects(); }, 60);
  if (on && R.sel != null) showListing(R.rows[R.sel]);
}
async function showListing(x) {
  if (!R.showLst || !x) return;
  if (!x.url) { pvz.extRect('listing', null); $('rLstQ').textContent = 'у объявления нет ссылки'; return; }
  $('rLstQ').textContent = x.address;
  await new Promise(r => requestAnimationFrame(r));
  await pvz.extShow('listing', rectOf('rLstHost'), x.url);
  zoomShow('listing'); syncRects();
}
$('rShowLst').onchange = () => { if ($('rShowLst').checked && R.mapMode === 'lst') setMapMode(R.gen); R.showLst = $('rShowLst').checked; pvz.setCfg({ resShowLst: R.showLst }); applyLst(); };
$('rLstExt').onclick = () => { const x = R.rows[R.sel]; if (x && x.url) pvz.openExternal(x.url); };
// встроенные сайты — точно на свои места (или спрятать)
const modalIsOpen = () => $('modal').open;
const visRect = id => { const e = $(id); if (!e || !e.getClientRects().length || getComputedStyle(e).display === 'none') return null; const r = rectOf(id); return r.width > 50 && r.height > 50 ? r : null; };
function syncRects() {
  // встроенные карты рисуются поверх страницы — прячем их, пока открыто окно или меню
  const away = document.body.dataset.mode !== 'results' || modalIsOpen() || R.dragging || $('rMoreMenu').matches(':popover-open') || $('rColsMenu').matches(':popover-open');
  const s = shown(), has = R.sel != null && !away;
  const full = document.querySelector('.r-body .full');
  const fit = id => (!full || full.contains($(id))) ? visRect(id) : null;
  // карты видны и без выбранного объявления; сайт объявления — только когда оно выбрано; не загрузившаяся карта прячется (видна причина)
  const vis = (id, k) => !away && !R.fail[k] ? fit(id) : null;
  pvz.ozonMapRect(s.agg === 'ozon' ? vis('rOzHost', 'ozon') : null);
  pvz.extRect('wb', s.agg === 'wb' ? vis('rOzHost', 'wb') : null); pvz.extRect('ym', null);
  for (const k of GEN_EXT) pvz.extRect(k, s.gen === k ? vis('rGenHost', k) : null);
  pvz.extRect('listing', s.lst ? (has && R.rows[R.sel] && R.rows[R.sel].url && !R.fail.listing ? fit('rLstIn') : null) : R.showLst && has ? fit('rLstHost') : null);
}
['rOzHost', 'rGenHost', 'rLstHost', 'rLstIn', 'rMapArea', 'rDetail'].forEach(id => new ResizeObserver(syncRects).observe($(id)));
window.addEventListener('resize', syncRects);
new MutationObserver(() => setTimeout(() => { syncRects(); if (document.body.dataset.mode === 'results' && R.sel == null && R.map) showIdleMaps(); }, 50)).observe(document.body, { attributes: true, attributeFilter: ['data-mode'] });
new MutationObserver(syncRects).observe($('modal'), { attributes: true, attributeFilter: ['class', 'open'] });
// во весь экран: сайт объявления или карты; выход — кнопкой или Esc
function setFull(id) {
  document.querySelectorAll('.r-body .full').forEach(e => e.classList.remove('full'));
  if (id) $(id).classList.add('full');
  document.body.classList.toggle('r-full', !!id);
  setTimeout(() => { fixMap(); syncRects(); }, 40);
}
document.querySelectorAll('.fs-btn').forEach(b => (b.onclick = () => setFull($(b.dataset.fs).classList.contains('full') ? null : b.dataset.fs)));
$('fsExit').onclick = () => setFull(null);
document.addEventListener('keydown', e => { if (e.key === 'Escape' && document.body.classList.contains('r-full')) setFull(null); });
$('rBase').onchange = () => { R.base = $('rBase').value; pvz.setCfg({ resBase: R.base }); if (R.map) { R.map.removeLayer(R.tiles); R.tiles = baseTiles().addTo(R.map); } };
function baseTiles() {
  return R.base === 'osm' ? L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap', maxZoom: 19 })
    : L.tileLayer('https://tile{s}.maps.2gis.com/tiles?x={x}&y={y}&z={z}&v=1', { attribution: '© 2ГИС', subdomains: '0123', maxZoom: 18 });
}
// размеры панелей мышкой: ручки между таблицей, сайтом и картой (и между картами при «Разделить»)
// во время перетаскивания встроенные сайты прячутся, чтобы мышь не «застревала» над ними
function placeSplitters() {
  const body = document.querySelector('.r-body'); if (!body || document.body.dataset.mode !== 'results') return;
  const cols = [body.querySelector('.r-table-wrap'), R.showLst ? $('rLstCol') : null, $('rMapCol')].filter(Boolean);
  const br = body.getBoundingClientRect();
  body.querySelectorAll('.split-h').forEach(h => h.remove());
  for (let i = 0; i < cols.length - 1; i++) {
    const r = cols[i].getBoundingClientRect(), h = document.createElement('div');
    h.className = 'split-h'; h.style.left = (r.right - br.left + 1) + 'px'; h.title = 'Потяните, чтобы изменить ширину';
    h.onmousedown = e => startDrag(e, 'x', i, cols); body.appendChild(h);
  }
  const area = $('rMapArea'); area.querySelectorAll('.split-v').forEach(h => h.remove());
  if (R.split) {
    const top = shown().agg === 'ym' ? $('rYmMap') : $('rOzHost'), ar = area.getBoundingClientRect(), tr = top.getBoundingClientRect(), h = document.createElement('div');
    h.className = 'split-v'; h.style.top = (tr.bottom - ar.top + 1) + 'px'; h.title = 'Потяните, чтобы изменить высоту';
    h.onmousedown = e => startDrag(e, 'y', 0, [top, top.nextElementSibling.style.display === 'none' ? $('rGenHost') : $('rMap')]); area.appendChild(h);
  }
}
function startDrag(e, axis, i, els) {
  e.preventDefault(); R.dragging = true; syncRects();
  const sizes = els.map(el => axis === 'x' ? el.getBoundingClientRect().width : el.getBoundingClientRect().height);
  const start = axis === 'x' ? e.clientX : e.clientY, MIN = axis === 'x' ? 240 : 120;
  const ov = document.createElement('div'); ov.className = 'drag-ov ' + axis; document.body.appendChild(ov);
  const apply = s => {
    if (axis === 'x') document.querySelector('.r-body').style.gridTemplateColumns = s.map(w => `minmax(0,${w.toFixed(0)}fr)`).join(' ');
    else { els[0].style.flex = `${s[0].toFixed(0)} 1 0`; els[1].style.flex = `${s[1].toFixed(0)} 1 0`; }
  };
  const move = ev => {
    const d = (axis === 'x' ? ev.clientX : ev.clientY) - start, s = sizes.slice();
    const dd = Math.max(MIN - s[i], Math.min(s[i + 1] - MIN, d)); s[i] += dd; s[i + 1] -= dd; apply(s); R.sizesNow = s;
    fixMap();
  };
  const up = () => {
    document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); ov.remove();
    R.dragging = false;
    if (R.sizesNow) { const k = axis === 'y' ? 'resSizesV' : R.showLst ? 'resSizes3' : 'resSizes2'; pvz.setCfg({ [k]: R.sizesNow }); R.sizesNow = null; }
    placeSplitters(); syncRects(); setTimeout(() => fixMap(), 30);
  };
  document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
}
async function restoreSizes() {
  const c = await pvz.getCfg(), s = R.showLst ? c.resSizes3 : c.resSizes2, body = document.querySelector('.r-body');
  body.style.gridTemplateColumns = s && s.length === (R.showLst ? 3 : 2) ? s.map(w => `minmax(0,${Math.round(w)}fr)`).join(' ') : '';
  if (c.resSizesV && R.split) { $('rOzHost').style.flex = `${Math.round(c.resSizesV[0])} 1 0`; ($('rMap').style.display === 'none' ? $('rGenHost') : $('rMap')).style.flex = `${Math.round(c.resSizesV[1])} 1 0`; }
  setTimeout(() => { placeSplitters(); syncRects(); fixMap(); }, 50);
}
new ResizeObserver(() => placeSplitters()).observe(document.querySelector('.r-body'));
// отметить все видимые (вкладка дня / выгрузка / фильтры) как просмотренные
$('rSeenAll').onclick = () => { closeMore(); markAllSeen(); };
$('rDedup').onchange = e => { R.dedup = e.target.checked; pvz.setCfg({ resDedup: R.dedup }); renderDays(); renderResults(true); };
// меню «⋯»: пока открыто, встроенные карты и сайт прячутся (иначе они перекрыли бы меню)
// меню «⋯» — встроенная всплывающая панель: открывается кнопкой (command), закрывается щелчком мимо и Esc
const moreOpen = () => $('rMoreMenu').matches(':popover-open');
function closeMore() { if (moreOpen()) $('rMoreMenu').hidePopover(); }
['rMoreMenu', 'rColsMenu'].forEach(id => $(id).addEventListener('toggle', () => syncRects()));
function markAllSeen() {
  const now = Date.now(); let n = 0;
  for (const x of R.list) { const k = markKey(x); if (!R.seen[k]) { R.seen[k] = now; n++; } }
  if (!n) return;
  pvz.setCfg({ resSeen: R.seen }); renderDays(); renderResults(false);
}
function selectRow(id, fly) {
  R.sel = id; { const x = R.rows[id]; if (x && x.lat != null && (x.flats === undefined || (x.flats && (x.flats.err || (!x.flats.exact && !x.flats.mk))))) pvz.flats(x.lat, x.lon, ozQuery(x)).then(f => { x.flats = f || { n: null }; paintFlats(x); }).catch(() => {}); }
  if (R.rows[id]) markSeen(R.rows[id], document.querySelector(`#rRows tr[data-id="${id}"]`));
  renderDetail();
  showOnMap(R.rows[id]);
  if (R.showLst) showListing(R.rows[id]);
  document.querySelectorAll('#rRows tr.sel').forEach(t => t.classList.remove('sel'));
  const tr = document.querySelector(`#rRows tr[data-id="${id}"]`);
  if (tr) { tr.classList.add('sel'); if (!fly) tr.scrollIntoView({ block: 'nearest' }); }
  const m = R.markers.get(id);
  if (m && fly && mapOn()) { R.map.flyTo(m.getLatLng(), Math.max(R.map.getZoom(), 15), { duration: .6 }); m.openPopup(); }
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
    toggleWatch(x); renderDays(); renderResults(false); return;
  }
  const cb = e.target.closest('.copy-a');
  if (cb) {
    navigator.clipboard.writeText(x.address).catch(() => {});
    const t = document.createElement('span'); t.className = 'copied'; t.textContent = 'Скопировано в буфер обмена'; cb.appendChild(t); setTimeout(() => t.remove(), 1500);
    return;
  }
  markSeen(x, tr);
  if (e.target.closest('a.open')) { e.preventDefault(); pvz.openExternal(x.url); return; }
  selectRow(x.id, true);
});
$('rMap').addEventListener('click', e => { const a = e.target.closest('a[data-url]'); if (a) { e.preventDefault(); pvz.openExternal(a.dataset.url); } });
document.querySelectorAll('.r-table th[data-k]').forEach(th => (th.onclick = () => { R.sort = { k: th.dataset.k, dir: R.sort.k === th.dataset.k ? -R.sort.dir : (['price', 'areaMin', 'zone', 'address', 'platform'].includes(th.dataset.k) ? 1 : -1) }; renderResults(false); }));
['rZone'].forEach(id => ($(id).onchange = () => renderResults(true)));
$('rJob').onchange = () => { R.jobF = $('rJob').value; R.up = 'all'; renderDays(); renderResults(true); };
['rArea', 'rPrice', 'rSearch'].forEach(id => $(id).addEventListener('input', () => renderResults(false)));
$('rPlat').querySelectorAll('input').forEach(i => (i.onchange = () => renderResults(true)));
$('rReload').onclick = () => loadResults();
// ---------- отслеживаемые: статус и заметка (общие для компьютеров при синхронизации) ----------
const STATUSES = { call: 'Позвонил', view: 'Просмотр назначен', no: 'Отказ' };
const saveWatch = () => pvz.setCfg({ resWatch: R.watch, resWatchDel: R.watchDel || {} });
function toggleWatch(x) {
  const k = markKey(x); R.watchDel = R.watchDel || {};
  // удаление запоминается со временем — чтобы синхронизация не вернула объявление с другого компьютера
  if (R.watch[k]) { delete R.watch[k]; R.watchDel[k] = Date.now(); } else { const row = Object.assign({}, x); delete row.also; delete row.id; delete row.flats; R.watch[k] = { added: Date.now(), row }; }
  saveWatch();
}
// статус или заметка: объявление само попадает в отслеживаемые
function watchPatch(x, patch) {
  const k = markKey(x);
  if (!R.watch[k]) { const row = Object.assign({}, x); delete row.also; delete row.id; delete row.flats; R.watch[k] = { added: Date.now(), row }; }
  Object.assign(R.watch[k], patch, { upd: Date.now() });
  saveWatch();
}
function watchBadges(x) {
  const w = R.watch[markKey(x)]; if (!w) return '';
  const pc = w.pc || {};
  return (w.status && STATUSES[w.status] ? `<span class="st-b st-${w.status}">${STATUSES[w.status]}</span>` : '')
    + (pc.gone ? '<span class="st-b st-no" title="Объявление снято с публикации">снято</span>' : pc.was && pc.price && pc.was !== pc.price ? `<span class="st-b ${pc.price < pc.was ? 'st-down' : 'st-up'}" title="Цена была ${fmtNum(pc.was)} ₽, стала ${fmtNum(pc.price)} ₽">${pc.price < pc.was ? '↓' : '↑'} ${fmtNum(pc.price)} ₽</span>` : '')
    + (w.note ? `<span class="nt-b" title="${esc(w.note)}">✎</span>` : '');
}
// ---------- карточка выбранного объявления (под картой) ----------
function renderDetail() {
  const el = $('rDetail'), x = R.sel != null ? R.rows[R.sel] : null;
  const was = el.classList.contains('on');
  if (!x) { el.classList.remove('on'); el.innerHTML = ''; if (was) setTimeout(syncRects, 30); return; }
  const k = markKey(x), w = R.watch[k] || {}, pc = w.pc || {};
  if (R.watch[k] && pc.changedAt && !pc.seen) { R.watch[k].pc.seen = true; saveWatch(); }
  const area = x.areaMin == null ? '—' : (x.areaMax && x.areaMax !== x.areaMin ? `${fmtNum(x.areaMin)}–${fmtNum(x.areaMax)}` : fmtNum(x.areaMin)) + ' м²';
  const fact = (t, v, sub) => `<div><small>${t}</small><b>${v}</b>${sub ? `<small>${sub}</small>` : ''}</div>`;
  const sup = x.platform === 'Ozon' && x.supMonth != null ? fact('Поддержка Ozon', x.supMonth ? fmtNum(x.supMonth) + ' ₽/мес' : 'нет', (x.supTotal ? 'всего ' + fmtNum(x.supTotal) + ' ₽ · ' : '') + esc(x.supTier || '')) : '';
  const price = pc.gone ? fact('Цена', x.price != null ? fmtNum(x.price) + ' ₽' : '—', '<em class="rd-gone">объявление снято</em>')
    : pc.was && pc.price && pc.was !== pc.price ? fact('Цена', fmtNum(pc.price) + ' ₽', `<em class="${pc.price < pc.was ? 'rd-down' : 'rd-up'}">была ${fmtNum(pc.was)} ₽</em>`)
    : fact('Цена', x.price != null ? fmtNum(x.price) + ' ₽' : '—', x.price != null ? 'в месяц' : '');
  el.innerHTML = `<div class="rd-top"><span class="zb"><i style="background:${zoneColor(x)}"></i>${esc(x.platform)} · ${esc(x.zone)}</span><b class="rd-addr" title="${esc(x.address)}">${esc(x.address)}</b></div>
    <div class="rd-meta">${[x.metro, x.source, x.date ? 'объявление от ' + x.date : '', (x.also || []).map(y => `${y.platform}: ${y.zone}`).join(', ')].filter(Boolean).map(esc).join(' · ')}</div>
    <div class="rd-facts">${fact('Площадь', area)}${price}${sup}${x.money ? fact('Выплата', fmtNum(x.money) + ' ₽') : ''}${x.lat != null ? `<div><small>Квартир в доме</small><b id="rdFlats">${flatsCell(x) || '—'}</b></div>` : ''}${x.near != null ? fact('Ближайший ПВЗ Ozon', fmtNum(x.near) + ' м') : ''}
      <span class="rd-btns"><button class="ghost sm${R.watch[k] ? ' on' : ''}" id="rdStar">${R.watch[k] ? '★ Отслеживается' : '☆ Отслеживать'}</button>${x.url ? '<button class="ghost sm" id="rdOpen">Открыть ↗</button>' : ''}</span></div>
    ${x.noteShow || x.byCoords ? `<div class="rd-note" title="${esc(x.note || '')}">${esc([x.byCoords ? `адрес определён по координатам объявления${x.addrSrc ? ' (в объявлении: ' + x.addrSrc + ')' : ''}` : '', x.noteShow].filter(Boolean).join(' · '))}</div>` : ''}
    <div class="rd-act"><select id="rdStatus" title="Статус — виден на всех компьютерах"><option value="">Без статуса</option>${Object.entries(STATUSES).map(([v, t]) => `<option value="${v}"${w.status === v ? ' selected' : ''}>${t}</option>`).join('')}</select>
      <input id="rdNote" type="text" placeholder="Заметка — с кем говорили, условия…" value="${esc(w.note || '')}"></div>`;
  el.classList.add('on');
  const rowUpd = () => { const tr = document.querySelector(`#rRows tr[data-id="${x.id}"]`); if (tr) { tr.querySelectorAll('.st-b,.nt-b').forEach(e => e.remove()); const a = tr.querySelector('.addr-t'); if (a) { const t = document.createElement('template'); t.innerHTML = watchBadges(x); (tr.querySelector('.copy-a') || a).after(t.content); } const st = tr.querySelector('.star'); if (st) { st.classList.toggle('on', !!R.watch[k]); st.textContent = R.watch[k] ? '★' : '☆'; } } renderDays(); };
  $('rdStatus').onchange = () => { watchPatch(x, { status: $('rdStatus').value }); rowUpd(); const b = $('rdStar'); b.classList.add('on'); b.textContent = '★ Отслеживается'; };
  $('rdNote').onchange = () => { const v = $('rdNote').value.trim(); if (!v && !R.watch[k]) return; watchPatch(x, { note: v }); rowUpd(); const b = $('rdStar'); b.classList.add('on'); b.textContent = '★ Отслеживается'; };
  // Enter — сохранить заметку (кроме подтверждения слова в методе ввода — isComposing)
  $('rdNote').onkeydown = e => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); $('rdNote').blur(); } };
  $('rdStar').onclick = () => { toggleWatch(x); rowUpd(); renderDetail(); if (R.day === 'watch') renderResults(false); };
  if ($('rdOpen')) $('rdOpen').onclick = () => pvz.openExternal(x.url);
  if (!was) setTimeout(syncRects, 30);
}
// ---------- «Фильтры»: площадки, заказ, зона, площадь, цена — под одной кнопкой ----------
function filtCount() {
  const n = ($('rPlat').querySelectorAll('input:not(:checked)').length ? 1 : 0) + (R.jobF ? 1 : 0) + ($('rZone').value ? 1 : 0) + (numOf($('rArea')) !== '' ? 1 : 0) + (numOf($('rPrice')) !== '' ? 1 : 0);
  $('rFiltN').textContent = n || ''; $('rFiltBtn').classList.toggle('active', n > 0);
}
$('rFiltBtn').onclick = () => { const on = $('rFilters').classList.toggle('on'); $('rFiltBtn').classList.toggle('open', on); pvz.setCfg({ resFiltOpen: on }); setTimeout(() => { fixMap(); syncRects(); }, 60); };
$('rFiltReset').onclick = () => { $('rPlat').querySelectorAll('input').forEach(i => (i.checked = true)); R.jobF = ''; $('rJob').value = ''; $('rZone').value = ''; $('rArea').value = ''; $('rPrice').value = ''; R.up = 'all'; renderDays(); renderResults(true); };
pvz.getCfg().then(c => { if (c.resFiltOpen) { $('rFilters').classList.add('on'); $('rFiltBtn').classList.add('open'); } });
// зона или (тестовая функция) поддержка Ozon под площадь объявления
function zoneCell(x) {
  if (R.testSup && x.platform === 'Ozon' && x.supMonth != null) {
    const t = `Зона: ${x.zone}. Ступень ${x.supTier}${x.supTotal ? ', всего ' + fmtNum(x.supTotal) + ' ₽' : ''}`;
    return `<span class="zb" title="${esc(t)}"><i style="background:${zoneColor(x)}"></i>${x.supMonth ? fmtNum(x.supMonth) + ' ₽/мес' : 'нет поддержки'}</span>${x.supMonth ? '' : `<small>${esc(x.supTier)}</small>`}`;
  }
  return `<span class="zb"><i style="background:${zoneColor(x)}"></i>${esc(x.zone)}</span>`;
}
// квартир в доме (OpenStreetMap): сначала из кэша, по выбору строки — запрос; видимые строки догружаются по одной
function flatsCell(x) {
  const f = x.flats; if (x.lat == null) return '';
  if (f === undefined) return '<span class="muted">…</span>';
  if (!f || f.n == null) return `<span class="muted" title="${f && f.err ? esc(f.err) : f && f.why ? esc(f.why) : 'Нет данных о доме в OpenStreetMap и МинЖКХ'}">—</span>`;
  return f.exact ? `<span title="Источник: ${esc(f.src || 'OpenStreetMap')}">${fmtNum(f.n)}</span>` : `<span title="Оценка по OpenStreetMap: ${esc(f.how || `${f.levels} эт. × ${f.entrances || 1} подъезд(а) × 4`)}. Выберите объявление — уточню по МинЖКХ">≈${fmtNum(f.n)}</span>`;
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
    // фоном — только OpenStreetMap (быстро); точное число из МинЖКХ запрашивается при выборе объявления
    let fails = 0;
    for (const x of R.list.slice(0, 200)) {
      if (document.body.dataset.mode !== 'results' || fails >= 4) break;
      if (x.lat == null || x.flats !== undefined) continue;
      const f = await pvz.flats(x.lat, x.lon, null).catch(() => null);
      if (!f || f.err) { fails++; continue; }   // OpenStreetMap не отвечает — не ждём по каждой строке
      fails = 0; x.flats = f; paintFlats(x);
    }
  } finally { flatsBusy = false; }
}
function paintFlats(only) {
  for (const x of only ? [only] : R.list.slice(0, 1000)) { const td = document.querySelector(`td[data-flats="${x.id}"]`); if (td) td.innerHTML = flatsCell(x); }
  const e = $('rdFlats'); if (e && R.sel != null && R.rows[R.sel] && (!only || only === R.rows[R.sel])) e.innerHTML = flatsCell(R.rows[R.sel]) || '—';
}
// просмотренные: объявление считается просмотренным, когда вы его выбрали или открыли
let seenT = null;
function markSeen(x, tr) {
  const k = markKey(x); if (R.seen[k]) return;
  R.seen[k] = Date.now(); if (tr) { tr.classList.remove('unseen'); const d = tr.querySelector('.new-dot'); if (d) d.remove(); }
  clearTimeout(seenT); seenT = setTimeout(() => { pvz.setCfg({ resSeen: R.seen }); renderDays(); }, 800);
}
window.openWatch = () => { R.day = 'watch'; R.jobF = ''; openPage('results'); };
// перепроверка зон: заново (без памяти результатов) для выгрузок, строки которых сейчас в списке
$('rRecheck').onclick = async () => {
  closeMore();
  const files = [...new Set(R.list.filter(x => !x.archived).map(x => x.filePath))];
  const src = files.length ? await pvz.resultSources(files) : [];
  if (!src.length) { showModal({ kind: 'info', title: 'Нечего перепроверять', text: 'Не нашёл исходные выгрузки для строк в списке (возможно, файлы перенесены).' }); return; }
  const v = await showModal({ kind: 'info', title: 'Перепроверить зоны?', text: `Выгрузок: ${src.length}. Каждый адрес будет проверен заново на карте (это займёт время), файлы результатов обновятся.`, buttons: [{ label: 'Отмена', value: false }, { label: 'Перепроверить', cls: 'primary', value: true }] });
  if (!v) return;
  const r = await pvz.ozonStart(src, { fresh: true });
  if (!r.ok) { showModal({ kind: 'err', title: 'Не запустилось', text: r.error }); return; }
  $('rRecheck').disabled = true; $('rMoreBtn').classList.add('busy'); $('rBusy').textContent = '↻ Перепроверяю зоны…';
};
pvz.onOzonStatus(s => { if ($('rRecheck').disabled) $('rBusy').textContent = '↻ ' + prettyNums(String(s.text || '').split('\n')[0]); });
pvz.onOzonDone(() => { if ($('rRecheck').disabled) { $('rRecheck').disabled = false; $('rMoreBtn').classList.remove('busy'); $('rBusy').textContent = ''; if (document.body.dataset.mode === 'results') loadResults(); } });
// экспорт отмеченных
$('rExport').onclick = async () => {
  closeMore();
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
const S = { list: [], presets: {}, orders: [], jobs: [] };
const DAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
async function loadSchedule() {
  const c = await pvz.getCfg();
  S.list = c.schedules || []; S.pc = c.pcId; S.sync = !!c.syncDir;
  S.presets = c.presets && Object.keys(c.presets).length ? c.presets : DEFAULT_PRESETS;
  S.orders = await pvz.bwOrders();
  S.jobs = (await pvz.jobs()).filter(j => !j.archived || S.list.some(s => s.kind === 'job' && s.job === j.id));
  renderSchedule();
}
const saveSchedule = () => pvz.setCfg({ schedules: S.list });
function whatOptions(s) {
  const cur = s.kind === 'winner' ? 'winner:' + s.guid : s.kind === 'job' ? 'job:' + s.job : 'preset:' + s.preset;
  const lost = s.kind === 'job' && !S.jobs.some(j => j.id === s.job);
  return (lost ? `<option value="" selected>Заказ удалён — выберите другой</option>` : '') +
    (S.jobs.length ? `<optgroup label="Заказы">${S.jobs.map(j => `<option value="job:${esc(j.id)}"${cur === 'job:' + j.id ? ' selected' : ''}>${esc(j.name)}</option>`).join('')}</optgroup>` : '') +
    `<optgroup label="Baza Winner — заказ">${S.orders.map(o => `<option value="winner:${o.guid}"${cur === 'winner:' + o.guid ? ' selected' : ''}>${esc(o.name)}</option>`).join('')}</optgroup>` +
    (s.kind === 'preset' ? `<optgroup label="Старый сценарий"><option value="preset:${esc(s.preset)}" selected>${esc(s.preset)}</option></optgroup>` : '');
}
function renderSchedule() {
  $('sList').innerHTML = S.list.length ? S.list.map((s, i) => `<div class="s-item${s.enabled ? '' : ' off'}" data-i="${i}">
      <label class="switch"><input type="checkbox" class="en"${s.enabled ? ' checked' : ''}><span></span></label>
      <input type="time" class="tm" value="${s.time}">
      <select class="what">${whatOptions(s)}</select>
      <div class="s-days">${DAYS.map((d, k) => `<button class="${(s.days || []).includes(k + 1) ? 'on' : ''}" data-d="${k + 1}">${d}</button>`).join('')}</div>
      <span class="s-end"><label class="chk"><input type="checkbox" class="ck"${s.check ? ' checked' : ''}>проверить зоны</label>${S.sync && s.kind === 'job' && s.pc ? `<span class="s-pc${s.pc !== S.pc ? ' other' : ''}" title="Какой компьютер выполняет задание (меняется в карточке заказа)">💻 ${s.pc === S.pc ? 'этот компьютер' : esc(s.pcName || 'другой компьютер')}</span>` : ''}</span>
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
    if (!kind) return;
    s.kind = kind; delete s.preset; delete s.guid; delete s.job;
    if (kind === 'winner') { s.guid = v; s.name = (S.orders.find(o => o.guid === v) || {}).name; }
    else if (kind === 'job') { s.job = v; s.name = (S.jobs.find(j => j.id === v) || {}).name; }
    else { s.preset = v; s.name = v; }
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
  const o = S.orders[0], j = S.jobs.find(x => !x.archived);
  if (!j && !o) { showModal({ kind: 'info', title: 'Нет заказов', text: 'Сначала создайте заказ («Заказы» на главном экране) — по расписанию выгружается заказ.' }); return; }
  S.list.push(Object.assign({ id: Date.now().toString(36), enabled: true, time: '13:30', days: [1, 2, 3, 4, 5], check: true },
    j ? { kind: 'job', job: j.id, name: j.name } : { kind: 'winner', guid: o.guid, name: o.name }));
  saveSchedule(); renderSchedule();
};

// запуск задания по расписанию
const wait = ms => new Promise(r => setTimeout(r, ms));
pvz.onRunSchedule(async s => {
  if (running || (window.wizBusy && wizBusy())) { pvz.notify('PVZ Master', `Задание «${s.name || ''}» (${s.time}) пропущено: идёт другая выгрузка.`); return; }
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
    } else if (s.kind === 'job') {
      const j = (await pvz.jobs()).find(x => x.id === s.job);
      if (!j) report.push('заказ не найден (удалён)');
      else if (j.archived) report.push('заказ в архиве — пропущено');
      else {
        // проверка по расписанию — на площадках, выбранных в заказе
        if (s.check && j.checks) await pvz.setCfg({ chkOzon: !!j.checks.ozon, chkYandex: !!j.checks.yandex, chkWb: !!j.checks.wb });
        const p = Object.assign({}, j.params, { cian: !!(j.sources && j.sources.cian), avito: !!(j.sources && j.sources.avito), winner: !!(j.sources && j.sources.winner), avitoUrl: j.avitoUrl, orders: j.orders });
        report = await runOrder(p, j.name, { unattended: true, forceCheck: !!s.check, job: j.id });
      }
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

// короткое уведомление внизу
let toastT = null;
window.toast = t => { const e = $('toast'); e.textContent = t; e.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => e.classList.remove('on'), 1800); };

// ---------- столбцы таблицы: скрыть «×» в заголовке, вернуть — кнопкой «Столбцы» ----------
const COLS = [[2, 'Площадка'], [3, 'Зона'], [4, 'Адрес'], [5, 'Площадь'], [6, 'Квартир'], [7, 'Цена'], [8, 'Проверено'], ['note', 'Сверка адреса (серые строки)']];
let hiddenCols = [];
function applyCols() {
  const t = document.querySelector('.r-table'); if (!t) return;
  COLS.forEach(([c]) => t.classList.toggle('hide-c' + c, hiddenCols.includes(String(c))));
  const n = hiddenCols.length; $('rColsBtn').classList.toggle('on', n > 0); $('rColsBtn').title = n ? `Скрыто столбцов: ${n} — нажмите, чтобы вернуть` : 'Столбцы';
}
function setHidden(c, hide) { c = String(c); hiddenCols = hide ? [...new Set([...hiddenCols, c])] : hiddenCols.filter(x => x !== c); pvz.setCfg({ resHiddenCols: hiddenCols }); applyCols(); }
document.querySelectorAll('.r-table thead th').forEach((th, i) => {
  const c = i + 1; if (!COLS.some(([k]) => k === c)) return;
  const b = document.createElement('button'); b.className = 'col-x'; b.title = 'Скрыть столбец'; b.textContent = '×';
  b.onclick = e => { e.stopPropagation(); setHidden(c, true); }; th.appendChild(b);
});
// меню «Столбцы» — всплывающая панель; список строится при открытии
$('rColsBtn').addEventListener('click', e => e.stopPropagation());   // щелчок по кнопке не сортирует столбец
$('rColsMenu').addEventListener('beforetoggle', e => {
  if (e.newState !== 'open') return;
  const m = $('rColsMenu');
  m.innerHTML = '<b>Показывать столбцы</b>' + COLS.map(([c, n]) => `<label><input type="checkbox" data-col="${c}"${hiddenCols.includes(String(c)) ? '' : ' checked'}> ${n}</label>`).join('');
  m.querySelectorAll('input').forEach(i => (i.onchange = () => setHidden(i.dataset.col, !i.checked)));
});
$('rColsMenu').addEventListener('click', e => e.stopPropagation());
// на небольшом окне, пока столбцы не настраивали, «Проверено» скрыт (есть в карточке) — адресу больше места
pvz.getCfg().then(c => { hiddenCols = c.resHiddenCols ? c.resHiddenCols.map(String) : (window.innerWidth < 1750 ? ['8'] : []); applyCols(); });
// сменился размер интерфейса — встроенные карты и сайты на новые места
pvz.onUiScale(() => setTimeout(() => { fixMap(); syncRects(); window.dispatchEvent(new Event('resize')); }, 80));

// ---------- клавиши в «Результатах»: ↑/↓ — соседнее объявление, Пробел — просмотрено / не просмотрено, S — отслеживать ----------
document.addEventListener('keydown', e => {
  if (document.body.dataset.mode !== 'results' || modalIsOpen() || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.target.closest && e.target.closest('input, select, textarea, [contenteditable]')) return;
  const list = R.list.slice(0, 1000); if (!list.length) return;
  const i = list.findIndex(x => x.id === R.sel);
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    const j = i < 0 ? 0 : Math.max(0, Math.min(list.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)));
    if (j === i) return;
    const x = list[j]; selectRow(x.id, false);
    const m = R.markers.get(x.id); if (m && mapOn()) { R.map.panTo(m.getLatLng(), { animate: true, duration: .3 }); m.openPopup(); }
    return;
  }
  if (i < 0) return;
  const x = list[i], tr = document.querySelector(`#rRows tr[data-id="${x.id}"]`), k = markKey(x);
  if (e.key === ' ' || e.code === 'Space') {
    e.preventDefault();
    if (R.seen[k]) { delete R.seen[k]; if (tr) { tr.classList.add('unseen'); const a = tr.querySelector('.addr-t'); if (a && !tr.querySelector('.new-dot')) a.insertAdjacentHTML('beforebegin', '<b class="new-dot" title="Ещё не просмотрено">●</b>'); } pvz.setCfg({ resSeen: R.seen }); renderDays(); toast('Не просмотрено'); }
    else { markSeen(x, tr); toast('Просмотрено'); }
  } else if (e.code === 'KeyS') {
    e.preventDefault(); const st = tr && tr.querySelector('.star'); if (st) st.click(); toast(R.watch[k] ? '★ В отслеживаемых' : 'Убрано из отслеживаемых');
  }
});
$('rCount').title = 'Клавиши: ↑/↓ — соседнее объявление, Пробел — просмотрено / не просмотрено, S — отслеживать';

// ---------- сводка за сегодня на главном экране: выгружено · подходящих (зелёных) · не просмотрено ----------
const plural = (n, one, few, many) => { const a = n % 100, b = n % 10; return a > 10 && a < 20 ? many : b === 1 ? one : b >= 2 && b <= 4 ? few : many; };
// ближайшее задание расписания этого компьютера: «сегодня в 13:30» / «завтра в 09:00» / «Пн в 13:30»
function nextRun(c) {
  const list = (c.schedules || []).filter(s => s.enabled && (s.days || []).length && /^\d\d:\d\d$/.test(s.time || '') && !(s.kind === 'job' && s.pc && s.pc !== c.pcId));
  if (!list.length) return 'нет заданий';
  const now = new Date(); let best = null;
  for (const s of list) for (let d = 0; d < 8; d++) {
    const t = new Date(now); t.setDate(t.getDate() + d); t.setHours(+s.time.slice(0, 2), +s.time.slice(3), 0, 0);
    if (t > now && s.days.includes(t.getDay() || 7)) { if (!best || t < best) best = t; break; }
  }
  if (!best) return 'нет заданий';
  const dd = Math.round((new Date(best).setHours(0, 0, 0, 0) - new Date(now).setHours(0, 0, 0, 0)) / 864e5), hm = best.toTimeString().slice(0, 5);
  return (dd === 0 ? 'сегодня' : dd === 1 ? 'завтра' : ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'][best.getDay()]) + ' в ' + hm;
}
async function homeSummary() {
  try {
    const today = dayKey(Date.now());
    const [h, r, c] = await Promise.all([pvz.history(), pvz.results(), pvz.getCfg()]);
    const exported = h.filter(x => x.type === 'export' && x.ok !== false && dayKey(x.time) === today).reduce((a, x) => a + (x.total || 0), 0);
    const seen = c.resSeen || {}, rows = new Map();
    for (const x of r.rows) if (dayKey(x.exported || x.checked) === today) rows.set(markKey(x), x);
    const list = [...rows.values()], green = list.filter(x => x.platform === 'Ozon' && x.zone === 'зелёный').length, unseen = list.filter(x => !seen[markKey(x)]).length;
    // плитки: новых в результатах, отслеживаемых (и изменений цены), ближайший запуск по расписанию
    const all = new Map(); for (const x of r.rows) all.set(markKey(x), x);
    const news = [...all.keys()].filter(k => !seen[k]).length, w = Object.values(c.resWatch || {});
    const chg = w.filter(x => x.pc && !x.pc.seen && (x.pc.gone || (x.pc.was && x.pc.price && x.pc.was !== x.pc.price))).length;
    $('htRes').textContent = news ? `${fmtNum(news)} ${plural(news, 'новое', 'новых', 'новых')}` : all.size ? 'всё просмотрено' : 'пока пусто';
    $('htRes').classList.toggle('hot', news > 0);
    $('htWatch').textContent = w.length ? fmtNum(w.length) + (chg ? ` · ${fmtNum(chg)} ${plural(chg, 'изменение', 'изменения', 'изменений')}` : '') : 'нет';
    $('htWatch').classList.toggle('hot', chg > 0);
    $('htSched').textContent = nextRun(c);
    const el = $('homeSum');
    if (!exported && !list.length) { el.style.display = 'none'; return; }
    el.innerHTML = `Сегодня: выгружено <b>${fmtNum(exported)}</b> · подходящих <b>${fmtNum(list.length)}</b>` + (green ? `, из них <b class="g">${fmtNum(green)} зелёных</b>` : '') + (unseen ? ` · не просмотрено <b class="u">${fmtNum(unseen)}</b>` : list.length ? ' · всё просмотрено ✓' : '');
    el.style.display = '';
  } catch (e) { pvz.logError('сводка дня', String(e && e.message || e)); }
}
$('homeSum').onclick = () => { R.day = dayKey(Date.now()); R.up = 'all'; R.jobF = ''; openPage('results'); };
new MutationObserver(() => { if (document.body.dataset.mode === 'welcome') homeSummary(); }).observe(document.body, { attributes: true, attributeFilter: ['data-mode'] });
pvz.onOzonDone(() => { if (document.body.dataset.mode === 'welcome') setTimeout(homeSummary, 500); });
homeSummary();
