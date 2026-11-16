# Robot Execution Gateway — implementation contract

Status: isolated prototype in draft PR #141. Not wired to a Worker route, identity provider, D1 binding, user interface, or production environment.

## Scope delivered

- `createRobotExecutionGateway` accepts only a dedicated D1-compatible OFFICE_DB binding and a trusted credential-verifier callback.
- The verifier contract returns a verified `issuer + subject` pair. The gateway does not decode or trust browser-supplied claims.
- Every task request resolves the active robot principal and a current capability scope against the target task, organization, and project in one server-side query.
- Principal status, validity window, scope revocation/validity, task lifecycle, project status, and organization status are checked on each request.
- Task reads return a minimized projection and append an audit event. If audit persistence fails, task data is not returned.
- Robot write intent is represented only as a proposal with a fixed field allowlist (`title`, `description`, `acceptance_criteria`). It never updates `office_tasks`.
- Proposal submission checks the expected task version, enforces a per-principal idempotency key, and writes proposal + audit in one D1 `batch`.
- Migration 0003 independently rechecks principal, grant, object scope, lifecycle and expected task version at insert time, reducing the authorization TOCTOU window.
- Proposals remain pending until a separate human-review workflow is implemented. No robot can accept/reject its own proposal.

## Explicit integration contract

The caller must:
1. Authenticate a bearer credential using a trusted verifier that validates signature, issuer, audience, expiry/not-before, and revocation status.
2. Pass only the verified token to this module. Never pass decoded claims from the browser.
3. Bind the actual dedicated OFFICE_DB D1 database as `db`.
4. Keep this module behind a server-side route with request-size limits, rate limits, origin/CSRF controls where applicable, and structured security logging.
5. Map typed gateway errors to safe HTTP responses without exposing SQL, identity details, or cross-tenant object existence.

## Current non-goals

- No authentication provider or credentials are configured.
- No Cloudflare D1 database/binding, Worker route, API endpoint, or production secret is created.
- No robot is registered, activated, or granted a capability.
- No human review/approval endpoint is implemented.
- No external communication, document download, file access, payment, Wallet, or financial action is possible.
- No production data is read or changed.

## Validation plan

CI runs:
- existing OFFICE_DB schema tests;
- robot principal registry migration tests;
- robot proposal migration tests;
- Node contract tests for minimized reads, deny-by-default lookup, fixed capability selection, audit writes, stale-version rejection, allowlisted proposal fields, and proposal-only writes.

These tests are local SQLite / mocked D1 contract checks. They do not prove Cloudflare D1 runtime compatibility, cryptographic verifier correctness, concurrency behavior in production, or complete authorization security. Those remain mandatory gates before integration.
