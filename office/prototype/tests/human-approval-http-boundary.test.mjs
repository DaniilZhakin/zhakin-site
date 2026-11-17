import test from "node:test";
import assert from "node:assert/strict";
import { createHumanApprovalHttpHandler } from "../src/human-approval-http-boundary.mjs";

const ORIGIN = "https://xn--80alhhq.xn--p1ai";
const TOKEN = "eyJhbGciOiJSUzI1NiJ9.payload.signature";
function setup({ rateResult = true, rateError = false, reviewError = null } = {}) {
  const calls = { rate: 0, review: [] };
  const gateway = {
    async reviewProposal(input) {
      calls.review.push(input);
      if (reviewError) throw reviewError;
      return { proposalId: input.proposalId, status: input.action === "accept" ? "accepted" : "rejected", taskChanged: input.action === "accept" };
    },
  };
  const handler = createHumanApprovalHttpHandler({
    gateway,
    allowedOrigins: [ORIGIN],
    rateLimit: async ({ route, clientAddress }) => {
      calls.rate += 1;
      assert.equal(route, "human-proposal-review");
      assert.equal(clientAddress, "203.0.113.10");
      if (rateError) throw new Error("limiter unavailable");
      return rateResult;
    },
  });
  return { handler, calls };
}
function request(path = "/office/proposals/proposal_123/review", {
  method = "POST", origin = ORIGIN, headers = {}, body = JSON.stringify({ action: "accept" }),
} = {}) {
  return new Request(`https://office.example${path}`, {
    method,
    headers: {
      origin,
      authorization: `Bearer ${TOKEN}`,
      "content-type": "application/json",
      "cf-connecting-ip": "203.0.113.10",
      ...headers,
    },
    body: method === "GET" || method === "HEAD" ? undefined : body,
  });
}

test("requires HTTPS allowlist, gateway and distributed rate limiter", () => {
  assert.throws(() => createHumanApprovalHttpHandler({ gateway: {}, allowedOrigins: [ORIGIN], rateLimit: () => true }));
  assert.throws(() => createHumanApprovalHttpHandler({ gateway: { reviewProposal() {} }, allowedOrigins: ["http://localhost"], rateLimit: () => true }));
  assert.throws(() => createHumanApprovalHttpHandler({ gateway: { reviewProposal() {} }, allowedOrigins: [ORIGIN] }));
});

test("accepts valid same-origin bearer review and forwards only allowlisted fields", async () => {
  const { handler, calls } = setup();
  const response = await handler(request());
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("access-control-allow-origin"), ORIGIN);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), { proposalId: "proposal_123", status: "accepted", taskChanged: true });
  assert.equal(calls.rate, 1);
  assert.deepEqual(calls.review, [{
    bearerToken: TOKEN, proposalId: "proposal_123", action: "accept", comment: null,
  }]);
});

test("rejects foreign, absent and opaque origins before rate limiting", async () => {
  const { handler, calls } = setup();
  for (const origin of ["https://attacker.example", null, "null"]) {
    const response = await handler(request("/", { origin }));
    assert.equal(response.status, 403);
  }
  assert.equal(calls.rate, 0);
});

test("preflight allows only POST and the two required headers", async () => {
  const { handler } = setup();
  const good = await handler(request("/office/proposals/x/review", {
    method: "OPTIONS",
    headers: { "access-control-request-method": "POST", "access-control-request-headers": "authorization, content-type" },
    body: undefined,
  }));
  assert.equal(good.status, 204);
  const bad = await handler(request("/office/proposals/x/review", {
    method: "OPTIONS",
    headers: { "access-control-request-method": "DELETE", "access-control-request-headers": "authorization" },
    body: undefined,
  }));
  assert.equal(bad.status, 403);
});

test("rejects wrong methods, cross-site fetch metadata, route and content type", async () => {
  const { handler, calls } = setup();
  assert.equal((await handler(request("/office/proposals/x/review", { method: "GET" }))).status, 405);
  assert.equal((await handler(request("/office/proposals/x/review", { headers: { "sec-fetch-site": "cross-site" } }))).status, 403);
  assert.equal((await handler(request("/office/proposals/x/other"))).status, 404);
  assert.equal((await handler(request("/office/proposals/x/review", { headers: { "content-type": "text/plain" } }))).status, 415);
  assert.equal(calls.rate, 0);
});

test("requires bearer authorization; cookies alone are not credentials", async () => {
  const { handler, calls } = setup();
  const response = await handler(request("/office/proposals/x/review", {
    headers: { authorization: "", cookie: "office_session=forged" },
  }));
  assert.equal(response.status, 401);
  assert.equal(calls.rate, 0);
});

test("fails closed when distributed rate limiter denies or is unavailable", async () => {
  const denied = setup({ rateResult: false });
  assert.equal((await denied.handler(request())).status, 429);
  assert.equal(denied.calls.review.length, 0);
  const unavailable = setup({ rateError: true });
  assert.equal((await unavailable.handler(request())).status, 503);
  assert.equal(unavailable.calls.review.length, 0);
});

test("bounds request body and rejects malformed or extra fields", async () => {
  const { handler, calls } = setup();
  const oversized = await handler(request("/office/proposals/x/review", {
    body: JSON.stringify({ action: "accept", comment: "x".repeat(5000) }),
  }));
  assert.equal(oversized.status, 413);
  const malformed = await handler(request("/office/proposals/x/review", { body: "{" }));
  assert.equal(malformed.status, 400);
  const extra = await handler(request("/office/proposals/x/review", { body: JSON.stringify({ action: "accept", userId: "admin" }) }));
  assert.equal(extra.status, 400);
  assert.equal(calls.review.length, 0);
});

test("maps gateway failures to generic safe HTTP errors", async () => {
  const { handler } = setup({ reviewError: Object.assign(new Error("database secret details"), { status: 409 }) });
  const response = await handler(request());
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), { error: "proposal_conflict" });
});
