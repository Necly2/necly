// Функция выполняется ВНУТРИ страницы Авито (передаётся строкой через executeJavaScript).
// Проходит по страницам текущего поиска и возвращает строки в формате Baza Winner.
async function collector(C) {
  window.__pvzStop = false;
  const P = t => (window.__pvzProg = t);
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const base = new URL(location.href);
  base.searchParams.delete('p'); base.searchParams.delete('context');
  const today = new Date();
  const fmt = d => `${String(d.getDate()).padStart(2,'0')}.${String(d.getMonth()+1).padStart(2,'0')}.${d.getFullYear()}`;
  const num = s => { const m = String(s || '').replace(/[\s ]/g, '').replace(',', '.').match(/\d+(\.\d+)?/); return m ? parseFloat(m[0]) : null; };
  const MONTHS = {января:0,февраля:1,марта:2,апреля:3,мая:4,июня:5,июля:6,августа:7,сентября:8,октября:9,ноября:10,декабря:11};

  function parseDate(t) {
    t = (t || '').toLowerCase().trim();
    const d = new Date(today); let m;
    if (/минут|час|только что|сегодня/.test(t)) return d;
    if (/вчера/.test(t)) { d.setDate(d.getDate() - 1); return d; }
    if ((m = t.match(/(\d+)\s*(дн|день|дня)/))) { d.setDate(d.getDate() - +m[1]); return d; }
    if ((m = t.match(/(\d+)\s*недел/))) { d.setDate(d.getDate() - 7 * +m[1]); return d; }
    if (/неделю назад/.test(t)) { d.setDate(d.getDate() - 7); return d; }
    if ((m = t.match(/(\d+)\s*месяц/)) || /месяц назад/.test(t)) { d.setMonth(d.getMonth() - (m ? +m[1] : 1)); return d; }
    if ((m = t.match(/(\d{1,2})\s+([а-я]+)(?:\s+(\d{4}))?/)) && MONTHS[m[2]] !== undefined) {
      const r = new Date(m[3] ? +m[3] : today.getFullYear(), MONTHS[m[2]], +m[1]);
      if (r > today) r.setFullYear(r.getFullYear() - 1);
      return r;
    }
    return null;
  }

  function coordsMap(html) {
    const map = {}; const re = /"coords":\{"lat":"?([\d.]+)"?,"lng":"?([\d.]+)"?/g; let m;
    while ((m = re.exec(html))) {
      const back = html.slice(Math.max(0, m.index - 6000), m.index);
      const ids = [...back.matchAll(/"id":(\d{8,12})[,}]/g)];
      if (ids.length) { const id = ids[ids.length - 1][1]; if (!map[id]) map[id] = (+m[1]).toFixed(5) + ',' + (+m[2]).toFixed(5); }
    }
    return map;
  }

  function parsePage(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const cm = coordsMap(html);
    return [...doc.querySelectorAll('[data-marker="item"]')].map(el => {
      const id = el.dataset.itemId || (el.id || '').replace(/\D/g, '');
      const q = s => el.querySelector(s);
      const title = (q('[itemprop="name"]') || q('[data-marker="item-title"]'))?.textContent.trim() || '';
      const a = q('a[data-marker="item-title"]');
      const href = a ? new URL(a.getAttribute('href'), location.origin).href.split('?')[0] : '';
      const priceTxt = (q('[data-marker="item-price"]')?.textContent || '').replace(/\s+/g, ' ').trim();
      const ad = q('[data-marker="item-address"]');
      const leaves = ad ? [...ad.querySelectorAll('p, span, div')].filter(x => !x.children.length).map(x => x.textContent.trim()).filter(Boolean) : [];
      const uniq = [...new Set(leaves)];
      let address = uniq[0] || (ad ? ad.textContent.trim() : ''), metro = '', fromSt = '';
      const metroLine = uniq.slice(1).join(', ');
      if (metroLine) { const p = metroLine.split(','); metro = p[0].trim(); fromSt = p.slice(1).join(',').trim(); }
      const dateTxt = q('[data-marker="item-date"]')?.textContent.trim() || '';
      const area = num((title.match(/([\d\s.,]+)\s*м²/) || [])[1]);
      let price = num(priceTxt); const low = priceTxt.toLowerCase();
      if (price != null) {
        if (/за м²/.test(low) && area) price *= area;
        if (/в год/.test(low)) price /= 12;
        price = Math.round(price);
      }
      return { id, online: /онлайн-показ/i.test(el.textContent) ? 'Онлайн-показ' : '', obj: title.split(',')[0].trim(),
               metro, fromSt, address, area, price, per: /сутки|в день/.test(low) ? 'в сутки' : 'в мес.', dateTxt, href, coords: cm[id] || '' };
    }).filter(r => r.id);
  }

  const all = new Map(); let page = 1, emptyRow = 0, reason = 'достигнут лимит страниц';
  while (page <= C.pages) {
    if (window.__pvzStop) { reason = 'остановлено вручную'; break; }
    P(`Страница ${page} из максимум ${C.pages}\nСобрано: ${all.size}`);
    const u = new URL(base); if (page > 1) u.searchParams.set('p', page);
    let res, html;
    try { res = await fetch(u.href, { credentials: 'include' }); html = await res.text(); }
    catch (e) { reason = 'ошибка сети'; break; }
    if (res.status !== 200) {
      reason = res.status === 404 ? 'выдача закончилась' : `Авито ответил ${res.status} — возможно, проверка на робота: обновите страницу, пройдите проверку и повторите позже`; break;
    }
    const doc0 = new DOMParser().parseFromString(html, 'text/html');
    const hasItems = !!doc0.querySelector('[data-marker="item"]');
    if (!hasItems && /Доступ ограничен|проблема с IP|Подтвердите, что вы не робот/i.test((doc0.title || '') + ' ' + (doc0.querySelector('h1,h2')?.textContent || ''))) {
      reason = 'Авито показал проверку на робота — обновите страницу, пройдите проверку и повторите позже'; break;
    }
    if (page === 1) {   // всего объявлений по поиску → сколько страниц реально есть
      const tot = num(doc0.querySelector('[data-marker="page-title/count"]')?.textContent || ((doc0.querySelector('h1')?.textContent || '').trim().match(/(\d[\d\s\u00a0]*)$/) || [])[1]);
      if (tot) { const need = Math.ceil(tot / 50); if (need < C.pages) C.pages = need; }
    }
    const items = parsePage(html); let added = 0;
    for (const it of items) {
      if (C.days) { const d = parseDate(it.dateTxt); if (d && (today - d) / 864e5 > C.days + 0.5) continue; }
      if (!all.has(it.id)) { all.set(it.id, it); added++; }
    }
    if (!items.length) { reason = 'выдача закончилась'; break; }
    if (!added) { if (++emptyRow >= 2) { reason = 'новых объявлений нет 2 страницы подряд'; break; } } else emptyRow = 0;
    page++;
    if (page <= C.pages) {
      for (let s = C.delay; s > 0 && !window.__pvzStop; s--) { P(`Пауза ${s} с… (следующая стр. ${page})\nСобрано: ${all.size}`); await sleep(1000); }
    }
  }
  const list = [...all.values()];
  const rows = list.map(r => {
    const d = parseDate(r.dateTxt);
    return [r.online, r.obj, r.metro, r.fromSt, r.address, r.area ?? '', r.area ?? '', r.price ?? '', r.per,
            d ? fmt(d) : r.dateTxt, d ? Math.max(0, Math.round((today - d) / 864e5)) : '', 'Авито', r.href, r.coords];
  });
  window.__pvzProg = '';
  return { rows, reason, withCoords: list.filter(r => r.coords).length };
}
module.exports = { collector };

// ================= ЦИАН =================
// Выполняется внутри страницы cian.ru. Проходит по страницам текущего поиска (&p=N),
// данные берёт из состояния страницы (initialState.results.offers): координаты, этаж, площадь.
// Если объявлений больше, чем Циан отдаёт (54 стр. × 28), делит поиск по площади.
async function cianCollector(C) {
  window.__pvzStop = false;
  const P = t => (window.__pvzProg = t);
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const seen = new Set((C.seen || []).map(String));
  const today = new Date();
  const fmt = d => `${String(d.getDate()).padStart(2,'0')}.${String(d.getMonth()+1).padStart(2,'0')}.${d.getFullYear()}`;
  const MAX_PAGES_SITE = 54, PER_PAGE = 28;
  let pagesDone = 0, stopReason = '';

  function stateFromHtml(html) {
    const re = /_cianConfig\['([^']*serp[^']*)'\]\s*=\s*\(window\._cianConfig\['[^']*'\]\s*\|\|\s*\[\]\)\.concat\(/g;
    let m;
    while ((m = re.exec(html))) {
      const start = m.index + m[0].length;
      const end = html.indexOf('</script>', start);
      let body = html.slice(start, end).trim().replace(/\);?\s*$/, '');
      try {
        const arr = JSON.parse(body);
        const st = arr.find(e => e.key === 'initialState');
        if (st && st.value && st.value.results) return st.value;
      } catch (e) {}
    }
    return null;
  }

  async function getPage(url) {
    const r = await fetch(url, { credentials: 'include' });
    const html = await r.text();
    if (r.status !== 200) return { err: `Циан ответил ${r.status}` };
    const st = stateFromHtml(html);
    if (!st) {
      if (/captcha|Подтвердите, что вы не робот|Доступ ограничен/i.test(html.slice(0, 50000))) return { err: 'Циан показал проверку на робота — пройдите её в окне справа и повторите позже' };
      return { err: 'не удалось прочитать страницу Циана (возможно, это не страница выдачи)' };
    }
    return { st };
  }

  const pageUrl = (base, p) => { const u = new URL(base); u.searchParams.delete('p'); if (p > 1) u.searchParams.set('p', p); return u.href; };

  // фильтры текущего поиска — для отсева платных объявлений, которые их нарушают
  function rangeOf(jq, k) { const v = jq && jq[k] && jq[k].value; return v ? { gte: v.gte, lte: v.lte } : null; }
  function passes(o, jq) {
    const ar = rangeOf(jq, 'total_area'), fl = rangeOf(jq, 'floor'), fn = rangeOf(jq, 'floorn');
    const tot = parseFloat(o.totalArea) || 0, mn = parseFloat(o.minArea) || tot;
    if (ar) { if (ar.gte != null && tot < ar.gte) return false; if (ar.lte != null && mn > ar.lte) return false; }
    if (fl && o.floorNumber != null) { if (fl.gte != null && o.floorNumber < fl.gte) return false; if (fl.lte != null && o.floorNumber > fl.lte) return false; }
    const fc = o.building && o.building.floorsCount;
    if (fn && fc != null) { if (fn.gte != null && fc < fn.gte) return false; if (fn.lte != null && fc > fn.lte) return false; }
    return true;
  }

  const OBJ = { freeAppointment: 'ПСН', shoppingArea: 'торг.площадь', publicCatering: 'общепит', domesticServices: 'быт.услуги',
    office: 'офис', warehouse: 'склад', building: 'здание', industry: 'производство', business: 'готовый бизнес', garage: 'гараж', commercialLand: 'участок' };

  function toRow(o) {
    const g = o.geo || {};
    const und = (g.undergrounds || []).find(u => u.isDefault) || (g.undergrounds || [])[0];
    const metro = und ? und.name + ' м.' : '';
    const fromSt = und && und.time ? und.time + (und.transportType === 'walk' ? 'п' : 'т') : '';
    const address = String(g.userInput || '').replace(/^Россия,\s*/, '').replace(/^Москва,\s*/, '');
    const tot = parseFloat(o.totalArea) || null, mn = parseFloat(o.minArea) || tot;
    const bt = o.bargainTerms || {};
    let price = bt.priceRur != null ? +bt.priceRur : (bt.price != null ? +bt.price : null);
    if (price != null) {
      if (bt.priceType === 'squareMeter' && tot) price *= tot;
      if (bt.paymentPeriod === 'annual') price /= 12;
      price = Math.round(price);
    }
    const d = o.addedTimestamp ? new Date(o.addedTimestamp * 1000) : null;
    const c = g.coordinates;
    const cat = String(o.category || '');
    const objType = (Object.keys(OBJ).find(k => cat.startsWith(k)) && OBJ[Object.keys(OBJ).find(k => cat.startsWith(k))]) ||
      OBJ[o.officeType] || (o.officeType === 'floorSpace' ? 'торг.площадь' : o.officeType) || cat;
    return [o.isOnlineShow || o.onlineShow ? 'Онлайн-показ' : '', objType,
      metro, fromSt, address, mn ?? '', tot ?? '', price ?? '', 'в мес.',
      d ? fmt(d) : (o.added || ''), d ? Math.max(0, Math.round((today - d) / 864e5)) : '', 'Циан',
      String(o.fullUrl || '').split('?')[0], c ? (+c.lat).toFixed(5) + ',' + (+c.lng).toFixed(5) : ''];
  }

  const all = new Map(); let skippedSeen = 0, skippedFilter = 0, skippedOld = 0;

  async function crawl(base, label) {
    const lim = Math.min(C.pages, MAX_PAGES_SITE);
    let jq = null, total = 0;
    for (let p = 1; p <= lim; p++) {
      if (window.__pvzStop) { stopReason = 'остановлено вручную'; return; }
      P(`${label}страница ${p}${total ? ' из ' + Math.ceil(total / PER_PAGE) : ''}\nСобрано: ${all.size}`);
      const { st, err } = await getPage(pageUrl(base, p)); pagesDone++;
      if (err) { stopReason = err; return; }
      const res = st.results; jq = jq || res.jsonQuery; total = res.totalOffers || total;
      const offers = res.offers || [];
      if (!offers.length) return;
      let fresh = 0, regular = 0, oldOnPage = 0;
      for (const o of offers) {
        const id = String(o.cianId || o.id);
        const paid = o.isTop3 || o.isPremium || o.isAuction || o.isPaid;
        const isOld = C.days && o.addedTimestamp && (Date.now() / 1000 - o.addedTimestamp) / 86400 > C.days + 0.5;
        if (!paid) { regular++; if (isOld) oldOnPage++; }
        if (all.has(id)) continue;
        if (seen.has(id)) { skippedSeen++; continue; }
        if (!passes(o, jq)) { skippedFilter++; continue; }
        if (isOld) { skippedOld++; continue; }
        all.set(id, o); fresh++;
      }
      if (p >= Math.ceil(total / PER_PAGE)) return;
      // при сортировке по дате: вся страница старше N дней — дальше только старее
      if (sortedByDate && regular && oldOnPage === regular) return;
      for (let s = C.delay; s > 0 && !window.__pvzStop; s--) { P(`${label}пауза ${s} с (след. стр. ${p + 1})\nСобрано: ${all.size}`); await sleep(1000); }
    }
  }

  // сколько объявлений в поиске; если больше, чем отдаёт Циан, — делим по площади
  async function plan(base, depth) {
    P(`Считаю объявления… (часть ${depth})`);
    const { st, err } = await getPage(pageUrl(base, 1)); pagesDone++;
    if (err) { stopReason = err; return []; }
    const total = st.results.totalOffers || 0;
    const u = new URL(base);
    const lo = +(u.searchParams.get('minarea') || 1), hi = +(u.searchParams.get('maxarea') || 5000);
    if (total <= MAX_PAGES_SITE * PER_PAGE || depth >= 5 || hi - lo < 2) return [{ base, total, lo, hi }];
    await sleep(C.delay * 1000);
    const mid = Math.floor((lo + hi) / 2);
    const a = new URL(base); a.searchParams.set('minarea', lo); a.searchParams.set('maxarea', mid);
    const b = new URL(base); b.searchParams.set('minarea', mid + 1); b.searchParams.set('maxarea', hi);
    const pa = await plan(a.href, depth + 1); if (stopReason) return pa;
    await sleep(C.delay * 1000);
    return pa.concat(await plan(b.href, depth + 1));
  }

  const base = location.href;
  const sortedByDate = /sort=creation_date_desc/.test(base);
  const parts = await plan(base, 1);
  for (let i = 0; i < parts.length && !stopReason; i++) {
    const pt = parts[i];
    const label = parts.length > 1 ? `Часть ${i + 1}/${parts.length} (${pt.lo}–${pt.hi} м², ${pt.total} шт.): ` : '';
    await sleep(C.delay * 1000);
    await crawl(pt.base, label);
  }
  if (!stopReason) stopReason = 'выдача пройдена' + (parts.length > 1 ? ` (поиск разбит по площади на ${parts.length} части)` : '') +
    (parts.some(p => Math.ceil(p.total / PER_PAGE) > C.pages) ? `; часть страниц не пройдена — лимит «Страниц максимум» = ${C.pages}` : '');

  const list = [...all.values()];
  window.__pvzProg = '';
  return {
    rows: list.map(toRow), ids: list.map(o => String(o.cianId || o.id)), reason: stopReason,
    withCoords: list.filter(o => o.geo && o.geo.coordinates).length,
    extra: `Пропущено: уже выгружались ${skippedSeen}, не подходят под фильтры (платные) ${skippedFilter}, старше ${C.days || '∞'} дн. ${skippedOld}. Страниц: ${pagesDone}.`
  };
}
module.exports.cianCollector = cianCollector;
