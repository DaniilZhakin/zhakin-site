# Robot Office server-side authorization reference

This package is a **pure authorization policy module**, not an HTTP server, identity provider, D1 repository, or deployed Worker.

## Contract

- The caller must obtain the principal from a trusted server-side authentication/session adapter.
- The caller must load grants from the server-side role registry. Never construct either object from browser-supplied IDs, roles, organization IDs, or claims.
- Call `authorizeOfficeAccess` before every list, read, create, update, document, approval, audit, and access-management operation.
- A deny result must stop the request. Missing/invalid context fails closed.
- Always perform object-level checks against the canonical resource loaded from storage; do not authorize based only on request-body metadata.
- Do not treat a successful policy decision as proof that authentication, CSRF/Origin, rate limiting, audit persistence, transaction atomicity, or storage authorization has been implemented.

## Current policy boundaries

- Treasury and Legal roles are workspace-separated.
- Robot roles cannot decide approvals.
- Human reviewers cannot decide their own pending requests.
- Restricted documents require an explicit restricted workspace scope.
- ZHAKIN COMMAND AI can read only explicitly marked handoff summaries, not original documents.
- Access administrators manage grants but cannot read business content.
- Auditors can read audit records only.
- Grants must be active, unexpired, not revoked, and match both subject and organization.

## Test

Run with Node.js 20 or newer:

```sh
node --test robot-office/tests/access-policy.test.mjs
```

Tests use synthetic objects only. This module has no network, filesystem, Cloudflare, or production dependencies.

## Not implemented

Authentication/session verification, D1 grant loading, HTTP routes, CSRF/Origin enforcement, request throttling, transactional audit writes, document upload/download, malware scanning, MFA, deployment and production integration remain out of scope. Do not enable real users or documents on the strength of these unit tests alone.
