// История запусков (history.json) и журнал ошибок (errors.log) в папке данных программы.
const { app } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

const dir = () => app.getPath('userData');
const histPath = () => path.join(dir(), 'history.json');
const errPath = () => path.join(dir(), 'errors.log');
const MAX_HIST = 500, MAX_LOG = 1024 * 1024;

function readHistory() { try { return JSON.parse(fs.readFileSync(histPath(), 'utf8')); } catch { return []; } }
function addHistory(entry) {
  try {
    const h = readHistory();
    h.unshift(Object.assign({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), time: new Date().toISOString() }, entry));
    fs.writeFileSync(histPath(), JSON.stringify(h.slice(0, MAX_HIST), null, 1));
    try { require('./trace').log('итог', `${entry.type || ''} ${entry.site || ''} ${entry.title || ''} — ${entry.ok === false ? 'ОШИБКА ' : ''}${entry.reason || ''}${entry.total != null ? ', объявлений ' + entry.total : ''}`); } catch {}
  } catch (e) { logError('история', e); }
}

function logError(where, err) {
  try {
    const msg = err && err.stack ? err.stack : String(err && err.message || err);
    const line = `${new Date().toISOString()} [${where}] ${msg}\n`;
    try { require('./trace').log('ОШИБКА ' + where, msg); } catch {}
    let old = ''; try { old = fs.readFileSync(errPath(), 'utf8'); } catch {}
    let all = old + line;
    if (all.length > MAX_LOG) all = all.slice(all.length - MAX_LOG / 2);
    fs.writeFileSync(errPath(), all);
  } catch {}
}
function readErrors() { try { return fs.readFileSync(errPath(), 'utf8'); } catch { return ''; } }
function clearErrors() { try { fs.unlinkSync(errPath()); } catch {} }

// отчёт для Claude: версия, система и последние ошибки
function report(build) {
  const lines = readErrors().trim().split('\n');
  const last = lines.slice(-200).join('\n');
  const h = readHistory().slice(0, 10).map(x => `${x.time} ${x.type} ${x.site || ''} ${x.title || ''} — ${x.reason || ''}`).join('\n');
  return `PVZ Master, сборка ${build}\nСистема: ${process.platform} ${os.release()} ${process.arch}, Electron ${process.versions.electron}\n` +
    `Время: ${new Date().toISOString()}\n\n=== Последние запуски ===\n${h || '—'}\n\n=== Журнал ошибок (последние строки) ===\n${last || 'ошибок нет'}\n`;
}

module.exports = { addHistory, readHistory, logError, readErrors, clearErrors, report };
