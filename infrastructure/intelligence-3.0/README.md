# Intelligence 3.0 — Independent Collector Reference

This directory contains a deployment-ready reference for the external engagement collector. It is intentionally **not wired into the public site** until the production gate in `docs/INTELLIGENCE-3.0B-IMPLEMENTATION-GATE.md` is closed.

## Target architecture

`жакин.рф (GitHub Pages) → HTTPS edge collector → validation → rate limit → aggregate storage`

The collector is an observability layer. The public site must continue to work when it is unavailable.

## Security boundary

- HTTPS only.
- CORS allow-list: `https://xn--80alhhq.xn--p1ai`.
- JSON body limit: 8 KiB.
- Only the frozen Intelligence 3.0 event fields are accepted.
- Unknown fields and event types are rejected.
- Server receipt time is authoritative.
- No IP address, fingerprint, advertising ID, raw form content, email, phone, credential or secret is stored.
- Rate limiting is required at the edge before persistence.

## Deployment model

The reference implementation is compatible with an edge-worker runtime such as Cloudflare Workers. It is a **reference deployment unit**, not a production endpoint. Provider credentials, bindings, retention configuration and production routing remain outside this repository until operational ownership and data-control requirements are approved.

## Production gate

Do not connect `assets/js/main.js` to this endpoint until all 3.0-B gates are verified: runtime ownership, provider selection, HTTPS, schema validation, CORS, request-size controls, rate limiting, aggregate storage, reconciliation, and failure/abuse tests.
