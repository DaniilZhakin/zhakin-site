import test from "node:test";
import assert from "node:assert/strict";
import { createWalletHandler } from "./handler.js";

const request = (path, options = {}) => new Request(`https://wallet.test${path}`, options);
const body = async (response) => response.json();

test("health is public and clearly reports that the scaffold is not ready", async () => {
  const response = await createWalletHandler()(request("/health"));
  assert.equal(response.status, 200);
  assert.deepEqual(await body(response), {
    service: "zhakin-wallet-api", mode: "scaffold", ready: false,
  });
});

test("protected endpoints fail closed when no authentication adapter exists", async () => {
  const response = await createWalletHandler()(request("/api/v1/me"));
  assert.equal(response.status, 503);
  assert.equal((await body(response)).error, "service_not_configured");
});

test("an unauthenticated request cannot read identity or balance", async () => {
  const handle = createWalletHandler({
    authenticate: async () => null,
    repository: { getBalance: async () => 9000 },
  });
  for (const path of ["/api/v1/me", "/api/v1/me/balance"]) {
    const response = await handle(request(path));
    assert.equal(response.status, 401);
    assert.equal((await body(response)).error, "unauthenticated");
  }
});

test("identity is derived from the verified principal, not query input", async () => {
  const seen = [];
  const handle = createWalletHandler({
    authenticate: async () => ({ id: "verified-participant", roles: ["participant"] }),
    repository: { getBalance: async (id) => { seen.push(id); return 12; } },
  });
  const response = await handle(request("/api/v1/me/balance?participant_id=victim"));
  assert.equal(response.status, 200);
  assert.deepEqual(await body(response), { participant_id: "verified-participant", points: 12 });
  assert.deepEqual(seen, ["verified-participant"]);
});

test("missing repository never fabricates a balance", async () => {
  const handle = createWalletHandler({
    authenticate: async () => ({ id: "p-1", roles: ["participant"] }),
  });
  const response = await handle(request("/api/v1/me/balance"));
  assert.equal(response.status, 503);
  assert.equal((await body(response)).error, "service_not_configured");
});

test("unsafe balances and repository failures return safe unavailable responses", async () => {
  for (const repository of [
    { getBalance: async () => Number.MAX_SAFE_INTEGER + 1 },
    { getBalance: async () => { throw new Error("private SQL detail"); } },
  ]) {
    const handle = createWalletHandler({
      authenticate: async () => ({ id: "p-1", roles: ["participant"] }),
      repository,
    });
    const response = await handle(request("/api/v1/me/balance"));
    assert.equal(response.status, 503);
    assert.equal((await body(response)).error, "ledger_unavailable");
    assert.equal(response.headers.get("cache-control"), "no-store");
  }
});

test("ledger returns a bounded page contract and forwards only verified participant ID", async () => {
  const seen = [];
  const handle = createWalletHandler({
    authenticate: async () => ({ id: "verified-participant", roles: ["participant"] }),
    repository: { listLedger: async (id, options) => {
      seen.push({ id, options });
      return { entries: [{ id: "entry-1", points: 5 }], nextCursor: "Y3Vyc29y" };
    } },
  });
  const response = await handle(request("/api/v1/me/ledger?participant_id=victim&cursor=Y3Vyc29y"));
  assert.equal(response.status, 200);
  assert.deepEqual(await body(response), {
    entries: [{ id: "entry-1", points: 5 }], next_cursor: "Y3Vyc29y",
  });
  assert.deepEqual(seen, [{
    id: "verified-participant", options: { limit: 50, cursor: "Y3Vyc29y" },
  }]);
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("malformed or oversized cursors are rejected before repository access", async () => {
  let calls = 0;
  const handle = createWalletHandler({
    authenticate: async () => ({ id: "p-1", roles: ["participant"] }),
    repository: { listLedger: async () => { calls += 1; return { entries: [], nextCursor: null }; } },
  });
  for (const cursor of ["not a cursor", "x".repeat(513)]) {
    const response = await handle(request(`/api/v1/me/ledger?cursor=${encodeURIComponent(cursor)}`));
    assert.equal(response.status, 400);
    assert.equal((await body(response)).error, "invalid_cursor");
  }
  assert.equal(calls, 0);
});

test("invalid decoded cursor is a client error, not an infrastructure leak", async () => {
  const handle = createWalletHandler({
    authenticate: async () => ({ id: "p-1", roles: ["participant"] }),
    repository: { listLedger: async () => { throw new TypeError("invalid ledger cursor"); } },
  });
  const response = await handle(request("/api/v1/me/ledger?cursor=YWJj"));
  assert.equal(response.status, 400);
  assert.deepEqual(await body(response), { error: "invalid_cursor" });
});

test("admin routes require a server-verified coordinator or admin role", async () => {
  const participant = createWalletHandler({
    authenticate: async () => ({ id: "p-1", roles: ["participant"] }),
  });
  assert.equal((await participant(request("/api/v1/admin/activities"))).status, 403);
  const coordinator = createWalletHandler({
    authenticate: async () => ({ id: "c-1", roles: ["coordinator"] }),
  });
  assert.equal((await coordinator(request("/api/v1/admin/activities"))).status, 501);
});

test("unsupported HTTP methods are rejected", async () => {
  assert.equal((await createWalletHandler()(request("/health", { method: "DELETE" }))).status, 405);
});
