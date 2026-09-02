# Intelligence 3.0-B — Collector Implementation Gate

**Status:** Contract packaged — production collector still gated

## 1. Purpose

3.0-B begins implementation without coupling the public GitHub Pages site to an unapproved backend.

The canonical event contract is now packaged as:

`docs/intelligence-3.0-collector-contract.schema.json`

This schema is the validation source for any future collector implementation.

## 2. Contract rules

A collector implementation must:

- accept JSON events matching the schema exactly;
- reject unknown fields;
- reject unknown event types;
- enforce the path and identifier length limits;
- require `event_type`, `path` and `schema_version`;
- treat server-side receipt time as authoritative;
- enforce a request/payload size limit;
- apply strict CORS for the official site origin;
- apply rate limiting and abuse protection;
- never persist IP addresses, fingerprints, advertising IDs, raw forms, email/phone data, credentials or secrets.

## 3. Current browser boundary

The public site remains a local privacy-first sensor. Its current implementation stores bounded events in visitor `sessionStorage` and does not depend on analytics availability. It is not yet wired to a centralized collector.

## 4. Production gate

The following items remain deliberately open before server-side ingestion:

- [ ] Confirm server-side runtime and operational ownership.
- [ ] Select provider: REG.RU/ISPmanager, Cloudflare Worker + D1/KV, Supabase, or Vercel/serverless.
- [ ] Confirm data-control and retention requirements.
- [ ] Deploy HTTPS endpoint outside the public repository runtime.
- [ ] Add schema validation, CORS, payload limit and rate limiting.
- [ ] Add aggregate storage and reconciliation checks.
- [ ] Run failure/abuse tests.
- [ ] Only then enable the browser-to-collector transport.

## 5. Design principle

The website must remain fully functional if the collector is unavailable. Analytics is an observability layer, never a dependency of the public presentation layer.

**Next controlled step:** provider/runtime confirmation, followed by a minimal reference collector implementation and validation tests. No production endpoint is exposed until that gate is closed.
