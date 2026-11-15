// Проверка оценки числа квартир: node tools/flats_test.js
const assert = require('assert');
const { estimate, around } = require('../src/flats.js');
const lat0 = 55.75, lon0 = 37.6, mLat = 1 / 111320, mLon = 1 / (111320 * Math.cos(lat0 * Math.PI / 180));
const rect = (x, y, w, h) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]].map(([a, b]) => ({ lat: lat0 + b * mLat, lon: lon0 + a * mLon }));
const way = (id, tags, g, nodes) => ({ type: 'way', id, tags, geometry: g, nodes: nodes || [] });
// панельный дом 80×12 м, 9 этажей, в 8 м к северу от точки; рядом киоск вплотную к точке
const house = way(1, { building: 'apartments', 'building:levels': '9' }, rect(-40, 8, 80, 12), [10, 11, 12, 13, 14]);
const kiosk = way(2, { building: 'kiosk' }, rect(1, -3, 3, 3));
let r = estimate([house, kiosk], lat0, lon0);
assert.ok(!r.exact && r.n > 120 && r.n < 160, 'оценка по площади: ' + JSON.stringify(r));
// отмечены 4 подъезда → 9 × 4 × 4
r = estimate([house, kiosk, { type: 'node', id: 10 }, { type: 'node', id: 11 }, { type: 'node', id: 12 }, { type: 'node', id: 13 }], lat0, lon0);
assert.equal(r.n, 144); assert.equal(r.entrances, 4);
// точный тег
r = estimate([way(3, { building: 'apartments', 'building:flats': '216', 'building:levels': '12' }, rect(-20, -5, 40, 15))], lat0, lon0);
assert.deepEqual([r.n, r.exact], [216, true]);
// дом — отношение (мультиполигон)
r = estimate([{ type: 'relation', id: 4, tags: { building: 'residential', 'building:levels': '5' }, members: [{ type: 'way', role: 'outer', geometry: rect(-30, -6, 60, 12) }] }], lat0, lon0);
assert.ok(r.n > 40 && r.n < 70, JSON.stringify(r));
// building=yes с этажностью — оценка с пометкой; офис — нет данных
r = estimate([way(5, { building: 'yes', 'building:levels': '9' }, rect(-20, 2, 40, 14))], lat0, lon0); assert.ok(r.n && r.unsure);
r = estimate([way(6, { building: 'office', 'building:levels': '9' }, rect(-20, 2, 40, 14))], lat0, lon0); assert.equal(r.n, null); assert.ok(/нежилое/.test(r.why));
r = estimate([], lat0, lon0); assert.equal(r.n, null);
// далёкий жилой дом (50 м) не берётся, если рядом своё здание
r = estimate([way(7, { building: 'retail' }, rect(-5, -5, 10, 10)), way(8, { building: 'apartments', 'building:levels': '16' }, rect(-20, 50, 40, 15))], lat0, lon0); assert.equal(r.n, null);
// ---- квартир вокруг (радиус 400 м) ----
const els = [
  way(11, { building: 'apartments', 'building:flats': '200' }, rect(100, 0, 60, 15)),            // точно 200, ~130 м
  way(12, { building: 'residential', 'building:levels': '9' }, rect(-200, 50, 62, 10)),        // ≈ 9 × 620 / 62 = 90
  way(13, { building: 'house' }, rect(0, -150, 10, 10)),                                         // частный дом = 1
  way(14, { building: 'apartments' }, rect(50, 200, 40, 12)),                                    // жилой без этажности — «без данных»
  way(15, { building: 'office', 'building:levels': '12' }, rect(-50, -50, 40, 40)),              // нежилое — не считается
  way(16, { building: 'apartments', 'building:flats': '500' }, rect(600, 0, 60, 15))             // дальше 400 м — не считается
];
r = around(els, lat0, lon0, 400);
assert.equal(r.exact, 200); assert.equal(r.houses, 1); assert.equal(r.unknown, 1); assert.equal(r.buildings, 3);
assert.ok(r.est > 80 && r.est < 100, JSON.stringify(r)); assert.equal(r.n, r.exact + r.est + 1);
// ---- ПВЗ в доме: только внутри контура дома объявления ----
const pt = (id, la, lo, tags) => ({ type: 'node', id, lat: lat0 + la * mLat, lon: lon0 + lo * mLon, tags });
const bld = way(21, { building: 'apartments', 'building:levels': '9' }, rect(-30, -6, 60, 12));
r = estimate([bld, pt(31, 0, 20, { shop: 'outpost', brand: 'Ozon', name: 'Ozon' }), pt(32, 30, 0, { shop: 'outpost', brand: 'Wildberries' })], lat0, lon0);
assert.deepEqual(r.pvz.map(x => x.brand), ['Ozon'], 'WB через дорогу не в доме: ' + JSON.stringify(r.pvz));
r = estimate([bld, pt(33, 2, -10, { amenity: 'parcel_locker', brand: 'Ozon Box' }), pt(34, 1, 5, { shop: 'outpost', name: 'Яндекс Маркет' })], lat0, lon0);
assert.deepEqual(r.pvz.map(x => x.brand + ':' + x.kind), ['Ozon:postamat', 'Яндекс Маркет:pvz']);
r = estimate([bld, pt(35, 0, 0, { shop: 'clothes', name: 'Одежда' })], lat0, lon0); assert.equal(r.pvz.length, 0);
r = estimate([way(22, { building: 'retail', shop: 'outpost', brand: 'Ozon' }, rect(-10, -5, 20, 10))], lat0, lon0); assert.equal(r.pvz[0].brand, 'Ozon');
console.log('FLATS OK');
