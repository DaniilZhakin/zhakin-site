# Intelligence 3.0 — Production Security Checklist

## Pre-deployment

- [ ] Provider/runtime owner confirmed.
- [ ] Data controller and retention policy confirmed.
- [ ] Dedicated HTTPS endpoint provisioned outside GitHub Pages.
- [ ] Production route is not exposed from the public repository until approval.

## Edge controls

- [ ] `Origin` restricted to `https://xn--80alhhq.xn--p1ai`.
- [ ] `POST` and `OPTIONS` only.
- [ ] Request body limited to 8 KiB.
- [ ] Rate limiting enabled at edge.
- [ ] Abuse/anomaly threshold and alerting configured.

## Validation

- [ ] `additionalProperties=false` contract enforced.
- [ ] Required fields: `event_type`, `path`, `schema_version`.
- [ ] Event enum enforced.
- [ ] Path and content identifier constraints enforced.
- [ ] Server-side timestamp used as authoritative timestamp.

## Privacy

- [ ] No IP persistence.
- [ ] No browser fingerprinting.
- [ ] No advertising/cross-site identifiers.
- [ ] No raw form contents.
- [ ] No email/phone values in events.
- [ ] No credentials or secrets.

## Operations

- [ ] Aggregate storage configured.
- [ ] Retention/deletion tested.
- [ ] Reconciliation check implemented.
- [ ] Collector failure does not affect page rendering.
- [ ] Failure, malformed payload, CORS, oversize, and abuse tests pass.
- [ ] Browser transport enabled only after all gates above are complete.
