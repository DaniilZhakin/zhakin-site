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


test("handoff changes task version and atomically records summary plus audit", async () => {
  const { handoffOfficeTask } = await import("../src/office-service.mjs");
  const calls = [];
  const db = {
    prepare(sql) {
      return { sql, values: [], bind(...values) { this.values = values; return this; },
        async all() {
          calls.push({ sql, values: this.values });
          if (sql.includes("office_role_grants")) return { results: [activeGrant] };
          return { results: [{ id: "task-1", organization_id: "org-a", workspace: "treasury", status: "in_progress", version: 4 }] };
        },
      };
    },
    async batch(statements) {
      calls.push({ batch: statements });
      return statements.map(() => ({ meta: { changes: 1 } }));
    },
  };
  const result = await handoffOfficeTask({
    db, principal, taskId: "task-1", expectedVersion: 4,
    summary: "Reconciliation requires human review.",
    idempotencyKey: "handoff-once-001", requestId: "req-handoff", now: NOW,
  });
  assert.equal(result.task_version, 5);
  assert.equal(result.workspace, "treasury");
  const batch = calls.find((call) => call.batch)?.batch;
  assert.equal(batch.length, 3);
  assert.match(batch[0].sql, /version = version \+ 1/);
  assert.match(batch[1].sql, /INSERT INTO office_handoff_summaries/);
  assert.match(batch[2].sql, /INSERT INTO office_audit_events/);
});

test("handoff fails on stale task version without issuing a write batch", async () => {
  const { handoffOfficeTask } = await import("../src/office-service.mjs");
  const db = {
    writes: 0,
    prepare(sql) {
      return { sql, bind() { return this; }, async all() {
        return { results: sql.includes("office_role_grants") ? [activeGrant] :
          [{ id: "task-1", workspace: "treasury", status: "open", version: 5 }] };
      } };
    },
    async batch() { this.writes += 1; return []; },
  };
  await assert.rejects(() => handoffOfficeTask({
    db, principal, taskId: "task-1", expectedVersion: 4, summary: "Review this.",
    idempotencyKey: "handoff-stale-1", requestId: "req-stale", now: NOW,
  }), { status: 409 });
  assert.equal(db.writes, 0);
});

test("COMMAND AI summary query is restricted to explicitly granted handoff summaries", async () => {
  const { listOfficeHandoffSummaries } = await import("../src/office-service.mjs");
  const commandPrincipal = { authenticated: true, subjectId: "command-1", organizationId: "org-a" };
  const commandGrant = { ...activeGrant, subject_id: "command-1", role: "command_agent", scope: "workspace" };
  let summaryQuery;
  const db = {
    prepare(sql) {
      return { sql, values: [], bind(...values) { this.values = values; return this; },
        async all() {
          if (sql.includes("office_role_grants")) return { results: [commandGrant] };
          summaryQuery = { sql, values: this.values };
          return { results: [{ id: "h1", task_id: "task-1", workspace: "treasury", summary: "Minimized" }] };
        },
      };
    },
  };
  const rows = await listOfficeHandoffSummaries({ db, principal: commandPrincipal, now: NOW });
  assert.equal(rows.length, 1);
  assert.match(summaryQuery.sql, /office_handoff_summaries/);
  assert.doesNotMatch(summaryQuery.sql, /office_tasks/);
  assert.deepEqual(summaryQuery.values, ["org-a", "treasury", "legal"]);
});
