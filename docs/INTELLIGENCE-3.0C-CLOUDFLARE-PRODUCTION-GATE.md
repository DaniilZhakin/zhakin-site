# Intelligence 3.0-C — Cloudflare Production Gate

**Status: PRE-PRODUCTION / deployment OFF**

This checklist defines the account-level controls that must be verified before the independent Cloudflare collector can receive production browser events.

## Target topology

`жакин.рф / GitHub Pages → HTTPS Cloudflare Worker → schema validation → CORS + payload limits + abuse protection → D1 aggregate storage`

The Durable Object rate limiter is used for request-window coordination. The public site remains operational if the collector is unavailable.

## Mandatory gates

- [ ] Cloudflare account ownership and administrative control confirmed.
- [ ] Worker runtime and production endpoint ownership confirmed.
- [ ] D1 database `zhakin-intelligence` created under the controlled account.
- [ ] D1 binding `DB` configured with the real database ID; no placeholder remains.
- [ ] SQLite-backed Durable Object namespace for `RateLimiter` created and bound.
- [ ] Production Worker endpoint is HTTPS-only.
- [ ] Production origin is restricted to `https://xn--80alhhq.xn--p1ai`.
- [ ] Foreign `Origin` requests return `403 cors_forbidden`.
- [ ] Only `POST /v1/events` and the required `OPTIONS` preflight are exposed.
- [ ] Request body limit of 8192 bytes is enforced.
- [ ] Maximum of 10 events per request is enforced.
- [ ] Exact schema and schema version `3.0` are enforced server-side.
- [ ] Durable Object rate limiting is provider-backed and atomic for the production topology.
- [ ] D1 stores aggregate counters only; raw event payloads are not retained.
- [ ] No IP address, fingerprint, raw form data, email, phone, advertising ID, cross-site identifier, credential, or API key is persisted by the collector.
- [ ] Retention period for aggregate data is explicitly approved and documented.
- [ ] Access to D1 and operational logs is restricted to authorized administrators.
- [ ] Backup/export and recovery procedure is documented and tested.
- [ ] Storage failure returns a controlled `503 storage_unavailable` response.
- [ ] Rate-limit, CORS, payload, schema, invalid JSON, invalid route/method, and storage-failure boundaries are tested.
- [ ] Production endpoint is independently verified from outside the deployment environment.
- [ ] Only after all gates above pass: browser transport may be enabled in the public site.

## Non-negotiable safety rules

1. No production credentials or provider secrets are committed to the public repository.
2. No browser secret is required to submit anonymous events.
3. The site must not fail closed because analytics is unavailable.
4. The reference collector remains provider-neutral and non-production.
5. Deployment is not considered complete until the real account configuration and endpoint have been independently verified.

## Current implementation state

The repository contains a Cloudflare Worker reference implementation, D1 migration, Durable Object rate limiter, package configuration, and CI validation. These files are preparation artifacts only. They do not constitute a production deployment.

The schema contract remains the source of truth at `docs/intelligence-3.0-collector-contract.schema.json`.
