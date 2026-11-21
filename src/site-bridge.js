// Исходящее соединение с личным сайтом. Ключ остаётся в основном процессе Electron.
const fs = require('node:fs');
const path = require('node:path');
const SITE = 'https://pvz-master-mobile.rustysalmon2.chatgpt.site';

function validateConfig(input) {
  if (input.origin !== SITE || typeof input.token !== 'string' || !input.token.trim() || /\s/.test(input.token))
    throw new Error('Выберите файл подключения, скачанный с вашего сайта PVZ Master.');
  return { origin: SITE, token: input.token };
}

function atomic(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file + '.tmp', text, { mode: 0o600 });
  fs.renameSync(file + '.tmp', file);
}

function create({ dir, sshConfigFile, jobs, ready, execute, workbook, request = fetch }) {
  const configFile = sshConfigFile || path.join(dir, 'pvz-site.json');
  const existingFile = () => fs.existsSync(configFile) ? configFile : path.join(dir, 'pvz-site.json');
  const stateFile = path.join(dir, 'pvz-site-run.json');
  const excelFile = path.join(dir, 'pvz-site-result.xlsx');
  let state = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, 'utf8')) : null;
  let busy = false, executing = false, connection = 'Не подключено';
  const save = value => { atomic(stateFile, JSON.stringify(value)); state = value; };
  if (state?.status === 'running') save({ id: state.id, status: 'failed', message: 'PVZ Master был закрыт во время поиска.' });

  async function api(config, route, body, binary = false) {
    const response = await request(config.origin + '/api/pi/' + route, {
      method: binary ? 'PUT' : 'POST', redirect: 'error', signal: AbortSignal.timeout(45000),
      headers: { 'OAI-Sites-Authorization': 'Bearer ' + config.token,
        'Content-Type': binary ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'application/json' },
      body: binary ? body : JSON.stringify(body)
    });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    return response;
  }
  async function run(command) {
    executing = true;
    try {
      const report = await execute(command, message => {
        if (state?.status === 'running' && state.message !== message) save({ ...state, message });
      });
      atomic(excelFile, await workbook(report.rows));
      const rows = report.rows.map(x => ({ address: x.address, platform: x.platform, zone: x.zone, price: x.price,
        area: x.areaMin ?? x.areaMax, lat: x.lat, lon: x.lon, url: x.url }));
      save({ id: command.id, status: 'done', message: 'Поиск завершён', rows, checked: report.checked });
    } catch (e) {
      save({ id: command.id, status: 'failed', message: String(e.message || e).slice(0, 500) });
    } finally { executing = false; }
  }
  async function tick() {
    if (busy || !fs.existsSync(existingFile())) return;
    busy = true;
    try {
      const config = validateConfig(JSON.parse(fs.readFileSync(existingFile(), 'utf8')));
      const active = state;
      if (active) {
        if (active.status === 'done') await api(config, 'file?id=' + encodeURIComponent(active.id), fs.readFileSync(excelFile), true);
        await api(config, 'status', active);
        if (active.status !== 'running') {
          save(null);
          fs.rmSync(excelFile, { force: true });
        }
      }
      const available = !state && !executing && await ready();
      const response = await api(config, 'sync', { ready: available, customSearch: true, jobs: jobs() });
      const { command } = await response.json();
      connection = 'Подключено';
      if (available && command && typeof command.id === 'string' && (typeof command.jobId === 'string' || (command.custom && typeof command.custom === 'object'))) {
        save({ id: command.id, status: 'running', message: 'Запускаю поиск' });
        try {
          await api(config, 'status', state);
        } catch (e) {
          save({ id: command.id, status: 'failed', message: 'Не удалось подтвердить запуск. Повторите поиск.' });
          throw e;
        }
        void run(command);
      }
    } catch (e) { connection = 'Ошибка подключения' + (/^HTTP \d+$/.test(e.message) ? ' · ' + e.message : ''); }
    finally { busy = false; }
  }
  return {
    start() { setInterval(tick, 10000).unref(); void tick(); },
    import(file) { const config = validateConfig(JSON.parse(fs.readFileSync(file, 'utf8'))); atomic(configFile, JSON.stringify(config)); void tick(); },
    connection: () => connection, tick
  };
}
module.exports = { create };
