# ZHAKIN Wallet API scaffold

**Status: isolated scaffold only — not deployed and not production-ready.**

This module is a deliberately fail-closed HTTP handler for future server-side integration. It is not wired to a real identity provider, session verifier, database, Cloudflare Worker, or public website.

## Current behavior

- `GET /health`: reports `ready: false`; it does not claim that the service is operational.
- Unknown paths return `404 not_found` before authentication; nonexistent endpoints are not reported as generic `501` operations.
- Unsupported HTTP methods return `405 method_not_allowed`.
- `GET /api/v1/me`: requires an injected server-side authentication adapter and returns only the verified participant ID. Internal roles and role assignments remain server-side.
- `GET /api/v1/me/balance` and `GET /api/v1/me/ledger`: require both verified identity and an injected repository.
- `/api/v1/admin/*`: requires a server-loaded, active global `admin` grant. Coordinator grants and browser-provided roles are not sufficient.
- `/api/v1/projects/{lookupId}/*`: requires a trusted project resolver and an active global admin, global coordinator, or coordinator grant for the exact canonical project ID returned by that resolver. Missing resolver fails closed; unauthorized or missing projects are concealed as `404`.
- Project and admin guards do not enable business operations; unimplemented routes and mutations still return `501`.
- All unimplemented routes and mutations are disabled; no points can be accrued or reversed through this scaffold.
- Missing adapters fail closed. There is no mock identity, demo balance, or client-provided participant identity fallback.

## Isolated D1 adapter status

- `d1-repository.js` contains participant-scoped balance reads, bounded ledger pagination, active-role lookup, and a batched ledger/audit write helper.
- Migration `0002_wallet_role_assignments.sql` defines global admin and global/project-scoped coordinator grants with revocation metadata and uniqueness for active grants.
- Role scope is stored and returned by the repository. The HTTP handler denies coordinator access to admin routes until project-scope authorization is enforced against each target object.
- The HTTP handler remains fail-closed; no Worker route imports or invokes the D1 adapter.
- Repository tests use a synthetic D1-compatible test double. The workflow also runs a local SQLite schema smoke test; neither proves that a real Cloudflare D1 database is working.
- Migration files have not been applied to any database.

## Authorization integration contract

1. `authenticate` must return a principal assembled from server-side verified identity and repository-loaded role assignments.
2. `projectRepository.getProjectById(routeLookupId)` must resolve the project from trusted persistence and return its canonical `id`.
3. Project access is checked against that canonical ID using `hasWalletProjectAccess`; a project coordinator cannot access another project.
4. Administrative routes use `hasWalletGlobalAdminAccess`; coordinator roles never authorize administrative operations.
5. Every eventual operation still needs participant ownership checks, resource-level authorization, input validation, rate limits, transactional persistence and audit logging.

## Before any deployment

1. Select and configure a supported identity provider; validate issuer, audience, expiry, signature, revocation/session rules, and role assignment server-side.
2. The isolated D1 repository adapter is implemented in `d1-repository.js`; before any pilot, wire it only through a verified Worker binding and validate transactional ledger writes, durable idempotency, and atomic audit events against a separate test D1 database.
3. Complete object-level authorization for each project resource, including participant ownership checks and explicit denial tests for cross-project and cross-participant access.
4. Add schema migrations, least-privilege database access, input limits, rate limits, CORS/CSRF policy appropriate to the chosen auth method, privacy/retention rules, and monitoring.
5. Test authorization boundaries, replay/idempotency, concurrency, rollback, backup and recovery.
6. Review legal terms and participant/admin operating procedures.
7. Configure secrets only in the server environment. Never commit tokens, passwords, or production personal data.

Run the current domain and handler tests from `wallet/prototype` with Node.js 20+:

```sh
npm test
```

This scaffold does not connect to the main site, the ЖАК assistant, analytics infrastructure, AppDeploy backups, or COIN УСЕРДИЕ / BFU. Do not treat it as an operational wallet.
