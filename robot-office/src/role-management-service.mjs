/**
 * Server-only role grant lifecycle for the isolated Robot Office prototype.
 *
 * Not routed through the Worker adapter. Callers must provide a trusted
 * principal and an approvalVerifier backed by a server-side, one-time approval
 * workflow. Never accept a client-supplied { approved: true } object.
 */
import { authorizeOfficeAccess } from "./access-policy.mjs";

const ASSIGNABLE_SCOPES = Object.freeze({
  treasury_agent: "workspace:treasury",
  human_treasury: "workspace:treasury",
  legal_agent: "workspace:legal",
  human_legal: "workspace:legal",
  command_agent: "organization:handoff-summaries",
});
const ASSIGNABLE_ROLES = new Set(Object.keys(ASSIGNABLE_SCOPES));
const isText = (value, max = 200) =>
  typeof value === "string" && value.trim().length > 0 && value.length <= max;
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const newId = () => crypto.randomUUID();

function assertPrincipal(principal) {
  if (!principal || principal.authenticated !== true ||
      !isText(principal.subjectId) || !isText(principal.organizationId)) {
    fail(401, "Authentication required");
  }
}

async function loadActiveGrants(db, principal, now) {
  const result = await db.prepare(`
    SELECT id, subject_id, organization_id, role, scope, granted_at, expires_at, revoked_at
    FROM office_role_grants
    WHERE subject_id = ? AND organization_id = ?
      AND granted_at <= ? AND (expires_at IS NULL OR expires_at > ?)
      AND revoked_at IS NULL
  `).bind(principal.subjectId, principal.organizationId, now, now).all();
  return (result.results ?? []).map((row) => ({
    id: row.id, subjectId: row.subject_id, organizationId: row.organization_id,
    role: row.role, scope: row.scope, grantedAt: row.granted_at,
    expiresAt: row.expires_at, revokedAt: row.revoked_at,
  }));
}

function assertAccessAdmin(principal, grants, action, now) {
  const resource = { organizationId: principal.organizationId, kind: "role_grant" };
  const allowed = grants.some((grant) =>
    authorizeOfficeAccess({ principal, grants: [grant], action, resource, now }).allowed
  );
  if (!allowed) fail(403, "Forbidden");
}

function auditInsert(db, { id, principal, action, objectId, requestId, now, detailsRedacted = "" }) {
  return db.prepare(`
    INSERT INTO office_audit_events
      (id, organization_id, actor_id, actor_role, action, object_type,
       object_id, outcome, request_id, occurred_at, details_redacted)
    VALUES (?, ?, ?, 'access_admin', ?, 'role_grant', ?, 'success', ?, ?, ?)
  `).bind(id, principal.organizationId, principal.subjectId, action, objectId, requestId, now, detailsRedacted);
}

/**
 * Assigns only operational roles. Elevated access_admin/auditor roles are
 * intentionally bootstrap-only and cannot be minted through this service.
 * approvalVerifier must validate and consume a one-time human approval token.
 */
export async function grantOfficeRole({
  db, principal, subjectId, role, expiresAt = null, requestId, approvalToken,
  approvalVerifier, now = Date.now(),
}) {
  assertPrincipal(principal);
  if (!isText(subjectId) || !ASSIGNABLE_ROLES.has(role) ||
      (expiresAt !== null && (!Number.isSafeInteger(expiresAt) || expiresAt <= now)) ||
      !isText(requestId) || !isText(approvalToken, 2000) ||
      typeof approvalVerifier !== "function") {
    fail(400, "Invalid role grant input");
  }
  if (subjectId === principal.subjectId) fail(403, "Self-assignment is forbidden");

  const grants = await loadActiveGrants(db, principal, now);
  assertAccessAdmin(principal, grants, "access:grant", now);

  const approval = await approvalVerifier(approvalToken, {
    organizationId: principal.organizationId, subjectId, role, expiresAt, requestId,
  });
  if (!approval || approval.approved !== true ||
      !isText(approval.approvalId) || !isText(approval.approvedBy) ||
      approval.approvedBy === principal.subjectId ||
      approval.organizationId !== principal.organizationId ||
      approval.subjectId !== subjectId || approval.role !== role ||
      !Number.isSafeInteger(approval.expiresAt) || approval.expiresAt <= now) {
    fail(403, "Independent human approval required");
  }

  const id = newId();
  const statements = [
    db.prepare(`
      INSERT INTO office_role_grants
        (id, subject_id, organization_id, role, scope, granted_by, granted_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(id, subjectId, principal.organizationId, role, ASSIGNABLE_SCOPES[role],
      principal.subjectId, now, expiresAt),
    auditInsert(db, {
      id: newId(), principal, action: "access:grant", objectId: id, requestId, now,
      detailsRedacted: `role=${role};scope=${ASSIGNABLE_SCOPES[role]};approved_by=${approval.approvedBy};approval_id=${approval.approvalId}`,
    }),
  ];
  const results = await db.batch(statements);
  if (Number(results?.[0]?.meta?.changes ?? results?.[0]?.changes ?? 0) !== 1 ||
      Number(results?.[1]?.meta?.changes ?? results?.[1]?.changes ?? 0) !== 1) {
    fail(409, "Role grant conflict");
  }
  return { id, subject_id: subjectId, organization_id: principal.organizationId,
    role, scope: ASSIGNABLE_SCOPES[role], granted_by: principal.subjectId,
    granted_at: now, expires_at: expiresAt };
}

function auditRevocationInsert(db, { id, principal, grantId, target, requestId, now }) {
  return db.prepare(`
    INSERT INTO office_audit_events
      (id, organization_id, actor_id, actor_role, action, object_type,
       object_id, outcome, request_id, occurred_at, details_redacted)
    SELECT ?, ?, ?, 'access_admin', 'access:revoke', 'role_grant',
      id, 'success', ?, ?, ?
    FROM office_role_grants
    WHERE id = ? AND organization_id = ? AND revoked_at = ?
      AND subject_id = ? AND role = ?
  `).bind(id, principal.organizationId, principal.subjectId, requestId, now,
    `role=${target.role};subject=${target.subject_id}`,
    grantId, principal.organizationId, now, target.subject_id, target.role);
}

/** Revokes an operational role and appends an immutable audit event atomically. */
export async function revokeOfficeRole({
  db, principal, grantId, requestId, now = Date.now(),
}) {
  assertPrincipal(principal);
  if (!isText(grantId) || !isText(requestId)) fail(400, "Invalid role revocation input");
  const grants = await loadActiveGrants(db, principal, now);
  assertAccessAdmin(principal, grants, "access:revoke", now);

  const found = await db.prepare(`
    SELECT id, subject_id, organization_id, role, revoked_at
    FROM office_role_grants
    WHERE id = ? AND organization_id = ?
    LIMIT 1
  `).bind(grantId, principal.organizationId).all();
  const target = found.results?.[0];
  if (!target || target.revoked_at !== null) fail(404, "Active role grant not found");
  if (!ASSIGNABLE_ROLES.has(target.role)) fail(403, "Protected role cannot be revoked here");
  if (target.subject_id === principal.subjectId) fail(403, "Self-revocation is forbidden");

  const statements = [
    db.prepare(`
      UPDATE office_role_grants SET revoked_at = ?
      WHERE id = ? AND organization_id = ? AND revoked_at IS NULL
        AND role IN ('treasury_agent', 'human_treasury', 'legal_agent', 'human_legal', 'command_agent')
    `).bind(now, grantId, principal.organizationId),
    auditRevocationInsert(db, {
      id: newId(), principal, grantId, target, requestId, now,
    }),
  ];
  const results = await db.batch(statements);
  if (Number(results?.[0]?.meta?.changes ?? results?.[0]?.changes ?? 0) !== 1 ||
      Number(results?.[1]?.meta?.changes ?? results?.[1]?.changes ?? 0) !== 1) {
    fail(409, "Role revocation conflict");
  }
  return { id: grantId, revoked_at: now };
}
