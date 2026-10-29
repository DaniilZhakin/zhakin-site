'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createTransport, normalizeEvent } = require('./transport.js');

const ENDPOINT = 'https://collector.example/v1/events';
const ORIGIN = 'https://xn--80alhhq.xn--p1ai';

test('maps browser event names to canonical contract names and strips query/hash', () => {
  const payload = normalizeEvent({
    type: 'navigation_click',
    path: '/publications/example.html?utm_source=secret#details',
    timestamp: '2026-10-29T10:00:00Z',
    referrer_class: 'search',
    content_id: 'publication-1',
    title: 'Private title',
    label: 'Sensitive UI label',
    host: 'external.example',
    form_data: { email: 'private@example.com' }
  }, { origin: ORIGIN });

  assert.deepEqual(payload, {
    event_type: 'navigation',
    path: '/publications/example.html',
    schema_version: '3.0',
    timestamp: '2026-10-29T10:00:00.000Z',
    referrer_class: 'search',
    content_id: 'publication-1'
  });
});

test('maps menu events and allows only the canonical event allowlist', () => {
  assert.equal(normalizeEvent({ type: 'menu_toggle', path: '/' }, { origin: ORIGIN }).event_type, 'menu_interaction');
  assert.equal(normalizeEvent({ type: 'geography_interest', path: '/' }, { origin: ORIGIN }), null);
  assert.equal(normalizeEvent({ type: 'accessibility_text_scale', path: '/' }, { origin: ORIGIN }), null);
});

test('rejects external paths, malformed paths, and invalid content identifiers', () => {
  assert.equal(normalizeEvent({ type: 'page_view', path: 'https://outside.example/path' }, { origin: ORIGIN }), null);
  assert.equal(normalizeEvent({ type: 'page_view', path: '' }, { origin: ORIGIN }), null);

  const payload = normalizeEvent({
    type: 'page_view',
    path: '/?email=private%40example.com',
    content_id: '../not-valid'
  }, { origin: ORIGIN });

  assert.deepEqual(payload, {
    event_type: 'page_view',
    path: '/',
    schema_version: '3.0'
  });
});

test('does not send without explicit consent', async () => {
  let calls = 0;
  const transport = createTransport({
    endpoint: ENDPOINT,
    hasConsent: false,
    origin: ORIGIN,
    fetchImpl: async () => { calls += 1; return { ok: true }; }
  });

  assert.equal(await transport.send({ type: 'page_view', path: '/' }), false);
  assert.equal(calls, 0);
});

test('does not send when endpoint is missing or invalid', async () => {
  let calls = 0;
  const transport = createTransport({
    endpoint: '',
    hasConsent: true,
    origin: ORIGIN,
    fetchImpl: async () => { calls += 1; return { ok: true }; }
  });

  assert.equal(transport.enabled, false);
  assert.equal(await transport.send({ type: 'page_view', path: '/' }), false);
  assert.equal(calls, 0);

  assert.equal(createTransport({
    endpoint: 'http://collector.example/v1/events',
    hasConsent: true,
    fetchImpl: async () => ({ ok: true })
  }).enabled, false);
});

test('sends only normalized contract fields after explicit consent', async () => {
  let captured;
  const transport = createTransport({
    endpoint: ENDPOINT,
    hasConsent: () => true,
    origin: ORIGIN,
    fetchImpl: async (url, options) => {
      captured = { url, options };
      return { ok: true };
    }
  });

  const result = await transport.send({
    type: 'outbound_click',
    path: '/about.html?token=must-not-leak',
    host: 'third-party.example',
    label: 'Do not transmit',
    title: 'Do not transmit',
    channel: 'private-channel'
  });

  assert.equal(result, true);
  assert.equal(captured.url, ENDPOINT);
  assert.equal(captured.options.method, 'POST');
  assert.equal(captured.options.credentials, 'omit');
  assert.equal(captured.options.cache, 'no-store');
  assert.deepEqual(JSON.parse(captured.options.body), {
    event_type: 'outbound_click',
    path: '/about.html',
    schema_version: '3.0'
  });
});

test('fails closed when consent resolver or network request fails', async () => {
  let calls = 0;
  const denied = createTransport({
    endpoint: ENDPOINT,
    hasConsent: () => { throw new Error('consent state unavailable'); },
    fetchImpl: async () => { calls += 1; return { ok: true }; }
  });
  assert.equal(await denied.send({ type: 'page_view', path: '/' }), false);
  assert.equal(calls, 0);

  const unavailable = createTransport({
    endpoint: ENDPOINT,
    hasConsent: true,
    fetchImpl: async () => { throw new Error('network unavailable'); }
  });
  assert.equal(await unavailable.send({ type: 'page_view', path: '/' }), false);
});
