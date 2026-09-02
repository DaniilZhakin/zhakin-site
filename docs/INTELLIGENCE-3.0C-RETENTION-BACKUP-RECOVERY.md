# Intelligence 3.0-C — Retention, Backup & Recovery Policy

**Status: PRE-PRODUCTION / policy implemented, operational execution gated**

## 1. Data model

The collector persists only aggregate counters in D1 (`engagement_daily`). Raw browser events are not stored. The aggregate dimensions are event day, event type, path, content ID, referrer class and event count.

## 2. Retention baseline

The engineering baseline is **90 days** for aggregate engagement data.

Retention is configured through `RETENTION_DAYS` and currently defaults to 90 days if the variable is missing or invalid. Cleanup removes rows with `event_day` older than the calculated UTC cutoff.

The 90-day period remains a production governance gate: it must be explicitly approved by the site owner before production data collection is enabled.

## 3. Cleanup mechanism

The Worker exposes no public cleanup endpoint. A scheduled Worker invocation runs the retention job once per day at the cron configured in `intelligence/collector-cloudflare/wrangler.jsonc`.

Cleanup is deterministic and uses the server-side scheduled execution time. It does not inspect or retain individual visitor records.

## 4. Backup / export

Before production activation, administrators must establish an export procedure for the D1 aggregate table. The minimum export scope is:

- `event_day`
- `event_type`
- `path`
- `content_id`
- `referrer_class`
- `event_count`

Exports must be stored outside the public repository and outside browser storage. Credentials, database IDs that are operationally sensitive, and private export locations must never be committed to Git.

## 5. Recovery test

Before production activation, the following controlled recovery test is required:

1. Export a representative D1 aggregate snapshot.
2. Verify row count and aggregate totals.
3. Restore the snapshot into an isolated test database.
4. Reconcile daily totals by event type and path.
5. Record the test date, operator and result in the operational runbook.
6. Confirm that no raw event payload or prohibited personal data appears in the export.

## 6. Failure behavior

If D1 is unavailable during event ingestion, the collector returns `503 storage_unavailable`. The public site must continue functioning and must not fail closed because analytics is unavailable.

If the scheduled retention job fails, it must not delete data partially through client-side behavior. The failure must be visible through the provider's operational monitoring and retried according to the deployment runbook.

## 7. Production gate impact

The following gates remain open until account-level verification is completed:

- [ ] 90-day retention explicitly approved.
- [ ] Production D1 export procedure executed successfully.
- [ ] Recovery test completed against an isolated database.
- [ ] D1/log access restricted to authorized administrators.
- [ ] Backup/export location and retention documented outside the public repository.
- [ ] Operational monitoring for scheduled cleanup and storage failures verified.

This document defines the implementation boundary; it does not authorize production deployment or browser transport.
