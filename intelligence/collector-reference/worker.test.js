import assert from 'node:assert/strict';
import { validateEvent, default as worker } from './worker.js';

const valid = {
  event_type: 'page_view',
  path: '/publications.html',
  schema_version: '3.0',
};

const cases = [
  ['accepts valid event', valid, null],
  ['rejects unknown field', { ...valid, ip: '203.0.113.10' }, 'unexpected field: ip'],
  ['rejects invalid event type', { ...valid, event_type: 'login' }, 'invalid event_type'],
  ['rejects wrong schema version', { ...valid, schema_version: '2.9' }, 'invalid schema_version'],
  ['rejects query string in path', { ...valid, path: '/?q=test' }, 'invalid path'],
  ['rejects invalid referrer class', { ...valid, referrer_class: 'utm_campaign' }, 'invalid referrer_class'],
  ['rejects invalid content id', { ...valid, content_id: 'article/1' }, 'invalid content_id'],
  ['accepts optional fields', {
    ...valid,
    timestamp: '2026-09-02T08:25:20Z',
    referrer_class: 'search',
    content_id: 'digital-ruble',
  }, null],
];

for (const [name, event, expected] of cases) {
  assert.equal(validateEvent(event), expected, name);
}

assert.equal(validateEvent([{ ...valid }]), 'event must be an object', 'rejects array as event');
assert.equal(validateEvent(null), 'event must be an object', 'rejects null');

async function request(path, options = {}) {
  return worker.fetch(
    new Request(`https://collector.example${path}`, options),
    { ALLOWED_ORIGIN: 'https://xn--80alhhq.xn--p1ai' },
  );
}

const invalidJson = await request('/v1/events', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: '{invalid',
});
assert.equal(invalidJson.status, 400, 'rejects invalid JSON');

const wrongMethod = await request('/v1/events', { method: 'GET' });
assert.equal(wrongMethod.status, 404, 'rejects wrong method');

const wrongPath = await request('/v1/not-events', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(valid),
});
assert.equal(wrongPath.status, 404, 'rejects wrong path');

const tooManyEvents = await request('/v1/events', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(Array.from({ length: 11 }, () => valid)),
});
assert.equal(tooManyEvents.status, 400, 'rejects more than 10 events');

const oversized = await request('/v1/events', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ ...valid, content_id: 'x'.repeat(128) }) + 'xxxxxxxx',
});
assert.equal(oversized.status, 413, 'rejects oversized payload');

const accepted = await request('/v1/events', {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    origin: 'https://xn--80alhhq.xn--p1ai',
  },
  body: JSON.stringify(valid),
});
assert.equal(accepted.status, 202, 'accepts valid HTTP request');
assert.equal(accepted.headers.get('access-control-allow-origin'), 'https://xn--80alhhq.xn--p1ai', 'allows configured origin');

console.log(`PASS: ${cases.length + 2} validator tests + 6 HTTP contract tests`);
