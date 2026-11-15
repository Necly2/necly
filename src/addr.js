// PVZ Master — «Поиск по адресу»: проверка помещения только по адресу
// (адрес → точка через поиск карты Ozon → зона Ozon, поддержка по ступеням площади, сверка дома;
// по желанию — зоны Яндекс Маркета и Wildberries по той же точке). Можно проверить список адресов.
(() => {
const ZONE_TXT = {
  'зелёный': 'Зелёная зона — «вечная» поддержка в ЖК',
  'синий': 'Синяя зона — поддержка от 5 млн ₽',
  'голубой': 'Голубая зона — поддержка 3–5 млн ₽',
  'гарантия < 3 млн': 'Поддержка меньше 3 млн ₽',
  'вне зоны': 'Вне зоны — поддержки нет',
  'открытие пвз недоступно': 'Ozon не даёт открыть ПВЗ по этому адресу (например, рядом уже есть)',
  'пока нельзя (охранная зона)': 'Охранная зона — открыть пока нельзя',
  'ошибка запроса': 'Ozon не ответил — попробуйте ещё раз'
};
const COLOR = z => (typeof OZ_C !== 'undefined' && OZ_C[z]) || ({ 'вне зоны': '#9ca3af', 'открытие пвз недоступно': '#ef4444', 'пока нельзя (охранная зона)': '#ef4444' })[z] || '#9ca3af';
const Y_COLOR = { SUBSIDY_TOO_WELLDONE: '#fb923c', SUBSIDY_WELLDONE: '#c084fc', SUBSIDY_MEDIUM: '#6b99f5', SUBSIDY_RARE: '#67e8f9', NO_SUBSIDY: '#86efac', SECURITY: '#ef4444' };
const W_COLOR = { GUARANTEED_INCOME: '#d8b4fe', OTHER_SUBSIDY: '#fdba74', PRIORITY_NO_SUBSIDY: '#fde047' };
const rub = n => n ? fmtNum(Math.round(n)) + ' ₽' : '—';
const tierTxt = t => `${t[0]}${t[1] ? '–' + t[1] : '+'} м²`;
const opts = () => ({ yandex: $('aPlat').querySelector('[value=yandex]').checked, wb: $('aPlat').querySelector('[value=wb]').checked });
const other = (name, o, col) => o ? `<div class="a-other"><i style="background:${col[o.code] || '#9ca3af'}"></i><b>${name}</b><span>${esc(o.zone)}${o.money && !/₽/.test(o.zone) ? ' · ' + rub(o.money) : ''}</span>${o.note ? `<small class="muted">${esc(o.note)}</small>` : ''}</div>` : '';
let batch = null;   // результаты списка адресов

function card(r) {
  const z = r.zone, pt = r.found || {}, sup = r.sup;
  return `<div class="box a-card" style="--z:${COLOR(z)}">
    <div class="a-top"><span class="a-zone"><i></i>${esc(z)}</span><span class="a-ztxt">${esc(ZONE_TXT[z] || '')}</span><span class="grow"></span><span class="muted">${new Date(r.at).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span></div>
    <div class="a-addr"><b>${esc(pt.text || r.addr)}</b>${pt.text && pt.text !== r.addr ? `<span class="muted"> — вы искали: ${esc(r.addr)}</span>` : ''}</div>
    ${r.greenSmall ? `<div class="a-warn">Площадь ${fmtNum(r.area)} м² меньше ${fmtNum(r.greenMin)} м² — для зелёной зоны Ozon помещение не подходит.</div>` : ''}
    ${pt.lat != null ? `<div class="a-near" id="aAround">Квартир в 400 м: <span class="muted">считаю…</span></div>` : ''}
    ${r.near && r.near.dist != null ? `<div class="a-near">Ближайший ПВЗ Ozon — <b>${fmtNum(r.near.dist)} м</b>${r.near.name ? ` <span class="muted">(${esc(r.near.name)})</span>` : ''}</div>` : ''}
    ${r.note ? `<div class="a-note">${esc(r.note)}</div>` : ''}
    ${(r.tiers || []).length ? `<div class="a-sup">${sup ? `<div class="a-big">${r.area ? `Для ${fmtNum(r.area)} м² (${esc(sup.note)})` : ''}: <b>${rub(sup.month)}</b> в месяц · <b>${rub(sup.total)}</b> всего</div>` : r.area ? '' : '<div class="hint">Укажите площадь — покажу поддержку для неё.</div>'}
      <table class="a-tiers"><tr><th>Площадь</th><th>В месяц</th><th>Всего</th></tr>${r.tiers.map(t => `<tr class="${sup && sup.note === tierTxt(t) ? 'on' : ''}"><td>${tierTxt(t)}</td><td>${rub(t[2])}</td><td>${rub(t[3])}</td></tr>`).join('')}</table></div>` : ''}
    ${r.yandex || r.wb ? `<div class="a-others">${other('Яндекс Маркет', r.yandex, Y_COLOR)}${other('Wildberries', r.wb, W_COLOR)}</div>` : ''}
    <div class="a-acts">
      <button class="ghost sm" id="aYa">Яндекс.Карты ↗</button>
      <button class="ghost sm" id="aOz">Карта Ozon ↗</button>
      <button class="ghost sm" id="aStar">★ В отслеживаемые</button>
      <button class="ghost sm" id="aCopy">Скопировать</button>
      ${pt.lat != null ? `<span class="muted a-c">${pt.lat.toFixed(6)}, ${pt.lon.toFixed(6)}</span>` : ''}
    </div>
    ${(r.variants || []).length > 1 ? `<details class="fold a-var"><summary>Не тот дом? Варианты</summary>${r.variants.map((v, i) => `<button class="ghost sm" data-v="${i}">${esc(v.text)}</button>`).join('')}</details>` : ''}
  </div>`;
}
const textOf = r => { const pt = r.found || {}; return `${pt.text || r.addr}\nOzon: ${r.zone}${r.sup ? `, поддержка ${rub(r.sup.month)}/мес, всего ${rub(r.sup.total)} (${r.sup.note})` : ''}${r.near && r.near.dist != null ? `\nБлижайший ПВЗ Ozon: ${fmtNum(r.near.dist)} м` : ''}${r.yandex ? '\nЯндекс Маркет: ' + r.yandex.zone : ''}${r.wb ? '\nWildberries: ' + r.wb.zone : ''}${r.note ? '\n' + r.note : ''}`; };
// «Квартир в 400 м»: сначала OpenStreetMap, затем уточнение по МинЖКХ (если сайт попросит проверку — кнопка)
let aroundPt = null;
function paintAround(a) {
  const e = $('aAround'); if (!e) return;
  if (!a || a.err) { e.innerHTML = `Квартир в 400 м: <span class="muted">${esc((a && a.err) || 'нет данных')}</span>`; return; }
  const lim = Math.min((a.cands || []).length, 30), busy = lim && !a.captcha && (a.mkDone || 0) < lim ? ` · уточняю по ЖКХ ${a.mkDone || 0}/${lim}` : '';
  e.innerHTML = `Квартир в 400 м: <b>${a.est || a.unknown ? '≈' : ''}${fmtNum(a.n)}</b> <span class="muted">(жилых домов ${a.buildings}${a.mkExact ? `, точно по ЖКХ — ${a.mkExact}` : ''}${a.unknown ? `, ещё ${a.unknown} без данных` : ''}${busy})</span>`
    + (a.captcha ? ' <button type="button" class="mk-verify" id="aMkVerify">уточнить по ЖКХ</button>' : '');
  if ($('aMkVerify')) $('aMkVerify').onclick = async () => { $('aMkVerify').disabled = true; $('aMkVerify').textContent = 'жду проверку…'; if (await pvz.mingkhVerify().catch(() => false) && aroundPt) pvz.flatsAround(aroundPt.lat, aroundPt.lon).then(paintAround); };
}
pvz.onAroundProgress(d => { if (aroundPt && d.lat === aroundPt.lat && d.lon === aroundPt.lon) paintAround(d.a); });
function bindCard(r) {
  const pt = r.found || {};
  if (pt.lat != null) { aroundPt = pt; pvz.flatsAround(pt.lat, pt.lon).then(paintAround).catch(() => {}); }
  $('aYa').onclick = () => pvz.openExternal(pt.lat != null ? `https://yandex.ru/maps/?pt=${pt.lon},${pt.lat}&z=17&l=map` : 'https://yandex.ru/maps/?text=' + encodeURIComponent(r.addr));
  $('aOz').onclick = () => { navigator.clipboard && navigator.clipboard.writeText(pt.text || r.addr).catch(() => {}); pvz.openExternal('https://pvz-map.ozon.ru/'); toast('Адрес скопирован — вставьте в поиск карты Ozon'); };
  $('aCopy').onclick = () => navigator.clipboard.writeText(textOf(r)).then(() => toast('Скопировано'));
  $('aStar').onclick = async () => {
    const c = await pvz.getCfg(), w = c.resWatch || {}, del = c.resWatchDel || {};
    const row = { platform: 'Ozon', zone: r.zone, note: r.note || '', address: pt.text || r.addr, metro: '', areaMin: r.area, areaMax: null, price: null, money: null,
      supMonth: r.sup ? r.sup.month : null, supTotal: r.sup ? r.sup.total : null, supTier: r.sup ? r.sup.note : '', near: r.near ? r.near.dist : null, source: 'Поиск по адресу', date: '', url: '',
      lat: pt.lat ?? null, lon: pt.lon ?? null, file: 'Поиск по адресу', filePath: '', checked: r.at, exported: r.at, job: '' };
    const k = 'Ozon|' + row.address;
    w[k] = { added: Date.now(), row }; delete del[k];
    await pvz.setCfg({ resWatch: w, resWatchDel: del }); toast('★ Добавлено в отслеживаемые');
  };
  document.querySelectorAll('.a-var [data-v]').forEach(b => (b.onclick = () => run(r.addr, r.area, r.variants[+b.dataset.v])));
}
const busy = on => { $('aGo').disabled = on; $('aGo').textContent = on ? 'Проверяю…' : 'Проверить'; };
async function run(q, area, pick) {
  q = String(q || '').trim(); if (!q) { $('aQ').focus(); return; }
  setMulti(false); $('aQ').value = q; if (area) setNum($('aArea'), area);
  busy(true);
  $('aRes').innerHTML = `<div class="box a-wait"><div class="bar ind"><i></i></div>Ищу адрес и проверяю зону… обычно 10–30 секунд.</div>`;
  const r = await pvz.addrCheck(q, area || null, pick || null, opts()).catch(e => ({ ok: false, error: e.message }));
  busy(false);
  if (!r.ok) {
    $('aRes').innerHTML = `<div class="box a-card err"><b>Не удалось проверить</b><div>${esc(r.error || 'ошибка')}</div>${(r.variants || []).length ? `<details class="fold a-var" open><summary>Варианты адреса</summary>${r.variants.map((v, i) => `<button class="ghost sm" data-v="${i}">${esc(v.text)}</button>`).join('')}</details>` : ''}</div>`;
    document.querySelectorAll('.a-var [data-v]').forEach(b => (b.onclick = () => run(q, area, r.variants[+b.dataset.v])));
    return;
  }
  $('aRes').innerHTML = card(r); bindCard(r); hist();
}
// ---------- несколько адресов: таблица ----------
function tableHtml() {
  const o = batch.opt, done = batch.rows.filter(x => x.r).length;
  return `<div class="box a-tbl"><div class="a-tblh"><b>${batch.stop || done === batch.rows.length ? 'Проверено' : 'Проверяю'}: ${fmtNum(done)} из ${fmtNum(batch.rows.length)}</b><span class="grow"></span>
      ${done < batch.rows.length && !batch.stop ? '<button class="ghost sm" id="aStop">Остановить</button>' : '<button class="ghost sm" id="aTblCopy">Скопировать таблицу</button>'}</div>
    <table class="a-tiers a-multi"><tr><th>Адрес</th><th>м²</th><th>Ozon</th><th>Поддержка</th><th>ПВЗ рядом</th>${o.yandex ? '<th>Яндекс Маркет</th>' : ''}${o.wb ? '<th>Wildberries</th>' : ''}</tr>
    ${batch.rows.map((x, i) => { const r = x.r; if (!r) return `<tr><td>${esc(x.addr)}</td><td>${x.area ? fmtNum(x.area) : ''}</td><td colspan="${3 + (o.yandex ? 1 : 0) + (o.wb ? 1 : 0)}" class="muted">${i === done && !batch.stop ? 'проверяю…' : 'ожидает'}</td></tr>`;
      if (!r.ok) return `<tr><td>${esc(x.addr)}</td><td>${x.area ? fmtNum(x.area) : ''}</td><td colspan="${3 + (o.yandex ? 1 : 0) + (o.wb ? 1 : 0)}" class="a-err">${esc(r.error || 'ошибка')}</td></tr>`;
      return `<tr data-i="${i}" title="Показать подробно"><td>${esc((r.found && r.found.text) || x.addr)}</td><td>${r.area ? fmtNum(r.area) : ''}</td><td><span class="zb"><i style="background:${COLOR(r.zone)}"></i>${esc(r.zone)}</span></td><td>${r.sup ? rub(r.sup.total) : (r.tiers || []).length ? rub(Math.max(...r.tiers.map(t => t[3]))) : '—'}</td><td>${r.near && r.near.dist != null ? fmtNum(r.near.dist) + ' м' : '—'}</td>${o.yandex ? `<td>${esc((r.yandex || {}).zone || '—')}</td>` : ''}${o.wb ? `<td>${esc((r.wb || {}).zone || '—')}</td>` : ''}</tr>`; }).join('')}</table>
    <div id="aOne"></div></div>`;
}
function drawTable() {
  $('aRes').innerHTML = tableHtml();
  if ($('aStop')) $('aStop').onclick = () => { batch.stop = true; };
  if ($('aTblCopy')) $('aTblCopy').onclick = () => {
    const o = batch.opt, head = ['Адрес', 'Площадь', 'Зона Ozon', 'Поддержка в месяц', 'Поддержка всего', 'Ближайший ПВЗ Ozon, м', ...(o.yandex ? ['Яндекс Маркет'] : []), ...(o.wb ? ['Wildberries'] : []), 'Примечание'];
    const rows = batch.rows.filter(x => x.r).map(x => { const r = x.r; return r.ok ? [(r.found && r.found.text) || x.addr, r.area || '', r.zone, r.sup ? r.sup.month : '', r.sup ? r.sup.total : '', r.near ? r.near.dist : '', ...(o.yandex ? [(r.yandex || {}).zone || ''] : []), ...(o.wb ? [(r.wb || {}).zone || ''] : []), r.note || ''] : [x.addr, x.area || '', 'ошибка', '', '', '', ...(o.yandex ? [''] : []), ...(o.wb ? [''] : []), r.error || '']; });
    navigator.clipboard.writeText([head, ...rows].map(a => a.join('\t')).join('\n')).then(() => toast('Таблица скопирована — вставьте в Excel'));
  };
  $('aRes').querySelectorAll('tr[data-i]').forEach(tr => (tr.onclick = () => { const r = batch.rows[+tr.dataset.i].r; $('aOne').innerHTML = card(r); bindCard(r); $('aOne').scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }));
}
async function runList(text) {
  const rows = String(text || '').split('\n').map(l => l.trim()).filter(Boolean).map(l => { const [a, ar] = l.split(/[;\t]/); return { addr: a.trim(), area: parseFloat(String(ar || '').replace(',', '.')) || null }; }).filter(x => x.addr).slice(0, 100);
  if (!rows.length) { $('aList').focus(); return; }
  batch = { rows, opt: opts(), stop: false }; busy(true); drawTable();
  for (const x of rows) {
    if (batch.stop || document.body.dataset.mode !== 'addr') { batch.stop = true; break; }
    x.r = await pvz.addrCheck(x.addr, x.area, null, batch.opt).catch(e => ({ ok: false, error: e.message }));
    drawTable();
    await new Promise(r => setTimeout(r, 1200));
  }
  batch.stop = true; busy(false); drawTable(); hist();
}
function setMulti(on) {
  $('aMulti').checked = on; $('aForm').classList.toggle('multi', on);
  $('aQL').textContent = on ? 'Адреса — по одному в строке (до 100)' : 'Адрес';
}
async function hist() {
  const c = await pvz.getCfg(), h = c.addrHistory || [];
  $('aHist').innerHTML = h.length ? h.map((x, i) => `<button class="a-h" data-i="${i}" style="--z:${COLOR(x.zone)}"><i></i><span class="a-ht">${esc((x.found && x.found.text) || x.addr)}</span><span class="muted">${esc(x.zone)}${x.area ? ' · ' + fmtNum(x.area) + ' м²' : ''}${x.sup ? ' · ' + rub(x.sup.total) : ''}</span><span class="muted a-hd">${new Date(x.at).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })}</span></button>`).join('')
    : '<p class="hint">Здесь будут последние проверенные адреса.</p>';
  $('aHist').querySelectorAll('.a-h').forEach(b => (b.onclick = () => { const x = h[+b.dataset.i], r = Object.assign({ ok: true, variants: [] }, x); setMulti(false); $('aQ').value = x.addr; if (x.area) setNum($('aArea'), x.area); else $('aArea').value = ''; $('aRes').innerHTML = card(r) + '<p class="hint" style="margin-top:6px">Сохранённый результат. «Проверить» — проверить заново.</p>'; bindCard(r); }));
}
window.openAddr = (q, go) => {
  document.body.dataset.mode = 'addr'; pvz.nav('welcome');
  hist();
  pvz.getCfg().then(c => { const p = c.addrPlat || {}; $('aPlat').querySelector('[value=yandex]').checked = !!p.yandex; $('aPlat').querySelector('[value=wb]').checked = !!p.wb; });
  if (q) { setMulti(false); $('aQ').value = q; if (go) run(q, numOf($('aArea')) || null); }
  setTimeout(() => $('aQ').focus(), 50);
};
$('aPlat').querySelectorAll('input').forEach(i => (i.onchange = () => pvz.setCfg({ addrPlat: opts() })));
$('aMulti').onchange = () => { setMulti($('aMulti').checked); ($('aMulti').checked ? $('aList') : $('aQ')).focus(); };
$('aForm').onsubmit = e => { e.preventDefault(); if ($('aMulti').checked) runList($('aList').value); else run($('aQ').value, numOf($('aArea')) || null); };
$('homeAddr').onsubmit = e => { e.preventDefault(); const q = $('homeAddrQ').value.trim(); $('homeAddrQ').value = ''; window.openAddr(q, !!q); };
})();
