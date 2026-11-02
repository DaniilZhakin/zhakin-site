# ZHAKIN Wallet server market-data route (V11)

**Status: isolated server-side handler only. Not deployed, not connected to the public site, and live access is disabled by default.**

## Route

- `GET /api/v1/market/quotes`
- Returns only the three approved reference pairs: BTC/USDT, TON/USDT and USDT/USD.
- No query parameter, request header, browser identity, caller-provided URL or symbol is used to select upstream resources.
- Non-GET methods and unknown paths are rejected.

## Two-key activation gate

The handler returns `503 market_data_disabled` unless both server-side environment values are exactly the string `"true"`:

- `MARKET_DATA_ENABLED`
- `MARKET_DATA_LICENSE_APPROVED`

Both default to OFF. The licence flag is an explicit operational attestation, not a substitute for reviewing the applicable provider terms or obtaining required written permissions. Do not set either flag in production until the intended public/commercial use is approved.

## Required server adapters

- `cache.get(key)` / `cache.put(key, value, ttlSeconds)`: shared server-side cache, fixed key, 15-second TTL.
- `rateLimiter.consume()`: global server-side limiter; must return `true` or `{ allowed: true }` to permit a provider refresh.
- Provider adapter: existing fixed-host CoinGecko adapter; no user-controlled URL or symbols.

Missing or failing cache/limiter adapters fail closed. A cache hit is revalidated against the 120-second freshness boundary. On cache miss, the rate limiter is consumed before the provider is called. No quote is returned unless all three are valid and fresh. Cache write failure suppresses the response rather than creating an unbounded uncached provider path.

The module intentionally does not prescribe an in-memory Worker cache or a non-durable per-isolate limiter as production infrastructure. Before deployment, bind a shared cache and a durable/global limiter appropriate to the Cloudflare account, test their failure modes and confirm quotas.

## Response and security

- Browser response uses `Cache-Control: no-store`; server cache is internal.
- Only normalized symbol, numeric reference price, source and observation time are exposed.
- No raw upstream payload, provider error details, credentials, participant IDs or IP addresses are returned or logged.
- No database, authentication, wallet balances, ZP/BFU ledger, signing, orders, transfers, conversion or settlement is involved.
- This endpoint returns reference data only, not executable exchange prices or guaranteed fills.

## Tests

Run `npm test` from this directory. Tests use mocked provider/cache/limiter adapters; they do not make network calls. This scaffold is not a Cloudflare Worker deployment and must not be represented as a live market feed.
