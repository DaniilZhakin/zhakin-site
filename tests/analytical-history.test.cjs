const test = require('node:test');
const assert = require('node:assert/strict');
const { mergeHistory } = require('../scripts/append-analytical-history.cjs');

const row = (overrides = {}) => ({
  series_key: 'RUB/USD', value: 80, unit: 'RUB_per_1_USD', geography: 'currency_pair',
  reference_period: '2026-11-20', source_release_date: '2026-11-20',
  retrieved_at: '2026-11-20T13:00:00.000Z', revision_status: 'source_published',
  validation_status: 'validated', source: { name: 'Bank of Russia', url: 'https://www.cbr.ru/scripts/XML_daily.asp' },
  ...overrides
});

test('history appends new validated periods and ignores exact repeats', () => {
  const first = mergeHistory({ observations: [] }, { generated_at: '2026-11-20T13:00:00Z', observations: [row()] });
  const second = mergeHistory(first, { generated_at: '2026-11-20T13:00:00Z', observations: [row()] });
  assert.equal(first.observations.length, 1);
  assert.equal(second.observations.length, 1);
});

test('history preserves source revisions as separate audit observations', () => {
  const first = mergeHistory({ observations: [row()] }, {
    generated_at: '2026-11-21T13:00:00Z',
    observations: [row({ value: 81, retrieved_at: '2026-11-21T13:00:00Z', revision_status: 'source_revised' })]
  });
  assert.equal(first.observations.length, 2);
  assert.deepEqual(first.observations.map(item => item.value), [80, 81]);
});

test('history rejects unvalidated and non-numeric rows', () => {
  const merged = mergeHistory({ observations: [] }, {
    generated_at: '2026-11-21T13:00:00Z',
    observations: [row({ validation_status: 'rejected' }), row({ value: 'NaN' })]
  });
  assert.equal(merged.observations.length, 0);
});

test('history keeps observations in deterministic period and series order', () => {
  const merged = mergeHistory({ observations: [] }, {
    generated_at: '2026-11-22T13:00:00Z',
    observations: [row({ series_key: 'RUB/EUR', reference_period: '2026-11-22' }), row({ reference_period: '2026-11-21' })]
  });
  assert.deepEqual(merged.observations.map(item => item.reference_period), ['2026-11-21', '2026-11-22']);
});
