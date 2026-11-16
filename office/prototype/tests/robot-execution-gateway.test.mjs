import test from "node:test";
import assert from "node:assert/strict";
import { createRobotExecutionGateway } from "../src/robot-execution-gateway.mjs";

function makeDb(row = null) {
  const calls = [];
  return {
    calls,
    prepare(sql) {
      return {
        bind(...args) {
          return {
            sql,
            args,
            async first() { calls.push({ kind: "first", sql, args }); return row; },
            async run() { calls.push({ kind: "run", sql, args }); return { success: true }; },
          };
        },
      };
    },
    async batch(statements) {
      calls.push({ kind: "batch", statements });
      return statements.map(() => ({ success: true }));
    },
  };
}

const validRow = {
  service_principal_id: "robot-1",
  organization_id: "org-1",
  project_id: "project-1",
  task_id: "task-1",
  task_title: "Review",
  task_description: "Read assigned work",
  task_acceptance_criteria: null,
  task_status: "in_progress",
  task_version: 4,
};

test("gateway requires a dedicated D1 binding and trusted verifier", () => {
  assert.throws(() => createRobotExecutionGateway({ db: {}, verifyCredential: () => ({}) }));
  assert.throws(() => createRobotExecutionGateway({ db: makeDb(), verifyCredential: null }));
});

test("read returns minimized assigned task context", async () => {
  const db = makeDb(validRow);
  const gateway = createRobotExecutionGateway({
    db,
    verifyCredential: async (token) => {
      assert.equal(token, "verified-token");
      return { issuer: "https://issuer.example", subject: "robot-subject" };
    },
  });
  const result = await gateway.readAssignedTask({ bearerToken: "verified-token", taskId: "task-1" });
  assert.deepEqual(result, {
    id: "task-1", title: "Review", description: "Read assigned work",
    acceptanceCriteria: null, status: "in_progress", version: 4,
  });
  assert.equal(Object.hasOwn(result, "service_principal_id"), false);
  assert.ok(db.calls[0].sql.includes("sp.identity_issuer = ?"));
  assert.ok(db.calls[0].sql.includes("cs.task_id = ?"));
  assert.equal(db.calls.filter((call) => call.kind === "run").length, 1);
  assert.match(db.calls.find((call) => call.kind === "run").sql, /INSERT INTO office_robot_audit_events/);
});

test("unknown or out-of-scope robot is denied", async () => {
  const gateway = createRobotExecutionGateway({
    db: makeDb(null),
    verifyCredential: async () => ({ issuer: "issuer", subject: "unknown" }),
  });
  await assert.rejects(
    gateway.readAssignedTask({ bearerToken: "token", taskId: "other-task" }),
    (error) => error.status === 403 && error.code === "principal_scope_or_task_not_authorized",
  );
});

test("caller-supplied capability cannot override the server allowlist", async () => {
  const db = makeDb(validRow);
  const gateway = createRobotExecutionGateway({
    db, verifyCredential: async () => ({ issuer: "issuer", subject: "robot" }),
  });
  await gateway.readAssignedTask({
    bearerToken: "token", taskId: "task-1", capability: "office.admin",
  });
  assert.equal(db.calls[0].args[4], "office.task.read_assigned");
});

test("proposal is pending human review and never updates office_tasks", async () => {
  const db = makeDb(validRow);
  const gateway = createRobotExecutionGateway({
    db, verifyCredential: async () => ({ issuer: "issuer", subject: "robot" }),
    clock: () => new Date("2026-11-16T12:00:00.000Z"),
  });
  const result = await gateway.submitTaskProposal({
    bearerToken: "token", taskId: "task-1", expectedVersion: 4,
    idempotencyKey: "request-once", changes: { title: "Suggested title" },
  });
  assert.equal(result.status, "pending_human_review");
  const batch = db.calls.find((call) => call.kind === "batch");
  assert.equal(batch.statements.length, 2);
  assert.match(batch.statements[0].sql, /INSERT INTO office_robot_task_proposals/);
  assert.match(batch.statements[1].sql, /INSERT INTO office_robot_audit_events/);
  assert.doesNotMatch(batch.statements[0].sql, /UPDATE office_tasks/);
});

test("stale version and forbidden fields are rejected before write", async () => {
  const db = makeDb(validRow);
  const gateway = createRobotExecutionGateway({
    db, verifyCredential: async () => ({ issuer: "issuer", subject: "robot" }),
  });
  await assert.rejects(
    gateway.submitTaskProposal({
      bearerToken: "token", taskId: "task-1", expectedVersion: 3,
      idempotencyKey: "stale", changes: { title: "No" },
    }),
    (error) => error.code === "stale_task_version",
  );
  await assert.rejects(
    gateway.submitTaskProposal({
      bearerToken: "token", taskId: "task-1", expectedVersion: 4,
      idempotencyKey: "forbidden", changes: { status: "done" },
    }),
    (error) => error.code === "proposal_field_not_allowed",
  );
  assert.equal(db.calls.filter((call) => call.kind === "batch").length, 0);
});
