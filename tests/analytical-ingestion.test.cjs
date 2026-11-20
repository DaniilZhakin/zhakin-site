const test = require('node:test');
const assert = require('node:assert/strict');
const { parseRussianNumber, parseCbrXml, parseWorldBankJson } = require('../scripts/fetch-analytical-observations.cjs');

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
