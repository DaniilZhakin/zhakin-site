# Intelligence Architecture — 3.0

## Status

**Architecture defined — implementation intentionally gated.**

3.0 extends the existing privacy-first engagement instrumentation into a centralized aggregate intelligence layer without introducing third-party tracking by default.

## 1. Target architecture

```text
Browser sensors
    ↓
Privacy-first collector
    ↓
Aggregate event store
    ↓
Validation / retention
    ↓
Intelligence metrics
    ↓
Dashboard / scheduled reports
```

The public website remains a static presentation layer. Collection and analytics are isolated from the public repository and must not require secrets in client-side code.

## 2. Existing foundation

The current site records a bounded set of anonymous interaction events locally in the visitor browser. The event model includes page views, navigation, menu interaction, outbound clicks and contact-interest/contact-action signals.

The current implementation deliberately uses `sessionStorage` and does not collect IP addresses, fingerprints, message contents or personally identifiable information.

This local layer is a sensor, not a centralized analytics system.

## 3. Collector contract

A future collector should accept only an allow-listed event schema such as:

- `event_type`
- `path`
- `timestamp`
- `referrer_class` (optional, normalized and non-identifying)
- `content_id` (optional site-defined identifier)
- `schema_version`

The collector must reject unknown event types and unexpected fields.

### Explicitly prohibited by default

- IP address storage
- browser fingerprinting
- raw form contents
- email/phone/contact details in analytics events
- advertising identifiers
- cross-site tracking identifiers
- credentials or API keys in frontend JavaScript

## 4. Aggregation boundary

Raw events should be transformed into aggregate metrics as early as practical. The dashboard should prefer counts, rates, cohorts based on non-identifying session/event properties, and time-series aggregates rather than individual visitor records.

Core metrics:

1. engaged page views;
2. section engagement rate;
3. publication engagement rate;
4. contact-interest rate;
5. contact-action rate;
6. outbound interaction rate;
7. engagement trend and anomaly indicators.

## 5. Retention

Default policy: minimize retention. The system should use a short raw-event retention window and retain longer-lived aggregate statistics only where operationally justified.

The exact retention period is a deployment decision and must be documented before production collection begins.

## 6. Backend selection gate

No provider is selected in 3.0 yet. Before implementation, evaluate at least:

| Option | Strength | Main constraint |
|---|---|---|
| Cloudflare Worker + D1/KV | lightweight edge collector, strong separation from static site | external platform dependency |
| Supabase | fast database/API deployment | more platform surface than strictly necessary |
| REG.RU / ISPmanager backend | infrastructure continuity with existing hosting | requires suitable server-side runtime and operations |
| Vercel/serverless backend | simple deployment model | additional hosting dependency |

Decision criteria:

- privacy and data minimization;
- security and secret handling;
- CORS and abuse protection;
- reliability;
- operational simplicity;
- cost at current traffic and future growth;
- exportability of aggregate data;
- legal/compliance requirements applicable to the deployment.

## 7. Security controls

Production collector must include:

- HTTPS only;
- strict CORS allow-list;
- schema validation;
- payload size limit;
- rate limiting / abuse protection;
- server-side timestamps where appropriate;
- no secrets in the client;
- restricted dashboard access;
- documented retention/deletion policy;
- monitoring for collector failures.

## 8. Rollout sequence

### 3.0-A — Architecture

Complete provider comparison and freeze the event/collector contract.

### 3.0-B — Collector

Deploy a minimal ingestion endpoint with validation, rate limiting and no identity collection.

### 3.0-C — Aggregation

Create scheduled aggregation into a compact metric model. Keep raw events isolated from the public site.

### 3.0-D — Intelligence Dashboard

Expose operational metrics, trends and anomalies. Dashboard access must not expose raw visitor data by default.

### 3.0-E — Production verification

Verify collector availability, event acceptance/rejection, aggregation correctness, retention behavior and failure handling before treating the system as production-ready.

## 9. Non-negotiable architecture rule

**Do not add Google Analytics, Yandex Metrica, advertising trackers or another third-party analytics identifier merely to make 3.0 work.** Any external analytics provider must be a deliberate, separately approved architectural decision.

## 10. Definition of done

3.0 is complete only when:

- the provider/backend is explicitly selected;
- the collector contract is frozen;
- anonymous events are validated server-side;
- centralized aggregation is operational;
- retention and access controls are documented;
- dashboard metrics reconcile with source events;
- failure and abuse scenarios are tested;
- no credentials or personal data are exposed in the public repository.
