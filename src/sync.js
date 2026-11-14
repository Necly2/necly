// Синхронизация заказов между компьютерами через общую папку (Яндекс Диск и т. п.).
// В общей папке у каждого заказа своя папка:  <общая>/<название>/заказ.json  (параметры, расписание),
//   выгруженные.json (список «уже выгруженных»), Выгрузки/ и Результаты/ — копии файлов .xlsx.
// Локальные папки заказа на компьютере остаются: файлы копируются в обе стороны (новее — заменяет старый, удаление не переносится).
// Отслеживаемые объявления — <общая>/_отслеживаемые.json (объединение; удаление — по отметке времени).
const fs = require('fs');
const path = require('path');

const JOB_FILE = 'заказ.json', SEEN_FILE = 'выгруженные.json', WATCH_FILE = '_отслеживаемые.json';
const FIELDS = ['name', 'color', 'sources', 'checks', 'params', 'avitoUrl', 'orders', 'onlyNew', 'seenDays', 'archived', 'created'];
const readJson = (p, d) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return d; } };
function writeJson(p, o) {
  const t = JSON.stringify(o, null, 1);
  try { if (fs.readFileSync(p, 'utf8') === t) return false; } catch {}
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = p + '.tmp'; fs.writeFileSync(tmp, t); fs.renameSync(tmp, p); return true;
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// файлы .xlsx папки (относительные пути → {mtime, size})
function listX(dir, depth = 0, base = dir, out = new Map()) {
  let l = []; try { l = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of l) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (depth < 4) listX(p, depth + 1, base, out); continue; }
    if (!/\.xlsx$/i.test(e.name) || e.name.startsWith('~$')) continue;
    try { const st = fs.statSync(p); out.set(path.relative(base, p), { mtime: st.mtimeMs, size: st.size }); } catch {}
  }
  return out;
}
function copy(src, dst) {
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  const st = fs.statSync(src), tmp = dst + '.pvztmp';
  fs.copyFileSync(src, tmp); fs.renameSync(tmp, dst);
  fs.utimesSync(dst, st.atime, st.mtime);
}
// папки a ↔ b: недостающее копируется, при расхождении больше 2 с — новее заменяет старый
function mirror(a, b) {
  if (!a || !b) return 0;
  fs.mkdirSync(a, { recursive: true }); fs.mkdirSync(b, { recursive: true });
  const A = listX(a), B = listX(b); let n = 0;
  for (const rel of new Set([...A.keys(), ...B.keys()])) {
    const x = A.get(rel), y = B.get(rel);
    try {
      if (x && !y) { copy(path.join(a, rel), path.join(b, rel)); n++; }
      else if (!x && y) { copy(path.join(b, rel), path.join(a, rel)); n++; }
      else if (Math.abs(x.mtime - y.mtime) > 2000) { if (x.mtime > y.mtime) copy(path.join(a, rel), path.join(b, rel)); else copy(path.join(b, rel), path.join(a, rel)); n++; }
    } catch {}
  }
  return n;
}
const mergeSeen = (a, b) => { const o = {}; for (const s of [a || {}, b || {}]) for (const [site, ids] of Object.entries(s)) { o[site] = o[site] || {}; for (const [id, t] of Object.entries(ids || {})) o[site][id] = Math.max(o[site][id] || 0, t || 0); } return o; };

function create(d) {
  // d: { loadCfg, saveCfg, defJobDirs, jobSeenPath, safeName, busy(), send(ch, data), log(msg) }
  const state = { last: 0, err: '', files: 0 };
  // заказы в общей папке: id → { dir, data }
  function shared(root) {
    const m = new Map(); let l = []; try { l = fs.readdirSync(root, { withFileTypes: true }); } catch { return m; }
    for (const e of l) {
      if (!e.isDirectory()) continue;
      const dir = path.join(root, e.name), data = readJson(path.join(dir, JOB_FILE), null);
      if (data && data.id) { const p = m.get(data.id); if (!p || (data.updated || 0) > (p.data.updated || 0)) m.set(data.id, { dir, data }); }
    }
    return m;
  }
  const jobOut = (c, j) => Object.assign({ format: 1, id: j.id, updated: j.updated || Date.now(), lastRun: j.lastRun || 0 },
    Object.fromEntries(FIELDS.filter(k => k in j).map(k => [k, j[k]])),
    { schedules: (c.schedules || []).filter(s => s.kind === 'job' && s.job === j.id) });
  function freeDir(root, name, id) {
    let n = d.safeName(name), dir = path.join(root, n), k = 2;
    while (fs.existsSync(dir) && (readJson(path.join(dir, JOB_FILE), {}) || {}).id !== id) dir = path.join(root, `${n} (${k++})`);
    return dir;
  }
  function run(opt = {}) {
    const c = d.loadCfg(); const root = c.syncDir;
    if (!root) return state;
    if (!fs.existsSync(root)) { state.err = 'общая папка не найдена: ' + root; return state; }
    try {
      const S = shared(root); let changed = false, files = 0;
      const setSched = (id, list) => { c.schedules = (c.schedules || []).filter(s => !(s.kind === 'job' && s.job === id)).concat((list || []).map(s => Object.assign({}, s, { kind: 'job', job: id }))); };
      // 1. заказы этого компьютера
      const ignore = new Set(c.syncIgnore || []);
      for (const j of [...c.jobs]) {
        if (!j.sync) continue;   // заказ не отмечен «Синхронизировать» — только на этом компьютере
        let s = S.get(j.id);
        // первое подключение: заказ с таким же названием уже есть в общей папке (например, у обоих был сценарий «Заказ #4») — это один заказ
        if (!s && !j.syncedOnce) {
          const twin = [...S.values()].find(x => !x.data.deleted && !ignore.has(x.data.id) && x.data.name === j.name && !c.jobs.some(y => y.id === x.data.id));
          if (twin) {
            const old = j.id, nid = twin.data.id;
            try { if (fs.existsSync(d.jobSeenPath(old))) fs.renameSync(d.jobSeenPath(old), d.jobSeenPath(nid)); } catch {}
            for (const x of c.schedules || []) if (x.kind === 'job' && x.job === old) x.job = nid;
            j.id = nid; j.updated = 0; s = twin; changed = true;
            // расписание этого компьютера не теряем — добавляем к общему
            const mine = (c.schedules || []).filter(x => x.kind === 'job' && x.job === nid && !(twin.data.schedules || []).some(y => y.id === x.id));
            twin.data.schedules = (twin.data.schedules || []).concat(mine); twin.data.updated = Math.max(twin.data.updated || 0, 1); j.twinMerged = true;
          }
        }
        if (!s) {
          // в общей папке заказа нет (новый или папку убрали) — записать; удаляется заказ только по отметке «удалён»
          const dir = freeDir(root, j.name, j.id); writeJson(path.join(dir, JOB_FILE), jobOut(c, j)); j.syncedOnce = true; j.syncDir = path.basename(dir); changed = true; S.set(j.id, { dir, data: jobOut(c, j) });
          continue;
        }
        if (j.syncDir !== path.basename(s.dir) || !j.syncedOnce) { j.syncDir = path.basename(s.dir); j.syncedOnce = true; changed = true; }
        if (s.data.lastRun > (j.lastRun || 0)) { j.lastRun = s.data.lastRun; changed = true; }
        if ((s.data.updated || 0) > (j.updated || 0)) {
          if (s.data.deleted) { c.jobs = c.jobs.filter(x => x !== j); setSched(j.id, []); try { fs.unlinkSync(d.jobSeenPath(j.id)); } catch {} changed = true; continue; }
          for (const k of FIELDS) if (k in s.data) j[k] = s.data[k];
          j.updated = s.data.updated; setSched(j.id, s.data.schedules); changed = true;
          if (j.twinMerged) { delete j.twinMerged; j.updated = Date.now(); writeJson(path.join(s.dir, JOB_FILE), jobOut(c, j)); }
        } else if ((j.updated || 0) > (s.data.updated || 0) || (j.lastRun || 0) > (s.data.lastRun || 0)) writeJson(path.join(s.dir, JOB_FILE), jobOut(c, j));
      }
      // 2. заказы, созданные на другом компьютере
      for (const [id, s] of S) {
        if (s.data.deleted || ignore.has(id) || c.jobs.some(j => j.id === id)) continue;
        const j = Object.assign({ id }, Object.fromEntries(FIELDS.filter(k => k in s.data).map(k => [k, s.data[k]])), d.defJobDirs(c, s.data.name || 'Заказ'),
          { updated: s.data.updated || Date.now(), lastRun: s.data.lastRun || 0, syncedOnce: true, sync: true, syncDir: path.basename(s.dir) });
        for (const p of [j.exp, j.res]) fs.mkdirSync(p, { recursive: true });
        c.jobs.push(j); setSched(id, s.data.schedules); changed = true;
        d.log(`синхронизация: новый заказ «${j.name}» с другого компьютера`);
      }
      // 3. «уже выгруженные» и файлы заказов
      for (const j of c.jobs) {
        const s = S.get(j.id); if (!j.sync || !s || s.data.deleted) continue;
        const lp = d.jobSeenPath(j.id), sp = path.join(s.dir, SEEN_FILE), m = mergeSeen(readJson(lp, {}), readJson(sp, {}));
        if (Object.keys(m).length) { writeJson(lp, m); writeJson(sp, m); }
        if (j.exp && !d.busy() && !opt.noFiles) { files += mirror(j.exp, path.join(s.dir, 'Выгрузки')); files += mirror(j.res, path.join(s.dir, 'Результаты')); }
      }
      // 4. отслеживаемые
      const wp = path.join(root, WATCH_FILE), W = readJson(wp, { items: {}, del: {} });
      const items = Object.assign({}, W.items || {}), del = Object.assign({}, W.del || {});
      for (const [k, v] of Object.entries(c.resWatch || {})) if (!items[k] || (v.added || 0) > (items[k].added || 0)) items[k] = v;
      for (const [k, t] of Object.entries(c.resWatchDel || {})) del[k] = Math.max(del[k] || 0, t || 0);
      for (const k of Object.keys(items)) if ((del[k] || 0) >= (items[k].added || 0)) delete items[k];
      writeJson(wp, { описание: 'Отслеживаемые объявления PVZ Master (общие для всех компьютеров)', items, del });
      if (!same(items, c.resWatch || {}) || !same(del, c.resWatchDel || {})) { c.resWatch = items; c.resWatchDel = del; changed = true; }
      if (changed) d.saveCfg(c);
      state.last = Date.now(); state.err = ''; state.files += files;
      if (changed || files) d.send('synced', { changed, files });
    } catch (e) { state.err = String(e && e.message || e); d.log('синхронизация: ошибка ' + state.err); }
    return state;
  }
  // заказ удалён на этом компьютере — отметка в общей папке, чтобы удалился и на других
  function markDeleted(c, j) {
    if (!c.syncDir || !j || !j.syncDir || !j.sync) return;
    try { const p = path.join(c.syncDir, j.syncDir, JOB_FILE); const o = readJson(p, {}); if (o.id === j.id) writeJson(p, Object.assign(o, { deleted: true, updated: Date.now() })); } catch {}
  }
  let t = null, timer = null;
  const soon = (ms = 1500) => { clearTimeout(t); t = setTimeout(() => run(), ms); };
  const start = () => { clearInterval(timer); timer = setInterval(() => run(), 60e3); soon(4000); };
  return { run, soon, start, markDeleted, state };
}
module.exports = { create, mirror, mergeSeen };
