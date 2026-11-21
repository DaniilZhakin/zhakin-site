import test from "node:test";
import assert from "node:assert/strict";
import {
  OfficeRateLimitDurableObject,
  createDurableObjectRateLimiter,
} from "../src/durable-object-rate-limiter.mjs";

class MemoryStorage {
  constructor() { this.values = new Map(); this.tail = Promise.resolve(); }
  async transaction(callback) {
    const previous = this.tail;
    let release;
    this.tail = new Promise((resolve) => { release = resolve; });
    await previous;
    const staged = new Map(this.values);
    const txn = {
      get: async (key) => staged.get(key),
      put: async (key, value) => { staged.set(key, structuredClone(value)); },
    };
    try {
      const result = await callback(txn);
      this.values = staged;
      return result;
    } finally {
      release();
    }
  }
}
function doRequest(input) {
  return new Request("https://office-rate-limit.internal/check", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
}

test("Durable Object allows up to the configured limit in a fixed window", async () => {
  const storage = new MemoryStorage();
  const object = new OfficeRateLimitDurableObject({ storage });
  const input = { limit: 2, windowSeconds: 60, nowSeconds: 120 };
  const first = await (await object.fetch(doRequest(input))).json();
  const second = await (await object.fetch(doRequest(input))).json();
  const third = await (await object.fetch(doRequest(input))).json();
  assert.deepEqual(first, { allowed: true, remaining: 1, retryAfter: 0 });
  assert.deepEqual(second, { allowed: true, remaining: 0, retryAfter: 0 });
  assert.deepEqual(third, { allowed: false, remaining: 0, retryAfter: 60 });
});

test("Durable Object counter resets at the next window boundary", async () => {
  const object = new OfficeRateLimitDurableObject({ storage: new MemoryStorage() });
  await object.fetch(doRequest({ limit: 1, windowSeconds: 60, nowSeconds: 120 }));
  const response = await object.fetch(doRequest({ limit: 1, windowSeconds: 60, nowSeconds: 180 }));
  assert.deepEqual(await response.json(), { allowed: true, remaining: 0, retryAfter: 0 });
});

test("concurrent checks are serialized atomically; no over-admission", async () => {
  const object = new OfficeRateLimitDurableObject({ storage: new MemoryStorage() });
  const input = { limit: 5, windowSeconds: 60, nowSeconds: 120 };
  const results = await Promise.all(Array.from({ length: 20 }, () => object.fetch(doRequest(input))));
  const decisions = await Promise.all(results.map((response) => response.json()));
  assert.equal(decisions.filter((result) => result.allowed).length, 5);
  assert.equal(decisions.filter((result) => !result.allowed).length, 15);
});

test("invalid configuration, methods and content types fail closed", async () => {
  const object = new OfficeRateLimitDurableObject({ storage: new MemoryStorage() });
  assert.equal((await object.fetch(new Request("https://x", { method: "GET" }))).status, 405);
  assert.equal((await object.fetch(new Request("https://x", { method: "POST", body: "{}" }))).status, 415);
  assert.equal((await object.fetch(doRequest({ limit: 0, windowSeconds: 60, nowSeconds: 120 }))).status, 400);
  assert.equal((await object.fetch(doRequest({ limit: 1, windowSeconds: 60, nowSeconds: -1 }))).status, 400);
});

test("storage transaction errors return 503 rather than allowing the request", async () => {
  const object = new OfficeRateLimitDurableObject({
    storage: { transaction: async () => { throw new Error("storage unavailable"); } },
  });
  const response = await object.fetch(doRequest({ limit: 2, windowSeconds: 60, nowSeconds: 120 }));
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "rate_limit_unavailable" });
});

test("adapter hashes client identity, derives a DO id and returns the allow decision", async () => {
  const calls = { names: [], urls: [] };
  const namespace = {
    idFromName(name) { calls.names.push(name); return { name }; },
    get(id) {
      return { fetch: async (url, init) => {
        calls.urls.push(url);
        const body = JSON.parse(init.body);
        assert.deepEqual(body, { limit: 3, windowSeconds: 30, nowSeconds: 123 });
        return new Response(JSON.stringify({ allowed: true, remaining: 2, retryAfter: 0 }));
      } };
    },
  };
  const limiter = createDurableObjectRateLimiter({
    namespace, limit: 3, windowSeconds: 30, clock: () => 123456,
  });
  assert.equal(await limiter({ route: "human-proposal-review", clientAddress: "203.0.113.10" }), true);
  assert.equal(calls.names.length, 1);
  assert.match(calls.names[0], /^[a-f0-9]{64}$/);
  assert.equal(calls.names[0].includes("203.0.113.10"), false);
  assert.equal(calls.urls[0], "https://office-rate-limit.internal/check");
});

test("adapter rejects missing or malformed client identity and unsupported routes", async () => {
  const namespace = { idFromName() { throw new Error("must not be called"); }, get() {} };
  const limiter = createDurableObjectRateLimiter({ namespace });
  await assert.rejects(limiter({ route: "human-proposal-review", clientAddress: null }));
  await assert.rejects(limiter({ route: "other-route", clientAddress: "203.0.113.10" }));
  await assert.rejects(limiter({ route: "human-proposal-review", clientAddress: "spoofed, value" }));
});

test("adapter fails closed when the Durable Object binding is unavailable", async () => {
  const namespace = {
    idFromName: (name) => name,
    get: () => ({ fetch: async () => { throw new Error("binding unavailable"); } }),
  };
  const limiter = createDurableObjectRateLimiter({ namespace });
  await assert.rejects(limiter({ route: "human-proposal-review", clientAddress: "203.0.113.10" }));
});
