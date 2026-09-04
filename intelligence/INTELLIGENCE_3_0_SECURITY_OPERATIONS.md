# Intelligence 3.0 — Security & Operations Gate

## Purpose

This document defines the operational gate for the independent intelligence contour around `жакин.рф`.

The collector is an optional service. Failure of the collector, D1, Durable Object or provider must never prevent the public static site from rendering or serving its SEO assets.

## Security controls

- **Origin control:** browser requests are accepted only from the canonical production origin configured by `ALLOWED_ORIGIN`.
- **Method control:** the public collector endpoint accepts only `POST /v1/events`; preflight uses `OPTIONS`.
- **Content-type control:** event ingestion requires `application/json`.
- **Payload control:** request bodies are capped at 8192 bytes and batches at 10 events.
- **Schema control:** unknown fields, unsupported event types, invalid paths, invalid timestamps, invalid referrer classes and invalid content identifiers are rejected.
- **Abuse control:** a Durable Object rate limiter caps the collector at 30 requests per 60 seconds.
- **Privacy control:** only aggregate daily counters are stored; IP addresses, fingerprints, credentials and raw form data are excluded from the intelligence store.
- **Retention control:** aggregate records have a configurable positive retention period, defaulting to 90 days.
- **Response hardening:** JSON responses use `nosniff` and `no-store` headers.
- **Secret control:** Cloudflare credentials, tokens and the real D1 database ID remain outside source control.

## Operational verification before production

1. Confirm Cloudflare account and zone ownership.
2. Confirm authoritative DNS control for the intended Worker hostname.
3. Create the production D1 database outside GitHub.
4. Apply the migration and verify the resulting schema.
5. Deploy the Worker to a non-production endpoint first.
6. Run positive, negative, burst-rate and failure-mode tests independently.
7. Verify that logs contain no prohibited personal data.
8. Verify retention deletion against real aggregate rows.
9. Export/backup the D1 data and perform a recovery test.
10. Verify Worker rollback and restore procedure.
11. Only after all gates pass, connect browser transport from the public site.

## Failure-mode requirements

### Collector unavailable

The website remains fully functional. Browser analytics may be absent; navigation, content, SEO, sitemap and public reception architecture remain unaffected.

### D1 unavailable

The collector returns a controlled `503` storage error. No partial public-site dependency is introduced.

### Rate limiter unavailable

Production deployment must treat the failure as a release blocker until the abuse boundary is independently verified.

### DNS/provider outage

Do not change production DNS until the replacement endpoint has passed independent health, security and recovery verification.

## Release rule

No production browser transport is permitted while any required gate above remains unverified. The current branch therefore contains the architecture and controls, but intentionally does not activate production collection.
