# Intelligence 3.0-C — Independent Collector / Provider Decision

**Status:** Independent infrastructure selected as the architectural direction — production provider still gated

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
CORS + payload limits + abuse protection
        ↓
Aggregate event store
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
| Cloudflare Worker + D1/KV | Excellent fit for a lightweight HTTPS edge collector attached to a static site | **Primary candidate** |
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
6. **Abuse protection:** payload limit, event-count limit and provider-backed/atomic rate limiting.
7. **Secrets:** no credentials or private configuration exposed to the browser.
8. **Storage:** aggregate-first design with minimized raw-event retention.
9. **Access:** restricted storage and dashboard access.
10. **Reliability:** collector failure cannot affect the public site's core functionality.
11. **Exportability:** aggregate data can be exported for migration or independent analysis.
12. **Compliance:** retention/deletion and applicable legal requirements documented before collection.

## 6. Primary path — independent edge collector

The preferred implementation is a small independent edge service, with Cloudflare Worker + D1/KV as the first provider to evaluate.

Required verification before approval:

- account and zone ownership;
- Worker deployment ownership;
- HTTPS endpoint configuration;
- D1/KV data-control and retention model;
- atomic/provider-backed rate limiting design;
- strict CORS configuration;
- aggregate export/backup procedure;
- operational cost and dependency acceptance;
- failure and abuse tests.

The collector must implement the already-frozen contract and must not expand the browser event schema.

## 7. Alternative path

If the primary edge design fails a mandatory requirement, evaluate a separate VPS/backend or Supabase/Vercel using the same criteria.

The decision must remain infrastructure-neutral at the application-contract level: changing provider must not require changing the public site's event semantics.

## 8. Production enablement gate

The browser-to-collector transport remains **OFF** until all boxes below are confirmed:

- [ ] Independent provider explicitly approved.
- [ ] Account, runtime and ownership confirmed.
- [ ] HTTPS collector endpoint deployed outside GitHub Pages and outside REG.RU runtime.
- [ ] Frozen schema validated server-side.
- [ ] Strict CORS allow-list active.
- [ ] Payload and event-count limits active.
- [ ] Provider-backed/atomic rate limiting active.
- [ ] Aggregate storage and reconciliation checks active.
- [ ] Raw-event retention/deletion policy documented.
- [ ] Dashboard/storage access restricted.
- [ ] Failure and abuse tests completed.
- [ ] Export/backup procedure documented.
- [ ] Production endpoint independently verified.
- [ ] Only after the above: browser transport enabled.

## 9. Non-negotiable architecture rule

REG.RU remains the website hosting environment only where applicable; it is **not** the dependency for the intelligence collector.

The public repository contains no production credentials, private endpoints or provider-specific secrets.

The reference collector under `intelligence/collector-reference/` remains non-production and provider-neutral until the independent provider gate is closed.

## 10. Next controlled action

**Evaluate and prepare the independent collector design, starting with Cloudflare Worker + D1/KV.**

Do not enable browser transport yet. First close provider ownership, HTTPS, storage, CORS, atomic rate limiting, retention, export and abuse-testing gates.
