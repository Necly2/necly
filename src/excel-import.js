const fs = require('fs');
const path = require('path');
const results = require('./results');
const ozon = require('./ozon');

function list(root) {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root).flatMap(id => {
    const meta = path.join(root, id, 'batch.json');
    return fs.existsSync(meta) ? [{ id, ...JSON.parse(fs.readFileSync(meta, 'utf8')) }] : [];
  }).sort((a, b) => b.created - a.created);
}

function read(root, id) {
  if (!/^batch-[a-zA-Z0-9]+$/.test(id)) throw new Error('Неизвестная вкладка');
  return JSON.parse(fs.readFileSync(path.join(root, id, 'rows.json'), 'utf8'));
}

async function run(root, source, mode, check) {
  if (!source || path.extname(source).toLowerCase() !== '.xlsx') throw new Error('Выберите файл Excel (.xlsx).');
  fs.mkdirSync(root, { recursive: true });
  const dir = fs.mkdtempSync(path.join(root, 'batch-'));
  const id = path.basename(dir), name = path.basename(source);
  try {
    const inputs = path.join(dir, 'input');
    fs.mkdirSync(inputs);
    const file = path.join(inputs, name);
    fs.copyFileSync(source, file);
    let rows, note = '';
    if (mode === 'view') {
      rows = results.readImportedFile(file);
    } else {
      if (!['ozon', 'wb', 'yandex'].includes(mode)) throw new Error('Выберите площадку.');
      const raw = ozon.readExport(file);
      if (!raw.length) throw new Error('Нет объявлений с адресом и координатами для проверки.');
      const outcome = await check(file, mode, dir);
      if (!outcome?.saved?.length) throw new Error(outcome?.errors?.join(' · ') || outcome?.reason || 'Нет файла результата проверки.');
      rows = outcome.saved.flatMap(results.readCheckedFile);
      note = [outcome.reason, ...(outcome.errors || []), raw.noCoords && ('Без координат: ' + raw.noCoords),
        (outcome.unchecked || outcome.stats?.unchecked) && ('Не проверено: ' + (outcome.unchecked || outcome.stats.unchecked))].filter(Boolean).join(' · ');
    }
    fs.writeFileSync(path.join(dir, 'rows.json'), JSON.stringify(rows));
    const meta = { name, created: Date.now(), count: rows.length, note, mode };
    fs.writeFileSync(path.join(dir, 'batch.tmp'), JSON.stringify(meta));
    fs.renameSync(path.join(dir, 'batch.tmp'), path.join(dir, 'batch.json'));
    return { id, ...meta };
  } catch (error) {
    fs.rmSync(dir, { recursive: true, force: true });
    throw error;
  }
}
module.exports = { list, read, run };
