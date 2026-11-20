const test = require('node:test');
const assert = require('node:assert/strict');
const { parseRussianNumber, parseCbrXml, parseWorldBankJson, parseWorldBankComparisonJson, stableObservationSignature } = require('../scripts/fetch-analytical-observations.cjs');

const retrievedAt = '2026-11-20T13:00:00.000Z';

test('Russian decimal parser handles comma decimals and rejects malformed values', () => {
  assert.equal(parseRussianNumber('91,2345'), 91.2345);
  assert.equal(parseRussianNumber('1 234,50'), 1234.5);
  assert.equal(parseRussianNumber('not-a-number'), null);
});

test('CBR parser normalizes nominal rates into one-unit RUB quotes with source dates', () => {
  const xml = '<ValCurs Date="20.11.2026" name="Foreign Currency Market"><Valute><CharCode>USD</CharCode><Nominal>1</Nominal><Value>80,5000</Value></Valute><Valute><CharCode>EUR</CharCode><Nominal>10</Nominal><Value>930,0000</Value></Valute><Valute><CharCode>CNY</CharCode><Nominal>10</Nominal><Value>112,0000</Value></Valute></ValCurs>';
  const rows = parseCbrXml(xml, retrievedAt);
  assert.equal(rows.length, 3);
  assert.equal(rows.find((row) => row.series_key === 'RUB/EUR').value, 93);
  assert.equal(rows.find((row) => row.series_key === 'RUB/USD').reference_period, '2026-11-20');
  assert.ok(rows.every((row) => row.retrieved_at === retrievedAt && row.validation_status === 'validated'));
});

test('CBR parser rejects incomplete or malformed source responses', () => {
  assert.throws(() => parseCbrXml('<html>maintenance</html>', retrievedAt), /ValCurs/);
  assert.throws(() => parseCbrXml('<ValCurs Date="20.11.2026"><Valute><CharCode>USD</CharCode><Nominal>0</Nominal><Value>1,00</Value></Valute></ValCurs>', retrievedAt), /invalid rate/);
});

test('World Bank parser selects the latest non-null country-year observation and retains vintage metadata', () => {
  const payload = [{ lastupdated: '2026-10-01' }, [
    { date: '2022', value: 3.45 },
    { date: '2023', value: null },
    { date: '2021', value: 3.2 }
  ]];
  const [row] = parseWorldBankJson(payload, retrievedAt);
  assert.equal(row.value, 3.45);
  assert.equal(row.reference_period, '2022');
  assert.equal(row.source_release_date, '2026-10-01');
  assert.equal(row.geography, 'USA');
});

test('World Bank parser does not manufacture observations when source data is empty', () => {
  assert.throws(() => parseWorldBankJson([{ lastupdated: '2026-10-01' }, [{ date: '2024', value: null }]], retrievedAt), /no non-null/);
});


test('Stable snapshot comparison ignores retrieval timestamps but detects source value and period revisions', () => {
  const base = {
    observations: [{
      series_key: 'RUB/USD',
      value: 80,
      unit: 'RUB_per_1_USD',
      geography: 'currency_pair',
      reference_period: '2026-11-20',
      source: { name: 'Bank of Russia', url: 'https://www.cbr.ru/scripts/XML_daily.asp' },
      source_release_date: '2026-11-20',
      retrieved_at: '2026-11-20T08:00:00.000Z',
      revision_status: 'source_published'
    }]
  };
  const rechecked = structuredClone(base);
  rechecked.observations[0].retrieved_at = '2026-11-21T08:00:00.000Z';
  assert.deepEqual(stableObservationSignature(base), stableObservationSignature(rechecked));

  const revised = structuredClone(base);
  revised.observations[0].value = 81;
  assert.notDeepEqual(stableObservationSignature(base), stableObservationSignature(revised));
});

test('World Bank comparison parser retains latest non-null observations for all eight requested countries', () => {
  const countries = ['USA', 'CHN', 'DEU', 'JPN', 'KOR', 'GBR', 'FRA', 'RUS'];
  const rows = countries.flatMap((code) => [
    { countryiso3code: code, country: { id: code, value: code }, date: '2022', value: 2.1 },
    { countryiso3code: code, country: { id: code, value: code }, date: '2023', value: null },
    { countryiso3code: code, country: { id: code, value: code }, date: '2021', value: 1.9 }
  ]);
  const result = parseWorldBankComparisonJson([{ lastupdated: '2026-11-11' }, rows], retrievedAt);
  assert.equal(result.length, 16);
  assert.deepEqual([...new Set(result.map(row => row.geography))].sort(), countries.sort());
  assert.ok(result.every(row => row.validation_status === 'validated' && row.source_release_date === '2026-11-11'));
  assert.equal(result.find(row => row.geography === 'USA' && row.reference_period === '2022').reference_period, '2022');
  assert.equal(result.find(row => row.geography === 'USA').country_name, 'США');
});

test('World Bank comparison parser rejects incomplete country coverage rather than filling missing countries', () => {
  const result = [{ countryiso3code: 'USA', country: { id: 'USA', value: 'United States' }, date: '2023', value: 3.4 }];
  assert.throws(() => parseWorldBankComparisonJson([{ lastupdated: '2026-11-11' }, result], retrievedAt), /no non-null R&D observation/);
});
