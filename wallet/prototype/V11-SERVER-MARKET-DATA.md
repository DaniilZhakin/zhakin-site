# V11 — server-side market-data route

**Decision:** build an isolated server-side read-only route, but keep it disabled by default.

## Controls implemented
- Fixed route: `GET /api/v1/market/quotes`.
- Two independent server-side flags must be explicitly set to `true`: `MARKET_DATA_ENABLED` and `MARKET_DATA_LICENSE_APPROVED`.
- Fixed provider adapter and fixed three-pair allowlist; no user-supplied URL/symbol routing.
- Shared cache adapter contract with a 15-second TTL; cache hits are revalidated for freshness.
- Global rate-limiter adapter must approve every cache miss before upstream access.
- Missing/failing cache or limiter, provider errors, invalid quotes and cache-write failures all fail closed.
- Only normalized quote fields leave the handler; raw provider payloads and internal error details do not.
- No browser-to-provider calls, no database, no participant identity, no balances, no ledger mutation, no trading or transfers.

## Production gates still open
1. Confirm CoinGecko plan/licence for the exact public/commercial display and reuse model; the approval flag must remain OFF until confirmed.
2. Implement and test durable/shared Cloudflare cache and global rate limiting. Do not use per-isolate in-memory substitutes.
3. Wire a Worker route only after Cloudflare account/runtime ownership and deployment approvals are confirmed.
4. Run security review, CORS/origin policy, abuse testing, monitoring and operational rollback tests.
5. Keep live quotes hidden until every gate is signed off.

## Test boundary
All V11 tests use mocks. No live provider call, Cloudflare deployment, secret, public endpoint or financial operation is enabled.
