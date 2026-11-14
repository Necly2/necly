// PVZ Master — «Заказы»: сохранённые параметры выгрузки, у каждого своё название, цвет и свои папки
// для выгрузок и результатов. Плитки → карточка заказа: запустить, изменить, результаты, папки, архив.
(() => {
const J = { list: [], rows: [], seen: {}, watch: {}, open: null, arch: false, sched: [], pc: '', syncDir: '' };
const DAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const COLORS = ['#2F7BFF', '#14B8A6', '#F97316', '#8B5CF6', '#EC4899', '#22C55E', '#EAB308', '#06B6D4', '#EF4444', '#64748B'];
const SRC_N = { cian: 'Циан', avito: 'Авито', winner: 'Winner' }, CHK_N = { ozon: 'Ozon', yandex: 'Яндекс Маркет', wb: 'WB' };
const fmtDate = t => { const d = new Date(t); return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' }) + ' ' + d.toTimeString().slice(0, 5); };
const short = p => (p || '').split(/[\\/]/).filter(Boolean).slice(-3).join(' / ');

async function load() {
  const [list, r, c] = await Promise.all([pvz.jobs(), pvz.results().catch(() => ({ rows: [] })), pvz.getCfg()]);
  J.list = list; J.rows = r.rows || []; J.seen = c.resSeen || {}; J.sched = c.schedules || []; J.watch = c.resWatch || {}; J.pc = c.pcId; J.syncDir = c.syncDir || '';
  J.syncLast = c.syncDir ? (await pvz.syncState().catch(() => ({}))).last : 0;
}
// подходящие / непросмотренные — по файлам результатов в папке заказа (у заказов с общими папками не различить)
function stats(j) {
  if (j.shared) return null;
  const m = new Map(); for (const x of J.rows) if (x.job === j.id) m.set(markKey(x), x);
  const l = [...m.values()];
  return { n: l.length, green: l.filter(x => x.platform === 'Ozon' && x.zone === 'зелёный').length, unseen: l.filter(x => !J.seen[markKey(x)]).length };
}
const srcLine = j => Object.keys(SRC_N).filter(k => j.sources && j.sources[k]).map(k => SRC_N[k]).join(' · ') || 'источники не выбраны';
const chkLine = j => Object.keys(CHK_N).filter(k => j.checks && j.checks[k]).map(k => CHK_N[k]).join(', ') || 'без проверки';
const parLine = j => (window.wizParamChips ? wizParamChips(j.params).slice(0, 4).join(' · ') : '');

// задания расписания этого заказа (хранятся в общем расписании: kind 'job')
const jobSched = j => J.sched.filter(x => x.kind === 'job' && x.job === j.id);
const daysText = d => { d = [...(d || [])].sort(); return d.join() === '1,2,3,4,5' ? 'по будням' : d.length === 7 ? 'каждый день' : d.join() === '6,7' ? 'по выходным' : d.map(k => DAYS[k - 1]).join(', ') || 'дни не выбраны'; };
const schedLine = j => jobSched(j).filter(x => x.enabled && (x.days || []).length).map(x => x.time).sort().join(', ');
async function saveSched(mut) {
  const c = await pvz.getCfg(); const list = c.schedules || []; mut(list);
  await pvz.setCfg({ schedules: list }); J.sched = list;
}
function renderGrid() {
  const act = J.list.filter(j => !j.archived), arc = J.list.filter(j => j.archived), list = J.arch ? arc : act;
  $('jCount').textContent = J.arch ? `в архиве ${fmtNum(arc.length)}` : fmtNum(act.length) ? `${fmtNum(act.length)}` : '';
  $('jArchN').textContent = arc.length ? fmtNum(arc.length) : '';
  $('jArch').checked = J.arch; $('jArch').parentNode.style.display = arc.length || J.arch ? '' : 'none';
  $('jGrid').innerHTML = list.map(j => {
    const s = stats(j);
    const pc = window.wizParamChips ? wizParamChips(j.params) : [];
    const chips = [...Object.keys(SRC_N).filter(k => j.sources && j.sources[k]).map(k => `<span class="src">${SRC_N[k]}</span>`), ...[pc[0], pc[2], /любая/.test(pc[3] || '') ? null : pc[3]].filter(Boolean).map(c => `<span>${esc(c)}</span>`)];
    return `<div class="j-tile" data-id="${esc(j.id)}" style="--c:${esc(j.color || '#2F7BFF')}" tabindex="0">
      <div class="jt-h"><i></i><b>${esc(j.name)}</b>${J.syncDir && j.sync ? '<span class="jt-sync" title="Общий заказ — синхронизируется с другими компьютерами">⇅</span>' : ''}${s && s.unseen ? `<span class="j-badge" title="Не просмотрено объявлений: ${fmtNum(s.unseen)}">${fmtNum(s.unseen)}</span>` : ''}</div>
      <div class="jt-chips">${chips.join('')}</div>
      <div class="jt-foot"><div class="jt-info">
          ${j.busy ? `<span class="jt-busy">⏳ выгружается на «${esc(j.busy.pcName)}»</span>` : s ? `<span>подходящих <b>${fmtNum(s.n)}</b>${s.green ? ` · <b class="g">${fmtNum(s.green)} зелёных</b>` : ''}</span>` : '<span class="muted">общие папки программы</span>'}
          <span class="jt-d">${j.lastRun ? 'выгрузка ' + fmtDate(j.lastRun) : 'ещё не запускался'}${schedLine(j) ? ' · 🕒 ' + esc(schedLine(j)) : ''}</span></div>
        ${j.archived ? '' : '<button class="jt-run" data-run title="Запустить выгрузку заказа">▶</button>'}</div></div>`;
  }).join('') + (J.arch ? '' : `<button class="j-tile j-add" id="jAddTile"><span>+</span>Новый заказ</button>`)
    + (J.arch && !list.length ? '<div class="s-empty">Архив пуст.</div>' : '');
  $('jGrid').querySelectorAll('.j-tile[data-id]').forEach(b => {
    b.onclick = e => { const j = J.list.find(x => x.id === b.dataset.id); if (e.target.closest('[data-run]')) runJob(j); else openCard(b.dataset.id); };
    b.onkeydown = e => { if (e.key === 'Enter') openCard(b.dataset.id); };
  });
  if ($('jAddTile')) $('jAddTile').onclick = newJob;
}

// запуск заказа — сразу шаг «Выгрузка и проверка» (если заказ выгружается на другом компьютере, мастер предупредит)
async function runJob(j) {
  if (!j) return;
  window.openWizard({ job: j, mode: 'run' });
}
// отчёт по заказу одним Excel: подходящие помещения за период, со статусами и заметками
async function report(j) {
  const v = await showModal({ kind: 'info', title: 'Отчёт по заказу', text: `Excel-файл со всеми подходящими помещениями заказа «${j.name}»: зона, поддержка, цена, ссылка, статус и заметка. За какой период?`,
    buttons: [{ label: 'Отмена', value: null }, { label: 'За 7 дней', value: 7 }, { label: 'За 30 дней', value: 30 }, { label: 'За всё время', cls: 'primary', value: 0 }] });
  if (v === null || v === undefined) return;
  const since = v ? Date.now() - v * 864e5 : 0, m = new Map();
  for (const x of J.rows) if (x.job === j.id && (x.exported || x.checked) >= since) m.set(markKey(x), x);
  const ST = typeof STATUSES !== 'undefined' ? STATUSES : {};
  const rows = [...m.values()].sort((a, b) => (b.exported || b.checked) - (a.exported || a.checked)).map(x => { const w = J.watch[markKey(x)] || {}; return Object.assign({}, x, { status: ST[w.status] || '', userNote: w.note || '' }); });
  if (!rows.length) { showModal({ kind: 'info', title: 'Пока пусто', text: 'За этот период у заказа нет подходящих помещений.' }); return; }
  const f = await pvz.exportRows(rows, { title: 'Отчёт ' + j.name, dir: j.resDir });
  if (f) toast(`Отчёт сохранён: ${fmtNum(rows.length)} помещений`);
}
function openCard(id) {
  const j = J.list.find(x => x.id === id); if (!j) { J.open = null; return show(); }
  J.open = id; show();
  const s = stats(j), w = window.wizParamChips ? wizParamChips(j.params) : [];
  const orders = Object.values(j.orders || {}).filter(o => o && o.on);
  const chips = [...Object.keys(SRC_N).filter(k => j.sources && j.sources[k]).map(k => SRC_N[k]), ...w];
  if (j.sources && j.sources.avito) chips.push(j.avitoUrl ? 'фильтры Авито сохранены ✓' : 'фильтры Авито не сохранены');
  const folder = (label, which, dir) => `<div class="jc-f"><span class="jc-fl">${label}</span><span class="jc-fp" title="${esc(dir || '')}">${esc(dir ? '…/' + short(dir) : '—')}</span>
      <span class="jc-fb"><button class="ghost sm" data-open="${esc(dir || '')}">Открыть</button>${j.shared ? '' : `<button class="ghost sm" data-pick="${which}">Сменить…</button>`}</span></div>`;
  $('jCard').innerHTML = `<div class="jc-top" style="--c:${esc(j.color || '#2F7BFF')}">
      <button class="ghost" id="jcBack"><svg viewBox="0 0 24 24"><path d="M15 6l-6 6 6 6"/></svg>Все заказы</button>
      <i class="jc-dot"></i><h2>${esc(j.name)}</h2>${j.busy ? `<span class="jc-badge busy">⏳ выгружается на «${esc(j.busy.pcName)}»</span>` : ''}${s && s.unseen ? `<span class="j-badge big" title="Не просмотрено объявлений">не просмотрено ${fmtNum(s.unseen)}</span>` : ''}<button class="ghost sm" id="jcRename" title="Переименовать">✎</button>${j.archived ? '<span class="jc-badge">в архиве</span>' : ''}</div>
    <div class="jc-actions">
      <button class="primary" id="jcRun">▶ Запустить</button>
      <button class="ghost" id="jcEdit">✎ Изменить параметры</button>
      <button class="ghost" id="jcRefresh" title="${J.syncDir && j.sync ? 'Забрать из общей папки новые выгрузки, результаты и изменения с других компьютеров' : 'Пересчитать итоги по файлам в папках заказа'}">↻ Обновить</button>
      <button class="ghost" id="jcReport"${j.shared ? ' disabled title="У заказа общие папки — отчёт только для заказа с отдельными папками"' : ' title="Все подходящие помещения заказа одним Excel-файлом"'}>⬇ Отчёт Excel</button>
      <button class="ghost" id="jcRes"${j.shared ? ' title="У заказа общие папки — откроются все результаты"' : ''}>Результаты заказа${s ? ` <b>${fmtNum(s.n)}</b>` : ''}${s && s.unseen ? ` <span class="j-badge">${fmtNum(s.unseen)}</span>` : ''}</button>
    </div>
    <div class="jc-grid">
      <div class="jc-col">
      <div class="box"><div class="box-h">Параметры</div>
        <div class="jc-chips">${chips.map(c => `<span>${esc(c)}</span>`).join('')}</div>
        <div class="hint">Проверка зон: ${esc(chkLine(j))}${orders.length ? '<br>Заказы Winner: ' + orders.map(o => esc(o.name || '') + (o.tag ? ' · метка ' + esc(o.tag) : '')).join('; ') : ''}</div></div>
      <div class="box"><div class="box-h">Итоги</div>
        <div class="jc-st"><span>Последняя выгрузка</span><b>${j.lastRun ? fmtDate(j.lastRun) : '—'}</b></div>
        ${s ? `<div class="jc-st"><span>Подходящих помещений</span><b>${fmtNum(s.n)}</b></div><div class="jc-st"><span>из них зелёных Ozon</span><b class="g">${fmtNum(s.green)}</b></div><div class="jc-st"><span>Не просмотрено</span><b class="u">${fmtNum(s.unseen)}</b></div>`
          : '<p class="hint">У заказа общие папки программы — его результаты не отделить от остальных. Сделайте отдельные папки, чтобы видеть итоги заказа.</p>'}</div>
      <div class="box jc-sched"><div class="box-h">Расписание заказа</div>
        <div id="jcSchList"></div>
        <button class="ghost sm" id="jcSchAdd">+ Добавить время</button>
        <p class="hint">Выгрузка заказа запускается сама в эти дни и время — когда компьютер включён и PVZ Master запущен (можно свёрнутым). Winner — с выполненным входом; для Авито фильтры должны быть сохранены в заказе.</p></div>
      </div>
      <div class="jc-col">
      <div class="box"><div class="box-h">Общий доступ (другие компьютеры)</div>
        ${J.syncDir ? `<label class="switch"><input type="checkbox" id="jcSync"${j.sync ? ' checked' : ''}><span></span><span class="lbl">Синхронизировать этот заказ <small>параметры, расписание, «уже выгруженные»${j.shared ? '' : ', файлы выгрузок и результатов'} — общие с другими компьютерами</small></span></label>
          ${j.sync ? `<div class="jc-f"><span class="jc-fl">Общая папка</span><span class="jc-fp" title="${esc(J.syncDir)}">${esc('…/' + short(J.syncDir) + (j.syncDir ? ' / ' + j.syncDir : ''))}</span><span class="jc-fb"><button class="ghost sm" id="jcSyncOpen">Открыть</button></span></div>` : ''}
          <p class="hint">${!j.sync ? 'Сейчас заказ только на этом компьютере.' : j.shared ? 'У заказа общие папки программы — синхронизируются параметры и расписание; для файлов сделайте отдельные папки заказа.' : 'Файлы копируются в общую папку и обратно — в папках на этом компьютере они тоже остаются.'}${J.syncLast ? ' Синхронизировано: ' + new Date(J.syncLast).toLocaleTimeString('ru-RU').slice(0, 5) + '.' : ''}</p>`
        : '<p class="hint">Синхронизация выключена. Чтобы заказ был общим с другими компьютерами, выберите общую папку Яндекс Диска в «Настройки → Синхронизация заказов».</p><button class="ghost sm" id="jcSyncSet" style="align-self:flex-start">Открыть настройки</button>'}</div>
      <div class="box jc-folders"><div class="box-h">Папки</div>
        ${j.shared ? `<p class="hint">Общие папки программы (как у «Новой выгрузки»).</p>${folder('Результаты', 'res', j.resDir)}
          <button class="ghost" id="jcOwn">Сделать отдельные папки заказа</button><p class="hint">Будут созданы: ${esc(short(j.defDirs.exp))} и ${esc(short(j.defDirs.res))}. Старые файлы останутся на месте.</p>`
        : folder('Выгрузки', 'exp', j.expDir) + folder('Результаты', 'res', j.resDir) + '<p class="hint">Переименование заказа папки не меняет.</p>'}
</div>
      <div class="box"><div class="box-h">Не повторять уже выгруженные</div>
        <div class="jc-row"><label class="switch"><input type="checkbox" id="jcOnlyNew"${j.onlyNew !== false ? ' checked' : ''}><span></span><span class="lbl">Только новые объявления</span></label>
          <select id="jcSeenDays">${[[3, 'за 3 дня'], [7, 'за 7 дней'], [14, 'за 14 дней'], [30, 'за 30 дней'], [0, 'за всё время']].map(([v, t]) => `<option value="${v}"${(j.seenDays || 0) === v ? ' selected' : ''}>${t}</option>`).join('')}</select></div>
        <div class="jc-row"><span class="hint" id="jcSeenInfo">…</span><button class="ghost sm" id="jcForget">Забыть</button></div>
        <p class="hint">У каждого заказа свой список — объявление, выгруженное в другом заказе, здесь выгрузится.</p></div>
      <div class="box"><div class="box-h">Цвет</div><div class="jc-colors">${COLORS.map(c => `<button data-color="${c}" style="--c:${c}" class="${c === j.color ? 'on' : ''}"></button>`).join('')}</div></div>
      </div>
    </div>
    <div class="jc-foot"><button class="ghost" id="jcDup">⧉ Дублировать</button><button class="ghost" id="jcArch">${j.archived ? '↩ Вернуть из архива' : '🗄 В архив'}</button><span class="grow"></span><button class="ghost jc-del" id="jcDel">Удалить заказ</button></div>`;
  renderSched(j);
  $('jcSchAdd').onclick = async () => {
    await saveSched(l => l.push({ id: Date.now().toString(36), enabled: true, time: '13:30', days: [1, 2, 3, 4, 5], check: true, kind: 'job', job: j.id, name: j.name }));
    renderSched(j);
  };
  const save = async o => { await pvz.jobSave(Object.assign({ id: j.id }, o)); await load(); openCard(j.id); };
  $('jcBack').onclick = () => { J.open = null; show(); renderGrid(); };
  $('jcRun').onclick = () => runJob(j);
  $('jcReport').onclick = () => report(j);
  $('jcEdit').onclick = () => window.openWizard({ job: j, mode: 'edit' });
  $('jcRes').onclick = () => { R.jobF = j.shared ? '' : j.id; R.day = 'all'; R.up = 'all'; openPage('results'); };
  $('jcRename').onclick = async () => {
    const v = await showModal({ kind: 'info', title: 'Переименовать заказ', text: 'Папки заказа останутся прежними.', input: { value: j.name }, buttons: [{ label: 'Отмена', value: null }, { label: 'Сохранить', cls: 'primary', value: 'ok' }] });
    if (v && v.input) save({ name: v.input });
  };
  $('jCard').querySelectorAll('[data-open]').forEach(b => (b.onclick = () => b.dataset.open && pvz.openFolder(b.dataset.open)));
  $('jCard').querySelectorAll('[data-pick]').forEach(b => (b.onclick = async () => { await pvz.jobPickFolder(j.id, b.dataset.pick); await load(); openCard(j.id); }));
  if ($('jcSync')) $('jcSync').onchange = async () => {
    const on = $('jcSync').checked;
    if (!on && !(await showModal({ kind: 'warn', title: 'Не синхронизировать?', text: `Заказ «${j.name}» останется на этом компьютере, но перестанет обмениваться изменениями и файлами с другими. На других компьютерах он останется как был.`, buttons: [{ label: 'Отмена', value: false }, { label: 'Выключить', cls: 'primary', value: true }] }))) { $('jcSync').checked = true; return; }
    await pvz.jobSync(j.id, on); await load(); openCard(j.id); toast(on ? 'Заказ стал общим' : 'Заказ только на этом компьютере');
  };
  if ($('jcSyncSet')) $('jcSyncSet').onclick = () => { window.setTab && setTab('sync'); openPage('settings'); };
  $('jcRefresh').onclick = async () => {
    $('jcRefresh').disabled = true; $('jcRefresh').textContent = '↻ Обновляю…';
    if (J.syncDir && j.sync) { const st = await pvz.syncNow(); if (st && st.err) toast('Синхронизация: ' + st.err); }
    await load(); openCard(j.id); toast('Обновлено');
  };
  if ($('jcSyncOpen')) $('jcSyncOpen').onclick = () => pvz.openFolder(j.syncDir ? J.syncDir.replace(/[\\/]$/, '') + (J.syncDir.includes('\\') ? '\\' : '/') + j.syncDir : J.syncDir);
  if ($('jcOwn')) $('jcOwn').onclick = async () => { await pvz.jobOwnFolders(j.id); await load(); openCard(j.id); toast('Папки заказа созданы'); };
  $('jcOnlyNew').onchange = () => { $('jcSeenDays').disabled = !$('jcOnlyNew').checked; pvz.jobSave({ id: j.id, onlyNew: $('jcOnlyNew').checked }); j.onlyNew = $('jcOnlyNew').checked; };
  $('jcSeenDays').disabled = j.onlyNew === false;
  $('jcSeenDays').onchange = () => { pvz.jobSave({ id: j.id, seenDays: +$('jcSeenDays').value }); j.seenDays = +$('jcSeenDays').value; };
  const seenInfo = async () => { const n = await pvz.jobSeen(j.id); if ($('jcSeenInfo')) $('jcSeenInfo').textContent = `Запомнено: Циан ${fmtNum(n.cian)}, Авито ${fmtNum(n.avito)}`; };
  seenInfo();
  $('jcForget').onclick = async () => {
    const v = await showModal({ kind: 'warn', title: 'Забыть выгруженные?', text: `В следующий раз заказ «${j.name}» выгрузит все объявления заново.`, buttons: [{ label: 'Отмена', value: false }, { label: 'Забыть', cls: 'primary', value: true }] });
    if (v) { await pvz.jobSeen(j.id, true); seenInfo(); }
  };
  $('jCard').querySelectorAll('[data-color]').forEach(b => (b.onclick = () => save({ color: b.dataset.color })));
  $('jcDup').onclick = async () => {
    const { id, exp, res, expDir, resDir, shared, defDirs, lastRun, created, migrated, archived, ...rest } = j;
    const n = await pvz.jobSave(Object.assign(rest, { name: j.name + ' (копия)' }));
    await load(); openCard(n.id); toast('Заказ скопирован');
  };
  $('jcArch').onclick = async () => { await save({ archived: !j.archived }); toast(j.archived ? 'Заказ возвращён' : 'Заказ в архиве'); };
  $('jcDel').onclick = async () => {
    const synced = J.syncDir && j.sync;
    const v = await showModal({ kind: 'warn', title: 'Удалить заказ?', text: `Заказ «${j.name}» будет удалён. Файлы выгрузок и результатов в папках останутся. Задания расписания этого заказа отключатся.` + (synced ? '\n\nЗаказ общий: «Удалить везде» — удалит его на всех компьютерах; «Только здесь» — уберёт с этого компьютера, у остальных он останется.' : ''),
      buttons: synced ? [{ label: 'Отмена', value: false }, { label: 'Только здесь', value: 'here' }, { label: 'Удалить везде', cls: 'primary', value: true }] : [{ label: 'Отмена', value: false }, { label: 'Удалить', cls: 'primary', value: true }] });
    if (!v) return;
    if (v === 'here') await pvz.jobSync(j.id, false);
    await pvz.jobDelete(j.id); J.open = null; await load(); show(); renderGrid();
  };
}
function renderSched(j) {
  const el = $('jcSchList'); if (!el) return;
  const list = jobSched(j);
  el.innerHTML = list.length ? list.map(x => `<div class="jc-sch${x.enabled ? '' : ' off'}" data-sid="${esc(x.id)}">
      <label class="switch" title="Включено"><input type="checkbox" class="en"${x.enabled ? ' checked' : ''}><span></span></label>
      <input type="time" class="tm" value="${esc(x.time)}">
      <div class="s-days">${DAYS.map((d, k) => `<button class="${(x.days || []).includes(k + 1) ? 'on' : ''}" data-d="${k + 1}">${d}</button>`).join('')}</div>
      <label class="chk"><input type="checkbox" class="ck"${x.check ? ' checked' : ''}>проверить зоны</label>
      ${J.syncDir && j.sync ? (x.pc && x.pc !== J.pc ? `<span class="jc-pc other" title="Задание выполняет другой компьютер">💻 ${esc(x.pcName || 'другой компьютер')}</span><button class="ghost sm here">Выполнять здесь</button>` : '<span class="jc-pc">💻 этот компьютер</span>') : ''}
      <button class="del" title="Удалить">✕</button></div>`).join('')
    : '<p class="hint">Заданий нет — выгрузка только вручную.</p>';
  if (j.archived && list.some(x => x.enabled)) el.insertAdjacentHTML('beforeend', '<p class="hint">Заказ в архиве — по расписанию не запускается.</p>');
  const upd = (id, f) => saveSched(l => { const x = l.find(y => y.id === id); if (x) f(x, l); }).then(() => renderSched(j));
  el.querySelectorAll('.jc-sch').forEach(r => {
    const id = r.dataset.sid;
    r.querySelector('.en').onchange = e => upd(id, x => (x.enabled = e.target.checked));
    r.querySelector('.tm').onchange = e => e.target.value && upd(id, x => (x.time = e.target.value));
    r.querySelector('.ck').onchange = e => upd(id, x => (x.check = e.target.checked));
    r.querySelectorAll('[data-d]').forEach(b => (b.onclick = () => upd(id, x => { const n = +b.dataset.d; x.days = (x.days || []).includes(n) ? x.days.filter(k => k !== n) : [...(x.days || []), n].sort(); })));
    r.querySelector('.del').onclick = () => upd(id, (x, l) => l.splice(l.indexOf(x), 1));
    if (r.querySelector('.here')) r.querySelector('.here').onclick = () => upd(id, x => { delete x.pc; delete x.pcName; });
  });
}
function show() { $('jobs').classList.toggle('detail', !!J.open); }

async function newJob() {
  const v = await showModal({ kind: 'info', title: 'Новый заказ', text: 'Дальше откроется мастер: выберите источники, проверки и параметры и нажмите «Сохранить в заказ». У заказа будут свои папки.', input: { value: '', placeholder: 'Название, например «Заказ #6 — Химки»' },
    buttons: [{ label: 'Отмена', value: null }, { label: 'Создать', cls: 'primary', value: 'ok' }] });
  if (!v || !v.input) return;
  const j = await pvz.jobSave(Object.assign({ name: v.input }, window.wizDefaults ? wizDefaults() : {}));
  window.openWizard({ job: j, mode: 'edit' });
}

window.openJobs = async (id) => {
  document.body.dataset.mode = 'jobs'; pvz.nav('welcome');
  await load();
  J.open = id && J.list.some(x => x.id === id) ? id : null;
  if (J.open && J.list.find(x => x.id === id).archived) J.arch = true;
  renderGrid(); show();
  if (J.open) openCard(J.open);
};
window.jobsBack = id => window.openJobs(id);
window.jobsOpenId = () => J.open;
$('jNew').onclick = newJob;
$('jArch').onchange = () => { J.arch = $('jArch').checked; J.open = null; show(); renderGrid(); };

// число заказов на кнопке главного экрана
// на кнопке «Заказы» — сколько объявлений в заказах ещё не просмотрено
async function homeJobs() {
  try {
    await load();
    const u = J.list.filter(j => !j.archived).reduce((a, j) => a + ((stats(j) || {}).unseen || 0), 0);
    $('jobsN').textContent = u ? fmtNum(u) : ''; $('jobsN').title = u ? `Не просмотрено объявлений в заказах: ${fmtNum(u)}` : '';
  } catch {}
}
new MutationObserver(() => { if (document.body.dataset.mode === 'welcome') homeJobs(); }).observe(document.body, { attributes: true, attributeFilter: ['data-mode'] });
homeJobs();
})();
