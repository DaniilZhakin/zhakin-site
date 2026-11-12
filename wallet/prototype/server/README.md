# ZHAKIN Wallet API scaffold

**Status: isolated scaffold only — not deployed and not production-ready.**

This module is a deliberately fail-closed HTTP handler for future server-side integration. It is not wired to a real identity provider, session verifier, database, Cloudflare Worker, or public website.

## Current behavior

- `GET /health`: reports `ready: false`; it does not claim that the service is operational.
- `GET /api/v1/me`: requires an injected server-side authentication adapter.
- `GET /api/v1/me/balance` and `GET /api/v1/me/ledger`: require both verified identity and an injected repository.
- `/api/v1/admin/*`: requires a server-loaded, active global `admin` grant. Coordinator grants and browser-provided roles are not sufficient.
- `/api/v1/projects/{lookupId}/*`: requires a trusted project resolver and an active global admin, global coordinator, or coordinator grant for the exact canonical project ID returned by that resolver. Missing resolver fails closed; unauthorized or missing projects are concealed as `404`.
- The project and admin guards do not enable any business operation. Unimplemented routes and mutations still return `501`.
- Missing adapters fail closed. There is no mock identity, demo balance, or client-provided participant identity fallback.

## Authorization integration contract

1. `authenticate` must return a principal assembled from server-side verified identity and repository-loaded role assignments.
2. `projectRepository.getProjectById(routeLookupId)` must resolve the requested project from trusted persistence and return its canonical `id`. It must not trust roles, owner IDs, or scope from request data.
3. Project access is checked against that canonical ID using `hasWalletProjectAccess`; project coordinator grants cannot access another project.
4. Administrative routes use `hasWalletGlobalAdminAccess`; coordinator roles never authorize administrative operations.
5. Every eventual operation still needs participant ownership checks, resource-level authorization, input validation, rate limits, transactional persistence and audit logging. Passing a route guard is not blanket permission to read or mutate every object.

## Before any deployment

1. Select and configure a supported identity provider; validate issuer, audience, expiry, signature, revocation/session rules, and role assignment server-side.
2. Implement a persistent repository with transactional ledger writes, durable idempotency, and atomic audit events.
3. Add schema migrations, least-privilege database access, input limits, rate limits, CORS/CSRF policy appropriate to the chosen auth method, privacy/retention rules, and monitoring.
4. Test authorization boundaries, replay/idempotency, concurrency, rollback, backup and recovery.
5. Review legal terms and participant/admin operating procedures.
6. Configure secrets only in the server environment. Never commit tokens, passwords, or production personal data.

Run the current domain and handler tests from `wallet/prototype` with Node.js 20+:

```sh
npm test
```

This scaffold does not connect to the main site, the ЖАК assistant, analytics infrastructure, AppDeploy backups, or COIN УСЕРДИЕ / BFU. Do not treat it as an operational wallet.
