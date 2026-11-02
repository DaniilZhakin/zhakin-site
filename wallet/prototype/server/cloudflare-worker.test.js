import test from "node:test";
import assert from "node:assert/strict";
import { createMarketWorker, MarketStateDurableObject } from "./cloudflare-worker.js";

class MemoryStorage {
  constructor() { this.values = new Map(); }
  async get(key) { return this.values.get(key); }
  async put(key, value) { this.values.set(key, value); }
  async delete(key) { this.values.delete(key); }
  async transaction(fn) { return fn(this); }
}
class Stub {
  constructor() { this.storage = new MemoryStorage(); this.object = new MarketStateDurableObject({ storage: this.storage }); }
  fetch(input, init) { return this.object.fetch(input instanceof Request ? input : new Request(input, init)); }
}
function envFor(stub, flags = {}) {
  return {
    MARKET_STATE: { idFromName: (id) => id, get: () => stub },
    ...flags
  };
}
const req = (origin = "https://xn--80alhhq.xn--p1ai", path = "/api/v1/market/quotes", method = "GET") =>
  new Request("https://wallet.test" + path, { method, headers: origin ? { Origin: origin } : {} });
const quotes = () => [
  { symbol: "BTC/USDT", price: 65000, source: "coingecko-public", timestamp: new Date().toISOString() },
  { symbol: "TON/USDT", price: 1.6, source: "coingecko-public", timestamp: new Date().toISOString() },
  { symbol: "USDT/USD", price: 1, source: "coingecko-public", timestamp: new Date().toISOString() }
];

test("Cloudflare entrypoint rejects untrusted origins and unsupported routes", async () => {
  const stub = new Stub();
  const worker = createMarketWorker({ fetchQuotes: async () => ({ ok: true, quotes: quotes() }) });
  assert.equal((await worker.fetch(req("https://evil.example"), envFor(stub))).status, 403);
  assert.equal((await worker.fetch(req("https://xn--80alhhq.xn--p1ai", "/other"), envFor(stub))).status, 404);
  assert.equal((await worker.fetch(req("https://xn--80alhhq.xn--p1ai", "/api/v1/market/quotes", "POST"), envFor(stub))).status, 405);
});

test("Cloudflare entrypoint requires a Durable Object binding", async () => {
  const worker = createMarketWorker();
  const response = await worker.fetch(req(), { MARKET_DATA_ENABLED: "true", MARKET_DATA_LICENSE_APPROVED: "true" });
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "market_state_unavailable" });
});

test("disabled-by-default gate prevents provider call even with Cloudflare state bound", async () => {
  const stub = new Stub();
  let calls = 0;
  const worker = createMarketWorker({ fetchQuotes: async () => { calls += 1; return { ok: true, quotes: quotes() }; } });
  const response = await worker.fetch(req(), envFor(stub));
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error, "market_data_disabled");
  assert.equal(calls, 0);
});

test("Cloudflare adapter persists shared cache and returns sanitized quotes", async () => {
  const stub = new Stub();
  const worker = createMarketWorker({ fetchQuotes: async () => ({ ok: true, quotes: quotes() }) });
  const env = envFor(stub, { MARKET_DATA_ENABLED: "true", MARKET_DATA_LICENSE_APPROVED: "true" });
  const first = await worker.fetch(req(), env);
  assert.equal(first.status, 200);
  assert.equal(first.headers.get("access-control-allow-origin"), "https://xn--80alhhq.xn--p1ai");
  assert.equal((await first.json()).cached, false);
  const second = await worker.fetch(req(), env);
  assert.equal(second.status, 200);
  assert.equal((await second.json()).cached, true);
});

test("Durable Object enforces one global 8-per-minute provider refresh limit", async () => {
  const stub = new Stub();
  for (let i = 0; i < 8; i += 1) {
    const response = await stub.fetch(new Request("https://state/limit/consume", { method: "POST" }));
    assert.equal(response.status, 200);
    assert.equal((await response.json()).allowed, true);
  }
  const blocked = await stub.fetch(new Request("https://state/limit/consume", { method: "POST" }));
  assert.equal(blocked.status, 429);
  assert.equal((await blocked.json()).allowed, false);
});

test("Durable Object rejects unknown cache keys and excessive TTL", async () => {
  const stub = new Stub();
  const unknown = await stub.fetch(new Request("https://state/cache/put", {
    method: "POST", body: JSON.stringify({ key: "user-controlled", value: {}, ttlSeconds: 15 })
  }));
  assert.equal(unknown.status, 400);
  const excessive = await stub.fetch(new Request("https://state/cache/put", {
    method: "POST", body: JSON.stringify({ key: "zhakin-wallet-market-v1", value: { quotes: [] }, ttlSeconds: 300 })
  }));
  assert.equal(excessive.status, 400);
});
