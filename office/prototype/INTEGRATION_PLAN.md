# OFFICE_DB integration plan

Status: design note for the isolated OFFICE_DB prototype. This document does not authorize deployment, D1 provisioning, identity-provider setup, or production integration.

## 1. Repository findings

The repository contains two related but currently separate implementation tracks:

- **ZHAKIN TEAM OFFICE control plane** — the new `office/prototype/` schema in PR #141. It models organizations, human identities, scoped roles, projects, tasks, decisions, approval requests, audit events, and evidence metadata.
- **Robot Office execution layer** — earlier draft work under `robot-office/` and its PR stack (including task handoff, worker adapter, role approval/credential lifecycle, task-object scope, and role-boundary tests). Those changes are not equivalent to the new OFFICE_DB schema and must not be assumed to be merged, deployed, or connected.

The static governance interface in PR #138 is a third layer: it is a presentation surface, not an authorization boundary or backend.

## 2. Required separation

1. OFFICE_DB is the authoritative store for office organizations, human identities, scoped grants, project/task/decision state, approval records, and governance audit.
2. Robot Office services may propose work and submit explicitly scoped task updates through a server-side adapter. They do not receive direct database credentials or unrestricted table access.
3. Wallet identity, sessions, cookies, role tables, balances, and Worker routes are not valid OFFICE authorization inputs.
4. A robot identity is a service principal with a narrow capability and task scope; it is not a human office user and cannot approve its own work or grant privileges.
5. Human approval is checked server-side at the moment of action. A UI state, request parameter, cached role, or agent-produced claim is never sufficient authorization.
6. Audit events are written transactionally with accepted state changes. Audit history remains append-only.

## 3. Integration contract to define before implementation

The adapter must explicitly map:

- verified identity: issuer + subject -> office user record;
- human role: active grant + organization/project scope -> allowed capabilities;
- robot principal: registered agent identifier + one task capability + object scope;
- task handoff: task ID + expected version + idempotency key + minimized summary;
- approval: separate human approver, current permission check, object version check, decision reason, and audit event;
- evidence: opaque storage key + hash + classification; never expose raw storage paths to the browser.

Every read and write must derive organization and project scope from trusted server-side records, not from caller-supplied IDs alone.

## 4. Compatibility gates

Before connecting the existing Robot Office service layer to OFFICE_DB:

- inventory the full base-branch chain of the Robot Office draft PRs and verify which commits are actually present in the selected integration branch;
- compare its current migration/table contract with `office/prototype/migrations/0001_office_core.sql`;
- document a one-to-one mapping or an explicit replacement for each overlapping entity;
- add adapter contract tests for tenant isolation, object-level ownership, stale versions, idempotency, deny-by-default behavior, and transactional audit rollback;
- run the migration and tests against a disposable local Cloudflare D1-compatible environment, not only SQLite;
- complete independent security review before any live identity provider or persistent database is considered.

Do not copy old Robot Office migrations into OFFICE_DB or apply both schemas to one database as a shortcut.

## 5. Delivery order

1. Keep PR #141 isolated and review its schema invariants.
2. Complete a read-only compatibility inventory of the Robot Office PR chain.
3. Agree on the canonical OFFICE_DB data contract and adapter boundary.
4. Implement read-only office API endpoints with deny-by-default authorization tests.
5. Add narrowly scoped task write/handoff operations with idempotency and audit.
6. Add human approval workflows only after identity, session, CSRF, rate-limit, and separation-of-duties controls are verified.
7. Perform iPhone/browser QA of the dashboard separately from backend security validation.

## 6. Explicit non-goals

This plan does not create a Cloudflare D1 database or binding, configure secrets, connect an identity provider or mail service, import real users, activate robot execution, enable Wallet or financial operations, merge a PR, or deploy to production.
