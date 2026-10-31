/**
 * Human-in-the-loop approval workflow for Robot Office role grants.
 * Server-only: not exposed through an HTTP route or production Worker.
 */
import { authorizeOfficeAccess } from "./access-policy.mjs";

const ROLE_SCOPE = Object.freeze({
  treasury_agent: "workspace:treasury",
  human_treasury: "workspace:treasury",
  legal_agent: "workspace:legal",
  human_legal: "workspace:legal",
  command_agent: "organization:handoff-summaries",
});
const ASSIGNABLE = new Set(Object.keys(ROLE_SCOPE));
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const text = (v, max = 200) => typeof v === "string" && v.trim().length > 0 && v.length <= max;
const id = () => crypto.randomUUID();
const bytesToBase64Url = (bytes) => {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
};
function base64UrlToBytes(value) {
  if (!text(value, 128) || !/^[A-Za-z0-9_-]+$/.test(value)) fail(500, "Credential encryption key unavailable");
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(normalized + "=".repeat((4 - normalized.length % 4) % 4));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}
function credentialAad(request) {
  return new TextEncoder().encode(JSON.stringify([
    "robot-office-role-credential-v1", request.organization_id, request.id,
    request.requested_by, request.subject_id, request.role, request.scope,
    request.expires_at, request.grant_expires_at, request.token_expires_at, 1,
  ]));
}
async function encryptApprovalCredential(token, encodedKey, request) {
  const rawKey = base64UrlToBytes(encodedKey);
  if (rawKey.length !== 32) fail(500, "Credential encryption key unavailable");
  const key = await crypto.subtle.importKey("raw", rawKey, {name:"AES-GCM"}, false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    {name:"AES-GCM", iv, additionalData:credentialAad(request), tagLength:128},
    key, new TextEncoder().encode(token));
  return {iv:bytesToBase64Url(iv), ciphertext:bytesToBase64Url(new Uint8Array(ciphertext))};
}
async function decryptApprovalCredential(envelope, encodedKey, request) {
  const rawKey = base64UrlToBytes(encodedKey);
  if (rawKey.length !== 32 || envelope.key_version !== "v1") fail(500, "Credential unavailable");
  const key = await crypto.subtle.importKey("raw", rawKey, {name:"AES-GCM"}, false, ["decrypt"]);
  const plaintext = await crypto.subtle.decrypt(
    {name:"AES-GCM", iv:base64UrlToBytes(envelope.iv),
      additionalData:credentialAad(request), tagLength:128},
    key, base64UrlToBytes(envelope.ciphertext));
  return new TextDecoder().decode(plaintext);
}
async function sha256(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
function assertPrincipal(principal) {
  if (!principal || principal.authenticated !== true || !text(principal.subjectId) || !text(principal.organizationId)) {
    fail(401, "Authentication required");
  }
}
async function activeGrants(db, principal, now) {
  const rows = await db.prepare(`
    SELECT id, subject_id, organization_id, role, scope, granted_at, expires_at, revoked_at
    FROM office_role_grants
    WHERE subject_id = ? AND organization_id = ? AND granted_at <= ?
      AND (expires_at IS NULL OR expires_at > ?) AND revoked_at IS NULL
  `).bind(principal.subjectId, principal.organizationId, now, now).all();
  return (rows.results ?? []).map((r) => ({
    id:r.id, subjectId:r.subject_id, organizationId:r.organization_id, role:r.role,
    scope:r.scope, grantedAt:r.granted_at, expiresAt:r.expires_at, revokedAt:r.revoked_at,
  }));
}
function authorize(principal, grants, action, resource, now) {
  if (!grants.some((grant) => authorizeOfficeAccess({principal, grants:[grant], action, resource, now}).allowed)) {
    fail(403, "Forbidden");
  }
}
function audit(db, {principal, action, objectId, requestId, now, details}) {
  return db.prepare(`
    INSERT INTO office_audit_events
      (id, organization_id, actor_id, actor_role, action, object_type, object_id,
       outcome, request_id, occurred_at, details_redacted)
    VALUES (?, ?, ?, ?, ?, 'role_approval', ?, 'success', ?, ?, ?)
  `).bind(id(), principal.organizationId, principal.subjectId,
    action === "role:request" ? "access_admin" : "human_reviewer",
    action, objectId, requestId, now, details);
}

function auditDecision(db, {principal, approvalRequestId, requestId, decision, now, role, eventId}) {
  return db.prepare(`
    INSERT INTO office_audit_events
      (id, organization_id, actor_id, actor_role, action, object_type, object_id,
       outcome, request_id, occurred_at, details_redacted)
    SELECT ?, ?, ?, 'human_reviewer', 'role:decision', 'role_approval',
      id, 'success', ?, ?, ?
    FROM office_role_approval_requests
    WHERE id = ? AND organization_id = ? AND status = ?
      AND reviewer_id = ? AND decided_at = ? AND decision_event_id = ?
  `).bind(eventId, principal.organizationId, principal.subjectId, requestId, now,
    `decision=${decision};role=${role}`, approvalRequestId,
    principal.organizationId, decision, principal.subjectId, now, eventId);
}

/** Access administrator creates a bounded request; it does not grant a role. */
export async function createRoleGrantApprovalRequest({
  db, principal, subjectId, role, requestId, idempotencyKey, grantExpiresAt = null,
  now = Date.now(), ttlMs = 24 * 60 * 60 * 1000,
}) {
  assertPrincipal(principal);
  if (!text(subjectId) || subjectId === principal.subjectId || !ASSIGNABLE.has(role) ||
      (grantExpiresAt !== null && (!Number.isSafeInteger(grantExpiresAt) || grantExpiresAt <= now)) ||
      !text(requestId) || !text(idempotencyKey) || !Number.isSafeInteger(ttlMs) ||
      ttlMs < 60_000 || ttlMs > 7 * 24 * 60 * 60 * 1000) fail(400, "Invalid approval request");
  const grants = await activeGrants(db, principal, now);
  authorize(principal, grants, "access:grant",
    {organizationId:principal.organizationId, kind:"role_grant"}, now);
  const requestIdDb = id();
  const expiresAt = now + ttlMs;
  const statements = [
    db.prepare(`
      INSERT INTO office_role_approval_requests
        (id, organization_id, requested_by, subject_id, role, scope, status,
         request_id, idempotency_key, created_at, expires_at, grant_expires_at)
      VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?)
    `).bind(requestIdDb, principal.organizationId, principal.subjectId,
      subjectId, role, ROLE_SCOPE[role], requestId, idempotencyKey, now, expiresAt, grantExpiresAt),
    audit(db, {principal, action:"role:request", objectId:requestIdDb,
      requestId, now, details:`role=${role};scope=${ROLE_SCOPE[role]};subject=${subjectId}`}),
  ];
  await db.batch(statements);
  return {id:requestIdDb, organization_id:principal.organizationId, subject_id:subjectId,
    role, scope:ROLE_SCOPE[role], grant_expires_at:grantExpiresAt,
    status:"pending", created_at:now, expires_at:expiresAt};
}

/**
 * A human reviewer decides the request. The bearer credential is encrypted
 * for later retrieval by the original requester; it is never returned here.
 */
export async function decideRoleGrantApproval({
  db, principal, approvalRequestId, decision, reason = "",
  now = Date.now(), tokenTtlMs = 10 * 60 * 1000,
  credentialEncryptionKey, credentialKeyVersion = "v1",
}) {
  assertPrincipal(principal);
  if (!text(approvalRequestId) || !["approved","rejected"].includes(decision) ||
      typeof reason !== "string" || reason.length > 1000 ||
      !Number.isSafeInteger(tokenTtlMs) || tokenTtlMs < 30_000 || tokenTtlMs > 30 * 60 * 1000) {
    fail(400, "Invalid approval decision");
  }
  const found = await db.prepare(`
    SELECT id, organization_id, requested_by, subject_id, role, scope, status, expires_at, grant_expires_at
    FROM office_role_approval_requests
    WHERE id = ? AND organization_id = ? LIMIT 1
  `).bind(approvalRequestId, principal.organizationId).all();
  const request = found.results?.[0];
  if (!request || request.status !== "pending") fail(404, "Pending approval not found");
  if (request.expires_at <= now) fail(409, "Approval request expired");
  if (request.requested_by === principal.subjectId || request.subject_id === principal.subjectId) {
    fail(403, "Independent reviewer required");
  }
  const grants = await activeGrants(db, principal, now);
  const reviewerWorkspaces = request.scope === "workspace:treasury" ? ["treasury"]
    : request.scope === "workspace:legal" ? ["legal"] : ["treasury", "legal"];
  let reviewerAuthorized = false;
  for (const workspace of reviewerWorkspaces) {
    try {
      authorize(principal, grants, "approvals:decide", {
        organizationId:principal.organizationId, workspace, kind:"role_approval",
        requestedBy:request.requested_by, status:"pending",
      }, now);
      reviewerAuthorized = true;
      break;
    } catch (error) {
      if (error?.status !== 403) throw error;
    }
  }
  if (!reviewerAuthorized) fail(403, "Matching independent human reviewer required");

  const decisionEventId = id();
  const token = decision === "approved"
    ? bytesToBase64Url(crypto.getRandomValues(new Uint8Array(32))) : null;
  if (token && (!text(credentialEncryptionKey, 128) || credentialKeyVersion !== "v1")) {
    fail(500, "Credential encryption key unavailable");
  }
  const tokenHash = token ? await sha256(token) : null;
  const tokenExpiresAt = token ? now + tokenTtlMs : null;
  const requestForAad = {...request, id:approvalRequestId, token_expires_at:tokenExpiresAt};
  const envelope = token ? await encryptApprovalCredential(token, credentialEncryptionKey, requestForAad) : null;
  const nextStatus = decision;
  const statements = [
    db.prepare(`
      UPDATE office_role_approval_requests
      SET status = ?, reviewer_id = ?, decided_at = ?, decision_event_id = ?, decision_reason = ?,
          token_hash = ?, token_expires_at = ?
      WHERE id = ? AND organization_id = ? AND status = 'pending' AND expires_at > ?
    `).bind(nextStatus, principal.subjectId, now, decisionEventId, reason.trim(), tokenHash,
      tokenExpiresAt, approvalRequestId, principal.organizationId, now),
    ...(envelope ? [db.prepare(`
      INSERT INTO office_role_approval_credentials
        (approval_request_id, organization_id, iv, ciphertext, key_version, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(approvalRequestId, principal.organizationId, envelope.iv, envelope.ciphertext,
      credentialKeyVersion, now)] : []),
    auditDecision(db, {principal, approvalRequestId, requestId:approvalRequestId,
      decision, now, role:request.role, eventId:decisionEventId}),
  ];
  const results = await db.batch(statements);
  if (Number(results?.[0]?.meta?.changes ?? results?.[0]?.changes ?? 0) !== 1 ||
      (envelope && Number(results?.[1]?.meta?.changes ?? results?.[1]?.changes ?? 0) !== 1) ||
      Number(results?.[envelope ? 2 : 1]?.meta?.changes ?? results?.[envelope ? 2 : 1]?.changes ?? 0) !== 1) {
    fail(409, "Approval decision conflict");
  }
  return {id:approvalRequestId, status:nextStatus, decided_at:now,
    token_expires_at:tokenExpiresAt ?? undefined};
}

/**
 * Delivers the encrypted approval credential only to its original requester.
 * Retrieval is idempotent for the same requester/key for at most 120 seconds.
 * The caller must supply a server-verified principal, never browser claims.
 */
export async function retrieveRoleGrantApprovalCredential({
  db, principal, approvalRequestId, retrievalIdempotencyKey,
  credentialEncryptionKey, now = Date.now(),
}) {
  assertPrincipal(principal);
  if (!text(approvalRequestId) || typeof retrievalIdempotencyKey !== "string" ||
      retrievalIdempotencyKey.length !== 43 || !/^[A-Za-z0-9_-]{43}$/.test(retrievalIdempotencyKey) ||
      !text(credentialEncryptionKey, 128)) {
    fail(400, "Invalid credential retrieval");
  }
  const grants = await activeGrants(db, principal, now);
  authorize(principal, grants, "access:grant",
    {organizationId:principal.organizationId, kind:"role_grant"}, now);
  const found = await db.prepare(`
    SELECT r.id, r.organization_id, r.requested_by, r.subject_id, r.role, r.scope,
      r.status, r.expires_at, r.token_expires_at, r.grant_expires_at,
      c.iv, c.ciphertext, c.key_version, c.retrieval_key_hash, c.recovery_until
    FROM office_role_approval_requests r
    JOIN office_role_approval_credentials c ON c.approval_request_id = r.id
    WHERE r.id = ? AND r.organization_id = ?
      AND NOT EXISTS (
        SELECT 1 FROM office_role_approval_revocations v
        WHERE v.approval_request_id = r.id AND v.organization_id = r.organization_id
      )
    LIMIT 1
  `).bind(approvalRequestId, principal.organizationId).all();
  const request = found.results?.[0];
  if (!request || request.status !== "approved" || request.requested_by !== principal.subjectId ||
      request.expires_at <= now || request.token_expires_at <= now ||
      request.scope !== ROLE_SCOPE[request.role]) {
    fail(403, "Credential unavailable");
  }
  const keyHash = await sha256(retrievalIdempotencyKey);
  if (request.retrieval_key_hash === null) {
    const recoveryUntil = Math.min(request.token_expires_at, now + 120_000);
    const eventId = id();
    const results = await db.batch([
      db.prepare(`
        UPDATE office_role_approval_credentials
        SET retrieval_key_hash = ?, retrieved_at = ?, recovery_until = ?
        WHERE approval_request_id = ? AND organization_id = ?
          AND retrieval_key_hash IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM office_role_approval_revocations v
            WHERE v.approval_request_id = office_role_approval_credentials.approval_request_id
              AND v.organization_id = office_role_approval_credentials.organization_id
          )
      `).bind(keyHash, now, recoveryUntil, approvalRequestId, principal.organizationId),
      db.prepare(`
        INSERT INTO office_audit_events
          (id, organization_id, actor_id, actor_role, action, object_type,
           object_id, outcome, request_id, occurred_at, details_redacted)
        SELECT ?, ?, ?, 'access_admin', 'role:credential_retrieve',
          'role_approval', approval_request_id, 'success', ?, ?, ?
        FROM office_role_approval_credentials
        WHERE approval_request_id = ? AND organization_id = ?
          AND retrieval_key_hash = ? AND retrieved_at = ?
          AND NOT EXISTS (
            SELECT 1 FROM office_role_approval_revocations v
            WHERE v.approval_request_id = office_role_approval_credentials.approval_request_id
              AND v.organization_id = office_role_approval_credentials.organization_id
          )
          AND NOT EXISTS (
            SELECT 1 FROM office_audit_events
            WHERE action = 'role:credential_retrieve'
              AND object_type = 'role_approval' AND object_id = ?
              AND actor_id = ? AND request_id = ?
          )
      `).bind(eventId, principal.organizationId, principal.subjectId,
        approvalRequestId, now, "credential=claimed;recovery_window_seconds=120",
        approvalRequestId, principal.organizationId, keyHash, now,
        approvalRequestId, principal.subjectId, approvalRequestId),
    ]);
    if (Number(results?.[0]?.meta?.changes ?? results?.[0]?.changes ?? 0) !== 1 ||
        Number(results?.[1]?.meta?.changes ?? results?.[1]?.changes ?? 0) !== 1) {
      fail(409, "Credential retrieval conflict");
    }
    request.retrieval_key_hash = keyHash;
    request.recovery_until = recoveryUntil;
  } else if (request.retrieval_key_hash !== keyHash || request.recovery_until <= now) {
    fail(409, "Credential retrieval expired or already claimed");
  }
  try {
    const token = await decryptApprovalCredential(request, credentialEncryptionKey, request);
    return {id:approvalRequestId, token, expires_at:request.token_expires_at,
      recovery_until:request.recovery_until};
  } catch {
    fail(500, "Credential unavailable");
  }
}

/** Revoke an approved, unconsumed credential at the requester's direction. */
export async function revokeRoleGrantApproval({
  db, principal, approvalRequestId, requestId, reason = "", now = Date.now(),
}) {
  assertPrincipal(principal);
  if (!text(approvalRequestId) || !text(requestId) ||
      typeof reason !== "string" || reason.length > 1000) {
    fail(400, "Invalid approval revocation");
  }
  const grants = await activeGrants(db, principal, now);
  authorize(principal, grants, "access:grant",
    {organizationId:principal.organizationId, kind:"role_grant"}, now);

  const found = await db.prepare(`
    SELECT id, organization_id, requested_by, status
    FROM office_role_approval_requests
    WHERE id = ? AND organization_id = ? LIMIT 1
  `).bind(approvalRequestId, principal.organizationId).all();
  const approval = found.results?.[0];
  if (!approval || approval.status !== "approved" || approval.requested_by !== principal.subjectId) {
    fail(409, "Approval cannot be revoked");
  }

  const revokedAt = now;
  const statements = [
    db.prepare(`
      INSERT INTO office_role_approval_revocations
        (approval_request_id, organization_id, revoked_by, revoked_at, request_id, reason)
      SELECT r.id, r.organization_id, ?, ?, ?, ?
      FROM office_role_approval_requests r
      WHERE r.id = ? AND r.organization_id = ? AND r.requested_by = ?
        AND r.status = 'approved'
        AND NOT EXISTS (
          SELECT 1 FROM office_role_approval_revocations v
          WHERE v.approval_request_id = r.id AND v.organization_id = r.organization_id
        )
        AND EXISTS (
          SELECT 1 FROM office_role_approval_credentials c
          WHERE c.approval_request_id = r.id AND c.organization_id = r.organization_id
        )
    `).bind(principal.subjectId, revokedAt, requestId, reason.trim(),
      approvalRequestId, principal.organizationId, principal.subjectId),
    db.prepare(`
      DELETE FROM office_role_approval_credentials
      WHERE approval_request_id = ? AND organization_id = ?
        AND EXISTS (
          SELECT 1 FROM office_role_approval_revocations v
          WHERE v.approval_request_id = office_role_approval_credentials.approval_request_id
            AND v.organization_id = office_role_approval_credentials.organization_id
            AND v.revoked_by = ? AND v.revoked_at = ? AND v.request_id = ?
        )
    `).bind(approvalRequestId, principal.organizationId,
      principal.subjectId, revokedAt, requestId),
  ];
  let results;
  try {
    results = await db.batch(statements);
  } catch (error) {
    if (/UNIQUE constraint failed: office_role_approval_revocations\.approval_request_id/i.test(String(error?.message ?? ""))) {
      fail(409, "Approval already revoked");
    }
    throw error;
  }
  if (Number(results?.[0]?.meta?.changes ?? results?.[0]?.changes ?? 0) !== 1 ||
      Number(results?.[1]?.meta?.changes ?? results?.[1]?.changes ?? 0) !== 1) {
    fail(409, "Approval revocation conflict");
  }
  return {id:approvalRequestId, status:"revoked", revoked_at:revokedAt};
}

/** Hash-only lookup; called by grantOfficeRole and consumed in the same D1 batch as the grant. */
export async function findApprovedRoleGrantToken({db, token, principal, subjectId, role, expiresAt = null, grantId, now = Date.now()}) {
  assertPrincipal(principal);
  if (!text(token, 200) || !text(subjectId) || !ASSIGNABLE.has(role) || !text(grantId)) fail(400, "Invalid approval token");
  const tokenHash = await sha256(token);
  const found = await db.prepare(`
    SELECT id, organization_id, requested_by, subject_id, role, scope, reviewer_id,
           status, expires_at, grant_expires_at, token_expires_at, consumed_at, consumed_grant_id
    FROM office_role_approval_requests
    WHERE token_hash = ? AND organization_id = ? AND subject_id = ? AND role = ?
      AND EXISTS (
        SELECT 1 FROM office_role_approval_credentials c
        WHERE c.approval_request_id = office_role_approval_requests.id
      )
      AND NOT EXISTS (
        SELECT 1 FROM office_role_approval_revocations v
        WHERE v.approval_request_id = office_role_approval_requests.id
          AND v.organization_id = office_role_approval_requests.organization_id
      )
    LIMIT 1
  `).bind(tokenHash, principal.organizationId, subjectId, role).all();
  const approval = found.results?.[0];
  if (!approval || approval.status !== "approved" || approval.consumed_at !== null ||
      approval.expires_at <= now || approval.token_expires_at <= now ||
      approval.requested_by !== principal.subjectId || approval.reviewer_id === principal.subjectId ||
      approval.grant_expires_at !== expiresAt ||
      approval.scope !== ROLE_SCOPE[role]) {
    fail(403, "Valid unconsumed human approval required");
  }
  return {
    approval,
    consumeStatement: db.prepare(`
      UPDATE office_role_approval_requests SET status = 'consumed', consumed_at = ?, consumed_grant_id = ?
      WHERE id = ? AND organization_id = ? AND status = 'approved'
        AND token_hash = ? AND token_expires_at > ? AND expires_at > ? AND consumed_at IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM office_role_approval_revocations v
          WHERE v.approval_request_id = office_role_approval_requests.id
            AND v.organization_id = office_role_approval_requests.organization_id
        )
    `).bind(now, grantId, approval.id, principal.organizationId, tokenHash, now, now),
  };
}
