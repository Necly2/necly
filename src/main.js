// PVZ Avito — отдельное приложение: слева панель управления, справа окно Авито.
const { app, BrowserWindow, WebContentsView, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');
const { collector, cianCollector } = require('./collector');
const updater = require('./updater');
const winner = require('./winner');

// убираем из User-Agent пометки Electron/приложения — остаётся обычная строка Chromium
app.userAgentFallback = app.userAgentFallback
  .replace(/\s?Electron\/\S+/i, '')
  .replace(/\s?pvz-avito\/\S+/i, '');

const PANEL_W = 320;
const START_URL = 'https://www.avito.ru/moskva/kommercheskaya_nedvizhimost/sdam-ASgBAgICAUSwCNRW';
const WINNER_URL = 'https://w7.baza-winner.ru/';
const CIAN_URL = 'https://www.cian.ru/cat.php?deal_type=rent&engine_version=2&offer_type=offices&office_type[0]=2&office_type[1]=4&office_type[2]=5&office_type[3]=12&region=1&minarea=24&maxarea=130&minfloor=1&maxfloor=1&minfloorn=3&sort=creation_date_desc';
const MONTHS = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
const DEF_ROOT = path.join(app.getPath('home'), 'OneDrive', 'Desktop', 'PVZ', 'АДРЕСА');
const DEF_CIAN = path.join(app.getPath('home'), 'OneDrive', 'Desktop', 'PVZ', 'АДРЕСА ЦИАН');

let win, view, running = false, stopFlag = false;
const cfgPath = () => path.join(app.getPath('userData'), 'config.json');
function loadCfg() {
  const d = { root: DEF_ROOT, cianRoot: DEF_CIAN, pages: 40, delay: 4, days: 7, part: 300, cianOnlyNew: true };
  try { return Object.assign(d, JSON.parse(fs.readFileSync(cfgPath(), 'utf8'))); } catch { return d; }
}
function saveCfg(c) { fs.mkdirSync(path.dirname(cfgPath()), { recursive: true }); fs.writeFileSync(cfgPath(), JSON.stringify(c, null, 2)); }

function layout() {
  const [w, h] = win.getContentSize();
  view.setBounds({ x: PANEL_W, y: 0, width: Math.max(100, w - PANEL_W), height: h });
}

function createWindow() {
  win = new BrowserWindow({
    width: 1400, height: 900, title: 'PVZ Avito',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true }
  });
  win.removeMenu();
  win.loadFile(path.join(__dirname, 'panel.html'));
  win.setTitle(`PVZ Avito + Циан — сборка ${updater.currentBuild()}`);
  win.on('page-title-updated', e => e.preventDefault());

  view = new WebContentsView({ webPreferences: { partition: 'persist:avito', contextIsolation: true } });
  win.contentView.addChildView(view);
  layout();
  win.on('resize', layout);
  view.webContents.loadURL(START_URL);
  // ссылки «в новой вкладке» открываем в том же окне
  view.webContents.setWindowOpenHandler(({ url }) => { view.webContents.loadURL(url); return { action: 'deny' }; });
  view.webContents.on('did-navigate', (_e, url) => send('url', url));
  view.webContents.on('did-navigate-in-page', (_e, url) => send('url', url));
}

const send = (ch, data) => win && !win.isDestroyed() && win.webContents.send(ch, data);

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
  const key = which === 'cian' ? 'cianRoot' : 'root';
  const r = await dialog.showOpenDialog(win, { title: which === 'cian' ? 'Папка АДРЕСА ЦИАН' : 'Папка АДРЕСА проекта PVZ', properties: ['openDirectory', 'createDirectory'] });
  if (r.canceled || !r.filePaths[0]) return loadCfg();
  const c = Object.assign(loadCfg(), { [key]: r.filePaths[0] }); saveCfg(c); return c;
});
ipcMain.handle('openFolder', (_e, p) => shell.openPath(p || loadCfg().root));
ipcMain.handle('nav', (_e, what) => {
  const wc = view.webContents;
  if (what === 'back' && wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack();
  else if (what === 'home' || what === 'avito') wc.loadURL(START_URL);
  else if (what === 'cian') wc.loadURL(CIAN_URL);
  else if (what === 'winner') wc.loadURL(WINNER_URL);
  else if (what === 'reload') wc.reload();
});
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
      if (m && c.bw) { cfg.bwOrders = Object.assign({}, cfg.bwOrders, { [m[1]]: { tag: c.bw.tag, hide: c.bw.hide } }); saveCfg(cfg); }
      const r = await winner.run(view.webContents, cfg, c.bw || {}, st => send('status', st), () => stopFlag);
      return Object.assign({ site, withCoords: r.total }, r);
    } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
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
    return { ok: true, site, reason: res.reason, extra: res.extra || '', total: res.rows.length, withCoords: res.withCoords, ...out };
  } catch (e) {
    clearInterval(timer);
    return { ok: false, error: String(e && e.message || e) };
  } finally { running = false; }
});

ipcMain.handle('checkUpdate', () => updater.check(win, { manual: true }));
ipcMain.handle('version', () => updater.currentBuild());

app.whenReady().then(() => { createWindow(); updater.schedule(win); });
app.on('window-all-closed', () => app.quit());
