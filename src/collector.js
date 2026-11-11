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
