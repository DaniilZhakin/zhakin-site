-- ZHAKIN TEAM OFFICE — human review for robot task proposals.
-- Dedicated OFFICE_DB only. No grants are seeded; no human receives approval authority.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS office_robot_proposal_approver_scopes (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  project_id TEXT,
  granted_by_user_id TEXT NOT NULL,
  approved_by_user_id TEXT NOT NULL,
  valid_from TEXT NOT NULL,
  valid_until TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (user_id) REFERENCES office_users(id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id) REFERENCES office_organizations(id) ON DELETE RESTRICT,
  FOREIGN KEY (project_id, organization_id) REFERENCES office_projects(id, organization_id) ON DELETE RESTRICT,
  FOREIGN KEY (granted_by_user_id) REFERENCES office_users(id) ON DELETE RESTRICT,
  FOREIGN KEY (approved_by_user_id) REFERENCES office_users(id) ON DELETE RESTRICT,
  CHECK (user_id != granted_by_user_id),
  CHECK (user_id != approved_by_user_id),
  CHECK (granted_by_user_id != approved_by_user_id),
  CHECK (valid_until IS NULL OR valid_until > valid_from),
  CHECK (revoked_at IS NULL OR revoked_at >= valid_from)
);

CREATE INDEX IF NOT EXISTS office_robot_approver_scope_lookup_idx
  ON office_robot_proposal_approver_scopes(user_id, organization_id, project_id, valid_until, revoked_at);

CREATE TRIGGER IF NOT EXISTS office_robot_approver_scope_no_delete
BEFORE DELETE ON office_robot_proposal_approver_scopes
BEGIN
  SELECT RAISE(ABORT, 'approver grants cannot be deleted; revoke them instead');
END;

CREATE TRIGGER IF NOT EXISTS office_robot_approver_scope_revoke_once
BEFORE UPDATE ON office_robot_proposal_approver_scopes
WHEN OLD.revoked_at IS NOT NULL
  OR NEW.revoked_at IS NULL
  OR NEW.created_at != OLD.created_at
BEGIN
  SELECT RAISE(ABORT, 'approver grants may only be revoked once; metadata is immutable');
END;

CREATE TRIGGER IF NOT EXISTS office_robot_approver_scope_identity_immutable
BEFORE UPDATE ON office_robot_proposal_approver_scopes
WHEN NEW.user_id != OLD.user_id
  OR NEW.organization_id != OLD.organization_id
  OR NEW.project_id IS NOT OLD.project_id
  OR NEW.granted_by_user_id != OLD.granted_by_user_id
  OR NEW.approved_by_user_id != OLD.approved_by_user_id
  OR NEW.valid_from != OLD.valid_from
  OR NEW.valid_until IS NOT OLD.valid_until
  OR OLD.revoked_at IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'approver grant identity is immutable');
END;

CREATE TABLE IF NOT EXISTS office_robot_proposal_reviews (
  id TEXT PRIMARY KEY NOT NULL,
  proposal_id TEXT NOT NULL UNIQUE,
  organization_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  reviewer_user_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('accepted', 'rejected', 'stale')),
  expected_task_version INTEGER NOT NULL CHECK (expected_task_version >= 1),
  request_id TEXT NOT NULL UNIQUE,
  comment TEXT,
  decided_at TEXT NOT NULL,
  FOREIGN KEY (proposal_id) REFERENCES office_robot_task_proposals(id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id) REFERENCES office_organizations(id) ON DELETE RESTRICT,
  FOREIGN KEY (project_id, organization_id) REFERENCES office_projects(id, organization_id) ON DELETE RESTRICT,
  FOREIGN KEY (task_id) REFERENCES office_tasks(id) ON DELETE RESTRICT,
  FOREIGN KEY (reviewer_user_id) REFERENCES office_users(id) ON DELETE RESTRICT,
  CHECK (comment IS NULL OR length(comment) <= 2000)
);

CREATE INDEX IF NOT EXISTS office_robot_proposal_reviews_scope_idx
  ON office_robot_proposal_reviews(organization_id, project_id, reviewer_user_id, decided_at);

CREATE TRIGGER IF NOT EXISTS office_robot_proposal_review_authorization
BEFORE INSERT ON office_robot_proposal_reviews
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM office_robot_task_proposals p
    JOIN office_users u ON u.id = NEW.reviewer_user_id AND u.status = 'active'
    JOIN office_robot_proposal_approver_scopes s
      ON s.user_id = u.id
     AND s.organization_id = p.organization_id
     AND (s.project_id IS NULL OR s.project_id = p.project_id)
    JOIN office_projects pr ON pr.id = p.project_id AND pr.organization_id = p.organization_id
    JOIN office_organizations o ON o.id = p.organization_id
    JOIN office_tasks t ON t.id = p.task_id
    WHERE p.id = NEW.proposal_id
      AND p.status = 'pending'
      AND p.organization_id = NEW.organization_id
      AND p.project_id = NEW.project_id
      AND p.task_id = NEW.task_id
      AND p.expected_task_version = NEW.expected_task_version
      AND NEW.decided_at >= s.valid_from
      AND (s.valid_until IS NULL OR s.valid_until > NEW.decided_at)
      AND s.revoked_at IS NULL
      AND pr.status = 'active'
      AND o.status = 'active'
      AND (
        (NEW.action = 'accepted' AND t.version = p.expected_task_version + 1
          AND t.status NOT IN ('done', 'cancelled')
          AND (json_type(p.proposed_changes_json, '$.title') IS NULL
            OR t.title IS json_extract(p.proposed_changes_json, '$.title'))
          AND (json_type(p.proposed_changes_json, '$.description') IS NULL
            OR t.description IS json_extract(p.proposed_changes_json, '$.description'))
          AND (json_type(p.proposed_changes_json, '$.acceptance_criteria') IS NULL
            OR t.acceptance_criteria IS json_extract(p.proposed_changes_json, '$.acceptance_criteria')))
        OR (NEW.action = 'rejected')
        OR (NEW.action = 'stale' AND (
          t.version != p.expected_task_version
          OR t.status IN ('done', 'cancelled')
          OR pr.status != 'active'
          OR o.status != 'active'
        ))
      )
  ) THEN RAISE(ABORT, 'human reviewer is not authorized or proposal state is stale') END;
END;

CREATE TRIGGER IF NOT EXISTS office_robot_proposal_reviews_no_update
BEFORE UPDATE ON office_robot_proposal_reviews
BEGIN
  SELECT RAISE(ABORT, 'proposal review history is append-only');
END;

CREATE TRIGGER IF NOT EXISTS office_robot_proposal_reviews_no_delete
BEFORE DELETE ON office_robot_proposal_reviews
BEGIN
  SELECT RAISE(ABORT, 'proposal review history is append-only');
END;

CREATE TRIGGER IF NOT EXISTS office_robot_proposal_review_transition_guard
BEFORE UPDATE ON office_robot_task_proposals
WHEN OLD.status = 'pending'
BEGIN
  SELECT CASE WHEN NOT (
    NEW.status IN ('accepted', 'rejected', 'stale')
    AND NEW.id = OLD.id
    AND NEW.organization_id = OLD.organization_id
    AND NEW.project_id = OLD.project_id
    AND NEW.task_id = OLD.task_id
    AND NEW.service_principal_id = OLD.service_principal_id
    AND NEW.expected_task_version = OLD.expected_task_version
    AND NEW.proposed_changes_json = OLD.proposed_changes_json
    AND NEW.idempotency_key = OLD.idempotency_key
    AND NEW.request_id = OLD.request_id
    AND NEW.created_at = OLD.created_at
    AND NEW.reviewed_by_user_id IS NOT NULL
    AND NEW.reviewed_at IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM office_robot_proposal_reviews r
      WHERE r.proposal_id = OLD.id
        AND r.reviewer_user_id = NEW.reviewed_by_user_id
        AND r.action = NEW.status
        AND r.decided_at = NEW.reviewed_at
    )
  ) THEN RAISE(ABORT, 'invalid human review transition') END;
END;
