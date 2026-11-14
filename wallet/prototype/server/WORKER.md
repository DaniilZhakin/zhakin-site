# Wallet Cloudflare Worker route scaffold

**Status: code scaffold and tests only. Not deployed. No live D1, mail service, HMAC secret, or production origin is configured.**

## Entrypoint and environment contract

The isolated entrypoint is `worker.js`. It does not import or modify the public ЖАК Worker.

Required Worker bindings/configuration:

| Name | Type | Purpose |
|---|---|---|
| `WALLET_DB` | D1 binding | Wallet auth schema and server-side participant/role/session records |
| `WALLET_MAILER` | Service binding | Dedicated internal mail-delivery Worker |
| `WALLET_AUTH_HMAC_SECRET` | Secret | HMAC key for OTP, rate subjects and session-token hashes; minimum 32 characters |
| `WALLET_ALLOWED_ORIGIN` | Plaintext variable | One exact browser origin, e.g. `https://wallet.example.org`; no path, wildcard, or comma-separated list |

The mailer service binding must accept `POST /v1/otp` at its internal service URL with JSON `{to, code, expires_at}` and return a successful HTTP status only after it has accepted the delivery request. The mailer must keep provider credentials in its own secret store, validate the request, apply bounded timeouts, avoid logging OTP values, and never expose its provider error details. No mailer implementation or provider credentials are included in this PR.

## Routes

- `POST /api/v1/auth/otp/request` — JSON `{email}`; source rate identity comes only from Cloudflare's `CF-Connecting-IP` request metadata. A body/query/header-supplied source identifier is ignored.
- `POST /api/v1/auth/otp/verify` — JSON `{challenge_id, code}`; successful verification sets an opaque `Secure; HttpOnly; SameSite=Strict` cookie.
- `GET /api/v1/auth/session` — returns minimal verified participant identity.
- `POST /api/v1/auth/logout` — revokes the session and expires the cookie.
- `GET /api/v1/me` — same minimal verified identity response.
- `GET /health` — explicitly reports `ready: false`.

All API responses are no-store. Mutations require an exact configured Origin. Cross-origin preflight is exact-origin only and credentials are not allowed with wildcard origins. GET requests with an Origin must match the configured origin; GET without Origin is allowed because the session cookie is SameSite=Strict and GET handlers are read-only.

Request JSON is streamed and bounded to 4 KiB. The Worker rejects unsupported content types, malformed JSON, untrusted origins and unsupported methods. Errors returned to clients are sanitized.

## Deliberate limits

- This Worker does not expose balance, ledger, transfer, ZP, BFU, exchange, deposit, withdrawal, role-grant or role-revocation routes.
- It does not provision participants or assign roles.
- Missing D1, HMAC secret, mailer binding or allowed origin leaves authentication unavailable.
- The service binding is a contract only; it is not a configured mail provider.
- The tests use injected fake authentication adapters and do not validate Cloudflare runtime behavior, a real D1 instance, a real mail service, cookie behavior on iPhone, or production deployment.

## Safe next validation

1. Run the complete Wallet test suite and inspect the new route-contract tests.
2. Provision a disposable Cloudflare D1 database and apply migrations 0001–0003 in order.
3. Build and security-review a dedicated mailer Worker with sandbox credentials; connect it only through a non-production service binding.
4. Deploy this Wallet Worker to a non-production environment with a test-only origin and HMAC secret.
5. Run end-to-end OTP, rate-limit, replay, session-revocation, CSRF/Origin, desktop and iPhone tests.
6. Keep all financial and participant-facing production features disabled pending separate approval.
