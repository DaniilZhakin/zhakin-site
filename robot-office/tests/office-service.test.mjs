import test from "node:test";
import assert from "node:assert/strict";
import { createOfficeTask, listOfficeTasks } from "../src/office-service.mjs";

const NOW = 1_800_000_000_000;
const principal = { authenticated: true, subjectId: "robot-1", organizationId: "org-a" };
const activeGrant = {
  id: "g1", subject_id: "robot-1", organization_id: "org-a",
  role: "treasury_agent", scope: "workspace", granted_at: NOW - 1000,
  expires_at: null, revoked_at: null,
};

function fakeDb({ grants = [activeGrant], tasks = [] } = {}) {
  const calls = [];
  const db = {
    calls,
    prepare(sql) {
      return {
        sql, values: [],
        bind(...values) { this.values = values; return this; },
        async all() {
          calls.push({ kind: "all", sql, values: this.values });
          return { results: sql.includes("office_role_grants") ? grants : tasks };
        },
      };
    },
    async batch(statements) {
      calls.push({ kind: "batch", statements });
      return statements.map(() => ({ success: true, meta: { changes: 1 } }));
    },
  };
  return db;
}

test("task creation derives tenant, actor, role and workspace from trusted server context", async () => {
  const db = fakeDb();
  const created = await createOfficeTask({
    db, principal, requestId: "req-1", now: NOW,
    input: { title: "Reconcile ledger", organizationId: "attacker-org", owner_role: "human_legal" },
  });
  assert.equal(created.organization_id, "org-a");
  assert.equal(created.created_by, "robot-1");
  assert.equal(created.workspace, "treasury");
  assert.equal(created.owner_role, "treasury_agent");
  assert.equal(db.calls.filter((c) => c.kind === "batch").length, 1);
  assert.equal(db.calls.find((c) => c.kind === "batch").statements.length, 2);
});

test("creation fails closed for missing identity and revoked role", async () => {
  await assert.rejects(() => createOfficeTask({
    db: fakeDb(), principal: null, requestId: "r", input: { title: "x" }, now: NOW,
  }), { status: 401 });
  const revoked = { ...activeGrant, revoked_at: NOW - 1 };
  await assert.rejects(() => createOfficeTask({
    db: fakeDb({ grants: [revoked] }), principal, requestId: "r",
    input: { title: "x" }, now: NOW,
  }), { status: 403 });
});

test("creation rejects malformed input before any write", async () => {
  const db = fakeDb();
  await assert.rejects(() => createOfficeTask({
    db, principal, requestId: "r", input: { title: " " }, now: NOW,
  }), { status: 400 });
  assert.equal(db.calls.some((c) => c.kind === "batch"), false);
});

test("listing is tenant-filtered and workspace-scoped from server grants", async () => {
  const db = fakeDb();
  await listOfficeTasks({ db, principal, now: NOW });
  const query = db.calls.find((c) => c.kind === "all" && c.sql.includes("office_tasks"));
  assert.ok(query);
  assert.equal(query.values[0], "org-a");
  assert.deepEqual(query.values.slice(1), ["treasury"]);
});

test("listing rejects a role from another workspace", async () => {
  const legal = { ...activeGrant, role: "legal_agent" };
  const db = fakeDb({ grants: [legal] });
  // Legal is permitted to list legal tasks, but the query must never include treasury.
  await listOfficeTasks({ db, principal, now: NOW });
  const query = db.calls.find((c) => c.kind === "all" && c.sql.includes("office_tasks"));
  assert.deepEqual(query.values.slice(1), ["legal"]);
});
