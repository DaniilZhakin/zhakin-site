import assert from 'node:assert/strict';
import { RateLimiter, validateEvent } from './worker.js';

const validEvent = {
  event_type: 'page_view',
  path: '/publications.html',
  schema_version: '3.0',
};

assert.equal(validateEvent(validEvent), null);
assert.equal(validateEvent({ ...validEvent, extra: true }), 'unexpected field: extra');
assert.equal(validateEvent({ ...validEvent, event_type: 'unknown' }), 'invalid event_type');
assert.equal(validateEvent({ ...validEvent, schema_version: '2.9' }), 'invalid schema_version');
assert.equal(validateEvent({ ...validEvent, path: 'publications.html' }), 'invalid path');
assert.equal(validateEvent({ ...validEvent, path: '/a?b=c' }), 'invalid path');
assert.equal(validateEvent({ ...validEvent, referrer_class: 'ip' }), 'invalid referrer_class');
assert.equal(validateEvent({ ...validEvent, content_id: 'bad/id' }), 'invalid content_id');
assert.equal(validateEvent({ ...validEvent, timestamp: 'not-a-date' }), 'invalid timestamp');

const originalNow = Date.now;
let now = 1_000_000;
Date.now = () => now;

class MemoryStorage {
  constructor() { this.values = new Map(); }
  async get(key) { return this.values.get(key); }
  async put(key, value) { this.values.set(key, value); }
}

try {
  const storage = new MemoryStorage();
  const limiter = new RateLimiter({ storage });

  for (let i = 0; i < 30; i += 1) {
    const response = await limiter.fetch(new Request('https://rate-limit/consume'));
    const body = await response.json();
    assert.equal(body.allowed, true);
  }

  const blocked = await limiter.fetch(new Request('https://rate-limit/consume'));
  const blockedBody = await blocked.json();
  assert.equal(blockedBody.allowed, false);
  assert.equal(blocked.status, 200);

  now += 60_001;
  const reset = await limiter.fetch(new Request('https://rate-limit/consume'));
  assert.equal((await reset.json()).allowed, true);
} finally {
  Date.now = originalNow;
}

console.log('PASS: Cloudflare collector validator + rate-limit boundary tests');
