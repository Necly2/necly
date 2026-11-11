// Автообновление из GitHub-релиза avito-windows-latest.
// Сравнивает номер сборки (version.txt) с версией приложения 1.0.<сборка>,
// показывает «что нового», скачивает новый app.asar и заменяет его после выхода.
const { app, net, dialog, Notification } = require('electron');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const BASE = 'https://github.com/Necly2/necly/releases/download/avito-windows-latest/';
const STAMP = () => path.join(app.getPath('userData'), 'last-update-check.txt');

const currentBuild = () => parseInt(String(app.getVersion()).split('.').pop(), 10) || 0;

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

  const res = process.resourcesPath;
  if (!canWrite(res)) {
    dialog.showMessageBox(win, { type: 'warning', message: 'Нет прав на запись в папку программы.',
      detail: 'Переложите папку «PVZ Avito» в свою папку (например, Документы), не в Program Files, или скачайте новую версию вручную со страницы GitHub.' });
    return;
  }
  try {
    process.noAsar = true;
    const resp = await net.fetch(BASE + 'app.asar?t=' + Date.now(), { cache: 'no-store' });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const buf = Buffer.from(await resp.arrayBuffer());
    if (buf.length < 100000) throw new Error('файл обновления слишком маленький');
    fs.writeFileSync(path.join(res, 'app.asar.new'), buf);
  } catch (e) {
    process.noAsar = false;
    dialog.showMessageBox(win, { type: 'error', message: 'Не удалось скачать обновление', detail: String(e.message || e) });
    return;
  }
  process.noAsar = false;

  // после выхода PowerShell заменит app.asar и перезапустит программу
  const q = s => "'" + String(s).replace(/'/g, "''") + "'";
  const ps = `$new=${q(path.join(res, 'app.asar.new'))};$asar=${q(path.join(res, 'app.asar'))};$exe=${q(process.execPath)};` +
    `Start-Sleep -Seconds 2;for($i=0;$i -lt 30;$i++){try{Move-Item -Force -LiteralPath $new -Destination $asar -ErrorAction Stop;break}catch{Start-Sleep -Seconds 1}};` +
    `Start-Process -FilePath $exe`;
  const enc = Buffer.from(ps, 'utf16le').toString('base64');
  spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-EncodedCommand', enc],
        { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  app.quit();
}

// раз в день: при запуске (если с прошлой проверки прошло > 20 ч) и далее каждые 24 ч
function schedule(win) {
  let last = 0; try { last = +fs.readFileSync(STAMP(), 'utf8') || 0; } catch {}
  if (Date.now() - last > 20 * 3600e3) setTimeout(() => check(win), 8000);
  setInterval(() => check(win), 24 * 3600e3);
}

module.exports = { check, schedule, currentBuild };
