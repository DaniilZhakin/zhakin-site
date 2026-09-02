# Intelligence 3.0-C — Provider / Runtime Decision

**Status:** Decision framework frozen — REG.RU capability publicly confirmed; actual account runtime still requires verification

## 1. Purpose

3.0-C converts the frozen collector contract into an explicit deployment decision without silently introducing a new infrastructure dependency.

The public website remains a static GitHub Pages presentation layer. The centralized collector must live outside the public repository runtime and must never require secrets in browser JavaScript.

## 2. Current architecture

```text
GitHub Pages static site
        ↓
HTTPS collector endpoint
        ↓
Server-side validation + abuse controls
        ↓
Aggregate event store
        ↓
Scheduled intelligence / reports
```

The browser transport remains disabled until the provider/runtime gate is closed.

## 3. Candidate comparison

| Candidate | Runtime fit | Data/control | Security/abuse controls | Operations | Dependency | Preliminary assessment |
|---|---|---|---|---|---|---|
| REG.RU / ISPmanager backend | Public REG.RU documentation confirms VPS + ISPmanager, SSH, PHP and cron capabilities; exact current service/tariff still requires account-level verification | Potentially strong direct control | Can be designed to meet contract, but implementation burden is ours | Lowest architectural discontinuity if suitable runtime exists | Existing hosting dependency | **Candidate A — verify actual runtime first** |
| Cloudflare Worker + D1/KV | Excellent fit for a static site and lightweight edge collector | Good, subject to platform/data-control review | Strong primitives for CORS, limits and edge handling; atomic rate limiting must be designed correctly | Low-to-medium | Adds external platform dependency | **Candidate B — technically strong** |
| Supabase | Strong API/database capability | Good, subject to project/data-region/access review | Broad security surface; requires careful API/RLS configuration | Medium | Adds managed backend platform | **Candidate C — viable but broader than necessary** |
| Vercel/serverless | Good serverless runtime | Requires separate platform/data-control review | Capable, but controls must be explicitly implemented | Low-to-medium | Adds hosting dependency | **Candidate D — viable** |

No candidate is approved solely on convenience.

## 4. Decision criteria

A production provider must satisfy all mandatory criteria:

1. **Runtime:** confirmed server-side runtime suitable for an HTTPS ingestion endpoint.
2. **Ownership:** clear operational ownership and administrative access.
3. **Privacy:** supports the frozen anonymous-event boundary without requiring unnecessary identifiers.
4. **Schema:** exact validation against `docs/intelligence-3.0-collector-contract.schema.json`.
5. **CORS:** strict allow-list for the official site origin.
6. **Abuse protection:** payload limit, request limits and provider-backed/atomic rate limiting.
7. **Secrets:** no credentials or private configuration exposed to the browser.
8. **Storage:** aggregate-first design with controlled raw-event retention.
9. **Access:** restricted dashboard and storage access.
10. **Reliability:** failure isolation so the public site remains functional when analytics is unavailable.
11. **Exportability:** aggregate data can be exported without proprietary lock-in becoming operationally critical.
12. **Compliance:** retention, deletion and applicable legal requirements can be documented before production collection.

## 5. Runtime verification gate

### Public capability check — REG.RU

Current public REG.RU documentation confirms that VPS with ISPmanager supports server administration via SSH, and REG.RU documents PHP and scheduled cron execution for applicable hosting configurations. REG.RU also documents VPS operation and ISPmanager administration. This establishes that a suitable REG.RU deployment is technically plausible, but it does **not** prove that the currently used account has the required runtime, plan, permissions or resources. citeturn0search0turn0search1turn0search15

### Actual account verification — still open

Before approval, confirm from the current REG.RU / ISPmanager account:

- exact service type and tariff;
- available server-side runtime (PHP and/or another supported application runtime);
- HTTPS endpoint routing;
- process/service management model;
- persistent storage suitable for the minimal aggregate pipeline;
- server-level rate limiting or an equivalent atomic mechanism;
- administrative ownership and backup/export procedures;
- resource limits sufficient for the collector.

**Important:** public documentation is capability evidence, not account-level verification. No production endpoint is deployed on the basis of documentation alone.

### REG.RU / ISPmanager

If the current service provides the required runtime, HTTPS routing, secure storage and atomic abuse controls, REG.RU/ISPmanager remains the preferred continuity option.

If these cannot be confirmed, do not deploy the collector there merely because the website is already associated with REG.RU.

### Cloudflare Worker + D1/KV

Before approval, confirm:

- account/zone ownership;
- Worker deployment ownership;
- D1/KV data-control and retention model;
- atomic/provider-backed rate limiting design;
- CORS and origin configuration;
- export/backup procedure for aggregate data;
- operational cost and dependency acceptance.

### Supabase

Before approval, confirm:

- project ownership;
- database/API access model;
- RLS or equivalent server-side authorization boundary;
- data-control/retention configuration;
- rate limiting and abuse protection strategy;
- aggregate export and backup process.

### Vercel/serverless

Before approval, confirm:

- project ownership;
- serverless runtime and deployment path;
- persistent aggregate storage design;
- rate limiting implementation;
- data-control/retention configuration;
- export/backup procedure;
- acceptance of an additional hosting dependency.

## 6. Recommendation logic

The decision should be made in this order:

**A. Verify the actual REG.RU/ISPmanager runtime.**

Public documentation makes REG.RU technically plausible, but the current account must be checked before approval. If a suitable server-side runtime, HTTPS routing, secure storage and atomic abuse controls are available and operationally owned, REG.RU/ISPmanager is the preferred continuity option because it minimizes infrastructure fragmentation.

**B. If REG.RU cannot provide a suitable runtime, evaluate Cloudflare Worker + D1/KV.**

This is the strongest alternative for a static GitHub Pages site because the collector can remain a small isolated edge service. Approval still requires explicit acceptance of the external platform and data-control model.

**C. Use Supabase or Vercel only if their operational advantages justify the additional platform surface/dependency.**

No provider is selected by this document alone.

## 7. Production enablement gate

The browser-to-collector transport remains **OFF** until all boxes below are confirmed:

- [ ] Provider explicitly approved.
- [ ] Actual runtime and ownership confirmed.
- [ ] HTTPS endpoint deployed outside the public repository runtime.
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

## 8. Non-negotiable safety rule

A provider must not be selected implicitly through frontend code, environment assumptions or a convenience deployment. The public site must remain fully functional if the collector is unavailable.

The reference collector under `intelligence/collector-reference/` remains non-production and provider-neutral.

## 9. Next controlled action

**Verify the actual current REG.RU / ISPmanager service configuration.**

Public documentation has now been checked and confirms that the REG.RU ecosystem can support the relevant server-side building blocks. The remaining question is account-specific: what runtime, permissions, storage and rate-limiting capabilities are actually available on the service currently used for the site.

If suitable runtime and operational controls are confirmed, prepare the REG.RU implementation design. Otherwise, move to a documented Cloudflare Worker + D1/KV deployment design for approval.

Until that confirmation, do not add a production collector endpoint and do not enable browser transport.
