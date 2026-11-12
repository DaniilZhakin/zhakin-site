# Wallet API Route Inventory and Authorization Map

**Status: source-backed inventory of the isolated prototype and separate draft contract. Not a production route specification.**  
**Reviewed against branch:** `docs/platform-office-permission-matrix-threat-model-20261112`  
**Reviewed files:** `wallet/prototype/server/handler.js`, `handler.test.js`, `README.md`, `API-CONTRACT.md`.

This inventory distinguishes (A) routes handled by the current isolated HTTP scaffold from (B) endpoints described only in the draft API contract. It must not be read as evidence that the draft endpoints are implemented or deployed.

## 1. Current handler: concrete route map

| Method | Path / matcher | Authentication | Authorization / ownership | Current response / state | Required next control |
| --- | --- | --- | --- | --- | --- |
| GET | `/health` | Public | None; response must remain minimal | 200 with `ready:false` | Keep liveness-only; no secrets or dependency details |
| GET | `/api/v1/me` | Server adapter required | Principal ID comes from `authenticate`; no repository lookup shown | 200 minimal identity object | Return only approved public profile fields; do not expose internal role assignments |
| GET | `/api/v1/me/balance` | Server adapter required | Uses verified `principal.id`; repository queried for that ID | 200 if safe integer; otherwise 503 | Verify participant active status and account ownership in repository; define balance unit and ledger consistency |
| GET | `/api/v1/me/ledger` | Server adapter required | Uses verified `principal.id`; cursor passed to repository; limit fixed at 50 | 200 with entries/cursor or 503 | Validate cursor format/ownership/expiry; ensure repository enforces participant filter and bounded results |
| GET or POST | `/api/v1/admin` and `/api/v1/admin/**` | Server adapter required | `hasWalletGlobalAdminAccess(principal)`; coordinator grants do not pass | Unauthorized: 403; authorized: currently falls through to 501 | Keep deny-by-default; define per-action capabilities, object checks, approval and audit before implementing any action |
| GET or POST | `/api/v1/projects/{lookupId}` and nested paths | Server adapter required | Trusted resolver returns canonical project ID; `hasWalletProjectAccess` checks active global admin/global coordinator/exact project coordinator | Missing resolver: 503; invalid ID: 400; resolver failure: 503; absent/unauthorized: 404; authorized: currently 501 | Every eventual subresource must resolve its own canonical project/resource and enforce object ownership; route guard alone is not operation authorization |
| GET or POST | Any other path | Server adapter required before fallthrough | No route-specific policy exists | 501 after authentication | Add explicit route table and return 404 for unknown routes rather than a generic 501 after authentication |
| Any other method | Any path except the early GET health route | Not evaluated | Not evaluated | 405 | Preserve method allow-list and test method override / unusual verbs |

### Handler behavior relevant to authorization

- `GET /health` is evaluated before method and authentication checks.
- Only GET and POST are accepted by the scaffold.
- Every other protected request requires the injected `authenticate` adapter; missing adapter returns 503, failed authentication returns 401.
- `GET /api/v1/me` returns `id` and a `roles` array from the principal. That roles array is not used by the route guards, but exposing internal roles to the client is unnecessary and can encourage unsafe client-side authorization assumptions.
- Balance and ledger calls use the server-verified principal ID, not a participant ID from the query string.
- Admin namespace authorization is checked against a server-side role assignment helper.
- Project namespace authorization resolves a URL lookup key to a canonical project record before checking scope.
- The handler currently implements no project or admin business action; authorized requests still return 501.
- Repository errors are caught and reduced to stable generic errors; internal exception messages are not returned.

## 2. Draft API contract only — not implemented in handler

| Method | Contract path | Intended actor / policy | Implementation status |
| --- | --- | --- | --- |
| POST | `/api/v1/activities` | Authenticated active participant; actor derived from verified session; allow-listed project code; initial state submitted; no points supplied by client | Contract only; no matching handler route |
| GET | `/api/v1/me/activities` | Participant reads own activity submissions; reviewer-only notes excluded unless explicitly permitted | Contract only; no matching handler route |
| GET | `/api/v1/admin/activities?status=submitted` | Admin namespace plus role/scope and canonical activity project resolution; log sensitive queue access | Contract only; admin guard scaffold exists, operation does not |
| POST | `/api/v1/admin/activities/{activityId}/review` | Authorized global admin or project-scoped coordinator; exact object/project check; state validation; atomic approval + ledger + audit; idempotency | Contract only; no review operation implemented |
| POST | `/api/v1/admin/ledger-adjustments` | Active global admin only; coordinator insufficient; reason, non-zero delta, idempotency; append adjustment, never edit history; dual approval considered | Contract only; no adjustment operation implemented |

Do not advertise, link, or call these contract-only endpoints from the public site or ЖАК until they are implemented, tested, and separately authorized.

## 3. Source-backed route and security gaps

### G1 — `/api/v1/me` exposes internal role labels
The current response includes the principal's `roles` array. The route guards correctly use server-side role-assignment helpers rather than that array, but returning role labels to the browser is unnecessary. Prefer a minimal participant-facing profile response; if the UI needs capabilities, return a deliberately curated capability projection, never raw grants or an authorization source of truth.

### G2 — Unknown paths fall through to 501
After authentication and the two namespace guards, every unmatched GET/POST route returns `501 not_implemented`. This blurs the distinction between a known but unimplemented endpoint and an unknown path. Add an explicit route registry; unknown paths should return 404, while known planned-but-disabled endpoints may return a documented 501/503.

### G3 — Project namespace guard is not object-level authorization
The project ID is canonicalized, but nested resource IDs are not resolved because no project operations exist yet. Once an operation is introduced, the handler must load the target activity/case/record from trusted persistence, derive its canonical project and owner, and check both project scope and resource-specific permission. Never authorize a child object solely because a project ID appears in its URL.

### G4 — Participant lifecycle is not checked in the shown handler
The handler verifies a non-empty principal ID, but the visible balance/ledger path does not itself check active/suspended/closed participant status. The identity adapter or repository contract must explicitly guarantee active status, or the handler must enforce it before account access.

### G5 — Ledger cursor is passed through without handler-level validation
The handler fixes the page size at 50 and validates the response shape, but passes the incoming cursor directly to the repository. The repository must treat it as opaque, bind it to the authenticated participant and query, reject tampering/expiry, and enforce stable pagination. Add negative tests for cross-account cursor reuse and malformed/oversized cursors.

### G6 — Route guard does not establish production readiness
No identity provider, session verifier, live D1 database, Worker binding, mail provider, or public-site integration is configured by this scaffold. The D1 adapter and migration status described in README remain isolated; no migration has been applied to a live database. Do not onboard real participants.

## 4. Required route-level test inventory

| Test ID | Route family | Test | Expected result |
| --- | --- | --- | --- |
| R-01 | Health | Request health without auth | 200 minimal liveness response; no sensitive fields |
| R-02 | All protected routes | No auth adapter / null principal / thrown auth adapter | 503 when not configured; 401 for invalid identity |
| R-03 | `/api/v1/me` | Principal contains forged browser roles but no server grant | Identity response must not imply authorization; raw internal roles should not be exposed |
| R-04 | Balance | Add `participant_id=victim` to query | Repository receives only verified principal ID |
| R-05 | Balance | Suspended/closed participant | Denied before account data is returned |
| R-06 | Ledger | Reuse another participant's cursor | Denied or safely returns no data; never cross-account rows |
| R-07 | Ledger | Malformed, expired, oversized cursor | 400/409 or stable generic denial; no unbounded query |
| R-08 | Admin | Participant with browser `admin` label only | 403 |
| R-09 | Admin | Global/project coordinator without global admin grant | 403 |
| R-10 | Admin | Active global admin grant | Passes namespace guard only; business operation remains unavailable until implemented |
| R-11 | Project | Missing resolver or resolver exception | Fail closed with 503 |
| R-12 | Project | Project A coordinator resolves alias to canonical Project B | 404 concealed denial |
| R-13 | Project child object | Coordinator has Project A grant but child record belongs to Project B | 404/403 per concealment policy; no record leakage |
| R-14 | Project child object | Child record belongs to another participant in same project | Denied unless separately assigned capability allows access |
| R-15 | Unknown path | Authenticated GET/POST to unknown route | 404 after explicit route registry is introduced |
| R-16 | Methods | PUT/PATCH/DELETE/OPTIONS and method-override attempts | 405 or correctly handled preflight; no mutation bypass |
| R-17 | Error handling | Repository throws error containing SQL/secret details | Generic response; sensitive detail absent from response/logs |
| R-18 | Future mutations | Duplicate request, stale state, replay, concurrent approval, audit write failure | Idempotent single outcome; stale authority denied; transaction rollback if audit fails |

## 5. Implementation sequence after review

1. Approve the route inventory and close G1–G6 as design decisions.
2. Create a concrete route registry with method, path, capability, scope resolver, owner predicate, data classification, and denial response for every implemented endpoint.
3. Remove raw role exposure from participant-facing identity response; expose only minimum profile fields.
4. Define and test participant lifecycle enforcement and cursor binding in the repository contract.
5. Implement resource-level authorization only alongside a real resource resolver and negative tests.
6. Keep all business mutations disabled until identity provider, test D1, transactional persistence, idempotency, audit, rate limits, CSRF/CORS, and privacy controls are proven in an isolated environment.
7. Re-run security tests and obtain explicit approval before any pilot or production connection.

## 6. Explicit non-goals

- No runtime code or route behavior is changed by this document.
- No database schema or migration is created or applied.
- No identity provider, Worker, D1 database, mail provider, or public-site integration is configured.
- No live participant/staff data, Wallet balances, BFU/УСЕРДИЕ assets, payments, transfers, or exchange operations are accessed or changed.
- No deployment is performed.
