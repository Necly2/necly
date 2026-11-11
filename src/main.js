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
  const d = { root: DEF_ROOT, cianRoot: DEF_CIAN, ozonOut: DEF_OZON, ozonDays: 3, ozonThreads: 2, ozonPause: 2, ozonWait: 25, ozonTries: 3, ozonAuto: false, ozonCache: true, chkOzon: true, chkYandex: false, chkWb: false,
    tray: true, autostart: false, schedules: [],
    pages: 40, delay: 4, days: 7, part: 300, cianOnlyNew: true };
  let c; try { c = Object.assign(d, JSON.parse(fs.readFileSync(cfgPath(), 'utf8'))); } catch { c = d; }
  // проверка зон запускается только по кнопке (решение пользователя 11.11.2026) — выключаем старую автопроверку один раз
  if (!c.ozonAutoOff) { c.ozonAuto = false; c.ozonAutoOff = 1; try { saveCfg(c); } catch {} }
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
  trace.cleanup(); trace.log('программа', `запуск, сборка ${updater.currentBuild()}, ${process.platform} ${process.arch}`);
  trace.watch('persist:avito', 'сайт'); trace.watch('persist:ozon', 'Ozon'); trace.watch('persist:wb', 'WB');
  layout();
  win.on('resize', layout);
  // ссылки «в новой вкладке» открываем в том же окне
  view.webContents.setWindowOpenHandler(({ url }) => { view.webContents.loadURL(url); return { action: 'deny' }; });
  view.webContents.on('did-navigate', (_e, url) => send('url', url));
  view.webContents.on('did-navigate-in-page', (_e, url) => send('url', url));
}

const send = (ch, data) => {
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

// журнал уже выгруженных объявлений Циана (чтобы в следующий раз брать только новые)
const seenPath = cfg => path.join(cfg.cianRoot, 'cian_seen.json');
function loadSeen(cfg) { try { return JSON.parse(fs.readFileSync(seenPath(cfg), 'utf8')).ids || []; } catch { return []; } }
function addSeen(cfg, ids) {
  const set = new Set(loadSeen(cfg)); ids.forEach(i => set.add(String(i)));
  fs.writeFileSync(seenPath(cfg), JSON.stringify({ updated: new Date().toISOString(), count: set.size, ids: [...set] }));
}

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
  siteRect = r ? { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) } : null;
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
    finally { running = false; }
  }

  running = true;
  const timer = setInterval(async () => {
    try { const p = await view.webContents.executeJavaScript('window.__pvzProg || ""'); if (p) send('status', p); } catch {}
  }, 800);
  try {
    let code;
    if (site === 'cian') {
      const c2 = Object.assign({}, cfg, { seen: cfg.cianOnlyNew ? loadSeen(cfg) : [] });
      code = `(${cianCollector.toString()})(${JSON.stringify(c2)})`;
    } else code = `(${collector.toString()})(${JSON.stringify(cfg)})`;
    const res = await view.webContents.executeJavaScript(code, true);
    clearInterval(timer);
    let out = { dir: '', saved: [] };
    if (res.rows.length) {
      out = saveRows(res.rows, cfg, site);
      if (site === 'cian' && res.ids) addSeen(cfg, res.ids);
    }
    const q = autoOzon(cfg, out.saved, c.forceCheck);
    journal.addHistory({ type: 'export', site, title: c.title || '', ok: true, total: res.rows.length, files: out.saved, reason: res.reason });
    return { ok: true, site, reason: res.reason, extra: res.extra || '', total: res.rows.length, withCoords: res.withCoords, ozonQueued: q, ...out };
  } catch (e) {
    clearInterval(timer);
    journal.logError(site === 'cian' ? 'Циан' : 'Авито', e);
    journal.addHistory({ type: 'export', site, title: c.title || '', ok: false, total: 0, files: [], reason: String(e && e.message || e) });
    return { ok: false, error: String(e && e.message || e) };
  } finally { running = false; }
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
ipcMain.handle('ozonNow', () => { ozonSkip = true; trace.log('проверка', 'нажато «Попробовать сейчас»'); return true; });
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
  scheduler.setupTray(win); scheduler.bindClose(win, loadCfg); scheduler.applyAutostart(loadCfg().autostart);
  scheduler.start(loadCfg, s => { journal.addHistory({ type: 'schedule', ok: true, title: s.name || s.preset || 'задание', reason: 'запуск по расписанию ' + s.time }); win.webContents.send('runSchedule', s); }); if (process.env.PVZ_DEBUG) console.log('PVZ main ready, exceljs', typeof require('exceljs').Workbook, 'build', updater.currentBuild());
  if (process.env.PVZ_SHOT) selfTest(process.env.PVZ_SHOT);
});
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
  for (const page of ['results', 'history', 'schedule']) { await J(`openPage('${page}'); 1`); await W8(1800); await shot('08-' + page); }
  if (process.env.PVZ_FAKE) { await J(`openPage('results'); 1`); await W8(1500); await J(`(()=>{const z=['голубой','синий','зелёный'];R.rows=Array.from({length:14},(_,i)=>({id:i,platform:'Ozon',zone:z[i%3],address:'Москва, ул. Тестовая, '+(i+1),metro:'м. Пример',note:'',areaMin:30+i,price:50000+i*5000,checked:Date.now()-Math.floor(i/3)*864e5,url:'https://x/'+i,lat:55.7+i*0.01,lon:37.5+i*0.01,mark:i%4===0?1:0}));renderDays();renderResults(true);})(); 1`); await W8(1500); await shot('09-results-fake'); }
  console.log('SELFTEST DONE'); app.exit(0);
}
app.on('window-all-closed', () => { if (scheduler.isQuitting() || !loadCfg().tray) app.quit(); });
