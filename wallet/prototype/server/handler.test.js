import test from "node:test";
import assert from "node:assert/strict";
import { createWalletHandler } from "./handler.js";

const request = (path, options = {}) => new Request(`https://wallet.test${path}`, options);
const body = async (response) => response.json();

test("health is public and clearly reports that the scaffold is not ready", async () => {
  const handle = createWalletHandler();
  const response = await handle(request("/health"));
  assert.equal(response.status, 200);
  assert.deepEqual(await body(response), {
    service: "zhakin-wallet-api",
    mode: "scaffold",
    ready: false,
  });
});

test("protected endpoints fail closed when no authentication adapter exists", async () => {
  const handle = createWalletHandler();
  const response = await handle(request("/api/v1/me"));
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

test("participant identity comes from the server-verified principal, not query input", async () => {
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

test("non-safe or malformed repository balances are rejected", async () => {
  const handle = createWalletHandler({
    authenticate: async () => ({ id: "p-1", roles: ["participant"] }),
    repository: { getBalance: async () => Number.MAX_SAFE_INTEGER + 1 },
  });
  const response = await handle(request("/api/v1/me/balance"));
  assert.equal(response.status, 503);
  assert.equal((await body(response)).error, "ledger_unavailable");
});

test("admin routes require server-verified coordinator or admin role", async () => {
  const participant = createWalletHandler({
    authenticate: async () => ({ id: "p-1", roles: ["participant"] }),
  });
  const denied = await participant(request("/api/v1/admin/activities"));
  assert.equal(denied.status, 403);

  const coordinator = createWalletHandler({
    authenticate: async () => ({ id: "c-1", roles: ["coordinator"] }),
  });
  const notImplemented = await coordinator(request("/api/v1/admin/activities"));
  assert.equal(notImplemented.status, 501);
});

test("unsupported HTTP methods are rejected", async () => {
  const handle = createWalletHandler();
  const response = await handle(request("/health", { method: "DELETE" }));
  assert.equal(response.status, 405);
});
