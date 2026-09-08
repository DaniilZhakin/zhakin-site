# Intelligence 3.0-A — Architecture Decision

## Status

**3.0-A implemented — architecture gate completed.**

This stage freezes the collector contract and records the backend selection criteria before any centralized collection is enabled.

## 1. Decision

For the next implementation stage, use a **separate server-side collector boundary** rather than placing analytics logic or secrets in the static public site.

The implementation target is **Cloudflare Worker + D1/KV**, subject to account/runtime availability and a production deployment check before activation.

The public GitHub repository remains the presentation layer. No analytics secret is permitted in frontend JavaScript.

## 2. Why this target

- isolates ingestion from the static website;
- supports HTTPS and server-side validation at the edge;
- provides a compact storage boundary for aggregate analytics;
- allows rate limiting and abuse controls without changing the public site's hosting model;
- keeps raw event handling outside the public repository;
- preserves the ability to export aggregate data if the platform changes later.

## 3. Frozen collector contract

Accepted fields:

- `event_type` — required allow-listed event name;
- `path` — required normalized site path;
- `timestamp` — client timestamp accepted only as a signal; server timestamp is authoritative;
- `referrer_class` — optional normalized non-identifying class;
- `content_id` — optional site-defined identifier;
- `schema_version` — required contract version.

Unknown fields must be rejected.

### Allow-listed event types

The initial vocabulary is intentionally bounded:

- `page_view`
- `navigation`
- `menu_interaction`
- `outbound_click`
- `contact_interest`
- `contact_action`

Any future event type requires an explicit contract revision.

## 4. Privacy boundary

The collector must not store by default:

- IP addresses;
- browser fingerprints;
- advertising identifiers;
- cross-site identifiers;
- email addresses or phone numbers;
- raw contact/form contents;
- credentials, tokens or API keys from the browser.

Raw events must have a documented short retention period. Aggregate metrics may be retained longer where operationally justified.

## 5. Required production controls

Before activation, the collector must demonstrate:

1. HTTPS-only ingestion;
2. strict CORS allow-list for `https://xn--80alhhq.xn--p1ai` and the canonical public origin;
3. schema validation and unknown-field rejection;
4. payload size limits;
5. rate limiting / abuse protection;
6. authoritative server-side timestamps;
7. no client-side secrets;
8. restricted access to analytics data;
9. documented retention/deletion behavior;
10. monitoring and failure reporting.

## 6. Alternatives considered

| Option | Decision | Reason |
|---|---|---|
| Cloudflare Worker + D1/KV | **Target** | strong separation, edge ingestion, compact operational surface |
| Supabase | Deferred | capable, but broader platform surface than required for the initial collector |
| REG.RU / ISPmanager backend | Deferred | operationally attractive, but runtime/API capability must be verified before selection |
| Vercel/serverless | Deferred | adds another hosting dependency without a current architectural need |

## 7. Rollout gate

3.0-B may begin only after the target runtime/account is available and the collector can be deployed without exposing secrets in the public repository.

No production event collection is enabled by this document alone.

## 8. Verification requirement

3.0-A is considered complete only when this document is committed and the next stage can reference this frozen contract. **Production readiness is not claimed here.**
