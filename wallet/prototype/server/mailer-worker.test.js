import test from "node:test";
import assert from "node:assert/strict";
import { createWalletMailer } from "./mailer-worker.js";

const NOW = 1_800_000_000_000;
const validPayload = () => ({
  to: "member@example.org",
  code: "042681",
  expires_at: NOW + 10 * 60 * 1000,
});
function setup({ providerResponse = new Response(null, { status: 202 }), from = "wallet@example.org" } = {}) {
  const calls = [];
  const provider = {
    async fetch(request) {
      calls.push({ request, body: await request.json() });
      return providerResponse;
    },
  };
  return {
    calls,
    mailer: createWalletMailer({ provider, from, now: () => NOW }),
  };
}
function request(body, options = {}) {
  return new Request("https://mailer.internal/v1/otp", {
    method: options.method || "POST",
    headers: options.headers || { "content-type": "application/json" },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
}

test("mailer validates dependencies before use", () => {
  assert.throws(() => createWalletMailer({ from: "wallet@example.org" }), /service binding/);
  assert.throws(() => createWalletMailer({ provider: { fetch() {} }, from: "bad sender" }), /sender/);
});

test("valid OTP is converted to a minimal provider-neutral email", async () => {
  const { mailer, calls } = setup();
  const response = await mailer.fetch(request(validPayload()));
  assert.equal(response.status, 202);
  assert.deepEqual(await response.json(), { accepted: true });
  assert.equal(calls.length, 1);
  assert.deepEqual(
    { from: calls[0].body.from, to: calls[0].body.to, subject: calls[0].body.subject },
    {
      from: "wallet@example.org",
      to: "member@example.org",
      subject: "Код входа в ZHAKIN Wallet",
    },
  );
  assert.match(calls[0].body.text, /042681/);
});

test("rejects wrong path, method, content type and malformed JSON", async () => {
  const { mailer, calls } = setup();
  assert.equal((await mailer.fetch(new Request("https://mailer.internal/other", { method: "POST" }))).status, 404);
  assert.equal((await mailer.fetch(request(validPayload(), { method: "GET" }))).status, 405);
  assert.equal((await mailer.fetch(request("{}", { headers: { "content-type": "text/plain" } }))).status, 415);
  assert.equal((await mailer.fetch(request("{"))).status, 400);
  assert.equal(calls.length, 0);
});

test("rejects malformed, extra, expired and overlong OTP payloads", async () => {
  const { mailer, calls } = setup();
  const bad = [
    { ...validPayload(), code: "12345" },
    { ...validPayload(), to: "Member@example.org" },
    { ...validPayload(), extra: "not-allowed" },
    { ...validPayload(), expires_at: NOW },
    { ...validPayload(), expires_at: NOW + 11 * 60 * 1000 },
  ];
  for (const value of bad) assert.equal((await mailer.fetch(request(value))).status, 400);
  assert.equal(calls.length, 0);
});

test("rejects request bodies larger than 2 KiB", async () => {
  const { mailer, calls } = setup();
  const response = await mailer.fetch(request(" ".repeat(2049)));
  assert.equal(response.status, 413);
  assert.equal(calls.length, 0);
});

test("provider failures are sanitized and do not leak upstream details", async () => {
  const { mailer } = setup({ providerResponse: new Response("private provider diagnostic", { status: 500 }) });
  const response = await mailer.fetch(request(validPayload()));
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "delivery_unavailable" });
  assert.equal(response.headers.get("cache-control"), "no-store");
});
