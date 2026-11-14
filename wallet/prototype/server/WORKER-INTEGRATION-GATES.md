# Wallet Worker authentication integration gates

**Status: design and implementation checklist only. No Worker route is connected, no D1 database is bound, and no email provider is configured.**

This document records the safe integration boundary after the isolated OTP/session repository work. It is not a deployment instruction and does not authorize participant onboarding.

## Findings from the current repository

- The deployed-architecture source currently present on `main` is `intelligence/ai-backend-cloudflare/worker.js`. Its public routes are limited to `POST /v1/ask` and `POST /v1/tools`; it enforces one configured Origin and uses a Durable Object rate limiter.
- That ЖАК Worker has no Wallet route, no D1 binding, no OTP flow, no participant session verifier, and no mail delivery adapter. Do not add Wallet authentication by routing it through the ЖАК question handler.
- `wallet/prototype/server/handler.js` is an isolated, dependency-injected scaffold. It has no Cloudflare Worker entrypoint and returns fail-closed responses when adapters are absent.
- `d1-auth-repository.js` contains isolated OTP challenge, rate-limit, session, and participant-role persistence methods. Its SQL tests are not a live Cloudflare D1 integration test.
- `d1-repository.js` is a separate prototype ledger adapter. Keep authentication/session persistence and ledger operations behind explicit server-side adapters.

## Required route contract

Use a dedicated Wallet Worker service or a separately reviewed Worker entrypoint. Do not widen the ЖАК Worker route surface as a side effect.

| Route | Method | Required behavior |
|---|---|---|
| `/api/v1/auth/otp/request` | POST | Validate a normalized email; derive email and source rate keys server-side; create a short-lived challenge; deliver only through a configured mail adapter; return the same generic response for known, unknown, suspended, or closed accounts. |
| `/api/v1/auth/otp/verify` | POST | Validate bounded challenge/code input; atomically consume a non-expired, non-revoked challenge with attempt limits; return a generic failure for invalid, expired, replayed, or exhausted codes. |
| `/api/v1/auth/session` | GET | Verify the opaque session cookie against a stored token HMAC; load participant status and active scoped role assignments from D1; fail closed on missing dependencies. |
| `/api/v1/auth/logout` | POST | Revoke the current session server-side and clear the cookie using matching cookie attributes. |
| `/api/v1/me` | GET | Return minimal data for the participant derived from the verified session only. |

No balance, transfer, exchange, gift, ledger mutation, or administrative business operation becomes enabled by implementing authentication routes.

## Security requirements before implementation

1. **Origin and browser protections:** exact allowlist; reject missing/untrusted Origin for browser mutations; no wildcard credentialed CORS. If cookie sessions are used, set `Secure; HttpOnly; SameSite=Lax` (or stricter where compatible), narrow Path/Domain, and add an explicit CSRF strategy for every state-changing request.
2. **Trusted source identity:** derive source rate keys only from trusted Cloudflare request metadata at the Worker boundary. Never accept IP, source key, participant ID, role, or timestamp from JSON or query parameters. Define behavior for missing source metadata.
3. **OTP privacy:** generic request response and comparable timing for account enumeration resistance; short expiry; strict attempt cap; one-time consumption; no OTP in logs; store only a keyed HMAC of the code, never the raw code.
4. **Session safety:** generate high-entropy opaque tokens with a cryptographically secure random source; store only a keyed HMAC; enforce expiry and revocation; rotate after successful verification; never return the token in JSON or expose it to browser JavaScript.
5. **Mail delivery:** inject a provider adapter with bounded timeout and sanitized errors. Do not mark an OTP as successfully delivered when the provider is absent or rejects delivery. Avoid revealing account existence in the public response.
6. **D1 and migrations:** create a dedicated non-production D1 database; apply and verify the complete ordered migration set there; test uniqueness, atomic counter gates, challenge replay, concurrent verification, session revocation, role expiry, and rollback. Do not use a production database for smoke tests.
7. **Authorization:** build the principal from a verified session plus server-loaded participant status and scoped, unexpired role assignments. Preserve project scope; global coordinator is not global admin. Resolve canonical project IDs from trusted persistence before project authorization.
8. **Operations:** configure secrets through the Cloudflare secret store, never commit values; add request correlation IDs, privacy-safe audit events, monitoring, backup/restore checks, and an incident/revocation procedure.

## Integration order

1. Finish and review the stacked Wallet persistence/security PR chain without merging it prematurely.
2. Add a dedicated Worker entrypoint with dependency injection and route-contract tests; keep all adapters disabled by default.
3. Add request/verify/session/logout tests, including hostile Origin, missing source metadata, malformed payloads, enumeration resistance, replay, concurrency, expired sessions, revoked participants, and role-scope bypass.
4. Deploy only to a non-production Worker environment connected to a separate test D1 database and a mail-provider sandbox.
5. Run end-to-end tests on desktop and iPhone; verify cookies, CSRF behavior, CORS, email delivery, rate limits, and failure modes.
6. Complete privacy, operational, and legal review before any real participant pilot.

## Explicitly disabled

Until every gate above is evidenced and separately approved: real participant onboarding, production identity/session use, real balances, ZP transfers, BFU/Jetton operations, gifts with value, exchange connections, deposits, withdrawals, and any movement of money or assets.
