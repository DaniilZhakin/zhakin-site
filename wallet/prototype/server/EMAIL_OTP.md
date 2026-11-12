# ZHAKIN Wallet email OTP authentication scaffold

**Status: security-oriented prototype only. Not connected to a live mail provider, D1 database, Worker, or public API.**

## Design

- Email is normalized server-side.
- The Worker must pass a trusted source identifier from request metadata (for example, Cloudflare's connecting-IP value); the service HMACs both email and source keys before storage. Source identifiers from body/query parameters are forbidden.
- OTP is six digits, generated with cryptographic randomness, valid for 10 minutes, and limited to five attempts.
- Only an HMAC of the OTP is persisted; the raw code is passed only to the injected mail-delivery adapter.
- Successful verification consumes the challenge and creates a random 256-bit session token.
- Only an HMAC of the session token is persisted.
- Session cookie is HttpOnly, Secure, SameSite=Strict and scoped to /api/v1.
- Every authenticated request resolves the participant and roles from server-side records. No browser-provided participant ID or role is trusted.
- Logout revokes the server-side session.

## Required repository contract

The email OTP migration `0003_wallet_email_otp.sql` depends on `0001_wallet_schema.sql` and the unified role-assignment registry in `0002_wallet_role_assignments.sql`. It adds a normalized participant email field, a unique lookup index, OTP challenges, hashed sessions and keyed rate-limit counters. Authentication loads roles only from active server-side `wallet_role_assignments`; role grants may have an optional Unix-millisecond `expires_at` and expired grants are excluded on every authentication. The authenticated principal preserves each grant's `scopeType` and `scopeId`; consumers must authorize project actions against the exact project scope and must never treat a project-scoped coordinator grant as a global role. Browser claims are never used. Role assignment/revocation endpoints are intentionally not implemented and must require a separate authorized human workflow. Treat email as personal data: restrict access, define retention/deletion, and complete the privacy review before storing real addresses.

The D1 adapter implements these methods:

- `createOtpChallenge(...)` — persist challenge, enforce per-email and per-source rate limits atomically using keyed subjects, and return `{ deliverable: boolean }`.
- `consumeOtpChallenge(...)` — atomically increment failed attempts; on a matching unexpired code below the attempt limit, consume once and return `{ email }`; all other outcomes return null.
- `revokeOtpChallenge(...)`
- `findParticipantByEmail(email)`
- `createSession(...)`
- `findActiveSession(...)`
- `getParticipantById(participantId, now)` — return global roles separately from scope-preserving role assignments; exclude revoked and expired grants.
- `revokeSession(...)`

The `wallet_auth_rate_limits` table still needs retention/purge rules. The unified role registry is read-only in this scaffold; no API route can grant or revoke roles. Coordinator requests remain denied by admin routes until object-level project authorization is implemented.

## Required before integration

1. Choose and configure an email delivery provider using secrets stored only in the server environment. Pass a trusted source identifier from Worker request metadata into `requestCode(email, { sourceKey })`.
2. Implement and integration-test the D1 repository contract with atomic challenge consumption, rate limiting, session revocation and participant lookup.
3. Add Worker routes for request-code, verify-code, logout and protected reads. Enforce POST-only mutations, same-origin checks, content-type validation, body limits and generic responses.
4. Add abuse controls: per-email and per-source limits, resend cooldown, challenge invalidation, monitoring without OTP/token logging, and delivery failure handling.
5. Review cookie domain/path, origin policy, email ownership and account recovery; add backup, expiry cleanup and incident response.
6. Test against a disposable D1 database and mail sandbox. Keep all wallet mutations disabled until the transactional ledger and audit workflow are independently approved.

Run synthetic tests from `wallet/prototype` with Node.js 20+ using `npm test`.

This scaffold does not activate Wallet, create participants, or enable balances, transfers, accruals, withdrawals or trading. ZP remains separate from COIN УСЕРДИЕ / BFU.
