# Intelligence 3.0 — reference collector

Status: **NON-PRODUCTION**.

This directory contains a provider-neutral reference implementation for the centralized event collector defined by `docs/INTELLIGENCE-3.0A-PROVIDER-DECISION.md` and `docs/INTELLIGENCE-3.0B-IMPLEMENTATION-GATE.md`.

## Endpoint contract

- `POST /v1/events`
- `OPTIONS /v1/events` for CORS preflight
- JSON object or batch array
- maximum 10 events per request
- maximum request body: 8 KiB
- exact allow-list of event fields
- six allowed event types
- `schema_version` must equal `3.0`
- server receipt time is authoritative
- unknown fields and invalid values are rejected

## Security posture

The reference implementation deliberately does **not** connect to the public site. Before production use, the deployment must add a real rate limiter, approved persistent aggregate storage, retention/deletion controls, restricted operator access, monitoring and abuse/failure tests.

No IP address, fingerprint, raw form content, advertising identifier, cross-site identifier, credential or frontend secret is accepted as part of the event contract.

## Production gate

Do not add a production collector URL to `assets/js/main.js` until the provider/runtime and data-control decisions are explicitly approved and the implementation gate is closed.
