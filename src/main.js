// PVZ Master — слева панель управления, справа окно сайта (Winner, Циан, Авито) и скрытые вкладки карт Ozon и WB.
const { app, BrowserWindow, WebContentsView, ipcMain, dialog, shell, Menu, net, clipboard } = require('electron');
const trace = require('./trace');
const IS_MAC = process.platform === 'darwin';
const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');
const { collector, cianCollector } = require('./collector');
const updater = require('./updater');
const winner = require('./winner');
const ozon = require('./ozon');
const platforms = require('./platforms');
const journal = require('./journal');
const results = require('./results');
const scheduler = require('./scheduler');
app.on('before-quit', () => trace.flush());
process.on('uncaughtException', e => journal.logError('программа', e));
process.on('unhandledRejection', e => journal.logError('программа (promise)', e));

// убираем из User-Agent пометки Electron/приложения — остаётся обычная строка Chromium
app.userAgentFallback = app.userAgentFallback
  .replace(/\s?Electron\/\S+/i, '')
  .replace(/\s?pvz-avito\/\S+/i, '');

const PANEL_W = 340;
let mode = 'welcome';
const START_URL = 'https://www.avito.ru/moskva/kommercheskaya_nedvizhimost/sdam-ASgBAgICAUSwCNRW';
const WINNER_URL = 'https://w7.baza-winner.ru/';
const CIAN_URL = 'https://www.cian.ru/cat.php?deal_type=rent&engine_version=2&offer_type=offices&office_type[0]=2&office_type[1]=4&office_type[2]=5&office_type[3]=12&region=1&minarea=24&maxarea=130&minfloor=1&maxfloor=1&minfloorn=3&sort=creation_date_desc';
const MONTHS = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
// папка проекта: Windows — OneDrive\Desktop\PVZ, Mac — ~/Desktop/PVZ (можно выбрать в панели)
const PVZ_BASE = IS_MAC ? path.join(app.getPath('home'), 'Desktop', 'PVZ') : path.join(app.getPath('home'), 'OneDrive', 'Desktop', 'PVZ');
const DEF_ROOT = path.join(PVZ_BASE, 'АДРЕСА');
const DEF_CIAN = path.join(PVZ_BASE, 'АДРЕСА ЦИАН');
const DEF_OZON = path.join(PVZ_BASE, 'ПРОВЕРКА OZON');

let win, view, ozonView, wbView, running = false, stopFlag = false;
let currentSite = null, ozonRunning = false, ozonStop = false, ozonSkip = false;
const ozonQueue = [];
const cfgPath = () => path.join(app.getPath('userData'), 'config.json');
function loadCfg() {
  const d = { root: '', cianRoot: '', ozonOut: '', onlyNew: true, seenDays: 0, autoCheck: false, ozonGreenMin: 60, zoom: {}, showExpert: false, ozonDays: 3, ozonThreads: 2, ozonPause: 2, ozonWait: 25, ozonTries: 3, ozonAuto: false, ozonCache: true, chkOzon: true, chkYandex: false, chkWb: false,
    tray: true, autostart: false, schedules: [],
    pages: 40, delay: 4, days: 7, part: 300, cianOnlyNew: true };
  let c; try { c = Object.assign(d, JSON.parse(fs.readFileSync(cfgPath(), 'utf8'))); } catch { c = d; }
  // проверка зон запускается только по кнопке (решение пользователя 11.11.2026) — выключаем старую автопроверку один раз
  if (!c.ozonAutoOff) { c.ozonAuto = false; c.ozonAutoOff = 1; try { saveCfg(c); } catch {} }
  if (c.cianOnlyNew === false && !c.onlyNewMigrated) { c.onlyNew = false; }
  c.onlyNewMigrated = 1;
  return c;
}
function saveCfg(c) { fs.mkdirSync(path.dirname(cfgPath()), { recursive: true }); fs.writeFileSync(cfgPath(), JSON.stringify(c, null, 2)); }

let siteRect = null;   // место под сайт в мастере (присылает интерфейс)
function layout() {
  const [w, h] = win.getContentSize();
  if (mode === 'wizard') {
    ozonView.setVisible(false);
    if (siteRect && siteRect.width > 50) { view.setVisible(true); view.setBounds(siteRect); } else view.setVisible(false);
    return;
  }
  const b = { x: PANEL_W, y: 0, width: Math.max(100, w - PANEL_W), height: h };
  const showOzon = mode === 'work' && currentSite === 'ozon';
  const showView = mode === 'work' && !showOzon;
  view.setVisible(showView); ozonView.setVisible(showOzon);
  if (showView) view.setBounds(b);
  if (showOzon) ozonView.setBounds(b);
}

function createWindow() {
  win = new BrowserWindow({
    show: !process.argv.includes('--hidden'),
    width: 1400, height: 900, minWidth: 980, minHeight: 640, title: 'PVZ Master', backgroundColor: require('electron').nativeTheme.shouldUseDarkColors ? '#0f1115' : '#f4f6f9', icon: path.join(__dirname, 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true }
  });
  if (IS_MAC) {
    // на Mac меню нужно для ⌘C / ⌘V / ⌘Q
    Menu.setApplicationMenu(Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'viewMenu' }, { role: 'windowMenu' }]));
  } else win.removeMenu();
  win.loadFile(path.join(__dirname, 'panel.html'));
  win.setTitle(`PVZ Master — сборка ${updater.currentBuild()}`);
  win.on('page-title-updated', e => e.preventDefault());

  view = new WebContentsView({ webPreferences: { partition: 'persist:avito', contextIsolation: true, backgroundThrottling: false } });
  win.contentView.addChildView(view);
  // отдельная вкладка карты Ozon: работает в фоне, пока вы выгружаете с других сайтов
  ozonView = new WebContentsView({ webPreferences: { partition: 'persist:ozon', contextIsolation: true, backgroundThrottling: false } });
  win.contentView.addChildView(ozonView);
  ozonView.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  // скрытая вкладка карты Wildberries: API WB отвечает только из браузера (антибот), поэтому запросы идут со страницы карты
  wbView = new WebContentsView({ webPreferences: { partition: 'persist:wb', contextIsolation: true, backgroundThrottling: false } });
  win.contentView.addChildView(wbView); wbView.setVisible(false);
  wbView.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  // тайлы OpenStreetMap для карты результатов: OSM требует Referer и понятный User-Agent
  require('electron').session.defaultSession.webRequest.onBeforeSendHeaders({ urls: ['https://*.tile.openstreetmap.org/*', 'https://tile.openstreetmap.org/*'] }, (d, cb) => {
    d.requestHeaders.Referer = 'https://github.com/Necly2/necly'; d.requestHeaders['User-Agent'] = 'PVZMaster/1.0 (+https://github.com/Necly2/necly)'; cb({ requestHeaders: d.requestHeaders });
  });
  trace.cleanup(); trace.log('программа', `запуск, сборка ${updater.currentBuild()}, ${process.platform} ${process.arch}`);
  trace.watch('persist:avito', 'сайт'); trace.watch('persist:ozon', 'Ozon'); trace.watch('persist:wb', 'WB');
  layout();
  win.on('resize', layout);
  // ссылки «в новой вкладке» открываем в том же окне
  view.webContents.setWindowOpenHandler(({ url }) => { view.webContents.loadURL(url); return { action: 'deny' }; });
  view.webContents.on('did-navigate', (_e, url) => { send('url', url); applyZoom(view.webContents); });
  view.webContents.on('did-navigate-in-page', (_e, url) => send('url', url));
}

// идущие процессы — для меню в строке меню Mac (и подсказки значка в трее)
const procs = {};
const SITE_NAMES = { cian: 'Циан', avito: 'Авито', winner: 'Winner' };
function pctOf(text) { const m = String(text || '').match(/(\d[\d\s]*)\s*из\s*(?:максимум\s*)?(\d[\d\s]*)/); if (!m) return null; const a = +m[1].replace(/\s/g, ''), b = +m[2].replace(/\s/g, ''); return b ? Math.min(100, Math.round(100 * a / b)) : null; }
function procUpdate() { try { scheduler.setProgress(Object.values(procs)); } catch {} }
// прямоугольники приходят из окна программы в CSS-пикселях; если окно увеличено ⌘+ / ⌘− — пересчитать
const Z = () => (win && !win.isDestroyed() ? win.webContents.getZoomFactor() : 1) || 1;
const rb = r => { const z = Z(); return { x: Math.round(r.x * z), y: Math.round(r.y * z), width: Math.round(r.width * z), height: Math.round(r.height * z) }; };
const send = (ch, data) => {
  if (ch === 'status' && running) { procs.export = { name: 'Выгрузка · ' + (SITE_NAMES[currentSite] || 'сайт'), text: String(data).split('\n')[0], pct: pctOf(data) }; procUpdate(); }
  if (ch === 'ozonStatus' && data) { procs.check = { name: 'Проверка зон', text: String(data.text || '').split('\n')[0], pct: data.total ? Math.round(100 * (data.done || 0) / data.total) : pctOf(data.text) }; procUpdate(); }
  if (ch === 'ozonDone') { delete procs.check; procUpdate(); }
  if (ch === 'status') trace.status(currentSite || 'выгрузка', data);
  else if (ch === 'ozonStatus' && data && data.text) trace.status('проверка', data.text);
  return win && !win.isDestroyed() && win.webContents.send(ch, data);
};

function nextIndex(dir, dd) {
  let max = 0;
  if (fs.existsSync(dir)) for (const f of fs.readdirSync(dir)) {
    const m = f.match(new RegExp(`^avito ${dd} (\\d+)\\.xlsx$`, 'i'));
    if (m) max = Math.max(max, +m[1]);
  }
  return max + 1;
}

const HEAD = ['Онлайн-показ','Объект','Метро / ЖД станции','От станции','Адрес','Мин. площадь','Макс. площадь','Цена, ₽','Пер. оплаты','Дата','Кол-во дней в экспозиции','Источник','Ссылка на первоисточник','Координаты'];

function saveRows(rows, cfg, site) {
  const now = new Date();
  const dd = String(now.getDate()).padStart(2, '0');
  const cian = site === 'cian';
  const dir = cian ? path.join(cfg.cianRoot, MONTHS[now.getMonth()], `Циан ${dd}`)
                   : path.join(cfg.root, MONTHS[now.getMonth()], `Адреса ${dd} AVITO`);
  const prefix = cian ? `export_excel ЦИАН ${dd} ` : `avito ${dd} `;
  fs.mkdirSync(dir, { recursive: true });
  let n = 0;
  for (const f of fs.readdirSync(dir)) {
    if (f.toLowerCase().startsWith(prefix.toLowerCase()) && /\.xlsx$/i.test(f)) n = Math.max(n, parseInt(f.slice(prefix.length), 10) || 0);
  }
  n += 1;
  const saved = [];
  for (let i = 0; i < rows.length; i += cfg.part) {
    const ws = XLSX.utils.aoa_to_sheet([HEAD, ...rows.slice(i, i + cfg.part)]);
    for (let r = 1; r <= Math.min(cfg.part, rows.length - i); r++) { const c = ws[XLSX.utils.encode_cell({ r, c: 7 })]; if (c && typeof c.v === 'number') c.z = '#,##0'; }
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'W7 экспорт');
    const file = path.join(dir, `${prefix}${n++}.xlsx`);
    XLSX.writeFile(wb, file);
    saved.push(file);
  }
  return { dir, saved };
}

// Новая Москва (НАО, ТАО): округа, поселения и города по адресу объявления
const NEW_MSK = /(НАО|ТАО|Новомосковск|Троицк(ий|\b)|Щербинк|Коммунарк|Сосенск|Внуковск|Московский(?! пр)|поселени|пос\.|п\. ?[А-ЯЁ]|Десёновск|Десеновск|Воскресенск|Филимонковск|Марушкинск|Кокошкин|Рязановск|Мосрентген|Краснопахорск|Вороновск|Киевский(?! (пр|ш|вокз))|Новофёдоровск|Новофедоровск|Первомайское|Роговск|Михайлово-Ярцевск|Кл[её]новск|Щаповск|Румянцево|Саларьево|Ватутинки|Мамыри|Сапроново|Летово|Остафьево|Газопровод)/i;
const isNewMoscow = a => NEW_MSK.test(String(a || ''));
// журнал уже выгруженных объявлений Циана (чтобы в следующий раз брать только новые)
// журнал уже выгруженных объявлений (Циан, Авито): {site: {id: время}} в папке данных программы.
// Старый журнал Циана (cian_seen.json в папке АДРЕСА ЦИАН) подхватывается один раз.
const seenFile = () => path.join(app.getPath('userData'), 'seen.json');
function readSeenAll(cfg) {
  let s; try { s = JSON.parse(fs.readFileSync(seenFile(), 'utf8')); } catch { s = {}; }
  if (!s.cian && cfg && cfg.cianRoot) { try { const old = JSON.parse(fs.readFileSync(path.join(cfg.cianRoot, 'cian_seen.json'), 'utf8')); const t = Date.parse(old.updated) || Date.now(); s.cian = Object.fromEntries((old.ids || []).map(i => [String(i), t])); } catch {} }
  return s;
}
function loadSeen(cfg, site = 'cian') {
  if (cfg.onlyNew === false) return [];
  const all = readSeenAll(cfg)[site] || {}, lim = cfg.seenDays ? Date.now() - cfg.seenDays * 864e5 : 0;
  return Object.keys(all).filter(k => all[k] >= lim);
}
function addSeen(cfg, ids, site = 'cian') {
  const s = readSeenAll(cfg), now = Date.now(); s[site] = s[site] || {};
  ids.forEach(i => (s[site][String(i)] = now));
  fs.writeFileSync(seenFile(), JSON.stringify(s));
}
ipcMain.handle('seenInfo', () => { const c = loadCfg(), s = readSeenAll(c), lim = c.seenDays ? Date.now() - c.seenDays * 864e5 : 0;
  const n = k => Object.values(s[k] || {}).filter(t => t >= lim).length; return { cian: n('cian'), avito: n('avito') }; });
ipcMain.handle('forgetSeen', () => { try { fs.writeFileSync(seenFile(), JSON.stringify({ cian: {}, avito: {} })); } catch {} return true; });
// первый запуск: папки
ipcMain.handle('folderState', () => { const c = loadCfg(); const ex = p => !!p && fs.existsSync(p);
  return { root: c.root, cianRoot: c.cianRoot, ozonOut: c.ozonOut, ok: ex(c.root) && ex(c.cianRoot) && ex(c.ozonOut), exists: { root: ex(c.root), cianRoot: ex(c.cianRoot), ozonOut: ex(c.ozonOut) } }; });
ipcMain.handle('createFolders', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Где создать папку PVZ с подпапками', defaultPath: app.getPath('desktop'), properties: ['openDirectory', 'createDirectory'] });
  if (r.canceled || !r.filePaths[0]) return null;
  const base = path.join(r.filePaths[0], 'PVZ'), c = loadCfg();
  c.root = path.join(base, 'АДРЕСА'); c.cianRoot = path.join(base, 'АДРЕСА ЦИАН'); c.ozonOut = path.join(base, 'ПРОВЕРКА OZON');
  for (const p of [c.root, c.cianRoot, c.ozonOut]) fs.mkdirSync(p, { recursive: true });
  saveCfg(c); return c;
});
// масштаб встроенных сайтов (по сайту; на каждом компьютере свой)
const ZOOMS = [0.5, 0.6, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];
const zoomKey = wc => { try { return new URL(wc.getURL()).hostname.replace(/^www\./, '').split('.').slice(-2).join('.'); } catch { return ''; } };
function applyZoom(wc) { const k = zoomKey(wc), z = (loadCfg().zoom || {})[k]; if (k && z) wc.setZoomFactor(z); }
function viewOf(which) { return which === 'ozonmap' ? mapView : ext[which] ? ext[which].view : which === 'site' ? view : null; }
ipcMain.handle('zoom', (_e, which, step) => {
  const v = viewOf(which); if (!v) return 1; const wc = v.webContents, k = zoomKey(wc);
  let z = wc.getZoomFactor();
  if (step) { let i = ZOOMS.findIndex(x => x >= z - 0.001); if (i < 0) i = ZOOMS.length - 1; i = Math.max(0, Math.min(ZOOMS.length - 1, i + (step > 0 ? 1 : -1))); z = ZOOMS[i]; wc.setZoomFactor(z);
    const c = loadCfg(); c.zoom = Object.assign({}, c.zoom, { [k]: z }); saveCfg(c); }
  return Math.round(z * 100);
});

ipcMain.handle('getCfg', () => loadCfg());
ipcMain.handle('setCfg', (_e, c) => { const cur = Object.assign(loadCfg(), c); saveCfg(cur); return cur; });
ipcMain.handle('pickFolder', async (_e, which) => {
  const key = which === 'cian' ? 'cianRoot' : which === 'ozon' ? 'ozonOut' : 'root';
  const title = which === 'cian' ? 'Папка АДРЕСА ЦИАН' : which === 'ozon' ? 'Папка для результатов проверки Ozon' : 'Папка АДРЕСА проекта PVZ';
  const r = await dialog.showOpenDialog(win, { title, properties: ['openDirectory', 'createDirectory'] });
  if (r.canceled || !r.filePaths[0]) return loadCfg();
  const c = Object.assign(loadCfg(), { [key]: r.filePaths[0] }); saveCfg(c); return c;
});
ipcMain.handle('openFolder', (_e, p) => shell.openPath(p || loadCfg().root));
const SITE_URL = { avito: START_URL, cian: CIAN_URL, winner: WINNER_URL };
const SITE_RE = { avito: /avito\.ru/, cian: /cian\.ru/, winner: /baza-winner\.ru/ };
ipcMain.handle('nav', (_e, what) => {
  const wc = view.webContents;
  if (what === 'welcome') { mode = 'welcome'; layout(); return; }
  if (what === 'ozon') {
    mode = 'work'; currentSite = 'ozon'; layout();
    if (!ozonView.webContents.getURL()) ozonView.webContents.loadURL(ozon.OZON_URL);
    return;
  }
  if (SITE_URL[what]) {
    mode = 'work'; currentSite = what; layout();
    // на тот же сайт заново не грузим — остаёмся на текущей странице (например, в открытом заказе)
    if (!SITE_RE[what].test(wc.getURL())) wc.loadURL(SITE_URL[what]);
    else send('url', wc.getURL());
    return;
  }
  if (what === 'back' && wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack();
  else if (what === 'reload') wc.reload();
});
ipcMain.handle('navUrl', async (_e, site, url, keepMode) => {
  if (!keepMode) mode = 'work';
  currentSite = site; layout();
  await view.webContents.loadURL(url).catch(() => {});
  await new Promise(r => setTimeout(r, 2000));
  send('url', view.webContents.getURL());
  return view.webContents.getURL();
});
ipcMain.handle('currentUrl', () => view.webContents.getURL());
// мастер: где показывать сайт (null — скрыть); режим 'wizard'
ipcMain.handle('siteRect', (_e, r) => {
  mode = 'wizard';
  siteRect = r ? rb(r) : null;
  layout(); return true;
});
ipcMain.handle('siteBack', () => { if (view.webContents.navigationHistory.canGoBack()) view.webContents.navigationHistory.goBack(); });
ipcMain.handle('siteReload', () => view.webContents.reload());
ipcMain.handle('stop', () => { stopFlag = true; return view.webContents.executeJavaScript('window.__pvzStop = true').catch(() => {}); });
ipcMain.handle('bwOrder', () => {
  const m = view.webContents.getURL().match(/baza-winner\.ru\/search\/([0-9a-f-]{36})/i);
  return m ? Object.assign({ guid: m[1] }, winner.orderInfo(m[1], loadCfg())) : null;
});

ipcMain.handle('start', async (_e, c) => {
  if (running) return { ok: false, error: 'Выгрузка уже идёт' };
  const cfg = Object.assign(loadCfg(), c);
  cfg.delay = Math.max(3, cfg.delay);
  saveCfg(cfg);
  const url = view.webContents.getURL();
  const site = /^https:\/\/(www\.)?avito\.ru\//.test(url) ? 'avito' : /^https:\/\/([a-z0-9-]+\.)?cian\.ru\//.test(url) ? 'cian'
             : /^https:\/\/w7\.baza-winner\.ru\//.test(url) ? 'winner' : '';
  if (!site) return { ok: false, error: 'Откройте на Авито / Циане страницу выдачи или в Winner — заказ' };
  const root = site === 'cian' ? cfg.cianRoot : cfg.root;
  if (!fs.existsSync(root)) return { ok: false, error: `Папка ${site === 'cian' ? 'АДРЕСА ЦИАН' : 'АДРЕСА'} не найдена — выберите её в панели` };

  if (site === 'winner') {
    running = true; stopFlag = false;
    try {
      const m = url.match(/\/search\/([0-9a-f-]{36})/i);
      if (m && c.bw) { cfg.bwOrders = Object.assign({}, cfg.bwOrders, { [m[1]]: { tag: c.bw.tag, hide: c.bw.hide, name: c.bw.name || (cfg.bwOrders && cfg.bwOrders[m[1]] && cfg.bwOrders[m[1]].name) || '' } }); saveCfg(cfg); }
      const r = await winner.run(view.webContents, cfg, c.bw || {}, st => send('status', st), () => stopFlag);
      const q = autoOzon(cfg, r.saved, c.forceCheck);
      if (!r.ok) journal.logError('Winner', r.error);
      else if (/ошибк/i.test(r.reason || '')) journal.logError('Winner', r.reason);
      journal.addHistory({ type: 'export', site, title: c.title || (r.extra || '').replace(/^Заказ: /, '').split(';')[0], ok: !!r.ok, total: r.total || 0, files: r.saved || [], reason: r.reason || r.error });
      return Object.assign({ site, withCoords: r.total, ozonQueued: q }, r);
    } catch (e) { journal.logError('Winner', e); journal.addHistory({ type: 'export', site, ok: false, total: 0, files: [], reason: String(e && e.message || e) }); return { ok: false, error: String(e && e.message || e) }; }
    finally { running = false; delete procs.export; procUpdate(); }
  }

  running = true;
  const timer = setInterval(async () => {
    try { const p = await view.webContents.executeJavaScript('window.__pvzProg || ""'); if (p) send('status', p); } catch {}
  }, 800);
  try {
    let code;
    if (site === 'cian') {
      const c2 = Object.assign({}, cfg, { seen: loadSeen(cfg, 'cian') });
      code = `(${cianCollector.toString()})(${JSON.stringify(c2)})`;
    } else code = `(${collector.toString()})(${JSON.stringify(Object.assign({}, cfg, { seen: loadSeen(cfg, 'avito') }))})`;
    const res = await view.webContents.executeJavaScript(code, true);
    clearInterval(timer);
    let out = { dir: '', saved: [] };
    // «Без новой Москвы»: убираем объявления из Новомосковского и Троицкого округов (по адресу)
    if (cfg.noNewMoscow && res.rows.length) {
      const before = res.rows.length, keep = [], keepIds = [];
      res.rows.forEach((r, i) => { if (!isNewMoscow(r[4] + ' ' + r[2])) { keep.push(r); if (res.ids) keepIds.push(res.ids[i]); } });
      res.rows = keep; if (res.ids) res.ids = keepIds;
      if (before > keep.length) res.extra = (res.extra ? res.extra + ' ' : '') + `Без новой Москвы: убрано ${before - keep.length}.`;
    }
    if (res.rows.length) {
      out = saveRows(res.rows, cfg, site);
      if (res.ids) addSeen(cfg, res.ids, site);
    }
    const q = autoOzon(cfg, out.saved, c.forceCheck);
    journal.addHistory({ type: 'export', site, title: c.title || '', ok: true, total: res.rows.length, files: out.saved, reason: res.reason });
    return { ok: true, site, reason: res.reason, extra: res.extra || '', total: res.rows.length, withCoords: res.withCoords, ozonQueued: q, ...out };
  } catch (e) {
    clearInterval(timer);
    journal.logError(site === 'cian' ? 'Циан' : 'Авито', e);
    journal.addHistory({ type: 'export', site, title: c.title || '', ok: false, total: 0, files: [], reason: String(e && e.message || e) });
    return { ok: false, error: String(e && e.message || e) };
  } finally { running = false; delete procs.export; procUpdate(); }
});

// ---------- проверка Ozon ----------
function autoOzon(cfg, files, force) {
  if (!(cfg.ozonAuto || force) || !files || !files.length) return 0;
  enqueueOzon(files); return files.length;
}
function enqueueOzon(paths) {
  for (const p of paths) if (!ozonQueue.includes(p)) ozonQueue.push(p);
  pumpOzon();
}
const PLATFORMS = [
  { key: 'yandex', cfg: 'chkYandex', journal: 'yandex_checked.json', label: 'Яндекс Маркет' },
  { key: 'wb', cfg: 'chkWb', journal: 'wb_checked.json', label: 'Wildberries' },
  { key: 'ozon', cfg: 'chkOzon', journal: 'ozon_checked.json', label: 'Ozon' }
];
const enabledPlatforms = cfg => PLATFORMS.filter(p => (p.key === 'ozon' ? cfg.chkOzon !== false : !!cfg[p.cfg]));
// какие файлы ещё не проверены на этой площадке (по её журналу)
function needs(cfg, p, paths) {
  const j = (() => { try { return JSON.parse(fs.readFileSync(path.join(cfg.ozonOut, p.journal), 'utf8')); } catch { return { files: {} }; } })();
  return paths.map(f => { try { return { path: f, size: fs.statSync(f).size }; } catch { return null; } })
    .filter(Boolean).filter(f => { const r = j.files[f.path]; return !r || r.size !== f.size || (r.pending && r.pending.length); });
}
async function ensureWb() {
  const wc = wbView.webContents;
  const test = () => wc.executeJavaScript(`fetch('/pvz-map-backend/api/v2/map/check-point?point.longitude=37.6176&point.latitude=55.7558&area=70&tariff_type=BasicTariff',{headers:{Accept:'application/json'}}).then(r=>r.status).catch(()=>0)`, true).catch(() => 0);
  if (/map\.wb\.ru/.test(wc.getURL()) && (await test()) === 200) return true;
  await wc.loadURL('https://map.wb.ru/').catch(() => {});
  for (let i = 0; i < 20; i++) { await new Promise(r => setTimeout(r, 2000)); if ((await test()) === 200) return true; }
  return false;
}
const wbFetch = async url => {
  const r = await wbView.webContents.executeJavaScript(`fetch(${JSON.stringify(url)},{headers:{Accept:'application/json'}}).then(async r=>({s:r.status,t:await r.text()})).catch(()=>({s:0,t:''}))`, true).catch(() => ({ s: 0, t: '' }));
  return { status: r.s, ok: r.s >= 200 && r.s < 300, json: async () => JSON.parse(r.t) };
};

async function pumpOzon() {
  if (ozonRunning) { send('ozonStatus', { text: `В очереди ещё файлов: ${ozonQueue.length}`, running: true, queued: ozonQueue.length }); return; }
  ozonRunning = true; ozonStop = false; ozonSkip = false;
  try {
    while (ozonQueue.length && !ozonStop) {
      const cfg = loadCfg();
      if (ozonFresh) { cfg.ozonCache = false; ozonFresh = false; }
      const paths = ozonQueue.splice(0);
      const results = [];
      for (const p of enabledPlatforms(cfg)) {
        if (ozonStop) break;
        const files = needs(cfg, p, paths);
        if (!files.length) continue;
        const status = (text, extra) => send('ozonStatus', Object.assign({ text, running: true }, extra || {}));
        if (p.key === 'ozon') {
          results.push(Object.assign({ kind: 'ozon', label: 'Ozon' }, await ozon.run(files, {
            wc: ozonView.webContents, cfg, log: m => trace.log('Ozon', m), cachePath: path.join(app.getPath('userData'), 'ozon_cache.json'), status, isStopped: () => ozonStop, takeSkip: () => { const v = ozonSkip; ozonSkip = false; return v; } })));
        } else {
          let fetchFn = trace.wrapFetch(u => net.fetch(u), p.key === 'wb' ? 'WB' : 'Яндекс');
          if (p.key === 'wb') {
            status('Wildberries: открываю карту map.wb.ru…');
            if (!(await ensureWb())) { results.push({ kind: 'wb', label: 'Wildberries', reason: 'карта WB не ответила — откройте вкладку позже и повторите', saved: [], errors: [], stats: {}, main: 0, excluded: 0, unchecked: 0, manual: [], files: files.length, addresses: 0 }); continue; }
            fetchFn = wbFetch;
          }
          results.push(await platforms.run(p.key, files, { fetch: fetchFn, status, isStopped: () => ozonStop, outDir: cfg.ozonOut }));
        }
      }
      send('ozonDone', { ok: true, results });
      if (results.length && (!win.isVisible() || !win.isFocused())) scheduler.notify('PVZ Master — проверка зон завершена', results.map(r => `${r.label}: ${r.kind === 'ozon' ? 'файлов ' + r.saved.length : 'в «Результат» ' + r.main}`).join(' · '));
      if (results.length) journal.addHistory({ type: 'check', ok: true, title: results.map(r => r.label).join(', '),
        total: results.reduce((a, r) => a + (r.addresses || 0), 0), files: results.flatMap(r => r.saved || []),
        reason: results.map(r => `${r.label}: ${r.reason}`).join('; '),
        details: results.map(r => ({ label: r.label, addresses: r.addresses, suitable: r.kind === 'ozon' ? Object.entries(r.stats || {}).filter(([k]) => !['green_small', 'out_zone', 'unchecked'].includes(k)).reduce((a, [, v]) => a + v, 0) : r.main, unchecked: r.unchecked || (r.stats && r.stats.unchecked) || 0 })) });
      for (const r of results) for (const e of (r.errors || [])) journal.logError(r.label, e);
    }
  } catch (e) {
    journal.logError('проверка зон', e);
    journal.addHistory({ type: 'check', ok: false, title: 'Проверка зон', total: 0, files: [], reason: String(e && e.message || e) });
    send('ozonDone', { ok: false, error: String(e && e.message || e) });
  } finally { ozonRunning = false; if (ozonStop) ozonQueue.length = 0; }
}
ipcMain.handle('ozonScan', () => {
  const cfg = loadCfg();
  const map = new Map();
  for (const p of enabledPlatforms(cfg)) {
    for (const f of ozon.scan([cfg.root, cfg.cianRoot], cfg.ozonOut, cfg.ozonDays, p.journal)) {
      const e = map.get(f.path) || { path: f.path, name: path.basename(f.path), folder: path.basename(path.dirname(f.path)), partial: false, platforms: [] };
      e.platforms.push(p.key); e.partial = e.partial || f.partial; map.set(f.path, e);
    }
  }
  const files = [...map.values()].sort((a, b) => a.path.localeCompare(b.path, 'ru', { numeric: true }));
  return { running: ozonRunning, files };
});
let ozonFresh = false;
ipcMain.handle('ozonStart', (_e, paths, opts) => {
  if (!paths || !paths.length) return { ok: false, error: 'Нет файлов для проверки' };
  if (opts && opts.fresh) {   // «Попробовать снова»: забыть, что эти файлы уже проверялись, и не брать результаты из памяти
    const cfg = loadCfg();
    for (const p of PLATFORMS) {
      const jp = path.join(cfg.ozonOut, p.journal);
      try { const j = JSON.parse(fs.readFileSync(jp, 'utf8')); for (const f of paths) delete j.files[f]; fs.writeFileSync(jp, JSON.stringify(j, null, 1)); } catch {}
    }
    ozonFresh = true;
  }
  enqueueOzon(paths); return { ok: true };
});
ipcMain.handle('ozonStop', () => { ozonStop = true; return true; });
// «Перепроверить зоны»: по файлам результатов находим исходные выгрузки (по журналам проверок)
ipcMain.handle('resultSources', (_e, results) => {
  const cfg = loadCfg(), want = new Set(results), out = new Set();
  for (const p of PLATFORMS) {
    try { const j = JSON.parse(fs.readFileSync(path.join(cfg.ozonOut, p.journal), 'utf8')); for (const [src, v] of Object.entries(j.files || {})) if (v && want.has(v.result) && fs.existsSync(src)) out.add(src); } catch {}
  }
  return [...out];
});
// ---------- карта Ozon для выбранного объявления (вкладка «Результаты») ----------
let mapView = null, mapReady = null, mapSeq = 0;
function ensureMapView() {
  if (mapView) return;
  mapView = new WebContentsView({ webPreferences: { partition: 'persist:ozon', contextIsolation: true, backgroundThrottling: false } });
  win.contentView.addChildView(mapView); mapView.setVisible(false);
  mapView.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mapReady = mapView.webContents.loadURL(ozon.OZON_URL).catch(() => {});
}
const FIND_INPUT = `(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const vis = e => { const r = e.getBoundingClientRect(); return r.width > 40 && r.height > 10 && r.bottom > 0 && getComputedStyle(e).visibility !== 'hidden'; };
  let inp = null, all = [];
  for (let i = 0; i < 40 && !inp; i++) {
    all = [...document.querySelectorAll('input:not([type=hidden]):not([type=checkbox]):not([type=radio]),textarea')].filter(vis);
    inp = all.find(e => /адрес|поиск|найти|search|город|улиц/i.test((e.placeholder || '') + ' ' + (e.getAttribute('aria-label') || '') + ' ' + (e.name || ''))) || all[0];
    if (!inp) {
      // поле поиска спрятано за кнопкой-лупой (как на карте WB) — нажать её
      if (i === 4 || i === 12) {
        const b = [...document.querySelectorAll('[aria-label*="оиск" i], [aria-label*="search" i], [title*="оиск" i], [data-testid*="search" i], button[class*="search" i], [class*="search" i] button, [class*="Search" i][role="button"], div[class*="search" i]')]
          .find(e => { const r = e.getBoundingClientRect(); return r.width > 10 && r.width < 400 && r.height > 10 && r.height < 120; });
        if (b) { b.click(); ['pointerdown', 'mousedown', 'pointerup', 'mouseup'].forEach(t => b.dispatchEvent(new MouseEvent(t, { bubbles: true }))); }
      }
      await sleep(500);
    }
  }
  if (!inp) return { ok: false, why: 'на странице нет поля поиска', title: document.title, url: location.href };
  inp.scrollIntoView({ block: 'center' }); inp.focus(); inp.select && inp.select();
  const r = inp.getBoundingClientRect();
  return { ok: true, x: r.left + r.width / 2, y: r.top + r.height / 2, ph: inp.placeholder || inp.getAttribute('aria-label') || '', n: all.length };
})()`;
// подсказка именно под новый адрес: ждём, пока в списке появится строка с номером дома / словом улицы из запроса
const FIND_OPTION = (q, prev) => `(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const vis = e => { const r = e.getBoundingClientRect(); return r.width > 40 && r.height > 12 && r.bottom > 0 && r.top < innerHeight && getComputedStyle(e).visibility !== 'hidden'; };
  const norm = s => String(s).toLowerCase().replace(/ё/g, 'е');
  const q = norm(${JSON.stringify(q)}), prev = norm(${JSON.stringify(prev || '')});
  const parts = q.split(',').map(s => s.trim()).filter(Boolean);
  const house = (q.match(/(\\d+[а-я]?(?:\\/\\d+)?)(?!.*\\d)/) || [])[1] || '';
  const words = (parts.find(p => /[а-я]{4,}/.test(p) && !/москва|область|россия/.test(p)) || '').split(/\\s+/).filter(w => w.length >= 4 && !/улица|проспект|переулок|шоссе|бульвар|проезд|корпус|строение/.test(w));
  const inp = document.activeElement;
  let best = null;
  for (let i = 0; i < 24; i++) {
    await sleep(350);
    const ok = e => vis(e) && e !== inp && !(inp && inp.contains(e)) && e.textContent.trim().length > 3 && e.children.length < 12;
    let c = [...document.querySelectorAll('[class*=listItem], [class*=list-item], [role=option]')].filter(ok);
    if (!c.length) c = [...document.querySelectorAll('[role=listbox] > *, [class*=uggest] li, [class*=uggest] [class*=tem], [class*=listContent] > *')].filter(ok);
    if (!c.length) continue;
    const score = e => { const t = norm(e.textContent); return (house && t.includes(house) ? 2 : 0) + (words.some(w => t.includes(w.slice(0, 6))) ? 1 : 0); };
    const scored = c.map(e => [score(e), e]).sort((a, b) => b[0] - a[0]);
    best = scored[0];
    // список ещё старый (как у прошлого поиска) — ждём обновления
    if (prev && norm(best[1].textContent) === prev && !norm(best[1].textContent).includes(house)) continue;
    if (best[0] >= (house ? 2 : 1) || i >= 12) break;
  }
  if (!best) return { ok: false };
  const e = best[1], r = e.getBoundingClientRect();
  document.querySelectorAll('[data-pvz-opt]').forEach(x => x.removeAttribute('data-pvz-opt')); e.setAttribute('data-pvz-opt', '1');
  return { ok: true, x: r.left + Math.min(r.width / 2, 120), y: r.top + r.height / 2, text: e.textContent.trim().slice(0, 140), score: best[0] };
})()`;
// карта Ozon показала ошибку («Что-то пошло не так», «Не смогли отобразить…») — обычно помогает перезагрузка
const MAP_ERR = `(() => { const t = (document.body && document.body.innerText || '').slice(0, 20000);
  return /Что-то пошло не так|Произошла ошибка|Ошибка загрузки|Попробуйте обновить|Не смогли отобразить|Сервис временно недоступен/i.test(t); })()`;
let mapLastText = '', mapLastQuery = '', mapFixing = false;
// пока карта Ozon открыта: если на ней появилась ошибка — перезагрузить и снова найти адрес
setInterval(async () => {
  if (!mapView || mapFixing || !mapView.getVisible || !mapView.getVisible()) return;
  if (!(await mapView.webContents.executeJavaScript(MAP_ERR, true).catch(() => false))) return;
  mapFixing = true; trace.log('карта Ozon', 'ошибка на карте — автообновление');
  try { await mapReloadWait(); if (mapLastQuery) await mapSearchOnce(mapView.webContents, mapLastQuery, mapSeq); } catch {} finally { mapFixing = false; }
}, 6000);
// координаты из страницы — в CSS-пикселях; при масштабе сайта (75 %, 125 %…) их нужно пересчитать,
// иначе щелчок уходит мимо (на карту) и точка «прыгает» рядом, а не на адрес
function clickAt(wc, x, y) {
  const z = wc.getZoomFactor() || 1;
  for (const type of ['mouseMove', 'mouseDown', 'mouseUp']) wc.sendInputEvent({ type, x: Math.round(x * z), y: Math.round(y * z), button: 'left', clickCount: 1 });
}
ipcMain.handle('ozonMapRect', (_e, rect) => {
  if (!mapView) return;
  if (rect && rect.width > 50) { mapView.setBounds(rb(rect)); mapView.setVisible(true); }
  else mapView.setVisible(false);
});
async function mapReloadWait() {
  mapReady = mapView.webContents.loadURL(ozon.OZON_URL).catch(() => {});
  await mapReady; await new Promise(r => setTimeout(r, 3500));
}
async function mapSearchOnce(wc, q, seq, reloadFn = mapReloadWait, seqRef = () => mapSeq) {
  if (await wc.executeJavaScript(MAP_ERR, true).catch(() => false)) { trace.log('карта', 'на карте ошибка — перезагружаю'); await reloadFn(); }
  const f = await wc.executeJavaScript(FIND_INPUT, true);
  if (seq !== seqRef()) return { ok: false, why: 'отменено' };
  trace.log('карта Ozon', 'поле поиска: ' + JSON.stringify(f));
  if (!f.ok) return { ok: false, why: f.why, reload: true };
  clickAt(wc, f.x, f.y);
  await new Promise(r => setTimeout(r, 200));
  const mod = process.platform === 'darwin' ? 'meta' : 'control';
  wc.sendInputEvent({ type: 'keyDown', keyCode: 'A', modifiers: [mod] }); wc.sendInputEvent({ type: 'keyUp', keyCode: 'A', modifiers: [mod] });
  wc.sendInputEvent({ type: 'keyDown', keyCode: 'Backspace' }); wc.sendInputEvent({ type: 'keyUp', keyCode: 'Backspace' });
  // поле могло остаться со старым адресом (после выбора подсказки сайт держит свой текст) — очистить надёжно
  const SETV = v => `(() => { const e = document.activeElement; if (!e || !('value' in e)) return null;
    const set = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(e), 'value').set; set.call(e, ${JSON.stringify(v)});
    e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); return e.value; })()`;
  await wc.executeJavaScript(SETV(''), true).catch(() => {});
  await new Promise(r => setTimeout(r, 250));
  await wc.insertText(q);
  const now = await wc.executeJavaScript(`(document.activeElement && document.activeElement.value) || ''`, true).catch(() => '');
  if (now.trim() !== q.trim()) { trace.log('карта', 'в поле «' + now + '» вместо адреса — ставлю заново'); await wc.executeJavaScript(SETV(q), true).catch(() => {}); }
  const o = await wc.executeJavaScript(FIND_OPTION(q, mapLastText), true);
  if (seq !== seqRef()) return { ok: false, why: 'отменено' };
  trace.log('карта Ozon', 'подсказка: ' + JSON.stringify(o));
  if (o.ok) {
    clickAt(wc, o.x, o.y); mapLastText = o.text;
    // если подсказка всё ещё на экране (щелчок не сработал) — нажать её из страницы
    await new Promise(r => setTimeout(r, 500));
    await wc.executeJavaScript(`(() => { const e = document.querySelector('[data-pvz-opt]'); if (!e || !e.isConnected || e.getBoundingClientRect().height < 5) return 0;
      ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(t => e.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window }))); return 1; })()`, true).catch(() => {});
    await new Promise(r => setTimeout(r, 1800));
    if (await wc.executeJavaScript(MAP_ERR, true).catch(() => false)) return { ok: false, why: 'карта показала ошибку', reload: true };
    return { ok: true, how: 'suggest', text: o.text };
  }
  wc.sendInputEvent({ type: 'keyDown', keyCode: 'Return' }); wc.sendInputEvent({ type: 'char', keyCode: '\r' }); wc.sendInputEvent({ type: 'keyUp', keyCode: 'Return' });
  return { ok: true, how: 'enter' };
}
ipcMain.handle('ozonMapShow', async (_e, rect, q) => {
  const seq = ++mapSeq;
  ensureMapView();
  if (rect) { mapView.setBounds(rb(rect)); mapView.setVisible(true); }
  const wc = mapView.webContents;
  trace.log('карта Ozon', 'поиск: ' + q); mapLastQuery = q;
  try {
    await mapReady; applyZoom(wc);
    if (/antibot|challenge/i.test(wc.getTitle()) || !/pvz-map\.ozon\.ru/.test(wc.getURL())) await new Promise(r => setTimeout(r, 4000));
    let res = await mapSearchOnce(wc, q, seq);
    if (!res.ok && res.reload && seq === mapSeq) { trace.log('карта Ozon', 'повтор после перезагрузки: ' + res.why); await mapReloadWait(); res = await mapSearchOnce(wc, q, seq); }
    return res;
  } catch (e) { trace.log('карта Ozon', 'ошибка: ' + e.message); return { ok: false, why: e.message }; }
});
// ---------- другие карты и сайт объявления (вкладка «Результаты») ----------
// map-слот: одна из карт (Ozon — выше, остальные здесь); listing-слот: сайт выбранного объявления
const EXT = {
  yandex: { part: 'persist:maps', url: q => `https://yandex.ru/maps/213/moscow/?text=${encodeURIComponent(q)}&z=17` },
  '2gis': { part: 'persist:maps', url: q => `https://2gis.ru/moscow/search/${encodeURIComponent(q)}` },
  osm: { part: 'persist:maps', url: (q, p) => p && p.lat != null ? `https://www.openstreetmap.org/?mlat=${p.lat}&mlon=${p.lon}#map=18/${p.lat}/${p.lon}` : `https://www.openstreetmap.org/search?query=${encodeURIComponent(q)}` },
  wb: { part: 'persist:wb', base: 'https://map.wb.ru/' },
  ym: { part: 'persist:maps', base: 'https://logistics.market.yandex.ru/lp/market-pvz' },
  listing: { part: 'persist:avito' }
};
const ext = {};
function extView(key) {
  if (ext[key]) return ext[key];
  const v = new WebContentsView({ webPreferences: { partition: EXT[key].part, contextIsolation: true, backgroundThrottling: false } });
  win.contentView.addChildView(v); v.setVisible(false);
  v.webContents.setWindowOpenHandler(({ url }) => { v.webContents.loadURL(url).catch(() => {}); return { action: 'deny' }; });
  v.webContents.on('did-navigate', () => applyZoom(v.webContents));
  const e = ext[key] = { view: v, seq: 0, ready: null };
  if (EXT[key].base) e.ready = v.webContents.loadURL(EXT[key].base).catch(() => {});
  return e;
}
const setB = (v, rect) => { if (rect && rect.width > 50) { v.setBounds(rb(rect)); v.setVisible(true); } else v.setVisible(false); };
ipcMain.handle('extRect', (_e, key, rect) => {
  if (key && ext[key]) setB(ext[key].view, rect);
});
ipcMain.handle('extHideAll', (_e, slot) => { for (const [k, e] of Object.entries(ext)) if (!slot || (slot === 'listing') === (k === 'listing')) e.view.setVisible(false); });
ipcMain.handle('extShow', async (_e, key, rect, q, pt) => {
  const e = extView(key), wc = e.view.webContents, seq = ++e.seq;
  setB(e.view, rect);
  trace.log('карта ' + key, 'показать: ' + (q || ''));
  try {
    if (key === 'listing') { if (q && wc.getURL() !== q) await wc.loadURL(q).catch(() => {}); return { ok: true }; }
    if (EXT[key].url) { await wc.loadURL(EXT[key].url(q, pt)).catch(() => {}); applyZoom(wc); return { ok: true }; }
    await e.ready; applyZoom(wc);
    await new Promise(r => setTimeout(r, 1500));
    const reload = async () => { e.ready = wc.loadURL(EXT[key].base).catch(() => {}); await e.ready; await new Promise(r => setTimeout(r, 3500)); };
    let res = await mapSearchOnce(wc, q, seq, reload, () => e.seq);
    if (!res.ok && res.reload && seq === e.seq) { await reload(); res = await mapSearchOnce(wc, q, seq, reload, () => e.seq); }
    return res;
  } catch (err) { return { ok: false, why: err.message }; }
});
ipcMain.handle('extReload', (_e, key) => { if (ext[key]) ext[key].view.webContents.reload(); });
ipcMain.handle('extExternal', (_e, key) => { if (ext[key]) shell.openExternal(ext[key].view.webContents.getURL()); });
ipcMain.handle('ozonMapReload', () => { if (mapView) { mapReady = mapView.webContents.loadURL(ozon.OZON_URL).catch(() => {}); } });
ipcMain.handle('ozonNow', () => { ozonSkip = true; trace.log('проверка', 'нажато «Попробовать сейчас»'); return true; });
ipcMain.handle('exportRows', async (_e, rows) => {
  const d = new Date(), name = `Отмеченные ${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}-${String(d.getMinutes()).padStart(2, '0')}.xlsx`;
  const c = loadCfg();
  const r = await dialog.showSaveDialog(win, { title: 'Сохранить отмеченные', defaultPath: path.join(c.ozonOut && fs.existsSync(c.ozonOut) ? c.ozonOut : app.getPath('desktop'), name), filters: [{ name: 'Excel', extensions: ['xlsx'] }] });
  if (r.canceled || !r.filePath) return null;
  const ExcelJS = require('exceljs'), wb = new ExcelJS.Workbook(), ws = wb.addWorksheet('Отмеченные');
  const FILL = { 'синий': '8DB4E2', 'голубой': 'BDD7EE', 'зелёный': 'C6EFCE', 'гарантия < 3 млн': 'E4DFEC', 'ошибка запроса': 'FFC000' };
  ws.columns = [{ header: '№', width: 5 }, { header: 'Площадка', width: 10 }, { header: 'Зона', width: 18 }, { header: 'Адрес', width: 48 }, { header: 'Метро', width: 22 },
    { header: 'Мин. площадь', width: 12 }, { header: 'Макс. площадь', width: 12 }, { header: 'Цена, ₽', width: 12 }, { header: 'Выплата, ₽', width: 12 }, { header: 'Источник', width: 10 },
    { header: 'Дата', width: 11 }, { header: 'Сверка адреса', width: 40 }, { header: 'Ссылка', width: 22 }, { header: 'Координаты', width: 20 }];
  rows.forEach((x, i) => {
    const row = ws.addRow([i + 1, x.platform, x.zone, x.address, x.metro, x.areaMin, x.areaMax, x.price, x.money, x.source, x.date, x.note, x.url ? { text: 'Открыть объявление', hyperlink: x.url } : '', x.lat != null ? `${x.lat},${x.lon}` : '']);
    const f = x.platform === 'Ozon' && FILL[x.zone]; if (f) row.eachCell(cl => (cl.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + f } }));
    if (x.url) row.getCell(13).font = { color: { argb: 'FF0563C1' }, underline: true };
    [8, 9].forEach(k => (row.getCell(k).numFmt = '#,##0'));
  });
  ws.getRow(1).font = { bold: true }; ws.views = [{ state: 'frozen', ySplit: 1 }]; ws.autoFilter = { from: 'A1', to: 'N1' };
  await wb.xlsx.writeFile(r.filePath); shell.showItemInFolder(r.filePath); return r.filePath;
});
ipcMain.handle('openLogs', () => { fs.mkdirSync(trace.dir(), { recursive: true }); return shell.openPath(trace.dir()); });
ipcMain.handle('makeReport', async () => {
  const d = new Date(), name = `PVZ-Master-отчёт-${d.toISOString().slice(0, 10)}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}.zip`;
  const r = await dialog.showSaveDialog(win, { title: 'Сохранить отчёт для разбора', defaultPath: path.join(app.getPath('desktop'), name), filters: [{ name: 'ZIP', extensions: ['zip'] }] });
  if (r.canceled || !r.filePath) return null;
  trace.makeReport(r.filePath, journal.report(updater.currentBuild()));
  shell.showItemInFolder(r.filePath);
  return r.filePath;
});
ipcMain.handle('ozonClearCache', () => {
  const p = path.join(app.getPath('userData'), 'ozon_cache.json');
  let n = 0; try { n = Object.keys(JSON.parse(fs.readFileSync(p, 'utf8'))).length; fs.unlinkSync(p); } catch {}
  return n;
});
ipcMain.handle('ozonState', () => ({ running: ozonRunning, queued: ozonQueue.length }));

ipcMain.handle('history', () => journal.readHistory());
ipcMain.handle('results', () => results.collect(loadCfg().ozonOut));
ipcMain.handle('bwOrders', () => {
  const cfg = loadCfg(), out = {};
  for (const [g, o] of Object.entries(winner.KNOWN)) out[g] = { guid: g, name: o.name };
  for (const [g, o] of Object.entries(cfg.bwOrders || {})) out[g] = { guid: g, name: (o && o.name) || (out[g] && out[g].name) || ('Заказ ' + g.slice(0, 8)) };
  return Object.values(out);
});
ipcMain.handle('notify', (_e, t, b) => scheduler.notify(t, b));
// ---------- слежение за картой зон Ozon ----------
// раз в 6 часов (и через 2 минуты после запуска) берём 20 участков Москвы из слоя зон Ozon и сравниваем с прошлым разом;
// если поменялось 2+ участка — Ozon обновил зоны: сообщение на главном экране и уведомление
const ZW_TILES = (() => { const out = [], z = 13, n = 2 ** z; const tx = lon => Math.floor((lon + 180) / 360 * n); const ty = lat => { const s = Math.sin(lat * Math.PI / 180); return Math.floor((0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n); };
  for (const lat of [55.58, 55.65, 55.72, 55.79, 55.86]) for (const lon of [37.40, 37.53, 37.66, 37.79]) out.push([tx(lon), ty(lat), z]); return out; })();
async function zoneWatch() {
  if (ozonRunning || !win || win.isDestroyed()) return;
  const wc = ozonView.webContents;
  try {
    if (!/pvz-map\.ozon\.ru/.test(wc.getURL())) { await wc.loadURL(ozon.OZON_URL).catch(() => {}); await new Promise(r => setTimeout(r, 6000)); }
    if (ozonRunning) return;
    await new Promise(r => setTimeout(r, 1500));
    const run = () => wc.executeJavaScript(`(async () => { const out = {};
      for (const [x, y, z] of ${JSON.stringify(ZW_TILES)}) {
        try { const r = await fetch('/p-api/orp-agent-api/map/render-vtile?x=' + x + '&y=' + y + '&z=' + z + '&layerName=RecommendedZone&tt=' + Date.now(), { credentials: 'include' });
          if (r.status !== 200) { out[x + '/' + y] = 'E' + r.status; continue; }
          const b = new Uint8Array(await r.arrayBuffer()); const d = new Uint8Array(await crypto.subtle.digest('SHA-1', b));
          out[x + '/' + y] = [...d].map(v => v.toString(16).padStart(2, '0')).join('') + ':' + b.length;
        } catch (e) { out[x + '/' + y] = 'E'; }
        await new Promise(r => setTimeout(r, 400)); }
      return out; })()`, true);
    let res; try { res = await run(); } catch { await new Promise(r => setTimeout(r, 8000)); res = await run(); }   // страница ещё перезагружалась
    const ok = Object.values(res).filter(v => !String(v).startsWith('E'));
    if (ok.length < 15) { trace.log('зоны Ozon', 'не удалось получить участки карты: ' + JSON.stringify(res).slice(0, 300)); return; }
    const c = loadCfg(), prev = c.zoneHashes || null;
    if (prev) {
      const changed = Object.keys(res).filter(k => !String(res[k]).startsWith('E') && prev[k] && !String(prev[k]).startsWith('E') && prev[k] !== res[k]).length;
      trace.log('зоны Ozon', `сравнение с ${c.zoneHashesAt ? new Date(c.zoneHashesAt).toLocaleString('ru-RU') : '?'}: изменилось ${changed} из ${ok.length}`);
      if (changed >= 2) {
        c.zonesChange = { at: Date.now(), changed, total: ok.length, since: c.zoneHashesAt || null, seen: false };
        scheduler.notify('PVZ Master: Ozon обновил карту зон', `Изменилось ${changed} из ${ok.length} участков Москвы. Старые результаты могут быть неточными — можно перепроверить зоны.`);
        send('zonesChanged', c.zonesChange);
      }
    } else trace.log('зоны Ozon', 'первый снимок карты зон сохранён');
    c.zoneHashes = res; c.zoneHashesAt = Date.now(); saveCfg(c);
  } catch (e) { trace.log('зоны Ozon', 'ошибка: ' + e.message); }
}
setTimeout(() => { zoneWatch(); setInterval(zoneWatch, 6 * 3600e3); }, 120e3);
ipcMain.handle('zonesSeen', () => { const c = loadCfg(); if (c.zonesChange) { c.zonesChange.seen = true; saveCfg(c); } return true; });
ipcMain.handle('zonesCheckNow', () => zoneWatch());
ipcMain.handle('vpnCheck', () => require('./vpn').check());
ipcMain.handle('flats', (_e, lat, lon, addr) => require('./flats').lookup(lat, lon, addr));
ipcMain.handle('flatsCached', (_e, pts) => { const f = require('./flats'); return pts.map(([a, b]) => f.cached(a, b)); });
ipcMain.handle('setAutostart', (_e, on) => { const c = Object.assign(loadCfg(), { autostart: !!on }); saveCfg(c); scheduler.applyAutostart(on); return true; });
ipcMain.handle('isVisible', () => win.isVisible());
ipcMain.handle('errors', () => journal.readErrors());
ipcMain.handle('clearErrors', () => journal.clearErrors());
ipcMain.handle('copyReport', () => { clipboard.writeText(journal.report(updater.currentBuild())); return true; });
ipcMain.handle('logError', (_e, where, msg) => journal.logError(where, msg));
ipcMain.handle('openFile', (_e, p) => shell.openPath(p));
ipcMain.handle('showFile', (_e, p) => shell.showItemInFolder(p));
ipcMain.handle('openExternal', (_e, u) => /^https?:\/\//.test(u) && shell.openExternal(u));

ipcMain.handle('checkUpdate', () => updater.check(win, { manual: true }));
ipcMain.handle('version', () => updater.currentBuild());

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();
app.on('second-instance', () => { if (win) { win.show(); win.focus(); } });
app.on('activate', () => { if (win) win.show(); });
if (gotLock) app.whenReady().then(() => {
  createWindow(); updater.schedule(win);
  scheduler.setupTray(win); scheduler.bindClose(win, loadCfg);
  // VPN: предупреждение при запуске и если включится во время работы
  require('./vpn').watch((r, was) => {
    trace.log('сеть', `VPN: ${r.vpn ? 'похоже, включён' : 'нет'}${r.adapter ? ' (адаптер ' + r.adapter + ')' : ''}; ответы: ${JSON.stringify(r.status)}`);
    if (r.vpn) scheduler.notify('PVZ Master: похоже, включён VPN', 'С VPN Авито, Циан и карта Ozon могут не открываться. Выключите VPN, чтобы выгрузка и проверка работали.');
    if (r.vpn || was) send('vpn', r);
  }); scheduler.applyAutostart(loadCfg().autostart);
  scheduler.start(loadCfg, s => { journal.addHistory({ type: 'schedule', ok: true, title: s.name || s.preset || 'задание', reason: 'запуск по расписанию ' + s.time }); win.webContents.send('runSchedule', s); }); if (process.env.PVZ_DEBUG) console.log('PVZ main ready, exceljs', typeof require('exceljs').Workbook, 'build', updater.currentBuild());
  if (process.env.PVZ_SHOT) selfTest(process.env.PVZ_SHOT);
});
async function ozDump() {
  const code = `(async()=>{const urls=new Set();performance.getEntriesByType('resource').filter(e=>/[.]js([?]|$)/.test(e.name)).forEach(e=>urls.add(e.name));[...document.scripts].forEach(s=>s.src&&urls.add(s.src));const out=[];for(const u of urls){try{out.push([u,await (await fetch(u)).text()])}catch(e){}}out.push(['html',document.documentElement.outerHTML]);return JSON.stringify(out)})()`;
  const arr = JSON.parse(await mapView.webContents.executeJavaScript(code));
  const d = process.env.PVZ_OZDUMP; fs.mkdirSync(d, { recursive: true });
  arr.forEach(([u, t], k) => fs.writeFileSync(path.join(d, k + '_' + u.split('/').pop().replace(/[^\w.-]/g, '_').slice(0, 60) + '.txt'), u + '\n' + t));
  console.log('SAVED', arr.length);
}
// самопроверка интерфейса (только для разработки): обходит экраны, пишет ошибки консоли и снимки окна
async function selfTest(dir) {
  win.webContents.on('console-message', (_e, level, msg) => { if (level >= 2) console.log('RENDERER', msg); });
  const W8 = ms => new Promise(r => setTimeout(r, ms));
  await W8(2500);
  const shot = async n => { const img = await win.webContents.capturePage(); fs.writeFileSync(path.join(dir, n + '.png'), img.toPNG()); };
  const J = c => win.webContents.executeJavaScript(c, true).catch(e => console.log('JSERR', e.message));
  if (process.env.PVZ_THEME) await J(`localStorage.setItem('pvzTheme','${process.env.PVZ_THEME}'); location.reload(); 1`).catch(()=>{}), await W8(2500);
  await shot('01-home');
  await J(`$('startBtn').click(); 1`); await W8(1200); await shot('02-select');
  await J(`$('wzNext').click(); 1`); await W8(900); await shot('03-cian');
  await J(`$('wzNext').click(); 1`); await W8(900); await shot('04-avito');
  await J(`$('aOpen').click(); 1`); await W8(3500); await shot('04b-avito-site');
  console.log('VIEW', JSON.stringify({ visible: view.getVisible ? view.getVisible() : null, bounds: view.getBounds(), host: await J(`JSON.stringify($('wzSiteHost').getBoundingClientRect())`) }));
  await J(`$('wzSiteClose').click(); 1`); await W8(500);
  await J(`$('wzNext').click(); 1`); await W8(900); await shot('05-avito-modal');
  await J(`[...document.querySelectorAll('#mBtns button')].find(b=>/без них/.test(b.textContent)).click(); 1`); await W8(1200); await shot('06-winner');
  await J(`document.querySelector('#oList .on') && document.querySelector('#oList .on').click(); 1`); await W8(300);
  await J(`$('wzNext').click(); 1`); await W8(900); await J(`document.querySelectorAll('#wzStep details.fold').forEach(d=>d.open=true); 1`); await W8(400); await shot('07-center');
  for (const page of ['results', 'history', 'schedule', 'settings']) { await J(`openPage('${page}'); 1`); await W8(1800); await shot('08-' + page); }
  if (process.env.PVZ_FAKE) {
    await J(`openPage('results'); 1`); await W8(1500);
    await J(`(()=>{const z=['голубой','синий','зелёный'];const rows=Array.from({length:14},(_,i)=>({platform:'Ozon',zone:z[i%3],address:'Москва, ул. Тестовая, '+(i%10+1),metro:'м. Пример',note:'',areaMin:30+(i%10),price:50000+i*5000,checked:Date.now()-Math.floor(i/6)*864e5-(i%2)*3600e3,url:'https://x/'+i,lat:55.7+i*0.01,lon:37.5+i*0.01,file:'OZON export_excel ЦИАН 13 '+(1+i%2)+'.xlsx'}));rows.push({platform:'Яндекс',zone:'синий',address:'ул. Тестовая, 2',metro:'',note:'',areaMin:31,price:55000,checked:Date.now(),url:'https://x/y',lat:55.71,lon:37.51,file:'ЯНДЕКС export_excel ЦИАН 13 1.xlsx'});R.marks={};R.seen={'https://x/3':1};R.watch={};prepRows(rows);R.day=dayKey(Date.now());renderDays();renderResults(true);})(); 1`);
    await W8(1500); await shot('09-results-fake');
    if (process.env.PVZ_ZW) { await zoneWatch(); const c1 = loadCfg(); if (!c1.zoneHashes) { console.log('ZW none'); } else { c1.zoneHashes[Object.keys(c1.zoneHashes)[0]] = 'x'; c1.zoneHashes[Object.keys(c1.zoneHashes)[1]] = 'y'; saveCfg(c1); } await zoneWatch(); console.log('ZW', JSON.stringify(loadCfg().zonesChange)); await J(`openPage('results'); 1`); await W8(300); await J(`document.querySelector('#results .back-home').click(); 1`); await W8(800); await shot('14-zone-note'); }
    if (process.env.PVZ_DEEP) {
      const steps = [
        "document.querySelector('#rDays [data-day=all]').click()", "document.querySelector('#rDays [data-day=watch]').click()", "document.querySelector('#rDays [data-day=marked]').click()",
        "R.day=dayKey(Date.now());renderDays();renderResults(true)", "document.querySelector('#rUps [data-up]:not([data-up=all])') && document.querySelector('#rUps [data-up]:not([data-up=all])').click()",
        "$('rDedup').click()", "$('rDedup').click()", "$('rNew').click()", "$('rNew').click()", "$('rMatch').click()", "$('rMatch').click()",
        "document.querySelector('#rRows tr .star').click()", "document.querySelector('#rRows tr .mbox input').click()", "document.querySelector('#rRows tr .copy-a').click()",
        "$('rSeenAll').click()", "document.querySelector('#rRows tr').click()",
        "setMapMode('2gis')", "setMapMode('osm')", "setMapMode('res')", "$('rBase').value='osm';$('rBase').onchange()", "setMapMode('ym')", "R.split=true;layoutMaps()", "setMapMode('yandex')", "R.split=false;layoutMaps()",
        "document.querySelector('[data-fs=rMapCol]').click()", "$('fsExit').click()", "$('rShowLst').click()", "$('rShowLst').click()",
        "document.querySelectorAll('#rHead th[data-k]').forEach(t=>t.click())", "$('rSearch').value='Тест';$('rSearch').dispatchEvent(new Event('input'))", "$('rSearch').value='';$('rSearch').dispatchEvent(new Event('input'))",
        "$('rExport').click()", "document.querySelector('#modal.on .m-btns button') && document.querySelector('#modal.on .m-btns button').click()",
        "document.querySelector('[data-settings]').click()", "document.querySelector('#settings .back-home').click()",
        "openPage('settings')", "$('setSeenDays').value='7';$('setSeenDays').onchange()", "$('setTestSup').click()", "$('setTestSplit').click()", "document.querySelector('#setTheme [data-v=light]').click()", "document.querySelector('#setTheme [data-v=dark]').click()",
        "openPage('history')", "openPage('schedule')", "openWatch()", "openPage('results')"
      ];
      for (const s of steps) { const r = await J(`(()=>{try{${s};return 'ok'}catch(e){return 'ERR '+e.message}})()`); if (r !== 'ok') console.log('DEEPFAIL', s, r); await W8(350); }
      await shot('13-deep');
      console.log('DEEPDONE');
    }
    if (process.env.PVZ_EXT) {
      await J(`selectRow(1,true); R.split=true; setMapMode('yandex'); setMapMode('ym'); R.showLst=true; applyLst(); 1`); await W8(14000); await shot('11-split');
      if (ext.yandex) fs.writeFileSync(path.join(dir, '12-yandex.png'), (await ext.yandex.view.webContents.capturePage()).toPNG());
      console.log('LST', await J(`JSON.stringify([rectOf('rLstHost'), R.showLst, R.sel, document.querySelector('.r-body').className])`)); console.log('EXT', JSON.stringify(Object.fromEntries(Object.entries(ext).map(([k, e]) => [k, { url: e.view.webContents.getURL(), vis: e.view.getVisible(), b: e.view.getBounds() }]))));
    }
    if (process.env.PVZ_OZMAP) {
      await J(`selectRow(3,true); setMapMode('ozon'); 1`); await W8(30000); await shot('10-ozon-map');
      if (mapView) { fs.writeFileSync(path.join(dir, '11-ozon-view.png'), (await mapView.webContents.capturePage()).toPNG()); if (process.env.PVZ_OZDUMP) await ozDump(); }
    }
  }
  console.log('SELFTEST DONE'); app.exit(0);
}
app.on('window-all-closed', () => { if (scheduler.isQuitting() || !loadCfg().tray) app.quit(); });
