# Robot Office ↔ OFFICE_DB compatibility inventory

Date: 2026-11-16  
Status: read-only repository inventory; no runtime integration or migration execution.

## Executive finding

The existing `robot-office/` prototype and the newer `office/prototype/` control-plane schema are **not currently compatible at the SQL contract level**.

They reuse table names while defining different columns and different authorization models. Applying both migrations to one database is unsafe: `CREATE TABLE IF NOT EXISTS` would silently preserve whichever incompatible table definition was created first, while later service queries could fail or behave incorrectly.

**Decision:** keep the two prototypes isolated. Do not bind both to one D1 database, do not copy legacy migrations into OFFICE_DB, and do not wire the existing Worker adapter to the new schema until a deliberate adapter/data-contract change is implemented and tested.

## 1. Existing Robot Office implementation found

Read-only inspection of the open draft PR chain:

- PR #60 — initial `robot-office/migrations/0001_robot_office_schema.sql` and SQLite schema tests.
- PR #61 — pure authorization policy in `robot-office/src/access-policy.mjs`.
- PR #62 — service layer in `robot-office/src/office-service.mjs`.
- PR #63 — isolated HTTP adapter in `robot-office/src/worker-adapter.mjs`.
- PR #64 — task handoff and minimized handoff summaries.
- PR #72 — approval-token delivery security review.
- PR #73 — encrypted approval credential delivery and role-management service.
- PR #75 — role boundaries and least-privilege tests.

These are open draft/stacked changes, not a production-connected runtime. The Worker adapter explicitly expects `ROBOT_OFFICE_DB` and a trusted `resolvePrincipal` callback. It is not wired to the site's production Worker entrypoint.

The legacy prototype uses roles such as `treasury_agent`, `human_treasury`, `legal_agent`, `human_legal`, `command_agent`, `access_admin`, and `auditor`. It separates Treasury and Legal workspaces and limits ЖАК/COMMAND AI to minimized handoff summaries.

## 2. SQL contract collision inventory

| Domain | Legacy Robot Office contract | New OFFICE_DB contract | Compatibility |
|---|---|---|---|
| Organizations | `office_organizations(id,name,status,created_at INTEGER)` | `office_organizations(id,name,status,created_at TEXT)` | Same name, incompatible timestamp type/semantics and status vocabulary |
| Roles | `office_role_grants(subject_id, organization_id, role, scope, granted_by, granted_at INTEGER, expires_at, revoked_at)` | `office_roles` catalogue + `office_user_role_scopes(user_id, organization_id, project_id, role_id, ...)` | Different identity model, role vocabulary, scope granularity and grant lifecycle |
| Tasks | `office_tasks(workspace, owner_role, status, priority, title, description, created_by, created_at INTEGER, version)` | `office_tasks(project_id, created_by_user_id, assignee_user_id, status, priority, title, description, created_at TEXT, version)` | Same name, incompatible required columns and workspace-vs-project model |
| Documents | `office_document_metadata` with workspace, classification, storage object, filename, media type, size, checksum | `office_evidence_files` with project, opaque storage key, MIME type, size, SHA-256, classification | Similar purpose, not a drop-in replacement; evidence lifecycle and document metadata need mapping |
| Approvals | `office_approvals` and later `office_role_approval_requests` / `office_role_approval_credentials` | `office_approval_requests` plus decision fields | Different object model, credential lifecycle, reviewer semantics and version binding |
| Handoffs | `office_handoff_summaries` migration 0002; task version + idempotency + summary | No handoff-summary table | Missing capability in OFFICE_DB |
| Audit | `office_audit_events(actor_id, actor_role, action, object_type, object_id, outcome, request_id, occurred_at INTEGER, details_redacted)` | `office_audit_events(actor_user_id, action, object_type, object_id, before_hash, after_hash, reason, request_id, outcome, created_at TEXT)` | Same name, incompatible columns; both append-only, but event schemas differ |
| Identity | Principal `subjectId` + `organizationId`, sourced from future trusted session adapter | `office_users(identity_provider, provider_subject, ...)` | New schema has a canonical issuer+subject mapping; legacy principal adapter needs explicit resolver |

## 3. Authorization model differences

The legacy authorization policy is workspace-oriented and has explicit operational roles. Its current service queries active grants from `office_role_grants`, then authorizes actions against Treasury/Legal workspaces. It supports scoped handoff summaries for COMMAND AI.

The new OFFICE_DB schema is organization/project-oriented. It defines a generic role catalogue and project-scoped grants. It has stronger relational organization/project constraints, but it does not yet express the legacy role matrix or the robot service-principal lifecycle.

These models must not be merged by simply renaming roles. A deliberate capability matrix is required, including:
- mapping of legacy Treasury/Legal human and agent roles to new role IDs and explicit project scopes;
- separate robot/service-principal identity, not a human `office_users` record;
- command-agent access only to minimized handoff summaries;
- access administration and auditor capabilities kept separate from business-content permissions;
- server-side current-grant checks on every request;
- approval requester/reviewer separation and task/decision version binding.

## 4. Proposed canonical mapping (not yet implemented)

| Legacy concept | Canonical OFFICE_DB direction | Required work |
|---|---|---|
| `office_organizations` | `office_organizations` | Preserve IDs; normalize timestamps/status values through an explicit migration |
| `office_role_grants` | `office_user_role_scopes` for humans; separate service-principal registry for robots | Add role/capability mapping and issuer-subject resolution; do not place robots in human users |
| Treasury/Legal workspace | `office_projects` plus a controlled workspace/domain attribute | Decide whether each workspace is one project, a project family, or an organization-level domain; do not assume |
| `office_tasks` | `office_tasks` | Map workspace, owner role, due dates, version, actor and status; add compatibility tests and preserve optimistic concurrency |
| `office_document_metadata` | `office_evidence_files` plus document metadata extension/table | Preserve filename, retention, status, classification, opaque storage key and checksum |
| `office_approvals` | `office_approval_requests` | Map reviewer, action, status, reason, request idempotency and object version; keep role-grant approvals as a distinct protected workflow |
| `office_handoff_summaries` | New dedicated `office_handoff_summaries` table | Add minimal payload, task version, idempotency key, audience/capability scope, retention and audit link |
| `office_audit_events` | `office_audit_events` | Define canonical event envelope and one-way migration; preserve immutable history and actor provenance |
| Role approval credential tables | Separate approval credential envelope tables or redesign around one-time signed server-side approval records | Preserve AES-256-GCM envelope handling, AAD binding, requester-only retrieval, expiry, single-use consumption and secret isolation |

## 5. Blocking design decisions

Before coding the adapter, the project owner must settle these domain decisions:

1. Are Treasury and Legal separate projects, project categories, or organization-wide workspaces?
2. Are robot principals stored in a dedicated service-principal table with capabilities, or in a separate identity service? They must not be represented as human office users.
3. Does each office project have one canonical workspace/domain, or can one project span multiple workspaces?
4. Which role IDs/capabilities correspond to each existing Robot Office role, and who can bootstrap elevated access?
5. What is the canonical handoff audience and retention period for minimized summaries?
6. Which document retention and quarantine states must survive the move to the evidence model?

Until these are decided, a production-shaped adapter would encode assumptions rather than enforce an approved model.

## 6. Safe implementation sequence

1. Keep PR #141 and the Robot Office PR stack separate and draft.
2. Agree on the six domain decisions above.
3. Amend the OFFICE_DB schema additively on the PR #141 branch: service principals/capabilities, handoff summaries, document metadata/retention, and canonical approval idempotency/version fields as approved.
4. Build a one-way, disposable test-data mapping harness. No live or participant data.
5. Implement a read-only adapter against the canonical schema with deny-by-default tests.
6. Add task mutations only after tenant isolation, stale-version checks, idempotency, audit rollback, CSRF/session validation and rate limits are tested.
7. Run migrations and integration tests in disposable local D1-compatible runtime before any remote D1 provisioning.
8. Complete independent security review; only then consider a separate, explicitly approved deployment plan.

## 7. Verified boundaries

- No D1 database or binding was created.
- No migration was applied to local, remote or production D1.
- No session provider, identity provider, secret, email service or live user was configured.
- No Worker route was wired into production.
- No PR was merged and no deployment was performed.
- Wallet, ZP, BFU, USERDIE and production site code were not modified.
