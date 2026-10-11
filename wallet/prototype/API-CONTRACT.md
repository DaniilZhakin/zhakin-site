# ZHAKIN Wallet — server API contract (draft)

**Status: design contract only. No API is deployed, and no database is connected.**

This contract defines the minimum behavior for a future server-side API. It is not evidence that authentication, storage, or endpoint handlers already exist. Do not point the public site at a nonexistent or prototype endpoint.

## Operating boundaries

- The browser is an untrusted client. It may request an action, but it never supplies an authoritative balance, actor role, approval status, or trusted timestamp.
- Every endpoint except `GET /health` requires a verified server-side identity. If the identity provider is absent, invalid, or unavailable, protected requests fail closed.
- The server resolves the participant and role from the verified identity/session. Never trust `actorId`, `role`, or `participantId` supplied by a browser as proof of permission.
- Only synthetic test data may be used until security, privacy, operational and legal reviews are complete.
- ZHAKIN Points are internal activity-accounting points in this design. No cash value, redemption, transfer, investment, token issuance, or connection to COIN УСЕРДИЕ / BFU is implied.

## Versioning and common behavior

- Base path: `/api/v1`.
- JSON request/response bodies use UTF-8.
- Responses containing personal or account data must use `Cache-Control: no-store`.
- Production deployment must configure an explicit origin allowlist; do not use wildcard CORS with credentials.
- Mutating requests must be authenticated, authorized, validated, rate-limited and audited.
- Use server-generated IDs and timestamps. Limit body sizes and reject unknown or malformed fields.
- Never return stack traces, SQL errors, secrets, session tokens, or internal infrastructure details to clients.

## Endpoints

### `GET /health`

Purpose: process-level liveness only.

- May return `200 { "status": "ok", "service": "zhakin-wallet-api" }`.
- Must not reveal database contents, account identifiers, secrets, configuration values, or dependency credentials.
- This endpoint is not proof that authenticated wallet operations are ready.

### `GET /api/v1/me`

Purpose: return the minimal profile for the currently authenticated participant.

- Requires a valid session/token verified by the server.
- Participant identity is derived from that verified identity, not from query parameters.
- Response: `{ "participant": { "id": "...", "status": "active" } }`.
- Suspended/closed participants must not gain access to protected wallet operations.

### `GET /api/v1/me/balance`

Purpose: calculate the current points balance from posted ledger entries on the server.

- Requires an authenticated active participant.
- Participant ID comes from the verified identity.
- Response: `{ "points": 0, "asOf": "server-generated ISO-8601 timestamp" }`.
- The response is read-only and must not be cached.
- Never read a balance from local storage or accept one from the request body.

### `GET /api/v1/me/ledger?cursor=...`

Purpose: return a paginated history of the participant's own posted/reversed entries.

- Requires an authenticated active participant.
- Enforce a bounded page size and opaque cursor.
- A participant cannot request another participant's history by changing a URL, query parameter, or cursor.
- Return only fields necessary for the participant; do not expose internal audit data.

### `POST /api/v1/activities`

Purpose: submit a completed activity for coordinator review.

- Requires an authenticated active participant.
- Participant identity is derived from the verified session.
- Input may include an allowlisted `projectCode` and bounded description; no points value or approval status is accepted from the client.
- Initial status is always `submitted`; no ledger entry is created at submission.
- Validate project eligibility, size limits and duplicate submissions according to server policy.
- Record a security/audit event for the submission.

### `GET /api/v1/me/activities`

Purpose: list the current participant's own submitted activities and review status.

- Requires an authenticated active participant.
- Enforce pagination and object-level authorization.
- Do not expose internal reviewer-only notes unless policy explicitly permits them.

### `GET /api/v1/admin/activities?status=submitted`

Purpose: list activities awaiting review.

- Requires verified coordinator/admin role from the server-side identity provider.
- Apply least-privilege scope: coordinators see only assigned projects/records; admins receive broader access only where necessary.
- Log access to sensitive queues.

### `POST /api/v1/admin/activities/{activityId}/review`

Purpose: approve or reject a submitted activity.

- Requires a verified coordinator/admin role and object-level permission for that activity.
- Input: `{ "decision": "approve" | "reject", "reason": "..." }`.
- Reject stale/repeated reviews unless the workflow explicitly supports them.
- Approval and points-ledger creation must occur atomically in one database transaction/batch, after validating the activity's current status and the server-side points policy.
- Points are derived from an approved server-side policy, never accepted as an arbitrary client value.
- Generate an immutable ledger entry and audit event with the verified actor, reason, activity reference, timestamp and idempotency key.
- A unique database constraint must prevent duplicate ledger entries for the same approval operation. A retry with the same idempotency key must return the original outcome, not accrue again.
- Rejections create no accrual entry.

### `POST /api/v1/admin/ledger-adjustments`

Purpose: controlled correction by authorized staff.

- Requires a verified admin role; coordinator access is not implied.
- Requires a non-zero integer points delta, reason and idempotency key.
- Never edit or delete a posted ledger row to correct history. Write a separate adjustment/reversal entry linked to the original operation where applicable.
- Require stronger audit detail and consider dual approval before enabling this endpoint in production.

## Error contract

Use stable machine-readable error codes without sensitive implementation detail:

- `400 INVALID_REQUEST` — malformed or invalid input.
- `401 AUTHENTICATION_REQUIRED` — no valid identity.
- `403 FORBIDDEN` — identity lacks permission or object scope.
- `404 NOT_FOUND` — resource absent or intentionally concealed to avoid enumeration.
- `409 CONFLICT` — invalid workflow state or idempotency-key conflict.
- `413 PAYLOAD_TOO_LARGE` — request body exceeds configured limit.
- `429 RATE_LIMITED` — rate limit reached.
- `503 AUTH_PROVIDER_NOT_CONFIGURED` — fail-closed configuration state in a non-production build; never treat this as successful authentication.
- `500 INTERNAL_ERROR` — unexpected failure with a correlation ID; no stack trace.

Example error body: `{ "error": { "code": "AUTHENTICATION_REQUIRED", "message": "Authentication is required." } }`.

## Required controls before a pilot

1. Select and configure a real identity provider/session strategy; validate issuer, audience, expiry, signature and revocation/session policy server-side.
2. Define role assignment and object-level authorization. Never accept roles from client claims that the server has not verified.
3. Implement transactional activity approval + ledger insert + audit event, with unique idempotency constraints and concurrency tests.
4. Test authorization bypass, cross-participant access, duplicate submissions, replayed approvals, malformed input, integer overflow and rate limits.
5. Define data minimization, privacy notice, retention/deletion policy, access logging and incident response.
6. Verify encrypted transport, secret management, database access boundaries, backups, restore drills and monitoring.
7. Complete legal and operational review before onboarding real participants or assigning any practical value to points.

## Current implementation status

| Component | Status |
|---|---|
| Pure ledger validation helpers | Prototype implemented |
| Unit tests and CI workflow | Implemented; check current GitHub Actions result |
| SQL schema draft | Written, not applied to a database |
| API handlers | Not implemented |
| Identity provider / sessions | Not configured |
| Persistent database | Not connected |
| Admin review workflow | Not implemented |
| Production deployment | Not authorized or performed |
