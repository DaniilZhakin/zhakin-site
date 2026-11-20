const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const calc = require('../assets/js/asset-valuation-calculator.js');

test('business calculator separates enterprise value from equity value', () => {
  const result = calc.calculateBusiness({ ebitda: 2000000, multiple: 4.5, debt: 2000000, cash: 1000000 });
  assert.equal(result.enterpriseValue, 9000000);
  assert.equal(result.equityValue, 8000000);
  assert.equal(result.low, 7100000);
  assert.equal(result.high, 8900000);
});

test('property calculator supports comparative and optional income approaches', () => {
  const result = calc.calculateProperty({ area: 100, pricePerSqm: 1000, noi: 8000, capRate: 8 });
  assert.equal(result.marketValue, 100000);
  assert.equal(result.incomeValue, 100000);
  assert.equal(result.low, 95000);
  assert.equal(result.high, 105000);
});

test('property calculator rejects incomplete income approach inputs', () => {
  assert.throws(() => calc.calculateProperty({ area: 100, pricePerSqm: 1000, noi: 8000, capRate: '' }), /заполните и NOI/);
});

test('equipment calculator applies user-entered depreciation', () => {
  const result = calc.calculateEquipment({ replacementCost: 500000, depreciation: 20 });
  assert.equal(result.value, 400000);
  assert.equal(result.low, 360000);
  assert.ok(Math.abs(result.high - 440000) < 1e-6);
});

test('calculators reject negative, zero-base and out-of-range inputs', () => {
  assert.throws(() => calc.calculateBusiness({ ebitda: 0, multiple: 4, debt: 0, cash: 0 }));
  assert.throws(() => calc.calculateBusiness({ ebitda: 100, multiple: 4, debt: '', cash: 0 }), /заполните поле/);
  assert.throws(() => calc.calculateProperty({ area: -1, pricePerSqm: 100 }));
  assert.throws(() => calc.calculateEquipment({ replacementCost: 1000, depreciation: 101 }), /от 0 до 100/);
  assert.throws(() => calc.calculateEquipment({ replacementCost: 1000, depreciation: '' }), /заполните поле/);
});

test('public valuation page exposes three asset tabs and clear legal limitations', () => {
  const html = fs.readFileSync(path.join(__dirname, '../centers/asset-valuation/index.html'), 'utf8');
  assert.match(html, /Калькулятор предварительной оценки/);
  assert.match(html, /data-kind="business"/);
  assert.match(html, /data-kind="property"/);
  assert.match(html, /data-kind="equipment"/);
  assert.match(html, /id="valuation-input-panel" role="tabpanel" aria-labelledby="tab-business"/);
  assert.match(html, /aria-controls="valuation-input-panel"/);
  assert.match(html, /event\.key==='ArrowRight'/);
  assert.match(html, /Все значения вводятся в выбранной валюте/);
  assert.match(html, /не является официальным отчётом об оценке/);
  assert.match(html, /не отправляет введённые значения на сервер/);
  assert.match(html, /asset-valuation-calculator\.js/);
});

const market = require('../assets/js/asset-valuation-market-context.js');

test('market context accepts only validated official Bank of Russia FX observations', () => {
  const snapshot = { observations: [
    { indicator_id: 'macro.fx_official', series_key: 'RUB/USD', value: 90, unit: 'RUB_per_1_USD', reference_period: '2026-11-20', validation_status: 'validated', source: { name: 'Bank of Russia', url: 'https://www.cbr.ru/scripts/XML_daily.asp' } },
    { indicator_id: 'macro.fx_official', series_key: 'RUB/USD', value: 91, unit: 'RUB_per_1_USD', reference_period: '2026-11-19', validation_status: 'validated', source: { name: 'Bank of Russia', url: 'https://www.cbr.ru/scripts/XML_daily.asp' } },
    { indicator_id: 'macro.fx_official', series_key: 'RUB/EUR', value: 100, unit: 'RUB_per_1_EUR', reference_period: '2026-11-20', validation_status: 'pending', source: { name: 'Bank of Russia', url: 'https://www.cbr.ru/scripts/XML_daily.asp' } },
    { indicator_id: 'macro.fx_official', series_key: 'RUB/CNY', value: 12, unit: 'RUB_per_1_CNY', reference_period: '2026-11-20', validation_status: 'validated', source: { name: 'Unverified source', url: 'https://example.com' } }
  ] };
  const rows = market.selectOfficialRates(snapshot);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].key, 'RUB/USD');
  assert.equal(rows[0].value, 90);
});

test('market context chooses the newest validated observation per currency pair', () => {
  const base = { indicator_id: 'macro.fx_official', validation_status: 'validated', source: { name: 'Bank of Russia', url: 'https://www.cbr.ru/scripts/XML_daily.asp' } };
  const rows = market.selectOfficialRates({ observations: [
    { ...base, series_key: 'RUB/USD', value: 80, unit: 'RUB_per_1_USD', reference_period: '2026-11-19' },
    { ...base, series_key: 'RUB/USD', value: 81, unit: 'RUB_per_1_USD', reference_period: '2026-11-20' },
    { ...base, series_key: 'RUB/EUR', value: 90, unit: 'RUB_per_1_EUR', reference_period: '2026-11-20' },
    { ...base, series_key: 'RUB/CNY', value: 12, unit: 'RUB_per_1_CNY', reference_period: '2026-11-20' }
  ] });
  assert.equal(rows.length, 3);
  assert.equal(rows.find(row => row.key === 'RUB/USD').value, 81);
});

test('market context freshness flags old observations and never changes valuation inputs', () => {
  assert.equal(market.freshness('2026-11-20', new Date('2026-11-20T14:00:00Z')), 'recent');
  assert.equal(market.freshness('2026-11-10', new Date('2026-11-20T14:00:00Z')), 'stale');
  const html = fs.readFileSync(path.join(__dirname, '../centers/asset-valuation/index.html'), 'utf8');
  assert.match(html, /id="av-market-context"/);
  assert.match(html, /asset-valuation-market-context\.js/);
  assert.match(html, /не меняют исходные данные, валюту или результат оценки/);
});
