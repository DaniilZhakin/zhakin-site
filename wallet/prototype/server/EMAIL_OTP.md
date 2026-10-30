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

The email OTP migration 0002_wallet_email_otp.sql depends on 0001_wallet_schema.sql from PR #57. It adds a normalized participant email field and a unique lookup index. Treat this as personal data: restrict access, define retention/deletion, and complete the privacy review before storing real addresses.

The D1 adapter must implement these methods with correct atomic semantics:

- `createOtpChallenge({ challengeId, email, codeHash, emailRateKey, sourceRateKey, createdAt, expiresAt })` — persist challenge, enforce per-email and per-source rate limits atomically using the keyed subjects, and return `{ deliverable: boolean }`. It must not disclose account existence to the caller.
- `consumeOtpChallenge({ challengeId, codeHash, now, maxAttempts })` — atomically increment failed attempts; on a matching unexpired code below the attempt limit, consume once and return `{ email }`; all other outcomes return null.
- `revokeOtpChallenge({ challengeId, revokedAt })`
- `findParticipantByEmail(email)`
- `createSession({ tokenHash, participantId, createdAt, expiresAt })`
- `findActiveSession({ tokenHash, now })`
- `getParticipantById(participantId)`
- `revokeSession({ tokenHash, revokedAt })`

The `wallet_auth_rate_limits` table is only a schema starting point. The future repository must enforce rate limits atomically and apply retention/purge rules.

## Required before integration

1. Choose and configure an email delivery provider using secrets stored only in the server environment. Pass a trusted source identifier from Worker request metadata into `requestCode(email, { sourceKey })`.
2. Implement the D1 repository contract with atomic challenge consumption, rate limiting, session revocation and participant lookup.
3. Add Worker routes for request-code, verify-code, logout and protected reads. Enforce POST-only mutations, same-origin checks, content-type validation, body limits and generic responses.
4. Add abuse controls: per-email and per-source limits, resend cooldown, challenge invalidation, monitoring without OTP/token logging, and delivery failure handling.
5. Review cookie domain/path, origin policy, email ownership and account recovery; add backup, expiry cleanup and incident response.
6. Test against a disposable D1 database and mail sandbox. Keep all wallet mutations disabled until the transactional ledger and audit workflow are independently approved.

Run the synthetic tests from `wallet/prototype` with Node.js 20+:

```sh
npm test
```

This authentication scaffold does not activate Wallet, create participants, or enable balances, transfers, accruals, withdrawals or trading. ZP remains separate from COIN УСЕРДИЕ / BFU.
