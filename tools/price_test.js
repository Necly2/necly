// Проверка разбора страницы объявления (цена / снято): node tools/price_test.js
const assert = require('assert'); const { chromium } = require('playwright');
const { EXTRACT } = require('../src/pricewatch.js');
const cases = [
  ['avito', `<title>Помещение 45 м²</title><span itemprop="price" content="85000">85 000 ₽ в месяц</span>`, { price: 85000, gone: false }],
  ['cian', `<div data-testid="price-amount"><span>120 000 ₽/мес.</span></div>`, { price: 120000, gone: false }],
  ['jsonld', `<script type="application/ld+json">{"@type":"Product","offers":{"@type":"Offer","price":"64500","priceCurrency":"RUB"}}</script><p>Аренда</p>`, { price: 64500, gone: false }],
  ['gone', `<h1>Торговое помещение</h1><p>Объявление снято с публикации</p><span itemprop="price" content="70000"></span>`, { price: 70000, gone: true }],
  ['robot', `<title>Доступ ограничен: проблема с IP</title><p>Подтвердите, что вы не робот</p>`, { blocked: true }],
  ['none', `<p>Просто страница</p>`, { price: null, gone: false }]
];
(async () => {
  const b = await chromium.launch(), pg = await b.newPage();
  for (const [name, html, want] of cases) { await pg.setContent(html); const r = await pg.evaluate(EXTRACT); assert.deepEqual(r, want, name + ': ' + JSON.stringify(r)); }
  await b.close(); console.log('PRICE OK');
})().catch(e => { console.error(e.message); process.exit(1); });
