// Проверка оценки числа квартир: node tools/flats_test.js
const assert = require('assert');
const { estimate } = require('../src/flats.js');
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
console.log('FLATS OK');
