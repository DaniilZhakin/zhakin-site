# жакин.рф — Security & Operations Checklist

## Purpose

Operational gate for Intelligence 3.0 before any production collector activation or browser transport.

## Security controls

- [ ] Production Worker hostname/path is restricted to the intended route.
- [ ] CORS allows only the canonical site origin.
- [ ] `Content-Type: application/json` is required for event ingestion.
- [ ] Payload size is capped at 8192 bytes.
- [ ] Batch size is capped at 10 events.
- [ ] Event schema rejects unknown fields and invalid values.
- [ ] Durable Object rate limit is verified under burst traffic.
- [ ] HTTP responses use `Cache-Control: no-store` and `X-Content-Type-Options: nosniff`.
- [ ] No credentials, tokens, IP addresses, fingerprints or raw form data are stored.

## Operations

- [ ] Retention period is explicitly configured and deletion is verified.
- [ ] D1 backup/export procedure is documented and tested.
- [ ] D1 recovery is tested against a disposable replacement database.
- [ ] Worker rollback procedure is tested.
- [ ] Failure of Worker/D1/DO does not affect static site rendering.
- [ ] Monitoring distinguishes collector health from public-site availability.
- [ ] Production deployment is independently smoke-tested after release.

## Production gate

Production activation remains blocked until every required control above is evidenced by tests or operational verification. The public site must remain functional without the intelligence collector.
