import test from "node:test";
import assert from "node:assert/strict";
import { createMarketDataHandler } from "./market-handler.js";

const NOW = Date.parse("2026-11-02T20:00:00.000Z");
const freshQuotes = () => [
  { symbol: "BTC/USDT", price: 68000, source: "coingecko-public", timestamp: new Date(NOW).toISOString() },
  { symbol: "TON/USDT", price: 1.7, source: "coingecko-public", timestamp: new Date(NOW).toISOString() },
  { symbol: "USDT/USD", price: 0.999, source: "coingecko-public", timestamp: new Date(NOW).toISOString() }
];
const request = (path = "/api/v1/market/quotes", method = "GET") =>
  new Request(`https://wallet.test${path}`, { method });
const enabled = { MARKET_DATA_ENABLED: "true", MARKET_DATA_LICENSE_APPROVED: "true" };
const responseBody = (response) => response.json();

function adapters(overrides = {}) {
  const state = { cache: null, puts: 0, limits: 0, fetches: 0 };
  const cache = {
    async get() { return state.cache; },
    async put(_key, value, ttl) { state.cache = value; state.puts += 1; state.ttl = ttl; }
  };
  const rateLimiter = { async consume() { state.limits += 1; return true; } };
  const fetchQuotes = async () => { state.fetches += 1; return { ok: true, quotes: freshQuotes() }; };
  return {
    state,
    cache: overrides.cache ?? cache,
    rateLimiter: overrides.rateLimiter ?? rateLimiter,
    fetchQuotes: overrides.fetchQuotes ?? fetchQuotes
  };
}

test("market route is disabled by default and requires both independent server flags", async () => {
  const a = adapters();
  const handle = createMarketDataHandler(a);
  for (const env of [{}, { MARKET_DATA_ENABLED: "true" }, { MARKET_DATA_LICENSE_APPROVED: "true" }]) {
    const response = await handle(request(), env);
    assert.equal(response.status, 503);
    assert.equal((await responseBody(response)).error, "market_data_disabled");
  }
  assert.equal(a.state.fetches, 0);
});

test("wrong path and non-GET methods are rejected without provider calls", async () => {
  const a = adapters();
  const handle = createMarketDataHandler(a);
  assert.equal((await handle(request("/other"), enabled)).status, 404);
  assert.equal((await handle(request("/api/v1/market/quotes", "POST"), enabled)).status, 405);
  assert.equal(a.state.fetches, 0);
});

test("missing cache or rate limiter fails closed before upstream access", async () => {
  const handle = createMarketDataHandler({ fetchQuotes: async () => { throw new Error("must not run"); } });
  const response = await handle(request(), enabled);
  assert.equal(response.status, 503);
  assert.equal((await responseBody(response)).error, "market_data_unavailable");
});

test("fresh quotes are sanitized, cached for 15 seconds, and rate-limited before provider access", async () => {
  const a = adapters();
  const handle = createMarketDataHandler({ ...a, now: () => NOW });
  const response = await handle(request(), enabled);
  assert.equal(response.status, 200);
  const body = await responseBody(response);
  assert.equal(body.cached, false);
  assert.deepEqual(body.quotes.map((q) => q.symbol), ["BTC/USDT", "TON/USDT", "USDT/USD"]);
  assert.equal("timestamp" in body.quotes[0], false);
  assert.equal(a.state.puts, 1);
  assert.equal(a.state.ttl, 15);
  assert.equal(a.state.limits, 1);
  assert.equal(a.state.fetches, 1);
});

test("a valid cache hit avoids both rate limiter and provider", async () => {
  const a = adapters();
  a.state.cache = { quotes: freshQuotes() };
  const handle = createMarketDataHandler({ ...a, now: () => NOW });
  const response = await handle(request(), enabled);
  assert.equal(response.status, 200);
  assert.equal((await responseBody(response)).cached, true);
  assert.equal(a.state.limits, 0);
  assert.equal(a.state.fetches, 0);
});

test("stale cache is not served and triggers a bounded refresh path", async () => {
  const a = adapters();
  a.state.cache = { quotes: freshQuotes().map((q) => ({ ...q, timestamp: "2026-11-02T19:55:00.000Z" })) };
  const handle = createMarketDataHandler({ ...a, now: () => NOW });
  const response = await handle(request(), enabled);
  assert.equal(response.status, 200);
  assert.equal((await responseBody(response)).cached, false);
  assert.equal(a.state.limits, 1);
  assert.equal(a.state.fetches, 1);
});

test("provider errors and malformed or incomplete quote sets return no prices", async () => {
  for (const fetchQuotes of [
    async () => ({ ok: false, quotes: [], error: "provider_http_error" }),
    async () => ({ ok: true, quotes: freshQuotes().slice(0, 2) }),
    async () => ({ ok: true, quotes: freshQuotes().map((q) => ({ ...q, source: "untrusted" })) }),
    async () => ({ ok: true, quotes: freshQuotes().map((q) => ({ ...q, price: 0 })) })
  ]) {
    const a = adapters({ fetchQuotes });
    const handle = createMarketDataHandler({ ...a, now: () => NOW });
    const response = await handle(request(), enabled);
    assert.equal(response.status, 503);
    assert.deepEqual((await responseBody(response)), { error: "market_data_unavailable" });
    assert.equal(a.state.puts, 0);
  }
});

test("rate limit denial prevents upstream call", async () => {
  const a = adapters({ rateLimiter: { async consume() { return { allowed: false }; } } });
  const handle = createMarketDataHandler(a);
  const response = await handle(request(), enabled);
  assert.equal(response.status, 429);
  assert.equal(a.state.fetches, 0);
});

test("cache and limiter failures fail closed", async () => {
  const badCache = adapters({ cache: { async get() { throw new Error("cache down"); }, async put() {} } });
  const first = await createMarketDataHandler(badCache)(request(), enabled);
  assert.equal(first.status, 503);
  assert.equal(badCache.state.fetches, 0);

  const badLimiter = adapters({ rateLimiter: { async consume() { throw new Error("limiter down"); } } });
  const second = await createMarketDataHandler(badLimiter)(request(), enabled);
  assert.equal(second.status, 503);
  assert.equal(badLimiter.state.fetches, 0);
});

test("cache write failure suppresses otherwise valid upstream quotes", async () => {
  const a = adapters({ cache: { async get() { return null; }, async put() { throw new Error("write failed"); } } });
  const handle = createMarketDataHandler({ ...a, now: () => NOW });
  const response = await handle(request(), enabled);
  assert.equal(response.status, 503);
  assert.equal(a.state.fetches, 1);
  assert.deepEqual(await responseBody(response), { error: "market_data_unavailable" });
});
