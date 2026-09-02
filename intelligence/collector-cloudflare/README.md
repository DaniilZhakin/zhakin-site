# Intelligence 3.0 — Independent Cloudflare Collector

This directory contains the first provider-specific implementation of the independent Intelligence 3.0 collector.

## Architecture

`жакин.рф / GitHub Pages → HTTPS Worker → schema validation → CORS + payload limits → SQLite-backed Durable Object rate limiter → D1 aggregate store → intelligence metrics`

The public website remains static. The collector is an isolated external service and is designed so the site remains functional if the collector is unavailable.

## Data model

The collector stores **aggregate anonymous counters only** in D1. It does not persist:

- IP addresses
- browser fingerprints
- raw forms
- email addresses or phone numbers
- advertising IDs
- cross-site tracking identifiers
- credentials or API keys
- client timestamps for ordering or retention

The client timestamp is accepted only because it is part of the frozen 3.0 contract; server receipt time is authoritative.

## Abuse protection

A SQLite-backed Durable Object provides a serialized rate-limit boundary. The reference limit is 30 requests per 60 seconds for the collector as a whole. This is intentionally conservative until production traffic characteristics are measured.

## Production gate

**Do not deploy yet.** Before deployment, all of the following must be confirmed outside GitHub:

1. Cloudflare account and Worker/D1/DO ownership.
2. Real D1 database ID configured in `wrangler.jsonc`.
3. Production hostname and HTTPS endpoint.
4. Retention/deletion policy and restricted dashboard access.
5. CORS allow-list verified against the production site.
6. Rate-limit behavior tested under abuse/failure conditions.
7. D1 migration applied and aggregate reconciliation tested.
8. Backup/export and recovery procedure verified.
9. Independent production verification completed.
10. Only then: browser transport may be enabled in the public site.

No Cloudflare credentials, tokens or private endpoints belong in this repository.

## Local validation

From this directory:

```text
npm install
npm run d1:migrations:apply:local
npm run dev
```

The production database must never be used for local testing. Use the local D1 workflow until the production gates are approved.

## Deployment direction

Cloudflare is the current primary provider candidate, not a permanent architectural lock-in. The event contract remains provider-neutral, so the collector can be moved to another runtime without changing the public event schema.
