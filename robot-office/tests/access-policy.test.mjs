import test from "node:test";
import assert from "node:assert/strict";
import { authorizeOfficeAccess } from "../src/access-policy.mjs";

const NOW = 1_800_000_000_000;
const principal = (subjectId = "robot-treasury", organizationId = "org-a") => ({
  authenticated: true, subjectId, organizationId,
});
const grant = (role, subjectId = "robot-treasury", overrides = {}) => ({
  id: "grant-1", subjectId, organizationId: "org-a", role,
  scope: "workspace", grantedAt: NOW - 1000, expiresAt: null, revokedAt: null,
  ...overrides,
});
const task = (workspace = "treasury", overrides = {}) => ({
  organizationId: "org-a", workspace, kind: "task", ...overrides,
});

test("deny by default when identity is missing or unverified", () => {
  assert.equal(authorizeOfficeAccess({ principal: null, grants: [], action: "tasks:list", resource: task(), now: NOW }).reason, "AUTHENTICATION_REQUIRED");
  assert.equal(authorizeOfficeAccess({ principal: { ...principal(), authenticated: false }, grants: [], action: "tasks:list", resource: task(), now: NOW }).allowed, false);
});

test("deny cross-organization resource access", () => {
  const result = authorizeOfficeAccess({
    principal: principal(), grants: [grant("treasury_agent")], action: "tasks:read",
    resource: task("treasury", { organizationId: "org-b" }), now: NOW,
  });
  assert.equal(result.reason, "ORGANIZATION_SCOPE_MISMATCH");
});

test("deny revoked and expired grants", () => {
  for (const inactive of [
    grant("treasury_agent", "robot-treasury", { revokedAt: NOW - 1 }),
    grant("treasury_agent", "robot-treasury", { expiresAt: NOW - 1 }),
    grant("treasury_agent", "robot-treasury", { grantedAt: NOW + 1 }),
  ]) {
    assert.equal(authorizeOfficeAccess({
      principal: principal(), grants: [inactive], action: "tasks:list", resource: task(), now: NOW,
    }).allowed, false);
  }
});

test("treasury role cannot enter legal workspace", () => {
  assert.equal(authorizeOfficeAccess({
    principal: principal(), grants: [grant("treasury_agent")], action: "tasks:list",
    resource: task("legal"), now: NOW,
  }).allowed, false);
});

test("restricted document requires explicit restricted scope", () => {
  const resource = task("treasury", { kind: "document", classification: "restricted" });
  assert.equal(authorizeOfficeAccess({
    principal: principal(), grants: [grant("human_treasury")],
    action: "documents:content:read", resource, now: NOW,
  }).allowed, false);
  assert.equal(authorizeOfficeAccess({
    principal: principal(), grants: [grant("human_treasury", "robot-treasury", { scope: "workspace:treasury:restricted" })],
    action: "documents:content:read", resource, now: NOW,
  }).allowed, true);
});

test("robots can request approval but cannot decide it", () => {
  const resource = task("treasury", { requestedBy: "robot-treasury", status: "pending" });
  assert.equal(authorizeOfficeAccess({
    principal: principal(), grants: [grant("treasury_agent")],
    action: "approvals:request", resource, now: NOW,
  }).allowed, true);
  assert.equal(authorizeOfficeAccess({
    principal: principal(), grants: [grant("treasury_agent")],
    action: "approvals:decide", resource, now: NOW,
  }).allowed, false);
});

test("human reviewer cannot approve own request or non-pending item", () => {
  const self = task("treasury", { requestedBy: "human-1", status: "pending" });
  assert.equal(authorizeOfficeAccess({
    principal: principal("human-1"), grants: [grant("human_treasury", "human-1")],
    action: "approvals:decide", resource: self, now: NOW,
  }).allowed, false);
  assert.equal(authorizeOfficeAccess({
    principal: principal("reviewer-1"), grants: [grant("human_treasury", "reviewer-1")],
    action: "approvals:decide", resource: { ...self, requestedBy: "requester", status: "approved" }, now: NOW,
  }).allowed, false);
});

test("command agent sees handoff summaries only, never original documents", () => {
  const cmd = grant("command_agent", "command-1", { scope: "organization:handoff-summaries" });
  assert.equal(authorizeOfficeAccess({
    principal: principal("command-1"), grants: [cmd], action: "tasks:read_summary",
    resource: { organizationId: "org-a", workspace: "legal", kind: "handoff_summary", isHandoffSummary: true }, now: NOW,
  }).allowed, true);
  assert.equal(authorizeOfficeAccess({
    principal: principal("command-1"), grants: [cmd], action: "documents:content:read",
    resource: { organizationId: "org-a", workspace: "legal", kind: "document" }, now: NOW,
  }).allowed, false);
});

test("access administrator can manage grants but cannot read financial content", () => {
  const admin = grant("access_admin", "admin-1", { scope: "organization" });
  assert.equal(authorizeOfficeAccess({
    principal: principal("admin-1"), grants: [admin], action: "access:revoke",
    resource: { organizationId: "org-a", kind: "role_grant" }, now: NOW,
  }).allowed, true);
  assert.equal(authorizeOfficeAccess({
    principal: principal("admin-1"), grants: [admin], action: "documents:content:read",
    resource: task("treasury", { kind: "document" }), now: NOW,
  }).allowed, false);
});



test("legal role cannot enter treasury workspace and treasury cannot enter legal", () => {
  for (const [role, ownWorkspace, foreignWorkspace, subject] of [
    ["treasury_agent", "treasury", "legal", "robot-treasury"],
    ["legal_agent", "legal", "treasury", "robot-legal"],
  ]) {
    const ownGrant = grant(role, subject);
    assert.equal(authorizeOfficeAccess({
      principal: principal(subject), grants: [ownGrant], action: "tasks:list",
      resource: task(ownWorkspace), now: NOW,
    }).allowed, true);
    assert.equal(authorizeOfficeAccess({
      principal: principal(subject), grants: [ownGrant], action: "tasks:list",
      resource: task(foreignWorkspace), now: NOW,
    }).allowed, false);
  }
});

test("COMMAND AI cannot list source tasks or read source documents", () => {
  const command = grant("command_agent", "command-1", { scope: "organization:handoff-summaries" });
  for (const resource of [
    task("treasury"),
    task("legal", { kind: "document", classification: "internal" }),
  ]) {
    assert.equal(authorizeOfficeAccess({
      principal: principal("command-1"), grants: [command],
      action: resource.kind === "document" ? "documents:content:read" : "tasks:list",
      resource, now: NOW,
    }).allowed, false);
  }
});

test("human reviewers may decide another person's pending request only in their workspace", () => {
  const pendingTreasury = task("treasury", { requestedBy: "requester-1", status: "pending" });
  assert.equal(authorizeOfficeAccess({
    principal: principal("reviewer-1"),
    grants: [grant("human_treasury", "reviewer-1")],
    action: "approvals:decide", resource: pendingTreasury, now: NOW,
  }).allowed, true);
  assert.equal(authorizeOfficeAccess({
    principal: principal("reviewer-1"),
    grants: [grant("human_treasury", "reviewer-1")],
    action: "approvals:decide",
    resource: { ...pendingTreasury, workspace: "legal" }, now: NOW,
  }).allowed, false);
});

test("access administrator and auditor cannot acquire specialist workspace powers", () => {
  const admin = grant("access_admin", "admin-1", { scope: "organization" });
  const auditor = grant("auditor", "auditor-1", { scope: "organization:audit" });
  for (const [subject, accessGrant] of [["admin-1", admin], ["auditor-1", auditor]]) {
    assert.equal(authorizeOfficeAccess({
      principal: principal(subject), grants: [accessGrant], action: "tasks:create",
      resource: task("treasury"), now: NOW,
    }).allowed, false);
    assert.equal(authorizeOfficeAccess({
      principal: principal(subject), grants: [accessGrant], action: "documents:content:read",
      resource: task("legal", { kind: "document" }), now: NOW,
    }).allowed, false);
  }
});

test("auditor can read audit records but not tasks", () => {
  const auditor = grant("auditor", "auditor-1", { scope: "organization:audit" });
  assert.equal(authorizeOfficeAccess({
    principal: principal("auditor-1"), grants: [auditor], action: "audit:read",
    resource: { organizationId: "org-a", kind: "audit" }, now: NOW,
  }).allowed, true);
  assert.equal(authorizeOfficeAccess({
    principal: principal("auditor-1"), grants: [auditor], action: "tasks:list",
    resource: task(), now: NOW,
  }).allowed, false);
});


test("all specialist roles deny direct money movement, legal execution, and privilege escalation", () => {
  const deniedActions = [
    "payments:execute",
    "transfers:submit",
    "banking:authorize",
    "ledger:post",
    "wallet:withdraw",
    "contracts:sign",
    "legal:submit",
    "legal:represent",
    "documents:content:delete",
    "access:grant",
    "access:revoke",
  ];
  const principalsAndGrants = [
    ["robot-treasury", grant("treasury_agent", "robot-treasury")],
    ["human-treasury", grant("human_treasury", "human-treasury")],
    ["robot-legal", grant("legal_agent", "robot-legal")],
    ["human-legal", grant("human_legal", "human-legal")],
    ["admin-1", grant("access_admin", "admin-1", { scope: "organization" })],
    ["auditor-1", grant("auditor", "auditor-1", { scope: "organization:audit" })],
    ["command-1", grant("command_agent", "command-1", { scope: "organization:handoff-summaries" })],
  ];
  for (const [subjectId, roleGrant] of principalsAndGrants) {
    for (const action of deniedActions) {
      const result = authorizeOfficeAccess({
        principal: principal(subjectId), grants: [roleGrant], action,
        resource: { organizationId: "org-a", kind: "role_grant", workspace: "treasury" },
        now: NOW,
      });
      assert.equal(result.allowed, false, `${roleGrant.role} must not perform ${action}`);
    }
  }
});
