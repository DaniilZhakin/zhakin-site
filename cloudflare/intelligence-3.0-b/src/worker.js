const ALLOWED_EVENTS = new Set([
  'page_view',
  'navigation',
  'menu_interaction',
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

const ALLOWED_ORIGINS = new Set([
  'https://xn--80alhhq.xn--p1ai',
  'https://жакин.рф',
]);

const MAX_BODY_BYTES = 4096;
const MAX_PATH_LENGTH = 512;
const MAX_TEXT_LENGTH = 256;

function json(data, status = 200, origin = '') {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...(origin ? {
        'access-control-allow-origin': origin,
        'access-control-allow-methods': 'POST, OPTIONS',
        'access-control-allow-headers': 'content-type',
        'vary': 'Origin',
      } : {}),
    },
  });
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validShortText(value, max = MAX_TEXT_LENGTH) {
  return value === undefined || value === null || (typeof value === 'string' && value.length <= max);
}

function validateEvent(payload) {
  if (!isPlainObject(payload)) return 'invalid_payload';

  const keys = Object.keys(payload);
  if (keys.some((key) => !ALLOWED_FIELDS.has(key))) return 'unknown_field';
  if (!ALLOWED_EVENTS.has(payload.event_type)) return 'invalid_event_type';
  if (typeof payload.path !== 'string' || payload.path.length === 0 || payload.path.length > MAX_PATH_LENGTH || !payload.path.startsWith('/')) {
    return 'invalid_path';
  }
  if (!validShortText(payload.referrer_class)) return 'invalid_referrer_class';
  if (!validShortText(payload.content_id)) return 'invalid_content_id';
  if (typeof payload.schema_version !== 'string' || payload.schema_version.length > 32) return 'invalid_schema_version';
  if (payload.timestamp !== undefined && payload.timestamp !== null && typeof payload.timestamp !== 'string') return 'invalid_timestamp';

  // Do not accept obvious PII/secrets in the explicitly bounded text fields.
  const text = JSON.stringify(payload).toLowerCase();
  const forbidden = ['password', 'token', 'api_key', 'apikey', 'secret', '@'];
  if (forbidden.some((term) => text.includes(term))) return 'forbidden_data';

  return null;
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';

    if (request.method === 'OPTIONS') {
      if (!ALLOWED_ORIGINS.has(origin)) return new Response(null, { status: 403 });
      return new Response(null, {
        status: 204,
        headers: {
          'access-control-allow-origin': origin,
          'access-control-allow-methods': 'POST, OPTIONS',
          'access-control-allow-headers': 'content-type',
          'access-control-max-age': '600',
          'vary': 'Origin',
        },
      });
    }

    if (new URL(request.url).pathname !== '/api/events' || request.method !== 'POST') {
      return json({ ok: false, error: 'not_found' }, 404);
    }

    if (!ALLOWED_ORIGINS.has(origin)) {
      return json({ ok: false, error: 'origin_not_allowed' }, 403);
    }

    const contentLength = Number(request.headers.get('Content-Length') || '0');
    if (contentLength > MAX_BODY_BYTES) return json({ ok: false, error: 'payload_too_large' }, 413, origin);

    const body = await request.text();
    if (new TextEncoder().encode(body).byteLength > MAX_BODY_BYTES) {
      return json({ ok: false, error: 'payload_too_large' }, 413, origin);
    }

    let payload;
    try {
      payload = JSON.parse(body);
    } catch {
      return json({ ok: false, error: 'invalid_json' }, 400, origin);
    }

    const validationError = validateEvent(payload);
    if (validationError) return json({ ok: false, error: validationError }, 400, origin);

    // Production rate limiting must be bound to a real Cloudflare runtime mechanism
    // before this Worker is enabled. No client IP is persisted by this implementation.
    if (!env?.DB) {
      return json({ ok: false, error: 'runtime_not_configured' }, 503, origin);
    }

    const receivedAt = new Date().toISOString();
    await env.DB.prepare(`
      INSERT INTO events
        (event_type, path, client_timestamp, referrer_class, content_id, schema_version, received_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(
      payload.event_type,
      payload.path,
      payload.timestamp ?? null,
      payload.referrer_class ?? null,
      payload.content_id ?? null,
      payload.schema_version,
      receivedAt,
    ).run();

    return json({ ok: true }, 202, origin);
  },
};
