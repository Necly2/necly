const $ = id => document.getElementById(id);
const F = ['pages', 'delay', 'days', 'part'];
const lastDirs = {};

async function init() {
  const c = await pvz.getCfg();
  F.forEach(k => ($(k).value = c[k]));
  $('root').textContent = c.root;
  $('cianRoot').textContent = c.cianRoot;
  $('cianOnlyNew').checked = c.cianOnlyNew !== false;
}
init();

$('back').onclick = () => pvz.nav('back');
$('avito').onclick = () => pvz.nav('avito');
$('cian').onclick = () => pvz.nav('cian');
$('winner').onclick = () => pvz.nav('winner');
$('reload').onclick = () => pvz.nav('reload');
$('pick').onclick = async () => { const c = await pvz.pickFolder('avito'); $('root').textContent = c.root; };
$('pickC').onclick = async () => { const c = await pvz.pickFolder('cian'); $('cianRoot').textContent = c.cianRoot; };
$('open').onclick = () => pvz.openFolder(lastDirs.winner || lastDirs.avito || $('root').textContent);
$('openC').onclick = () => pvz.openFolder(lastDirs.cian || $('cianRoot').textContent);
$('cianOnlyNew').onchange = () => pvz.setCfg({ cianOnlyNew: $('cianOnlyNew').checked });
let bwGuid = null;
async function refreshBw() {
  const o = await pvz.bwOrder();
  if (!o) { bwGuid = null; $('bwName').textContent = 'Откройте заказ в Winner (войдите сами)'; return; }
  if (o.guid === bwGuid) return;
  bwGuid = o.guid;
  $('bwName').textContent = (o.name || 'Заказ') + ' · ' + o.guid.slice(0, 8) + '…';
  $('bwTag').value = o.tag || '';
  $('bwHide').checked = !!o.hide;
}
pvz.onUrl(u => { $('url').textContent = u; refreshBw(); });
pvz.onStatus(s => ($('status').textContent = s));

$('stop').onclick = () => { pvz.stop(); $('status').textContent = 'Останавливаю…'; };

$('go').onclick = async () => {
  await refreshBw();
  const c = {};
  F.forEach(k => (c[k] = Math.max(0, parseInt($(k).value, 10) || 0)));
  if (c.delay < 3) { c.delay = 3; $('delay').value = 3; }
  if (!c.pages) c.pages = 1;
  if (!c.part) c.part = 300;
  $('go').disabled = true; $('stop').style.display = 'block';
  $('status').textContent = 'Запуск…';
  if (bwGuid) c.bw = { tag: $('bwTag').value.trim(), hide: $('bwHide').checked };
  const r = await pvz.start(c);
  $('go').disabled = false; $('stop').style.display = 'none';
  if (!r.ok) { $('status').innerHTML = '<span class="warn">Ошибка: ' + r.error.replace(/</g, '&lt;') + '</span>'; return; }
  if (r.dir) lastDirs[r.site] = r.dir;
  let t = `${r.site === 'cian' ? 'Циан' : r.site === 'winner' ? 'Winner' : 'Авито'} — готово: ${r.reason}.\nОбъявлений: ${r.total}, с координатами: ${r.withCoords}.`;
  if (r.extra) t += '\n' + r.extra;
  t += r.saved.length ? `\nСохранено файлов: ${r.saved.length}\n` + r.saved.map(f => f.split(/[\\/]/).pop()).join('\n') : '\nНичего не сохранено.';
  if (r.site !== 'winner' && r.total && r.withCoords < r.total * 0.8) t += '\n⚠ Координаты не у всех объявлений — сообщите Claude.';
  $('status').textContent = t;
};

pvz.version().then(v => ($('ver').textContent = v));
$('upd').onclick = e => { e.preventDefault(); pvz.checkUpdate(); };
