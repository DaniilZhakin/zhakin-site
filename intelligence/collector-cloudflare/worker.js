/**
 * ZHAKIN SITE — Intelligence 3.0 independent collector
 * Provider: Cloudflare Workers + D1 + SQLite-backed Durable Object
 *
 * Production deployment remains gated until the account, ownership,
 * retention, access, CORS, abuse and independent verification gates are approved.
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
const RATE_LIMIT_MAX_REQUESTS = 30;
const RATE_LIMIT_WINDOW_MS = 60_000;
const DEFAULT_RETENTION_DAYS = 90;

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

export function validateEvent(event) {
  if (!event || typeof event !== 'object' || Array.isArray(event)) return 'event must be an object';

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

  // Keep runtime validation aligned with the JSON Schema date-time contract.
  // Date.parse alone is intentionally not used because it accepts date-only
  // strings such as 2026-09-02, which are not RFC 3339 date-time values.
  if (event.timestamp !== undefined &&
      (typeof event.timestamp !== 'string' ||
       event.timestamp.length > 64 ||
       !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(event.timestamp) ||
       Number.isNaN(Date.parse(event.timestamp)))) {
    return 'invalid timestamp';
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

function getAllowedOrigin(env) {
  return env.ALLOWED_ORIGIN || 'https://xn--80alhhq.xn--p1ai';
}

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin');
  const allowedOrigin = getAllowedOrigin(env);
  const headers = { vary: 'Origin' };
  if (origin === allowedOrigin) headers['access-control-allow-origin'] = origin;
  return headers;
}

function isAllowedOrigin(request, env) {
  const origin = request.headers.get('Origin');
  return !origin || origin === getAllowedOrigin(env);
}

function validateRequestSize(request, raw) {
  const contentLength = Number(request.headers.get('content-length') || 0);
  if (contentLength > MAX_BODY_BYTES) return false;
  return new TextEncoder().encode(raw).byteLength <= MAX_BODY_BYTES;
}

function dayFromReceipt(receivedAt) {
  return receivedAt.slice(0, 10);
}

export function getRetentionDays(env) {
  const configured = Number.parseInt(env.RETENTION_DAYS, 10);
  return Number.isInteger(configured) && configured > 0 ? configured : DEFAULT_RETENTION_DAYS;
}

export function getRetentionCutoff(now = new Date(), retentionDays = DEFAULT_RETENTION_DAYS) {
  const cutoff = new Date(now.getTime());
  cutoff.setUTCDate(cutoff.getUTCDate() - retentionDays);
  return cutoff.toISOString().slice(0, 10);
}

async function consumeRateLimit(env) {
  const id = env.RATE_LIMITER.idFromName('global');
  const limiter = env.RATE_LIMITER.get(id);
  return limiter.fetch('https://rate-limit/consume');
}

export class RateLimiter {
  constructor(ctx) {
    this.ctx = ctx;
  }

  async fetch(request) {
    if (new URL(request.url).pathname !== '/consume') {
      return new Response('Not Found', { status: 404 });
    }

    const now = Date.now();
    const state = (await this.ctx.storage.get('window')) || { start: now, count: 0 };
    const windowExpired = now - state.start >= RATE_LIMIT_WINDOW_MS;
    const windowStart = windowExpired ? now : state.start;
    const count = windowExpired ? 0 : state.count;

    if (count >= RATE_LIMIT_MAX_REQUESTS) {
      const retryAfter = Math.max(1, Math.ceil((windowStart + RATE_LIMIT_WINDOW_MS - now) / 1000));
      return json({ allowed: false, retry_after: retryAfter });
    }

    await this.ctx.storage.put('window', { start: windowStart, count: count + 1 });
    return json({ allowed: true, remaining: RATE_LIMIT_MAX_REQUESTS - count - 1 });
  }
}

async function aggregateEvents(env, events, receivedAt) {
  if (!env.DB) throw new Error('DB binding is not configured');

  const eventDay = dayFromReceipt(receivedAt);
  const statements = events.map((event) => {
    const referrerClass = event.referrer_class || 'other';
    const contentId = event.content_id || null;
    return env.DB.prepare(`
      INSERT INTO engagement_daily
        (event_day, event_type, path, content_id, referrer_class, event_count)
      VALUES (?, ?, ?, ?, ?, 1)
      ON CONFLICT(event_day, event_type, path, content_id, referrer_class)
      DO UPDATE SET event_count = event_count + 1
    `).bind(eventDay, event.event_type, event.path, contentId, referrerClass);
  });

  await env.DB.batch(statements);
}

export async function purgeExpiredAggregates(env, now = new Date()) {
  if (!env.DB) throw new Error('DB binding is not configured');

  const retentionDays = getRetentionDays(env);
  const cutoff = getRetentionCutoff(now, retentionDays);
  const result = await env.DB.prepare(
    'DELETE FROM engagement_daily WHERE event_day < ?'
  ).bind(cutoff).run();

  return { cutoff, retentionDays, result };
}

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request, env);

    if (!isAllowedOrigin(request, env)) {
      return json({ error: 'cors_forbidden' }, 403, cors);
    }

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

    const rateResponse = await consumeRateLimit(env);
    const rate = await rateResponse.json();
    if (!rate.allowed) {
      return json({ error: 'rate_limited' }, 429, {
        ...cors,
        'retry-after': String(rate.retry_after),
      });
    }

    const raw = await request.text();
    if (!validateRequestSize(request, raw)) {
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

    // Server receipt time is authoritative. Client timestamps are never used
    // for ordering, retention or operational metrics.
    const receivedAt = new Date().toISOString();

    try {
      await aggregateEvents(env, events, receivedAt);
    } catch {
      return json({ error: 'storage_unavailable' }, 503, cors);
    }

    // Only aggregate anonymous counters are persisted. No IP, fingerprint,
    // raw form content, email, phone, ad IDs or cross-site identifiers.
    return json({ accepted: events.length, received_at: receivedAt }, 202, cors);
  },

  async scheduled(controller, env) {
    // Retention cleanup is scheduled infrastructure, not an HTTP endpoint.
    // The cron is configured in wrangler.jsonc and only becomes active after
    // an explicitly approved production deployment.
    await purgeExpiredAggregates(env, new Date(controller.scheduledTime));
  },
};
