/**
 * Server-only role grant lifecycle for the isolated Robot Office prototype.
 *
 * Not routed through the Worker adapter. Callers must provide a trusted
 * principal and a server-side, single-use human approval token. The token
 * is consumed atomically with the grant. Never accept client approval claims.
 */
import { authorizeOfficeAccess } from "./access-policy.mjs";
import { findApprovedRoleGrantToken } from "./role-approval-service.mjs";

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
  now = Date.now(),
}) {
  assertPrincipal(principal);
  if (!isText(subjectId) || !ASSIGNABLE_ROLES.has(role) ||
      (expiresAt !== null && (!Number.isSafeInteger(expiresAt) || expiresAt <= now)) ||
      !isText(requestId) || !isText(approvalToken, 200)) {
    fail(400, "Invalid role grant input");
  }
  if (subjectId === principal.subjectId) fail(403, "Self-assignment is forbidden");

  const grants = await loadActiveGrants(db, principal, now);
  assertAccessAdmin(principal, grants, "access:grant", now);

  const id = newId();
  const { approval, consumeStatement } = await findApprovedRoleGrantToken({
    db, token: approvalToken, principal, subjectId, role, expiresAt, grantId: id, now,
  });
  const statements = [
    consumeStatement,
    db.prepare(`
      INSERT INTO office_role_grants
        (id, subject_id, organization_id, role, scope, granted_by, granted_at, expires_at)
      SELECT ?, ?, ?, ?, ?, ?, ?, ?
      FROM office_role_approval_requests
      WHERE id = ? AND organization_id = ? AND status = 'consumed'
        AND consumed_at = ? AND consumed_grant_id = ?
        AND subject_id = ? AND role = ?
        AND scope = ? AND grant_expires_at IS ?
    `).bind(id, subjectId, principal.organizationId, role, ASSIGNABLE_SCOPES[role],
      principal.subjectId, now, expiresAt, approval.id, principal.organizationId,
      now, id, subjectId, role, ASSIGNABLE_SCOPES[role], expiresAt),
    auditGrantInsert(db, {
      id: newId(), principal, grantId: id, role, requestId, now, approval,
    }),
    db.prepare(`
      DELETE FROM office_role_approval_credentials
      WHERE approval_request_id = ? AND organization_id = ?
    `).bind(approval.id, principal.organizationId),
  ];
  const results = await db.batch(statements);
  if (Number(results?.[0]?.meta?.changes ?? results?.[0]?.changes ?? 0) !== 1 ||
      Number(results?.[1]?.meta?.changes ?? results?.[1]?.changes ?? 0) !== 1 ||
      Number(results?.[2]?.meta?.changes ?? results?.[2]?.changes ?? 0) !== 1 ||
      Number(results?.[3]?.meta?.changes ?? results?.[3]?.changes ?? 0) !== 1) {
    fail(409, "Role grant conflict");
  }
  return { id, subject_id: subjectId, organization_id: principal.organizationId,
    role, scope: ASSIGNABLE_SCOPES[role], granted_by: principal.subjectId,
    granted_at: now, expires_at: expiresAt };
}

function auditGrantInsert(db, { id, principal, grantId, role, requestId, now, approval }) {
  return db.prepare(`
    INSERT INTO office_audit_events
      (id, organization_id, actor_id, actor_role, action, object_type,
       object_id, outcome, request_id, occurred_at, details_redacted)
    SELECT ?, ?, ?, 'access_admin', 'access:grant', 'role_grant',
      id, 'success', ?, ?, ?
    FROM office_role_grants
    WHERE id = ? AND organization_id = ? AND subject_id = ?
      AND role = ? AND granted_by = ? AND granted_at = ?
  `).bind(id, principal.organizationId, principal.subjectId, requestId, now,
    `role=${role};scope=${ASSIGNABLE_SCOPES[role]};approved_by=${approval.reviewer_id};approval_id=${approval.id}`,
    grantId, principal.organizationId, approval.subject_id, role, principal.subjectId, now);
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
