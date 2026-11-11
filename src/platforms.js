// Проверка выгрузок на картах ПВЗ Яндекс Маркета и Wildberries — перенос проверенных скриптов проекта PVZ
// (yandex_pvz_check.py, wb_pvz_check.py). Без дубликатов: на каждую выгрузку — свой файл результата
// с листами «Результат» и «Исключённые» (с причиной), оформление как раньше.
const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');
const { PNG } = require('pngjs');
const { readExport } = require('./ozon');

const sleep = ms => new Promise(r => setTimeout(r, ms));
const MONTHS = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
const num = v => { const n = parseFloat(String(v ?? '').replace(/м²|м2/g, '').replace(/\s/g, '').replace(',', '.')); return isFinite(n) ? n : null; };
function pc(s) {
  const [a, b] = String(s || '').replace(/\s/g, '').replace(';', ',').split(',').map(Number);
  return isFinite(a) && isFinite(b) && a > 40 && a < 82 && b > 19 && b < 180 ? [a, b] : null;
}
async function pool(items, n, fn) {
  let i = 0; const out = new Array(items.length);
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); } }));
  return out;
}

// ============================ Яндекс Маркет ============================
// Зоны — PNG-тайлы tiles.s3.yandex.net/RU/<слой>/<z>/<x>/<y>.png, проекция ЭЛЛИПТИЧЕСКИЙ Меркатор (EPSG:3395), z = 13.
const Y_TILE = (layer, z, x, y) => `https://tiles.s3.yandex.net/RU/${layer}/${z}/${x}/${y}.png`;
const Y_Z = 13, NEAR_PX = 2;
const Y_FILLS = { '255,185,80': 'SUBSIDY_TOO_WELLDONE', '177,107,245': 'SUBSIDY_WELLDONE', '107,153,245': 'SUBSIDY_MEDIUM',
  '167,233,248': 'SUBSIDY_RARE', '148,220,137': 'NO_SUBSIDY', '237,208,238': 'TOGETHER' };
const Y_FILL_SET = new Set(Object.values(Y_FILLS));
const Y_ZONES = { // код: [название, субсидия, группа, цвет строки, причина исключения]
  SUBSIDY_TOO_WELLDONE: ['оранжевый — до 300 000 ₽', 300000, 1, 'FFD596', null],
  SUBSIDY_WELLDONE: ['фиолетовый — до 250 000 ₽', 250000, 2, 'D0A6F9', null],
  SUBSIDY_MEDIUM: ['синий — до 200 000 ₽', 200000, 3, 'A7C0F6', null],
  SUBSIDY_RARE: ['голубой — до 140 000 ₽', 140000, 4, 'CBF2F9', null],
  NO_SUBSIDY: ['зелёный — до 100 000 ₽ (разовая выплата)', 100000, null, 'C0E8B6', 'NO_SUBSIDY'],
  TOGETHER: ['«Вместе» — внутри бизнесов других брендов', null, null, 'EAD6EB', '«Вместе»'],
  SECURITY: ['красный — охранная зона', null, null, 'FFC7CE', 'NOT_AVAILABLE (красная охранная зона)'],
  RURAL: ['серый — SUBSIDY_RURAL', null, null, 'D9D9D9', 'SUBSIDY_RURAL'],
  LIGHTNING: ['«Лёгкий старт»', null, null, 'FFF2CC', 'LIGHTNING «Лёгкий старт»'],
  NONE: ['вне зон карты', null, null, 'F2F2F2', 'NOT_DEFINED (точка вне цветных зон)'],
  UNKNOWN: ['не распознано', null, null, 'F8CBAD', 'не распознан цвет — проверить вручную'],
  ERROR: ['ошибка запроса', null, null, 'F8CBAD', 'ошибка запроса — повторить']
};
const Y_GROUP = { 1: '1 · до 300 000 ₽', 2: '2 · до 250 000 ₽', 3: '3 · до 200 000 ₽', 4: '4 · до 140 000 ₽' };
const Y_SUBS = ['SUBSIDY_TOO_WELLDONE', 'SUBSIDY_WELLDONE', 'SUBSIDY_MEDIUM', 'SUBSIDY_RARE'];

function makeYandex(fetchFn) {
  const tiles = new Map();
  async function tile(layer, x, y) {
    const k = `${layer}/${x}/${y}`;
    if (tiles.has(k)) return tiles.get(k);
    const pr = (async () => {
      for (let a = 1; a <= 4; a++) {
        try {
          const r = await fetchFn(Y_TILE(layer, Y_Z, x, y));
          if (r.status === 403 || r.status === 404) return null;
          if (r.ok) return PNG.sync.read(Buffer.from(await r.arrayBuffer()));
        } catch {}
        await sleep(1500 * a);
      }
      return 'ERR';
    })();
    tiles.set(k, pr);
    return pr;
  }
  const worldPx = (lat, lon) => {
    const e = 0.0818191908426, n = 2 ** Y_Z, s = Math.sin(lat * Math.PI / 180);
    return [(lon + 180) / 360 * n, (0.5 - (Math.atanh(s) - e * Math.atanh(e * s)) / (2 * Math.PI)) * n];
  };
  const px = (png, x, y) => { const i = (png.width * y + x) << 2; return [png.data[i], png.data[i + 1], png.data[i + 2], png.data[i + 3]]; };
  const pixClass = p => { const [r, g, b, a] = p; if (a === 0) return null; if (a === 153) return Y_FILLS[`${r},${g},${b}`] || 'UNKNOWN_FILL'; return 'EDGE'; };
  async function sample(layer, wx, wy) {
    const tx = Math.floor(wx), ty = Math.floor(wy);
    const t = await tile(layer, tx, ty);
    return { t, x: Math.floor((wx - tx) * 256), y: Math.floor((wy - ty) * 256) };
  }
  async function windowClasses(layer, wx, wy, rad) {
    const out = [], cx = wx * 256, cy = wy * 256;
    for (let dy = -rad; dy <= rad; dy++) for (let dx = -rad; dx <= rad; dx++) {
      const gx = cx + dx, gy = cy + dy, tx = Math.floor(gx / 256), ty = Math.floor(gy / 256);
      const t = await tile(layer, tx, ty); if (!t || t === 'ERR') continue;
      const c = pixClass(px(t, Math.floor(gx - tx * 256), Math.floor(gy - ty * 256)));
      if (c && c !== 'EDGE') out.push([Math.hypot(dx, dy), c]);
    }
    return out.sort((a, b) => a[0] - b[0]);
  }
  async function check(lat, lon) {
    const [wx, wy] = worldPx(lat, lon);
    const mpp = 156543.03392 * Math.cos(lat * Math.PI / 180) / 2 ** Y_Z;
    const s = await sample('available_v2', wx, wy);
    if (s.t === 'ERR') return { zone: 'ERROR', note: 'нет ответа сервера тайлов — повторить' };
    const cls = s.t ? pixClass(px(s.t, s.x, s.y)) : null;
    let base = null, note = '';
    if (Y_FILL_SET.has(cls)) base = cls;
    else {
      const near = await windowClasses('available_v2', wx, wy, NEAR_PX);
      if (near.length) { base = Y_FILL_SET.has(near[0][1]) ? near[0][1] : 'UNKNOWN'; note = `точка на границе зоны, ближайшая заливка ≈${Math.round(near[0][0] * mpp)} м — проверить вручную`; }
      else if (cls === 'EDGE') { base = 'UNKNOWN'; note = 'нераспознанный пиксель обводки — проверить вручную'; }
      else if (cls === 'UNKNOWN_FILL') { base = 'UNKNOWN'; note = 'неизвестный цвет заливки — проверить вручную'; }
      else base = 'NONE';
    }
    if (Y_SUBS.includes(base) || base === 'NONE') {
      const near = [...new Set((await windowClasses('available_v2', wx, wy, NEAR_PX)).map(x => x[1]).filter(c => Y_SUBS.includes(c) && c !== base))];
      if (near.length) note = (note ? note + '; ' : '') + 'рядом (≤20 м) другая зона: ' + near.sort().join(', ') + ' — проверить вручную';
    }
    const sec = await sample('security', wx, wy);
    if (sec.t === 'ERR') return { zone: 'ERROR', note: 'нет ответа сервера тайлов — повторить' };
    const inSec = sec.t && px(sec.t, sec.x, sec.y)[3] > 0;
    let other = null;
    for (const [layer, code] of [['rural', 'RURAL'], ['lightning', 'LIGHTNING']]) {
      const o = await sample(layer, wx, wy);
      if (o.t && o.t !== 'ERR' && px(o.t, o.x, o.y)[3] > 0) other = code;
    }
    const zone = inSec ? 'SECURITY' : other || base;
    if ((inSec || other) && base && base !== 'NONE') note = (note ? note + '; ' : '') + 'под этим слоем: ' + (Y_ZONES[base] || [base])[0];
    return { zone, note };
  }
  return { check };
}

// ============================ Wildberries ============================
const WB_API = 'https://map.wb.ru/pvz-map-backend/api/v2/map/check-point';
const WB_MIN_AREA = 25;
const WB_ZONES = { // код: [название, цвет, причина исключения]
  GUARANTEED_INCOME: ['приоритетная зона — гарантированный доход', 'E4D2F5', null],
  PRIORITY_NO_SUBSIDY: ['приоритетная зона — без выплат (только повышенный тариф)', 'FFF2CC', null],
  STANDARD: ['обычная точка (вне приоритетных зон), открыть можно', 'EDEDED', null],
  OTHER_SUBSIDY: ['приоритетная зона — другой тип выплаты', 'FCE4D6', null],
  RED_ZONE: ['красная зона', 'FFC7CE', 'красная зона (уже есть ПВЗ или скоро откроется)'],
  BLOCKED_BUILDING: ['заблокированное здание', 'F8CBAD', 'заблокированное здание'],
  NOT_ALLOWED: ['открыть нельзя', 'F8CBAD', 'открытие невозможно'],
  ERROR: ['ошибка запроса', 'F8CBAD', null]
};
function wbClassify(resp) {
  if (!resp || resp._err) return { code: 'ERROR', sub: null, tariff: null, note: (resp && resp._err) || 'нет ответа' };
  const pi = resp.point_info || {}, nc = (pi.zone_info || {}).number_code;
  const t0 = (pi.tariffs_info || []).find(t => t.tariff_id === 0);
  const tariff = t0 ? t0.total_tariff : null, desc = resp.description || '';
  if (!resp.can_open) {
    const code = /красн/i.test(desc) ? 'RED_ZONE' : /заблокирован/i.test(desc) ? 'BLOCKED_BUILDING' : 'NOT_ALLOWED';
    return { code, sub: null, tariff: null, note: desc };
  }
  const subs = pi.subsidies_info || [];
  if (subs.length) {
    const G = 'SUBSIDY_HEX_TYPE_GUARANTEED_INCOME';
    const guar = subs.filter(s => s.subsidy_text_code === G), other = subs.filter(s => s.subsidy_text_code !== G);
    const note = other.length ? 'другой тип выплаты: ' + other.map(s => `${s.subsidy_text_code}=${s.subsidy_size}`).join(', ') + ' — проверить вручную' : '';
    if (guar.length) return { code: 'GUARANTEED_INCOME', sub: Math.max(...guar.map(s => s.subsidy_size || 0)), tariff, note };
    return { code: 'OTHER_SUBSIDY', sub: Math.max(...subs.map(s => s.subsidy_size || 0)) || null, tariff, note };
  }
  if (nc === 103) return { code: 'PRIORITY_NO_SUBSIDY', sub: null, tariff, note: 'нет выплат от WB, повышенный тариф' };
  if (nc === 3) return { code: 'STANDARD', sub: null, tariff, note: 'нет приоритетной зоны, выплат нет' };
  return { code: 'STANDARD', sub: null, tariff, note: `неизвестный код зоны ${nc} — проверить вручную` };
}
function makeWB(fetchFn) {
  async function call(lat, lon) {
    const u = `${WB_API}?point.longitude=${lon}&point.latitude=${lat}&area=70&tariff_type=BasicTariff`;
    for (let a = 1; a <= 5; a++) {
      try {
        const r = await fetchFn(u, { headers: { Accept: 'application/json' } });
        if (r.status === 400 || r.status === 404) return { _err: 'HTTP ' + r.status };
        if (r.ok) return await r.json();
      } catch {}
      await sleep(1500 * a);
    }
    return { _err: 'нет ответа сервера — повторить запуск' };
  }
  return { check: async (lat, lon) => wbClassify(await call(lat, lon)) };
}
function wbArea(d) {
  const mn = num(d['Мин. площадь']), mx = num(d['Макс. площадь']), top = mx ?? mn;
  if (top === null) return [true, 'площадь не указана — проверить вручную'];
  if (top < WB_MIN_AREA) return [false, `площадь ${top} м² < ${WB_MIN_AREA} м²`];
  if (mn !== null && mn < WB_MIN_AREA) return [true, `мин. площадь ${mn} м² < ${WB_MIN_AREA}, но макс. ${top} м² — подходит только большая часть`];
  return [true, ''];
}

// ============================ файл результата ============================
const BASE_COLS = ['Метро / ЖД станции', 'Адрес', 'Мин. площадь', 'Макс. площадь', 'Цена, ₽', 'Дата', 'Кол-во дней в экспозиции', 'Источник', 'Ссылка на первоисточник', 'Координаты', 'Партия'];
const SPEC = {
  yandex: { label: 'Яндекс Маркет', prefix: 'ЯНДЕКС', journal: 'yandex_checked.json',
    add: ['Зона Яндекс', 'Код зоны', 'Субсидия, ₽', 'Проверка'], money: 'Субсидия, ₽',
    widths: { 'Адрес': 38, 'Метро / ЖД станции': 24, 'Ссылка на первоисточник': 20, 'Координаты': 24, 'Зона Яндекс': 32, 'Код зоны': 22, 'Проверка': 48, 'Причина исключения': 38 } },
  wb: { label: 'Wildberries', prefix: 'WB', journal: 'wb_checked.json',
    add: ['Зона WB', 'Код зоны', 'Гарантия, ₽', 'Тариф, %', 'Проверка'], money: 'Гарантия, ₽',
    widths: { 'Адрес': 38, 'Метро / ЖД станции': 24, 'Ссылка на первоисточник': 20, 'Координаты': 24, 'Зона WB': 40, 'Код зоны': 22, 'Проверка': 48, 'Причина исключения': 40 } }
};
const thin = { style: 'thin', color: { argb: 'FFBFBFBF' } }, border = { top: thin, left: thin, bottom: thin, right: thin };
function writeSheet(ws, spec, rows, withReason) {
  const cols = [...BASE_COLS, ...spec.add, ...(withReason ? ['Причина исключения'] : [])];
  const h = ws.addRow(cols);
  h.eachCell(c => { c.font = { bold: true }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9E1F2' } }; c.alignment = { wrapText: true, vertical: 'middle' }; c.border = border; });
  for (const r of rows) {
    const vals = cols.map(c => c === 'Ссылка на первоисточник' ? (r.d._url ? 'Открыть объявление' : r.d[c] ?? null)
      : c === 'Партия' ? r.batch : c === 'Причина исключения' ? r.reason : c in r.extra ? r.extra[c] : r.d[c] ?? null);
    const row = ws.addRow(vals);
    cols.forEach((c, j) => {
      const cell = row.getCell(j + 1);
      cell.border = border;
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + r.color } };
      if (c === 'Ссылка на первоисточник' && r.d._url) { cell.value = { text: 'Открыть объявление', hyperlink: r.d._url }; cell.font = { color: { argb: 'FF0563C1' }, underline: true }; }
      if (c === spec.money && r.extra[c]) cell.numFmt = '#,##0';
    });
  }
  cols.forEach((c, j) => (ws.getColumn(j + 1).width = spec.widths[c] || 14));
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  if (rows.length) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: rows.length + 1, column: cols.length } };
}
async function writeFile(file, spec, main, excluded) {
  const wb = new ExcelJS.Workbook();
  writeSheet(wb.addWorksheet('Результат'), spec, main, false);
  writeSheet(wb.addWorksheet('Исключённые'), spec, excluded, true);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  await wb.xlsx.writeFile(tmp);
  try { fs.renameSync(tmp, file); }
  catch { try { fs.unlinkSync(tmp); } catch {} throw new Error(`Не удалось записать ${path.basename(file)} — возможно, файл открыт в Excel.`); }
}

// ============================ запуск ============================
const readJson = (p, d) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return d; } };
const writeJson = (p, o) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(o, null, 1)); };

// files: [{path,size}]; ctx: { fetch, status(text, extra), isStopped(), outDir }
async function run(kind, files, ctx) {
  const spec = SPEC[kind];
  const checker = kind === 'yandex' ? makeYandex(ctx.fetch) : makeWB(ctx.fetch);
  const data = [], errors = [];
  for (const f of files) { try { data.push({ f, rows: readExport(f.path) }); } catch (e) { errors.push(e.message); } }
  const coords = [...new Set(data.flatMap(x => x.rows.map(d => d._key)))];
  const res = {}; let done = 0, stopped = false;
  ctx.status(`${spec.label}: проверено 0 из ${coords.length}`, { done: 0, total: coords.length });
  await pool(coords, kind === 'yandex' ? 6 : 3, async c => {
    if (ctx.isStopped()) { stopped = true; return; }
    const p = pc(c);
    res[c] = p ? await checker.check(p[0], p[1]) : (kind === 'yandex' ? { zone: 'ERROR', note: 'нет/неверные координаты' } : { code: 'ERROR', note: 'нет/неверные координаты' });
    if (kind === 'wb') await sleep(300);
    done++;
    if (done % 5 === 0 || done === coords.length) ctx.status(`${spec.label}: проверено ${done} из ${coords.length}`, { done, total: coords.length });
  });
  // WB: приоритетная зона без выплат иногда приходит «на лету» — перепроверяем через 3 с (как в скрипте)
  if (kind === 'wb' && !stopped) {
    const again = coords.filter(c => res[c] && ['PRIORITY_NO_SUBSIDY', 'ERROR'].includes(res[c].code));
    if (again.length) {
      await sleep(3000);
      await pool(again, 3, async c => { const p = pc(c); if (!p) return; const z = await checker.check(p[0], p[1]); if (z.code !== 'ERROR') res[c] = z; await sleep(300); });
    }
  }

  const jPath = path.join(ctx.outDir, spec.journal);
  const j = readJson(jPath, { описание: `Журнал проверки выгрузок на карте ${spec.label} программой PVZ`, files: {} });
  const now = new Date(), saved = [], stats = {}, manual = [];
  let mainN = 0, exclN = 0, unchecked = 0;
  for (const { f, rows } of data) {
    const main = [], excluded = [], pending = [];
    const batch = path.basename(f.path).replace(/\.xlsx$/i, '');
    rows.forEach((d, order) => {
      const z = res[d._key];
      if (!z) { pending.push(d._key); return; }
      let item;
      if (kind === 'yandex') {
        const info = Y_ZONES[z.zone] || Y_ZONES.ERROR;
        item = { d, batch, order, color: info[3], reason: info[4], group: info[2], note: z.note,
          extra: { 'Зона Яндекс': info[0], 'Код зоны': z.zone, 'Субсидия, ₽': info[1], 'Проверка': z.note || '' } };
        if (info[2]) main.push(item); else excluded.push(item);
      } else {
        const info = WB_ZONES[z.code] || WB_ZONES.ERROR;
        const notes = z.note ? [z.note] : [];
        let reason = info[2];
        const [ok, an] = wbArea(d);
        if (an) notes.push(an);
        if (!ok) reason = (reason ? reason + '; ' : '') + an;
        item = { d, batch, order, color: info[1], reason, sub: z.sub, note: notes.join('; '),
          extra: { 'Зона WB': info[0], 'Код зоны': z.code, 'Гарантия, ₽': z.sub, 'Тариф, %': z.tariff, 'Проверка': notes.join('; ') } };
        if (reason) excluded.push(item); else main.push(item);
      }
      const label = item.extra['Зона Яндекс'] || item.extra['Зона WB'];
      if (!item.reason) stats[label] = (stats[label] || 0) + 1;
      if (/проверить вручную/.test(item.note || '') && !item.reason) manual.push(`${d['Адрес']} — ${item.note}`);
    });
    unchecked += pending.length;
    if (pending.length === rows.length && rows.length) continue;
    if (kind === 'yandex') main.sort((a, b) => a.group - b.group || a.order - b.order);
    else main.sort((a, b) => (b.sub || 0) - (a.sub || 0) || a.order - b.order);
    mainN += main.length; exclN += excluded.length;
    const prev = j.files[f.path];
    const outFile = (prev && prev.result) || path.join(ctx.outDir, MONTHS[now.getMonth()], `${spec.prefix} ${path.basename(f.path)}`);
    await writeFile(outFile, spec, main, excluded);
    saved.push(outFile);
    j.files[f.path] = { size: f.size, result: outFile, checked: now.toISOString(), rows: rows.length, suitable: main.length,
      status: pending.length ? 'partial' : 'done', ...(pending.length ? { pending } : {}) };
  }
  writeJson(jPath, j);
  return { kind, label: spec.label, reason: stopped ? 'остановлено вручную' : 'проверка завершена', saved, errors, stats, main: mainN, excluded: exclN, unchecked, manual, addresses: coords.length, files: data.length };
}

module.exports = { run, SPEC, makeYandex, makeWB, wbClassify };
