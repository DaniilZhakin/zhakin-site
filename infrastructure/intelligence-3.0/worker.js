const ALLOWED_ORIGIN = 'https://xn--80alhhq.xn--p1ai';
const MAX_BODY_BYTES = 8 * 1024;
const ALLOWED_EVENTS = new Set([
  'page_view',
  'navigation_click',
  'menu_toggle',
  'outbound_click',
  'contact_interest',
  'contact_action',
]);

function corsHeaders(origin) {
  const allowed = origin === ALLOWED_ORIGIN;
  return {
    'Access-Control-Allow-Origin': allowed ? ALLOWED_ORIGIN : 'null',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

function json(body, status, origin) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...corsHeaders(origin),
      'Cache-Control': 'no-store',
    },
  });
}

function validEvent(event) {
  if (!event || typeof event !== 'object' || Array.isArray(event)) return false;
  const allowed = new Set([
    'event_type', 'path', 'timestamp', 'referrer_class', 'content_id', 'schema_version',
  ]);
  if (Object.keys(event).some((key) => !allowed.has(key))) return false;
  if (!ALLOWED_EVENTS.has(event.event_type)) return false;
  if (event.schema_version !== '3.0') return false;
  if (typeof event.path !== 'string' || !/^\/[^?#]*$/.test(event.path) || event.path.length > 512) return false;
  if (event.timestamp !== undefined && (typeof event.timestamp !== 'string' || event.timestamp.length > 64)) return false;
  if (event.referrer_class !== undefined && !['internal', 'search', 'social', 'direct', 'other'].includes(event.referrer_class)) return false;
  if (event.content_id !== undefined && (typeof event.content_id !== 'string' || !/^[A-Za-z0-9._-]+$/.test(event.content_id) || event.content_id.length > 128)) return false;
  return true;
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    if (request.method === 'OPTIONS') {
      if (origin !== ALLOWED_ORIGIN) return new Response(null, { status: 403, headers: corsHeaders(origin) });
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }
    if (request.method !== 'POST' || origin !== ALLOWED_ORIGIN) {
      return json({ error: 'forbidden' }, 403, origin);
    }

    const contentLength = Number(request.headers.get('Content-Length') || 0);
    if (contentLength > MAX_BODY_BYTES) return json({ error: 'payload_too_large' }, 413, origin);

    const body = await request.text();
    if (new TextEncoder().encode(body).byteLength > MAX_BODY_BYTES) {
      return json({ error: 'payload_too_large' }, 413, origin);
    }

    let event;
    try {
      event = JSON.parse(body);
    } catch {
      return json({ error: 'invalid_json' }, 400, origin);
    }
    if (!validEvent(event)) return json({ error: 'invalid_event' }, 400, origin);

    // Production requirement: enforce edge rate limiting before this point and
    // persist only the allow-listed fields plus server receipt time.
    const sanitized = {
      event_type: event.event_type,
      path: event.path,
      timestamp: new Date().toISOString(),
      ...(event.referrer_class ? { referrer_class: event.referrer_class } : {}),
      ...(event.content_id ? { content_id: event.content_id } : {}),
      schema_version: '3.0',
    };

    // Reference mode intentionally returns the validated event instead of
    // writing production data. Replace with aggregate storage only after gate closure.
    if (!env || !env.INTELLIGENCE_3_0_ENABLED) {
      return json({ accepted: true, mode: 'reference', event: sanitized }, 202, origin);
    }

    // Bind an approved aggregate storage implementation here after production review.
    return json({ accepted: true, mode: 'production', event: sanitized }, 202, origin);
  },
};
