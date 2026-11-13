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

function readFile(file, spec, mtime) {
  const wb = XLSX.readFile(file, { cellDates: true });
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
    const lc = head['Ссылка на первоисточник'] != null ? cell(r, head['Ссылка на первоисточник']) : null;
    const url = (lc && lc.l && lc.l.Target) || (lc && /^https?:/.test(String(lc.v)) ? String(lc.v) : '');
    const coords = String(g(r, 'Координаты') || '').replace(/\s/g, '');
    const [lat, lon] = coords.split(',').map(Number);
    out.push({
      platform: spec.platform, zone: String(g(r, spec.zoneCol) || ''), note: String(g(r, spec.noteCol) || ''),
      address: String(addr), metro: String(g(r, 'Метро / ЖД станции') || ''),
      areaMin: num(g(r, 'Мин. площадь')), areaMax: num(g(r, 'Макс. площадь')), price: num(g(r, 'Цена, ₽')),
      money: spec.moneyCol ? num(g(r, spec.moneyCol)) : null, supMonth: num(g(r, 'Поддержка под площадь, ₽/мес')), supTotal: num(g(r, 'Поддержка всего, ₽')), supTier: String(g(r, 'Ступень площади') || ''), source: String(g(r, 'Источник') || ''), date: String(g(r, 'Дата') || ''),
      url, lat: isFinite(lat) ? lat : null, lon: isFinite(lon) ? lon : null,
      file: path.basename(file), filePath: file, checked: mtime
    });
  }
  return out;
}

function collect(outDir) {
  const files = [];
  const walk = (d, depth) => {
    let list = []; try { list = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of list) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (depth < 3) walk(p, depth + 1); continue; }
      if (!/\.xlsx$/i.test(e.name) || e.name.startsWith('~$')) continue;
      const spec = PLAT.find(x => x.re.test(e.name)); if (spec) files.push([p, spec]);
    }
  };
  if (outDir && fs.existsSync(outDir)) walk(outDir, 0);
  const rows = [], errors = [];
  const seen = new Set();
  for (const [p, spec] of files) {
    seen.add(p);
    let st; try { st = fs.statSync(p); } catch { continue; }
    const c = cache.get(p);
    if (c && c.mtime === st.mtimeMs) { rows.push(...c.rows); continue; }
    try { const r = readFile(p, spec, st.mtimeMs); cache.set(p, { mtime: st.mtimeMs, rows: r }); rows.push(...r); }
    catch (e) { errors.push(`${path.basename(p)}: ${e.message}`); }
  }
  for (const k of [...cache.keys()]) if (!seen.has(k)) cache.delete(k);
  return { rows, files: files.length, errors };
}

module.exports = { collect };
