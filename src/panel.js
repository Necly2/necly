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
  const k = { '1': 'winner', '2': 'cian', '3': 'avito', '4': 'ozon' }[e.key]; if (k) openSite(k);
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
  await refreshBw();
  const c = {};
  F.forEach(k => (c[k] = Math.max(0, parseInt($(k).value, 10) || 0)));
  if (c.delay < 3) { c.delay = 3; $('delay').value = 3; }
  if (!c.pages) c.pages = 1;
  if (!c.part) c.part = 300;
  if (bwGuid) c.bw = { tag: $('bwTag').value.trim(), hide: $('bwHide').checked };

  running = true; refreshRunUI();
  setStatus('Запуск…');
  const r = await pvz.start(c);
  running = false; refreshRunUI();

  if (!r.ok) { setStatus('Ошибка: ' + r.error, 'err'); return; }
  if (r.dir) lastDirs[r.site] = r.dir;
  let t = `${NAMES[r.site] || ''} — ${r.reason}.\nОбъявлений: ${r.total}` + (r.site !== 'winner' ? `, с координатами: ${r.withCoords}.` : '.');
  if (r.extra) t += '\n' + r.extra;
  t += r.saved.length ? `\n\nСохранено файлов: ${r.saved.length}\n` + r.saved.map(f => '• ' + f.split(/[\\/]/).pop()).join('\n') : '\nНичего не сохранено.';
  if (r.site !== 'winner' && r.total && r.withCoords < r.total * 0.8) t += '\n⚠ Координаты не у всех объявлений — сообщите Claude.';
  if (r.ozonQueued) t += `\n\n→ Отправлено на проверку Ozon: ${r.ozonQueued} файл(ов). Ход — во вкладке «Ozon».`;
  setStatus(t, /ошибк/i.test(r.reason) ? 'err' : 'done');
};
