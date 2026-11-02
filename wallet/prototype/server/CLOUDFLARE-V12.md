# V12 — Cloudflare market state adapter

**Implementation scaffold only. Not deployed. Both live-data flags are false.**

## Architecture
- Worker entrypoint: `cloudflare-worker.js`.
- One globally named Durable Object instance provides shared cache storage and global provider-refresh throttling.
- Cache key is fixed to `zhakin-wallet-market-v1`; cache TTL is bounded to 1–30 seconds (handler currently requests 15).
- Durable Object global provider limiter: 8 refreshes per 60-second window.
- Worker only accepts the fixed GET route and the two official site origins when an Origin header is present.
- Worker calls the V11 handler; it does not expose the Durable Object or upstream provider payload to the browser.

## Activation
`MARKET_DATA_ENABLED=false` and `MARKET_DATA_LICENSE_APPROVED=false` are explicit defaults in the Wrangler template. Do not change them until licensing for the intended display is confirmed and security review is complete.

## Operational gates
- This is a template, not a production Cloudflare account binding or deployment.
- Confirm the target Cloudflare account, Worker ownership, Durable Object migration and routing.
- Review CORS/origin policy, abuse controls, observability and rollback.
- Confirm provider commercial rights before changing either flag.
- Run Cloudflare staging smoke tests before any public integration.
- No user balances, authentication, D1 ledger, ZP/BFU movement, signing, exchange orders or transfers.
