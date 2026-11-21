const path = require('node:path');

const SITES = ['cian', 'avito', 'winner'];
const CHECKS = ['ozon', 'yandex', 'wb'];

function choices(values, allowed, label) {
  if (!Array.isArray(values) || !values.length || !values.every(x => allowed.includes(x)))
    throw new Error('Проверьте выбор: ' + label);
  return Object.fromEntries(allowed.map(key => [key, values.includes(key)]));
}

function limit(value, max, label, integer = false) {
  if (value == null || value === '') return '';
  if (!Number.isFinite(value) || value < 0 || value > max || (integer && !Number.isInteger(value)))
    throw new Error('Недопустимое значение: ' + label);
  return value;
}

function safeAvito(value) {
  if (!value) return null;
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && ['avito.ru','www.avito.ru'].includes(u.hostname) &&
      !u.username && !u.password && !u.port ? u.href : null;
  } catch { return null; }
}

function activeOrders(job) {
  return Object.fromEntries(Object.entries(job?.orders || {})
    .filter(([guid, o]) => /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(guid) && o?.on)
    .map(([guid, o]) => [guid, { on: true, name: String(o.name || ''), tag: '', hide: false }]));
}

function describe(job) {
  return { id: job.id, name: job.name, canAvito: !!safeAvito(job.avitoUrl), canWinner: Object.keys(activeOrders(job)).length > 0 };
}

function makeJob(input, jobs, root, id) {
  // The request ID is used for local folders. Never accept arbitrary path components.
  if (!/^[a-z0-9_-]{1,100}$/i.test(id)) throw new Error('Неверный идентификатор запроса');
  const sources = choices(input.sources, SITES, 'источники'), checks = choices(input.checks, CHECKS, 'проверки');
  const base = jobs.find(j => j.id === input.baseJobId && !j.archived);
  const avitoUrl = safeAvito(base?.avitoUrl), orders = activeOrders(base);
  if (sources.avito && !avitoUrl) throw new Error('Выберите заказ с сохранённой ссылкой Авито.');
  if (sources.winner && !Object.keys(orders).length) throw new Error('Выберите заказ с активными поисками Winner.');
  const region = input.region || 'msk';
  if (!['msk','msk_nonew','msk_mo'].includes(region)) throw new Error('Неизвестный регион ЦИАН.');
  const days = limit(input.days ?? 7, 365, 'возраст объявления', true);
  if (!days) throw new Error('Допустимый период — от 1 до 365 дней.');
  const params = { region, days, types: [], floor1: false, floorsFrom: '',
    areaFrom: limit(input.areaFrom, 1e7, 'площадь от'), areaTo: limit(input.areaTo, 1e7, 'площадь до'),
    priceFrom: limit(input.priceFrom, 1e12, 'аренда от'), priceTo: limit(input.priceTo, 1e12, 'аренда до') };
  if ((params.areaTo !== '' && params.areaFrom > params.areaTo) || (params.priceTo !== '' && params.priceFrom > params.priceTo))
    throw new Error('Нижняя граница больше верхней.');
  const dir = path.join(root, 'Веб-поиск', id);
  return { id: 'web-' + id, name: 'Поиск с телефона', params, sources, checks, avitoUrl, orders, onlyNew: false,
    exp: path.join(dir, 'Выгрузки'), res: path.join(dir, 'Результаты') };
}

function numeric(v) {
  if (v == null || String(v).trim() === '') return null;
  const n = Number(String(v).replace(/\s/g,'').replace(',','.'));
  return Number.isFinite(n) && n >= 0 ? n : null;
}

// Normalize the actual row values before zone checks so both cards and Excel use the same rent.
function filterRow(row, p, today = new Date()) {
  const lo = numeric(row['Мин. площадь']), hi = numeric(row['Макс. площадь']);
  const min = lo ?? hi, max = hi ?? lo;
  if (p.areaFrom !== '' && (max == null || max < p.areaFrom)) return null;
  if (p.areaTo !== '' && (min == null || min > p.areaTo)) return null;
  const age = numeric(row['Кол-во дней в экспозиции']);
  const m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(row['Дата'] || '');
  const dateAge = m ? (Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()) - Date.UTC(+m[3], +m[2]-1, +m[1])) / 86400000 : null;
  const days = dateAge ?? age;
  if (days == null || days < 0 || days > p.days) return null;
  let price = numeric(row['Цена, ₽']);
  const period = String(row['Пер. оплаты'] || '').toLowerCase();
  if (price !== null && /год/.test(period)) price = Math.round(price / 12);
  else if (!/месяц|мес\.?/.test(period)) price = null;
  if (p.priceFrom !== '' && (price === null || price < p.priceFrom)) return null;
  if (p.priceTo !== '' && (price === null || price > p.priceTo)) return null;
  return { ...row, 'Цена, ₽': price, 'Пер. оплаты': price === null ? '' : 'в мес.' };
}
module.exports = { describe, makeJob, filterRow };
