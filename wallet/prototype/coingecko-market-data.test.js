import test from "node:test";
import assert from "node:assert/strict";
import { COINGECKO_SOURCE, fetchCoinGeckoQuotes } from "./coingecko-market-data.js";

const nowMs = Date.parse("2026-11-02T19:00:00.000Z");
const freshSeconds = Math.floor((nowMs - 15_000) / 1000);
const payload = () => ({
  bitcoin: { usd: 68000, last_updated_at: freshSeconds },
  toncoin: { usd: 2.1, last_updated_at: freshSeconds },
  tether: { usd: 0.999, last_updated_at: freshSeconds }
});
const response = (body, { status = 200, contentType = "application/json", contentLength } = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: (name) => name === "content-type" ? contentType : name === "content-length" ? contentLength ?? null : null },
  text: async () => typeof body === "string" ? body : JSON.stringify(body)
});
const fetchFor = (res, capture = {}) => async (url, init) => {
  capture.url = url;
  capture.init = init;
  return res;
};

test("fetches one fixed public request and maps all three supported pairs", async () => {
  const capture = {};
  const result = await fetchCoinGeckoQuotes({ fetchImpl: fetchFor(response(payload()), capture), nowMs });
  assert.equal(result.ok, true);
  assert.deepEqual(result.quotes.map((quote) => quote.symbol), ["BTC/USDT", "TON/USDT", "USDT/USD"]);
  assert.equal(result.quotes[0].price, 68000 / 0.999);
  assert.equal(result.quotes[1].price, 2.1 / 0.999);
  assert.equal(result.quotes[2].price, 0.999);
  assert.ok(result.quotes.every((quote) => quote.source === COINGECKO_SOURCE && quote.status === "fresh"));
  const url = new URL(capture.url);
  assert.equal(url.origin, "https://api.coingecko.com");
  assert.equal(url.pathname, "/api/v3/simple/price");
  assert.equal(url.searchParams.get("ids"), "bitcoin,toncoin,tether");
  assert.equal(capture.init.method, "GET");
  assert.equal(capture.init.redirect, "error");
  assert.equal("authorization" in capture.init.headers, false);
});

test("uses the oldest source timestamp for derived cross-rates", async () => {
  const data = payload();
  data.tether.last_updated_at = freshSeconds - 30;
  const result = await fetchCoinGeckoQuotes({ fetchImpl: fetchFor(response(data)), nowMs });
  assert.equal(result.ok, true);
  assert.equal(result.quotes[0].ageMs, 45_000);
  assert.equal(result.quotes[1].ageMs, 45_000);
  assert.equal(result.quotes[2].ageMs, 45_000);
});

test("fails closed on provider HTTP errors and rate limiting", async () => {
  for (const [status, expected] of [[503, "provider_http_error"], [429, "provider_rate_limited"]]) {
    const result = await fetchCoinGeckoQuotes({ fetchImpl: fetchFor(response({}, { status })), nowMs });
    assert.equal(result.ok, false);
    assert.deepEqual(result.quotes, []);
    assert.equal(result.error, expected);
  }
});

test("rejects unexpected content types, oversized bodies and malformed JSON", async () => {
  const html = await fetchCoinGeckoQuotes({ fetchImpl: fetchFor(response("{}", { contentType: "text/html" })), nowMs });
  assert.equal(html.error, "unexpected_content_type");
  const largeHeader = await fetchCoinGeckoQuotes({ fetchImpl: fetchFor(response("{}", { contentLength: "20000" })), nowMs });
  assert.equal(largeHeader.error, "response_too_large");
  const malformed = await fetchCoinGeckoQuotes({ fetchImpl: fetchFor(response("{bad json")), nowMs });
  assert.equal(malformed.error, "invalid_json");
  const largeBody = await fetchCoinGeckoQuotes({ fetchImpl: fetchFor(response("x".repeat(16_385))), nowMs });
  assert.equal(largeBody.error, "response_too_large");
});

test("rejects missing assets, zero prices and missing provider timestamps", async () => {
  const missing = await fetchCoinGeckoQuotes({ fetchImpl: fetchFor(response({ bitcoin: payload().bitcoin })), nowMs });
  assert.equal(missing.error, "invalid_provider_payload");
  const zero = payload();
  zero.toncoin.usd = 0;
  const invalidPrice = await fetchCoinGeckoQuotes({ fetchImpl: fetchFor(response(zero)), nowMs });
  assert.equal(invalidPrice.error, "invalid_provider_payload");
  const noTime = payload();
  delete noTime.tether.last_updated_at;
  const invalidTimestamp = await fetchCoinGeckoQuotes({ fetchImpl: fetchFor(response(noTime)), nowMs });
  assert.equal(invalidTimestamp.error, "invalid_provider_payload");
});

test("rejects stale quotes and timestamps too far in the future", async () => {
  const stale = payload();
  stale.bitcoin.last_updated_at = Math.floor((nowMs - 180_000) / 1000);
  assert.equal((await fetchCoinGeckoQuotes({ fetchImpl: fetchFor(response(stale)), nowMs })).error, "quote_validation_failed");
  const future = payload();
  future.toncoin.last_updated_at = Math.floor((nowMs + 60_000) / 1000);
  assert.equal((await fetchCoinGeckoQuotes({ fetchImpl: fetchFor(response(future)), nowMs })).error, "quote_validation_failed");
});

test("returns a bounded timeout result when the provider does not respond", async () => {
  const fetchImpl = (_url, { signal }) => new Promise((resolve, reject) => {
    signal.addEventListener("abort", () => {
      const error = new Error("aborted");
      error.name = "AbortError";
      reject(error);
    }, { once: true });
  });
  const result = await fetchCoinGeckoQuotes({ fetchImpl, nowMs, timeoutMs: 5 });
  assert.equal(result.ok, false);
  assert.equal(result.error, "provider_timeout");
});

test("does not call a missing fetch implementation", async () => {
  const result = await fetchCoinGeckoQuotes({ fetchImpl: null, nowMs });
  assert.equal(result.ok, false);
  assert.equal(result.error, "fetch_unavailable");
  assert.deepEqual(result.quotes, []);
});
