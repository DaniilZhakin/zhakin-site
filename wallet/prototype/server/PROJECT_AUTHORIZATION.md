# Wallet project authorization contract

The authentication principal carries server-loaded `roleAssignments`. Use
`hasWalletProjectAccess(principal, canonicalProjectId)` for project-scoped
operations and `hasWalletGlobalAdminAccess(principal)` for administrative
operations.

Rules enforced by the helper:

- A global `admin` grant is the only grant that satisfies global admin access.
- A global `coordinator` grant can access project workflows, but is not an
  admin grant.
- A project-scoped `coordinator` grant can access only the exact matching
  project ID.
- A project-scoped `admin` grant, malformed scope, expired grant, missing
  roleAssignments array, or browser-only `roles` value grants no access.
- Grant expiry is checked again at authorization time, in addition to the
  repository's expiry filter.

Route integration requirements (not implemented by this helper):

1. Authenticate the session and obtain the principal exclusively from the
   server-side repository.
2. Resolve the target project or resource on the server. Derive the canonical
   project ID from that trusted record, not from a request-body role or
   unverified browser claim.
3. Call the appropriate helper before reading or mutating project data.
4. Administrative routes must call `hasWalletGlobalAdminAccess`; project
   coordinator grants must never be accepted as admin privileges.
5. Keep participant ownership checks and resource-level authorization in
   place; project access alone is not permission to act on every participant's
   private data.

This file is an isolated authorization primitive and regression suite. It does
not wire any live route, enable authentication, apply a D1 migration, or
activate participant operations.
