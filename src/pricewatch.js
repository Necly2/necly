// Слежение за отслеживаемыми объявлениями: раз в сутки открывает страницу объявления в скрытом окне
// и смотрит — изменилась ли цена и не снято ли объявление. Результат — в записи отслеживаемого: pc = { price, was, at, changedAt, gone, seen }.
// Запросы редкие (по одному объявлению раз в ~25 с, не больше 15 за проход), при проверке на робота проход по этому сайту прекращается.
const { BrowserWindow } = (() => { try { return require('electron'); } catch { return {}; } })();

// выполняется в странице объявления → { price, gone, blocked }
const EXTRACT = `(() => {
  const txt = (document.body ? document.body.innerText : '').slice(0, 20000), head = (document.title + ' ' + txt.slice(0, 600));
  if (/captcha|не робот|доступ ограничен|проблема с ip|подозрительная активность|access denied/i.test(head)) return { blocked: true };
  const num = v => { const m = String(v == null ? '' : v).replace(/[\\s\\u00a0\\u202f]/g, '').replace(',', '.').match(/\\d+(\\.\\d+)?/); return m ? Math.round(parseFloat(m[0])) : null; };
  const gone = /снято с публикации|объявление снято|объявление неактуально|объявление удалено|объявление не найдено|истёк срок размещения|больше не актуально|объект снят|в архиве/i.test(txt.slice(0, 4000));
  let price = null;
  const tryEl = sel => { if (price) return; const e = document.querySelector(sel); if (e) price = num(e.getAttribute('content') || e.getAttribute('value') || e.textContent); };
  ['[itemprop="price"]', 'meta[property="product:price:amount"]', '[data-marker="item-view/item-price"]', '[data-testid="price-amount"]', '[data-name="PriceInfo"] [class*="amount" i]', '[class*="price-value" i]', '[class*="item-price" i]'].forEach(tryEl);
  if (!price) for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
    try { const walk = o => { if (!o || price) return; if (Array.isArray(o)) return o.forEach(walk); if (typeof o === 'object') { if (o.offers) walk(o.offers); if (o.price != null && num(o.price)) price = num(o.price); else if (o.lowPrice != null) price = num(o.lowPrice); Object.values(o).forEach(v => { if (v && typeof v === 'object') walk(v); }); } }; walk(JSON.parse(s.textContent)); } catch (e) {}
  }
  if (price !== null && price < 500) price = null;
  return { price, gone };
})()`;

function create(d) {
  // d: { loadCfg, saveCfg, busy(), notify(title, text), log(msg), changed() }
  let win = null, active = false;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  async function checkOne(url) {
    if (!win || win.isDestroyed()) win = new BrowserWindow({ show: false, width: 1280, height: 900, webPreferences: { partition: 'persist:avito', backgroundThrottling: false } });
    const wc = win.webContents; let code = 0;
    const onNav = (_e, _u, c) => { code = c; }; wc.on('did-navigate', onNav);
    try {
      await Promise.race([wc.loadURL(url).catch(() => {}), sleep(25000)]);
      if (code === 404 || code === 410) return { gone: true, price: null };
      if (code === 403 || code === 429) return { blocked: true };
      let r = null;
      for (let i = 0; i < 4; i++) { await sleep(1500); r = await wc.executeJavaScript(EXTRACT, true).catch(() => null); if (r && (r.blocked || r.gone || r.price)) break; }
      return r;
    } finally { wc.removeListener('did-navigate', onNav); wc.loadURL('about:blank').catch(() => {}); }
  }
  const hostOf = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
  // opt.force — проверить все сейчас (кнопка в настройках), иначе только те, что не проверялись сутки
  async function run(opt = {}) {
    if (active || d.busy()) return { skipped: true };
    const c0 = d.loadCfg(); if (c0.priceWatch === false && !opt.force) return { off: true };
    const todo = Object.entries(c0.resWatch || {}).filter(([, w]) => w.row && /^https?:/.test(w.row.url || '') && !(w.pc && w.pc.gone) && (opt.force || !w.pc || Date.now() - (w.pc.at || 0) > 23 * 3600e3))
      .sort((a, b) => ((a[1].pc || {}).at || 0) - ((b[1].pc || {}).at || 0)).slice(0, opt.force ? 40 : 15);
    if (!todo.length) return { checked: 0 };
    active = true; const blocked = new Set(); let checked = 0, down = 0, up = 0, gone = 0;
    try {
      for (const [k, w] of todo) {
        if (d.busy()) break;
        const host = hostOf(w.row.url); if (blocked.has(host)) continue;
        const r = await checkOne(w.row.url).catch(() => null);
        if (r && r.blocked) { blocked.add(host); d.log(`цены: ${host} показал проверку на робота — пропускаю до следующего раза`); continue; }
        if (r && (r.gone || r.price)) {
          const c = d.loadCfg(), cur = (c.resWatch || {})[k]; if (!cur) continue;   // убрали из отслеживаемых, пока шла проверка
          const pc = Object.assign({}, cur.pc), now = Date.now(); let ch = false;
          if (r.gone) { pc.gone = true; pc.changedAt = now; pc.seen = false; gone++; ch = true; }
          else if (pc.price && r.price !== pc.price) { pc.was = pc.price; pc.price = r.price; pc.changedAt = now; pc.seen = false; ch = true; if (r.price < pc.was) down++; else up++; }
          else if (!pc.price) pc.price = r.price;
          pc.at = now; cur.pc = pc; if (ch) cur.upd = now;
          d.saveCfg(c); checked++;
        }
        await sleep(20000 + Math.random() * 10000);
      }
    } finally { active = false; if (win && !win.isDestroyed()) { win.destroy(); win = null; } }
    if (down || up || gone) {
      d.notify('PVZ Master — изменения в отслеживаемых', [down ? `подешевело: ${down}` : '', up ? `подорожало: ${up}` : '', gone ? `снято: ${gone}` : ''].filter(Boolean).join(' · '));
      d.changed();
    }
    d.log(`цены: проверено ${checked} из ${todo.length}; дешевле ${down}, дороже ${up}, снято ${gone}`);
    return { checked, down, up, gone, blocked: [...blocked] };
  }
  let timer = null;
  const start = () => { clearInterval(timer); timer = setInterval(() => run().catch(() => {}), 3 * 3600e3); setTimeout(() => run().catch(() => {}), 5 * 60e3); };
  return { run, start, isActive: () => active };
}
module.exports = { create, EXTRACT };
