/**
 * ZHAKIN Wallet — CoinGecko public read-only market-data adapter.
 * Fixed public endpoint; no credentials, persistence, browser calls or trading.
 */
import { validateMarketQuote } from "./market-data.js";

export const COINGECKO_SOURCE = "coingecko-public";
const ENDPOINT = "https://api.coingecko.com/api/v3/simple/price";
const MAX_RESPONSE_BYTES = 16_384;
const REQUEST_TIMEOUT_MS = 5_000;
const COIN_IDS = "bitcoin,toncoin,tether";
const CURRENCY = "usd";

function positiveFinite(value) {
  if (!(typeof value === "number" || (typeof value === "string" && value.trim() !== ""))) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function observationTime(asset) {
  const seconds = asset?.last_updated_at;
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds <= 0) return null;
  const date = new Date(seconds * 1000);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function buildRawQuotes(payload) {
  const btcUsd = positiveFinite(payload?.bitcoin?.usd);
  const tonUsd = positiveFinite(payload?.toncoin?.usd);
  const usdtUsd = positiveFinite(payload?.tether?.usd);
  const btcAt = observationTime(payload?.bitcoin);
  const tonAt = observationTime(payload?.toncoin);
  const usdtAt = observationTime(payload?.tether);

  if ([btcUsd, tonUsd, usdtUsd].some((value) => value === null) || !btcAt || !tonAt || !usdtAt) {
    return { ok: false, error: "invalid_provider_payload" };
  }

  // Cross-rates are calculated from USD reference prices. Use the oldest
  // constituent timestamp so a derived quote cannot appear fresher than its inputs.
  const btcTonTimestamp = new Date(Math.min(Date.parse(btcAt), Date.parse(usdtAt))).toISOString();
  const tonUsdtTimestamp = new Date(Math.min(Date.parse(tonAt), Date.parse(usdtAt))).toISOString();

  return {
    ok: true,
    quotes: [
      { symbol: "BTC/USDT", price: btcUsd / usdtUsd, source: COINGECKO_SOURCE, timestamp: btcTonTimestamp },
      { symbol: "TON/USDT", price: tonUsd / usdtUsd, source: COINGECKO_SOURCE, timestamp: tonUsdtTimestamp },
      { symbol: "USDT/USD", price: usdtUsd, source: COINGECKO_SOURCE, timestamp: usdtAt }
    ]
  };
}

/**
 * Fetch all three approved display pairs in one request.
 * Returns only validated fresh quotes. On any provider/payload failure, fails closed.
 */
export async function fetchCoinGeckoQuotes({
  fetchImpl = globalThis.fetch,
  nowMs = Date.now(),
  timeoutMs = REQUEST_TIMEOUT_MS
} = {}) {
  if (typeof fetchImpl !== "function") return { ok: false, quotes: [], error: "fetch_unavailable" };

  const url = new URL(ENDPOINT);
  url.searchParams.set("ids", COIN_IDS);
  url.searchParams.set("vs_currencies", CURRENCY);
  url.searchParams.set("include_last_updated_at", "true");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url.toString(), {
      method: "GET",
      headers: { accept: "application/json" },
      signal: controller.signal,
      redirect: "error"
    });
    if (!response || response.ok !== true) {
      return { ok: false, quotes: [], error: response?.status === 429 ? "provider_rate_limited" : "provider_http_error" };
    }
    const contentType = response.headers?.get?.("content-type") ?? "";
    if (!contentType.toLowerCase().includes("application/json")) {
      return { ok: false, quotes: [], error: "unexpected_content_type" };
    }
    const declaredLength = Number(response.headers?.get?.("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
      return { ok: false, quotes: [], error: "response_too_large" };
    }
    if (typeof response.text !== "function") return { ok: false, quotes: [], error: "invalid_response" };
    const body = await response.text();
    if (typeof body !== "string" || body.length > MAX_RESPONSE_BYTES) {
      return { ok: false, quotes: [], error: "response_too_large" };
    }

    let payload;
    try { payload = JSON.parse(body); }
    catch { return { ok: false, quotes: [], error: "invalid_json" }; }

    const mapped = buildRawQuotes(payload);
    if (!mapped.ok) return { ok: false, quotes: [], error: mapped.error };

    const validated = mapped.quotes.map((quote) => validateMarketQuote(quote, {
      nowMs,
      allowedSources: [COINGECKO_SOURCE]
    }));
    if (validated.some((quote) => !quote.accepted || quote.status !== "fresh")) {
      return { ok: false, quotes: [], error: "quote_validation_failed" };
    }
    return { ok: true, quotes: validated };
  } catch (error) {
    return {
      ok: false,
      quotes: [],
      error: error?.name === "AbortError" ? "provider_timeout" : "provider_unavailable"
    };
  } finally {
    clearTimeout(timeout);
  }
}
