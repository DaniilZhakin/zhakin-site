# ZHAKIN Wallet — market data integration contract (V09)

**Status:** design and validation boundary only. No provider is connected and no market quote is currently published by this prototype.

## 1. Scope and trust boundary

Market data is public reference information. It is not a wallet balance, ZP/BFU ledger entry, exchange order, settlement instruction or proof of asset ownership.

The browser must never call an exchange/provider with a secret key. A future server-side adapter will:
1. Fetch public market data from a configured provider using server-side configuration.
2. Map provider-specific payloads into the normalized quote shape below.
3. Validate symbol, source allowlist, price, timestamp and optional spread.
4. Publish only accepted, fresh quotes to the read-only UI.
5. Record provider health and validation outcomes without exposing credentials or internal error details.

No authenticated trading endpoint is part of this contract.

## 2. Supported instrument allowlist

Initial UI instruments only:
- BTC/USDT
- TON/USDT
- USDT/USD

Any other symbol is rejected until explicitly reviewed and added to the allowlist. Provider symbol aliases must be mapped server-side; browser-supplied symbols are not trusted as routing instructions.

## 3. Normalized quote contract

A provider adapter may emit this internal shape:

```json
{
  "symbol": "BTC/USDT",
  "price": "68000.25",
  "bid": "67999.90",
  "ask": "68000.60",
  "source": "approved-feed",
  "timestamp": "2026-11-02T19:00:00.000Z"
}
```

The values above are schema examples only, not live prices.

Required:
- `symbol`: exact allowlisted pair.
- `price`: finite positive decimal number or non-empty decimal string.
- `source`: configured provider identifier from a server-side allowlist.
- `timestamp`: parseable ISO-8601 observation time with timezone.

Optional bid/ask:
- Both must be present together.
- Both must be finite and positive.
- `bid <= ask`.
- Mid/reference `price` must be within the supplied spread.

Provider response fields must not be forwarded wholesale to the browser.

## 4. Freshness and clock policy

Initial conservative defaults in the pure validation module:
- Maximum quote age: **120 seconds**.
- Maximum future timestamp skew: **30 seconds**.
- A quote older than the maximum age is marked `stale` and is not displayable.
- A timestamp too far in the future is rejected.
- Invalid or missing timestamps are rejected; receipt time must not silently replace observation time.

These are initial engineering thresholds, not a promise of provider latency or exchange availability. They must be reviewed against the selected provider's documented update cadence before production.

## 5. Fail-closed states

| Condition | UI/API treatment |
| --- | --- |
| Provider not configured | No quote; show “Источник не подключён” |
| Provider timeout / HTTP error | No new quote; show unavailable state |
| Invalid payload / price / symbol | Reject; never render |
| Untrusted provider identifier | Reject |
| Old quote | Mark stale; do not draw as current |
| Future timestamp | Reject |
| Inconsistent bid/ask | Reject |
| No verified observation | Show “Нет данных”; never synthesize a series |

Do not silently fall back to an unverified provider or reuse stale data as if current. If a future product decision permits showing a previous observation, it must be visibly labeled with its observation time and stale status; it must not be presented as the current quote.

## 6. Availability, retries and abuse controls

Future server adapter requirements:
- Explicit connect/read timeouts and bounded response size.
- Provider-specific rate limits and a server-side request cache with a short, documented TTL.
- Bounded retries with exponential backoff and jitter; no retry storm.
- Circuit breaker after repeated provider failures.
- Strict HTTPS and fixed configured hostnames; no user-supplied URL fetching (SSRF prevention).
- Parse JSON only; reject unexpected content types and malformed payloads.
- Do not log authorization headers, API keys, cookies or raw secrets.
- Never put provider credentials in HTML, JavaScript bundles, query strings or browser storage.
- No user-specific balances or wallet information in market-data cache keys or logs.

## 7. Audit and observability

Record only operational metadata:
- provider identifier;
- normalized symbol;
- observation timestamp and server receipt timestamp;
- validation outcome/reason;
- request correlation ID;
- latency and provider HTTP status class.

Do not store secrets or unnecessary personal data. Logs must distinguish provider failure, validation rejection and stale data. Monitoring should alert on prolonged no-data periods and elevated rejection/error rates.

## 8. Separation from financial operations

The market-data service is read-only. It must not:
- create or sign orders;
- transfer funds or tokens;
- mutate ZP or BFU ledgers;
- infer a personal balance;
- initiate wallet connection;
- perform conversion or settlement.

Any later exchange/trading integration requires a separate security review, explicit user confirmation flows, server-side authorization, idempotency, ledger controls and independent testing.

## 9. Current implementation

`wallet/prototype/market-data.js` provides pure validation helpers only. It performs no network calls, persistence, credential handling or trading. Tests cover allowlisting, source trust, positive finite prices, timestamps, stale quotes, spread consistency, payload immutability and fail-closed collection handling.

The V08 chart remains intentionally empty and disabled until a provider is selected, configured, tested and approved.

## 10. V10 provider selection and adapter

**Selected prototype provider: CoinGecko Public API (keyless endpoint).**

Rationale:
- One request returns USD reference prices for Bitcoin, Toncoin and Tether, allowing the prototype to populate all three approved display pairs consistently.
- BTC/USDT and TON/USDT are derived as the corresponding USD reference price divided by the Tether/USD reference price. The timestamp for each derived pair is the oldest timestamp of its two inputs.
- USDT/USD uses Tether's USD reference price directly.
- The keyless Public API requires no API key and currently has a variable rate limit of 5–15 calls/minute. The adapter therefore makes one bounded request for all three assets and does not retry automatically.
- CoinGecko's free Demo plan is a separate access mode: the pricing page currently lists 10,000 call credits/month and 100 calls/minute, but the support licensing guidance explicitly says Demo and free keyless API access do not grant commercial-use rights. Attribution alone does not convert free access into a commercial licence.
- Paid self-serve plans include standard commercial rights for public display with prominent CoinGecko attribution, but do not include data redistribution, resale, API sublicensing or white-label rights. If Wallet lets users retrieve/reuse a reusable feed or republishes the data beyond ordinary display, obtain written confirmation or a custom licence before enabling that functionality.
- Production gate: keep live market-data display disabled until the intended public/commercial use is classified and the appropriate plan/licence is confirmed. Do not assume a free tier is cleared for commercial use.

Official references:
- API pricing and keyless public API: https://www.coingecko.com/en/api/pricing
- Simple price endpoint: https://docs.coingecko.com/reference/simple-price
- Public API rate limit: https://support.coingecko.com/articles/5125303456-what-is-the-rate-limit-for-coingecko-api-public-plan

V10 implementation:
- `coingecko-market-data.js` uses only the fixed HTTPS endpoint `api.coingecko.com/api/v3/simple/price` and fixed asset IDs; no caller-controlled URL or symbol routing.
- One GET request asks for `bitcoin,toncoin,tether`, USD prices and `last_updated_at`.
- The adapter validates HTTP status, JSON content type, declared and actual response size (16 KiB cap), JSON shape, positive finite prices and provider timestamps.
- Request timeout is 5 seconds; redirects are rejected; automatic retries are intentionally absent to respect the variable public-plan rate limit.
- Every normalized quote is passed through the V09 source allowlist and freshness validator. If any requested quote is missing, stale, malformed or future-dated, the adapter returns no quotes (fail closed).
- No API key, credential, database, browser-side provider call, cache, wallet connection, order, transfer or ledger mutation is introduced.
- Provider data is reference data, not an executable exchange rate or guaranteed fill price. Cross-rates may differ from a direct exchange order book.

**Current status:** adapter and mocked tests are implemented in the isolated V10 branch. No live provider call is made by CI. A live endpoint smoke test and production terms review remain separate approval gates.


## 11. Licensing gate clarification (reviewed 2026-11-02)

The distinction between rate limits and usage rights is mandatory:
- Public keyless API: 5–15 calls/minute, variable by global usage conditions; this is a technical limit, not a commercial licence.
- Free Demo plan: 10,000 call credits/month and 100 calls/minute as currently listed on the pricing page. CoinGecko's licensing FAQ states Demo and free keyless API access do **not** include commercial rights.
- Paid self-serve plans include standard commercial rights for products displaying data with prominent attribution ("Data provided by CoinGecko" and link, subject to the current brand guide and terms).
- Standard commercial rights do not include redistribution, syndication, resale, API sublicensing or white-label display. Custom rights require a separate agreement; do not expose a reusable public data feed without confirming the licence scope.
- The Wallet is a public-facing product. Therefore, before enabling a live public feed, confirm whether its use is non-commercial display, standard commercial display, or redistribution; then obtain the matching plan and any custom permissions required. Until then the V10 adapter remains isolated and is tested only with mocked responses.

Official licensing/rate-limit references:
- Pricing and plan comparison: https://www.coingecko.com/en/api/pricing
- Public API rate limit (last updated 2026-10-02): https://support.coingecko.com/articles/5125303456-what-is-the-rate-limit-for-coingecko-api-public-plan
- Commercial vs custom licensing (last updated 2026-10-19): https://support.coingecko.com/articles/1043089972-what-are-the-differences-between-commercial-and-custom-licenses
