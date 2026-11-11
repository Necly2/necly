// Подробный журнал работы: logs/ГГГГ-ММ-ДД.log в папке данных программы.
// Пишет запросы к сайтам (адрес, код ответа, время), действия программы и ошибки. Хранится 14 дней.
const { app, session } = require('electron');
const fs = require('fs');
const path = require('path');

const KEEP_DAYS = 14;
const dir = () => path.join(app.getPath('userData'), 'logs');
let buf = [], timer = null, lastMsg = {};

const day = d => d.toISOString().slice(0, 10);
const time = d => d.toTimeString().slice(0, 8) + '.' + String(d.getMilliseconds()).padStart(3, '0');
function flush() {
  timer = null;
  if (!buf.length) return;
  const lines = buf; buf = [];
  try { fs.mkdirSync(dir(), { recursive: true }); fs.appendFileSync(path.join(dir(), day(new Date()) + '.log'), lines.join('\n') + '\n'); } catch {}
}
function log(where, msg) {
  const d = new Date();
  buf.push(`${time(d)} [${where}] ${String(msg).replace(/\s*\n\s*/g, ' | ')}`);
  if (buf.length > 200) flush(); else if (!timer) timer = setTimeout(flush, 1500);
}
// сообщения состояния: не повторять одно и то же (например, обратный отсчёт) чаще раза в минуту
function status(where, msg) {
  const key = String(msg).replace(/\d+/g, '#');
  const now = Date.now(), p = lastMsg[where];
  if (p && p.key === key && now - p.t < 60000) return;
  lastMsg[where] = { key, t: now };
  log(where, msg);
}
function cleanup() {
  try {
    const lim = Date.now() - KEEP_DAYS * 864e5;
    for (const f of fs.readdirSync(dir())) if (/^\d{4}-\d\d-\d\d\.log$/.test(f) && new Date(f.slice(0, 10)).getTime() < lim) fs.unlinkSync(path.join(dir(), f));
  } catch {}
}

const SKIP_TYPES = new Set(['image', 'stylesheet', 'font', 'media', 'ping', 'cspReport', 'object']);
const SKIP_HOST = /(yandex\.ru\/(watch|metrika|clck)|mc\.yandex|google-analytics|googletagmanager|doubleclick|top-fwz|criteo|mail\.ru\/counter|sentry|vk\.com\/rtrg|facebook|tiktok|\.mycdn\.me|adfox|an\.yandex)/;
const short = u => { try { const x = new URL(u); const q = x.search.length > 120 ? x.search.slice(0, 120) + '…' : x.search; return x.host + x.pathname + q; } catch { return String(u).slice(0, 200); } };
// запросы страниц сайтов внутри программы (Циан/Авито/Winner, Ozon, WB)
function watch(partition, name) {
  const s = session.fromPartition(partition), started = new Map();
  const filter = { urls: ['*://*/*'] };
  s.webRequest.onBeforeRequest(filter, (d, cb) => { started.set(d.id, Date.now()); cb({}); });
  s.webRequest.onCompleted(filter, d => {
    const t0 = started.get(d.id); started.delete(d.id);
    if (SKIP_TYPES.has(d.resourceType) || SKIP_HOST.test(d.url)) return;
    // успешные мелкие запросы скриптов не нужны — только страницы, запросы данных и любые ошибки
    if (d.statusCode < 400 && !['mainFrame', 'subFrame', 'xhr'].includes(d.resourceType)) return;
    log(name, `${d.method} ${d.statusCode} ${t0 ? Date.now() - t0 + ' мс' : ''} ${d.resourceType} ${short(d.url)}${d.fromCache ? ' (кэш)' : ''}`);
  });
  s.webRequest.onErrorOccurred(filter, d => {
    started.delete(d.id);
    if (SKIP_TYPES.has(d.resourceType) || SKIP_HOST.test(d.url) || d.error === 'net::ERR_ABORTED') return;
    log(name, `${d.method} ОШИБКА ${d.error} ${d.resourceType} ${short(d.url)}`);
  });
}
// обёртка fetch для запросов из самой программы (тайлы Яндекса и т.п.)
function wrapFetch(fn, name) {
  return async (u, o) => {
    const t0 = Date.now();
    try {
      const r = await fn(u, o);
      if (!r.ok) {
        let body = ''; try { body = (await r.clone().text()).slice(0, 300); } catch {}
        log(name, `GET ${r.status} ${Date.now() - t0} мс ${short(u)}${body ? ' ответ: ' + body : ''}`);
      }
      return r;
    } catch (e) { log(name, `GET ОШИБКА ${e.message} ${short(u)}`); throw e; }
  };
}

function files() { try { return fs.readdirSync(dir()).filter(f => f.endsWith('.log')).sort().reverse().map(f => path.join(dir(), f)); } catch { return []; } }

// архив для разбора: журналы за 3 дня, ошибки, история, настройки (без паролей — их программа не хранит)
function makeReport(dest, extraText) {
  flush();
  const AdmZip = require('adm-zip');
  const z = new AdmZip(), ud = app.getPath('userData');
  for (const f of files().slice(0, 3)) z.addLocalFile(f, 'logs');
  for (const f of ['errors.log', 'history.json']) { const p = path.join(ud, f); if (fs.existsSync(p)) z.addLocalFile(p); }
  try {
    const c = JSON.parse(fs.readFileSync(path.join(ud, 'config.json'), 'utf8'));
    for (const k of Object.keys(c)) if (/pass|token|secret|cookie/i.test(k)) delete c[k];
    z.addFile('config.json', Buffer.from(JSON.stringify(c, null, 1)));
  } catch {}
  z.addFile('отчёт.txt', Buffer.from(extraText || ''));
  z.writeZip(dest);
  return dest;
}

module.exports = { log, status, watch, wrapFetch, cleanup, flush, makeReport, dir };
