/**
 * ZHAKIN TEAM OFFICE — Robot Execution Gateway (D1 adapter).
 *
 * Security boundary:
 * - verifyCredential MUST be a trusted verifier (OIDC/JWT signature, issuer,
 *   audience, expiry and revocation checks). Never pass decoded JWT claims here.
 * - This module never accepts actor/organization/project scope from the caller.
 * - Robot writes create human-review proposals; they never mutate office_tasks.
 * - D1 batch keeps proposal + audit insertion in one atomic batch.
 */
const CAP_READ = "office.task.read_assigned";
const CAP_PROPOSE = "office.task.propose_update";
const MAX_PROPOSAL_BYTES = 16 * 1024;
const ALLOWED_PROPOSAL_FIELDS = new Set(["title", "description", "acceptance_criteria"]);

function deny(code) {
  const error = new Error("Robot request denied");
  error.code = code;
  error.status = 403;
  return error;
}

function requireText(value, code) {
  if (typeof value !== "string" || !value.trim()) throw deny(code);
  return value.trim();
}

function validateChanges(changes) {
  if (!changes || typeof changes !== "object" || Array.isArray(changes)) {
    throw deny("invalid_proposal");
  }
  const keys = Object.keys(changes);
  if (!keys.length || keys.some((key) => !ALLOWED_PROPOSAL_FIELDS.has(key))) {
    throw deny("proposal_field_not_allowed");
  }
  for (const value of Object.values(changes)) {
    if (value !== null && typeof value !== "string") throw deny("invalid_proposal_value");
    if (typeof value === "string" && value.length > 8000) throw deny("proposal_value_too_large");
  }
  const serialized = JSON.stringify(changes);
  if (new TextEncoder().encode(serialized).byteLength > MAX_PROPOSAL_BYTES) {
    throw deny("proposal_too_large");
  }
  return serialized;
}

function createId() {
  return crypto.randomUUID();
}

export function createRobotExecutionGateway({ db, verifyCredential, clock = () => new Date() }) {
  if (!db || typeof db.prepare !== "function" || typeof db.batch !== "function") {
    throw new TypeError("A dedicated OFFICE_DB D1 binding is required");
  }
  if (typeof verifyCredential !== "function") {
    throw new TypeError("A trusted credential verifier is required");
  }

  async function resolveAuthorizedTask({ bearerToken, taskId, capability }) {
    const token = requireText(bearerToken, "missing_credential");
    const task = requireText(taskId, "missing_task_id");
    if (![CAP_READ, CAP_PROPOSE].includes(capability)) throw deny("capability_not_allowlisted");

    // The verifier must validate signature, issuer, audience, exp/nbf and
    // revocation. Only its verified issuer+subject are used for identity lookup.
    const identity = await verifyCredential(token);
    const issuer = requireText(identity?.issuer, "invalid_verified_identity");
    const subject = requireText(identity?.subject, "invalid_verified_identity");
    const now = clock().toISOString();

    const row = await db.prepare(`
      SELECT
        sp.id AS service_principal_id,
        sp.organization_id,
        sp.status AS principal_status,
        sp.valid_from AS principal_valid_from,
        sp.valid_until AS principal_valid_until,
        cs.id AS capability_scope_id,
        cs.project_id,
        cs.task_id,
        cs.valid_from AS scope_valid_from,
        cs.valid_until AS scope_valid_until,
        cs.revoked_at AS scope_revoked_at,
        t.id AS task_id,
        t.title AS task_title,
        t.description AS task_description,
        t.acceptance_criteria AS task_acceptance_criteria,
        t.status AS task_status,
        t.version AS task_version,
        p.status AS project_status,
        o.status AS organization_status
      FROM office_service_principals sp
      JOIN office_service_capability_scopes cs
        ON cs.service_principal_id = sp.id
       AND cs.organization_id = sp.organization_id
      JOIN office_tasks t
        ON t.id = cs.task_id
       AND t.organization_id = cs.organization_id
       AND t.project_id = cs.project_id
      JOIN office_projects p
        ON p.id = t.project_id AND p.organization_id = t.organization_id
      JOIN office_organizations o ON o.id = t.organization_id
      WHERE sp.identity_issuer = ?
        AND sp.identity_subject = ?
        AND sp.status = 'active'
        AND sp.valid_from <= ?
        AND (sp.valid_until IS NULL OR sp.valid_until > ?)
        AND cs.capability_code = ?
        AND cs.task_id = ?
        AND cs.revoked_at IS NULL
        AND cs.valid_from <= ?
        AND (cs.valid_until IS NULL OR cs.valid_until > ?)
        AND t.status NOT IN ('done', 'cancelled')
        AND p.status = 'active'
        AND o.status = 'active'
      LIMIT 1
    `).bind(issuer, subject, now, now, capability, task, now, now).first();

    if (!row) throw deny("principal_scope_or_task_not_authorized");
    return row;
  }

  return Object.freeze({
    async readAssignedTask({ bearerToken, taskId }) {
      const row = await resolveAuthorizedTask({
        bearerToken, taskId, capability: CAP_READ,
      });
      // Return only task fields needed for work. Never expose principal,
      // credential, grant, storage or cross-tenant metadata.
      return Object.freeze({
        id: row.task_id,
        title: row.task_title,
        description: row.task_description,
        acceptanceCriteria: row.task_acceptance_criteria,
        status: row.task_status,
        version: row.task_version,
      });
    },

    async submitTaskProposal({ bearerToken, taskId, expectedVersion, idempotencyKey, changes }) {
      const row = await resolveAuthorizedTask({
        bearerToken, taskId, capability: CAP_PROPOSE,
      });
      if (!Number.isInteger(expectedVersion) || expectedVersion !== row.task_version) {
        throw deny("stale_task_version");
      }
      const key = requireText(idempotencyKey, "missing_idempotency_key");
      if (key.length > 180) throw deny("invalid_idempotency_key");
      const serialized = validateChanges(changes);
      const proposalId = createId();
      const requestId = createId();
      const now = clock().toISOString();

      // D1 batch is transactional: if audit insertion fails, proposal insert
      // must roll back. No task row is updated by this operation.
      const proposal = db.prepare(`
        INSERT INTO office_robot_task_proposals
          (id, organization_id, project_id, task_id, service_principal_id,
           expected_task_version, proposed_changes_json, idempotency_key, request_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        proposalId, row.organization_id, row.project_id, row.task_id,
        row.service_principal_id, expectedVersion, serialized, key, requestId, now,
      );
      const audit = db.prepare(`
        INSERT INTO office_robot_audit_events
          (id, organization_id, project_id, service_principal_id, capability_code,
           action, object_type, object_id, request_id, idempotency_key, outcome, reason_code, created_at)
        VALUES (?, ?, ?, ?, ?, 'task.proposal.submit', 'task', ?, ?, ?, 'success', 'human_review_required', ?)
      `).bind(
        createId(), row.organization_id, row.project_id, row.service_principal_id,
        CAP_PROPOSE, row.task_id, requestId, key, now,
      );
      await db.batch([proposal, audit]);
      return Object.freeze({
        proposalId,
        taskId: row.task_id,
        expectedTaskVersion: expectedVersion,
        status: "pending_human_review",
      });
    },
  });
}
