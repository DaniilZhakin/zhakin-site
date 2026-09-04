# жакин.рф — Security & Operations Test Matrix

This document defines the evidence required before Intelligence 3.0 is activated in production.

| Control | Required evidence | Gate |
|---|---|---|
| CORS | Allowed origin succeeds; unexpected origin is rejected | BLOCKER |
| Content type | Non-JSON POST returns 415 | BLOCKER |
| Payload limit | Body above 8192 bytes returns 413 | BLOCKER |
| Batch limit | More than 10 events returns 400 | BLOCKER |
| Schema | Unknown fields, invalid path, timestamp and enum values are rejected | BLOCKER |
| Rate limiting | Burst traffic is throttled by Durable Object | BLOCKER |
| Privacy | No IP, fingerprint, credential, raw form or cross-site identifier is persisted | BLOCKER |
| Retention | Expired aggregates are deleted and deletion is reproducible | BLOCKER |
| D1 recovery | Disposable replacement DB can be rebuilt from migrations/backup | BLOCKER |
| Worker rollback | Previous Worker version can be restored | BLOCKER |
| Site isolation | Collector/D1 failure leaves static site available | BLOCKER |
| Monitoring | Collector health and public-site health are measured separately | REQUIRED |
| Production smoke test | Endpoint, CORS, schema, storage and failure behavior verified after deployment | BLOCKER |

## Release rule

No browser transport and no production collector endpoint are enabled while a BLOCKER item lacks evidence.

## Recovery rule

A failure of the intelligence layer must never become a failure of the public website. DNS or public-site routing is changed only after the replacement contour is healthy and independently verified.
