// Автообновление из GitHub-релиза: Windows — avito-windows-latest, Mac — avito-mac-latest.
// Сравнивает номер сборки (version.txt) с версией приложения 1.0.<сборка>, показывает «что нового».
// Обновление: скачивается app.asar новой сборки в папку данных программы (userData/updates/app-<N>.asar),
// программа перезапускается, загрузчик boot.js подхватывает новую версию. Файлы самой программы не меняются.
const { app, net, dialog, Notification } = require('electron');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const IS_MAC = process.platform === 'darwin';
const BASE = `https://github.com/Necly2/necly/releases/download/${IS_MAC ? 'avito-mac' : 'avito-windows'}-latest/`;
const STAMP = () => path.join(app.getPath('userData'), 'last-update-check.txt');

const currentBuild = () => global.PVZ_BUILD || parseInt(String(app.getVersion()).split('.').pop(), 10) || 0;

async function getText(url) {
  const r = await net.fetch(url + '?t=' + Date.now(), { cache: 'no-store' });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return (await r.text()).trim();
}

function canWrite(dir) {
  try { const t = path.join(dir, '.write-test'); fs.writeFileSync(t, '1'); fs.unlinkSync(t); return true; } catch { return false; }
}

async function check(win, { manual = false } = {}) {
  if (!app.isPackaged) { if (manual) dialog.showMessageBox(win, { message: 'Обновление работает только в собранной программе.' }); return; }
  try { fs.writeFileSync(STAMP(), String(Date.now())); } catch {}
  let latest;
  try { latest = parseInt(await getText(BASE + 'version.txt'), 10); }
  catch (e) { if (manual) dialog.showMessageBox(win, { type: 'warning', message: 'Не удалось проверить обновления', detail: String(e.message || e) }); return; }
  const cur = currentBuild();
  if (!latest || latest <= cur) { if (manual) dialog.showMessageBox(win, { message: `У вас последняя версия (сборка ${cur}).` }); return; }

  let notes = '';
  try { notes = await getText(BASE + 'notes.txt'); } catch {}
  const r = await dialog.showMessageBox(win, {
    type: 'info', buttons: ['Обновить сейчас', 'Позже'], defaultId: 0, cancelId: 1,
    title: 'PVZ Avito — обновление',
    message: `Доступна новая сборка ${latest} (у вас ${cur}).`,
    detail: notes ? 'Что нового:\n' + notes.slice(0, 1500) : ''
  });
  if (r.response !== 0) return;

  const dir = path.join(app.getPath('userData'), 'updates');
  const target = path.join(dir, `app-${latest}.asar`);
  try {
    fs.mkdirSync(dir, { recursive: true });
    const resp = await net.fetch(BASE + 'app.asar?t=' + Date.now(), { cache: 'no-store' });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const buf = Buffer.from(await resp.arrayBuffer());
    if (buf.length < 1000000) throw new Error('файл обновления слишком маленький');
    process.noAsar = true;                       // писать .asar как обычный файл
    fs.writeFileSync(target + '.tmp', buf);
    try { fs.unlinkSync(target); } catch {}
    fs.renameSync(target + '.tmp', target);
    // старые скачанные версии убираем (используемая сейчас может быть занята — тогда в следующий раз)
    for (const f of fs.readdirSync(dir)) if (f !== path.basename(target) && /^app-\d+\.asar(\.tmp|\.broken)?$/.test(f)) { try { fs.unlinkSync(path.join(dir, f)); } catch {} }
  } catch (e) {
    dialog.showMessageBox(win, { type: 'error', message: 'Не удалось скачать обновление', detail: String(e.message || e) });
    return;
  } finally { process.noAsar = false; }
  if (!fs.existsSync(path.join(target, 'src', 'main.js'))) {
    dialog.showMessageBox(win, { type: 'error', message: 'Скачанное обновление повреждено — попробуйте ещё раз позже.' });
    return;
  }
  app.relaunch();
  app.exit(0);
}

// раз в день: при запуске (если с прошлой проверки прошло > 20 ч) и далее каждые 24 ч
function schedule(win) {
  let last = 0; try { last = +fs.readFileSync(STAMP(), 'utf8') || 0; } catch {}
  if (Date.now() - last > 20 * 3600e3) setTimeout(() => check(win), 8000);
  setInterval(() => check(win), 24 * 3600e3);
}

module.exports = { check, schedule, currentBuild };
