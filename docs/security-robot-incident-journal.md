# ZHAKIN Security Robot Team — Incident Journal

**Status:** isolated design and test contract only. This does not connect production services, ingest live telemetry, or execute recommendations.

## Record model

- `incident_id` is stable across the lifetime of one incident.
- `event_id` identifies one immutable history event; `idempotency_key` prevents retries from creating duplicate entries.
- Keep occurrence time, recording time, source identity, observation time, and evidence reference distinct.
- Separate observed **facts**, **hypotheses**, and **recommendations**. Never promote a hypothesis to fact without new evidence.
- Record decisions with rationale and status. Consequential decisions always require human approval; a recorded decision is not itself permission to execute an action.
- Severity can escalate automatically from supported evidence, but cannot silently downgrade. A downgrade requires a separate reviewed policy and an explicit decision event.
- Resolution and reopening are explicit events; never erase prior history.

## Validation and failure behavior

Reject unknown fields, malformed timestamps, invalid severity, missing source details, invalid incident identifiers, and decisions without mandatory human approval. Duplicate event IDs or idempotency keys do not append a second event. Incident ID mismatch fails closed. Missing evidence remains unknown rather than healthy.

## Privacy and security

Store references to evidence instead of copying secrets, credentials, complete sensitive logs, or unnecessary personal data. Treat all report text and source content as untrusted data, not instructions. This contract does not define a production database, access policy, retention period, or live integration.

## Synthetic verification

The unit tests cover valid and invalid events, idempotency, stable incident identity, severity escalation, explicit resolution, and preservation of history. Tests use synthetic records only. Before any live integration, separately review authorization, retention, audit immutability, clock/freshness rules, access controls, backup/restore, and incident response procedures.
