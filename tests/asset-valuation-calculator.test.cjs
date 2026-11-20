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

const handoff = require('../assets/js/valuation-analytical-handoff.js');

function memoryStorage() {
  const values = new Map();
  return {
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key)
  };
}

test('valuation handoff stores only an explicitly approved summary, never raw calculator inputs', () => {
  const brief = handoff.buildBrief({
    kind: 'business', method: 'EBITDA × multiple', value: 8000000,
    low: 7100000, high: 8900000, currency: 'RUB', assessmentDate: '2026-11-20',
    stressPct: -15, optimisticPct: 10,
    ebitda: 2000000, debt: 2000000, cash: 1000000, companyName: 'Private company'
  }, Date.parse('2026-11-20T12:00:00Z'));
  assert.equal(brief.value, 8000000);
  assert.equal(brief.scenarios[0].value, 6800000);
  assert.equal(brief.scenarios[2].value, 8800000);
  assert.deepEqual(Object.keys(brief).sort(), [
    'assessmentDate','createdAt','currency','expiresAt','high','kind','low','method',
    'scenarios','schemaVersion','value'
  ].sort());
  assert.equal(JSON.stringify(brief).includes('Private company'), false);
  assert.equal(JSON.stringify(brief).includes('ebitda'), false);
});

test('valuation handoff is stored in session scope and expires after two hours', () => {
  const storage = memoryStorage();
  const now = Date.parse('2026-11-20T12:00:00Z');
  handoff.saveBrief(storage, {
    kind: 'property', method: 'Площадь × цена за м²', value: 120000,
    low: 114000, high: 126000, currency: 'RUB', assessmentDate: '2026-11-20'
  }, now);
  assert.equal(handoff.readBrief(storage, now + 60 * 60 * 1000).value, 120000);
  assert.equal(handoff.readBrief(storage, now + handoff.MAX_AGE_MS + 1), null);
  assert.equal(storage.getItem(handoff.STORAGE_KEY), null);
});

test('valuation handoff rejects invalid asset types, currencies and values', () => {
  const base = { kind: 'equipment', method: 'Cost approach', value: 50000, currency: 'RUB', assessmentDate: '2026-11-20' };
  assert.throws(() => handoff.buildBrief({ ...base, kind: 'other' }), /тип актива/);
  assert.throws(() => handoff.buildBrief({ ...base, currency: 'GBP' }), /валюта/);
  assert.throws(() => handoff.buildBrief({ ...base, value: 0 }), /результата оценки/);
});

test('both centers expose the opt-in handoff and local-only disclosure', () => {
  const valuation = fs.readFileSync(path.join(__dirname, '../centers/asset-valuation/index.html'), 'utf8');
  const analytical = fs.readFileSync(path.join(__dirname, '../centers/analytical/index.html'), 'utf8');
  assert.match(valuation, /id="send-valuation-brief"/);
  assert.match(valuation, /не отправляет введённые значения на сервер/);
  assert.match(valuation, /valuation-analytical-handoff\.js/);
  assert.match(analytical, /id="valuation-brief"/);
  assert.match(analytical, /data-clear-valuation-brief/);
  assert.match(analytical, /valuation-analytical-handoff\.js/);
});

test('valuation handoff rejects impossible dates and tampered stored payloads', () => {
  const base = { kind: 'business', method: 'Test', value: 100, currency: 'RUB', assessmentDate: '2026-11-20' };
  assert.throws(() => handoff.buildBrief({ ...base, assessmentDate: '2026-02-30' }), /корректную дату/);
  const storage = memoryStorage();
  const now = Date.parse('2026-11-20T12:00:00Z');
  handoff.saveBrief(storage, base, now);
  const tampered = JSON.parse(storage.getItem(handoff.STORAGE_KEY));
  tampered.expiresAt = new Date(now + handoff.MAX_AGE_MS * 3).toISOString();
  storage.setItem(handoff.STORAGE_KEY, JSON.stringify(tampered));
  assert.equal(handoff.readBrief(storage, now), null);
  assert.equal(storage.getItem(handoff.STORAGE_KEY), null);
});

test('valuation handoff preserves negative lower bounds where the valuation method produces them', () => {
  const brief = handoff.buildBrief({
    kind: 'business', method: 'EV less net debt', value: 100,
    low: -25, high: 125, currency: 'RUB', assessmentDate: '2026-11-20',
    stressPct: -100, optimisticPct: 500
  }, Date.parse('2026-11-20T12:00:00Z'));
  assert.equal(brief.low, -25);
  assert.equal(brief.scenarios[0].value, 0);
  assert.equal(brief.scenarios[2].value, 600);
});

test('scenario input changes invalidate the previously approved handoff until recalculation', () => {
  const source = fs.readFileSync(path.join(__dirname, '../assets/js/valuation-analytical-handoff.js'), 'utf8');
  assert.match(source, /scenario-date', 'scenario-stress', 'scenario-optimistic/);
  assert.match(source, /addEventListener\('input', \(\) => root\.ZhakinValuationHandoff\.setLatest\(null\)\)/);
});


test('valuation handoff rejects null payloads and impossible dates tampered in session storage', () => {
  const storage = memoryStorage();
  storage.setItem(handoff.STORAGE_KEY, 'null');
  assert.equal(handoff.readBrief(storage), null);
  assert.equal(storage.getItem(handoff.STORAGE_KEY), null);

  const now = Date.parse('2026-11-20T12:00:00Z');
  handoff.saveBrief(storage, {
    kind: 'business', method: 'Test', value: 100,
    currency: 'RUB', assessmentDate: '2026-11-20'
  }, now);
  const tampered = JSON.parse(storage.getItem(handoff.STORAGE_KEY));
  tampered.assessmentDate = '2026-02-30';
  storage.setItem(handoff.STORAGE_KEY, JSON.stringify(tampered));
  assert.equal(handoff.readBrief(storage, now), null);
  assert.equal(storage.getItem(handoff.STORAGE_KEY), null);
});

test('valuation handoff tolerates storage access failures when clearing the panel', () => {
  const blockedStorage = {
    getItem() { throw new Error('storage blocked'); },
    removeItem() { throw new Error('storage blocked'); }
  };
  assert.equal(handoff.readBrief(blockedStorage), null);
  assert.doesNotThrow(() => handoff.clearBrief(blockedStorage));
});
