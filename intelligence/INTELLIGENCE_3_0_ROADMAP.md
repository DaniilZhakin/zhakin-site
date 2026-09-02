# Intelligence 3.0 — Foundation Roadmap

## Objective

Build an independent intelligence layer around the static official site `жакин.рф` without making the public site dependent on the collector.

## Current architecture

`жакин.рф / GitHub Pages → optional HTTPS collector → validation → abuse protection → D1 aggregates → intelligence metrics`

The public website remains static and must continue to work if every intelligence component is unavailable.

## Phase 1 — Foundation (current)

- [x] Isolate the Cloudflare collector from the public site.
- [x] Define a provider-neutral event contract.
- [x] Define aggregate-only D1 storage.
- [x] Add Durable Object rate-limiting boundary.
- [x] Keep production database ID out of Git.
- [x] Gate production deployment explicitly.
- [x] Preserve disaster-recovery documentation.
- [ ] Verify Cloudflare account/zone ownership and DNS control.
- [ ] Create the real D1 database outside GitHub.
- [ ] Apply the migration to the real D1 database only after validation.
- [ ] Deploy the Worker to a non-production endpoint.
- [ ] Run independent functional, abuse and failure tests.

## Phase 2 — Security and operations

- [ ] Restrict Worker route to the intended hostname/path.
- [ ] Confirm CORS allow-list against the canonical production origin.
- [ ] Validate payload size and schema rejection behavior.
- [ ] Validate Durable Object rate limiting under burst traffic.
- [ ] Confirm logs contain no prohibited personal data.
- [ ] Establish retention and deletion verification.
- [ ] Establish backup/export and recovery test.

## Phase 3 — Intelligence integration

- [ ] Enable browser transport only after Phase 2 passes.
- [ ] Reconcile collector aggregates with existing SEO monitoring.
- [ ] Add anomaly and trend signals without collecting identifiers.
- [ ] Publish operational health metrics separately from public editorial analytics.
- [ ] Keep the provider-neutral contract so migration to another runtime remains possible.

## Production safety rules

1. Never place Cloudflare credentials, tokens or database IDs in source control.
2. Never connect browser transport before the production gates pass.
3. Never make site rendering depend on D1, Durable Objects or the Worker.
4. Never store IP addresses, fingerprints, credentials or raw form data in the intelligence store.
5. Every infrastructure change must remain reversible.
6. Production DNS is changed only after an independently verified replacement is healthy.

## Recovery target

A provider outage must not cause loss of the public website. The repository remains the source of truth for static content and SEO infrastructure; the intelligence layer is an independent, replaceable service.
