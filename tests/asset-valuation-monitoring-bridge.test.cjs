const test = require('node:test');
const assert = require('node:assert/strict');
const bridge = require('../assets/js/asset-valuation-monitoring-bridge.js');
const scenarios = require('../assets/js/asset-valuation-scenarios.js');

const source = { name: 'Bank of Russia', url: 'https://www.cbr.ru/scripts/XML_daily.asp' };
const observation = (date, value = 81.5) => ({
  indicator_id: 'macro.fx_official',
  series_key: 'RUB/USD',
  unit: 'RUB_per_1_USD',
  value,
  reference_period: date,
  validation_status: 'validated',
  source,
  retrieved_at: date + 'T10:00:00Z'
});

test('bridge exposes an exact-date validated Bank of Russia reference without applying it', () => {
  const result = bridge.resolveReference(
    { observations: [observation('2026-11-20')] },
    'USD',
    '2026-11-20',
    scenarios
  );
  assert.equal(result.status, 'validated_reference_available');
  assert.equal(result.rate, 81.5);
  assert.equal(result.rateDate, '2026-11-20');
  assert.equal(result.sourceName, 'Bank of Russia');
  assert.equal(result.applied, false);
  assert.equal(Object.hasOwn(result, 'convertedValue'), false);
});

test('bridge never substitutes a nearby date when the exact valuation date is absent', () => {
  const result = bridge.resolveReference(
    { observations: [observation('2026-11-19')] },
    'USD',
    '2026-11-20',
    scenarios
  );
  assert.equal(result.status, 'reference_unavailable');
  assert.equal(result.applied, false);
  assert.equal(Object.hasOwn(result, 'rate'), false);
});

test('bridge rejects invalid dates and unsupported currencies', () => {
  assert.equal(bridge.resolveReference({}, 'USD', '2026-02-30', scenarios).status, 'invalid_assessment_date');
  assert.equal(bridge.resolveReference({}, 'GBP', '2026-11-20', scenarios).status, 'unsupported_currency');
});

test('ruble assessments do not require or request an FX reference', () => {
  const result = bridge.resolveReference(null, 'RUB', '2026-11-20', null);
  assert.equal(result.status, 'not_required');
  assert.equal(result.applied, false);
  assert.equal(Object.hasOwn(result, 'rate'), false);
});

test('bridge independently rejects a non-CBR source returned by an injected provider', () => {
  const fakeProvider = {
    findOfficialRateOnDate: () => ({
      value: 81.5,
      date: '2026-11-20',
      source: { name: 'Unverified source', url: 'https://example.com/rates' }
    })
  };
  const result = bridge.resolveReference({}, 'USD', '2026-11-20', fakeProvider);
  assert.equal(result.status, 'reference_unavailable');
  assert.equal(result.applied, false);
});
