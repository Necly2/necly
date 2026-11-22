// Вкладка «Результаты»: собирает подходящие помещения из файлов проверки в папке результатов
// (OZON … / ЯНДЕКС … / WB … .xlsx). Файлы читаются заново только если изменились.
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const cache = new Map();   // путь → { mtime, rows }
const PLAT = [
  { re: /^OZON /i, platform: 'Ozon', zoneCol: 'Зона Ozon', noteCol: 'Сверка адреса', moneyCol: null, sheet: 0 },
  { re: /^ЯНДЕКС /i, platform: 'Яндекс', zoneCol: 'Зона Яндекс', noteCol: 'Проверка', moneyCol: 'Субсидия, ₽', sheet: 'Результат' },
  { re: /^WB /i, platform: 'WB', zoneCol: 'Зона WB', noteCol: 'Проверка', moneyCol: 'Гарантия, ₽', sheet: 'Результат' }
];
const num = v => { const n = parseFloat(String(v ?? '').replace(/\s/g, '').replace(',', '.')); return isFinite(n) ? n : null; };

function readFile(file, spec, mtime, exported, wb = XLSX.readFile(file, { cellDates: true })) {
  const ws = typeof spec.sheet === 'number' ? wb.Sheets[wb.SheetNames[spec.sheet]] : wb.Sheets[spec.sheet];
  if (!ws || !ws['!ref']) return [];
  const range = XLSX.utils.decode_range(ws['!ref']);
  const cell = (r, c) => ws[XLSX.utils.encode_cell({ r, c })];
  const head = {};
  for (let c = range.s.c; c <= range.e.c; c++) { const v = cell(range.s.r, c); if (v && v.v != null) head[String(v.v).trim()] = c; }
  const g = (r, name) => { const c = head[name]; if (c == null) return null; const x = cell(r, c); if (!x) return null; return x.v instanceof Date ? x.v.toLocaleDateString('ru-RU') : x.v; };
  const out = [];
  for (let r = range.s.r + 1; r <= range.e.r; r++) {
    const addr = g(r, 'Адрес'); if (!addr) continue;
    // Ozon без поддержки под площадь объявления (площадь меньше ступеней) — в итог не входит (в старых файлах такие строки есть;
    // отслеживаемые всё равно видны — из сохранённой копии)
    if (spec.platform === 'Ozon' && head['Поддержка под площадь, ₽/мес'] != null && num(g(r, 'Поддержка под площадь, ₽/мес')) === 0 && !num(g(r, 'Поддержка всего, ₽')) && String(g(r, spec.zoneCol) || '') !== 'ошибка запроса') continue;
    const linkColumn = head['Ссылка на первоисточник'] ?? head['Ссылка'];
    const lc = linkColumn != null ? cell(r, linkColumn) : null;
    const url = (lc && lc.l && lc.l.Target) || (lc && /^https?:/.test(String(lc.v)) ? String(lc.v) : '');
    const coords = String(g(r, 'Координаты') || '').replace(/\s/g, '').replace(';', ',');
    const [lat, lon] = coords.split(',').map(Number);
    out.push({
      platform: spec.platform || String(g(r, 'Площадка') || ''), zone: String(g(r, spec.zoneCol) || ''), note: String(g(r, spec.noteCol) || ''),
      address: String(addr), metro: String(g(r, 'Метро / ЖД станции') || g(r, 'Метро') || ''),
      areaMin: num(g(r, 'Мин. площадь')), areaMax: num(g(r, 'Макс. площадь')), price: num(g(r, 'Цена, ₽')),
      money: spec.moneyCol ? num(g(r, spec.moneyCol)) : null, supMonth: num(g(r, 'Поддержка под площадь, ₽/мес') ?? g(r, 'Поддержка Ozon, ₽/мес')), supTotal: num(g(r, 'Поддержка всего, ₽')), supTier: String(g(r, 'Ступень площади') || ''), near: num(g(r, 'Ближайший ПВЗ Ozon, м')), source: String(g(r, 'Источник') || ''), date: String(g(r, 'Дата') || ''),
      url: /^https?:\/\//i.test(url) ? url : '', lat: isFinite(lat) ? lat : null, lon: isFinite(lon) ? lon : null,
      file: path.basename(file), filePath: file, checked: mtime, exported: exported || mtime
    });
  }
  return out;
}

// dirs: папка результатов (строка) или список [{dir, job}] — общая папка и папки заказов
function collect(dirs) {
  if (!Array.isArray(dirs)) dirs = [{ dir: dirs, job: '' }];
  const files = [];
  const walk = (d, depth, job) => {
    let list = []; try { list = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of list) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (depth < 3) walk(p, depth + 1, job); continue; }
      if (!/\.xlsx$/i.test(e.name) || e.name.startsWith('~$')) continue;
      const spec = PLAT.find(x => x.re.test(e.name)); if (spec) files.push([p, spec, job]);
    }
  };
  // когда была выгрузка (по журналам проверок: файл результата → исходная выгрузка) — по ней строятся «дни» и «выгрузки»
  const srcOf = {};
  for (const { dir, job } of dirs) {
    if (!dir || !fs.existsSync(dir)) continue;
    walk(dir, 0, job || '');
    for (const jn of ['ozon_checked.json', 'yandex_checked.json', 'wb_checked.json']) {
      try { const j = JSON.parse(fs.readFileSync(path.join(dir, jn), 'utf8')); for (const [src, v] of Object.entries(j.files || {})) if (v && v.result) srcOf[v.result] = src; } catch {}
    }
  }
  const rows = [], errors = [];
  const seen = new Set();
  const exportedAt = p => { const s = srcOf[p]; if (!s) return null; try { return fs.statSync(s).mtimeMs; } catch { return null; } };
  for (const [p, spec, job] of files) {
    if (seen.has(p)) continue;
    seen.add(p);
    let st; try { st = fs.statSync(p); } catch { continue; }
    const c = cache.get(p), ex = exportedAt(p);
    if (c && c.mtime === st.mtimeMs && c.ex === ex) { rows.push(...c.rows.map(r => Object.assign({}, r, { job }))); continue; }
    try { const r = readFile(p, spec, st.mtimeMs, ex); cache.set(p, { mtime: st.mtimeMs, ex, rows: r }); rows.push(...r.map(x => Object.assign({}, x, { job }))); }
    catch (e) { errors.push(`${path.basename(p)}: ${e.message}`); }
  }
  for (const k of [...cache.keys()]) if (!seen.has(k)) cache.delete(k);
  return { rows, files: files.length, errors };
}

function readCheckedFile(file) {
  const spec = PLAT.find(x => x.re.test(path.basename(file)));
  if (!spec) throw new Error('Неизвестный формат файла проверки');
  return readFile(file, spec, fs.statSync(file).mtimeMs);
}
function readImportedFile(file) {
  const wb = XLSX.readFile(file, { cellDates: true });
  const sheet = wb.Sheets['Результат'] ? 'Результат' : wb.SheetNames[0];
  const ws = wb.Sheets[sheet];
  if (!ws || !ws['!ref']) throw new Error('Лист Excel пуст.');
  const range = XLSX.utils.decode_range(ws['!ref']);
  range.e.r = range.s.r;
  const header = (XLSX.utils.sheet_to_json(ws, { header: 1, range })[0] || []).map(v => String(v).trim());
  let spec = PLAT.find(p => header.includes(p.zoneCol));
  if (!spec && header.includes('Площадка') && header.includes('Зона'))
    spec = { zoneCol: 'Зона', moneyCol: 'Выплата, ₽', noteCol: 'Сверка адреса' };
  if (!spec || !header.includes('Адрес')) throw new Error('В файле нет результатов проверки. Выберите площадку для проверки выгрузки.');
  return readFile(file, { ...spec, sheet }, fs.statSync(file).mtimeMs, null, wb);
}
module.exports = { collect, readCheckedFile, readImportedFile };
