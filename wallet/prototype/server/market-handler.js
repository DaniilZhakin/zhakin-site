/**
 * ZHAKIN Wallet — isolated read-only market route.
 * Not wired to a deployed Worker. Live provider access is opt-in and requires
 * two independent server-side gates: feature enablement and licence approval.
 */
import { fetchCoinGeckoQuotes } from "../coingecko-market-data.js";
import { validateMarketQuote } from "../market-data.js";

const CACHE_KEY = "zhakin-wallet-market-v1";
const CACHE_TTL_SECONDS = 15;
const ALLOWED_SOURCE = ["coingecko-public"];

const json = (status, payload) => new Response(JSON.stringify(payload), {
  status,
  headers: {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer"
  }
});

const unavailable = () => json(503, { error: "market_data_unavailable" });

function normalizeQuotes(quotes, nowMs) {
  if (!Array.isArray(quotes) || quotes.length !== 3) return null;
  const validated = quotes.map((quote) => validateMarketQuote({
    symbol: quote?.symbol,
    price: quote?.price,
    source: quote?.source,
    timestamp: quote?.timestamp ?? quote?.observedAt
  }, { nowMs, allowedSources: ALLOWED_SOURCE }));
  if (validated.some((quote) => !quote.accepted || quote.status !== "fresh")) return null;
  const symbols = new Set(validated.map((quote) => quote.symbol));
  if (symbols.size !== 3) return null;
  return validated.map(({ symbol, price, source, observedAt }) => ({
    symbol, price, source, observedAt
  }));
}

/**
 * Required adapters:
 * - cache.get(key) -> { quotes } | null; cache.put(key, value, ttlSeconds)
 * - rateLimiter.consume() -> true | { allowed: true }; false / { allowed: false } rejects
 *
 * Both adapters are server-side only. No client IP, URL, symbol, or provider
 * routing value is accepted from the request.
 */
export function createMarketDataHandler({
  fetchQuotes = fetchCoinGeckoQuotes,
  cache,
  rateLimiter,
  now = () => Date.now()
} = {}) {
  return async function handleMarketRequest(request, env = {}) {
    const url = new URL(request.url);
    if (url.pathname !== "/api/v1/market/quotes") return json(404, { error: "not_found" });
    if (request.method !== "GET") return json(405, { error: "method_not_allowed" });

    // Two explicit server-side approvals; defaults and missing values are OFF.
    if (env.MARKET_DATA_ENABLED !== "true" || env.MARKET_DATA_LICENSE_APPROVED !== "true") {
      return json(503, { error: "market_data_disabled" });
    }
    if (!cache || typeof cache.get !== "function" || typeof cache.put !== "function" ||
        !rateLimiter || typeof rateLimiter.consume !== "function" ||
        typeof fetchQuotes !== "function") return unavailable();

    try {
      const cached = await cache.get(CACHE_KEY);
      if (cached) {
        const quotes = normalizeQuotes(cached.quotes, now());
        if (quotes) return json(200, { quotes, cached: true });
      }
    } catch {
      return unavailable();
    }

    try {
      const limit = await rateLimiter.consume();
      if (limit !== true && limit?.allowed !== true) {
        return json(429, { error: "market_data_rate_limited" });
      }
    } catch {
      return unavailable();
    }

    let result;
    try {
      result = await fetchQuotes({ nowMs: now() });
    } catch {
      return unavailable();
    }
    if (!result?.ok) return unavailable();

    const quotes = normalizeQuotes(result.quotes, now());
    if (!quotes) return unavailable();

    try {
      await cache.put(CACHE_KEY, { quotes }, CACHE_TTL_SECONDS);
    } catch {
      // Do not return an uncached provider response: this protects the upstream
      // rate budget and keeps the cache/rate-limit contract fail-closed.
      return unavailable();
    }
    return json(200, { quotes, cached: false });
  };
}
