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

## Credential envelope and recovery protocol

The following protocol resolves the delivery/recovery ambiguity before any route is implemented.

### Stored envelope

- Generate the opaque approval token with a cryptographically secure random source. Continue storing only its SHA-256 digest in the approval row for grant-time verification.
- Encrypt the token using AES-256-GCM with a fresh, cryptographically random 96-bit IV for each envelope. Never reuse an IV with the same key.
- Persist only the ciphertext, IV, authentication tag (or the combined Web Crypto ciphertext/tag representation), key version identifier, and non-secret envelope metadata. Do not persist the plaintext token.
- Construct canonical Additional Authenticated Data (AAD) from a versioned, unambiguous encoding of: organization ID, approval request ID, requester subject ID, target subject ID, role, scope, approval expiry, token expiry, and envelope version. Decryption must reconstruct AAD from the authoritative database row, not from caller-supplied values.
- Keep the encryption key in a server-side secret/KMS boundary. Never place it in source control, D1, browser code, logs, or analytics. Key-version lookup must be explicit; unknown or unavailable key versions fail closed.
- Envelope lifetime must not exceed the approval/token lifetime. Remove ciphertext after successful grant consumption, explicit revocation, or expiry cleanup. Audit only envelope lifecycle metadata, never ciphertext or token material.

### Reviewer decision

- The reviewer decision transaction changes the request from pending to approved/rejected and appends the corresponding audit event atomically.
- On approval, the service creates the token digest and encrypted envelope, but returns only request ID, decision state, decision timestamp, and expiry metadata. The reviewer never receives the token or ciphertext.
- The decision service must not return a token through exceptions, debug output, tracing, logs, or test snapshots.

### Requester retrieval and idempotent recovery

- The requester generates a high-entropy retrieval idempotency key before the first retrieval attempt. It is an operation identifier, not a credential; it must not contain the approval token.
- The server authenticates the requester from a verified session and checks that the session subject and organization exactly match the approval row's requester and organization. It also re-checks the current access-administrator grant, session validity, approval state, token expiry, and target/role/scope binding.
- The first valid retrieval atomically records a hash of the retrieval idempotency key and retrieval timestamp while retaining the encrypted envelope for the narrowly bounded recovery window. The server decrypts only after the database binding checks succeed.
- A retry with the same idempotency key by the same authenticated requester may recover the same token during that short window. A different idempotency key, different subject, different organization, expired window, or changed approval state is rejected. This is deliberately idempotent delivery recovery, not a second approval or a second grant.
- The client keeps the idempotency key only as non-secret retry metadata (for example, in page memory or session-scoped storage); the bearer token exists only in memory and is never written to localStorage, sessionStorage, IndexedDB, URLs, or analytics.
- After the recovery window, a lost token is not recoverable. The system must revoke/expire the old approval and require a fresh request and independent human decision. It must never mint a replacement token silently against the old approval.
- The grant operation remains the final one-time use: the approval token is bound to the original requester, organization, target, role, scope, and exact grant expiry, and is consumed in the same D1 batch as grant insertion and audit append. Concurrent submissions must yield at most one grant.
- Retrieval attempts are rate-limited and return generic, request-ID-correlated errors with `Cache-Control: no-store`. The endpoint accepts no token or secret in the URL.

### Atomicity and race handling

- Use a conditional database state transition with a unique retrieval-key hash and a bounded recovery deadline. Check affected-row counts; zero or multiple affected rows are a conflict, not success.
- The envelope must not be deleted before the response can be retried within the recovery window. A same-key retry returns the same credential only to the same requester; a different-key retry cannot rotate or retrieve it.
- Consumption/revocation/expiry must invalidate retrieval immediately. If retrieval races with grant consumption or revocation, the database state transition decides the winner; a stale decrypted token must still fail grant-time verification.
- A database rollback must leave neither a partial retrieval marker nor an audit event. A failed decrypt/authentication-tag check must not disclose plaintext and must be recorded only as a sanitized failure event.
- The recovery window should be short and fixed by policy (initial proposal: 2 minutes), independently capped by token expiry. It is not extendable by repeated retries.

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
- Encryption tests cover tampered ciphertext/AAD, wrong key, missing key, unknown key version, IV uniqueness, expiry, and key rotation. No test may print plaintext credentials.

## Proposed endpoint contract (not implemented)

- `POST /api/robot-office/role-approval-requests`: authenticated access administrator creates a bounded request; no role is granted.
- `POST /api/robot-office/role-approval-requests/:id/decision`: matching independent human reviewer approves/rejects; response contains no bearer token.
- `POST /api/robot-office/role-approval-requests/:id/credential`: original requester retrieves the one-time credential through a server-authenticated channel, after all binding checks and using a client-generated retrieval idempotency key.
- `POST /api/robot-office/role-grants`: original requester submits the credential; D1 atomically consumes approval, inserts grant, and appends audit.

The exact retrieval method and recovery semantics are specified above as a design proposal. Endpoints are not implemented, and this document does not authorize route wiring.

## Operational boundary

- Keep all work on isolated branches and Draft PRs.
- Do not merge PR #71 or this follow-up without explicit human approval.
- Do not run remote Cloudflare D1 workflows or touch production bindings.
- Do not activate autonomous financial, legal, or administrative actions. Human confirmation remains mandatory for elevated operations.
