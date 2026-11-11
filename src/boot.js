// Загрузчик: если в папке данных программы лежит скачанное обновление новее встроенной версии —
// запускаем его (userData/updates/app-<сборка>.asar), иначе — встроенную версию.
// Так обновление не трогает файлы самой программы: нет блокировок, прав на запись и внешних скриптов.
const { app } = require('electron');
const fs = require('fs');
const path = require('path');

const bundled = parseInt(String(app.getVersion()).split('.').pop(), 10) || 0;
const bundledEntry = path.join(__dirname, 'main.js');
let entry = bundledEntry, build = bundled, updFile = null;

try {
  const dir = path.join(app.getPath('userData'), 'updates');
  const list = fs.readdirSync(dir)
    .map(f => [f, parseInt((f.match(/^app-(\d+)\.asar$/) || [])[1], 10)])
    .filter(x => x[1] > bundled)
    .sort((a, b) => b[1] - a[1]);
  for (const [f, n] of list) {
    const p = path.join(dir, f, 'src', 'main.js');
    if (fs.existsSync(p)) { entry = p; build = n; updFile = path.join(dir, f); break; }
  }
} catch {}

global.PVZ_BUILD = build;
if (process.env.PVZ_DEBUG) console.log('PVZ boot: build', build, 'entry', entry);
global.PVZ_BUNDLED = bundled;
try {
  require(entry);
} catch (e) {
  if (entry === bundledEntry) throw e;
  // повреждённое обновление — убираем и запускаем встроенную версию
  try { process.noAsar = true; fs.renameSync(updFile, updFile + '.broken'); } catch {} finally { process.noAsar = false; }
  global.PVZ_BUILD = bundled;
  if (process.env.PVZ_DEBUG) console.log('PVZ boot: broken update, fallback', String(e && e.message));
  require(bundledEntry);
}
