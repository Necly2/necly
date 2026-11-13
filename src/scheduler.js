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
  const menu = Menu.buildFromTemplate([
    { label: 'Открыть PVZ Master', click: show },
    { label: 'Расписание…', click: () => { show(); win.webContents.send('openPage', 'schedule'); } },
    { type: 'separator' },
    { label: 'Выход', click: () => { quitting = true; app.quit(); } }
  ]);
  // на Mac меню — по правому щелчку, по левому — окошко с прогрессом
  if (process.platform === 'darwin') tray.on('right-click', () => tray.popUpContextMenu(menu)); else tray.setContextMenu(menu);
  if (process.platform === 'darwin') tray.on('click', () => togglePopup(win, show));
  else tray.on('click', show);
  return tray;
}
// Mac: по щелчку на значок в строке меню — окошко с идущими процессами (название, процент, полоска)
let popup = null, progress = [];
const POPUP_HTML = `<!doctype html><meta charset="utf-8"><style>
  :root{color-scheme:light dark}body{margin:0;font:13px -apple-system,system-ui,sans-serif;background:transparent}
  .w{margin:6px;border-radius:12px;padding:12px 14px 10px;background:rgba(246,247,249,.97);color:#171b23;box-shadow:0 10px 30px rgba(0,0,0,.25);border:1px solid rgba(0,0,0,.08)}
  @media (prefers-color-scheme:dark){.w{background:rgba(28,31,38,.97);color:#e8eaef;border-color:rgba(255,255,255,.08)}.bar{background:rgba(255,255,255,.12)!important}.m{color:#9aa2b1!important}}
  h4{margin:0 0 10px;font-size:13px}.p{margin:0 0 12px}.r{display:flex;justify-content:space-between;gap:10px;font-weight:600}
  .m{color:#6b7280;font-size:11.5px;margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .bar{height:6px;border-radius:4px;background:rgba(0,0,0,.08);margin-top:6px;overflow:hidden}.bar i{display:block;height:100%;background:#2F7BFF;border-radius:4px;transition:width .4s}
  .bar.ind i{width:35%!important;animation:a 1.2s infinite ease-in-out}@keyframes a{0%{margin-left:-35%}100%{margin-left:100%}}
  .e{color:#6b7280;font-size:12px;margin:2px 0 10px}.b{display:flex;gap:8px;border-top:1px solid rgba(127,127,127,.2);padding-top:9px}
  button{flex:1;border:0;border-radius:8px;padding:6px;background:rgba(127,127,127,.15);color:inherit;font:inherit;cursor:pointer}button.pr{background:#2F7BFF;color:#fff}
</style><div class="w"><h4>PVZ Master</h4><div id="l"></div><div class="b"><button class="pr" onclick="location.hash='open'">Открыть</button><button onclick="location.hash='quit'">Выход</button></div></div>
<script>window.render=l=>{document.getElementById('l').innerHTML=l.length?l.map(p=>'<div class="p"><div class="r"><span>'+p.name+'</span><span>'+(p.pct==null?'':p.pct+' %')+'</span></div><div class="bar'+(p.pct==null?' ind':'')+'"><i style="width:'+(p.pct||0)+'%"></i></div><div class="m">'+(p.text||'').replace(/</g,'&lt;')+'</div></div>').join(''):'<div class="e">Сейчас ничего не выполняется</div>';}</script>`;
function togglePopup(win, show) {
  const { BrowserWindow, screen } = require('electron');
  if (popup && popup.isVisible()) { popup.hide(); return; }
  if (!popup) {
    popup = new BrowserWindow({ width: 320, height: 120, show: false, frame: false, resizable: false, movable: false, transparent: true, alwaysOnTop: true, skipTaskbar: true, fullscreenable: false, hasShadow: false, webPreferences: { contextIsolation: true } });
    popup.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(POPUP_HTML));
    popup.on('blur', () => popup.hide());
    popup.webContents.on('did-navigate-in-page', (_e, url) => { const h = url.split('#')[1]; popup.hide(); if (h === 'open') show(); if (h === 'quit') { quitting = true; app.quit(); } popup.webContents.executeJavaScript("history.replaceState(null,'',location.pathname+location.search)").catch(() => {}); });
  }
  const b = tray.getBounds(), d = screen.getDisplayNearestPoint({ x: b.x, y: b.y }).workArea;
  const h = 96 + Math.max(1, progress.length) * 62;
  popup.setBounds({ x: Math.round(Math.min(Math.max(d.x, b.x + b.width / 2 - 160), d.x + d.width - 320)), y: Math.round(b.y + b.height + 2), width: 320, height: h });
  renderPopup(); popup.show(); popup.focus();
}
function renderPopup() { if (popup && !popup.isDestroyed()) popup.webContents.executeJavaScript(`window.render && render(${JSON.stringify(progress)})`).catch(() => {}); }
function setProgress(list) {
  progress = list;
  if (tray) {
    const p = list.find(x => x.pct != null);
    if (process.platform === 'darwin') tray.setTitle(list.length ? (p ? ` ${p.pct}%` : ' …') : '');
    tray.setToolTip('PVZ Master' + (list.length ? '\n' + list.map(x => `${x.name}${x.pct != null ? ' — ' + x.pct + '%' : ''}`).join('\n') : ''));
  }
  if (popup && popup.isVisible()) {
    const h = 96 + Math.max(1, list.length) * 62, b = popup.getBounds(); if (b.height !== h) popup.setBounds({ x: b.x, y: b.y, width: 320, height: h });
    renderPopup();
  }
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

module.exports = { setProgress, setupTray, bindClose, applyAutostart, notify, start, isQuitting: () => quitting };
