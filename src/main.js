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
const os = require('os');
// русский язык интерфейса Chromium: время в расписании — 24 часа (на английской системе было «01:30 PM»)
app.commandLine.appendSwitch('lang', 'ru');
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
  if (!c.jobsMigrated) { try { migrateJobs(c); c.jobsMigrated = 1; saveCfg(c); } catch (e) { console.error('migrateJobs', e); } }
  if (!Array.isArray(c.jobs)) c.jobs = [];
  // этот компьютер (для расписания заказов при синхронизации)
  if (!c.pcId) { c.pcId = 'pc' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); try { saveCfg(c); } catch {} }
  // задания заказов без компьютера — выполняет этот
  if ((c.schedules || []).some(s => s.kind === 'job' && !s.pc)) { for (const s of c.schedules) if (s.kind === 'job' && !s.pc) { s.pc = c.pcId; s.pcName = os.hostname(); } try { saveCfg(c); } catch {} }
  return c;
}
// ---------- заказы: сохранённые параметры выгрузки со своими папками (cfg.jobs) ----------
const DEF_PARAMS = { region: 'msk', types: ['shop', 'psn', 'food', 'serv'], areaFrom: 24, areaTo: 130, priceFrom: '', priceTo: '', floor1: true, floorsFrom: 3, days: 7 };
const DEF_PRESETS = {
  'Заказ #4 (Москва)': { cian: true, avito: true, region: 'msk' },
  'Заказ #5 (Москва и МО, до 120 тыс.)': { cian: true, avito: true, region: 'msk_mo', priceTo: 120000 }
};
const JOB_COLORS = ['#2F7BFF', '#14B8A6', '#F97316', '#8B5CF6', '#EC4899', '#22C55E', '#EAB308', '#06B6D4'];
const newJobId = () => 'j' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const jobSeenPath = id => path.join(app.getPath('userData'), 'jobs', id + '_seen.json');
const safeName = n => String(n || 'Заказ').replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Заказ';
const pvzBase = c => (c.root ? path.dirname(c.root) : PVZ_BASE);
function defJobDirs(c, name) { const d = path.join(pvzBase(c), 'Заказы', safeName(name)); return { exp: path.join(d, 'Выгрузки'), res: path.join(d, 'Результаты') }; }
// сохранённые сценарии мастера становятся заказами (со старыми, общими папками); журнал «уже выгруженных» копируется каждому
function migrateJobs(c) {
  c.jobs = Array.isArray(c.jobs) ? c.jobs : [];
  let src = c.presets && Object.keys(c.presets).length ? c.presets : null;
  if (!src && (c.schedules || []).some(s => s.kind === 'preset')) src = DEF_PRESETS;
  if (!src && c.wizard && c.wizard.params) src = { 'Основной': Object.assign({}, c.wizard.params, { cian: c.wizard.sources ? c.wizard.sources.cian !== false : true, avito: c.wizard.sources ? c.wizard.sources.avito !== false : true, winner: !!(c.wizard.sources && c.wizard.sources.winner), checks: c.wizard.checks, avitoUrl: c.wizard.avitoUrl, orders: c.wizard.orders }) };
  let seen = null; try { seen = fs.readFileSync(path.join(app.getPath('userData'), 'seen.json')); } catch {}
  Object.entries(src || {}).forEach(([name, p], i) => {
    if (c.jobs.some(j => j.name === name)) return;
    const params = Object.assign({}, DEF_PARAMS); for (const k of Object.keys(DEF_PARAMS)) if (k in p) params[k] = p[k];
    const job = { id: newJobId() + i, name, color: JOB_COLORS[c.jobs.length % JOB_COLORS.length], exp: '', res: '', params,
      sources: { cian: p.cian !== false, avito: p.avito !== false, winner: !!p.winner }, checks: Object.assign({ ozon: true, yandex: false, wb: false }, p.checks || {}),
      avitoUrl: p.avitoUrl || null, orders: p.orders || {}, onlyNew: c.onlyNew !== false, seenDays: c.seenDays || 0, archived: false, created: Date.now(), migrated: true };
    if (seen) { try { fs.mkdirSync(path.dirname(jobSeenPath(job.id)), { recursive: true }); fs.writeFileSync(jobSeenPath(job.id), seen); } catch {} }
    c.jobs.push(job);
  });
  // задания расписания по сценариям → по заказам
  for (const s of c.schedules || []) if (s.kind === 'preset') { const j = c.jobs.find(x => x.name === s.preset); if (j) { s.kind = 'job'; s.job = j.id; s.name = j.name; } }
}
const findJob = (c, id) => (id && (c.jobs || []).find(j => j.id === id)) || null;
// настройки для запуска выгрузки в папки заказа (в общий config.json не сохраняются)
function jobRunCfg(c, job) {
  const o = { seenPath: jobSeenPath(job.id), onlyNew: job.onlyNew !== false, seenDays: job.seenDays || 0, jobId: job.id };
  if (job.exp) { fs.mkdirSync(job.exp, { recursive: true }); o.root = job.exp; o.cianRoot = job.exp; }
  return o;
}
const inside = (dir, f) => { if (!dir) return false; const r = path.relative(IS_WIN ? dir.toLowerCase() : dir, IS_WIN ? f.toLowerCase() : f); return !!r && !r.startsWith('..') && !path.isAbsolute(r); };
const IS_WIN = process.platform === 'win32';
// папка результатов для файла выгрузки: файл в папке выгрузок заказа → папка результатов заказа, иначе общая
function outFor(c, file) { for (const j of c.jobs || []) if (j.exp && j.res && inside(j.exp, file)) return j.res; return c.ozonOut; }
// все папки результатов: общая + заказов со своими папками
function outDirs(c) {
  const m = new Map(); if (c.ozonOut) m.set(c.ozonOut, { dir: c.ozonOut, job: '' });
  for (const j of c.jobs || []) if (j.res && !m.has(j.res)) m.set(j.res, { dir: j.res, job: j.id });
  return [...m.values()];
}
function touchJob(id) { const c = loadCfg(), j = findJob(c, id); if (j) { j.lastRun = Date.now(); saveCfg(c); } }
// общий заказ выгружается на этом компьютере — отметка в общей папке (другие видят «выгружается на …»)
const busyT = new Map();
function busyMark(id) {
  const w = () => { const c = loadCfg(); syncer.setBusy(c, findJob(c, id), true, os.hostname()); };
  const old = busyT.get(id); if (old) { clearInterval(old.beat); clearTimeout(old.end); }
  w();
  // отметка обновляется, пока идёт выгрузка, и снимается через минуту после последнего сайта (между сайтами заказа — пауза)
  const beat = setInterval(() => { if (running) w(); }, 45e3);
  const tick = () => { if (running) { busyT.get(id).end = setTimeout(tick, 60e3); return; } clearInterval(beat); busyT.delete(id); const c = loadCfg(); syncer.setBusy(c, findJob(c, id), false); };
  busyT.set(id, { beat, end: setTimeout(tick, 60e3) });
}
const SYNC_FIELDS = ['name', 'color', 'sources', 'checks', 'params', 'avitoUrl', 'orders', 'onlyNew', 'seenDays', 'archived'];
// расписание заказа (карточка): задания этого заказа целиком; новым — этот компьютер
ipcMain.handle('jobSched', (_e, id, list) => {
  const c = loadCfg(), j = findJob(c, id); if (!j) return [];
  const pcName = os.hostname();
  list = (list || []).map(s => Object.assign({ pc: c.pcId, pcName }, s, { kind: 'job', job: id, name: j.name }));
  c.schedules = (c.schedules || []).filter(s => !(s.kind === 'job' && s.job === id)).concat(list);
  j.updated = Date.now(); saveCfg(c); syncer.soon(); return list;
});
ipcMain.handle('pcInfo', () => ({ id: loadCfg().pcId, name: os.hostname() }));
// ---------- синхронизация заказов через общую папку (Яндекс Диск) ----------
const syncer = require('./sync').create({ loadCfg, saveCfg, defJobDirs, jobSeenPath, safeName, busy: () => running || ozonRunning, send: (ch, d) => send(ch, d), log: m => trace.log('синхронизация', m) });
const yaDisk = () => [path.join(app.getPath('home'), 'YandexDisk'), path.join(app.getPath('home'), 'Yandex.Disk.localized'), path.join(app.getPath('home'), 'Yandex.Disk')].find(p => fs.existsSync(p));
ipcMain.handle('syncState', () => { const c = loadCfg(); return { dir: c.syncDir || '', exists: !!c.syncDir && fs.existsSync(c.syncDir), last: syncer.state.last, err: syncer.state.err, pc: os.hostname(), yandex: yaDisk() || '' }; });
ipcMain.handle('syncPick', async () => {
  const c = loadCfg();
  const r = await dialog.showOpenDialog(win, { title: 'Общая папка заказов (на Яндекс Диске)', defaultPath: c.syncDir || yaDisk() || app.getPath('home'), properties: ['openDirectory', 'createDirectory'] });
  if (r.canceled || !r.filePaths[0]) return null;
  c.syncDir = r.filePaths[0]; saveCfg(c); return syncer.run();
});
ipcMain.handle('syncOff', () => { const c = loadCfg(); delete c.syncDir; saveCfg(c); return true; });
ipcMain.handle('syncNow', () => syncer.run());
// ---------- цена и снятие отслеживаемых объявлений ----------
const priceWatch = require('./pricewatch').create({ loadCfg, saveCfg, busy: () => running || ozonRunning, notify: (t, b) => scheduler.notify(t, b), log: m => trace.log('отслеживаемые', m),
  changed: () => { syncer.soon(); send('synced', { changed: true, files: 0 }); } });
ipcMain.handle('priceCheck', () => priceWatch.run({ force: true }));
// «Синхронизировать» в карточке заказа: выключили — заказ остаётся только здесь и больше не приходит из общей папки
ipcMain.handle('jobSync', (_e, id, on) => {
  const c = loadCfg(), j = findJob(c, id); if (!j) return null;
  j.sync = !!on; const ig = new Set(c.syncIgnore || []);
  if (on) ig.delete(id); else ig.add(id);
  c.syncIgnore = [...ig]; saveCfg(c);
  return on ? syncer.run() : syncer.state;
});
ipcMain.handle('jobs', () => { const c = loadCfg(); return c.jobs.map(j => Object.assign({}, j, { busy: syncer.busyOf(c, j), expDir: j.exp || '', resDir: j.res || c.ozonOut, shared: !j.exp, defDirs: defJobDirs(c, j.name) })); });
ipcMain.handle('jobSave', (_e, job, opt) => {
  const c = loadCfg(); let j = findJob(c, job.id);
  if (!j) {
    const used = new Set(c.jobs.map(x => x.color));
    j = Object.assign({ id: newJobId(), color: JOB_COLORS.find(x => !used.has(x)) || JOB_COLORS[c.jobs.length % JOB_COLORS.length], onlyNew: c.onlyNew !== false, seenDays: c.seenDays || 0, archived: false, created: Date.now() }, defJobDirs(c, job.name), job, { id: undefined });
    j.id = newJobId(); j.updated = Date.now(); c.jobs.push(j);
    if (opt && opt.copySeen) { try { fs.mkdirSync(path.dirname(jobSeenPath(j.id)), { recursive: true }); fs.copyFileSync(path.join(app.getPath('userData'), 'seen.json'), jobSeenPath(j.id)); } catch {} }
  } else {
    // изменение параметров (не папок) — отметка времени для синхронизации
    if (SYNC_FIELDS.some(k => k in job && JSON.stringify(job[k]) !== JSON.stringify(j[k]))) j.updated = Date.now();
    Object.assign(j, job, { id: j.id });
  }
  for (const d of [j.exp, j.res]) if (d) { try { fs.mkdirSync(d, { recursive: true }); } catch {} }
  saveCfg(c); syncer.soon(); return j;
});
ipcMain.handle('jobDelete', (_e, id) => {
  const c = loadCfg(); syncer.markDeleted(c, findJob(c, id)); c.jobs = c.jobs.filter(j => j.id !== id);
  for (const s of c.schedules || []) if (s.kind === 'job' && s.job === id) s.enabled = false;
  saveCfg(c); try { fs.unlinkSync(jobSeenPath(id)); } catch {} return true;
});
ipcMain.handle('jobPickFolder', async (_e, id, which) => {
  const c = loadCfg(), j = findJob(c, id); if (!j) return null;
  const r = await dialog.showOpenDialog(win, { title: which === 'res' ? `Папка результатов проверки — «${j.name}»` : `Папка выгрузок — «${j.name}»`, defaultPath: j[which] || pvzBase(c), properties: ['openDirectory', 'createDirectory'] });
  if (r.canceled || !r.filePaths[0]) return j;
  j[which] = r.filePaths[0];
  if (which === 'exp' && !j.res) j.res = defJobDirs(c, j.name).res;   // свои выгрузки — и свои результаты
  for (const d of [j.exp, j.res]) if (d) { try { fs.mkdirSync(d, { recursive: true }); } catch {} }
  saveCfg(c); return j;
});
ipcMain.handle('jobOwnFolders', (_e, id) => { const c = loadCfg(), j = findJob(c, id); if (!j) return null; Object.assign(j, defJobDirs(c, j.name)); for (const d of [j.exp, j.res]) fs.mkdirSync(d, { recursive: true }); saveCfg(c); return j; });
// выгрузки заказа за последние days дней (0 — все) — для «Перепроверить зоны заказа»: по журналам проверок и по папке выгрузок
ipcMain.handle('jobSources', (_e, id, days) => {
  const c = loadCfg(), j = findJob(c, id); if (!j || !j.exp) return [];
  const since = days ? Date.now() - days * 864e5 : 0, out = new Set();
  const walk = (d, depth) => { let l = []; try { l = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of l) { const p = path.join(d, e.name); if (e.isDirectory()) { if (depth < 4) walk(p, depth + 1); continue; }
      if (!/^(export_excel|avito)/i.test(e.name) || !/\.xlsx$/i.test(e.name) || e.name.startsWith('~$')) continue;
      try { if (fs.statSync(p).mtimeMs >= since) out.add(p); } catch {} } };
  walk(j.exp, 0);
  return [...out].sort((a, b) => a.localeCompare(b, 'ru', { numeric: true }));
});
ipcMain.handle('jobSeen', (_e, id, forget) => {
  const p = jobSeenPath(id); if (forget) { try { fs.unlinkSync(p); } catch {} return { cian: 0, avito: 0 }; }
  let s = {}; try { s = JSON.parse(fs.readFileSync(p, 'utf8')); } catch {}
  return { cian: Object.keys(s.cian || {}).length, avito: Object.keys(s.avito || {}).length };
});

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
const seenFile = cfg => (cfg && cfg.seenPath) || path.join(app.getPath('userData'), 'seen.json');
function readSeenAll(cfg) {
  let s; try { s = JSON.parse(fs.readFileSync(seenFile(cfg), 'utf8')); } catch { s = {}; }
  if (!s.cian && cfg && cfg.cianRoot && !cfg.seenPath) { try { const old = JSON.parse(fs.readFileSync(path.join(cfg.cianRoot, 'cian_seen.json'), 'utf8')); const t = Date.parse(old.updated) || Date.now(); s.cian = Object.fromEntries((old.ids || []).map(i => [String(i), t])); } catch {} }
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
  fs.mkdirSync(path.dirname(seenFile(cfg)), { recursive: true });
  fs.writeFileSync(seenFile(cfg), JSON.stringify(s));
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
// ---------- размер интерфейса: на небольшом экране (MacBook 13″) всё уменьшается, чтобы помещалось как на большом ----------
// cfg.uiScale: 'auto' (по ширине окна) или число 0.8 / 0.9 / 1 / 1.1
function uiScale() {
  if (!win || win.isDestroyed()) return 1;
  const v = loadCfg().uiScale;
  if (typeof v === 'number' && v >= 0.6 && v <= 1.5) return v;
  const w = win.getContentSize()[0];
  return w < 1250 ? 0.8 : w < 1600 ? 0.87 : 1;
}
let uiT = null;
function applyUiScale() {
  if (!win || win.isDestroyed()) return;
  const z = uiScale(), wc = win.webContents;
  if (Math.abs(wc.getZoomFactor() - z) > 0.005) { wc.setZoomFactor(z); setTimeout(() => { try { layout(); } catch {} send('uiScale', z); }, 60); }
}
ipcMain.handle('uiScale', (_e, v) => { if (v !== undefined) { const c = loadCfg(); c.uiScale = v; saveCfg(c); applyUiScale(); } return { set: loadCfg().uiScale || 'auto', now: uiScale() }; });
ipcMain.handle('setCfg', (_e, c) => {
  const old = loadCfg();
  // страница «Расписание» поменяла задания заказа — отметить заказ изменённым (для синхронизации)
  if (c.schedules) {
    const by = l => { const m = {}; for (const s of l || []) if (s.kind === 'job') (m[s.job] = m[s.job] || []).push(s); return m; };
    for (const s of c.schedules) if (s.kind === 'job' && !s.pc) { s.pc = old.pcId; s.pcName = os.hostname(); }
    const a = by(old.schedules), b = by(c.schedules);
    for (const id of new Set([...Object.keys(a), ...Object.keys(b)])) if (JSON.stringify(a[id] || []) !== JSON.stringify(b[id] || [])) { const j = findJob(old, id); if (j) j.updated = Date.now(); }
  }
  const cur = Object.assign(old, c); saveCfg(cur);
  if (c.schedules || c.resWatch) syncer.soon();
  return cur;
});
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
  const t0 = Date.now();   // длительность — для оценки времени в мастере
  const { job: jobId, ...cc } = c;
  const cfg = Object.assign(loadCfg(), cc);
  cfg.delay = Math.max(3, cfg.delay);
  saveCfg(cfg);
  // выгрузка заказа: его папки и его журнал «уже выгруженных» (только на этот запуск)
  const job = findJob(cfg, jobId);
  if (job) Object.assign(cfg, jobRunCfg(cfg, job));
  if (job) busyMark(job.id);
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
      if (m && c.bw) { const b = loadCfg(); b.bwOrders = Object.assign({}, b.bwOrders, { [m[1]]: { tag: c.bw.tag, hide: c.bw.hide, name: c.bw.name || (b.bwOrders && b.bwOrders[m[1]] && b.bwOrders[m[1]].name) || '' } }); saveCfg(b); cfg.bwOrders = b.bwOrders; }
      const r = await winner.run(view.webContents, cfg, c.bw || {}, st => send('status', st), () => stopFlag);
      const q = autoOzon(cfg, r.saved, c.forceCheck);
      if (!r.ok) journal.logError('Winner', r.error);
      else if (/ошибк/i.test(r.reason || '')) journal.logError('Winner', r.reason);
      journal.addHistory({ type: 'export', site, job: jobId || '', dur: Date.now() - t0, title: c.title || (r.extra || '').replace(/^Заказ: /, '').split(';')[0], ok: !!r.ok, total: r.total || 0, files: r.saved || [], reason: r.reason || r.error });
      if (job && r.ok) touchJob(job.id);
      return Object.assign({ site, withCoords: r.total, ozonQueued: q }, r);
    } catch (e) { journal.logError('Winner', e); journal.addHistory({ type: 'export', site, ok: false, total: 0, files: [], reason: String(e && e.message || e) }); return { ok: false, error: String(e && e.message || e) }; }
    finally { running = false; delete procs.export; procUpdate(); syncer.soon(3000); }
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
    journal.addHistory({ type: 'export', site, job: jobId || '', dur: Date.now() - t0, title: c.title || '', ok: true, total: res.rows.length, files: out.saved, reason: res.reason });
    if (job) touchJob(job.id);
    return { ok: true, site, reason: res.reason, extra: res.extra || '', total: res.rows.length, withCoords: res.withCoords, ozonQueued: q, ...out };
  } catch (e) {
    clearInterval(timer);
    journal.logError(site === 'cian' ? 'Циан' : 'Авито', e);
    journal.addHistory({ type: 'export', site, dur: Date.now() - t0, title: c.title || '', ok: false, total: 0, files: [], reason: String(e && e.message || e) });
    return { ok: false, error: String(e && e.message || e) };
  } finally { running = false; delete procs.export; procUpdate(); syncer.soon(3000); }
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
  { key: 'wb', turnoverRule: 1, cfg: 'chkWb', journal: 'wb_checked.json', label: 'Wildberries' },
  { key: 'ozon', cfg: 'chkOzon', journal: 'ozon_checked.json', label: 'Ozon' }
];
const enabledPlatforms = cfg => PLATFORMS.filter(p => (p.key === 'ozon' ? cfg.chkOzon !== false : !!cfg[p.cfg]));
// какие файлы ещё не проверены на этой площадке (по её журналу)
function needs(cfg, p, paths) {
  const j = (() => { try { return JSON.parse(fs.readFileSync(path.join(cfg.ozonOut, p.journal), 'utf8')); } catch { return { files: {} }; } })();
  return paths.map(f => { try { return { path: f, size: fs.statSync(f).size }; } catch { return null; } })
    .filter(Boolean).filter(f => { const r = j.files[f.path]; return !r || (p.turnoverRule && r.turnoverRule !== p.turnoverRule) || r.size !== f.size || (r.pending && r.pending.length); });
}
async function ensureWb() {
  const wc = wbView.webContents;
  const test = () => wc.executeJavaScript(`fetch('/pvz-map-backend/api/v2/map/check-point?point.longitude=37.6176&point.latitude=55.7558&area=70&tariff_type=BasicTariff',{headers:{Accept:'application/json'}}).then(async r => r.ok && typeof (await r.json()).can_open === 'boolean' ? 200 : 0).catch(()=>0)`, true).catch(() => 0);
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
    // слежение за зонами пользуется той же вкладкой Ozon — дождаться, чтобы не мешать проверке
    for (let i = 0; i < 30 && zwBusy; i++) await new Promise(r => setTimeout(r, 1000));
    while (ozonQueue.length && !ozonStop) {
      const cfg = loadCfg();
      if (ozonFresh) { cfg.ozonCache = false; ozonFresh = false; }
      const paths = ozonQueue.splice(0), t0 = Date.now();
      const results = [];
      // у файлов из папки выгрузок заказа — своя папка результатов
      const groups = new Map();
      for (const f of paths) { const d = outFor(cfg, f); if (!groups.has(d)) groups.set(d, []); groups.get(d).push(f); }
      for (const [outDir, gpaths] of groups) {
      if (ozonStop) break;
      try { fs.mkdirSync(outDir, { recursive: true }); } catch {}
      const gcfg = Object.assign({}, cfg, { ozonOut: outDir });
      for (const p of enabledPlatforms(cfg)) {
        if (ozonStop) break;
        const files = needs(gcfg, p, gpaths);
        if (!files.length) continue;
        const status = (text, extra) => send('ozonStatus', Object.assign({ text, running: true }, extra || {}));
        if (p.key === 'ozon') {
          results.push(Object.assign({ kind: 'ozon', label: 'Ozon' }, await ozon.run(files, {
            wc: ozonView.webContents, cfg: gcfg, log: m => trace.log('Ozon', m), cachePath: path.join(app.getPath('userData'), 'ozon_cache.json'), status, isStopped: () => ozonStop, takeSkip: () => { const v = ozonSkip; ozonSkip = false; return v; } })));
        } else {
          let fetchFn = trace.wrapFetch(u => net.fetch(u), p.key === 'wb' ? 'WB' : 'Яндекс');
          if (p.key === 'wb') {
            status('Wildberries: открываю карту map.wb.ru…');
            if (!(await ensureWb())) { results.push({ kind: 'wb', label: 'Wildberries', reason: 'карта WB не ответила — откройте вкладку позже и повторите', saved: [], errors: [], stats: {}, main: 0, excluded: 0, unchecked: 0, manual: [], files: files.length, addresses: 0 }); continue; }
            fetchFn = wbFetch;
          }
          results.push(await platforms.run(p.key, files, { fetch: fetchFn, status, isStopped: () => ozonStop, outDir }));
        }
      }
      }
      send('ozonDone', { ok: true, results });
      if (results.length && (!win.isVisible() || !win.isFocused())) scheduler.notify('PVZ Master — проверка зон завершена', results.map(r => `${r.label}: ${r.kind === 'ozon' ? 'файлов ' + r.saved.length : 'в «Результат» ' + r.main}`).join(' · '));
      if (results.length) journal.addHistory({ type: 'check', ok: true, dur: Date.now() - t0, done: results.reduce((a, r) => a + Math.max(0, (r.addresses || 0) - (r.fromCache || 0)), 0), title: results.map(r => r.label).join(', '),
        total: results.reduce((a, r) => a + (r.addresses || 0), 0), files: results.flatMap(r => r.saved || []),
        reason: results.map(r => `${r.label}: ${r.reason}`).join('; '),
        details: results.map(r => ({ label: r.label, addresses: r.addresses, suitable: r.kind === 'ozon' ? Object.entries(r.stats || {}).filter(([k]) => !['green_small', 'no_support', 'pvz_in_house', 'out_zone', 'unchecked'].includes(k)).reduce((a, [, v]) => a + v, 0) : r.main, unchecked: r.unchecked || (r.stats && r.stats.unchecked) || 0 })) });
      for (const r of results) for (const e of (r.errors || [])) journal.logError(r.label, e);
    }
  } catch (e) {
    journal.logError('проверка зон', e);
    journal.addHistory({ type: 'check', ok: false, title: 'Проверка зон', total: 0, files: [], reason: String(e && e.message || e) });
    send('ozonDone', { ok: false, error: String(e && e.message || e) });
  } finally { ozonRunning = false; if (ozonStop) ozonQueue.length = 0; syncer.soon(3000); }
}
ipcMain.handle('ozonScan', () => {
  const cfg = loadCfg();
  const map = new Map();
  for (const p of enabledPlatforms(cfg)) {
    const sets = [[[cfg.root, cfg.cianRoot], cfg.ozonOut], ...cfg.jobs.filter(j => j.exp && !j.archived).map(j => [[j.exp], j.res || cfg.ozonOut])];
    for (const f of sets.flatMap(([roots, out]) => ozon.scan(roots, out, cfg.ozonDays, p.journal, p.turnoverRule))) {
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
    for (const dir of new Set(paths.map(f => outFor(cfg, f)))) for (const p of PLATFORMS) {
      const jp = path.join(dir, p.journal);
      try { const j = JSON.parse(fs.readFileSync(jp, 'utf8')); for (const f of paths) if (j.files[f]) j.files[f] = { size: -1, result: j.files[f].result, forced: true }; fs.writeFileSync(jp, JSON.stringify(j, null, 1)); } catch {}
    }
    ozonFresh = true;
  }
  enqueueOzon(paths); return { ok: true };
});
ipcMain.handle('ozonStop', () => { ozonStop = true; return true; });
// ---------- «Поиск по адресу»: проверка одного помещения на карте Ozon ----------
let addrBusy = false;
ipcMain.handle('addrCheck', async (_e, addr, area, pick, opt) => {
  opt = opt || {};
  addr = String(addr || '').trim();
  if (!addr) return { ok: false, error: 'Введите адрес' };
  if (ozonRunning || zwBusy) return { ok: false, error: 'Сейчас идёт проверка зон — попробуйте после неё (карта Ozon занята).' };
  if (addrBusy) return { ok: false, error: 'Предыдущий адрес ещё проверяется' };
  addrBusy = true;
  try {
    const wc = ozonView.webContents, J = c => wc.executeJavaScript(c, true);
    if (!/pvz-map\.ozon\.ru/.test(wc.getURL())) { await wc.loadURL(ozon.OZON_URL).catch(() => {}); await new Promise(r => setTimeout(r, 4000)); }
    if (!(await J('!!(window.__ozon && window.__ozon.suggest)').catch(() => false))) { await J('window.__ozonRunnerLoaded = false; 1').catch(() => {}); await J(ozon.RUNNER); }
    // точка: выбранный вариант или первый вариант с номером дома
    let list = [], pt = pick || null;
    if (!pt) {
      list = await J(`window.__ozon.suggest(${JSON.stringify(addr)})`).catch(() => null);
      if (!list) return { ok: false, error: 'Карта Ozon не ответила — проверьте интернет и VPN и попробуйте ещё раз.' };
      pt = list.find(x => x.house) || list[0];
      if (!pt) return { ok: false, error: 'Ozon не нашёл такой адрес. Уточните: улица, номер дома, город (для Подмосковья).' };
    }
    const c = `${pt.lat},${pt.lon}`;
    const r = await J(`window.__ozon.one(${JSON.stringify(pt.text || addr)}, ${JSON.stringify(c)})`).catch(e => ({ err: e.message }));
    if (!r || r.err) return { ok: false, error: 'Ozon не ответил (возможно, временно ограничил запросы). Попробуйте через несколько минут.', found: pt, variants: list.slice(0, 6) };
    const [zone, note, tiers, near] = r, cfg = loadCfg();
    const a = Number(area) || 0, sup = ozon.supportFor(tiers, a);
    const greenMin = cfg.ozonGreenMin || ozon.GREEN_MIN_AREA_DEF;
    const res = { ok: true, addr, area: a || null, found: pt, variants: list.slice(0, 6), zone, note, tiers, sup, near: near || null, greenSmall: zone === 'зелёный' && a && a < greenMin, greenMin, at: Date.now() };
    // другие площадки — по той же точке
    if (opt.yandex) {
      try { const y = await platforms.makeYandex(u => net.fetch(u)).check(pt.lat, pt.lon); const z = platforms.Y_ZONES[y.zone] || [y.zone]; res.yandex = { code: y.zone, zone: z[0], money: z[1] || null, note: y.note || '' }; }
      catch (e) { res.yandex = { code: 'ERROR', zone: 'ошибка запроса', note: String(e && e.message || e) }; }
    }
    if (opt.wb) {
      try {
        if (!(await ensureWb())) res.wb = { code: 'ERROR', zone: 'карта WB не ответила', note: '' };
        else { const w = await platforms.makeWB(wbFetch).check(pt.lat, pt.lon); const z = platforms.WB_ZONES[w.code] || [w.code]; res.wb = { code: w.code, zone: z[0], money: w.sub || null, tariff: w.tariff || null, note: w.note || '' }; }
      } catch (e) { res.wb = { code: 'ERROR', zone: 'ошибка запроса', note: String(e && e.message || e) }; }
    }
    // последние проверки — на странице «Поиск по адресу»
    const c2 = loadCfg(); c2.addrHistory = [{ addr, area: res.area, found: pt, zone, note, tiers, sup, near: res.near, yandex: res.yandex, wb: res.wb, at: res.at }, ...(c2.addrHistory || []).filter(x => !(x.addr === addr && x.area === res.area))].slice(0, 30); saveCfg(c2);
    trace.log('Поиск по адресу', `${addr} → ${pt.text} (${c}): ${zone}`);
    return res;
  } catch (e) { journal.logError('поиск по адресу', e); return { ok: false, error: String(e && e.message || e) }; }
  finally { addrBusy = false; }
});
// «Перепроверить зоны»: по файлам результатов находим исходные выгрузки (по журналам проверок)
ipcMain.handle('resultSources', (_e, results) => {
  const cfg = loadCfg(), want = new Set(results), out = new Set();
  for (const { dir } of outDirs(cfg)) for (const p of PLATFORMS) {
    try { const j = JSON.parse(fs.readFileSync(path.join(dir, p.journal), 'utf8')); for (const [src, v] of Object.entries(j.files || {})) if (v && want.has(v.result) && fs.existsSync(src)) out.add(src); } catch {}
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
  watchFail(mapView.webContents, 'ozon');
}
// карта не открылась (нет интернета, VPN, сайт не ответил) — сообщить окну: вместо «Загружаю карту…» будет причина
function watchFail(wc, key) {
  wc.on('did-fail-load', (_e, code, desc, url, isMain) => {
    if (!isMain || code === -3) return;   // -3 — загрузка прервана новой (это нормально)
    trace.log('карта ' + key, `не загрузилась: ${desc} (${code}) ${url}`);
    send('mapFail', { key, why: desc || ('код ' + code) });
  });
  wc.on('did-finish-load', () => send('mapFail', { key, why: null }));
  wc.on('render-process-gone', (_e, d) => { trace.log('карта ' + key, 'страница упала: ' + d.reason); send('mapFail', { key, why: 'страница карты упала (' + d.reason + ')' }); });
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
  if (!q) { trace.log('карта Ozon', 'показать без адреса'); return { ok: true, idle: true }; }
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
const IDLE = { yandex: 'https://yandex.ru/maps/213/moscow/', '2gis': 'https://2gis.ru/moscow', osm: 'https://www.openstreetmap.org/#map=11/55.7522/37.6156' };
const ext = {};
function extView(key) {
  if (ext[key]) return ext[key];
  const v = new WebContentsView({ webPreferences: { partition: EXT[key].part, contextIsolation: true, backgroundThrottling: false } });
  win.contentView.addChildView(v); v.setVisible(false);
  v.webContents.setWindowOpenHandler(({ url }) => { v.webContents.loadURL(url).catch(() => {}); return { action: 'deny' }; });
  v.webContents.on('did-navigate', () => applyZoom(v.webContents));
  watchFail(v.webContents, key);
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
    // без адреса (объявление ещё не выбрано) — просто карта Москвы, если ничего не открыто
    if (!q) { if (key !== 'listing' && !wc.getURL()) await wc.loadURL(EXT[key].base || IDLE[key]).catch(() => {}); applyZoom(wc); return { ok: true, idle: true }; }
    if (key === 'wb') {
      if (!Number.isFinite(pt?.lat) || !Number.isFinite(pt?.lon) || !pt.lat || !pt.lon) {
        return { ok: false, why: 'У объявления нет точных координат' };
      }
      await e.ready;
      if (seq !== e.seq) return { ok: false, why: 'Выбрано другое объявление' };
      const url = new URL(EXT.wb.base);
      url.searchParams.set('lat', pt.lat);
      url.searchParams.set('lng', pt.lon);
      url.searchParams.set('area', '70');
      await wc.loadURL(url.href);
      applyZoom(wc);
      // WB запрашивает check-point после выбора точки. Сверяем фактический запрос карты.
      for (let i = 0; i < 30 && seq === e.seq; i++) {
        const selected = await wc.executeJavaScript(`(() => {
          if (!document.querySelector('canvas.maplibregl-canvas')) return null;
          const point = performance.getEntriesByType('resource').filter(r =>
            new URL(r.name, location.href).pathname === '/pvz-map-backend/api/v2/map/check-point').pop();
          if (!point) return null;
          const p = new URL(point.name).searchParams;
          return [p.get('point.latitude'), p.get('point.longitude')];
        })()`).catch(() => null);
        if (selected && Number(selected[0]) === pt.lat && Number(selected[1]) === pt.lon) return { ok: true };
        await new Promise(r => setTimeout(r, 400));
      }
      return { ok: false, why: 'Карта WB не подтвердила точку объявления' };
    }
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
// opt: { title — «Отмеченные» или название заказа (имя файла и листа), dir — куда предложить сохранить }
ipcMain.handle('exportRows', async (_e, rows, opt) => {
  opt = opt || {};
  const d = new Date(), title = safeName(opt.title || 'Отмеченные'), name = `${title} ${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}-${String(d.getMinutes()).padStart(2, '0')}.xlsx`;
  const c = loadCfg(), dir = [opt.dir, c.ozonOut].find(p => p && fs.existsSync(p)) || app.getPath('desktop');
  const r = await dialog.showSaveDialog(win, { title: opt.title ? 'Сохранить отчёт' : 'Сохранить отмеченные', defaultPath: path.join(dir, name), filters: [{ name: 'Excel', extensions: ['xlsx'] }] });
  if (r.canceled || !r.filePath) return null;
  const ExcelJS = require('exceljs'), wb = new ExcelJS.Workbook(), ws = wb.addWorksheet(title.slice(0, 28).replace(/[\[\]]/g, ''));
  const FILL = { 'синий': '8DB4E2', 'голубой': 'BDD7EE', 'зелёный': 'C6EFCE', 'гарантия < 3 млн': 'E4DFEC', 'ошибка запроса': 'FFC000' };
  ws.columns = [{ header: '№', width: 5 }, { header: 'Площадка', width: 10 }, { header: 'Зона', width: 18 }, { header: 'Адрес', width: 48 }, { header: 'Метро', width: 22 },
    { header: 'Мин. площадь', width: 12 }, { header: 'Макс. площадь', width: 12 }, { header: 'Цена, ₽', width: 12 }, { header: 'Выплата, ₽', width: 12 }, { header: 'Источник', width: 10 },
    { header: 'Дата', width: 11 }, { header: 'Сверка адреса', width: 40 }, { header: 'Ссылка', width: 22 }, { header: 'Координаты', width: 20 },
    { header: 'Поддержка Ozon, ₽/мес', width: 14 }, { header: 'Поддержка всего, ₽', width: 14 }, { header: 'Ближайший ПВЗ Ozon, м', width: 13 }, { header: 'Квартир в 400 м', width: 12 }, { header: 'Выгружено', width: 12 }, { header: 'Статус', width: 18 }, { header: 'Заметка', width: 40 }];
  const dm = t => { if (!t) return ''; const x = new Date(t); return `${String(x.getDate()).padStart(2, '0')}.${String(x.getMonth() + 1).padStart(2, '0')}.${x.getFullYear()}`; };
  rows.forEach((x, i) => {
    const row = ws.addRow([i + 1, x.platform, x.zone, x.address, x.metro, x.areaMin, x.areaMax, x.price, x.money, x.source, x.date, x.note, x.url ? { text: 'Открыть объявление', hyperlink: x.url } : '', x.lat != null ? `${x.lat},${x.lon}` : '',
      x.supMonth ?? null, x.supTotal ?? null, x.near ?? null, x.around && x.around.n != null ? x.around.n : null, dm(x.exported || x.checked), x.status || '', x.userNote || '']);
    [15, 16, 17, 18].forEach(k => (row.getCell(k).numFmt = '#,##0'));
    const f = x.platform === 'Ozon' && FILL[x.zone]; if (f) row.eachCell(cl => (cl.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + f } }));
    if (x.url) row.getCell(13).font = { color: { argb: 'FF0563C1' }, underline: true };
    [8, 9].forEach(k => (row.getCell(k).numFmt = '#,##0'));
  });
  ws.getRow(1).font = { bold: true }; ws.getRow(1).alignment = { wrapText: true, vertical: 'middle' }; ws.views = [{ state: 'frozen', ySplit: 1 }]; ws.autoFilter = { from: 'A1', to: 'U1' };
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
ipcMain.handle('results', () => results.collect(outDirs(loadCfg())));
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
let zwBusy = false;
async function zoneWatch() {
  if (ozonRunning || zwBusy || !win || win.isDestroyed()) return;
  const wc = ozonView.webContents;
  zwBusy = true;
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
  } catch (e) { trace.log('зоны Ozon', 'ошибка: ' + e.message); } finally { zwBusy = false; }
}
setTimeout(() => { zoneWatch(); setInterval(zoneWatch, 6 * 3600e3); }, 120e3);
ipcMain.handle('zonesSeen', () => { const c = loadCfg(); if (c.zonesChange) { c.zonesChange.seen = true; saveCfg(c); } return true; });
ipcMain.handle('zonesCheckNow', () => zoneWatch());
// анекдоты для главного экрана: свежая десятка с anekdot.ru (RSS), только короткие; кэш на 3 часа
// «Только смешные» — лучшие за день по оценкам читателей (export_bestday)
const jokesCache = {};
ipcMain.handle('jokes', async (_e, best) => {
  const ck = best ? 'best' : 'all', hit = jokesCache[ck];
  if (hit && Date.now() - hit.t < 3 * 3600e3) return hit.list;
  const list = [];
  for (const u of best ? ['https://www.anekdot.ru/rss/export_bestday.xml'] : ['https://www.anekdot.ru/rss/export_j.xml', 'https://www.anekdot.ru/rss/export_bestday.xml']) {
    try {
      const x = await (await net.fetch(u)).text();
      for (const it of x.split('<item>').slice(1)) {
        const d = (it.match(/<description>([\s\S]*?)<\/description>/) || [])[1] || '', link = (it.match(/<link>([^<]+)<\/link>/) || [])[1] || '';
        const t = d.replace(/<!\[CDATA\[|\]\]>/g, '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/&laquo;/g, '«').replace(/&raquo;/g, '»').replace(/&mdash;/g, '—').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).trim();
        if (t && t.length <= 260 && t.split('\n').length <= 6) list.push({ t, link });
      }
    } catch {}
  }
  if (list.length) jokesCache[ck] = { t: Date.now(), list };
  return list;
});
ipcMain.handle('vpnCheck', () => require('./vpn').check());
ipcMain.handle('flats', (_e, lat, lon, addr) => require('./flats').lookup(lat, lon, addr));
// квартир в 400 м: сразу — по OpenStreetMap, затем в фоне уточнение по МинЖКХ (ход — событием aroundProgress)
ipcMain.handle('flatsAround', async (_e, lat, lon) => {
  const f = require('./flats'), r = await f.lookupAround(lat, lon);
  if (r && !r.err && r.cands && r.cands.length) f.refineAround(lat, lon, o => send('aroundProgress', { lat, lon, a: o })).catch(() => {});
  return r;
});
// МинЖКХ попросил подтвердить «не робот» — окно сайта, проверку проходит человек
ipcMain.handle('mingkhVerify', () => require('./flats').verifyMingkh(win));
ipcMain.handle('flatsAroundCached', (_e, pts) => { const f = require('./flats'); return pts.map(([a, b]) => f.aroundCached(a, b)); });
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
  win.webContents.on('did-finish-load', applyUiScale); win.on('resize', () => { clearTimeout(uiT); uiT = setTimeout(applyUiScale, 250); }); applyUiScale();
  scheduler.setupTray(win); scheduler.bindClose(win, loadCfg);
  // VPN: предупреждение при запуске и если включится во время работы
  require('./vpn').watch((r, was) => {
    trace.log('сеть', `VPN: ${r.vpn ? 'похоже, включён' : 'нет'}${r.adapter ? ' (адаптер ' + r.adapter + ')' : ''}; ответы: ${JSON.stringify(r.status)}`);
    if (r.vpn) scheduler.notify('PVZ Master: похоже, включён VPN', 'С VPN Авито, Циан и карта Ozon могут не открываться. Выключите VPN, чтобы выгрузка и проверка работали.');
    if (r.vpn || was) send('vpn', r);
  }); scheduler.applyAutostart(loadCfg().autostart);
  syncer.start(); priceWatch.start();
  scheduler.start(() => { const c = loadCfg(); return Object.assign({}, c, { schedules: (c.schedules || []).filter(s => !(s.kind === 'job' && s.pc && s.pc !== c.pcId)) }); }, s => { journal.addHistory({ type: 'schedule', ok: true, title: s.name || s.preset || 'задание', reason: 'запуск по расписанию ' + s.time }); win.webContents.send('runSchedule', s); }); if (process.env.PVZ_DEBUG) console.log('PVZ main ready, exceljs', typeof require('exceljs').Workbook, 'build', updater.currentBuild());
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
  await J(`$('newBtn').click(); 1`); await W8(1200); await shot('02-select');
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
  // заказы: создать, карточка, «Запустить» (сразу шаг выгрузки), выход обратно в карточку, фильтр «Заказ» в результатах
  await J(`$('wzHome').click(); 1`); await W8(600); await J(`document.querySelector('#mBtns button') && document.querySelector('#mBtns button').click(); 1`); await W8(400);
  await J(`pvz.jobSave(Object.assign({ name: 'Заказ #4 — тест' }, wizDefaults())).then(() => $('jobsBtn').click()); 1`); await W8(1800); await shot('20-jobs');
  console.log('JOBS', await J(`JSON.stringify({ tiles: document.querySelectorAll('.j-tile[data-id]').length, badges: [...document.querySelectorAll('.j-tile .j-badge')].map(b => b.textContent).join() })`));
  await J(`document.querySelector('.j-tile[data-id]').click(); 1`); await W8(1200);
  await J(`$('jcSchAdd').click(); 1`); await W8(800); await J(`document.querySelector('.jc-sch [data-d="6"]').click(); 1`); await W8(800);
  await J(`$('jcSync') && $('jcSync').click(); 1`); await W8(2500);
  console.log('JOBSYNC', await J(`JSON.stringify({ on: $('jcSync') && $('jcSync').checked, open: !!$('jcSyncOpen'), tileSync: 0 })`), JSON.stringify(fs.existsSync(loadCfg().syncDir || '-') ? fs.readdirSync(loadCfg().syncDir) : []));
  await J(`$('jcRefresh').click(); 1`); await W8(2000);
  await J(`document.querySelector('.j-card').scrollTop = 9999; 1`); await W8(300); await shot('21-job-card');
  console.log('JOBSCHED', await J(`JSON.stringify({ rows: document.querySelectorAll('.jc-sch').length, days: [...document.querySelectorAll('.jc-sch .s-days button.on')].map(b => b.textContent).join(), badge: (document.querySelector('.jc-top .j-badge') || {}).textContent || '' })`));
  await J(`document.querySelector('.j-card').scrollTop = 0; 1`);
  await J(`$('jcRun').click(); 1`); await W8(1800); await shot('22-job-run');
  console.log('RECHECK', await J(`JSON.stringify({ btn: !!$('ccRecheckJob'), files: (await pvz.jobSources(document.querySelector ? (await pvz.jobs()).find(j => j.exp && !j.archived).id : '', 0)).length })`.replace('JSON.stringify(', '(async () => JSON.stringify(').replace(/\)$/, '))()')));
  console.log('JOBRUN', await J(`JSON.stringify({ step: document.querySelector('#wzStep h2').textContent, job: $('wzJob').textContent, save: ($('ccSave') || {}).textContent, dirs: ($('ccSaveSum') || {}).textContent })`));
  await J(`$('wzHome').click(); 1`); await W8(1200);
  console.log('JOBBACK', await J(`document.body.dataset.mode + '|' + document.getElementById('jobs').className`));
  await J(`setTab('sync'); openPage('settings'); 1`); await W8(1500); await shot('27-settings-sync');
  await J(`$('syncHow').click(); 1`); await W8(800); await shot('28-sync-how');
  console.log('DIALOG', await J(`JSON.stringify({ open: $('modal').open, modal: $('modal').matches(':modal'), focusIn: $('modal').contains(document.activeElement) })`));
  await J(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); $('modal').requestClose ? $('modal').requestClose() : $('modal').close(); 1`); await W8(400);
  console.log('DIALOG2', await J(`JSON.stringify({ open: $('modal').open, cls: $('modal').className })`));
  // поиск по адресу (в облаке карта Ozon может быть недоступна — тогда будет понятная ошибка)
  await J(`document.body.dataset.mode = 'welcome'; 1`); await W8(800); await J(`$('homeAddrQ').value = 'Москва, Тверская улица, 7'; $('homeAddr').requestSubmit(); 1`); await W8(1500); await shot('29-addr-wait');
  for (let i = 0; i < 40; i++) { await W8(1500); if (await J(`!$('aGo').disabled`)) break; }
  await shot('30-addr-result'); await J(`$('aMulti').click(); 1`); await W8(400); await shot('30b-addr-multi'); await J(`$('aMulti').click(); 1`);
  console.log('ADDR', await J(`($('aRes').innerText || '').replace(/\s+/g, ' ').slice(0, 300)`));
  // разработка: выполнить скрипт из файла PVZ_OZEVAL во вкладке Ozon (после поиска по адресу — скрипт проверки уже загружен) и сохранить результат
  if (process.env.PVZ_OZEVAL) {
    const r = await ozonView.webContents.executeJavaScript(fs.readFileSync(process.env.PVZ_OZEVAL, 'utf8'), true).catch(e => ({ err: e.message }));
    fs.writeFileSync(path.join(dir, 'ozeval.json'), JSON.stringify(r, null, 1)); console.log('OZEVAL', JSON.stringify(r).slice(0, 200));
  }

  console.log('SYNC', await J(`$('syncDirT').textContent.split('/').slice(-2).join('/') + ' | ' + $('syncInfo').textContent`), JSON.stringify(fs.existsSync(loadCfg().syncDir || '-') ? fs.readdirSync(loadCfg().syncDir) : []));
  await J(`openPage('schedule'); 1`); await W8(1200); await J(`$('sAdd').click(); 1`); await W8(800); await shot('23-schedule-job');
  console.log('SCHED', await J(`[...document.querySelectorAll('#sList select.what')].map(s => s.selectedOptions[0] && s.selectedOptions[0].textContent).join('|')`));
  await J(`document.body.dataset.mode = 'welcome'; 1`); await W8(1500); await shot('25-home-badge'); console.log('HOMEBADGE', await J(`$('jobsN').textContent`));
  await J(`openPage('results'); 1`); await W8(1800); await shot('24-results-jobs');
  console.log('RJOB', await J(`JSON.stringify({ shown: $('rJobF').style.display, opts: [...$('rJob').options].map(o => o.textContent), rows: R.rows.length, jobRows: R.rows.filter(x => x.job).length })`));
  if (process.env.PVZ_FAKE) {
    await J(`openPage('results'); 1`); await W8(1500);
    await J(`(()=>{const z=['голубой','синий','зелёный'];const rows=Array.from({length:14},(_,i)=>({platform:'Ozon',zone:z[i%3],address:'Москва, ул. Тестовая, '+(i%10+1),metro:'м. Пример',note:'',areaMin:30+(i%10),price:50000+i*5000,checked:Date.now()-Math.floor(i/6)*864e5-(i%2)*3600e3,url:'https://x/'+i,lat:55.7+i*0.01,lon:37.5+i*0.01,file:'OZON export_excel ЦИАН 13 '+(1+i%2)+'.xlsx'}));rows.push({platform:'Яндекс',zone:'синий',address:'ул. Тестовая, 2',metro:'',note:'',areaMin:31,price:55000,checked:Date.now(),url:'https://x/y',lat:55.71,lon:37.51,file:'ЯНДЕКС export_excel ЦИАН 13 1.xlsx'});R.marks={};R.seen={'https://x/3':1};R.watch={};prepRows(rows);R.day=dayKey(Date.now());renderDays();renderResults(true);})(); 1`);
    await W8(1500); await shot('09-results-fake');
    if (process.env.PVZ_ZW) { await zoneWatch(); const c1 = loadCfg(); if (!c1.zoneHashes) { console.log('ZW none'); } else { c1.zoneHashes[Object.keys(c1.zoneHashes)[0]] = 'x'; c1.zoneHashes[Object.keys(c1.zoneHashes)[1]] = 'y'; saveCfg(c1); } await zoneWatch(); console.log('ZW', JSON.stringify(loadCfg().zonesChange)); await J(`openPage('results'); 1`); await W8(300); await J(`document.querySelector('#results .back-home').click(); 1`); await W8(800); await shot('14-zone-note'); }
    if (process.env.PVZ_DEEP) {
      console.log('MAPS', await J(`JSON.stringify({ gen: [...$('rMapSel').options].map(o => o.value), agg: [...$('rAggSel').options].map(o => o.value), mode: R.mapMode })`));
      await J(`openPage('settings'); 1`); await W8(800);
      await J(`document.querySelector('#setMapsGen input[value="2gis"]').click(); document.querySelector('#setMapsAgg input[value="wb"]').click(); document.querySelector('#setMapsAgg input[value="ozon"]').click(); 1`); await W8(800);
      await J(`document.querySelector('#setMapsAgg input[value="wb"]').click(); setTab('maps'); 1`); await W8(800); await shot('26-settings-maps'); await J(`setTab('work'); 1`); await W8(400); await shot('26b-settings-work');
      console.log('MAPSET', await J(`JSON.stringify({ gen: [...$('rMapSel').options].map(o => o.value), agg: [...$('rAggSel').options].map(o => o.value), aggChecked: [...document.querySelectorAll('#setMapsAgg input:checked')].map(i => i.value) })`));
      await J(`pvz.setCfg({ resMapsGen: ['yandex', '2gis', 'osm', 'res'], resMapsAgg: ['ozon', 'wb', 'ym'] }); setMapLists(['yandex', '2gis', 'osm', 'res'], ['ozon', 'wb', 'ym']); openPage('results'); 1`); await W8(1200);
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
        "openPage('settings')", "$('setSeenDays').value='7';$('setSeenDays').onchange()", "$('setTestSup').click()", "document.querySelector('#setTheme [data-v=light]').click()", "document.querySelector('#setTheme [data-v=dark]').click()",
        "openPage('history')", "openPage('schedule')", "openWatch()", "openPage('results')"
      ];
      for (const s of steps) { const r = await J(`(()=>{try{${s};return 'ok'}catch(e){return 'ERR '+e.message}})()`); if (r !== 'ok') console.log('DEEPFAIL', s, r); await W8(350); }
      await shot('13-deep');
      // меню «⋯», клавиши, сводка дня, оценка времени в мастере, «Только смешные»
      await J(`openPage('results'); 1`); await W8(1200);
      await J(`$('rMoreBtn').click(); 1`); await W8(400); await shot('14-more-menu');
      console.log('POPOVER', await J(`JSON.stringify({ more: $('rMoreMenu').matches(':popover-open'), top: Math.round($('rMoreMenu').getBoundingClientRect().top), op: getComputedStyle($('rMoreMenu')).opacity, btnBottom: Math.round($('rMoreBtn').getBoundingClientRect().bottom) })`));
      console.log('MORE', await J(`JSON.stringify({open: $('rMoreMenu').matches(':popover-open'), dedup: $('rDedup').checked})`));
      await J(`document.body.click(); 1`); await W8(300);
      await J(`(()=>{const z=['голубой','синий','зелёный'];const rows=Array.from({length:14},(_,i)=>({platform:'Ozon',zone:z[i%3],address:'Москва, ул. Тестовая, '+(i%10+1),metro:'м. Пример',note:'',areaMin:30+(i%10),price:50000+i*5000,checked:Date.now()-Math.floor(i/6)*864e5-(i%2)*3600e3,url:'https://x/'+i,lat:55.7+i*0.01,lon:37.5+i*0.01,file:'OZON export_excel ЦИАН 13 '+(1+i%2)+'.xlsx'}));rows.push({platform:'Яндекс',zone:'синий',address:'ул. Тестовая, 2',metro:'',note:'',areaMin:31,price:55000,checked:Date.now(),url:'https://x/y',lat:55.71,lon:37.51,file:'ЯНДЕКС export_excel ЦИАН 13 1.xlsx'});R.marks={};R.seen={'https://x/3':1};R.watch={};prepRows(rows);R.day=dayKey(Date.now());R.up='all';R.jobF='';renderDays();renderResults(true);})(); 1`); await W8(500);
      const key = k => J(`document.dispatchEvent(new KeyboardEvent('keydown', { key: '${k}', code: '${k === ' ' ? 'Space' : k === 's' ? 'KeyS' : k}', bubbles: true })); R.sel`);
      console.log('KEYS', await key('ArrowDown'), await key('ArrowDown'), await key('ArrowUp'), await key(' '), await key('s'), await J(`JSON.stringify({sel: R.sel, seen: !!R.seen[markKey(R.rows[R.sel])], watch: !!R.watch[markKey(R.rows[R.sel])], selRow: !!document.querySelector('#rRows tr.sel')})`));
      // «Зона»: выплата − аренда, подсказка, сортировка по выгоде
      await J(`R.rows.forEach((x, i) => { if (x.platform === 'Ozon') { x.supMonth = [90000, 40000, 0, 120000][i % 4]; x.supTier = '40–60 м²'; x.net = netOf(x); } }); R.testSup = true; R.sort = { k: 'zone', dir: -1 }; renderResults(false); 1`); await W8(500);
      await J(`(() => { const b = document.querySelector('#rRows .zb.net'); $('netTip').showPopover({ source: b }); })(); 1`); await W8(400); await shot('33-net-tip');
      console.log('NET', await J(`JSON.stringify({ first: R.list.slice(0, 4).map(x => x.net), cells: [...document.querySelectorAll('#rRows .zb.net')].slice(0, 3).map(b => b.textContent), tip: $('netTip').innerText.replace(/\s+/g, ' '), below: Math.round($('netTip').getBoundingClientRect().top - document.querySelector('#rRows .zb.net').getBoundingClientRect().bottom) })`));
      await J(`$('netTip').hidePopover(); 1`);
      // карточка объявления под картой, статус и заметка, кнопка «Фильтры»
      await J(`selectRow(R.list[1].id, false); 1`); await W8(700);
      await J(`$('rdStatus').value = 'call'; $('rdStatus').onchange(); $('rdNote').value = 'Тест: перезвонить в 15:00'; $('rdNote').onchange(); $('rFiltBtn').click(); 1`); await W8(900); await shot('31-results-detail');
      { const f = require('./flats'), m = await f.mingkh('Москва, Тверская улица, 7').catch(e => ({ err: e.message }));
        console.log('MK', JSON.stringify(m), JSON.stringify({ captcha: f.mkState.captcha, url: (f.mkState.url || '').slice(0, 60) }));
        const v = f.verifyMingkh(win); await W8(5000);
        const { BrowserWindow: BW } = require('electron'), vw = BW.getAllWindows().find(w => /МинЖКХ/.test(w.getTitle()) || /mingkh/.test(w.webContents.getURL()));
        if (vw) { fs.writeFileSync(path.join(dir, '35-mingkh-verify.png'), (await vw.webContents.capturePage()).toPNG()); console.log('MKWIN', vw.isVisible(), vw.webContents.getTitle()); vw.close(); }
        await v; }
      console.log('PVZHOUSE', await J(`(() => { const x = R.rows[R.sel]; x.flats = Object.assign({}, x.flats, { n: 120, exact: false, pvz: [{ brand: 'Ozon', kind: 'pvz', name: 'Ozon' }, { brand: 'Wildberries', kind: 'pvz', name: 'WB' }] }); paintFlats(x); return JSON.stringify({ row: (document.querySelector('[data-pvz="' + x.id + '"]') || {}).textContent, card: ($('rdPvz') || {}).textContent }); })()`)); await shot('36-pvz-house');
      console.log('AROUND', await J(`(async () => { const x = R.rows[R.sel]; for (let i = 0; i < 20 && (x.around === undefined || x.aroundBusy); i++) await new Promise(r => setTimeout(r, 500)); const real = JSON.stringify(x.around); x.around = { n: 5230, exact: 3000, est: 2229, houses: 1, buildings: 24, unknown: 2, r: 400 }; renderDetail(); const c = $('rdAround').firstElementChild; return JSON.stringify({ real, cell: $('rdAround').textContent, tip: c && c.title }); })()`));
      await shot('34-around');
      console.log('DETAIL', await J(`JSON.stringify({ on: $('rDetail').classList.contains('on'), w: (w => ({ st: w.status, note: w.note }))(R.watch[markKey(R.rows[R.sel])] || {}), badge: !!document.querySelector('#rRows .st-b'), filt: $('rFilters').classList.contains('on'), tools: Math.round($('rMapCol').querySelector('.r-maptools').getBoundingClientRect().height) })`));
      await J(`$('rFiltBtn').click(); 1`); await W8(300);
      // «Карта | Ozon | Объявление» — на одном месте
      const vw = async v => { await J(`document.querySelector('#rView [data-v=${v}]').click(); 1`); await W8(1500); return J(`JSON.stringify({ mode: R.mapMode, on: (document.querySelector('#rView .on') || {}).textContent, lstIn: $('rLstIn').style.display, oz: $('rOzHost').style.display, gen: $('rGenHost').style.display, col: R.showLst })`); };
      console.log('VIEW3', await vw('lst'), await vw('agg'), await vw('gen')); await shot('32-view-switch');
      await J(`document.body.dataset.mode='welcome'; 1`); await W8(1500); await shot('15-home-sum');
      console.log('HOMESUM', await J(`$('homeSum').style.display + '|' + $('homeSum').textContent`));
      await J(`$('jokeBest') && $('jokeBest').click(); 1`); await W8(3000); console.log('JOKE', await J(`$('jokeBest').checked + '|' + $('jokeWrap').style.display + '|' + $('jokeT').textContent.slice(0, 60)`));
      await J(`$('jokeBest').click(); 1`); await W8(800);
      await J(`openWizard(); 1`); await W8(800); for (let i = 0; i < 4; i++) { await J(`$('wzNext') && !$('wzNext').disabled && $('wzNext').click(); document.querySelector('#mBtns button') && [...document.querySelectorAll('#mBtns button')].find(b=>/без них/.test(b.textContent)) && [...document.querySelectorAll('#mBtns button')].find(b=>/без них/.test(b.textContent)).click(); document.querySelector('#oList .on') && (document.querySelector('#oList .on').checked = true, document.querySelector('#oList .on').onchange({target:{checked:true}})); 1`); await W8(900); }
      await W8(800); await shot('16-center-eta'); console.log('ETA', await J(`($('ccEta')||{}).textContent`));
      console.log('DEEPDONE');
    }
    if (process.env.PVZ_EXT) {
      await J(`selectRow(1,true); R.split=true; setMapMode('yandex'); setMapMode('ym'); R.showLst=true; applyLst(); 1`); await W8(14000); await shot('11-split');
      if (ext.yandex) fs.writeFileSync(path.join(dir, '12-yandex.png'), (await ext.yandex.view.webContents.capturePage()).toPNG());
      console.log('LST', await J(`JSON.stringify([rectOf('rLstHost'), R.showLst, R.sel, document.querySelector('.r-body').className])`)); console.log('EXT', JSON.stringify(Object.fromEntries(Object.entries(ext).map(([k, e]) => [k, { url: e.view.webContents.getURL(), vis: e.view.getVisible(), b: e.view.getBounds() }]))));
    }
    if (process.env.PVZ_IDLE) {
      await J(`R.sel=null; R.split=true; R.agg='ozon'; R.gen='yandex'; layoutMaps(); 1`); await W8(15000); await shot('17-idle-split');
      if (mapView) fs.writeFileSync(path.join(dir, '18-idle-oz.png'), (await mapView.webContents.capturePage()).toPNG()); if (ext.yandex) fs.writeFileSync(path.join(dir, '19-idle-ya.png'), (await ext.yandex.view.webContents.capturePage()).toPNG());
      console.log('IDLE', JSON.stringify({ oz: mapView && { vis: mapView.getVisible(), b: mapView.getBounds(), url: mapView.webContents.getURL() }, ext: Object.fromEntries(Object.entries(ext).map(([k, e]) => [k, { vis: e.view.getVisible(), b: e.view.getBounds(), url: e.view.webContents.getURL() }])) }), await J(`JSON.stringify([R.fail, $('rOzQ').textContent])`));
    }
    if (process.env.PVZ_OZMAP) {
      await J(`selectRow(3,true); setMapMode('ozon'); 1`); await W8(30000); await shot('10-ozon-map');
      if (mapView) { fs.writeFileSync(path.join(dir, '11-ozon-view.png'), (await mapView.webContents.capturePage()).toPNG()); if (process.env.PVZ_OZDUMP) await ozDump(); }
    }
  }
  console.log('SELFTEST DONE'); app.exit(0);
}
app.on('window-all-closed', () => { if (scheduler.isQuitting() || !loadCfg().tray) app.quit(); });
