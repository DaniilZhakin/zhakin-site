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
function fakeDb({ grants = [adminGrant], target = null, batchChanges = [1, 1] } = {}) {
  const calls = [];
  return {
    calls,
    prepare(sql) {
      return { sql, values: [], bind(...values) { this.values = values; return this; },
        async all() {
          calls.push({ type: "all", sql, values: this.values });
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
const approved = async (_token, context) => ({
  approved: true, approvalId: "approval-1", approvedBy: "independent-human",
  organizationId: context.organizationId, subjectId: context.subjectId,
  role: context.role, expiresAt: NOW + 60_000,
});

test("grant requires access_admin and independently verified approval", async () => {
  const db = fakeDb();
  const result = await grantOfficeRole({
    db, principal: admin, subjectId: "robot-legal", role: "legal_agent",
    requestId: "req-grant", approvalToken: "opaque-token", approvalVerifier: approved, now: NOW,
  });
  assert.equal(result.scope, "workspace:legal");
  assert.equal(db.calls.filter((call) => call.type === "batch").length, 1);
  const batch = db.calls.find((call) => call.type === "batch").statements;
  assert.match(batch[0].sql, /INSERT INTO office_role_grants/);
  assert.match(batch[1].sql, /INSERT INTO office_audit_events/);
});

test("grant rejects self-assignment, elevated roles, and missing approval verifier", async () => {
  const db = fakeDb();
  await assert.rejects(() => grantOfficeRole({
    db, principal: admin, subjectId: admin.subjectId, role: "legal_agent",
    requestId: "r1", approvalToken: "token", approvalVerifier: approved, now: NOW,
  }), { status: 403 });
  await assert.rejects(() => grantOfficeRole({
    db, principal: admin, subjectId: "other", role: "access_admin",
    requestId: "r2", approvalToken: "token", approvalVerifier: approved, now: NOW,
  }), { status: 400 });
  await assert.rejects(() => grantOfficeRole({
    db, principal: admin, subjectId: "other", role: "legal_agent",
    requestId: "r3", approvalToken: "token", now: NOW,
  }), { status: 400 });
  assert.equal(db.calls.some((call) => call.type === "batch"), false);
});

test("grant rejects approval for a different subject, role, organization, or grantor", async () => {
  const db = fakeDb();
  const badVerifier = async () => ({
    approved: true, approvalId: "approval-2", approvedBy: admin.subjectId,
    organizationId: "org-a", subjectId: "someone-else", role: "treasury_agent",
    expiresAt: NOW + 60_000,
  });
  await assert.rejects(() => grantOfficeRole({
    db, principal: admin, subjectId: "robot-legal", role: "legal_agent",
    requestId: "req-bad", approvalToken: "token", approvalVerifier: badVerifier, now: NOW,
  }), { status: 403 });
  assert.equal(db.calls.some((call) => call.type === "batch"), false);
});

test("grant rejects expired or unbounded human approval attestations", async () => {
  for (const expiresAt of [undefined, NOW]) {
    const db = fakeDb();
    const verifier = async (_token, context) => ({
      approved: true, approvalId: "approval-expired", approvedBy: "independent-human",
      organizationId: context.organizationId, subjectId: context.subjectId,
      role: context.role, expiresAt,
    });
    await assert.rejects(() => grantOfficeRole({
      db, principal: admin, subjectId: "robot-legal", role: "legal_agent",
      requestId: "req-expired", approvalToken: "token", approvalVerifier: verifier, now: NOW,
    }), { status: 403 });
    assert.equal(db.calls.some((call) => call.type === "batch"), false);
  }
});

test("grant fails closed when actor lacks access_admin", async () => {
  const db = fakeDb({ grants: [] });
  await assert.rejects(() => grantOfficeRole({
    db, principal: admin, subjectId: "robot-legal", role: "legal_agent",
    requestId: "req-no-admin", approvalToken: "token", approvalVerifier: approved, now: NOW,
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
