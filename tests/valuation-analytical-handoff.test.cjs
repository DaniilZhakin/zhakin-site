const test = require('node:test');
const assert = require('node:assert/strict');
const handoff = require('../assets/js/valuation-analytical-handoff.js');

function memoryStorage() {
  const values = new Map();
  return {
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key)
  };
}

const base = {
  kind: 'business',
  method: 'EBITDA × multiple',
  value: 8000000,
  low: 7100000,
  high: 8900000,
  currency: 'RUB',
  assessmentDate: '2026-11-20',
  stressPct: -15,
  optimisticPct: 10
};

test('handoff stores only the explicit compact summary, never raw calculator inputs', () => {
  const brief = handoff.buildBrief({ ...base, ebitda: 2000000, debt: 2000000, cash: 1000000, companyName: 'Private company' }, Date.parse('2026-11-20T12:00:00Z'));
  assert.equal(brief.value, 8000000);
  assert.equal(brief.scenarios[0].value, 6800000);
  assert.equal(brief.scenarios[2].value, 8800000);
  assert.deepEqual(Object.keys(brief).sort(), ['assessmentDate','createdAt','currency','expiresAt','high','kind','low','method','scenarios','schemaVersion','value'].sort());
  assert.equal(JSON.stringify(brief).includes('Private company'), false);
  assert.equal(JSON.stringify(brief).includes('ebitda'), false);
});

test('handoff is session-scoped and expires after two hours', () => {
  const storage = memoryStorage();
  const now = Date.parse('2026-11-20T12:00:00Z');
  handoff.saveBrief(storage, base, now);
  assert.equal(handoff.readBrief(storage, now + 60 * 60 * 1000).value, 8000000);
  assert.equal(handoff.readBrief(storage, now + handoff.MAX_AGE_MS + 1), null);
  assert.equal(storage.getItem(handoff.STORAGE_KEY), null);
});

test('handoff rejects invalid asset types, currencies, dates, values and ranges', () => {
  assert.throws(() => handoff.buildBrief({ ...base, kind: 'other' }), /тип актива/);
  assert.throws(() => handoff.buildBrief({ ...base, currency: 'GBP' }), /валюта/);
  assert.throws(() => handoff.buildBrief({ ...base, assessmentDate: '2026-02-30' }), /корректную дату/);
  assert.throws(() => handoff.buildBrief({ ...base, value: 0 }), /результата оценки/);
  assert.throws(() => handoff.buildBrief({ ...base, low: 9000000, high: 8000000 }), /диапазон/);
});

test('tampered, expired and malformed stored summaries are rejected and cleared', () => {
  const storage = memoryStorage();
  const now = Date.parse('2026-11-20T12:00:00Z');
  storage.setItem(handoff.STORAGE_KEY, 'null');
  assert.equal(handoff.readBrief(storage, now), null);
  handoff.saveBrief(storage, base, now);
  const tampered = JSON.parse(storage.getItem(handoff.STORAGE_KEY));
  tampered.expiresAt = new Date(now + handoff.MAX_AGE_MS * 3).toISOString();
  storage.setItem(handoff.STORAGE_KEY, JSON.stringify(tampered));
  assert.equal(handoff.readBrief(storage, now), null);
  assert.equal(storage.getItem(handoff.STORAGE_KEY), null);
});

test('handoff tolerates blocked browser storage when clearing data', () => {
  const blocked = { getItem() { throw new Error('blocked'); }, removeItem() { throw new Error('blocked'); } };
  assert.equal(handoff.readBrief(blocked), null);
  assert.doesNotThrow(() => handoff.clearBrief(blocked));
});

test('both centres expose an explicit local-only handoff and a clear action', () => {
  const fs = require('node:fs');
  const valuation = fs.readFileSync('centers/asset-valuation/index.html', 'utf8');
  const analytical = fs.readFileSync('centers/analytical/index.html', 'utf8');
  assert.match(valuation, /id="send-valuation-brief"/);
  assert.match(valuation, /не отправляет введённые значения на сервер/);
  assert.match(valuation, /valuation-analytical-handoff\.js/);
  assert.match(analytical, /id="valuation-brief"/);
  assert.match(analytical, /data-clear-valuation-brief/);
  assert.match(analytical, /valuation-analytical-handoff\.js/);
});

test('changing original calculator inputs invalidates the previously approved summary', () => {
  const fs = require('node:fs');
  const source = fs.readFileSync('assets/js/valuation-analytical-handoff.js', 'utf8');
  const page = fs.readFileSync('centers/asset-valuation/index.html', 'utf8');
  assert.match(source, /\[data-field\] input, #currency, #scenario-date/);
  assert.match(page, /Параметры изменены\. Выполните основной расчёт заново/);
  assert.match(page, /currentValuationResult=null/);
});
