import test from "node:test";
import assert from "node:assert/strict";
import { selectDisplayableQuotes, validateMarketQuote } from "./market-data.js";

const nowMs = Date.parse("2026-11-02T19:00:00.000Z");
const options = { nowMs, allowedSources: ["approved-feed"], maxAgeMs: 120_000 };
const quote = (overrides = {}) => ({
  symbol: "BTC/USDT",
  price: "68000.25",
  source: "approved-feed",
  timestamp: new Date(nowMs - 10_000).toISOString(),
  ...overrides
});

test("accepts a fresh quote from an explicitly approved source", () => {
  const result = validateMarketQuote(quote(), options);
  assert.equal(result.accepted, true);
  assert.equal(result.status, "fresh");
  assert.equal(result.price, 68000.25);
  assert.equal(result.ageMs, 10_000);
});

test("rejects unsupported symbols and unapproved providers", () => {
  assert.equal(validateMarketQuote(quote({ symbol: "DOGE/USDT" }), options).reason, "unsupported_symbol");
  assert.equal(validateMarketQuote(quote({ source: "unknown-feed" }), options).reason, "untrusted_source");
});

test("rejects malformed, zero, negative and non-finite prices", () => {
  for (const price of ["", null, true, 0, -1, "NaN", "Infinity", {}]) {
    assert.equal(validateMarketQuote(quote({ price }), options).accepted, false);
  }
});

test("rejects invalid timestamps and timestamps too far in the future", () => {
  assert.equal(validateMarketQuote(quote({ timestamp: "not-a-date" }), options).reason, "invalid_timestamp");
  assert.equal(validateMarketQuote(quote({ timestamp: new Date(nowMs + 60_000).toISOString() }), options).reason, "future_timestamp");
});

test("marks old quotes stale and excludes them from displayable results", () => {
  const stale = validateMarketQuote(quote({ timestamp: new Date(nowMs - 121_000).toISOString() }), options);
  assert.equal(stale.accepted, false);
  assert.equal(stale.status, "stale");
  assert.deepEqual(selectDisplayableQuotes([stale, validateMarketQuote(quote(), options)]).map((item) => item.status), ["fresh"]);
});

test("validates bid/ask consistency and price containment", () => {
  assert.equal(validateMarketQuote(quote({ bid: 100, ask: 99 }), options).reason, "invalid_spread");
  assert.equal(validateMarketQuote(quote({ bid: 68001, ask: 68002 }), options).reason, "price_outside_spread");
  assert.equal(validateMarketQuote(quote({ bid: 68000, ask: 68001 }), options).accepted, true);
});

test("does not mutate provider payloads", () => {
  const input = quote();
  const before = structuredClone(input);
  validateMarketQuote(input, options);
  assert.deepEqual(input, before);
});

test("fails closed for missing or malformed quote collections", () => {
  assert.deepEqual(selectDisplayableQuotes(null), []);
  assert.deepEqual(selectDisplayableQuotes({}), []);
});
