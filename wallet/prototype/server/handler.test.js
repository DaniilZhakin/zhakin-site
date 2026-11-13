import test from "node:test";
import assert from "node:assert/strict";
import { createWalletHandler } from "./handler.js";

const request = (path, options = {}) => new Request(`https://wallet.test${path}`, options);
const body = async (response) => response.json();
const grant = (role, scopeType, scopeId, expiresAt = null) => ({
  role, scopeType, scopeId, expiresAt,
});

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

test("unknown paths return 404 without invoking authentication", async () => {
  let authCalls = 0;
  const handle = createWalletHandler({
    authenticate: async () => { authCalls += 1; return { id: "p-1" }; },
  });
  for (const path of [
    "/api/v1/unknown",
    "/api/v1/me/profile",
    "/api/v1/projects",
    "/not-an-api",
  ]) {
    const response = await handle(request(path));
    assert.equal(response.status, 404, path);
    assert.deepEqual(await body(response), { error: "not_found" });
  }
  assert.equal(authCalls, 0);
});

test("unknown API paths do not return a generic not-implemented response", async () => {
  const handle = createWalletHandler({
    authenticate: async () => ({ id: "p-1" }),
  });
  const response = await handle(request("/api/v1/wallet/transfers"));
  assert.equal(response.status, 404);
  assert.notEqual(response.status, 501);
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

test("participant identity response excludes internal role assignments", async () => {
  const handle = createWalletHandler({
    authenticate: async () => ({
      id: "verified-participant",
      roles: ["admin", "coordinator"],
      roleAssignments: [grant("admin", "global", "")],
    }),
  });
  const response = await handle(request("/api/v1/me"));
  assert.equal(response.status, 200);
  assert.deepEqual(await body(response), { id: "verified-participant" });
});

test("self-service endpoints reject mutations with 405", async () => {
  let authCalls = 0;
  const handle = createWalletHandler({
    authenticate: async () => { authCalls += 1; return { id: "p-1" }; },
  });
  for (const path of ["/api/v1/me", "/api/v1/me/balance", "/api/v1/me/ledger"]) {
    const response = await handle(request(path, { method: "POST" }));
    assert.equal(response.status, 405, path);
    assert.deepEqual(await body(response), { error: "method_not_allowed" });
  }
  assert.equal(authCalls, 0);
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

test("admin routes require a global admin grant, not coordinator or browser roles", async () => {
  const participant = createWalletHandler({
    authenticate: async () => ({ id: "p-1", roles: ["admin"], roleAssignments: [] }),
  });
  const deniedParticipant = await participant(request("/api/v1/admin/activities"));
  assert.equal(deniedParticipant.status, 403);

  const coordinator = createWalletHandler({
    authenticate: async () => ({
      id: "c-1",
      roles: ["coordinator"],
      roleAssignments: [grant("coordinator", "global", "")],
    }),
  });
  const deniedCoordinator = await coordinator(request("/api/v1/admin/activities"));
  assert.equal(deniedCoordinator.status, 403);

  const projectCoordinator = createWalletHandler({
    authenticate: async () => ({
      id: "c-2",
      roles: [],
      roleAssignments: [grant("coordinator", "project", "project-A")],
    }),
  });
  const deniedProjectCoordinator = await projectCoordinator(request("/api/v1/admin/activities"));
  assert.equal(deniedProjectCoordinator.status, 403);

  const admin = createWalletHandler({
    authenticate: async () => ({
      id: "a-1",
      roles: ["admin"],
      roleAssignments: [grant("admin", "global", "")],
    }),
  });
  const notImplemented = await admin(request("/api/v1/admin/activities"));
  assert.equal(notImplemented.status, 501);
});

test("expired admin and project coordinator grants are denied at the route boundary", async () => {
  const expiredAdmin = createWalletHandler({
    authenticate: async () => ({
      id: "a-expired",
      roleAssignments: [grant("admin", "global", "", Date.now() - 1)],
    }),
  });
  const adminResponse = await expiredAdmin(request("/api/v1/admin/activities"));
  assert.equal(adminResponse.status, 403);

  const expiredCoordinator = createWalletHandler({
    authenticate: async () => ({
      id: "c-expired",
      roleAssignments: [grant("coordinator", "project", "project-A", Date.now() - 1)],
    }),
    projectRepository: {
      getProjectById: async () => ({ id: "project-A" }),
    },
  });
  const projectResponse = await expiredCoordinator(request("/api/v1/projects/project-A/activities"));
  assert.equal(projectResponse.status, 404);
  assert.deepEqual(await body(projectResponse), { error: "not_found" });
});

test("project coordinator can pass only the matching server-resolved project scope", async () => {
  const lookups = [];
  const handle = createWalletHandler({
    authenticate: async () => ({
      id: "c-1",
      roles: [],
      roleAssignments: [grant("coordinator", "project", "canonical-A")],
    }),
    projectRepository: {
      getProjectById: async (lookupId) => {
        lookups.push(lookupId);
        return { id: lookupId === "alias-A" ? "canonical-A" : "canonical-B" };
      },
    },
  });

  const allowed = await handle(request("/api/v1/projects/alias-A/activities"));
  assert.equal(allowed.status, 501);
  const denied = await handle(request("/api/v1/projects/alias-B/activities"));
  assert.equal(denied.status, 404);
  assert.deepEqual(lookups, ["alias-A", "alias-B"]);
});

test("project routes fail closed when the project resolver is missing or unavailable", async () => {
  const authenticated = async () => ({
    id: "c-1",
    roleAssignments: [grant("coordinator", "project", "project-A")],
  });
  const missingResolver = createWalletHandler({ authenticate: authenticated });
  const unavailableResponse = await missingResolver(request("/api/v1/projects/project-A/activities"));
  assert.equal(unavailableResponse.status, 503);

  const failingResolver = createWalletHandler({
    authenticate: authenticated,
    projectRepository: { getProjectById: async () => { throw new Error("database details"); } },
  });
  const failure = await failingResolver(request("/api/v1/projects/project-A/activities"));
  assert.equal(failure.status, 503);
  assert.deepEqual(await body(failure), { error: "project_lookup_unavailable" });
});

test("project namespace conceals missing projects and denies malformed records", async () => {
  const handle = createWalletHandler({
    authenticate: async () => ({
      id: "c-1",
      roleAssignments: [grant("coordinator", "project", "project-A")],
    }),
    projectRepository: { getProjectById: async () => ({ id: "" }) },
  });
  const response = await handle(request("/api/v1/projects/project-A/activities"));
  assert.equal(response.status, 404);
  assert.deepEqual(await body(response), { error: "not_found" });
});

test("encoded path separators are rejected as invalid project lookup IDs", async () => {
  let lookupCalls = 0;
  const handle = createWalletHandler({
    authenticate: async () => ({
      id: "c-1",
      roleAssignments: [grant("coordinator", "project", "project-A")],
    }),
    projectRepository: {
      getProjectById: async () => { lookupCalls += 1; return { id: "project-A" }; },
    },
  });
  const response = await handle(request("/api/v1/projects/project%2FA/activities"));
  assert.equal(response.status, 400);
  assert.deepEqual(await body(response), { error: "invalid_project_id" });
  assert.equal(lookupCalls, 0);
});

test("ledger endpoint preserves pagination cursor from a persistent repository", async () => {
  const handle = createWalletHandler({
    authenticate: async () => ({ id: "verified-participant", roles: ["participant"] }),
    repository: {
      listLedger: async (participantId, options) => {
        assert.equal(participantId, "verified-participant");
        assert.equal(options.limit, 50);
        assert.equal(options.cursor, "cursor-2");
        return { entries: [{ id: "entry-1", points: 5 }], next_cursor: "cursor-3" };
      },
    },
  });
  const response = await handle(request("/api/v1/me/ledger?cursor=cursor-2"));
  assert.equal(response.status, 200);
  assert.deepEqual(await body(response), {
    entries: [{ id: "entry-1", points: 5 }],
    next_cursor: "cursor-3",
  });
});

test("ledger cursor rejects duplicate, oversized and non-base64url query values", async () => {
  let repositoryCalls = 0;
  const handle = createWalletHandler({
    authenticate: async () => ({ id: "verified-participant" }),
    repository: {
      listLedger: async () => { repositoryCalls += 1; return { entries: [], next_cursor: null }; },
    },
  });
  for (const path of [
    "/api/v1/me/ledger?cursor=abc&cursor=def",
    `/api/v1/me/ledger?cursor=${"a".repeat(513)}`,
    "/api/v1/me/ledger?cursor=%%%not-base64url%%%",
  ]) {
    const response = await handle(request(path));
    assert.equal(response.status, 400, path);
    assert.deepEqual(await body(response), { error: "invalid_cursor" });
  }
  assert.equal(repositoryCalls, 0);
});

test("invalid pagination response fails closed", async () => {
  const handle = createWalletHandler({
    authenticate: async () => ({ id: "verified-participant", roles: ["participant"] }),
    repository: { listLedger: async () => ({ entries: [], next_cursor: 42 }) },
  });
  const response = await handle(request("/api/v1/me/ledger"));
  assert.equal(response.status, 503);
  assert.equal((await body(response)).error, "ledger_unavailable");
});

test("unsupported HTTP methods are rejected", async () => {
  const handle = createWalletHandler();
  const response = await handle(request("/health", { method: "DELETE" }));
  assert.equal(response.status, 405);
});
