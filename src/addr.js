// PVZ Master — «Поиск по адресу»: проверка одного помещения на карте Ozon только по адресу
// (адрес → точка через поиск карты Ozon → зона, поддержка по ступеням площади, сверка дома).
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
const rub = n => n ? fmtNum(Math.round(n)) + ' ₽' : '—';
const tierTxt = t => `${t[0]}${t[1] ? '–' + t[1] : '+'} м²`;
let last = null;

function card(r) {
  const z = r.zone, pt = r.found || {};
  const sup = r.sup;
  return `<div class="box a-card" style="--z:${COLOR(z)}">
    <div class="a-top"><span class="a-zone"><i></i>${esc(z)}</span><span class="a-ztxt">${esc(ZONE_TXT[z] || '')}</span><span class="grow"></span><span class="muted">${new Date(r.at).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span></div>
    <div class="a-addr"><b>${esc(pt.text || r.addr)}</b>${pt.text && pt.text !== r.addr ? `<span class="muted"> — вы искали: ${esc(r.addr)}</span>` : ''}</div>
    ${r.greenSmall ? `<div class="a-warn">Площадь ${fmtNum(r.area)} м² меньше ${fmtNum(r.greenMin)} м² — для зелёной зоны Ozon помещение не подходит.</div>` : ''}
    ${r.note ? `<div class="a-note">${esc(r.note)}</div>` : ''}
    ${(r.tiers || []).length ? `<div class="a-sup">${sup ? `<div class="a-big">${r.area ? `Для ${fmtNum(r.area)} м² (${esc(sup.note)})` : ''}: <b>${rub(sup.month)}</b> в месяц · <b>${rub(sup.total)}</b> всего</div>` : r.area ? '' : '<div class="hint">Укажите площадь — покажу поддержку для неё.</div>'}
      <table class="a-tiers"><tr><th>Площадь</th><th>В месяц</th><th>Всего</th></tr>${r.tiers.map(t => `<tr class="${sup && sup.note === tierTxt(t) ? 'on' : ''}"><td>${tierTxt(t)}</td><td>${rub(t[2])}</td><td>${rub(t[3])}</td></tr>`).join('')}</table></div>` : ''}
    <div class="a-acts">
      <button class="ghost sm" id="aYa">Яндекс.Карты ↗</button>
      <button class="ghost sm" id="aOz">Карта Ozon ↗</button>
      <button class="ghost sm" id="aStar">★ В отслеживаемые</button>
      <button class="ghost sm" id="aCopy">Скопировать</button>
      ${pt.lat != null ? `<span class="muted a-c">${pt.lat.toFixed(6)}, ${pt.lon.toFixed(6)}</span>` : ''}
    </div>
    ${(r.variants || []).length > 1 ? `<details class="fold a-var"><summary>Не тот дом? Варианты Ozon</summary>${r.variants.map((v, i) => `<button class="ghost sm" data-v="${i}">${esc(v.text)}</button>`).join('')}</details>` : ''}
  </div>`;
}
function bindCard(r) {
  const pt = r.found || {};
  $('aYa').onclick = () => pvz.openExternal(pt.lat != null ? `https://yandex.ru/maps/?pt=${pt.lon},${pt.lat}&z=17&l=map` : 'https://yandex.ru/maps/?text=' + encodeURIComponent(r.addr));
  $('aOz').onclick = () => { navigator.clipboard && navigator.clipboard.writeText(pt.text || r.addr).catch(() => {}); pvz.openExternal('https://pvz-map.ozon.ru/'); toast('Адрес скопирован — вставьте в поиск карты Ozon'); };
  $('aCopy').onclick = () => { const t = `${pt.text || r.addr}\nOzon: ${r.zone}${r.sup ? `, поддержка ${rub(r.sup.month)}/мес, всего ${rub(r.sup.total)} (${r.sup.note})` : ''}${r.note ? '\n' + r.note : ''}`; navigator.clipboard.writeText(t).then(() => toast('Скопировано')); };
  $('aStar').onclick = async () => {
    const c = await pvz.getCfg(), w = c.resWatch || {}, del = c.resWatchDel || {};
    const row = { platform: 'Ozon', zone: r.zone, note: r.note || '', address: pt.text || r.addr, metro: '', areaMin: r.area, areaMax: null, price: null, money: null,
      supMonth: r.sup ? r.sup.month : null, supTotal: r.sup ? r.sup.total : null, supTier: r.sup ? r.sup.note : '', source: 'Поиск по адресу', date: '', url: '',
      lat: pt.lat ?? null, lon: pt.lon ?? null, file: 'Поиск по адресу', filePath: '', checked: r.at, exported: r.at, job: '' };
    const k = 'Ozon|' + row.address;
    w[k] = { added: Date.now(), row }; delete del[k];
    await pvz.setCfg({ resWatch: w, resWatchDel: del }); toast('★ Добавлено в отслеживаемые');
  };
  document.querySelectorAll('.a-var [data-v]').forEach(b => (b.onclick = () => run(r.addr, r.area, r.variants[+b.dataset.v])));
}
async function run(q, area, pick) {
  q = String(q || '').trim(); if (!q) { $('aQ').focus(); return; }
  $('aQ').value = q; if (area) setNum($('aArea'), area);
  $('aGo').disabled = true; $('aGo').textContent = 'Проверяю…';
  $('aRes').innerHTML = `<div class="box a-wait"><div class="bar ind"><i></i></div>Ищу адрес на карте Ozon и проверяю зону… обычно 10–30 секунд.</div>`;
  const r = await pvz.addrCheck(q, area || null, pick || null).catch(e => ({ ok: false, error: e.message }));
  $('aGo').disabled = false; $('aGo').textContent = 'Проверить';
  if (!r.ok) {
    $('aRes').innerHTML = `<div class="box a-card err"><b>Не удалось проверить</b><div>${esc(r.error || 'ошибка')}</div>${(r.variants || []).length ? `<details class="fold a-var" open><summary>Варианты адреса</summary>${r.variants.map((v, i) => `<button class="ghost sm" data-v="${i}">${esc(v.text)}</button>`).join('')}</details>` : ''}</div>`;
    document.querySelectorAll('.a-var [data-v]').forEach(b => (b.onclick = () => run(q, area, r.variants[+b.dataset.v])));
    return;
  }
  last = r; $('aRes').innerHTML = card(r); bindCard(r); hist();
}
async function hist() {
  const c = await pvz.getCfg(), h = c.addrHistory || [];
  $('aHist').innerHTML = h.length ? h.map((x, i) => `<button class="a-h" data-i="${i}" style="--z:${COLOR(x.zone)}"><i></i><span class="a-ht">${esc((x.found && x.found.text) || x.addr)}</span><span class="muted">${esc(x.zone)}${x.area ? ' · ' + fmtNum(x.area) + ' м²' : ''}${x.sup ? ' · ' + rub(x.sup.total) : ''}</span><span class="muted a-hd">${new Date(x.at).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })}</span></button>`).join('')
    : '<p class="hint">Здесь будут последние проверенные адреса.</p>';
  $('aHist').querySelectorAll('.a-h').forEach(b => (b.onclick = () => { const x = h[+b.dataset.i]; last = Object.assign({ ok: true, variants: [] }, x); $('aQ').value = x.addr; if (x.area) setNum($('aArea'), x.area); else $('aArea').value = ''; $('aRes').innerHTML = card(last) + '<p class="hint" style="margin-top:6px">Сохранённый результат. «Проверить» — проверить заново.</p>'; bindCard(last); }));
}
window.openAddr = (q, go) => {
  document.body.dataset.mode = 'addr'; pvz.nav('welcome');
  hist();
  if (q) { $('aQ').value = q; if (go) run(q, numOf($('aArea')) || null); }
  setTimeout(() => $('aQ').focus(), 50);
};
$('aForm').onsubmit = e => { e.preventDefault(); run($('aQ').value, numOf($('aArea')) || null); };
$('homeAddr').onsubmit = e => { e.preventDefault(); const q = $('homeAddrQ').value.trim(); $('homeAddrQ').value = ''; window.openAddr(q, !!q); };
})();
