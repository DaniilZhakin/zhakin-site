(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ZhakinAnalyticsTransport = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const SCHEMA_VERSION = '3.0';
  const EVENT_TYPES = Object.freeze({
    page_view: 'page_view',
    navigation_click: 'navigation',
    navigation: 'navigation',
    menu_toggle: 'menu_interaction',
    menu_interaction: 'menu_interaction',
    outbound_click: 'outbound_click',
    contact_interest: 'contact_interest',
    contact_action: 'contact_action'
  });
  const REFERRER_CLASSES = new Set(['internal', 'search', 'social', 'direct', 'other']);
  const CONTENT_ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;
  const DEFAULT_ORIGIN = 'https://xn--80alhhq.xn--p1ai';

  function normalizePath(rawPath, origin) {
    if (typeof rawPath !== 'string' || !rawPath.trim()) return null;
    try {
      const parsed = new URL(rawPath, origin);
      const expectedOrigin = new URL(origin).origin;
      if (parsed.origin !== expectedOrigin) return null;
      const path = parsed.pathname;
      if (!path.startsWith('/') || path.length > 512) return null;
      return path;
    } catch (_) {
      return null;
    }
  }

  function normalizeEvent(rawEvent, options) {
    if (!rawEvent || typeof rawEvent !== 'object' || Array.isArray(rawEvent)) return null;
    const settings = options || {};
    const origin = typeof settings.origin === 'string' ? settings.origin : DEFAULT_ORIGIN;
    const sourceType = typeof rawEvent.type === 'string'
      ? rawEvent.type
      : rawEvent.event_type;
    const eventType = EVENT_TYPES[sourceType];
    if (!eventType) return null;

    const path = normalizePath(rawEvent.path, origin);
    if (!path) return null;

    const payload = {
      event_type: eventType,
      path,
      schema_version: SCHEMA_VERSION
    };

    if (typeof rawEvent.timestamp === 'string' && Number.isFinite(Date.parse(rawEvent.timestamp))) {
      payload.timestamp = new Date(rawEvent.timestamp).toISOString();
    }

    const referrerClass = rawEvent.referrer_class;
    if (REFERRER_CLASSES.has(referrerClass)) payload.referrer_class = referrerClass;

    if (typeof rawEvent.content_id === 'string' && CONTENT_ID_PATTERN.test(rawEvent.content_id)) {
      payload.content_id = rawEvent.content_id;
    }

    return payload;
  }

  function resolveConsent(value) {
    try {
      return typeof value === 'function' ? value() === true : value === true;
    } catch (_) {
      return false;
    }
  }

  function resolveEndpoint(rawEndpoint) {
    if (typeof rawEndpoint !== 'string' || !rawEndpoint.trim()) return null;
    try {
      const url = new URL(rawEndpoint);
      if (url.protocol !== 'https:' || url.pathname !== '/v1/events' || url.search || url.hash) return null;
      return url.href;
    } catch (_) {
      return null;
    }
  }

  function createTransport(options) {
    const settings = options || {};
    const endpoint = resolveEndpoint(settings.endpoint);
    const fetchImpl = typeof settings.fetchImpl === 'function'
      ? settings.fetchImpl
      : (typeof fetch === 'function' ? fetch.bind(globalThis) : null);
    const origin = typeof settings.origin === 'string' ? settings.origin : DEFAULT_ORIGIN;

    return Object.freeze({
      enabled: Boolean(endpoint && fetchImpl),
      async send(rawEvent) {
        if (!endpoint || !fetchImpl || !resolveConsent(settings.hasConsent)) return false;
        const payload = normalizeEvent(rawEvent, { origin });
        if (!payload) return false;

        try {
          const response = await fetchImpl(endpoint, {
            method: 'POST',
            mode: 'cors',
            credentials: 'omit',
            cache: 'no-store',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });
          return Boolean(response && response.ok);
        } catch (_) {
          return false;
        }
      }
    });
  }

  return Object.freeze({
    SCHEMA_VERSION,
    EVENT_TYPES,
    normalizeEvent,
    createTransport
  });
});
