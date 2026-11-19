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
  assert.match(html, /не является официальным отчётом об оценке/);
  assert.match(html, /не отправляет введённые значения на сервер/);
  assert.match(html, /asset-valuation-calculator\.js/);
});
