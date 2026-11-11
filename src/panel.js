const $ = id => document.getElementById(id);
function showPath(id, p) { $(id).textContent = p || ''; $(id).title = p || ''; }
const F = ['pages', 'delay', 'days', 'part'];
const NAMES = { avito: 'Авито', cian: 'Циан', winner: 'Baza Winner' };
const lastDirs = {};
let running = false;

// ---------- старт ----------
async function init() {
  const c = await pvz.getCfg();
  F.forEach(k => ($(k).value = c[k]));
  showPath('root', c.root);
  showPath('cianRoot', c.cianRoot);
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
}
function openSite(site) {
  if (running) return;
  document.body.dataset.mode = 'work';
  setSite(site);
  pvz.nav(site);
  pvz.setCfg({ lastSite: site });
}
document.querySelectorAll('[data-go]').forEach(b => (b.onclick = () => openSite(b.dataset.go)));
$('home').onclick = () => { if (running) return; document.body.dataset.mode = 'welcome'; pvz.nav('welcome'); };
document.addEventListener('keydown', e => {
  if (document.body.dataset.mode !== 'welcome') return;
  const k = { '1': 'winner', '2': 'cian', '3': 'avito' }[e.key]; if (k) openSite(k);
});

$('back').onclick = () => pvz.nav('back');
$('reload').onclick = () => pvz.nav('reload');

// ---------- папки и настройки ----------
$('pick').onclick = async () => { const c = await pvz.pickFolder('avito'); showPath('root', c.root); };
$('pickC').onclick = async () => { const c = await pvz.pickFolder('cian'); showPath('cianRoot', c.cianRoot); };
$('open').onclick = () => pvz.openFolder(lastDirs[document.body.dataset.site] || $('root').title);
$('openC').onclick = () => pvz.openFolder(lastDirs.cian || $('cianRoot').title);
$('cianOnlyNew').onchange = () => pvz.setCfg({ cianOnlyNew: $('cianOnlyNew').checked });

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
  if (site && document.body.dataset.mode === 'work') setSite(site);
  refreshBw();
});

// ---------- статус и прогресс ----------
const box = $('statusBox'), fill = $('barFill');
function setStatus(text, kind) {
  $('status').textContent = text;
  box.classList.toggle('err', kind === 'err');
  box.classList.toggle('done', kind === 'done');
  const m = text.match(/(?:страница|Порция)\s+(\d+)\s+из\s+(?:максимум\s+)?(\d+)/i);
  const bar = fill.parentElement;
  if (m && +m[2] > 0) { bar.classList.remove('ind'); fill.style.width = Math.min(100, Math.round(+m[1] / +m[2] * 100)) + '%'; fill.style.transform = 'none'; }
  else { bar.classList.add('ind'); fill.style.width = '30%'; fill.style.transform = ''; }
}
pvz.onStatus(s => running && setStatus(s));

$('stop').onclick = () => { pvz.stop(); setStatus('Останавливаю…'); };

$('go').onclick = async () => {
  if (running) return;
  await refreshBw();
  const c = {};
  F.forEach(k => (c[k] = Math.max(0, parseInt($(k).value, 10) || 0)));
  if (c.delay < 3) { c.delay = 3; $('delay').value = 3; }
  if (!c.pages) c.pages = 1;
  if (!c.part) c.part = 300;
  if (bwGuid) c.bw = { tag: $('bwTag').value.trim(), hide: $('bwHide').checked };

  const goHtml = $('go').innerHTML;
  running = true; $('work').classList.add('running'); $('go').disabled = true; $('go').lastChild.textContent = 'Идёт выгрузка…';
  setStatus('Запуск…');
  const r = await pvz.start(c);
  running = false; $('work').classList.remove('running'); $('go').disabled = false; $('go').innerHTML = goHtml;

  if (!r.ok) { setStatus('Ошибка: ' + r.error, 'err'); return; }
  if (r.dir) lastDirs[r.site] = r.dir;
  let t = `${NAMES[r.site] || ''} — ${r.reason}.\nОбъявлений: ${r.total}` + (r.site !== 'winner' ? `, с координатами: ${r.withCoords}.` : '.');
  if (r.extra) t += '\n' + r.extra;
  t += r.saved.length ? `\n\nСохранено файлов: ${r.saved.length}\n` + r.saved.map(f => '• ' + f.split(/[\\/]/).pop()).join('\n') : '\nНичего не сохранено.';
  if (r.site !== 'winner' && r.total && r.withCoords < r.total * 0.8) t += '\n⚠ Координаты не у всех объявлений — сообщите Claude.';
  setStatus(t, /ошибк/i.test(r.reason) ? 'err' : 'done');
};
