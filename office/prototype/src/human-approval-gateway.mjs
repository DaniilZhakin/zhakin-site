/**
 * ZHAKIN TEAM OFFICE — human review gateway for robot task proposals.
 * Requires a dedicated OFFICE_DB D1 binding and trusted human credential verifier.
 * No browser-supplied user IDs, roles, or scopes are accepted.
 */
function deny(code, status = 403) {
  const error = new Error("Human approval request denied");
  error.code = code;
  error.status = status;
  return error;
}
function requiredText(value, code) {
  if (typeof value !== "string" || !value.trim()) throw deny(code, 400);
  return value.trim();
}
function makeId() { return crypto.randomUUID(); }

export function createHumanApprovalGateway({ db, verifyCredential, clock = () => new Date() }) {
  if (!db || typeof db.prepare !== "function" || typeof db.batch !== "function") {
    throw new TypeError("A dedicated OFFICE_DB D1 binding is required");
  }
  if (typeof verifyCredential !== "function") {
    throw new TypeError("A trusted human credential verifier is required");
  }

  return Object.freeze({
    async reviewProposal({ bearerToken, proposalId, action, comment = null }) {
      const token = requiredText(bearerToken, "missing_credential");
      const proposal = requiredText(proposalId, "missing_proposal_id");
      if (!["accept", "reject"].includes(action)) throw deny("invalid_review_action", 400);
      if (comment !== null && (typeof comment !== "string" || comment.length > 2000)) {
        throw deny("invalid_review_comment", 400);
      }

      // The verifier must validate signature, issuer, audience, exp/nbf and revocation.
      // Only verified issuer+subject are used to resolve the human OFFICE identity.
      const identity = await verifyCredential(token);
      const issuer = requiredText(identity?.issuer, "invalid_verified_identity");
      const subject = requiredText(identity?.subject, "invalid_verified_identity");
      const now = clock().toISOString();

      const row = await db.prepare(`
        SELECT
          u.id AS reviewer_user_id,
          u.status AS reviewer_status,
          p.id AS proposal_id,
          p.organization_id,
          p.project_id,
          p.task_id,
          p.expected_task_version,
          p.proposed_changes_json,
          p.status AS proposal_status,
          t.version AS current_task_version,
          t.status AS task_status,
          pr.status AS project_status,
          o.status AS organization_status,
          EXISTS (
            SELECT 1 FROM office_robot_proposal_approver_scopes s
            WHERE s.user_id = u.id
              AND s.organization_id = p.organization_id
              AND (s.project_id IS NULL OR s.project_id = p.project_id)
              AND s.valid_from <= ?
              AND (s.valid_until IS NULL OR s.valid_until > ?)
              AND s.revoked_at IS NULL
          ) AS has_approval_scope
        FROM office_users u
        JOIN office_robot_task_proposals p ON p.id = ?
        JOIN office_tasks t ON t.id = p.task_id
        JOIN office_projects pr ON pr.id = p.project_id AND pr.organization_id = p.organization_id
        JOIN office_organizations o ON o.id = p.organization_id
        WHERE u.identity_provider = ? AND u.provider_subject = ?
        LIMIT 1
      `).bind(now, now, proposal, issuer, subject).first();

      if (!row || row.reviewer_status !== "active" || !row.has_approval_scope) {
        throw deny("reviewer_not_authorized");
      }
      if (row.proposal_status !== "pending") throw deny("proposal_not_pending", 409);

      const requestId = makeId();
      const reviewId = makeId();
      const stale = row.current_task_version !== row.expected_task_version
        || ["done", "cancelled"].includes(row.task_status)
        || row.project_status !== "active"
        || row.organization_status !== "active";
      const outcome = stale ? "stale" : (action === "accept" ? "accepted" : "rejected");

      const statements = [];
      if (outcome === "accepted") {
        // Compare-and-set on task version plus live approval scope. A zero-row
        // update makes the following review trigger fail, rolling back the batch.
        statements.push(db.prepare(`
          UPDATE office_tasks
          SET
            title = CASE WHEN json_type(p.proposed_changes_json, '$.title') IS NOT NULL
              THEN json_extract(p.proposed_changes_json, '$.title') ELSE office_tasks.title END,
            description = CASE WHEN json_type(p.proposed_changes_json, '$.description') IS NOT NULL
              THEN json_extract(p.proposed_changes_json, '$.description') ELSE office_tasks.description END,
            acceptance_criteria = CASE WHEN json_type(p.proposed_changes_json, '$.acceptance_criteria') IS NOT NULL
              THEN json_extract(p.proposed_changes_json, '$.acceptance_criteria') ELSE office_tasks.acceptance_criteria END,
            version = version + 1,
            updated_at = ?
          FROM office_robot_task_proposals p
          WHERE p.id = ?
            AND p.status = 'pending'
            AND office_tasks.id = p.task_id
            AND office_tasks.version = p.expected_task_version
            AND office_tasks.status NOT IN ('done', 'cancelled')
            AND EXISTS (
              SELECT 1
              FROM office_robot_proposal_approver_scopes s
              JOIN office_users u ON u.id = s.user_id AND u.status = 'active'
              JOIN office_projects pr ON pr.id = p.project_id AND pr.organization_id = p.organization_id
              JOIN office_organizations o ON o.id = p.organization_id
              WHERE s.user_id = ?
                AND s.organization_id = p.organization_id
                AND (s.project_id IS NULL OR s.project_id = p.project_id)
                AND s.valid_from <= ?
                AND (s.valid_until IS NULL OR s.valid_until > ?)
                AND s.revoked_at IS NULL
                AND pr.status = 'active' AND o.status = 'active'
            )
        `).bind(now, proposal, row.reviewer_user_id, now, now));
      }

      statements.push(db.prepare(`
        INSERT INTO office_robot_proposal_reviews
          (id, proposal_id, organization_id, project_id, task_id, reviewer_user_id,
           action, expected_task_version, request_id, comment, decided_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        reviewId, proposal, row.organization_id, row.project_id, row.task_id,
        row.reviewer_user_id, outcome, row.expected_task_version, requestId, comment, now,
      ));

      statements.push(db.prepare(`
        UPDATE office_robot_task_proposals
        SET status = ?, reviewed_by_user_id = ?, reviewed_at = ?, review_comment = ?
        WHERE id = ? AND status = 'pending'
      `).bind(outcome, row.reviewer_user_id, now, comment, proposal));

      statements.push(db.prepare(`
        INSERT INTO office_audit_events
          (id, organization_id, project_id, actor_user_id, action, object_type, object_id,
           reason, request_id, outcome)
        VALUES (?, ?, ?, ?, ?, 'robot_task_proposal', ?, ?, ?, 'success')
      `).bind(
        makeId(), row.organization_id, row.project_id, row.reviewer_user_id,
        `robot_proposal.${outcome}`, proposal, comment, requestId,
      ));

      await db.batch(statements);
      return Object.freeze({
        proposalId: proposal,
        status: outcome,
        taskChanged: outcome === "accepted",
        reviewId,
      });
    },
  });
}
