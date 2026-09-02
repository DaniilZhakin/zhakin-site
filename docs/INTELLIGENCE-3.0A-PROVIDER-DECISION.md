# Intelligence 3.0-A — Collector Provider Decision

**Status:** Contract frozen — provider deployment gated

## 1. Architectural decision

The public website remains a static GitHub Pages presentation layer. The centralized engagement collector must remain outside the public repository runtime and must not require client-side credentials.

For the first production implementation, the preferred deployment pattern is:

**Static site → HTTPS collector endpoint → validated aggregate pipeline**

The provider is not hard-coded into the public site until the hosting capability, privacy requirements, security controls and operational ownership are confirmed.

## 2. Provider evaluation

| Option | Strength | Constraint | Decision |
|---|---|---|---|
| REG.RU / ISPmanager backend | Infrastructure continuity; direct operational control | Requires confirmed server-side runtime and secure API deployment | Candidate A |
| Cloudflare Worker + D1/KV | Excellent fit for static site; edge endpoint; clean separation | External infrastructure dependency and separate data-control review | Candidate B |
| Supabase | Fast API/database delivery | Larger platform surface than required for a minimal collector | Candidate C |
| Vercel/serverless | Simple serverless deployment | Adds another hosting dependency | Candidate D |

No provider is approved for production solely on convenience. The final choice must satisfy privacy, security, CORS, abuse protection, reliability, cost, exportability and applicable compliance requirements.

## 3. Frozen collector contract

The browser may submit only the following allow-listed fields:

- `event_type` — required, allow-listed event name
- `path` — required, normalized site path
- `timestamp` — optional client timestamp; server timestamp is authoritative
- `referrer_class` — optional coarse classification only
- `content_id` — optional publication/content identifier
- `schema_version` — required contract version

Unknown fields must be rejected. Unknown event types must be rejected. Payload size must be bounded.

### Allowed event types

- `page_view`
- `navigation_click`
- `menu_toggle`
- `outbound_click`
- `contact_interest`
- `contact_action`

## 4. Explicitly prohibited data

The collector must not store by default:

- IP addresses
- browser fingerprints
- advertising identifiers
- cross-site tracking identifiers
- raw form contents
- email addresses or phone numbers inside analytics events
- authentication credentials
- API keys or other secrets

## 5. Security baseline

Production collector implementation must include:

1. HTTPS only.
2. Strict CORS allow-list for the official site origin.
3. JSON schema validation.
4. Payload-size limit.
5. Rate limiting / abuse protection.
6. Server-side timestamping.
7. No secrets in frontend JavaScript.
8. Restricted access to dashboards and raw-event storage.
9. Documented retention and deletion policy.
10. Monitoring for collector failures and abnormal request volume.

## 6. Aggregation boundary

Raw events are an ingestion layer, not the public analytics product. Aggregation should occur as early as practical so the intelligence layer primarily works with non-identifying counts, rates and time series.

Initial metric model:

- engaged page views
- section engagement rate
- publication engagement rate
- contact-interest rate
- contact-action rate
- outbound interaction rate
- engagement trend / anomaly indicators

## 7. Rollout gate

### 3.0-A — complete

- [x] Provider candidates evaluated.
- [x] Collector contract frozen.
- [x] Privacy boundary defined.
- [x] Security baseline defined.
- [x] No third-party analytics dependency introduced.

### 3.0-B — next

Before production ingestion is enabled, confirm the selected provider can implement the frozen contract and security baseline. Then build the minimal collector endpoint with validation, rate limiting and anonymous event handling.

**Important:** no production collector endpoint is added to the public site until provider approval and deployment controls are confirmed.
