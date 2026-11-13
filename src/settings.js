// PVZ Master — «Настройки» и первый запуск (выбор папок)
(() => {
const FOLD = [['root', 'avito', 'Выгрузки Авито и Winner', 'папка «АДРЕСА»'], ['cianRoot', 'cian', 'Выгрузки Циана', 'папка «АДРЕСА ЦИАН»'], ['ozonOut', 'ozon', 'Результаты проверки', 'папка «ПРОВЕРКА OZON»']];
const short = p => p || 'не выбрана';
function folderRows(st, el, after) {
  el.innerHTML = FOLD.map(([k, w, t, hint]) => `<div class="set-row fold-row">
    <span><b>${t}</b><small class="muted">${st[k] ? esc(st[k]) : hint + ' — не выбрана'}</small></span>
    <span>${st[k] && !st.exists[k] ? '<em class="bad">папки нет</em> ' : st[k] ? '<em class="ok">✓</em> ' : ''}<button class="ghost sm" data-pick="${w}">Выбрать…</button>${st[k] && st.exists[k] ? ` <button class="ghost sm" data-open="${esc(st[k])}">Открыть</button>` : ''}</span></div>`).join('');
  el.querySelectorAll('[data-pick]').forEach(b => (b.onclick = async () => { await pvz.pickFolder(b.dataset.pick); after(); }));
  el.querySelectorAll('[data-open]').forEach(b => (b.onclick = () => pvz.openFolder(b.dataset.open)));
}
// ---------- первый запуск ----------
async function setupCheck() {
  const st = await pvz.folderState();
  if (st.ok) return true;
  document.body.dataset.mode = 'setup';
  const draw = async () => { const s = await pvz.folderState(); folderRows(s, $('setupRows'), draw); $('setupDone').disabled = !s.ok; };
  await draw();
  $('setupCreate').onclick = async () => { await pvz.createFolders(); draw(); };
  $('setupDone').onclick = () => { document.body.dataset.mode = 'welcome'; };
  return false;
}
window.setupCheck = setupCheck;
setTimeout(setupCheck, 300);
// перед началом работы — папки должны существовать
window.ensureFolders = async () => { const st = await pvz.folderState(); if (st.ok) return true; await setupCheck(); return false; };

// ---------- настройки ----------
async function loadSettings() {
  const c = await pvz.getCfg();
  const draw = async () => folderRows(await pvz.folderState(), $('setFolders'), draw);
  draw();
  $('setOnlyNew').checked = c.onlyNew !== false;
  $('setSeenDays').value = String(c.seenDays || 0);
  $('setAutoCheck').checked = !!c.autoCheck;
  setNum($('setGreenMin'), c.ozonGreenMin || 60);
  $('setCache').value = c.ozonCache === false ? '0' : '1';
  $('setExpert').checked = !!c.showExpert;
  $('sTray').checked = c.tray !== false; $('sAuto').checked = !!c.autostart;
  const mode = window.getThemeMode ? getThemeMode() : 'auto';
  $('setTheme').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.v === mode));
  seenInfo();
}
async function seenInfo() { const s = await pvz.seenInfo(); $('setSeenInfo').textContent = `Запомнено: Циан ${fmtNum(s.cian)}, Авито ${fmtNum(s.avito)}`; }
$('setOnlyNew').onchange = () => pvz.setCfg({ onlyNew: $('setOnlyNew').checked, cianOnlyNew: $('setOnlyNew').checked });
$('setSeenDays').onchange = async () => { await pvz.setCfg({ seenDays: +$('setSeenDays').value }); seenInfo(); };
$('setForget').onclick = async () => {
  const v = await showModal({ kind: 'warn', title: 'Забыть выгруженные?', text: 'В следующий раз программа выгрузит все объявления заново, включая уже выгруженные.', buttons: [{ label: 'Отмена', value: false }, { label: 'Забыть', cls: 'primary', value: true }] });
  if (v) { await pvz.forgetSeen(); seenInfo(); }
};
$('setAutoCheck').onchange = () => pvz.setCfg({ autoCheck: $('setAutoCheck').checked });
$('setGreenMin').onchange = () => { const v = Math.max(1, numOf($('setGreenMin')) || 60); setNum($('setGreenMin'), v); pvz.setCfg({ ozonGreenMin: v }); };
$('setCache').onchange = () => pvz.setCfg({ ozonCache: $('setCache').value === '1' });
$('setExpert').onchange = () => { pvz.setCfg({ showExpert: $('setExpert').checked }); $('expertBtn').style.display = $('setExpert').checked ? '' : 'none'; };
$('setOpenExpert').onclick = () => $('expertBtn').click();
$('setTheme').querySelectorAll('button').forEach(b => (b.onclick = () => { window.setThemeMode && setThemeMode(b.dataset.v); $('setTheme').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); }));
$('sTray').onchange = () => pvz.setCfg({ tray: $('sTray').checked });
$('sAuto').onchange = () => pvz.setAutostart($('sAuto').checked);
$('setLogs').onclick = () => pvz.openLogs();
$('setZip').onclick = () => pvz.makeReport();
window.loadSettings = loadSettings;
pvz.getCfg().then(c => { if (c.showExpert) $('expertBtn').style.display = ''; });
})();
