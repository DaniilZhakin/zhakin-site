# ZHAKIN Wallet API scaffold

**Status: isolated prototype only — not deployed and not production-ready.**

The HTTP handler and Cloudflare D1 repository adapter are separate building blocks. The adapter implements read operations only for a participant ID supplied by a server-verified principal. It is not wired to a Worker, identity provider, or database.

## Current behavior

- `GET /health` reports `ready: false`; it is not a readiness guarantee.
- `GET /api/v1/me` requires an injected server-side authentication adapter.
- Balance and history require verified identity plus an injected repository.
- Ledger history uses a bounded page size and validated keyset cursor.
- Personal/account responses use `Cache-Control: no-store`.
- Admin routes deny callers without a server-verified coordinator/admin role.
- All mutations remain disabled. No points can be accrued, reversed, transferred, or topped up.
- Missing adapters fail closed. There is no mock identity, fabricated balance, or browser-provided participant ID fallback.

## Database

`migrations/0001_wallet_schema.sql` defines the isolated SQLite/Cloudflare D1 prototype schema, including participant ownership constraints, immutable ledger identity fields, and unique idempotency keys. The migration has **not** been applied to any database.

## Before any deployment

1. Configure a real identity/session provider and verify signature, issuer, audience, expiry, revocation and server-side role assignment.
2. Review and apply migrations only to a disposable, non-production D1 database first.
3. Implement transactional activity approval, durable idempotency and atomic audit writes.
4. Add rate limits, explicit CORS/CSRF policy, privacy/retention rules, monitoring and least-privilege database access.
5. Test authorization bypass, replay, concurrent requests, rollback, backup and restore.
6. Complete legal and operational review before real participants or any practical value for points.

Run the synthetic test suite from `wallet/prototype` with Node.js 20+:

```sh
npm test
```

This scaffold is not connected to the public site, ЖАК backend, analytics, AppDeploy, or COIN УСЕРДИЕ / BFU. Do not treat it as an operational wallet.
