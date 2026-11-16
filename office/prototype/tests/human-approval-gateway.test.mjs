import test from "node:test";
import assert from "node:assert/strict";
import { createHumanApprovalGateway } from "../src/human-approval-gateway.mjs";

function makeDb(row) {
  const calls = [];
  return {
    calls,
    prepare(sql) {
      return {
        bind(...args) {
          return {
            sql, args,
            async first() { calls.push({ kind: "first", sql, args }); return row; },
          };
        },
      };
    },
    async batch(statements) {
      calls.push({ kind: "batch", statements });
      return statements.map(() => ({ success: true, meta: { changes: 1 } }));
    },
  };
}
const baseRow = {
  reviewer_user_id: "human-1",
  reviewer_status: "active",
  proposal_id: "proposal-1",
  organization_id: "org-1",
  project_id: "project-1",
  task_id: "task-1",
  expected_task_version: 4,
  proposed_changes_json: '{"title":"Approved title"}',
  proposal_status: "pending",
  current_task_version: 4,
  task_status: "in_progress",
  project_status: "active",
  organization_status: "active",
  has_approval_scope: 1,
};
function gateway(db, row = baseRow) {
  return createHumanApprovalGateway({
    db,
    verifyCredential: async (token) => {
      assert.equal(token, "human-token");
      return { issuer: "https://identity.example", subject: "subject-1" };
    },
    clock: () => new Date("2026-11-16T12:00:00.000Z"),
  });
}

test("gateway requires dedicated OFFICE_DB and trusted verifier", () => {
  assert.throws(() => createHumanApprovalGateway({ db: {}, verifyCredential: () => ({}) }));
  assert.throws(() => createHumanApprovalGateway({ db: makeDb(baseRow), verifyCredential: null }));
});

test("accept uses verified human identity, compare-and-set task update and atomic audit batch", async () => {
  const db = makeDb(baseRow);
  const result = await gateway(db).reviewProposal({
    bearerToken: "human-token", proposalId: "proposal-1", action: "accept",
    comment: "Reviewed and accepted",
  });
  assert.equal(result.status, "accepted");
  assert.equal(result.taskChanged, true);
  const lookup = db.calls.find((call) => call.kind === "first");
  assert.match(lookup.sql, /u\.identity_provider = \?/);
  assert.match(lookup.sql, /office_robot_proposal_approver_scopes/);
  assert.deepEqual(lookup.args.slice(2), ["proposal-1", "https://identity.example", "subject-1"]);
  const batch = db.calls.find((call) => call.kind === "batch");
  assert.equal(batch.statements.length, 4);
  assert.match(batch.statements[0].sql, /UPDATE office_tasks/);
  assert.match(batch.statements[0].sql, /office_tasks\.version = p\.expected_task_version/);
  assert.match(batch.statements[1].sql, /INSERT INTO office_robot_proposal_reviews/);
  assert.match(batch.statements[2].sql, /UPDATE office_robot_task_proposals/);
  assert.match(batch.statements[3].sql, /INSERT INTO office_audit_events/);
  assert.equal(batch.statements[0].args[1], "proposal-1");
});

test("reject records a decision but does not update the task", async () => {
  const db = makeDb(baseRow);
  const result = await gateway(db).reviewProposal({
    bearerToken: "human-token", proposalId: "proposal-1", action: "reject",
  });
  assert.equal(result.status, "rejected");
  assert.equal(result.taskChanged, false);
  const batch = db.calls.find((call) => call.kind === "batch");
  assert.equal(batch.statements.length, 3);
  assert.doesNotMatch(batch.statements[0].sql, /UPDATE office_tasks/);
});

test("stale task version is recorded as stale and never applied", async () => {
  const db = makeDb({ ...baseRow, current_task_version: 5 });
  const result = await gateway(db).reviewProposal({
    bearerToken: "human-token", proposalId: "proposal-1", action: "accept",
  });
  assert.equal(result.status, "stale");
  assert.equal(result.taskChanged, false);
  const batch = db.calls.find((call) => call.kind === "batch");
  assert.equal(batch.statements.length, 3);
  assert.doesNotMatch(batch.statements[0].sql, /UPDATE office_tasks/);
});

test("unverified, inactive or out-of-scope human is denied before writes", async () => {
  const db = makeDb({ ...baseRow, has_approval_scope: 0 });
  await assert.rejects(
    gateway(db).reviewProposal({
      bearerToken: "human-token", proposalId: "proposal-1", action: "accept",
    }),
    (error) => error.status === 403 && error.code === "reviewer_not_authorized",
  );
  assert.equal(db.calls.some((call) => call.kind === "batch"), false);
});

test("caller cannot select another actor or unsupported review action", async () => {
  const db = makeDb(baseRow);
  const api = gateway(db);
  await assert.rejects(
    api.reviewProposal({
      bearerToken: "human-token", proposalId: "proposal-1", action: "approve",
      reviewerUserId: "attacker",
    }),
    (error) => error.code === "invalid_review_action",
  );
  assert.equal(db.calls.length, 0);
});

test("proposal must still be pending", async () => {
  const db = makeDb({ ...baseRow, proposal_status: "accepted" });
  await assert.rejects(
    gateway(db).reviewProposal({
      bearerToken: "human-token", proposalId: "proposal-1", action: "reject",
    }),
    (error) => error.status === 409 && error.code === "proposal_not_pending",
  );
  assert.equal(db.calls.some((call) => call.kind === "batch"), false);
});
