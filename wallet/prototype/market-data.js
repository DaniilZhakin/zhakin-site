/**
 * ZHAKIN Wallet market-data validation boundary.
 * Pure domain logic only: no network calls, credentials, persistence or trading.
 */
export const SUPPORTED_MARKET_PAIRS = Object.freeze([
  "BTC/USDT",
  "TON/USDT",
  "USDT/USD"
]);

const DEFAULT_MAX_AGE_MS = 120_000;
const DEFAULT_MAX_FUTURE_SKEW_MS = 30_000;

export function validateMarketQuote(raw, options = {}) {
  const nowMs = options.nowMs ?? Date.now();
  const maxAgeMs = options.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
  const maxFutureSkewMs = options.maxFutureSkewMs ?? DEFAULT_MAX_FUTURE_SKEW_MS;
  const allowedSources = options.allowedSources ?? [];

  const reject = (reason) => ({ accepted: false, status: "rejected", reason });

  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return reject("invalid_payload");
  if (!SUPPORTED_MARKET_PAIRS.includes(raw.symbol)) return reject("unsupported_symbol");
  if (typeof raw.source !== "string" || !allowedSources.includes(raw.source)) return reject("untrusted_source");

  // Accept decimal strings or numbers, but never coerce empty strings, null, booleans or objects.
  const parsePositive = (value) => {
    if (!(typeof value === "number" || (typeof value === "string" && value.trim() !== ""))) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  };

  const price = parsePositive(raw.price);
  if (price === null) return reject("invalid_price");

  const timestampMs = typeof raw.timestamp === "string" ? Date.parse(raw.timestamp) : NaN;
  if (!Number.isFinite(timestampMs)) return reject("invalid_timestamp");
  if (timestampMs > nowMs + maxFutureSkewMs) return reject("future_timestamp");

  const ageMs = Math.max(0, nowMs - timestampMs);
  if (ageMs > maxAgeMs) {
    return {
      accepted: false,
      status: "stale",
      reason: "quote_too_old",
      symbol: raw.symbol,
      source: raw.source,
      observedAt: new Date(timestampMs).toISOString(),
      ageMs
    };
  }

  let bid;
  let ask;
  if (raw.bid !== undefined || raw.ask !== undefined) {
    bid = parsePositive(raw.bid);
    ask = parsePositive(raw.ask);
    if (bid === null || ask === null || bid > ask) return reject("invalid_spread");
    if (price < bid || price > ask) return reject("price_outside_spread");
  }

  return {
    accepted: true,
    status: "fresh",
    symbol: raw.symbol,
    price,
    ...(bid !== undefined ? { bid, ask } : {}),
    source: raw.source,
    observedAt: new Date(timestampMs).toISOString(),
    ageMs
  };
}

export function selectDisplayableQuotes(quotes) {
  if (!Array.isArray(quotes)) return [];
  return quotes.filter((quote) => quote && quote.accepted === true && quote.status === "fresh");
}
