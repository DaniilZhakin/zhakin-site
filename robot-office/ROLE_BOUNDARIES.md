# Robot Office role boundaries and human-control matrix

Status: implementation contract for the isolated prototype. This document does not authorize production activation or autonomous actions.

## Design principles

1. **Least privilege:** each identity receives only the permissions required for its bounded task.
2. **Workspace isolation:** Treasury and Legal are separate workspaces; a grant in one does not confer access to the other.
3. **Human accountability:** robots may prepare work and request a human decision. They cannot approve their own work, move money, sign legal instruments, or exercise public/legal representation.
4. **No implied authority:** a role name, job title, task assignment, or successful login does not create permissions. Only an active server-side grant does.
5. **Default deny:** any action not explicitly present in the policy allowlist is denied.
6. **Independent audit:** elevated actions must have an immutable, transactionally consistent audit record.

## Role matrix

| Role | Permitted scope | Allowed responsibilities | Explicitly prohibited |
|---|---|---|---|
| `treasury_agent` | Treasury workspace | Prepare task records, update assigned task metadata, create handoff summaries, prepare document metadata, request human review | Initiate/execute transfers, withdraw funds, authorize banking operations, post ledger entries, approve requests, grant/revoke roles |
| `human_treasury` | Treasury workspace | Review Treasury materials within granted classification, decide another person's pending approval request, return/hand off work | Self-approval, execute payments, withdraw funds, post ledger entries, grant/revoke roles |
| `legal_agent` | Legal workspace | Prepare legal task records, organize document metadata, create handoff summaries, request human review | Sign contracts, submit filings, represent an individual or organization, provide binding legal approval, approve own work, manage access |
| `human_legal` | Legal workspace | Review Legal materials within granted classification, decide another person's pending approval request, record review outcome | Self-approval, sign contracts, submit filings, act as legal representative, grant/revoke roles |
| `access_admin` | Organization access registry | Request bounded role grants, revoke eligible operational grants, administer role lifecycle subject to independent human approval | Read Treasury/Legal business content, approve own role request, mint elevated admin/auditor roles through ordinary grant flow |
| `auditor` | Organization audit ledger | Read immutable audit events and inspect recorded control outcomes | Modify/delete audit events, read business documents, create tasks, move funds, sign/submit legal instruments, manage roles |
| `command_agent` (ЖАК coordinator) | Explicitly minimized handoff summaries | Read approved, minimized handoff summaries across workspaces for coordination | Read source tasks or original documents, alter source records, approve decisions, move funds, sign/submit legal instruments, manage roles |

## Separation of duties

- A robot identity cannot be used as a human reviewer.
- The requester and reviewer must be different principals.
- Treasury reviewers cannot decide Legal requests, and Legal reviewers cannot decide Treasury requests.
- Access administration is separate from business-content access.
- Auditor is read-only and must not be combined with an operational write role by default.
- ЖАК coordinates through minimized handoff summaries; it is not a superuser and does not inherit the underlying robot's permissions.
- Financial execution, legal signature, external submission, and irreversible actions remain outside this prototype. If introduced later, each requires a separate narrowly scoped permission, an explicit human confirmation step, and independent audit controls.

## Technical enforcement

- The server derives principal identity and organization from a verified session, never from browser input.
- Grants and canonical resource metadata are loaded server-side for each request.
- The policy allowlist is the sole source of action authorization; unknown action strings are denied.
- Scope checks are performed against the canonical resource loaded from storage.
- Tests must assert both positive permitted actions and negative prohibited actions for every role.

## Not yet production-ready

The current policy and service tests do not establish production authentication. The Worker adapter still requires a real server-side session provider, CSRF protection compatible with that session model, and distributed rate limiting. Role-approval routes remain unwired. No real funds, banking systems, legal filing services, production D1, or user accounts are connected.
