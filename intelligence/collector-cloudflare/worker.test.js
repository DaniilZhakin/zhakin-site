import assert from 'node:assert/strict';
import worker, { RateLimiter, getRetentionCutoff, getRetentionDays, purgeExpiredAggregates, validateEvent } from './worker.js';

const validEvent = { event_type: 'page_view', path: '/publications.html', schema_version: '3.0' };

assert.equal(validateEvent(validEvent), null);
assert.equal(validateEvent({ ...validEvent, event_type: 'navigation' }), null);
assert.equal(validateEvent({ ...validEvent, event_type: 'menu_interaction' }), null);
assert.equal(validateEvent({ ...validEvent, extra: true }), 'unexpected field: extra');
assert.equal(validateEvent({ ...validEvent, event_type: 'navigation_click' }), 'invalid event_type');
assert.equal(validateEvent({ ...validEvent, event_type: 'unknown' }), 'invalid event_type');
assert.equal(validateEvent({ ...validEvent, schema_version: '2.9' }), 'invalid schema_version');
assert.equal(validateEvent({ ...validEvent, path: 'publications.html' }), 'invalid path');
assert.equal(validateEvent({ ...validEvent, path: '/a?b=c' }), 'invalid path');
assert.equal(validateEvent({ ...validEvent, referrer_class: 'ip' }), 'invalid referrer_class');
assert.equal(validateEvent({ ...validEvent, content_id: 'bad/id' }), 'invalid content_id');
assert.equal(validateEvent({ ...validEvent, timestamp: 'not-a-date' }), 'invalid timestamp');

assert.equal(getRetentionDays({ RETENTION_DAYS: '90' }), 90);
assert.equal(getRetentionDays({ RETENTION_DAYS: '0' }), 90);
assert.equal(getRetentionDays({ RETENTION_DAYS: 'invalid' }), 90);
assert.equal(getRetentionCutoff(new Date('2026-09-02T00:00:00.000Z'), 90), '2026-06-04');

const originalNow = Date.now;
let now = 1_000_000;
Date.now = () => now;
class MemoryStorage {
  constructor() { this.values = new Map(); }
  async get(key) { return this.values.get(key); }
  async put(key, value) { this.values.set(key, value); }
}
try {
  const limiter = new RateLimiter({ storage: new MemoryStorage() });
  for (let i = 0; i < 30; i += 1) assert.equal((await (await limiter.fetch(new Request('https://rate-limit/consume'))).json()).allowed, true);
  const blocked = await limiter.fetch(new Request('https://rate-limit/consume'));
  assert.equal((await blocked.json()).allowed, false);
  assert.equal(blocked.status, 200);
  now += 60_001;
  assert.equal((await (await limiter.fetch(new Request('https://rate-limit/consume'))).json()).allowed, true);
} finally { Date.now = originalNow; }

function createRateLimiterEnv(response = { allowed: true, remaining: 29 }) {
  return {
    ALLOWED_ORIGIN: 'https://xn--80alhhq.xn--p1ai',
    RETENTION_DAYS: '90',
    RATE_LIMITER: { idFromName: () => 'global', get: () => ({ fetch: async () => Response.json(response) }) },
    DB: {
      prepare: () => ({ bind: () => ({ run: async () => ({ success: true }) }) }),
      batch: async () => undefined,
    },
  };
}

async function request(method, path, body, headers = {}) {
  return worker.fetch(new Request(`https://collector.example${path}`, { method, body, headers }), createRateLimiterEnv());
}

const foreignHeaders = { Origin: 'https://evil.example', 'Content-Type': 'application/json' };
const allowedHeaders = { Origin: 'https://xn--80alhhq.xn--p1ai', 'Content-Type': 'application/json' };

{
  const response = await request('POST', '/api/events', JSON.stringify(validEvent), foreignHeaders);
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error, 'cors_forbidden');
}
{
  const response = await request('OPTIONS', '/api/events', null, foreignHeaders);
  assert.equal(response.status, 403);
}
{
  const response = await request('OPTIONS', '/api/events', null, allowedHeaders);
  assert.equal(response.status, 204);
  assert.equal(response.headers.get('access-control-allow-origin'), 'https://xn--80alhhq.xn--p1ai');
}
{
  const response = await request('POST', '/v1/events', JSON.stringify(validEvent), allowedHeaders);
  assert.equal(response.status, 404);
}
{
  const response = await request('GET', '/api/events', null, allowedHeaders);
  assert.equal(response.status, 405);
}
{
  const response = await request('POST', '/api/events', '{invalid', allowedHeaders);
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, 'invalid_json');
}
{
  const response = await request('POST', '/api/events', JSON.stringify(Array.from({ length: 11 }, () => validEvent)), allowedHeaders);
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, 'invalid_event_count');
}
{
  const response = await request('POST', '/api/events', 'x'.repeat(8200), allowedHeaders);
  assert.equal(response.status, 413);
}
{
  const response = await request('POST', '/api/events', JSON.stringify({ ...validEvent, event_type: 'navigation_click' }), allowedHeaders);
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, 'schema_validation_failed');
}
{
  const response = await request('POST', '/api/events', JSON.stringify(validEvent), allowedHeaders);
  assert.equal(response.status, 202);
  assert.equal((await response.json()).accepted, 1);
}
{
  const response = await worker.fetch(new Request('https://collector.example/api/events', {
    method: 'POST', body: JSON.stringify(validEvent), headers: allowedHeaders,
  }), createRateLimiterEnv({ allowed: false, retry_after: 17 }));
  assert.equal(response.status, 429);
  assert.equal(response.headers.get('retry-after'), '17');
}
{
  const env = createRateLimiterEnv();
  env.DB = { prepare: () => ({ bind: () => ({}) }), batch: async () => { throw new Error('D1 unavailable'); } };
  const response = await worker.fetch(new Request('https://collector.example/api/events', {
    method: 'POST', body: JSON.stringify(validEvent), headers: allowedHeaders,
  }), env);
  assert.equal(response.status, 503);
}
{
  const calls = [];
  const env = { RETENTION_DAYS: '90', DB: { prepare: (sql) => ({ bind: (cutoff) => ({ run: async () => { calls.push({ sql, cutoff }); return { success: true, meta: { changes: 3 } }; } }) }) } };
  const result = await purgeExpiredAggregates(env, new Date('2026-09-02T00:00:00.000Z'));
  assert.equal(result.cutoff, '2026-06-04');
  assert.equal(result.retentionDays, 90);
  assert.equal(calls.length, 1);
}

console.log('PASS: Cloudflare collector contract + rate-limit + HTTP + retention tests');
