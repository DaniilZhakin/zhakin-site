# ZHAKIN SITE — Intelligence 3.0 Implementation Baseline

**Status:** FROZEN / PRODUCTION OFF  
**Date:** 2026-09-08

## Purpose

This document prevents parallel or conflicting Intelligence 3.0 collector implementations from being treated as separate production systems.

## Canonical implementation

The canonical collector implementation is:

- `intelligence/collector-cloudflare/worker.js`
- `intelligence/collector-cloudflare/wrangler.jsonc`
- `intelligence/collector-cloudflare/migrations/0000_create_engagement_daily.sql`
- `intelligence/collector-cloudflare/worker.test.js`

This contour is the reference implementation for the next runtime verification stage.

## Security baseline

The collector:

- accepts only an explicit allow-list of event types and fields;
- validates paths, schema version, referrer class and content ID;
- limits request size and event count;
- applies a Cloudflare Durable Object rate limiter;
- uses server receipt time as the authoritative time;
- stores only aggregate daily counters in D1;
- does not persist IP addresses, fingerprints, email, phone, advertising IDs, cross-site identifiers, raw forms, credentials, tokens or API keys;
- applies a retention period to aggregate data;
- rejects requests from origins outside the configured site origin.

## Endpoint

The canonical endpoint is `POST /v1/events`.

The earlier 3.0-B skeleton used `POST /api/events`. That endpoint is **not** production-canonical and must not be wired into the site.

## Production gate

Production collection remains OFF until all of the following are factually verified:

1. A real Cloudflare Worker runtime is available.
2. A real D1 database is bound.
3. The Durable Object rate limiter is deployed and functioning.
4. The migration creates the expected aggregate table.
5. Positive and negative tests pass against the real deployed endpoint.
6. CORS behavior is verified from the production site.
7. No secrets or personal data are exposed or persisted.
8. Retention cleanup is verified.
9. Independent production smoke test passes.

## Rule

No `PASS` status may be assigned to Intelligence 3.0-B/3.0-C from repository presence alone. Repository code is preparation; production readiness requires an actual runtime test.
