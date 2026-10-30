/**
 * Server-side task service for the isolated Robot Office prototype.
 * The caller MUST supply a principal produced by a trusted session adapter.
 * Never pass browser-provided identity, organization, role, or scope claims.
 * Requires a D1-compatible DB binding; not wired to a deployed Worker.
 */
import { authorizeOfficeAccess } from "./access-policy.mjs";

const TASK_ROLES = new Set(["treasury_agent", "legal_agent", "human_treasury", "human_legal"]);
const WORKSPACE_BY_ROLE = Object.freeze({
  treasury_agent: "treasury",
  human_treasury: "treasury",
  legal_agent: "legal",
  human_legal: "legal",
});
const jsonId = () => crypto.randomUUID();

function validText(value, max) {
  return typeof value === "string" && value.trim().length > 0 && value.length <= max;
}

async function loadGrants(db, principal, now) {
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

function assertPrincipal(principal) {
  if (!principal || principal.authenticated !== true ||
      !validText(principal.subjectId, 200) ||
      !validText(principal.organizationId, 200)) {
    throw Object.assign(new Error("Authentication required"), { status: 401 });
  }
}

function auditStatement({ id, principal, role, action, objectId, requestId, now }) {
  return {
    sql: `INSERT INTO office_audit_events
      (id, organization_id, actor_id, actor_role, action, object_type, object_id, outcome, request_id, occurred_at, details_redacted)
      VALUES (?, ?, ?, ?, ?, 'task', ?, 'success', ?, ?, '')`,
    values: [id, principal.organizationId, principal.subjectId, role, action, objectId, requestId, now],
  };
}

/** List only the caller's currently authorized workspace tasks. */
export async function listOfficeTasks({ db, principal, now = Date.now() }) {
  assertPrincipal(principal);
  const grants = await loadGrants(db, principal, now);
  const roles = grants.filter((g) => TASK_ROLES.has(g.role));
  const permitted = roles.filter((g) => authorizeOfficeAccess({
    principal, grants: [g], action: "tasks:list",
    resource: { organizationId: principal.organizationId, workspace: WORKSPACE_BY_ROLE[g.role], kind: "task" }, now,
  }).allowed);
  const workspaces = [...new Set(permitted.map((g) => WORKSPACE_BY_ROLE[g.role]))];
  if (workspaces.length === 0) throw Object.assign(new Error("Forbidden"), { status: 403 });
  const placeholders = workspaces.map(() => "?").join(", ");
  const result = await db.prepare(`
    SELECT id, workspace, owner_role, status, priority, title, description, created_by, created_at, due_at, version
    FROM office_tasks
    WHERE organization_id = ? AND workspace IN (${placeholders})
    ORDER BY created_at DESC LIMIT 100
  `).bind(principal.organizationId, ...workspaces).all();
  return result.results ?? [];
}

/**
 * Create a task. Workspace and owner role are derived from a live server-side
 * grant; organization and actor are derived exclusively from the trusted principal.
 * Task insert and audit append are one D1 batch.
 */
export async function createOfficeTask({ db, principal, input, requestId, now = Date.now() }) {
  assertPrincipal(principal);
  if (!validText(requestId, 200) || !input || !validText(input.title, 200) ||
      (input.description !== undefined && (typeof input.description !== "string" || input.description.length > 10000)) ||
      !["low", "normal", "high", "urgent"].includes(input.priority ?? "normal")) {
    throw Object.assign(new Error("Invalid task input"), { status: 400 });
  }

  const grants = await loadGrants(db, principal, now);
  const candidates = grants.filter((g) => TASK_ROLES.has(g.role));
  let authorization;
  for (const grant of candidates) {
    const workspace = WORKSPACE_BY_ROLE[grant.role];
    const result = authorizeOfficeAccess({
      principal, grants: [grant], action: "tasks:create",
      resource: { organizationId: principal.organizationId, workspace, kind: "task" }, now,
    });
    if (result.allowed) { authorization = { role: result.role, workspace }; break; }
  }
  if (!authorization) throw Object.assign(new Error("Forbidden"), { status: 403 });

  const id = jsonId();
  const description = input.description ?? "";
  const priority = input.priority ?? "normal";
  const audit = auditStatement({
    id: jsonId(), principal, role: authorization.role, action: "task:create",
    objectId: id, requestId, now,
  });
  const statements = [
    db.prepare(`INSERT INTO office_tasks
      (id, organization_id, workspace, owner_role, status, priority, title, description, created_by, created_at, version)
      VALUES (?, ?, ?, ?, 'open', ?, ?, ?, ?, ?, 1)`)
      .bind(id, principal.organizationId, authorization.workspace, authorization.role,
        priority, input.title.trim(), description, principal.subjectId, now),
    db.prepare(audit.sql).bind(...audit.values),
  ];
  await db.batch(statements);
  return { id, organization_id: principal.organizationId, workspace: authorization.workspace,
    owner_role: authorization.role, status: "open", priority, title: input.title.trim(),
    description, created_by: principal.subjectId, created_at: now, version: 1 };
}


/**
 * Hand a task to the office lead using a minimized summary.
 * Task version update, summary insert and audit append are a single D1 batch.
 * A version conflict or idempotency collision must not create a second handoff.
 */
export async function handoffOfficeTask({
  db, principal, taskId, expectedVersion, summary, idempotencyKey, requestId, now = Date.now(),
}) {
  assertPrincipal(principal);
  if (!validText(taskId, 200) || !Number.isInteger(expectedVersion) || expectedVersion < 1 ||
      !validText(summary, 1000) || !validText(idempotencyKey, 200) ||
      !validText(requestId, 200)) {
    throw Object.assign(new Error("Invalid handoff input"), { status: 400 });
  }

  const grants = await loadGrants(db, principal, now);
  let authorization;
  for (const grant of grants.filter((g) => TASK_ROLES.has(g.role))) {
    const workspace = WORKSPACE_BY_ROLE[grant.role];
    const result = authorizeOfficeAccess({
      principal, grants: [grant], action: "tasks:handoff",
      resource: { organizationId: principal.organizationId, workspace, kind: "task" }, now,
    });
    if (result.allowed) { authorization = { role: result.role, workspace }; break; }
  }
  if (!authorization) throw Object.assign(new Error("Forbidden"), { status: 403 });

  const found = await db.prepare(`
    SELECT id, organization_id, workspace, status, version
    FROM office_tasks
    WHERE id = ? AND organization_id = ? AND workspace = ?
    LIMIT 1
  `).bind(taskId, principal.organizationId, authorization.workspace).all();
  const task = found.results?.[0];
  if (!task) throw Object.assign(new Error("Task not found"), { status: 404 });
  if (task.version !== expectedVersion || !["open", "in_progress", "blocked"].includes(task.status)) {
    throw Object.assign(new Error("Task version conflict"), { status: 409 });
  }

  const nextVersion = expectedVersion + 1;
  const handoffId = jsonId();
  const auditId = jsonId();
  const statements = [
    db.prepare(`
      UPDATE office_tasks
      SET status = 'handed_off', version = version + 1
      WHERE id = ? AND organization_id = ? AND workspace = ?
        AND version = ? AND status IN ('open', 'in_progress', 'blocked')
    `).bind(taskId, principal.organizationId, authorization.workspace, expectedVersion),
    db.prepare(`
      INSERT INTO office_handoff_summaries
        (id, organization_id, task_id, workspace, task_version, summary, created_by, created_at, idempotency_key)
      SELECT ?, organization_id, id, workspace, version, ?, ?, ?, ?
      FROM office_tasks
      WHERE id = ? AND organization_id = ? AND workspace = ?
        AND version = ? AND status = 'handed_off'
    `).bind(handoffId, summary.trim(), principal.subjectId, now, idempotencyKey,
      taskId, principal.organizationId, authorization.workspace, nextVersion),
    db.prepare(`
      INSERT INTO office_audit_events
        (id, organization_id, actor_id, actor_role, action, object_type, object_id,
         outcome, request_id, occurred_at, details_redacted)
      SELECT ?, organization_id, ?, ?, 'task:handoff', 'task', id,
        'success', ?, ?, ''
      FROM office_tasks
      WHERE id = ? AND organization_id = ? AND workspace = ?
        AND version = ? AND status = 'handed_off'
    `).bind(auditId, principal.subjectId, authorization.role, requestId, now,
      taskId, principal.organizationId, authorization.workspace, nextVersion),
  ];

  const results = await db.batch(statements);
  const changed = (index) => Number(results?.[index]?.meta?.changes ?? results?.[index]?.changes ?? 0);
  if (changed(0) !== 1 || changed(1) !== 1 || changed(2) !== 1) {
    throw Object.assign(new Error("Task version conflict"), { status: 409 });
  }
  return {
    id: handoffId, task_id: taskId, organization_id: principal.organizationId,
    workspace: authorization.workspace, task_version: nextVersion,
    summary: summary.trim(), created_by: principal.subjectId, created_at: now,
  };
}

/** COMMAND AI receives only summary rows, never task descriptions or documents. */
export async function listOfficeHandoffSummaries({ db, principal, now = Date.now() }) {
  assertPrincipal(principal);
  const grants = await loadGrants(db, principal, now);
  const commandGrants = grants.filter((grant) => grant.role === "command_agent");
  const workspaces = ["treasury", "legal"].filter((workspace) =>
    commandGrants.some((grant) => authorizeOfficeAccess({
      principal, grants: [grant], action: "tasks:read_summary",
      resource: {
        organizationId: principal.organizationId, workspace,
        kind: "handoff_summary", isHandoffSummary: true,
      }, now,
    }).allowed)
  );
  if (workspaces.length === 0) throw Object.assign(new Error("Forbidden"), { status: 403 });
  const placeholders = workspaces.map(() => "?").join(", ");
  const result = await db.prepare(`
    SELECT id, task_id, workspace, task_version, summary, created_by, created_at
    FROM office_handoff_summaries
    WHERE organization_id = ? AND workspace IN (${placeholders})
    ORDER BY created_at DESC LIMIT 100
  `).bind(principal.organizationId, ...workspaces).all();
  return result.results ?? [];
}
