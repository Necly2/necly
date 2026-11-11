// PVZ Avito — отдельное приложение: слева панель управления, справа окно Авито.
const { app, BrowserWindow, WebContentsView, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');
const { collector } = require('./collector');
const updater = require('./updater');

// убираем из User-Agent пометки Electron/приложения — остаётся обычная строка Chromium
app.userAgentFallback = app.userAgentFallback
  .replace(/\s?Electron\/\S+/i, '')
  .replace(/\s?pvz-avito\/\S+/i, '');

const PANEL_W = 320;
const START_URL = 'https://www.avito.ru/moskva/kommercheskaya_nedvizhimost/sdam-ASgBAgICAUSwCNRW';
const MONTHS = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
const DEF_ROOT = path.join(app.getPath('home'), 'OneDrive', 'Desktop', 'PVZ', 'АДРЕСА');

let win, view, running = false;
const cfgPath = () => path.join(app.getPath('userData'), 'config.json');
function loadCfg() {
  const d = { root: DEF_ROOT, pages: 40, delay: 4, days: 7, part: 300 };
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
  win.setTitle(`PVZ Avito — сборка ${updater.currentBuild()}`);
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

function saveRows(rows, cfg) {
  const now = new Date();
  const dd = String(now.getDate()).padStart(2, '0');
  const dir = path.join(cfg.root, MONTHS[now.getMonth()], `Адреса ${dd} AVITO`);
  fs.mkdirSync(dir, { recursive: true });
  let n = nextIndex(dir, dd);
  const saved = [];
  for (let i = 0; i < rows.length; i += cfg.part) {
    const ws = XLSX.utils.aoa_to_sheet([HEAD, ...rows.slice(i, i + cfg.part)]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'W7 экспорт');
    const file = path.join(dir, `avito ${dd} ${n++}.xlsx`);
    XLSX.writeFile(wb, file);
    saved.push(file);
  }
  return { dir, saved };
}

ipcMain.handle('getCfg', () => loadCfg());
ipcMain.handle('setCfg', (_e, c) => { const cur = Object.assign(loadCfg(), c); saveCfg(cur); return cur; });
ipcMain.handle('pickFolder', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Папка АДРЕСА проекта PVZ', properties: ['openDirectory', 'createDirectory'] });
  if (r.canceled || !r.filePaths[0]) return loadCfg();
  const c = Object.assign(loadCfg(), { root: r.filePaths[0] }); saveCfg(c); return c;
});
ipcMain.handle('openFolder', (_e, p) => shell.openPath(p || loadCfg().root));
ipcMain.handle('nav', (_e, what) => {
  const wc = view.webContents;
  if (what === 'back' && wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack();
  else if (what === 'home') wc.loadURL(START_URL);
  else if (what === 'reload') wc.reload();
});
ipcMain.handle('stop', () => view.webContents.executeJavaScript('window.__pvzStop = true').catch(() => {}));

ipcMain.handle('start', async (_e, c) => {
  if (running) return { ok: false, error: 'Выгрузка уже идёт' };
  const cfg = Object.assign(loadCfg(), c);
  cfg.delay = Math.max(3, cfg.delay);
  saveCfg(cfg);
  const url = view.webContents.getURL();
  if (!/^https:\/\/(www\.)?avito\.ru\//.test(url)) return { ok: false, error: 'Откройте на Авито страницу выдачи с фильтрами' };
  if (!fs.existsSync(cfg.root)) return { ok: false, error: 'Папка АДРЕСА не найдена — выберите её в настройках' };

  running = true;
  const timer = setInterval(async () => {
    try { const p = await view.webContents.executeJavaScript('window.__pvzProg || ""'); if (p) send('status', p); } catch {}
  }, 800);
  try {
    const res = await view.webContents.executeJavaScript(`(${collector.toString()})(${JSON.stringify(cfg)})`, true);
    clearInterval(timer);
    let out = { dir: '', saved: [] };
    if (res.rows.length) out = saveRows(res.rows, cfg);
    return { ok: true, reason: res.reason, total: res.rows.length, withCoords: res.withCoords, ...out };
  } catch (e) {
    clearInterval(timer);
    return { ok: false, error: String(e && e.message || e) };
  } finally { running = false; }
});

ipcMain.handle('checkUpdate', () => updater.check(win, { manual: true }));
ipcMain.handle('version', () => updater.currentBuild());

app.whenReady().then(() => { createWindow(); updater.schedule(win); });
app.on('window-all-closed', () => app.quit());
