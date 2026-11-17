# Human Approval Gateway — implementation contract

Status: isolated prototype in draft PR #141. Not connected to a Worker route, identity provider, Cloudflare D1 binding, office UI, or production.

## What this stage adds

- Migration 0004 adds a dedicated, project/organization-scoped human approver grant registry. No approver grants are seeded or activated.
- Grant creation requires three distinct human identities: the subject, the grantor, and the separate approver. Revocation is represented by a timestamp; grants and review history cannot be deleted.
- A human reviewer is resolved only from a trusted verifier's verified issuer + subject pair. Browser-supplied user IDs, roles, and scopes are ignored.
- The gateway checks current user status and an unrevoked, time-valid approval scope for the proposal's organization and project.
- Acceptance performs a compare-and-set task update against the proposal's expected version, changing only title, description, and acceptance criteria, then records review, proposal transition, and audit event in one D1 batch.
- Rejection records the human decision and audit event without changing the task.
- If the task version has moved or the task is terminal, the proposal is marked stale and is not applied.
- Database triggers independently require a valid reviewer grant, a matching immutable review record, and a valid pending-to-final transition.
- Review history and reviewed proposal records are immutable. Audit persistence is part of the same batch as the decision.

## Security boundaries

- No approver is automatically assigned. A future grant-management workflow must enforce dual control and must not allow the grant subject or grantor to approve their own grant.
- The module requires a trusted human credential verifier that validates signature, issuer, audience, expiry/not-before, and revocation.
- The module does not create identity-provider credentials, accounts, grants, Worker routes, D1 bindings, secrets, or production records.
- No robot can invoke this human gateway or approve its own proposal.
- No task assignment, task closure, decision approval, Wallet, ZP/BFU, payment, or external communication capability is introduced.
- The caller must apply request-size limits, rate limits, origin/CSRF protections where applicable, and safe HTTP error mapping.

## Transaction contract

For acceptance, the D1 batch:
1. Updates the task only when its current version equals the proposal's expected version and the human's scoped approval grant is still current.
2. Inserts an immutable review row; the database trigger checks the post-update task version and current reviewer authorization.
3. Transitions the proposal from pending to accepted only when the matching review row exists.
4. Inserts the human audit event.

For rejection, the task update is omitted; review, proposal transition, and audit remain in one batch. Any statement failure must abort the batch. SQLite/mock tests are contract checks only and do not prove remote D1 concurrency behavior.

## Required gates before integration

- Run the migration and tests in a disposable Cloudflare D1-compatible environment.
- Implement and independently review the trusted human identity verifier and grant-management workflow.
- Add route-level authentication, authorization, request limits, rate limits, CSRF/origin controls, and safe error mapping.
- Complete concurrency/race, rollback, audit-failure, and negative authorization tests in the actual D1 runtime.
- Obtain explicit owner approval for the approver policy and named human authority.
- Keep this PR draft until independent security review. No merge or deployment is authorized.

## Trusted bearer verifier module (new, configurable; not yet wired to a route)

`src/oidc-bearer-verifier.mjs` now provides a strict RS256 verifier factory. It is provider-agnostic and requires deployment-owned configuration for exact issuer, audience, HTTPS JWKS URL, and an authoritative `isRevoked` lookup. It does not select an identity provider or create credentials.

Implemented checks:
- strict three-part JWT parsing and RS256-only algorithm allowlist; rejects `none`, alternate algorithms, token-controlled key URLs, critical extensions, malformed claims, and oversized tokens;
- exact issuer and audience matching; requires subject, expiration, issued-at, and token ID (`jti`); enforces a 15-minute maximum token age, a one-hour maximum lifetime, strict expiration, bounded future clock skew, and `azp` for multi-audience tokens;
- HTTPS-only configured JWKS endpoint, bounded response/key counts, RSA signing keys only, minimum 2048-bit modulus, key-ID selection, short in-isolate cache, and one forced refresh for an unknown key ID;
- mandatory revocation lookup; only an explicit `false` result is accepted. Lookup errors and revoked/unknown states fail closed;
- JWKS responses are read with a 128 KiB streaming cap and a five-second fetch/body deadline; RSA moduli are checked for an actual minimum 2048-bit length (not merely a 256-byte encoding).
- returns only verified `issuer + subject`, not arbitrary claims.

Important limits:
- This is a verification primitive, not a complete OIDC relying-party integration. Provider-specific token profile, access-token versus ID-token semantics, nonce/authentication-context requirements, key-rotation operations, and revocation-store design still require independent review.
- The module is not connected to a Worker route and has no production issuer, audience, JWKS endpoint, or revocation store configured.
- JWKS cache lifetime is five minutes by default; immediate key-compromise response requires an operational cache invalidation/redeployment strategy.
- Never accept decoded JWT claims from another component as a substitute for this verifier.


## Human Approval HTTP boundary (isolated; not deployed)

`src/human-approval-http-boundary.mjs` adds a browser-facing handler factory without binding it to a Worker route. It requires an injected Human Approval Gateway, an explicit HTTPS origin allowlist, and an injected distributed rate limiter; no in-memory limiter or default origin is provided.

Controls implemented:
- exact Origin allowlist; rejects missing, opaque, malformed, and foreign origins;
- constrained CORS preflight (POST only; Authorization and Content-Type only), POST-only route, cross-site Fetch Metadata rejection, and no cookie-based authentication;
- bearer Authorization required; content type restricted to JSON; request body streamed with a 4 KiB maximum; proposal ID and body fields allowlisted;
- rate limiter is mandatory and fails closed with 503 when unavailable; denial returns 429. The host must implement it with a shared edge/DO-backed store and trustworthy client bucketing before deployment;
- generic error mapping, no-store responses, and security response headers. No internal exception details or token claims are returned.

This module is not connected to an existing Worker, D1 binding, identity provider, rate-limit store, or production route. Its tests use injected fakes and establish handler contract behavior only; they do not prove deployed edge configuration, distributed rate-limit correctness, or production security.


## Distributed rate limiting with Durable Objects (isolated; not deployed)

`src/durable-object-rate-limiter.mjs` provides a Cloudflare Durable Object counter and an adapter compatible with the HTTP boundary's injected `rateLimit` function.

- Fixed-window counters are updated inside a Durable Object storage transaction, so concurrent checks for the same derived key cannot exceed the configured limit.
- The adapter accepts only the named Human Approval route and a bounded, syntactically constrained Cloudflare client address; missing identity and binding/storage errors fail closed.
- The client address is SHA-256 hashed before `idFromName`; raw addresses are not written to Durable Object storage. The Durable Object stores only one counter record per derived object.
- Limit and window settings are bounded (maximum 1,000 requests / 3,600 seconds). The current policy is configurable by the Worker host; production thresholds and trusted proxy assumptions require owner/security review.
- A local Wrangler smoke Worker tests actual Durable Object SQLite storage behavior and concurrent admission. Contract tests use an in-memory transactional fake and are not a substitute for the local runtime smoke.

The adapter is not yet injected into a production Worker, and no Durable Object binding, namespace, remote deployment, route, or production configuration has been created. Before deployment, verify Cloudflare's trusted `cf-connecting-ip` provenance, select an abuse-resistant policy (including account/principal limits where appropriate), configure binding/migrations in the real Worker, and conduct load and security testing. This implementation is a first distributed edge control, not a complete DDoS or abuse-prevention system.
