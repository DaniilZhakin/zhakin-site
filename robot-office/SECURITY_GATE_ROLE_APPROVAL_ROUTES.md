# Robot Office: security gate for authenticated role-approval routes

Status: design review; no production integration is authorized by this document.

## Current verified baseline

- PR #71 adds server-only role-approval and role-grant services.
- Isolated schema, authorization-policy, and local D1-emulator tests pass in workflow run 41213770792.
- The role-approval service persists only a SHA-256 hash of the approval token.
- The grant service consumes the approval and writes the grant plus audit event in one D1 batch.
- The Worker adapter is not wired to the site's Worker entrypoint.
- No production D1, remote Cloudflare D1, AppDeploy, or `main` changes are part of this work.

## Blocking security finding: token recipient

`decideRoleGrantApproval()` currently returns the plaintext bearer token to its caller after the human reviewer approves a request. The intended security model requires the token to be delivered to the requesting access administrator, not exposed to the reviewer as a usable grant credential.

A hash-only database record is not sufficient to deliver the original token to a different principal. Do not expose the current decision-service return value through an HTTP route or UI.

### Required correction before routes

1. Separate the human decision operation from credential delivery.
2. The reviewer response must contain only the decision result and non-secret metadata; never the bearer token.
3. If delivery requires temporary server-side retention, store only authenticated ciphertext (for example AES-GCM) under a server-held key, with authenticated additional data binding organization, approval request, requester, target subject, role, scope, and expiry.
4. Only the original requesting access administrator, authenticated from a server-verified session and matching the bound organization, may retrieve/decrypt the credential.
5. Retrieval must be one-time and atomic, with explicit handling for concurrent requests and lost responses. A safe re-issue/revocation path is required; do not silently make the token reusable.
6. Never log plaintext tokens, include them in analytics, audit details, URLs, error messages, or browser storage.
7. If encryption key material is missing, invalid, or rotated incompatibly, fail closed. Do not fall back to plaintext storage.

## Route implementation gate

Do not add or wire role-approval HTTP routes until all of the following are implemented and tested:

- `resolvePrincipal` validates an actual server-side session and derives subject and organization exclusively from trusted session data.
- Session expiry, revocation, rotation, and organization membership are checked on every request.
- Role grants are loaded server-side for every operation; browser-supplied roles/scopes are ignored.
- Mutation requests require an allowed Origin and a CSRF defense appropriate to the site's session model.
- Rate limits apply to request creation, reviewer decisions, token retrieval, grant attempts, and failed authentication.
- Request bodies have strict content-type and byte limits; identifiers and enum values are validated.
- Idempotency is scoped to authenticated actor + organization + operation and cannot replay a different payload.
- Responses use `Cache-Control: no-store`; secrets never appear in URLs.
- Public errors are generic and request-ID correlated; internal details stay server-side.
- Audit events are append-only and written atomically with the state transition they describe.
- Tests cover cross-organization access, self-approval, reviewer/requester separation, wrong-role reviewer, expired/revoked sessions, CSRF, rate limits, token confidentiality, retrieval races, replay, lost-response recovery, and audit rollback.

## Proposed endpoint contract (not implemented)

- `POST /api/robot-office/role-approval-requests`: authenticated access administrator creates a bounded request; no role is granted.
- `POST /api/robot-office/role-approval-requests/:id/decision`: matching independent human reviewer approves/rejects; response contains no bearer token.
- `POST /api/robot-office/role-approval-requests/:id/credential`: original requester retrieves the one-time credential through a server-authenticated channel, after all binding checks.
- `POST /api/robot-office/role-grants`: original requester submits the credential; D1 atomically consumes approval, inserts grant, and appends audit.

The exact retrieval method and recovery semantics must be finalized before implementation. The endpoint list is a design proposal, not a claim that routes exist.

## Operational boundary

- Keep all work on isolated branches and Draft PRs.
- Do not merge PR #71 or this follow-up without explicit human approval.
- Do not run remote Cloudflare D1 workflows or touch production bindings.
- Do not activate autonomous financial, legal, or administrative actions. Human confirmation remains mandatory for elevated operations.
