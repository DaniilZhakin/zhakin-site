# Browser analytics transport — staged, not connected

This module is a preparation layer for the Intelligence 3.0 event contract. It is intentionally **not imported by `assets/js/main.js` and is not enabled on the live site**.

## Fail-closed rules

- No event is sent unless a caller supplies an explicit affirmative consent state (`hasConsent: true` or a function returning exactly `true`).
- No event is sent without an explicitly configured HTTPS endpoint at the same origin as the page, with the exact path `/v1/events` and no query or fragment.
- The current site has no approved consent interface and the production collector is not deployed/configured; do not connect this module until those prerequisites are reviewed and completed.
- Payloads use an allowlist only: `event_type`, `path`, `schema_version`, and optional `timestamp`, `referrer_class`, `content_id`.
- Query strings, URL fragments, external paths, page titles, link labels, hostnames, form contents, arbitrary event properties, and unknown event types are not transmitted.
- Browser events are mapped to the canonical contract: `navigation_click` → `navigation`, `menu_toggle` → `menu_interaction`.
- Fetch uses `credentials: omit` and `cache: no-store`. Network failures return `false` and do not throw into site UI code.

## Example (tests only)

```js
const transport = ZhakinAnalyticsTransport.createTransport({
  endpoint: 'https://xn--80alhhq.xn--p1ai/v1/events',
  hasConsent: () => consentState === 'accepted',
  origin: window.location.origin
});

await transport.send({
  type: 'page_view',
  path: window.location.pathname,
  timestamp: new Date().toISOString()
});
```

Do not copy this example into production until the consent interface, policy wording, collector deployment, endpoint health checks, retention/access controls, and abuse tests have been independently reviewed.

## Tests

Run `npm test` from this directory with Node.js 20 or newer. The tests use a stubbed fetch function and do not make network requests.
