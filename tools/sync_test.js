// Проверка синхронизации заказов: node tools/sync_test.js "$PWD/src/sync.js" /tmp/pvz-sync-test
const fs = require('fs'), path = require('path'), assert = require('assert');
const { create } = require(process.argv[2]);
const T = process.argv[3]; fs.rmSync(T, { recursive: true, force: true });
const SH = path.join(T, 'YandexDisk', 'PVZ Заказы'); fs.mkdirSync(SH, { recursive: true });
function pc(name) {
  const base = path.join(T, name); fs.mkdirSync(base, { recursive: true });
  let cfg = { root: path.join(base, 'PVZ', 'АДРЕСА'), ozonOut: path.join(base, 'PVZ', 'O'), jobs: [], schedules: [], syncDir: SH, pcId: name };
  const d = { loadCfg: () => JSON.parse(JSON.stringify(cfg)), saveCfg: c => (cfg = JSON.parse(JSON.stringify(c))),
    defJobDirs: (c, n) => ({ exp: path.join(base, 'PVZ', 'Заказы', n, 'Выгрузки'), res: path.join(base, 'PVZ', 'Заказы', n, 'Результаты') }),
    jobSeenPath: id => path.join(base, 'ud', id + '_seen.json'), safeName: n => n.replace(/[\\/:*?"<>|]/g, '_'), busy: () => false, send: () => {}, log: m => console.log(name, m) };
  const s = create(d); return { s, get cfg() { return cfg; }, set cfg(v) { cfg = v; }, d, base };
}
const A = pc('A'), B = pc('B');
// A: заказ со своими папками и файлами
const dirs = A.d.defJobDirs(null, 'Химки');
fs.mkdirSync(path.join(dirs.exp, 'Ноябрь'), { recursive: true }); fs.mkdirSync(path.join(dirs.res, 'Ноябрь'), { recursive: true });
fs.writeFileSync(path.join(dirs.exp, 'Ноябрь', 'export 1.xlsx'), 'EXP'); fs.writeFileSync(path.join(dirs.res, 'Ноябрь', 'OZON export 1.xlsx'), 'RES');
fs.writeFileSync(path.join(dirs.res, 'ozon_checked.json'), '{}');
fs.mkdirSync(path.join(A.base, 'ud'), { recursive: true }); fs.writeFileSync(A.d.jobSeenPath('j1'), JSON.stringify({ cian: { '111': 5 } }));
A.cfg = Object.assign(A.cfg, { jobs: [Object.assign({ id: 'j1', name: 'Химки', sync: true, params: { areaFrom: 40 }, updated: 100 }, dirs), { id: 'jl', name: 'Только у A', params: {} }], schedules: [{ id: 's1', kind: 'job', job: 'j1', time: '13:30', pc: 'A' }], resWatch: { k1: { added: 10, row: {} } } });
A.s.run(); B.s.run();
assert.equal(B.cfg.jobs.length, 1, 'B получил только общий заказ'); assert.ok(!fs.readdirSync(SH).includes('Только у A'), 'несинхронизируемый не в общей папке');
const bj = B.cfg.jobs[0]; assert.equal(bj.params.areaFrom, 40);
assert.ok(fs.existsSync(path.join(bj.exp, 'Ноябрь', 'export 1.xlsx')), 'выгрузка скопирована на B');
assert.equal(fs.readFileSync(path.join(bj.res, 'Ноябрь', 'OZON export 1.xlsx'), 'utf8'), 'RES');
assert.ok(!fs.existsSync(path.join(bj.res, 'ozon_checked.json')), 'журнал не копируется');
assert.ok(fs.existsSync(path.join(dirs.exp, 'Ноябрь', 'export 1.xlsx')), 'у A файл остался');
assert.equal(B.cfg.schedules[0].pc, 'A', 'расписание с компьютером A');
assert.ok(JSON.parse(fs.readFileSync(B.d.jobSeenPath('j1'))).cian['111'], 'выгруженные на B');
assert.ok(B.cfg.resWatch.k1, 'отслеживаемое на B');
// B меняет параметры и добавляет файл
const c = B.cfg; c.jobs[0].params = { areaFrom: 60 }; c.jobs[0].updated = 200; B.cfg = c;
fs.mkdirSync(path.join(bj.exp, 'Декабрь'), { recursive: true }); fs.writeFileSync(path.join(bj.exp, 'Декабрь', 'export 2.xlsx'), 'EXP2');
B.s.run(); A.s.run();
assert.equal(A.cfg.jobs[0].params.areaFrom, 60, 'A получил изменения');
assert.equal(A.cfg.jobs[0].exp, dirs.exp, 'папки A не тронуты');
assert.ok(fs.existsSync(path.join(dirs.exp, 'Декабрь', 'export 2.xlsx')), 'файл B пришёл на A');
// B убирает отслеживаемое
const c2 = B.cfg; delete c2.resWatch.k1; c2.resWatchDel = { k1: 20 }; B.cfg = c2; B.s.run(); A.s.run();
assert.ok(!A.cfg.resWatch.k1, 'удаление отслеживаемого дошло до A');
// A добавляет снова — позже удаления
const c3 = A.cfg; c3.resWatch.k1 = { added: 30, row: {} }; A.cfg = c3; A.s.run(); B.s.run(); assert.ok(B.cfg.resWatch.k1, 'снова добавлено');
// одноимённые заказы при первом подключении
const C = pc('C'); C.cfg = Object.assign(C.cfg, { jobs: [{ id: 'jc', name: 'Химки', sync: true, params: { areaFrom: 1 } }], schedules: [{ id: 'sc', kind: 'job', job: 'jc', time: '09:00', pc: 'C' }] });
C.s.run();
assert.equal(C.cfg.jobs.length, 1); assert.equal(C.cfg.jobs[0].id, 'j1', 'склеен с общим'); assert.equal(C.cfg.jobs[0].params.areaFrom, 60);
assert.deepEqual(C.cfg.schedules.map(s => s.id).sort(), ['s1', 'sc'], 'оба задания');
A.s.run(); assert.deepEqual(A.cfg.schedules.map(s => s.id).sort(), ['s1', 'sc'], 'A получил задание C');
assert.equal(fs.readdirSync(SH).filter(n => !n.startsWith('_')).length, 1, 'одна папка заказа');
// удаление на A
A.s.markDeleted(A.cfg, A.cfg.jobs[0]); const c4 = A.cfg; c4.jobs = c4.jobs.filter(j => j.id !== 'j1'); A.cfg = c4; B.s.run();
assert.equal(B.cfg.jobs.length, 0, 'удаление дошло до B');
// общая папка недоступна — заказы не удаляются
const D = pc('D'); D.cfg = Object.assign(D.cfg, { jobs: [{ id: 'jd', name: 'Д', sync: true, syncedOnce: true, syncDir: 'Д' }] }); fs.rmSync(path.join(SH, 'Д'), { recursive: true, force: true });
D.s.run(); assert.equal(D.cfg.jobs.length, 1, 'не удалён без отметки');
// «только здесь»: заказ в списке исключений не возвращается из общей папки
const E = pc('E'); E.cfg = Object.assign(E.cfg, { syncIgnore: ['jd'] }); E.s.run();
assert.ok(!E.cfg.jobs.some(j => j.id === 'jd'), 'исключённый заказ не пришёл');
const F = pc('F'); F.s.run(); assert.ok(F.cfg.jobs.some(j => j.id === 'jd' && j.sync), 'без исключения пришёл и синхронизируется');
console.log('SYNC OK');
