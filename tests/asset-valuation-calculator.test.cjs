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

const scenarios = require('../assets/js/asset-valuation-scenarios.js');

test('scenario engine calculates stress, base and optimistic cases from explicit assumptions', () => {
  const result = scenarios.calculateScenarioSet({
    baseValue: 1000000, currency: 'RUB', assessmentDate: '2026-11-20',
    stressPct: -15, optimisticPct: 10
  });
  assert.deepEqual(result.scenarios.map(row => row.value), [850000, 1000000, 1100000]);
  assert.deepEqual(result.sensitivity.map(row => row.changePct), [-20, -10, 0, 10, 20]);
});

test('scenario engine rejects invalid dates, currencies and asymmetric assumptions', () => {
  assert.throws(() => scenarios.calculateScenarioSet({ baseValue: 100, currency: 'GBP', assessmentDate: '2026-11-20', stressPct: -10, optimisticPct: 10 }), /валюту/);
  assert.throws(() => scenarios.calculateScenarioSet({ baseValue: 100, currency: 'RUB', assessmentDate: 'not-a-date', stressPct: -10, optimisticPct: 10 }), /дату/);
  assert.throws(() => scenarios.calculateScenarioSet({ baseValue: 100, currency: 'RUB', assessmentDate: '2026-02-30', stressPct: -10, optimisticPct: 10 }), /дату/);
  assert.throws(() => scenarios.calculateScenarioSet({ baseValue: 100, currency: 'RUB', assessmentDate: '2026-11-20', stressPct: 5, optimisticPct: 10 }), /Стрессовое/);
});

test('FX conversion requires a validated official observation on the exact valuation date', () => {
  const base = { indicator_id: 'macro.fx_official', unit: 'RUB_per_1_USD', validation_status: 'validated', source: { name: 'Bank of Russia', url: 'https://www.cbr.ru/scripts/XML_daily.asp' } };
  const snapshot = { observations: [
    { ...base, series_key: 'RUB/USD', value: 90, reference_period: '2026-11-20', retrieved_at: '2026-11-20T10:00:00Z' },
    { ...base, series_key: 'RUB/USD', value: 91, reference_period: '2026-11-19', retrieved_at: '2026-11-20T11:00:00Z' }
  ] };
  assert.equal(scenarios.findOfficialRateOnDate(snapshot, 'USD', '2026-11-20').value, 90);
  assert.equal(scenarios.findOfficialRateOnDate(snapshot, 'USD', '2026-11-18'), null);
  assert.equal(scenarios.convertToRub(100, 'USD', snapshot, '2026-11-20').value, 9000);
  assert.equal(scenarios.convertToRub(100, 'USD', snapshot, '2026-11-18').converted, false);
});

test('valuation page exposes date-scoped scenario analysis and local-only safeguards', () => {
  const html = fs.readFileSync(path.join(__dirname, '../centers/asset-valuation/index.html'), 'utf8');
  assert.match(html, /id="scenario-date"/);
  assert.match(html, /id="scenario-stress"/);
  assert.match(html, /id="scenario-optimistic"/);
  assert.match(html, /id="scenario-chart-svg"/);
  assert.match(html, /id="scenario-sensitivity-rows"/);
  assert.match(html, /result\.sensitivity\.forEach/);
  assert.match(html, /asset-valuation-scenarios\.js/);
  assert.match(html, /точную дату оценки/);
  assert.match(html, /не являются прогнозом/);
});


test('valuation UI offers CNY and invalidates stale scenario results on reset, asset switch and currency change', () => {
  const html = fs.readFileSync(path.join(__dirname, '../centers/asset-valuation/index.html'), 'utf8');
  assert.match(html, /<option value="CNY">CNY · Китайский юань<\/option>/);
  assert.match(html, /resetScenarioState\('Сначала выполните основной расчёт\.'\)/);
  assert.match(html, /resetScenarioState\('Валюта изменена\. Выполните основной расчёт заново\.'\)/);
  assert.match(html, /resetScenarioState\("Сначала выполните новый расчёт для выбранного типа актива\."\)/);
  assert.match(html, /scenarioRun\.disabled=true/);
  assert.match(html, /scenarioRun\.disabled=false/);
});


test('comparison workspace limits the list to four validated local valuation entries', () => {
  const comparison = require('../assets/js/asset-valuation-comparison.js');
  const result = { method: 'Сравнительный подход', marketValue: 100000, low: 95000, high: 105000 };
  const entries = [];
  for (let index = 1; index <= 4; index += 1) comparison.addEntry(entries, { name: 'Объект ' + index, kind: 'property', result, currency: 'RUB', assessmentDate: '2026-11-20' });
  assert.equal(entries.length, 4);
  assert.throws(() => comparison.addEntry(entries, { name: 'Пятый объект', kind: 'property', result, currency: 'RUB', assessmentDate: '2026-11-20' }), /не более четырёх/);
  assert.equal(entries[0].name, 'Объект 1');
  const oneCurrencyEntry = [entries[0]];
  assert.throws(() => comparison.addEntry(oneCurrencyEntry, { name: 'В другой валюте', kind: 'property', result, currency: 'USD', assessmentDate: '2026-11-20' }), /только в одной валюте/);
  assert.throws(() => comparison.createEntry({ name: 'Неверная дата', kind: 'property', result, currency: 'RUB', assessmentDate: '2026-02-30' }), /корректную дату/);
});

test('method comparison shows only actually calculated valuation approaches', () => {
  const comparison = require('../assets/js/asset-valuation-comparison.js');
  const property = comparison.buildMethodRows({ method: 'Сравнительный подход', marketValue: 100000, incomeValue: 120000, incomeMethod: 'Доходный подход' }, 'property');
  assert.deepEqual(property.map(row => row.method), ['Сравнительный подход', 'Доходный подход']);
  assert.deepEqual(property.map(row => row.value), [100000, 120000]);
  const business = comparison.buildMethodRows({ method: 'Доходно-рыночный ориентир', equityValue: 800000, enterpriseValue: 900000 }, 'business');
  assert.equal(business.length, 1);
  assert.equal(business[0].value, 800000);
  assert.throws(() => comparison.createEntry({ name: 'X', kind: 'property', result: { method: 'Сравнительный подход' }, currency: 'RUB', assessmentDate: '2026-11-20' }), /расчётная стоимость/);
});

test('valuation page exposes an in-memory four-object comparison workspace', () => {
  const html = fs.readFileSync(path.join(__dirname, '../centers/asset-valuation/index.html'), 'utf8');
  assert.match(html, /id="comparison-add"/);
  assert.match(html, /id="comparison-rows"/);
  assert.match(html, /id="method-comparison-rows"/);
  assert.match(html, /asset-valuation-comparison\.js/);
  assert.match(html, /не более четырёх объектов/);
  assert.match(html, /только в памяти текущей страницы/);
});


test('method spread chart scales only calculated methods against the largest observed value', () => {
  const comparison = require('../assets/js/asset-valuation-comparison.js');
  const spread = comparison.buildMethodSpread([
    { method: 'Сравнительный подход', value: 100000 },
    { method: 'Доходный подход', value: 125000 },
    { method: 'Не рассчитано', value: null }
  ]);
  assert.equal(spread.length, 2);
  assert.equal(spread[0].share, 0.8);
  assert.equal(spread[1].share, 1);
  assert.equal(comparison.buildMethodSpread([]).length, 0);
  assert.equal(comparison.buildMethodSpread([{ method: 'Ноль', value: 0 }])[0].share, 0);
});

test('valuation page renders method comparison chart without automatic weighting', () => {
  const html = fs.readFileSync(path.join(__dirname, '../centers/asset-valuation/index.html'), 'utf8');
  assert.match(html, /id="method-comparison-chart"/);
  assert.match(html, /id="method-comparison-svg"/);
  assert.match(html, /buildMethodSpread\(rows\)/);
  assert.match(html, /не усредняются и не взвешиваются автоматически/);
});


const quality = require('../assets/js/asset-valuation-quality.js');

test('quality passport checks required inputs, methods, date and declared source without claiming verification', () => {
  const report = quality.buildQualityReport({
    kind: 'property',
    inputs: { area: '100', pricePerSqm: '50000', noi: '3000000', capRate: '8' },
    assessmentDate: '2026-11-25',
    sourceDescription: 'Отчёт о сделках за квартал',
    sourceUrl: 'https://example.org/report',
    result: { assumptions: 'Диапазон ±5% — чувствительность.' }
  });
  assert.equal(report.completeness.value, '2/2 обязательных');
  assert.equal(report.methods.value, '2 из 2 доступных');
  assert.equal(report.date.state, 'good');
  assert.equal(report.source.state, 'good');
  assert.match(report.source.note, /не верифицировано/);
  assert.match(report.limitations.join(' '), /не заменяет/);
});

test('quality passport flags partial optional method data and insecure source URLs', () => {
  const report = quality.buildQualityReport({
    kind: 'property',
    inputs: { area: '100', pricePerSqm: '50000', noi: '3000000', capRate: '' },
    assessmentDate: '2026-02-30',
    sourceDescription: 'Внутренняя таблица',
    sourceUrl: 'http://example.org'
  });
  assert.equal(report.methods.state, 'missing');
  assert.equal(report.date.state, 'missing');
  assert.equal(report.source.state, 'missing');
  assert.equal(report.completeness.state, 'good');
});

test('quality passport distinguishes supported calculation methods from unavailable valuation approaches', () => {
  const business = quality.buildQualityReport({
    kind: 'business',
    inputs: { ebitda: '100', multiple: '4', debt: '0', cash: '0' },
    assessmentDate: '2026-11-25'
  });
  const equipment = quality.buildQualityReport({
    kind: 'equipment',
    inputs: { replacementCost: '1000', depreciation: '20' },
    assessmentDate: '2026-11-25'
  });
  assert.equal(business.methods.value, '1 из 1 в текущей модели');
  assert.match(business.methods.note, /DCF/);
  assert.equal(equipment.methods.value, '1 из 1 в текущей модели');
  assert.equal(quality.isValidDate('2026-02-30'), false);
  assert.equal(quality.isValidDate('2026-11-25'), true);
});

test('valuation page exposes the quality passport and keeps source verification claims explicit', () => {
  const html = fs.readFileSync(path.join(__dirname, '../centers/asset-valuation/index.html'), 'utf8');
  assert.match(html, /id="valuation-quality"/);
  assert.match(html, /id="assessment-date"/);
  assert.match(html, /id="quality-source-url"/);
  assert.match(html, /asset-valuation-quality\.js/);
  assert.match(html, /содержание источника не верифицировано/);
});
