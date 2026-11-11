// Проверка выгрузок на карте Ozon (pvz-map.ozon.ru) и запись результатов новыми файлами.
// Классификация зон — проверенный ozon_runner.js проекта PVZ (зелёный / синий / голубой / < 3 млн / ошибка …).
// Оформление файла — как в GENERALIZED: A пустая, B–O колонки выгрузки, P «Зона Ozon», Q «Сверка адреса»,
// заливка строки цветом зоны, ссылка «Открыть объявление», закреплён заголовок.
// Отбор строк — прежние правила: только подходящие зоны; зелёный — только «Мин. площадь» ≥ 49 м².
// Дубликаты не ищутся, GENERALIZED не трогается.
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const ExcelJS = require('exceljs');

const RUNNER = fs.readFileSync(path.join(__dirname, 'ozon_runner.js'), 'utf8');
const OZON_URL = 'https://pvz-map.ozon.ru/';
const TEST = '/p-api/orp-agent-api/task/creation-availability?layer=PvzGroup&withNearestPoints=true&location.lat=55.7802&location.lon=37.5823';

const EXPORT_HEAD = ['Онлайн-показ', 'Объект', 'Метро / ЖД станции', 'От станции', 'Адрес', 'Мин. площадь', 'Макс. площадь',
  'Цена, ₽', 'Пер. оплаты', 'Дата', 'Кол-во дней в экспозиции', 'Источник', 'Ссылка на первоисточник', 'Координаты'];
const GEN_HEAD = [null, 'Онлайн-показ', ' ', ...EXPORT_HEAD.slice(2), 'Зона Ozon', 'Сверка адреса'];
const WIDTHS = [13, 13, 32, 13, 13, 26, 13, 13, 13, 13, 13, 13, 29, 22, 30, 60, 40];
const ZONE_COLOR = { 'синий': '8DB4E2', 'голубой': 'BDD7EE', 'зелёный': 'C6EFCE', 'гарантия < 3 млн': 'E4DFEC', 'ошибка запроса': 'FFC000' };
const KEEP = ['зелёный', 'синий', 'голубой', 'гарантия < 3 млн', 'ошибка запроса'];
const GREEN_MIN_AREA = 49;
const CACHE_DAYS = 3;          // результат по точке считается свежим 3 дня (карта Ozon меняется)
const MONTHS = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];

const sleep = ms => new Promise(r => setTimeout(r, ms));
const keyOf = c => String(c || '').replace(/\s/g, '').replace(';', ',');
function pc(s) {
  const [a, b] = keyOf(s).split(',').map(Number);
  return isFinite(a) && isFinite(b) && Math.abs(a) <= 90 && Math.abs(b) <= 180 && (a || b) ? [a, b] : null;
}
const num = v => { const n = parseFloat(String(v ?? '').replace(/\s/g, '').replace(',', '.')); return isFinite(n) ? n : null; };
const fmtDate = d => `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;

// ---------- чтение выгрузки ----------
function readExport(file) {
  const wb = XLSX.readFile(file, { cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const range = XLSX.utils.decode_range(ws['!ref'] || 'A1');
  const cell = (r, c) => ws[XLSX.utils.encode_cell({ r, c })];
  const head = [];
  for (let c = range.s.c; c <= range.e.c; c++) head.push(String((cell(range.s.r, c) || {}).v ?? '').trim());
  if (!head.includes('Адрес') || !head.includes('Координаты')) throw new Error(`${path.basename(file)}: нет колонок «Адрес»/«Координаты» — неверные настройки выгрузки`);
  const rows = [];
  for (let r = range.s.r + 1; r <= range.e.r; r++) {
    const d = {};
    head.forEach((h, i) => { if (!h) return; const x = cell(r, range.s.c + i); let v = x ? x.v : null; if (v instanceof Date) v = fmtDate(v); d[h] = v; });
    if (!d['Адрес'] || !pc(d['Координаты'])) continue;            // строки-описания и пустые
    const li = head.indexOf('Ссылка на первоисточник');
    const lc = li >= 0 ? cell(r, range.s.c + li) : null;
    d._url = (lc && lc.l && lc.l.Target) || (lc && /^https?:/.test(String(lc.v)) ? String(lc.v) : null);
    d._key = keyOf(d['Координаты']);
    rows.push(d);
  }
  return rows;
}

// ---------- журнал и кэш ----------
const readJson = (p, d) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return d; } };
const writeJson = (p, o) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(o, null, 1)); };
const journalPath = out => path.join(out, 'ozon_checked.json');

// новые выгрузки: export_excel… / avito… в папках АДРЕСА и АДРЕСА ЦИАН, изменённые за N дней и ещё не проверенные
function scan(roots, outDir, days) {
  const j = readJson(journalPath(outDir), { files: {} });
  const since = Date.now() - (days || 3650) * 864e5;
  const found = [];
  const walk = (dir, depth) => {
    let list = []; try { list = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of list) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (depth < 4) walk(p, depth + 1); continue; }
      if (!/^(export_excel|avito)/i.test(e.name) || !/\.xlsx$/i.test(e.name) || e.name.startsWith('~$')) continue;
      let st; try { st = fs.statSync(p); } catch { continue; }
      if (st.mtimeMs < since) continue;
      const rec = j.files[p];
      if (rec && rec.size === st.size && !(rec.pending && rec.pending.length)) continue;
      found.push({ path: p, size: st.size, partial: !!(rec && rec.pending && rec.pending.length) });
    }
  };
  for (const r of roots) if (r && fs.existsSync(r)) walk(r, 0);
  found.sort((a, b) => a.path.localeCompare(b.path, 'ru', { numeric: true }));
  return found;
}

// ---------- файл результата ----------
async function writeResult(outFile, items) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Проверка Ozon', { views: [{ state: 'frozen', ySplit: 1 }] });
  WIDTHS.forEach((w, i) => (ws.getColumn(i + 1).width = w));
  const h = ws.addRow(GEN_HEAD);
  h.eachCell({ includeEmpty: true }, c => { c.font = { bold: true }; c.alignment = { wrapText: true, vertical: 'middle' }; });
  for (const { d, zone, note } of items) {
    const vals = [null, ...EXPORT_HEAD.map(k => d[k] ?? null), zone, note || null];
    const row = ws.addRow(vals);
    if (d._url) { const c = row.getCell(14); c.value = { text: 'Открыть объявление', hyperlink: d._url }; c.font = { color: { argb: 'FF0563C1' }, underline: true }; }
    const col = ZONE_COLOR[zone];
    if (col) for (let i = 1; i <= GEN_HEAD.length; i++) row.getCell(i).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + col } };
  }
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: Math.max(1, ws.rowCount), column: GEN_HEAD.length } };
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  const tmp = outFile + '.tmp';
  await wb.xlsx.writeFile(tmp);
  try { fs.renameSync(tmp, outFile); }
  catch (e) { try { fs.unlinkSync(tmp); } catch {} throw new Error(`Не удалось записать ${path.basename(outFile)} — возможно, файл открыт в Excel. Закройте его и повторите.`); }
}

// ---------- проверка ----------
// ctx: { wc (webContents вкладки Ozon), status(text, extra), isStopped(), cfg, cachePath }
async function run(files, ctx) {
  const { wc, status, isStopped, cfg } = ctx;
  const J = code => wc.executeJavaScript(code, true);
  const outDir = cfg.ozonOut;
  const threads = Math.max(1, Math.min(4, cfg.ozonThreads || 2));
  const pauseMs = Math.max(1000, (cfg.ozonPause || 2) * 1000);

  // 1. прочитать выгрузки
  const data = [], errors = [];
  for (const f of files) {
    try { data.push({ f, rows: readExport(f.path) }); } catch (e) { errors.push(e.message); }
  }
  const addrOf = {};
  for (const { rows } of data) for (const d of rows) if (!addrOf[d._key]) addrOf[d._key] = String(d['Адрес']).replace(/[\t\n]/g, ' ');

  // 2. кэш результатов по координатам
  const cache = readJson(ctx.cachePath, {});
  const fresh = k => cache[k] && Date.now() - cache[k][2] < CACHE_DAYS * 864e5;
  const todo = Object.keys(addrOf).filter(k => !fresh(k));
  const total = Object.keys(addrOf).length;
  let blockedGaveUp = false, stoppedByUser = false;

  if (todo.length) {
    status(`Открываю карту Ozon… (адресов к проверке: ${todo.length}${total > todo.length ? `, из кэша: ${total - todo.length}` : ''})`, { done: 0, total: todo.length });
    await wc.loadURL(OZON_URL).catch(() => {});
    await sleep(4000);
    const test = async () => { try { return await J(`fetch(${JSON.stringify(TEST)}, {headers:{Accept:'application/json'}}).then(r => r.status).catch(() => 0)`); } catch { return 0; } };
    let st = await test();
    let waits = 0;
    const waitBlock = async () => {
      waits++;
      if (waits > 3) return false;
      const until = new Date(Date.now() + 25 * 60e3);
      for (let s = 25 * 60; s > 0; s--) {
        if (isStopped()) return false;
        if (s % 5 === 0) status(`Ozon временно ограничил запросы (так бывает при частой проверке).\nПродолжу в ${until.toTimeString().slice(0, 5)} (попытка ${waits} из 3). Можно остановить — проверенное сохранится.`, { wait: true });
        await sleep(1000);
      }
      return (await test()) === 200;
    };
    while (st !== 200) {
      if (!(await waitBlock())) { blockedGaveUp = !isStopped(); stoppedByUser = isStopped(); break; }
      st = 200;
    }
    if (st === 200 && !stoppedByUser && !blockedGaveUp) {
      await J(RUNNER);
      await J(`__reset(); __delay(${pauseMs}); 1`);
      for (let i = 0; i < todo.length; i += 400) {
        const chunk = todo.slice(i, i + 400).map(k => addrOf[k] + '\t' + k).join('\n');
        await J(`__addS(${JSON.stringify(chunk)}).queue`);
      }
      await J(`__start(${threads}); 1`);
      const t0 = Date.now(); let retried = false, lastSave = Date.now();
      const merge = async () => {
        const out = await J('JSON.stringify(window.__out || {})').then(JSON.parse).catch(() => ({}));
        const now = Date.now();
        for (const [k, v] of Object.entries(out)) cache[k] = [v[0], v[1] || '', now];
        writeJson(ctx.cachePath, cache);
      };
      while (true) {
        await sleep(2000);
        if (isStopped()) { await J('__stop(); 1').catch(() => {}); stoppedByUser = true; break; }
        const p = await J('__prog()').catch(() => null);
        if (!p) continue;
        const done = p.done, el = (Date.now() - t0) / 1000;
        const eta = done > 3 ? Math.round((todo.length - done) * el / done / 60) : null;
        status(`Проверено ${done} из ${todo.length}` + (eta !== null ? ` · осталось ~${eta} мин` : '') + (p.failed ? ` · без ответа ${p.failed}` : ''), { done, total: todo.length });
        if (Date.now() - lastSave > 30000) { await merge(); lastSave = Date.now(); }
        if (p.stopped && p.blocked) {
          await merge();
          if (await waitBlock()) { await J(`__delay(${Math.max(pauseMs, 2500)}); __resume(1); 1`); continue; }
          if (isStopped()) stoppedByUser = true; else blockedGaveUp = true;
          break;
        }
        if (p.queue === 0 && p.busy === 0) {
          if (p.failed > 0 && !retried) { retried = true; await J(`__retry(); __start(${threads}); 1`); continue; }
          break;
        }
      }
      await merge();
    }
  }

  // 3. файлы результатов
  const j = readJson(journalPath(outDir), { описание: 'Журнал проверки выгрузок на карте Ozon программой PVZ', files: {} });
  const now = new Date();
  const stats = { 'зелёный': 0, 'синий': 0, 'голубой': 0, 'гарантия < 3 млн': 0, 'ошибка запроса': 0, green_small: 0, out_zone: 0, unchecked: 0 };
  const saved = [], manual = [], odd = [];
  const order = Object.fromEntries(KEEP.map((z, i) => [z, i]));
  for (const { f, rows } of data) {
    const items = [], pending = [];
    for (const d of rows) {
      const r = fresh(d._key) ? cache[d._key] : null;
      if (!r) { pending.push([d['Адрес'], d._key]); continue; }
      const [zone, note] = r;
      if (!KEEP.includes(zone)) { stats.out_zone++; continue; }
      if (zone === 'зелёный' && (num(d['Мин. площадь']) || 0) < GREEN_MIN_AREA) { stats.green_small++; continue; }
      stats[zone]++;
      items.push({ d, zone, note });
      if (note && /проверить вручную/.test(note)) manual.push(`${d['Адрес']} — ${note}`);
      const price = num(d['Цена, ₽']);
      if (price !== null && (price < 10000 || /год/.test(String(d['Пер. оплаты'] || '')))) odd.push(`${d['Адрес']} — ${d['Цена, ₽']} ${d['Пер. оплаты'] || ''}`);
    }
    stats.unchecked += pending.length;
    items.sort((a, b) => order[a.zone] - order[b.zone] || (num(a.d['Цена, ₽']) ?? 1e12) - (num(b.d['Цена, ₽']) ?? 1e12));
    const prev = j.files[f.path];
    const outFile = (prev && prev.result) || path.join(outDir, MONTHS[now.getMonth()], 'OZON ' + path.basename(f.path));
    if (pending.length === rows.length && rows.length) continue;     // ничего не проверено — файл не пишем
    await writeResult(outFile, items);
    saved.push(outFile);
    j.files[f.path] = { size: f.size, result: outFile, checked: now.toISOString(), rows: rows.length, suitable: items.length,
      status: pending.length ? 'partial' : 'done', ...(pending.length ? { pending } : {}) };
  }
  writeJson(journalPath(outDir), j);

  const reason = stoppedByUser ? 'остановлено вручную' : blockedGaveUp ? 'Ozon ограничил запросы — часть адресов не проверена, нажмите «Проверить» позже' : 'проверка завершена';
  return { ok: true, reason, saved, errors, stats, manual, odd, files: data.length, addresses: total };
}

module.exports = { scan, run, OZON_URL };
