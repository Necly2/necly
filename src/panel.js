const $ = id => document.getElementById(id);
const F = ['pages', 'delay', 'days', 'part'];
let lastDir = '';

async function init() {
  const c = await pvz.getCfg();
  F.forEach(k => ($(k).value = c[k]));
  $('root').textContent = c.root;
}
init();

$('back').onclick = () => pvz.nav('back');
$('home').onclick = () => pvz.nav('home');
$('reload').onclick = () => pvz.nav('reload');
$('pick').onclick = async () => { const c = await pvz.pickFolder(); $('root').textContent = c.root; };
$('open').onclick = () => pvz.openFolder(lastDir || undefined);
pvz.onUrl(u => ($('url').textContent = u));
pvz.onStatus(s => ($('status').textContent = s));

$('stop').onclick = () => { pvz.stop(); $('status').textContent = 'Останавливаю…'; };

$('go').onclick = async () => {
  const c = {};
  F.forEach(k => (c[k] = Math.max(0, parseInt($(k).value, 10) || 0)));
  if (c.delay < 3) { c.delay = 3; $('delay').value = 3; }
  if (!c.pages) c.pages = 1;
  if (!c.part) c.part = 300;
  $('go').disabled = true; $('stop').style.display = 'block';
  $('status').textContent = 'Запуск…';
  const r = await pvz.start(c);
  $('go').disabled = false; $('stop').style.display = 'none';
  if (!r.ok) { $('status').innerHTML = '<span class="warn">Ошибка: ' + r.error.replace(/</g, '&lt;') + '</span>'; return; }
  lastDir = r.dir;
  let t = `Готово: ${r.reason}.\nОбъявлений: ${r.total}, с координатами: ${r.withCoords}.`;
  t += r.saved.length ? `\nСохранено файлов: ${r.saved.length}\n` + r.saved.map(f => f.split(/[\\/]/).pop()).join('\n') : '\nНичего не сохранено.';
  if (r.total && r.withCoords < r.total * 0.8) t += '\n⚠ Координаты не у всех объявлений — сообщите Claude.';
  $('status').textContent = t;
};

pvz.version().then(v => ($('ver').textContent = v));
$('upd').onclick = e => { e.preventDefault(); pvz.checkUpdate(); };
