import test from "node:test";
import assert from "node:assert/strict";
import { handleRobotOfficeRequest } from "../src/worker-adapter.mjs";

const NOW = 1_800_000_000_000;
const ORIGIN = "https://zhakin.example";
const principal = { authenticated: true, subjectId: "user-1", organizationId: "org-1" };
const grant = {
  id: "grant-1", subject_id: "user-1", organization_id: "org-1",
  role: "human_treasury", scope: "workspace", granted_at: NOW - 10,
  expires_at: null, revoked_at: null,
};

function dbStub() {
  const calls = [];
  return {
    calls,
    prepare(sql) {
      return {
        sql, values: [],
        bind(...values) { this.values = values; return this; },
        async all() {
          calls.push({ sql, values: this.values });
          return { results: sql.includes("office_role_grants") ? [grant] : [] };
        },
      };
    },
    async batch(statements) { calls.push({ batch: statements }); return []; },
  };
}

function request(method, body, headers = {}) {
  return new Request("https://zhakin.example/api/robot-office/tasks", {
    method, headers, ...(body === undefined ? {} : { body }),
  });
}
const options = (db, resolvePrincipal = async () => principal) => ({
  env: { ROBOT_OFFICE_DB: db }, resolvePrincipal, allowedOrigins: [ORIGIN], now: NOW,
});

test("GET requires a trusted principal and returns no-store response", async () => {
  const db = dbStub();
  const res = await handleRobotOfficeRequest(request("GET"), options(db));
  assert.equal(res.status, 200);
  assert.match(res.headers.get("cache-control"), /no-store/);
  assert.deepEqual((await res.json()).data, []);
  assert.ok(db.calls.some((call) => call.sql?.includes("office_tasks")));
});

test("POST rejects missing Origin before session resolution", async () => {
  const db = dbStub();
  let resolved = false;
  const res = await handleRobotOfficeRequest(
    request("POST", "{}", { "Content-Type": "application/json" }),
    options(db, async () => { resolved = true; return principal; }),
  );
  assert.equal(res.status, 403);
  assert.equal(resolved, false);
});

test("POST rejects untrusted Origin and browser-supplied identity is not used", async () => {
  const db = dbStub();
  let resolved = false;
  const res = await handleRobotOfficeRequest(
    request("POST", JSON.stringify({ title: "x", subjectId: "attacker", organizationId: "other" }), {
      "Content-Type": "application/json", Origin: "https://evil.example",
    }),
    options(db, async () => { resolved = true; return principal; }),
  );
  assert.equal(res.status, 403);
  assert.equal(resolved, false);
});

test("POST requires JSON and enforces bounded request bodies", async () => {
  const db = dbStub();
  const wrongType = await handleRobotOfficeRequest(
    request("POST", "{}", { Origin: ORIGIN, "Content-Type": "text/plain" }), options(db),
  );
  assert.equal(wrongType.status, 415);
  const tooLarge = await handleRobotOfficeRequest(
    request("POST", "x".repeat(12_001), { Origin: ORIGIN, "Content-Type": "application/json" }), options(db),
  );
  assert.equal(tooLarge.status, 413);
});

test("POST returns sanitized auth failure and does not write", async () => {
  const db = dbStub();
  const res = await handleRobotOfficeRequest(
    request("POST", JSON.stringify({ title: "New task" }), {
      Origin: ORIGIN, "Content-Type": "application/json",
    }),
    options(db, async () => null),
  );
  assert.equal(res.status, 401);
  assert.equal(db.calls.length, 0);
});

test("unknown paths and methods are not routed", async () => {
  const db = dbStub();
  const notFound = await handleRobotOfficeRequest(
    new Request("https://zhakin.example/api/robot-office/admin", { method: "GET" }), options(db),
  );
  assert.equal(notFound.status, 404);
  const method = await handleRobotOfficeRequest(
    request("DELETE"), options(db),
  );
  assert.equal(method.status, 404);
});


test("POST task handoff route dispatches to the controlled handoff service", async () => {
  const db = {
    prepare(sql) {
      return { sql, values: [], bind(...values) { this.values = values; return this; },
        async all() {
          if (sql.includes("office_role_grants")) return { results: [grant] };
          return { results: [{ id: "task-route-1", workspace: "treasury", status: "open", version: 2 }] };
        },
      };
    },
    async batch(statements) { return statements.map(() => ({ meta: { changes: 1 } })); },
  };
  const req = new Request("https://zhakin.example/api/robot-office/tasks/task-route-1/handoff", {
    method: "POST", headers: {
      Origin: ORIGIN, "Content-Type": "application/json",
    }, body: JSON.stringify({
      expectedVersion: 2, summary: "Human review required.", idempotencyKey: "route-handoff-1",
    }),
  });
  const res = await handleRobotOfficeRequest(req, options(db));
  assert.equal(res.status, 201);
  const payload = await res.json();
  assert.equal(payload.data.task_id, "task-route-1");
  assert.equal(payload.data.task_version, 3);
});

test("GET handoff summaries route is restricted to COMMAND AI grants", async () => {
  const commandPrincipal = { authenticated: true, subjectId: "command-1", organizationId: "org-1" };
  const commandGrant = { ...grant, subject_id: "command-1", role: "command_agent", scope: "workspace" };
  let queried = false;
  const db = {
    prepare(sql) {
      return { sql, values: [], bind(...values) { this.values = values; return this; },
        async all() {
          if (sql.includes("office_role_grants")) return { results: [commandGrant] };
          queried = sql.includes("office_handoff_summaries");
          return { results: [{ id: "summary-1", workspace: "treasury", summary: "Minimized only" }] };
        },
      };
    },
  };
  const req = new Request("https://zhakin.example/api/robot-office/handoffs", { method: "GET" });
  const res = await handleRobotOfficeRequest(req, options(db, async () => commandPrincipal));
  assert.equal(res.status, 200);
  assert.equal(queried, true);
  assert.equal((await res.json()).data[0].summary, "Minimized only");
});

test("handoff uniqueness collision returns a sanitized HTTP 409 conflict", async () => {
  const db = {
    prepare(sql) {
      return { sql, bind() { return this; }, async all() {
        return { results: sql.includes("office_role_grants") ? [grant] :
          [{ id: "task-conflict", workspace: "treasury", status: "open", version: 1 }] };
      } };
    },
    async batch() {
      throw new Error("UNIQUE constraint failed: office_handoff_summaries.idempotency_key");
    },
  };
  const req = new Request("https://zhakin.example/api/robot-office/tasks/task-conflict/handoff", {
    method: "POST", headers: { Origin: ORIGIN, "Content-Type": "application/json" },
    body: JSON.stringify({ expectedVersion: 1, summary: "Review.", idempotencyKey: "replayed-key" }),
  });
  const res = await handleRobotOfficeRequest(req, options(db));
  assert.equal(res.status, 409);
  assert.deepEqual(await res.json(), {
    error: "CONFLICT", requestId: res.headers.get("x-request-id"),
  });
});
