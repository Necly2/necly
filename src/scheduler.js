// Трей, автозапуск с системой и расписание выгрузок.
// Задание: { id, enabled, time: 'ЧЧ:ММ', days: [1..7] (пн=1), kind: 'preset'|'winner', preset, guid, name, check }
const { app, Tray, Menu, Notification, nativeImage } = require('electron');
const path = require('path');

let tray = null, quitting = false, timer = null;
const ran = new Map();   // id → 'ГГГГ-ММ-ДД ЧЧ:ММ' последнего запуска

function setupTray(win, { onRunNow } = {}) {
  if (tray) return tray;
  const img = nativeImage.createFromPath(path.join(__dirname, process.platform === 'darwin' ? 'tray.png' : 'tray@2x.png')).resize({ width: process.platform === 'darwin' ? 18 : 16 });
  tray = new Tray(img);
  tray.setToolTip('PVZ Master');
  const show = () => { win.show(); win.focus(); };
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Открыть PVZ Master', click: show },
    { label: 'Расписание…', click: () => { show(); win.webContents.send('openPage', 'schedule'); } },
    { type: 'separator' },
    { label: 'Выход', click: () => { quitting = true; app.quit(); } }
  ]));
  tray.on('click', show);
  return tray;
}

// закрытие окна → в трей (если включено)
function bindClose(win, getCfg) {
  let hinted = false;
  win.on('close', e => {
    if (quitting || !getCfg().tray) return;
    e.preventDefault(); win.hide();
    if (!hinted && Notification.isSupported()) { hinted = true; notify('PVZ Master работает в фоне', 'Программа свёрнута в трей и выполнит задания по расписанию. Выход — через значок в трее.'); }
  });
  app.on('before-quit', () => { quitting = true; });
}

function applyAutostart(enabled) {
  try { app.setLoginItemSettings({ openAtLogin: !!enabled, openAsHidden: true, args: ['--hidden'] }); } catch {}
}

function notify(title, body) {
  try { if (Notification.isSupported()) new Notification({ title, body, icon: path.join(__dirname, 'icon.png') }).show(); } catch {}
}

// раз в 20 с: если наступило время задания — передаём его в окно программы
function start(getCfg, fire) {
  if (timer) clearInterval(timer);
  timer = setInterval(() => {
    const cfg = getCfg(), now = new Date();
    const hm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const day = now.getDay() || 7;
    const stamp = now.toISOString().slice(0, 10) + ' ' + hm;
    for (const s of cfg.schedules || []) {
      if (!s.enabled || s.time !== hm || !(s.days || []).includes(day)) continue;
      if (ran.get(s.id) === stamp) continue;
      ran.set(s.id, stamp);
      fire(s);
    }
  }, 20000);
}

module.exports = { setupTray, bindClose, applyAutostart, notify, start, isQuitting: () => quitting };
