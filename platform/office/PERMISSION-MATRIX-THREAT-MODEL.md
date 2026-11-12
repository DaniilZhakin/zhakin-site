# Office Permission Matrix and Threat Model

**Status: design baseline for review. Not implemented, not an authorization policy, and not approved for production use.**  
**Parent architecture:** `platform/office/CONTROL-PLANE.md`

This document translates the proposed office control plane into a reviewable capability model and a security test plan. It deliberately does not define database migrations, production routes, identity-provider configuration, or live grants.

## 1. Security invariants

1. Deny by default: an unlisted action is denied.
2. Authenticate first; authorization uses a server-verified subject and current server-owned grants.
3. Every allow decision is bounded by tenant/organization, project, resource ownership, and time where applicable.
4. A role name alone is never sufficient: capability + scope + active grant + policy conditions must all match.
5. Staff, participants, and service identities are distinct identity classes. No implicit conversion or impersonation.
6. Read and write access are evaluated independently. List, search, export, and aggregate endpoints require explicit policy too.
7. High-risk changes require separation of duties and fresh authorization at apply time.
8. Persist a state change and its audit event atomically. If either fails, neither is committed.
9. Revocation, suspension, expiry, and policy changes must invalidate or bound cached authorization.
10. ЖАК Office is a constrained service identity and cannot approve or apply its own privileged proposals.

## 2. Capability vocabulary

| Capability | Meaning |
| --- | --- |
| `directory.read_scoped` | Read staff/participant directory fields permitted by scope and purpose |
| `directory.read_self` | Read the authenticated participant's own permitted profile |
| `directory.create_draft` | Prepare a new directory record without activating it |
| `directory.update_scoped` | Update explicitly permitted non-sensitive fields |
| `directory.lifecycle.manage` | Suspend/deactivate/reactivate a record under policy |
| `grant.request` | Submit a role/scope grant request |
| `grant.review` | Review a grant request assigned to the reviewer |
| `grant.approve` | Approve a grant request, excluding self-approval and conflicts |
| `grant.apply` | Apply an approved grant after fresh server-side validation |
| `grant.revoke` | Revoke a grant within permitted scope |
| `project.read_scoped` | Read project metadata and records allowed by project policy |
| `project.membership.manage` | Request or manage project membership within assigned scope |
| `case.read_assigned` | Read cases explicitly assigned to the actor |
| `case.update_assigned` | Update permitted fields on assigned cases |
| `decision.record` | Record a decision for an assigned workflow item |
| `audit.read_scoped` | Read authorized audit events; never mutate or delete them |
| `policy.propose` | Submit a policy change for review |
| `policy.approve` | Approve policy changes subject to dual control |
| `policy.apply` | Apply an approved, versioned policy change |
| `report.read_aggregate` | Read privacy-safe aggregate metrics within scope |
| `report.export_scoped` | Export explicitly authorized, minimized data |
| `service.execute_named` | Execute one explicitly named machine operation |
| `office.assist.read` | Read only data already authorized for the requesting human/task |
| `office.assist.draft` | Prepare a non-binding draft for human review |

Capability names are proposed identifiers, not implemented API contracts. Sensitive fields and operations require separate capabilities rather than broad CRUD permissions.

## 3. Role × capability baseline

Legend: **A** = allowed only within the stated scope and policy conditions; **R** = request/draft only; **—** = denied by default. No cell grants access outside its scope.

| Role | Directory | Grants / appointments | Project & case data | Decisions | Audit | Policy | Reports / export | Robot operations |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Platform owner | A: platform governance; sensitive personal data still restricted | R/A: request; approve only if independent reviewer and dual-control rules pass | A: platform scope, subject to project policy | — unless separately assigned | A: scoped oversight, read-only | R/A: propose; approve/apply only with independent control | A: minimized aggregate; export separately approved | A: manage service registration, never impersonate |
| Office administrator | A: routine staff directory; no unrestricted beneficiary data | R: submit requests; no self-approval | A: office metadata only; no case contents by default | — | — or explicitly assigned read-only audit scope | R: propose | A: operational aggregate; export requires separate grant | — |
| Project coordinator | A: assigned project directory fields only | R: request project-scoped grants; cannot approve own request | A: assigned project and authorized cases only | R: prepare recommendation; decision only if separately assigned | — | — | A: project aggregate; scoped export only if explicitly granted | — |
| Reviewer | — except minimum request context | A: review/approve assigned requests; cannot approve own or conflicting request | A: minimum evidence for assigned review only | A: assigned workflow item only | — | — | — | — |
| Auditor | — | — | — | — | A: read-only assigned audit scope | — | A: audit reports; exports controlled | — |
| Participant | A: own permitted profile only | R: request own access correction; no grant administration | A: own records only, subject to service/legal policy | — | — | — | A: own permitted statements; no bulk export | — |
| Service / robot identity | — unless explicit named machine capability | — | — unless explicit service capability and object scope | — by default | — | — | — | A: named, narrow, non-human operations only |
| ЖАК Office | A: only through `office.assist.read`, bounded by delegated task context | R: draft request only; cannot review, approve, or apply | A: read-only task context; no independent discovery across scopes | R: prepare draft, never decide | — unless a separate read-only audit capability is granted | R: draft proposal only | A: approved aggregate only; no export by default | A: reminders, summaries, routing, draft creation only |

**Interpretation rules**
- Platform owner is not a blanket bypass. Emergency access must be time-limited, justified, separately logged, and reviewed after use.
- Office administrator does not receive financial, Wallet, payment, identity-provider, or security-settings authority by virtue of title.
- Project coordinator is constrained to canonical project IDs resolved by trusted server-side data and to explicitly assigned resources.
- Reviewer authority is per request/work item, not a general ability to approve all requests.
- Auditor access is read-only; audit integrity administration is a separate infrastructure control, not an application role.
- Participant access is object-owner constrained. Knowing or guessing another participant ID never grants access.
- Service identities receive explicit machine capabilities only. A service cannot inherit human role grants.
- ЖАК Office is not a synonym for Platform owner or Office administrator.

## 4. Scope and approval conditions

| Scope | Grant issuer / requester | Approval condition | Enforcement |
| --- | --- | --- | --- |
| Global | Authorized governance actor may request | Independent second authorized approver; requester excluded | Server re-checks current global authority immediately before apply |
| Organization | Authorized organization administrator may request | Independent approver where access is sensitive or broad | Organization ID from trusted registry; no client-selected tenant override |
| Project | Project authority may request | Project owner/reviewer per policy; requester excluded | Canonical project ID resolved server-side; exact scope match |
| Resource | Assigned owner/authorized manager may request | Explicit resource owner or independent reviewer | Object ownership and resource relationship checked on every operation |
| Emergency | Designated break-glass process only | Justification, short TTL, alert, retrospective independent review | Narrow allow-list, no silent elevation, automatic expiry |

Every grant must have: immutable subject ID, identity class, role/capability set, scope type and canonical scope ID, issuer, approver where required, reason/ticket, effective time, expiry or review date, status, policy version, and revocation metadata.

## 5. Route and action authorization inventory

This is a policy mapping checklist, not a claim that all endpoints exist. The currently inspected Wallet prototype exposes the following namespaces; all other routes must be inventoried from source before implementation.

| Route / action family | Required policy | Default result until implemented |
| --- | --- | --- |
| `/health` | Public operational status only; no secrets or environment details | Public, minimal response |
| Participant balance / ledger reads | Authenticated participant + self ownership; separate staff support capability if ever required | Deny / unavailable |
| `/api/v1/admin` and `/api/v1/admin/**` | Global Wallet admin capability with active global grant; coordinators are not admins | Deny unless verified; unimplemented operations remain unavailable |
| `/api/v1/projects/{lookupId}/**` | Resolve lookup key to canonical project; then exact project grant + resource policy | Fail closed if resolver unavailable; conceal unauthorized resource existence |
| Directory list/search | Scoped directory capability + field-level filtering + purpose limits | Deny |
| Staff/participant detail | Scope + field-level authorization; participant self-only where applicable | Deny |
| Grant request / approval / apply / revoke | Separate capabilities, state machine, conflict check, dual control, idempotency | Deny |
| Audit search/export | Read-only audit capability, scope, retention and export policy | Deny |
| Reports / bulk export | Explicit report/export capability, minimization, row/field filtering, approval where high risk | Deny |
| Robot/task endpoints | Service identity + named operation + delegated task scope; no human impersonation | Deny |

Before coding, generate a complete route inventory from the repository and attach each concrete method + path to a capability, scope resolver, ownership predicate, and expected denial response. Wildcard route rules must not substitute for object-level checks.

## 6. Threat model

### Assets
- Identity credentials, sessions, staff and participant records.
- Role grants, project membership, approval decisions, and policy versions.
- Case files, beneficiary information, Wallet records, audit events, and exports.
- Service credentials, signing secrets, database access, and robot task context.

### Trust boundaries
1. Browser/mobile client → public Worker/API.
2. API → identity provider and session/token validation.
3. API → office repository / D1 database.
4. Office control plane → individual project services and their resource stores.
5. Human operator → approval inbox and privileged actions.
6. ЖАК Office/service identity → tools, task context, and human confirmation.
7. Audit store → auditors, exports, backups, and incident responders.

### Threats and mandatory controls

| Threat | Example / failure mode | Required control | Minimum negative test |
| --- | --- | --- | --- |
| Spoofing | Forged role, subject, or service identity in request headers/body | Verified issuer/audience/signature; server-derived subject; no client roles | Inject `admin` role and forged subject; request remains denied |
| Broken object-level authorization (IDOR) | Participant changes record ID; coordinator changes project ID | Canonical server-side scope + ownership check on every object read/write | User A requests User B object; deny without data leakage |
| Cross-project escalation | Coordinator for Project A accesses Project B via alias or encoded ID | Trusted resolver; canonical IDs; exact grant scope | Alias resolves to B; A coordinator is denied |
| Privilege escalation | Coordinator or participant reaches admin namespace | Capability-based server policy; no role-string fallback | Coordinator with browser `admin` claim is denied admin route |
| Self-approval / collusion | Requester approves own global grant | Independent approver, conflict-of-interest checks, dual control | Same immutable subject cannot submit and approve privileged request |
| Replay | Repeated approval or mutation reuses captured request | Idempotency key, nonce/version, one-time transition, expiry | Replay identical approval; no duplicate grant or audit mutation |
| Race / TOCTOU | Grant revoked after check but before apply | Transactional apply; revalidate policy/grant in same transaction or equivalent lock/version check | Revoke races with apply; stale authority cannot commit |
| Session/token abuse | Expired, revoked, wrong-audience, or wrong-issuer token accepted | Full token/session validation; bounded session lifetime; revocation strategy | Expired/revoked/wrong-audience token denied |
| CSRF / CORS abuse | Cross-origin state-changing request | Auth-model-specific CSRF protection; strict origin allow-list; no wildcard credentialed CORS | Untrusted origin cannot mutate |
| Injection / mass assignment | User writes `role`, `scope_id`, `approved_by` fields | Strict schemas, server-owned fields, allow-listed updates | Extra privileged fields are rejected/ignored and cannot change grant |
| Enumeration | Guessing participant/project IDs reveals existence | Consistent concealment response and rate limits | Unauthorized existing and nonexistent IDs are indistinguishable where required |
| Data exfiltration | Search/export returns fields beyond role scope | Field-level filtering, row-level scope, export capability, limits and audit | Coordinator export cannot include another project's records |
| Audit tampering | Application role edits/deletes audit events | Append-only permissions, integrity protection, separate retention/backup controls | Application identity cannot update/delete prior audit event |
| Secret leakage | Error response/log includes DB credentials or tokens | Generic external errors; redacted structured logs; secret scanning | Inject DB exception containing secret; response/log redacts it |
| Robot prompt/tool injection | Untrusted case text persuades ЖАК to grant access or run tools | Treat retrieved content as data; tool allow-list; delegated scope; human confirmation | Malicious prompt in record cannot trigger privilege/action outside task |
| Service-account compromise | One robot credential accesses all projects | Dedicated identity per service, narrow scopes, rotation, rate limits, revocation | Service A token cannot invoke Service B operation |
| Availability abuse | Login, search, or export floods service | Rate limits, pagination caps, timeouts, quotas, monitoring | Burst traffic is throttled without bypassing auth |
| Backup/restore weakness | Restored DB resurrects revoked grants or loses audit events | Consistent backups, recovery runbooks, revocation reconciliation, restore tests | Restore test preserves audit chain and current revocation state |

## 7. Required test suites before any production use

### Authorization matrix tests
- Every role × capability × scope combination has an explicit allow or deny expectation.
- Unknown role, unknown capability, missing scope, malformed scope, and missing resolver all deny.
- Expired, suspended, revoked, not-yet-effective, and superseded grants deny.
- Global grants cannot be synthesized from project grants; project grants cannot cross projects.
- Participant self-access cannot be widened by changing identifiers, query parameters, cursors, or nested object references.
- List, count, search, aggregate, download, and export endpoints enforce the same row/field boundaries as detail endpoints.

### Workflow and integrity tests
- Requester cannot approve own request; reviewer cannot change the request snapshot under review.
- Approval cannot be applied after grant revocation, reviewer revocation, policy-version change, or expiry.
- Duplicate submit/approve/apply/revoke requests are idempotent.
- State transition is atomic with audit event; forced audit failure rolls back the business mutation.
- Concurrent approvals produce one valid state transition.
- Rejected/cancelled requests cannot be replayed into an applied state.

### Privacy and operations tests
- Sensitive fields are absent from unauthorized responses, logs, analytics, and audit payloads.
- Retention, correction, access, and export workflows are documented and tested.
- Rate limits, pagination caps, alerting, backup restoration, and incident revocation are tested.
- Synthetic test fixtures only; no real participant or beneficiary data in development/test.

## 8. Open decisions before schema or runtime implementation

1. Confirm the accountable platform governance owner and independent approver model.
2. Define organization/tenant boundaries and whether a person may hold multiple staff assignments.
3. Approve the controlled role glossary and field-level sensitivity classification.
4. Select identity provider and determine session, MFA, recovery, and revocation requirements.
5. Define legal basis, data controller/processor roles, retention periods, and data-subject workflows for each project.
6. Confirm whether audit storage needs tamper-evident external retention and who can administer it.
7. Inventory every actual API route and resource type in the repository.
8. Define emergency access, incident response, and break-glass review ownership.
9. Decide which project-specific capabilities may be delegated to ЖАК Office, if any, and require human confirmation per operation.

**Exit gate:** no migrations, production endpoints, real identities, staff imports, participant onboarding, or live permissions until the role matrix, route inventory, threat model, data/privacy review, and test plan are reviewed and explicitly approved.

## 9. Explicit non-goals

- No production authorization policy is activated by this document.
- No database schema, migration, Worker, identity provider, or mail integration is changed.
- No live participant/staff data is read, imported, or modified.
- No Wallet balance, BFU/УСЕРДИЕ asset, payment, transfer, or exchange operation is enabled.
- No deployment or public website change is made.
