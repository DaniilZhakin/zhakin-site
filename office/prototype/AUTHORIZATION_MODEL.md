# OFFICE authorization model — proposal

Date: 2026-11-16  
Status: **proposal pending project-owner approval**. This document is a design baseline only. It does not grant access, create accounts, provision infrastructure, or authorize production integration.

## 1. Security objectives

The office authorization system must provide:

- deny-by-default access on every request;
- organization and project isolation enforced by the server and database;
- separate human identities and non-human robot service principals;
- least-privilege capabilities, constrained by organization, project, object, and operation;
- separation of duties for privilege grants and business approvals;
- current authorization checks at execution time, not trust in UI state or cached claims;
- immutable, attributable audit events for security-sensitive actions;
- safe failure when identity, policy, audit, or database dependencies are unavailable.

OFFICE authorization is independent of ZHAKIN Wallet, ZP/BFU balances, Wallet sessions, and public-site cookies.

## 2. Identity classes

### 2.1 Human office identity

A human identity is resolved from a trusted identity provider using the exact pair `issuer + subject`. Email is a contact/verification attribute, never the primary identity key.

A human user must be active, belong to the target organization, and hold a current grant covering the requested capability and resource scope.

### 2.2 Robot service principal

Robots must not be inserted into `office_users` and must not receive human roles. Use a separate registry (proposed table: `office_service_principals`) with:

- immutable principal ID and unique issuer + subject;
- owning organization and named robot/service;
- active, suspended, or revoked lifecycle state;
- allowed capability IDs and maximum resource scope;
- credential/key reference only (never raw secret material);
- validity window, rotation metadata, creator, approver, and revocation reason;
- created/updated timestamps and audit correlation.

A robot principal is non-interactive. It cannot authenticate to the human office UI, grant roles, approve its own actions, bootstrap administrators, or widen its own scope.

### 2.3 No implicit identity conversion

A Wallet participant, website visitor, email address, browser-supplied user ID, robot display name, or model-generated claim is not an OFFICE identity. Any future identity bridge requires an explicit, separately reviewed trust contract.

## 3. Proposed human role catalogue

Roles are organizational labels. Authorization decisions must use explicit capabilities plus resource scope, not role-name string checks scattered through handlers.

| Role | Intended authority | Explicit exclusions |
|---|---|---|
| `office_owner` | Governance ownership; nominate/approve designated administrators under dual control; organization-level oversight | Cannot bypass audit, separation of duties, or immutable history |
| `office_director` | Manage office portfolio, assign work, review operational status, submit decisions for approval | Cannot approve own request; cannot unilaterally grant own elevated access |
| `department_lead` | Manage assigned projects/workspaces, assign tasks, review team work | No organization-wide access by default; no role administration |
| `operator` | Read assigned work and update explicitly assigned task fields | No role grants, final approvals, audit administration, or cross-project access |
| `approver` | Approve/reject specified decision classes within granted scope | Must be distinct from requester/proposer; no self-approval |
| `access_admin` | Propose and administer identity/grant lifecycle within approved policy | Cannot approve own elevation or business decisions; cannot alter audit history |
| `auditor` | Read audit events and permitted evidence metadata for assigned scope | Read-only; no task mutation, approvals, grants, or secret access |

No user receives a role merely because they created an organization, project, task, or account. Role grants require an auditable grant event and an authorized grantor.

## 4. Capability catalogue

Initial capability names (final IDs remain subject to implementation review):

- `office.organization.read`
- `office.organization.manage`
- `office.project.read`
- `office.project.manage`
- `office.task.read`
- `office.task.create`
- `office.task.assign`
- `office.task.update_assigned`
- `office.task.close`
- `office.decision.propose`
- `office.decision.review`
- `office.decision.approve`
- `office.evidence.metadata_read`
- `office.evidence.upload_request`
- `office.access.grant_propose`
- `office.access.grant_approve`
- `office.audit.read`
- `office.robot.handoff_submit`
- `office.robot.task_status_update`

A capability grant must include organization scope and, where applicable, project/object scope, validity dates, grantor, approval reference, and revocation state. Wildcard/global scopes are prohibited for robots and should be exceptional for humans.

## 5. Role-to-capability baseline

This is a starting policy matrix, not an authorization implementation.

| Capability family | Owner | Director | Department lead | Operator | Approver | Access admin | Auditor |
|---|---:|---:|---:|---:|---:|---:|---:|
| Organization read | Yes | Yes | Scoped | No by default | Scoped | Scoped | Scoped |
| Project read | Yes | Yes | Assigned | Assigned | Assigned | No by default | Scoped |
| Project management | Yes | Yes | Assigned | No | No | No | No |
| Task create/assign | Yes | Yes | Assigned | No | No | No | No |
| Assigned task update | Yes | Yes | Assigned | Assigned | No | No | No |
| Decision propose | Yes | Yes | Assigned | No by default | No | No | No |
| Decision approve | Only if separately appointed and never self | No by default | No by default | No | Assigned | No | No |
| Access grant propose | Yes | Yes | No | No | No | Yes | No |
| Access grant approve | Dual-control only | No by default | No | No | Separately appointed | Cannot self-approve | No |
| Audit read | Scoped | Scoped | Scoped | No | Scoped | Scoped | Scoped read-only |

Every “Yes” remains constrained by resource scope and current status. The matrix must be encoded as data/policy and tested; it must not be treated as a UI display rule.

## 6. Robot capability profiles

Robots receive narrow machine capabilities, never human roles:

| Robot profile | Allowed operations | Hard limits |
|---|---|---|
| `task_assistant` | Read assigned task context; submit proposed updates or draft artifacts | Cannot assign tasks, close tasks, approve, or read unrelated projects |
| `research_agent` | Read explicitly authorized source/evidence metadata; submit research output to an assigned task | No unrestricted document search; no external publication or outbound communication |
| `legal_agent` | Read specifically assigned legal workspace/task context; submit draft analysis | No legal sign-off, approval, or access to Treasury unless separately scoped |
| `treasury_agent` | Read specifically assigned Treasury task data; submit draft calculations/reconciliation notes | No payment, transfer, wallet, custody, or financial execution capability |
| `command_agent` | Receive only minimized, explicitly addressed handoff summaries; return coordination proposals | No direct database access, broad source records, credentials, or authority to approve/execute |
| `office_assistant` | Read allowed task summaries and create draft proposals | No privilege changes, final decisions, or autonomous external actions |

A robot capability is bound to a service principal, organization, project/workspace, allowed operation, and (for task operations) a specific task or bounded task set. Capability expansion requires a human grant workflow and cannot be requested and approved by the same actor.

## 7. Approval and separation-of-duties rules

1. The requester/proposer and approver must be different human identities.
2. The approver must hold the current approval capability for the exact organization, project, decision class, and object.
3. Approval binds to an immutable object version/hash. Any material change invalidates the pending approval and requires resubmission.
4. Approval records include action, reason, approver identity, policy/grant version, object version/hash, request/idempotency key, and timestamps.
5. A robot may prepare a proposal but cannot be the approver or provide the human approval credential.
6. Elevated access requires dual control: one authorized human proposes, a different authorized human approves. Bootstrap access must use an out-of-band, owner-controlled recovery procedure and must be audited.
7. Emergency access, if ever introduced, must be time-limited, narrowly scoped, reason-coded, alerted, and subject to retrospective review. It is not part of the initial prototype.

## 8. Server-side authorization algorithm

For every request, the adapter must:

1. Authenticate the credential through a trusted verifier; reject missing, invalid, expired, or revoked credentials.
2. Resolve the exact principal from trusted issuer + subject. Never accept caller-supplied actor IDs as identity.
3. Load current principal state and grants from OFFICE_DB; do not rely on stale browser claims or long-lived role caches.
4. Derive organization/project/object ownership from database records. Treat supplied IDs only as lookup selectors, never as proof of scope.
5. Evaluate capability, resource scope, validity window, lifecycle state, and separation-of-duties constraints.
6. Validate object version and idempotency key for mutations.
7. Perform the state change and append the audit event in one transaction. If audit persistence fails, roll back the state change.
8. Return a minimal response. Do not expose secrets, credential references, internal storage paths, or cross-tenant object existence.

Unknown capability, missing policy, ambiguous scope, unavailable identity service, or audit failure must result in denial (fail closed).

## 9. Audit requirements

Record at minimum: actor principal type and ID, organization, capability, action, object type/ID, outcome, reason code, request ID, object version/hash where relevant, timestamp, and policy/grant reference.

Audit is append-only. No application role, robot, or administrator may update or delete existing audit events. Corrections are new linked events. Sensitive values and raw credentials must never be written to audit payloads.

## 10. Required negative security tests

Before adapter integration, tests must demonstrate:

- unauthenticated and expired/revoked principals are denied;
- unknown issuer/subject is denied;
- human principal cannot cross organization or project boundaries;
- robot cannot call a human-only capability or access an unassigned task;
- robot cannot grant privileges, approve, or bootstrap an owner;
- robot receives only the minimized handoff payload for its audience;
- requester cannot approve own decision;
- grant proposer cannot approve own elevation;
- stale object version and replayed idempotency key are rejected safely;
- revoked grants take effect on the next request;
- caller-supplied organization/project/actor IDs cannot widen scope;
- missing policy or unavailable auth/audit dependency fails closed;
- audit write failure rolls back the associated mutation;
- audit update/delete attempts fail;
- no Wallet cookie, Wallet user ID, ZP/BFU balance, or public-site session authorizes OFFICE access.

SQLite schema tests are useful but insufficient. The adapter and migration must also be tested in a disposable D1-compatible runtime before remote infrastructure is considered.

## 11. Decisions reserved for project-owner approval

The following are deliberately not treated as approved facts:

1. Whether Treasury and Legal are separate projects, project categories, or organization-level workspaces.
2. Whether there is one office owner or a multi-person governing body.
3. Which named humans may hold owner, director, approver, or access-admin authority.
4. Which robot profiles are enabled initially and their exact task scopes.
5. Handoff audience, payload schema, and retention period.
6. Evidence/document retention, quarantine, and deletion policy.
7. Emergency-access policy and recovery custodians.

Until these decisions are approved, this proposal must not be translated into live grants, identity-provider configuration, or production routes.

## 12. Non-goals and deployment boundary

This proposal does not create or bind Cloudflare D1, configure secrets, configure identity or email providers, create users, import participant data, activate robots, connect Wallet, enable payments/transfers, merge PRs, or deploy code. All implementation work remains isolated in the draft PR branch until separately reviewed and explicitly approved.
