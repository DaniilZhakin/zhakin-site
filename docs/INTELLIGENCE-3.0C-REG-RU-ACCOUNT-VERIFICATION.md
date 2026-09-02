# Intelligence 3.0-C — REG.RU Account Verification Checklist

**Status:** Account-level verification required — no production deployment

## Purpose

This checklist closes the only remaining REG.RU-specific uncertainty: what the currently used REG.RU / ISPmanager service actually permits.

Public REG.RU documentation establishes technical plausibility, but account-level facts must be verified before selecting REG.RU as the production collector host.

## Verify in the current REG.RU / ISPmanager account

### 1. Service and tariff

Record:
- service/product name;
- tariff/plan;
- VPS or hosting type;
- operating system/version;
- available CPU/RAM/storage limits.

### 2. Server-side runtime

Confirm at least one production-capable server runtime suitable for an HTTPS ingestion endpoint:
- PHP version and execution mode, or
- another supported application runtime.

Do not rely on browser JavaScript for the collector.

### 3. HTTPS routing

Confirm that a dedicated collector hostname/path can terminate over HTTPS and route to the server-side application.

Preferred isolation pattern:

```text
https://collector.<official-domain>/v1/events
                ↓
       server-side application
```

No production endpoint should be added until this routing is confirmed.

### 4. Process / service model

Confirm how the application is kept available:
- web request execution, or
- managed process/service;
- restart behavior;
- logs and error visibility.

### 5. Persistent storage

Confirm a minimal storage option for aggregate intelligence data and whether backups/export are available.

The production design should aggregate early and avoid unnecessary raw-event retention.

### 6. Rate limiting / abuse controls

This is a hard gate.

Confirm whether the service provides an atomic/provider-backed mechanism suitable for request limiting across concurrent processes/instances.

A process-local in-memory counter is **not** sufficient for production horizontal scaling.

Required controls:
- payload size limit;
- event-count limit;
- strict CORS allow-list;
- request rate limit;
- server-side receipt timestamp;
- schema validation;
- rejection of unknown/prohibited fields.

### 7. Administrative ownership

Confirm that the operational owner has sufficient access to:
- deploy/update the collector;
- inspect logs;
- manage storage;
- configure HTTPS;
- perform backups/exports;
- revoke or rotate secrets where applicable.

### 8. Production decision

REG.RU is approved only if all mandatory gates are confirmed:

- [ ] service/tariff identified;
- [ ] suitable runtime confirmed;
- [ ] HTTPS routing confirmed;
- [ ] process/service model confirmed;
- [ ] persistent aggregate storage confirmed;
- [ ] atomic/provider-backed rate limiting confirmed;
- [ ] administrative ownership confirmed;
- [ ] resource limits acceptable;
- [ ] backup/export path confirmed.

## Evidence standard

Account-level verification should be based on the current REG.RU / ISPmanager control panel or server configuration, not assumptions from public documentation.

Screenshots may be used as evidence; credentials, API keys and other secrets must not be shared.

## Current production state

**Browser transport: OFF.**

**Production collector: NOT DEPLOYED.**

**Reference collector:** `intelligence/collector-reference/` remains non-production and provider-neutral.

Once the account-level gates are closed, the next controlled step is to prepare the REG.RU implementation design. If the atomic abuse-control/storage/runtime requirements cannot be met cleanly, evaluate the Cloudflare Worker + D1/KV alternative instead.
