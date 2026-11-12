# Platform Office Control Plane

**Status: architecture proposal only. Not implemented, deployed, or connected to live participant data.**

## Purpose

Define a platform-wide office-management control plane shared by ZHAKIN TEAM, ЖАК, Wallet, USERDIE Digital, and future projects. It is not a Wallet-only role table and does not replace each project's domain authorization.

The office control plane manages staff and participant records, scoped appointments, approvals, and an immutable governance trail. Each project remains responsible for authorization of its own business objects and operations.

## Design principles

1. **Deny by default.** No role, assignment, or permission is inferred from a browser field, URL parameter, display name, or client-side state.
2. **Server-side identity.** Authenticate through a verified identity provider; load current role assignments and status from trusted persistence on every privileged request or through a revocable, short-lived authorization cache.
3. **Least privilege.** Separate global, organization, project, and resource scopes. A project appointment never implies access to another project.
4. **Explicit lifecycle.** Every appointment has an issuer, scope, effective time, optional expiry, status, reason, and revocation metadata.
5. **Separation of duties.** High-risk decisions require a second authorized person. A requester cannot approve their own privileged request.
6. **Auditable decisions.** Record who did what, to which object, under which authority, when, and with what outcome. Never store passwords, tokens, full payment credentials, or unnecessary sensitive data in audit events.
7. **No silent privilege escalation.** Role changes, scope changes, emergency access, and revocations are explicit, reviewed, and logged.
8. **Robots are assistants, not principals.** ЖАК Office may summarize, route, remind, and prepare drafts. It cannot grant itself authority, approve its own recommendations, or execute a privileged action without a human-authorized server-side command.

## Identity domains

Keep these domains distinct in storage and policy:

- **Staff:** employees, officers, administrators, coordinators, reviewers, auditors.
- **Participants:** beneficiaries, applicants, donors, platform users, and other registered participants.
- **Service identities:** narrowly scoped backend services and robots, each with a dedicated identity and non-human permission set.

A participant record does not become a staff identity by receiving a profile field or client-side role label. A service identity must not impersonate a human actor.

## Role and scope model

Represent permissions as server-owned grants, not a free-form array of role names.

Suggested grant fields:

| Field | Meaning |
| --- | --- |
| subject_id | Immutable identity identifier |
| role | Controlled role code |
| scope_type | global, organization, project, or resource |
| scope_id | Canonical ID from trusted persistence |
| permissions | Explicit allow-list or policy reference |
| valid_from / expires_at | Effective period |
| status | active, suspended, revoked, expired |
| issued_by / approved_by | Separate accountable identities where required |
| reason / ticket_id | Business justification and traceability |

Initial role families (to be refined before implementation):

- **Platform owner:** platform-wide governance and configuration; sensitive actions remain subject to approval policy.
- **Office administrator:** staff directory and routine office operations; no automatic financial or security authority.
- **Project coordinator:** assigned project records and queues only.
- **Reviewer:** assigned decisions only; cannot alter role assignments or audit history.
- **Auditor:** read-only access to permitted audit records.
- **Participant:** own profile and own authorized records only.
- **Service/robot:** explicitly enumerated machine permissions, no human privileges by default.

Do not create a generic superuser shortcut for convenience. Break permissions into capabilities and require explicit scope.

## Core modules

1. **Directory:** staff and participant records with separate lifecycle and visibility rules.
2. **Appointments:** create, approve, activate, suspend, expire, and revoke scoped role grants.
3. **Project registry:** canonical project identifiers and project membership.
4. **Approval inbox:** pending requests, evidence, decision, reviewer, timestamps, and reason.
5. **Governance trace:** append-only audit events with restricted read access and retention policy.
6. **Policy registry:** versioned permission rules and approval thresholds.
7. **Office dashboard:** operational status and queues; aggregate views must not expose records beyond the viewer's scope.

## Approval workflow

Use a server-enforced state machine:

`draft → submitted → under_review → approved | rejected → applied`

- Submission captures an immutable request snapshot and idempotency key.
- Review checks current authority, scope, conflicts of interest, and evidence.
- Approval is separate from application; the server revalidates permissions immediately before applying.
- Rejection and cancellation require a reason.
- Duplicate submissions and replayed approvals are idempotently rejected or return the original result.
- Revocation and expiry take effect on subsequent authorization checks.
- High-risk actions (global role grants, financial policy changes, security settings, bulk exports) require dual control and, where appropriate, an independent audit review.

## Audit event contract

Minimum event envelope:

- event_id, occurred_at, actor_type, actor_id
- action, target_type, target_id, scope_type, scope_id
- decision, result, reason_code, correlation_id, idempotency_key
- authorization_policy_version
- before/after references or redacted field-level change summary

Audit records must be append-only to application roles. Corrections are new events, not edits or deletions. Restrict audit access, define retention and export controls, and protect against tampering. Do not log secrets or unnecessary personal data.

## ЖАК Office robot

The office robot is a separate assistant capability within the platform:

- explain current queues and policy rules using authorized data only;
- prepare draft appointment and approval requests;
- route work to the correct human queue;
- identify missing evidence and policy conflicts;
- produce management summaries with source references;
- remind authorized owners about expiring assignments and overdue reviews.

It must not autonomously appoint or dismiss staff, change permissions, approve requests, transfer funds, alter balances, or erase audit events. Every proposed action must show the actor, target, scope, policy basis, and expected effect before human confirmation.

## Security and privacy requirements

Before any production integration:

- choose and configure the identity provider; validate issuer, audience, signature, expiry, revocation, and session lifecycle;
- enforce CSRF/CORS protections appropriate to the authentication model, rate limits, input schemas, and abuse controls;
- check object ownership and canonical scope on every read and write;
- prevent IDOR, cross-project and cross-participant access, privilege escalation, replay, and race conditions;
- use transactional persistence for state changes and corresponding audit events;
- use least-privilege database credentials and secret storage;
- define data minimization, retention, access, export, incident response, backup, and recovery policies;
- test with synthetic data in an isolated environment before any pilot.

## Delivery sequence

1. Review and approve this architecture and the role glossary.
2. Define the permission matrix and threat model; map every route to a capability and scope.
3. Design migrations and repository interfaces on a separate branch.
4. Implement directory and role-grant lifecycle with unit and integration tests.
5. Implement approval state machine, dual control, idempotency, and transactional audit.
6. Add office dashboard and ЖАК Office as read-only/draft-first consumers.
7. Run negative authorization tests, concurrency and rollback tests, privacy review, and independent security review.
8. Only after explicit authorization, connect a separate test identity provider and test database; production onboarding remains a later, separately approved milestone.

## Explicit non-goals of this proposal

- No production identity provider, D1 database, Worker, or mail provider is configured.
- No staff or participant records are imported or created.
- No live permissions are granted or changed.
- No Wallet balances, BFU/УСЕРДИЕ assets, payments, transfers, or exchange integrations are enabled.
- No deployment or change to the public website is performed.
