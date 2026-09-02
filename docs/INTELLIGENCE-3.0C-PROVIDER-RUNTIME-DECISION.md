# Intelligence 3.0-C — Independent Collector / Provider Decision

**Status:** Independent infrastructure selected; Cloudflare implementation prepared; production deployment still gated

## 1. Decision

The centralized intelligence collector will **not depend on REG.RU / ISPmanager**.

The public website remains a static GitHub Pages presentation layer, while the analytics collector will run as an **independent external service**. This deliberately separates presentation hosting from intelligence infrastructure.

The site must remain fully functional if the collector or its provider is unavailable.

## 2. Target architecture

```text
жакин.рф / GitHub Pages
        ↓
HTTPS collector endpoint (independent infrastructure)
        ↓
Server-side schema validation
        ↓
Strict CORS + payload limits
        ↓
SQLite-backed Durable Object rate limiter
        ↓
Aggregate-only D1 event store
        ↓
Metrics / intelligence / reports
```

Browser transport remains disabled until the independent collector is deployed and independently verified.

## 3. Why independence is preferred

1. **Hosting isolation:** a REG.RU outage or hosting change must not take down both the website and intelligence layer.
2. **Operational separation:** the collector can be upgraded, moved or replaced without changing the public site architecture.
3. **Security boundary:** secrets, storage and abuse controls stay outside browser JavaScript and outside the public repository runtime.
4. **Portability:** the event contract remains provider-neutral, allowing migration between infrastructure providers.
5. **Scalability:** the intelligence layer can evolve independently from the static presentation layer.
6. **Failure isolation:** analytics failure must never become a website failure.

## 4. Provider candidates

| Candidate | Fit for independent collector | Preliminary assessment |
|---|---|---|
| Cloudflare Worker + D1 + SQLite-backed Durable Object | Strong fit for a lightweight HTTPS edge collector attached to a static site; provides SQL aggregate storage and a serialized rate-limit boundary | **Primary implementation prepared** |
| Supabase | Strong API/database capability, but broader managed-platform surface | Secondary candidate |
| Vercel/serverless | Viable serverless runtime, but adds another hosting platform | Secondary candidate |
| Separate VPS / dedicated backend | Maximum infrastructure control, but higher operational burden | Reserve option |
| REG.RU / ISPmanager | Technically plausible, but intentionally excluded from the primary architecture | **Not selected** |

No provider is approved solely on convenience.

## 5. Mandatory production criteria

The independent collector must satisfy all of the following:

1. **Runtime:** confirmed server-side HTTPS ingestion runtime.
2. **Ownership:** clear administrative ownership of the collector and its data.
3. **Privacy:** only the frozen anonymous event contract is accepted.
4. **Schema:** exact validation against `docs/intelligence-3.0-collector-contract.schema.json`.
5. **CORS:** strict allow-list for the official site origin.
6. **Abuse protection:** payload limit, event-count limit and a provider-backed serialized rate-limit boundary.
7. **Secrets:** no credentials or private configuration exposed to the browser.
8. **Storage:** aggregate-only D1 design; raw event batches are not persisted.
9. **Access:** restricted storage and dashboard access.
10. **Reliability:** collector failure cannot affect the public site's core functionality.
11. **Exportability:** aggregate data can be exported for migration or independent analysis.
12. **Retention:** explicit aggregate-data retention/deletion policy approved before collection.
13. **Recovery:** export and restore procedure tested against an isolated environment before activation.
14. **Compliance:** applicable legal and operational requirements documented before collection.

## 6. Primary implementation — Cloudflare

The repository now contains a gated implementation under `intelligence/collector-cloudflare/`:

- `worker.js` — HTTPS collector with exact event validation, strict CORS, payload/event limits, server receipt time, aggregate-only persistence and scheduled retention cleanup.
- `wrangler.jsonc` — Worker, D1, Durable Object and scheduled-job configuration. The production D1 ID is intentionally a placeholder and must not be guessed or committed until the account is confirmed.
- `migrations/0000_create_engagement_daily.sql` — aggregate daily engagement schema with indexes.
- `package.json` — local Wrangler tooling.
- `README.md` — deployment and production-gate rules.
- `.github/workflows/intelligence-cloudflare-collector-tests.yml` — syntax and Wrangler dry-run validation only; it does not deploy.

The event store and abuse-control state are deliberately separated: D1 holds aggregate application metrics, while the Durable Object provides the serialized rate-limit boundary.

## 7. Retention, backup and recovery

The engineering baseline is **90 days** for aggregate engagement data, configured through `RETENTION_DAYS=90`. This value is not production authorization; the site owner must explicitly approve it before browser transport is enabled.

A scheduled Worker invocation performs deletion of aggregate rows older than the UTC retention cutoff. There is no public cleanup endpoint.

The operational policy and recovery checklist are defined in `docs/INTELLIGENCE-3.0C-RETENTION-BACKUP-RECOVERY.md`. Production activation requires a successful export/recovery test and restricted access to storage and operational logs.

## 8. Alternative path

If the primary edge design fails a mandatory requirement, evaluate a separate VPS/backend or Supabase/Vercel using the same criteria.

The decision must remain infrastructure-neutral at the application-contract level: changing provider must not require changing the public site's event semantics.

## 9. Production enablement gate

The browser-to-collector transport remains **OFF** until all boxes below are confirmed:

- [ ] Independent provider explicitly approved.
- [ ] Account, runtime and ownership confirmed.
- [ ] HTTPS collector endpoint deployed outside GitHub Pages and outside REG.RU runtime.
- [ ] Frozen schema validated server-side.
- [ ] Strict CORS allow-list active.
- [ ] Payload and event-count limits active.
- [ ] Provider-backed serialized rate limiting active and abuse-tested.
- [ ] Aggregate D1 storage and reconciliation checks active.
- [ ] Approved retention period documented and configured.
- [ ] Scheduled cleanup verified.
- [ ] Dashboard/storage access restricted.
- [ ] Failure and abuse tests completed.
- [ ] Export/backup and isolated recovery test completed.
- [ ] Production endpoint independently verified.
- [ ] Only after the above: browser transport enabled.

## 10. Non-negotiable architecture rule

REG.RU remains the website hosting environment only where applicable; it is **not** the dependency for the intelligence collector.

The public repository contains no production credentials, private endpoints or provider-specific secrets.

The reference collector under `intelligence/collector-reference/` remains non-production and provider-neutral. The Cloudflare implementation is also gated: code/configuration preparation is not the same as production deployment or approval.

## 11. Next controlled action

**Complete the account-level Cloudflare setup and independent verification.** The code-side retention, backup/recovery policy and test boundaries are now prepared.

Do not enable browser transport yet. The real D1 database ID, production endpoint, account ownership, approved retention period, export/recovery evidence and external endpoint verification must be confirmed outside the repository before deployment.
