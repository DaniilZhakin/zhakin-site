import test from "node:test";
import assert from "node:assert/strict";
import {
  hasWalletGlobalAdminAccess,
  hasWalletProjectAccess,
} from "./wallet-project-authorization.js";

const NOW = 1_800_000_000_000;

const grant = (role, scopeType, scopeId, expiresAt = null) => ({
  role, scopeType, scopeId, expiresAt,
});

test("global admin grant authorizes projects and global admin checks", () => {
  const principal = { roleAssignments: [grant("admin", "global", "")] };
  assert.equal(hasWalletGlobalAdminAccess(principal, NOW), true);
  assert.equal(hasWalletProjectAccess(principal, "project-A", NOW), true);
});

test("project coordinator grant authorizes only its exact project", () => {
  const principal = { roleAssignments: [grant("coordinator", "project", "project-A")] };
  assert.equal(hasWalletProjectAccess(principal, "project-A", NOW), true);
  assert.equal(hasWalletProjectAccess(principal, "project-B", NOW), false);
  assert.equal(hasWalletGlobalAdminAccess(principal, NOW), false);
});

test("global coordinator grant authorizes project work but not admin access", () => {
  const principal = { roleAssignments: [grant("coordinator", "global", "")] };
  assert.equal(hasWalletProjectAccess(principal, "project-A", NOW), true);
  assert.equal(hasWalletGlobalAdminAccess(principal, NOW), false);
});

test("browser-facing roles array is never treated as an authorization grant", () => {
  const principal = { roles: ["admin", "coordinator"], roleAssignments: [] };
  assert.equal(hasWalletGlobalAdminAccess(principal, NOW), false);
  assert.equal(hasWalletProjectAccess(principal, "project-A", NOW), false);
});

test("expired grants do not authorize", () => {
  const principal = {
    roleAssignments: [
      grant("admin", "global", "", NOW),
      grant("coordinator", "project", "project-A", NOW - 1),
    ],
  };
  assert.equal(hasWalletGlobalAdminAccess(principal, NOW), false);
  assert.equal(hasWalletProjectAccess(principal, "project-A", NOW), false);
});

test("malformed scope combinations fail closed", () => {
  const principal = {
    roleAssignments: [
      grant("admin", "project", "project-A"),
      grant("coordinator", "global", "project-A"),
      grant("coordinator", "project", ""),
      grant("coordinator", "unknown", "project-A"),
      grant("unexpected", "global", ""),
    ],
  };
  assert.equal(hasWalletGlobalAdminAccess(principal, NOW), false);
  assert.equal(hasWalletProjectAccess(principal, "project-A", NOW), false);
});

test("invalid principal, project IDs and timestamps fail closed", () => {
  assert.equal(hasWalletProjectAccess(null, "project-A", NOW), false);
  assert.equal(hasWalletProjectAccess({ roleAssignments: {} }, "project-A", NOW), false);
  assert.equal(hasWalletProjectAccess({ roleAssignments: [grant("coordinator", "global", "")] }, "", NOW), false);
  assert.equal(hasWalletProjectAccess({ roleAssignments: [grant("coordinator", "global", "")] }, " project-A", NOW), false);
  assert.equal(hasWalletProjectAccess({ roleAssignments: [grant("coordinator", "global", "")] }, "project-A", -1), false);
});
