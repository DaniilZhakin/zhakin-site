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
