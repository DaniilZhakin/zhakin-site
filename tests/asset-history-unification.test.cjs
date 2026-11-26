const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const history = require('../assets/js/asset-history-unification.js');

function storageMock(initial) {
  const values = new Map(initial || []);
  return {
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem(key, value) { values.set(key, value); },
    removeItem(key) { values.delete(key); },
    snapshot() { return new Map(values); }
  };
}
function registryRecord(overrides = {}) {
  return {
    id: 'valuation-1', name: 'Склад Север', kind: 'property', method: 'Сравнительный подход',
    value: 1250000, low: 1180000, high: 1320000, currency: 'RUB',
    assessmentDate: '2026-11-20', createdAt: '2026-11-20T10:00:00.000Z', ...overrides
  };
}
function dashboardRecord(overrides = {}) {
  return {
    id: 'dashboard-1', name: 'Бизнес А', type: 'business', method: 'Доходный подход',
    value: 8000000, currency: 'RUB', date: '2026-11-21',
    createdAt: '2026-11-21T10:00:00.000Z', ...overrides
  };
}

test('unified history reads both legacy stores and normalizes them into one schema', () => {
  const storage = storageMock([
    [history.REGISTRY_KEY, JSON.stringify({ schemaVersion: 1, records: [registryRecord()] })],
    [history.DASHBOARD_KEY, JSON.stringify([dashboardRecord()])]
  ]);
  const rows = history.read(storage);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map(row => row.kind).sort(), ['business', 'property']);
  assert.equal(rows.find(row => row.id === 'valuation-1').low, 1180000);
  assert.equal(rows.find(row => row.id === 'dashboard-1').assessmentDate, '2026-11-21');
});

test('unified history writes both compatible stores and retains optional asset kinds', () => {
  const storage = storageMock();
  const rows = [registryRecord(), dashboardRecord({ type: 'other', id: 'other-1', name: 'Прочий актив' })];
  history.write(storage, rows);
  const registry = JSON.parse(storage.getItem(history.REGISTRY_KEY));
  const dashboard = JSON.parse(storage.getItem(history.DASHBOARD_KEY));
  assert.equal(registry.schemaVersion, 1);
  assert.equal(registry.records.length, 2);
  assert.equal(dashboard.length, 2);
  assert.equal(dashboard.find(row => row.id === 'other-1').type, 'other');
  assert.equal(history.read(storage).length, 2);
});

test('unified history deduplicates matching ids but preserves distinct same-day valuation records', () => {
  const first = registryRecord({ id: 'shared-id' });
  const duplicate = {
    id: 'shared-id', name: first.name, type: first.kind, method: first.method,
    value: first.value, currency: first.currency, date: first.assessmentDate,
    createdAt: '2026-11-20T11:00:00.000Z'
  };
  const distinct = { ...duplicate, id: 'separate-assessment', createdAt: '2026-11-20T12:00:00.000Z' };
  const storage = storageMock([
    [history.REGISTRY_KEY, JSON.stringify({ schemaVersion: 1, records: [first] })],
    [history.DASHBOARD_KEY, JSON.stringify([duplicate, distinct])]
  ]);
  const rows = history.read(storage);
  assert.equal(rows.length, 2);
  assert.equal(rows.find(row => row.id === 'shared-id').createdAt, '2026-11-20T11:00:00.000Z');
  assert.equal(rows.find(row => row.id === 'separate-assessment').assessmentDate, '2026-11-20');
});

test('unified history rejects malformed, unsafe and mixed-schema rows', () => {
  const storage = storageMock([
    [history.REGISTRY_KEY, JSON.stringify({ schemaVersion: 1, records: [registryRecord({ value: -1 }), registryRecord({ id: 'bad-date', assessmentDate: '2026-02-30' })] })],
    [history.DASHBOARD_KEY, JSON.stringify([dashboardRecord({ currency: 'XXX' }), dashboardRecord({ id: 'valid' })])]
  ]);
  const rows = history.read(storage);
  assert.deepEqual(rows.map(row => row.id), ['valid']);
});

test('unified write restores both previous keys if the second write fails', () => {
  const originalRegistry = JSON.stringify({ schemaVersion: 1, records: [registryRecord()] });
  const originalDashboard = JSON.stringify([dashboardRecord()]);
  const values = new Map([[history.REGISTRY_KEY, originalRegistry], [history.DASHBOARD_KEY, originalDashboard]]);
  const storage = {
    getItem: key => values.get(key) ?? null,
    setItem(key, value) {
      if (key === history.DASHBOARD_KEY && value !== originalDashboard) throw new Error('quota');
      values.set(key, value);
    },
    removeItem: key => values.delete(key)
  };
  assert.throws(() => history.write(storage, [registryRecord({ id: 'replacement' })]), /браузер отклонил запись/);
  assert.equal(values.get(history.REGISTRY_KEY), originalRegistry);
  assert.equal(values.get(history.DASHBOARD_KEY), originalDashboard);
});

test('remove and clear operate on both stores, and the UI loads the same adapter before either center', () => {
  const storage = storageMock();
  history.write(storage, [registryRecord(), dashboardRecord()]);
  history.remove(storage, 'valuation-1');
  assert.equal(history.read(storage).length, 1);
  history.clear(storage);
  assert.equal(history.read(storage).length, 0);
  const root = path.join(__dirname, '..');
  const valuation = fs.readFileSync(path.join(root, 'centers/asset-valuation/index.html'), 'utf8');
  const dashboard = fs.readFileSync(path.join(root, 'centers/analytical/asset-dashboard.html'), 'utf8');
  assert.ok(valuation.indexOf('asset-history-unification.js') < valuation.indexOf('asset-valuation-registry.js'));
  assert.ok(dashboard.indexOf('asset-history-unification.js') < dashboard.indexOf('analytical-asset-dashboard.js'));
});

test('oversized legacy history is never truncated or rewritten during read', () => {
  const registryRows = Array.from({ length: 125 }, (_, index) =>
    registryRecord({ id: 'registry-' + index, createdAt: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString() }));
  const dashboardRows = Array.from({ length: 125 }, (_, index) =>
    dashboardRecord({ id: 'dashboard-' + index, createdAt: new Date(Date.UTC(2026, 1, 1, 0, index)).toISOString() }));
  const registryRaw = JSON.stringify({ schemaVersion: 1, records: registryRows });
  const dashboardRaw = JSON.stringify(dashboardRows);
  const storage = storageMock([
    [history.REGISTRY_KEY, registryRaw],
    [history.DASHBOARD_KEY, dashboardRaw]
  ]);
  const rows = history.read(storage);
  assert.equal(rows.length, 250);
  assert.equal(storage.getItem(history.REGISTRY_KEY), registryRaw);
  assert.equal(storage.getItem(history.DASHBOARD_KEY), dashboardRaw);
});

test('adding to an oversized legacy history fails safely without changing either store', () => {
  const registryRows = Array.from({ length: 125 }, (_, index) =>
    registryRecord({ id: 'registry-' + index, createdAt: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString() }));
  const dashboardRows = Array.from({ length: 125 }, (_, index) =>
    dashboardRecord({ id: 'dashboard-' + index, createdAt: new Date(Date.UTC(2026, 1, 1, 0, index)).toISOString() }));
  const storage = storageMock([
    [history.REGISTRY_KEY, JSON.stringify({ schemaVersion: 1, records: registryRows })],
    [history.DASHBOARD_KEY, JSON.stringify(dashboardRows)]
  ]);
  const before = storage.snapshot();
  assert.throws(() => history.save(storage, registryRecord({ id: 'new-record' })), /более 200 оценок/);
  assert.deepEqual(storage.snapshot(), before);
});


test('deleting from an oversized legacy history preserves every remaining record in both stores', () => {
  const registryRows = Array.from({ length: 125 }, (_, index) =>
    registryRecord({ id: 'registry-' + index, createdAt: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString() }));
  const dashboardRows = Array.from({ length: 125 }, (_, index) =>
    dashboardRecord({ id: 'dashboard-' + index, createdAt: new Date(Date.UTC(2026, 1, 1, 0, index)).toISOString() }));
  const storage = storageMock([
    [history.REGISTRY_KEY, JSON.stringify({ schemaVersion: 1, records: registryRows })],
    [history.DASHBOARD_KEY, JSON.stringify(dashboardRows)]
  ]);

  const remaining = history.remove(storage, 'registry-0');
  assert.equal(remaining.length, 249);
  assert.equal(history.read(storage).length, 249);
  assert.equal(JSON.parse(storage.getItem(history.REGISTRY_KEY)).records.length, 249);
  assert.equal(JSON.parse(storage.getItem(history.DASHBOARD_KEY)).length, 249);
  assert.equal(history.read(storage).some(row => row.id === 'registry-0'), false);
  assert.equal(history.read(storage).some(row => row.id === 'registry-1'), true);
  assert.equal(history.read(storage).some(row => row.id === 'dashboard-124'), true);
});
