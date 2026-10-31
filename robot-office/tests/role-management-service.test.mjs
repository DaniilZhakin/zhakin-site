import test from "node:test";
import assert from "node:assert/strict";
import { grantOfficeRole, revokeOfficeRole } from "../src/role-management-service.mjs";

const NOW = 1_800_000_000_000;
const admin = { authenticated: true, subjectId: "admin-1", organizationId: "org-a" };
const adminGrant = {
  id: "admin-grant", subject_id: "admin-1", organization_id: "org-a",
  role: "access_admin", scope: "organization", granted_at: NOW - 1000,
  expires_at: null, revoked_at: null,
};
function fakeDb({ grants = [adminGrant], target = null, approval = {
  id: "approval-1", organization_id: "org-a", requested_by: "admin-1",
  subject_id: "robot-legal", role: "legal_agent", scope: "workspace:legal",
  reviewer_id: "independent-human", status: "approved",
  expires_at: NOW + 60_000, grant_expires_at: null,
  token_expires_at: NOW + 60_000, consumed_at: null,
}, batchChanges = [1, 1, 1] } = {}) {
  const calls = [];
  return {
    calls,
    prepare(sql) {
      return { sql, values: [], bind(...values) { this.values = values; return this; },
        async all() {
          calls.push({ type: "all", sql, values: this.values });
          if (sql.includes("FROM office_role_approval_requests")) return { results: approval ? [approval] : [] };
          if (sql.includes("FROM office_role_grants") && sql.includes("WHERE id = ?")) return { results: target ? [target] : [] };
          if (sql.includes("FROM office_role_grants") && sql.includes("subject_id")) return { results: grants };
          return { results: [] };
        } };
    },
    async batch(statements) {
      calls.push({ type: "batch", statements });
      return statements.map((_, i) => ({ meta: { changes: batchChanges[i] ?? 0 } }));
    },
  };
}
test("grant requires access_admin and independently verified approval", async () => {
  const db = fakeDb();
  const result = await grantOfficeRole({
    db, principal: admin, subjectId: "robot-legal", role: "legal_agent",
    requestId: "req-grant", approvalToken: "opaque-token", now: NOW,
  });
  assert.equal(result.scope, "workspace:legal");
  assert.equal(db.calls.filter((call) => call.type === "batch").length, 1);
  const batch = db.calls.find((call) => call.type === "batch").statements;
  assert.match(batch[0].sql, /UPDATE office_role_approval_requests SET status = 'consumed'/);
  assert.match(batch[1].sql, /INSERT INTO office_role_grants/);
  assert.match(batch[2].sql, /INSERT INTO office_audit_events/);
});

test("grant cannot create a role or success audit when approval consumption loses a race", async () => {
  const db = fakeDb({ batchChanges: [0, 0, 0] });
  await assert.rejects(() => grantOfficeRole({
    db, principal: admin, subjectId: "robot-legal", role: "legal_agent",
    requestId: "req-race", approvalToken: "opaque-token", now: NOW,
  }), { status: 409 });
  const batch = db.calls.find((call) => call.type === "batch").statements;
  assert.match(batch[0].sql, /status = 'consumed'/);
  assert.match(batch[1].sql, /FROM office_role_approval_requests/);
  assert.match(batch[2].sql, /FROM office_role_grants/);
});

test("grant rejects self-assignment, elevated roles, and missing approval token", async () => {
  const db = fakeDb();
  await assert.rejects(() => grantOfficeRole({
    db, principal: admin, subjectId: admin.subjectId, role: "legal_agent",
    requestId: "r1", approvalToken: "token", now: NOW,
  }), { status: 403 });
  await assert.rejects(() => grantOfficeRole({
    db, principal: admin, subjectId: "other", role: "access_admin",
    requestId: "r2", approvalToken: "token", now: NOW,
  }), { status: 400 });
  await assert.rejects(() => grantOfficeRole({
    db, principal: admin, subjectId: "other", role: "legal_agent",
    requestId: "r3", now: NOW,
  }), { status: 400 });
  assert.equal(db.calls.some((call) => call.type === "batch"), false);
});

test("grant rejects approval for a different subject, role, or requester", async () => {
  for (const approval of [
    { id:"a1", organization_id:"org-a", requested_by:"admin-1", subject_id:"other", role:"legal_agent",
      scope:"workspace:legal", reviewer_id:"human-1", status:"approved", expires_at:NOW+60000,
      token_expires_at:NOW+60000, consumed_at:null },
    { id:"a2", organization_id:"org-a", requested_by:"someone-else", subject_id:"robot-legal", role:"legal_agent",
      scope:"workspace:legal", reviewer_id:"human-1", status:"approved", expires_at:NOW+60000,
      token_expires_at:NOW+60000, consumed_at:null },
  ]) {
    const db = fakeDb({ approval });
    await assert.rejects(() => grantOfficeRole({
      db, principal: admin, subjectId: "robot-legal", role: "legal_agent",
      requestId: "req-bad", approvalToken: "token", now: NOW,
    }), { status: 403 });
    assert.equal(db.calls.some((call) => call.type === "batch"), false);
  }
});

test("grant fails closed when actor lacks access_admin", async () => {
  const db = fakeDb({ grants: [] });
  await assert.rejects(() => grantOfficeRole({
    db, principal: admin, subjectId: "robot-legal", role: "legal_agent",
    requestId: "req-no-admin", approvalToken: "token", now: NOW,
  }), { status: 403 });
  assert.equal(db.calls.some((call) => call.type === "batch"), false);
});

test("revocation updates only an active operational grant and appends audit", async () => {
  const db = fakeDb({ target: {
    id: "role-1", subject_id: "robot-legal", organization_id: "org-a",
    role: "legal_agent", revoked_at: null,
  } });
  const result = await revokeOfficeRole({ db, principal: admin, grantId: "role-1", requestId: "req-revoke", now: NOW });
  assert.equal(result.revoked_at, NOW);
  const batch = db.calls.find((call) => call.type === "batch").statements;
  assert.match(batch[0].sql, /UPDATE office_role_grants SET revoked_at/);
  assert.match(batch[1].sql, /INSERT INTO office_audit_events/);
  assert.match(batch[1].sql, /SELECT .*FROM office_role_grants/s);
  assert.match(batch[1].sql, /revoked_at = \\?/);
});

test("revocation cannot target self or protected access roles", async () => {
  for (const target of [
    { id: "self", subject_id: "admin-1", organization_id: "org-a", role: "treasury_agent", revoked_at: null },
    { id: "root", subject_id: "other", organization_id: "org-a", role: "access_admin", revoked_at: null },
  ]) {
    const db = fakeDb({ target });
    await assert.rejects(() => revokeOfficeRole({
      db, principal: admin, grantId: target.id, requestId: "req-denied", now: NOW,
    }), { status: 403 });
    assert.equal(db.calls.some((call) => call.type === "batch"), false);
  }
});

test("revocation fails closed on a concurrent change", async () => {
  const db = fakeDb({
    target: { id: "role-1", subject_id: "robot-legal", organization_id: "org-a", role: "legal_agent", revoked_at: null },
    batchChanges: [0, 0],
  });
  await assert.rejects(() => revokeOfficeRole({
    db, principal: admin, grantId: "role-1", requestId: "req-race", now: NOW,
  }), { status: 409 });
});
