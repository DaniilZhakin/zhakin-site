const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const dashboard = require('../assets/js/analytical-asset-dashboard.js');

function storageMock(initial) {
  const map = new Map(initial || []);
  return {
    getItem: key => map.has(key) ? map.get(key) : null,
    setItem: (key, value) => map.set(key, value),
    removeItem: key => map.delete(key)
  };
}
function record(overrides = {}) {
  return dashboard.createRecord({
    name: 'Актив А', type: 'business', date: '2026-11-20',
    value: 1000000, currency: 'RUB', method: 'Доходный подход', ...overrides
  }, Date.parse('2026-11-20T12:00:00Z'));
}

test('dashboard records only compact valuation results and validates all key fields', () => {
  const item = record({ name: '  Актив   А  ' });
  assert.equal(item.name, 'Актив А');
  assert.equal(item.value, 1000000);
  assert.deepEqual(Object.keys(item).sort(), ['createdAt','currency','date','id','method','name','type','value'].sort());
  assert.throws(() => record({ name: ' ' }), /название актива/);
  assert.throws(() => record({ type: 'unknown' }), /тип актива/);
  assert.throws(() => record({ currency: 'GBP' }), /валюту/);
  assert.throws(() => record({ date: '2026-02-30' }), /дату/);
  assert.throws(() => record({ value: 0 }), /Стоимость/);
  assert.throws(() => record({ value: 1e16 }), /Стоимость/);
});

test('dashboard persists local records and rejects tampered or malformed rows', () => {
  const storage = storageMock();
  const first = record();
  dashboard.writeRecords(storage, [first]);
  assert.equal(dashboard.readRecords(storage).length, 1);
  storage.setItem(dashboard.STORAGE_KEY, JSON.stringify([first, { ...first, value: -1 }]));
  assert.equal(dashboard.readRecords(storage).length, 1);
  assert.equal(JSON.parse(storage.getItem(dashboard.STORAGE_KEY)).length, 1);
  storage.setItem(dashboard.STORAGE_KEY, '{broken');
  assert.deepEqual(dashboard.readRecords(storage), []);
});

test('dashboard groups asset history by normalized name and picks latest valuation date', () => {
  const old = record({ date: '2026-10-01', value: 800000 });
  const latest = record({ date: '2026-11-20', value: 1000000 });
  const second = record({ name: 'Актив Б', value: 500000 });
  const grouped = dashboard.groupLatest([old, latest, second]);
  assert.equal(grouped.length, 2);
  assert.equal(grouped.find(row => row.name === 'Актив А').value, 1000000);
});

test('dashboard caps stored history to 200 records', () => {
  const storage = storageMock();
  const rows = Array.from({ length: 205 }, (_, index) => record({ name: 'Актив ' + index }));
  const saved = dashboard.writeRecords(storage, rows);
  assert.equal(saved.length, 200);
  assert.equal(dashboard.readRecords(storage).length, 200);
});

test('dashboard UI is linked from the Analytical Center and discloses local-only storage', () => {
  const root = path.join(__dirname, '..');
  const page = fs.readFileSync(path.join(root, 'centers/analytical/asset-dashboard.html'), 'utf8');
  const index = fs.readFileSync(path.join(root, 'centers/analytical/index.html'), 'utf8');
  const workflow = fs.readFileSync(path.join(root, '.github/workflows/asset-valuation-calculator.yml'), 'utf8');
  const sitemap = fs.readFileSync(path.join(root, 'sitemap.xml'), 'utf8');
  assert.match(page, /id="asset-history-form"/);
  assert.match(page, /id="asset-history-list"/);
  assert.match(page, /id="asset-trend-chart"/);
  assert.match(page, /id="asset-history-chart"/);
  assert.match(page, /не отправляются на сервер/);
  assert.match(page, /Не вводите коммерческую тайну/);
  assert.match(index, /asset-dashboard\.html/);
  assert.ok(sitemap.includes('https://xn--80alhhq.xn--p1ai/centers/analytical/asset-dashboard.html'));
  assert.match(workflow, /analytical-asset-dashboard\.test\.cjs/);
});

test('dashboard comparison code prevents mixed-currency comparisons and limits selection to four assets', () => {
  const source = fs.readFileSync(path.join(__dirname, '../assets/js/analytical-asset-dashboard.js'), 'utf8');
  assert.match(source, /new Set\(latest\.map\(row => row\.currency\)\)\.size > 1/);
  assert.match(source, /checked\.length > 4/);
  assert.match(source, /new Set\(points\.map\(row => row\.currency\)\)\.size > 1/);
});

test('dashboard exposes a safe shared API for the Analytical Center handoff', () => {
  assert.equal(globalThis.ZhakinAssetDashboard, dashboard);
  const index = fs.readFileSync(path.join(__dirname, '../centers/analytical/index.html'), 'utf8');
  assert.match(index, /assets\/js\/analytical-asset-dashboard\.js/);
  assert.match(index, /data-valuation-asset-name/);
  assert.match(index, /data-save-valuation-brief/);
  assert.match(index, /asset-dashboard\.html/);
});

test('record validation strips unexpected fields and separates asset types with identical labels', () => {
  const item = record({ name: 'Актив А' });
  const storage = storageMock();
  storage.setItem(dashboard.STORAGE_KEY, JSON.stringify([{ ...item, secret: 'must-not-persist' }]));
  const restored = dashboard.readRecords(storage);
  assert.equal(Object.hasOwn(restored[0], 'secret'), false);
  assert.equal(JSON.stringify(restored).includes('must-not-persist'), false);
  assert.equal(JSON.stringify(JSON.parse(storage.getItem(dashboard.STORAGE_KEY))).includes('must-not-persist'), false);
  const property = record({ type: 'property', value: 2500000 });
  assert.equal(dashboard.groupLatest([item, property]).length, 2);
});
