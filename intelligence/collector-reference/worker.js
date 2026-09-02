/**
 * ZHAKIN SITE — Intelligence 3.0 reference collector
 *
 * NON-PRODUCTION REFERENCE IMPLEMENTATION.
 * Do not deploy or connect the public site until the provider/runtime,
 * data-control, retention and security gates in docs/INTELLIGENCE-3.0B-IMPLEMENTATION-GATE.md are approved.
 */

const ALLOWED_EVENTS = new Set([
  'page_view',
  'navigation_click',
  'menu_toggle',
  'outbound_click',
  'contact_interest',
  'contact_action',
]);

const ALLOWED_FIELDS = new Set([
  'event_type',
  'path',
  'timestamp',
  'referrer_class',
  'content_id',
  'schema_version',
]);

const REFERRER_CLASSES = new Set([
  'internal',
  'search',
  'social',
  'direct',
  'other',
]);

const MAX_BODY_BYTES = 8192;
const MAX_EVENTS_PER_REQUEST = 10;

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...extraHeaders,
    },
  });
}

function validateEvent(event) {
  if (!event || typeof event !== 'object' || Array.isArray(event)) {
    return 'event must be an object';
  }

  for (const key of Object.keys(event)) {
    if (!ALLOWED_FIELDS.has(key)) return `unexpected field: ${key}`;
  }

  for (const key of ['event_type', 'path', 'schema_version']) {
    if (!(key in event)) return `missing field: ${key}`;
  }

  if (!ALLOWED_EVENTS.has(event.event_type)) return 'invalid event_type';
  if (event.schema_version !== '3.0') return 'invalid schema_version';
  if (typeof event.path !== 'string' || event.path.length > 512 || !/^\/[^?#]*$/.test(event.path)) {
    return 'invalid path';
  }

  if (event.timestamp !== undefined) {
    if (typeof event.timestamp !== 'string' || event.timestamp.length > 64 || Number.isNaN(Date.parse(event.timestamp))) {
      return 'invalid timestamp';
    }
  }

  if (event.referrer_class !== undefined &&
      (typeof event.referrer_class !== 'string' ||
       event.referrer_class.length > 32 ||
       !REFERRER_CLASSES.has(event.referrer_class))) {
    return 'invalid referrer_class';
  }

  if (event.content_id !== undefined &&
      (typeof event.content_id !== 'string' ||
       event.content_id.length > 128 ||
       !/^[A-Za-z0-9._-]+$/.test(event.content_id))) {
    return 'invalid content_id';
  }

  return null;
}

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin');
  const allowedOrigin = env.ALLOWED_ORIGIN || 'https://xn--80alhhq.xn--p1ai';
  const headers = { 'vary': 'Origin' };
  if (origin === allowedOrigin) headers['access-control-allow-origin'] = origin;
  return headers;
}

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request, env);

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          ...cors,
          'access-control-allow-methods': 'POST, OPTIONS',
          'access-control-allow-headers': 'content-type',
          'access-control-max-age': '600',
        },
      });
    }

    const url = new URL(request.url);
    if (url.pathname !== '/v1/events' || request.method !== 'POST') {
      return json({ error: 'not_found' }, 404, cors);
    }

    const contentLength = Number(request.headers.get('content-length') || 0);
    if (contentLength > MAX_BODY_BYTES) {
      return json({ error: 'payload_too_large' }, 413, cors);
    }

    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) {
      return json({ error: 'payload_too_large' }, 413, cors);
    }

    let payload;
    try {
      payload = JSON.parse(raw);
    } catch {
      return json({ error: 'invalid_json' }, 400, cors);
    }

    const events = Array.isArray(payload) ? payload : [payload];
    if (events.length < 1 || events.length > MAX_EVENTS_PER_REQUEST) {
      return json({ error: 'invalid_event_count' }, 400, cors);
    }

    for (const event of events) {
      const error = validateEvent(event);
      if (error) return json({ error: 'schema_validation_failed', detail: error }, 400, cors);
    }

    // The server receipt time is authoritative. Do not trust client timestamps
    // for ordering, retention or operational metrics.
    const receivedAt = new Date().toISOString();

    // Reference-only sink. A production implementation must persist only the
    // approved aggregate/anonymous data model after retention and access rules
    // are explicitly approved. Never persist raw forms, IP addresses,
    // fingerprints, credentials or cross-site identifiers.
    if (env.EVENT_SINK && typeof env.EVENT_SINK.put === 'function') {
      const key = `batch:${receivedAt}:${crypto.randomUUID()}`;
      await env.EVENT_SINK.put(key, JSON.stringify({ received_at: receivedAt, events }));
    }

    return json({ accepted: events.length, received_at: receivedAt }, 202, cors);
  },
};
