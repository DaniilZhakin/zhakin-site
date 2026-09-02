import assert from 'node:assert/strict';
import { validateEvent } from './worker.js';

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

console.log(`PASS: ${cases.length + 2} collector contract tests`);
