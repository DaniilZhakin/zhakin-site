# ZHAKIN Wallet API scaffold

**Status: isolated scaffold only — not deployed and not production-ready.**

This module is a deliberately fail-closed HTTP handler for future server-side integration. It is not wired to a real identity provider, session verifier, database, Cloudflare Worker, or public website.

## Current behavior

- `GET /health`: reports `ready: false`; it does not claim that the service is operational.
- `GET /api/v1/me`: requires an injected server-side authentication adapter.
- `GET /api/v1/me/balance` and `GET /api/v1/me/ledger`: require both verified identity and an injected repository.
- `/api/v1/admin/*`: denies callers without a server-verified coordinator/admin role.
- All HTTP mutations remain disabled; no points can be accrued or reversed through the handler.
- `d1-repository.js` implements read-only D1 queries. `d1-operations.js` is an isolated, unconnected write-path prototype for awards tied to approved activities.
- The write-path prototype batches the ledger insert and success-audit insert, checks activity approval and matching points in SQL, and relies on unique idempotency/activity constraints. It is not yet validated against a real D1 instance or concurrent live requests.
- Missing adapters fail closed. There is no mock identity, demo balance, or client-provided participant identity fallback.

## Schema notes

- `migrations/0001_wallet_schema.sql` defines the prototype tables; it has not been applied to any database.
- `migrations/0002_wallet_accrual_guard.sql` adds a unique partial index to prevent more than one accrual for an activity; it has not been applied. Before applying it anywhere, inspect existing rows for duplicates and plan a reviewed migration.
- The caller of `d1-operations.js` must authenticate the actor, authorize coordinator permissions, and establish participant/activity context on the server. This module is not an authentication or authorization provider.

## Before any deployment

1. Select and configure a supported identity provider; validate issuer, audience, expiry, signature, revocation/session rules, and role assignment server-side.
2. Exercise the write path against a disposable D1 database, confirming D1 batch semantics, uniqueness constraints, duplicate retries, concurrent awards, and rollback behavior.
3. Integrate the operation only behind server-verified coordinator authorization and an approved activity workflow; keep browser-supplied actor, role, participant, balance, and points untrusted.
4. Review and apply schema migrations only after checking the target database and existing data.
5. Add least-privilege database access, input limits, rate limits, CORS/CSRF policy appropriate to the chosen auth method, privacy/retention rules, backups, recovery, and monitoring.
6. Review legal terms and participant/admin operating procedures.
7. Configure secrets only in the server environment. Never commit tokens, passwords, or production personal data.

Run the current domain and handler tests from `wallet/prototype` with Node.js 20+:

```sh
npm test
```

This scaffold does not connect to the main site, the ЖАК assistant, analytics infrastructure, AppDeploy backups, or COIN УСЕРДИЕ / BFU. Do not treat it as an operational wallet.
