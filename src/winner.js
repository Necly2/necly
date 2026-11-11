// Baza Winner (w7.baza-winner.ru): выгрузка заказа по 300 объявлений через мастер экспорта.
// Логика — из проверенного скрипта bw_export.js проекта PVZ:
//   режим «скрывать»: отметить 300 → мастер (проверка/исправление настроек) → «Экспорт в Excel» →
//                     файл записан и проверен → «в скрытые» → повторять, пока не останется новых;
//   режим «без скрытия» (Заказ #4): список всех id → порции по 300: отметить → экспорт → снять отметку.
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const BW_CODE = fs.readFileSync(path.join(__dirname, 'bw_export.js'), 'utf8');
const HELPERS = `(() => {
  const W = window;
  W.__bwApp = {
    lastB64: async () => {
      const blob = W.__blobs[W.__blobs.length - 1];
      const buf = new Uint8Array(await blob.arrayBuffer());
      let s = ''; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
      return btoa(s);
    },
    page: () => {
      const m = location.href.match(/\\/search\\/([0-9a-f-]{36})/i);
      return { href: location.href, guid: m ? m[1] : null };
    }
  };
  return 'ok';
})()`;

// известные заказы (метка файла, скрывать ли выгруженные)
const KNOWN = {
  'f6fcd57a-013b-45c8-abcd-89f04b3bf28b': { name: 'Заказ #3 Артем', tag: '', hide: true },
  'bde0dac7-35da-4e41-92d9-a94b78552bdb': { name: 'Заказ #4 Артем', tag: '#4', hide: false },
  '3daabb2d-e169-4789-91c9-7b2cb677f87c': { name: 'Заказ #5 Артем', tag: 'МО', hide: true }
};
function orderInfo(guid, cfg) {
  const saved = (cfg.bwOrders || {})[guid];
  return Object.assign({ name: '', tag: '', hide: true }, KNOWN[guid] || {}, saved || {});
}

const MONTHS = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];

function targetFile(root, tag) {
  const now = new Date();
  const dd = String(now.getDate()).padStart(2, '0');
  const dir = path.join(root, MONTHS[now.getMonth()], `Адреса ${dd}${tag ? ' ' + tag : ''}`);
  fs.mkdirSync(dir, { recursive: true });
  const prefix = `export_excel${tag ? ' ' + tag : ''} ${dd} `;
  let n = 0;
  for (const f of fs.readdirSync(dir)) {
    if (f.toLowerCase().startsWith(prefix.toLowerCase()) && /\.xlsx$/i.test(f)) n = Math.max(n, parseInt(f.slice(prefix.length), 10) || 0);
  }
  return { dir, file: path.join(dir, `${prefix}${n + 1}.xlsx`) };
}

// проверка файла: 14 колонок, есть «Координаты», строк ≈ отмеченным
function verify(buf, expected) {
  const wb = XLSX.read(buf, { type: 'buffer' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }).filter(r => r.some(v => String(v).trim() !== ''));
  const head = (rows[0] || []).map(v => String(v).trim());
  const data = rows.length - 1;
  const ci = head.indexOf('Координаты');
  const problems = [];
  if (head.length < 14) problems.push(`колонок ${head.length} (нужно 14)`);
  if (ci < 0) problems.push('нет колонки «Координаты»');
  else { const noC = rows.slice(1).filter(r => !String(r[ci] || '').trim()).length; if (noC > data * 0.2) problems.push(`без координат ${noC} из ${data}`); }
  if (expected && data < expected - 5) problems.push(`строк ${data}, отмечено ${expected}`);
  return { ok: problems.length === 0, rows: data, problems };
}

async function run(wc, cfg, opts, status, isStopped) {
  const J = code => wc.executeJavaScript(code, true);
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const saved = [];
  let exported = 0, lastDir = '';

  await J(BW_CODE); await J(HELPERS);
  const pg = await J('__bwApp.page()');
  if (!pg.guid) return { ok: false, error: 'Откройте в Winner нужный заказ (страница заказа: Параметры или Список)' };
  const G = pg.guid;
  const info0 = orderInfo(G, cfg);
  const tag = (opts.tag != null ? opts.tag : info0.tag).trim();
  const hide = opts.hide != null ? opts.hide : info0.hide;

  status('Открываю список заказа…');
  const op = await J(`__bw.open(${JSON.stringify(G)})`);
  if (op.login_required) return { ok: false, error: 'Winner просит войти — войдите в окне справа и повторите' };
  if (!op.ok) return { ok: false, error: 'Не удалось открыть «Список» заказа — откройте его вручную и повторите' };
  const inf = await J(`__bw.info(${JSON.stringify(G)}).then(i => (delete i.sp, i))`);
  if (!inf.userId) return { ok: false, error: 'Не найден пользователь Winner — обновите страницу заказа' };

  async function wizard(expected) {
    let w = await J('__bw.wizardOpen()');
    if (!w.ok || w.cols !== 14) { status('Исправляю настройки мастера экспорта…'); w = await J('__bw.wizardFix()'); }
    if (w.ok && w.cols === 14 && expected && w.rows < expected) { await J('__bw.wizardClose()'); await sleep(1500); w = await J('__bw.wizardOpen()'); }
    if (!w.ok || w.cols !== 14) throw new Error('Мастер экспорта настроен неверно: ' + (w.problems || []).join('; ') + ` (колонок ${w.cols})`);
    return w;
  }
  async function exportAndSave(expected) {
    await J('__bw.exportXlsx()');
    const b64 = await J('__bwApp.lastB64()');
    const buf = Buffer.from(b64, 'base64');
    const v = verify(buf, expected);
    if (!v.ok) throw new Error('Файл выгрузки не прошёл проверку: ' + v.problems.join('; '));
    const t = targetFile(cfg.root, tag);
    fs.writeFileSync(t.file, buf);
    const chk = verify(fs.readFileSync(t.file), expected);
    if (!chk.ok) throw new Error('Записанный файл не прошёл проверку: ' + chk.problems.join('; '));
    saved.push(t.file); lastDir = t.dir; exported += v.rows;
    return { file: t.file, rows: v.rows };
  }

  let reason = '';
  try {
    if (hide) {
      let left = inf.total, part = 0;
      if (!left) return { ok: true, reason: 'новых объявлений в заказе нет', total: 0, saved, dir: '', extra: '' };
      while (left > 0) {
        if (isStopped()) { reason = 'остановлено вручную'; break; }
        part++;
        status(`Порция ${part}: отмечаю до 300 из ${left}…\nВыгружено: ${exported}`);
        let m = await J(`__bw.mark(${JSON.stringify(G)}, 300).then(m => ({marked: m.marked, n: m.ids.length, total: m.total}))`);
        if (!m.n) { reason = 'новых объявлений больше нет'; break; }
        if (!m.marked) { await sleep(3000); m.marked = (await J(`__bw.info(${JSON.stringify(G)})`)).selected; }
        status(`Порция ${part}: отмечено ${m.marked}. Мастер экспорта (~10 с)…\nВыгружено: ${exported}`);
        await wizard(m.marked);
        status(`Порция ${part}: экспорт и проверка файла…\nВыгружено: ${exported}`);
        const s = await exportAndSave(m.marked);
        status(`Порция ${part}: сохранено ${path.basename(s.file)} (${s.rows} стр.). Помещаю в скрытые…\nВыгружено: ${exported}`);
        await J('__bw.wizardClose()');
        const h = await J(`__bw.hide(${JSON.stringify(G)})`);
        left = h.total_left;
      }
      if (!reason) reason = 'все новые объявления заказа выгружены и помещены в скрытые';
    } else {
      const plan = await J(`__bw.planAll(${JSON.stringify(G)})`);
      const n = plan.ids, parts = Math.ceil(n / 300);
      if (!n) return { ok: true, reason: 'в ленте заказа нет объявлений', total: 0, saved, dir: '', extra: '' };
      for (let part = 1; part <= parts; part++) {
        if (isStopped()) { reason = 'остановлено вручную (отметки сняты)'; break; }
        status(`Порция ${part} из ${parts}: отмечаю и открываю мастер (~10 с)…\nВыгружено: ${exported} из ${n}`);
        const r = await J('__bw.nextSlice(300).then(r => r.done ? r : ({k: r.k, n: r.n, ok: r.w.ok, cols: r.w.cols, rows: r.w.rows}))');
        if (r.done) break;
        if (!r.ok || r.cols !== 14 || r.rows < r.n) { await J('__bw.wizardClose()'); await sleep(1000); await wizard(r.n); }
        status(`Порция ${part} из ${parts}: экспорт и проверка файла…\nВыгружено: ${exported} из ${n}`);
        await exportAndSave(r.n);
      }
      // снять отметку с последней порции (объявления остаются в ленте)
      await J('__bw.nextSlice(0)').catch(() => {});
      if (!reason) reason = 'весь заказ выгружен (объявления оставлены в ленте, без скрытия)';
    }
  } catch (e) {
    try { await J('__bw.wizardClose()'); } catch {}
    if (!hide) { try { await J('__bw.nextSlice(0)'); } catch {} }
    return { ok: true, reason: 'остановлено с ошибкой: ' + (e.message || e) + '. Объявления текущей порции НЕ скрыты.', total: exported, saved, dir: lastDir, extra: '' };
  }
  try { await J('__bw.wizardClose()'); } catch {}
  return { ok: true, reason, total: exported, saved, dir: lastDir,
           extra: `Заказ: ${info0.name || G}; метка файлов: ${tag || '—'}; ${hide ? 'выгруженные помещены в скрытые' : 'без скрытия'}.` };
}

module.exports = { run, orderInfo, KNOWN };
