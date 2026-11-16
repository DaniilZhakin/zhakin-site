-- ZHAKIN TEAM OFFICE — robot task proposal inbox.
-- Robots may propose bounded metadata changes; humans retain final control.
-- Apply only to a disposable OFFICE_DB-compatible database after review.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS office_robot_task_proposals (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  service_principal_id TEXT NOT NULL,
  expected_task_version INTEGER NOT NULL CHECK (expected_task_version >= 1),
  proposed_changes_json TEXT NOT NULL CHECK (
    CASE
      WHEN json_valid(proposed_changes_json)
      THEN json_type(proposed_changes_json) = 'object'
        AND length(proposed_changes_json) BETWEEN 2 AND 16384
      ELSE 0
    END
  ),
  idempotency_key TEXT NOT NULL CHECK (length(trim(idempotency_key)) BETWEEN 1 AND 180),
  request_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'rejected', 'stale', 'withdrawn')),
  reviewed_by_user_id TEXT,
  reviewed_at TEXT,
  review_comment TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (project_id, organization_id)
    REFERENCES office_projects(id, organization_id) ON DELETE RESTRICT,
  FOREIGN KEY (task_id) REFERENCES office_tasks(id) ON DELETE RESTRICT,
  FOREIGN KEY (service_principal_id, organization_id)
    REFERENCES office_service_principals(id, organization_id) ON DELETE RESTRICT,
  FOREIGN KEY (reviewed_by_user_id) REFERENCES office_users(id) ON DELETE RESTRICT,
  UNIQUE (service_principal_id, idempotency_key),
  CHECK (
    (status = 'pending' AND reviewed_by_user_id IS NULL AND reviewed_at IS NULL)
    OR (status != 'pending' AND reviewed_by_user_id IS NOT NULL AND reviewed_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS office_robot_proposals_inbox_idx
  ON office_robot_task_proposals(organization_id, project_id, status, created_at);

CREATE TRIGGER IF NOT EXISTS office_robot_proposal_scope_guard
BEFORE INSERT ON office_robot_task_proposals
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
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
    WHERE sp.id = NEW.service_principal_id
      AND sp.organization_id = NEW.organization_id
      AND sp.status = 'active'
      AND sp.valid_from <= NEW.created_at
      AND (sp.valid_until IS NULL OR sp.valid_until > NEW.created_at)
      AND cs.capability_code = 'office.task.propose_update'
      AND cs.task_id = NEW.task_id
      AND cs.project_id = NEW.project_id
      AND cs.revoked_at IS NULL
      AND cs.valid_from <= NEW.created_at
      AND (cs.valid_until IS NULL OR cs.valid_until > NEW.created_at)
      AND t.id = NEW.task_id
      AND t.version = NEW.expected_task_version
      AND t.status NOT IN ('done', 'cancelled')
      AND p.status = 'active'
      AND o.status = 'active'
  ) THEN RAISE(ABORT, 'robot proposal authorization or task version is no longer valid') END;
END;

CREATE TRIGGER IF NOT EXISTS office_robot_proposal_no_update
BEFORE UPDATE ON office_robot_task_proposals
WHEN OLD.status != 'pending'
BEGIN
  SELECT RAISE(ABORT, 'reviewed robot proposals are immutable');
END;

CREATE TRIGGER IF NOT EXISTS office_robot_proposal_no_delete
BEFORE DELETE ON office_robot_task_proposals
BEGIN
  SELECT RAISE(ABORT, 'robot proposals cannot be deleted');
END;

CREATE TRIGGER IF NOT EXISTS office_robot_proposal_fields_guard
BEFORE INSERT ON office_robot_task_proposals
WHEN json_valid(NEW.proposed_changes_json)
BEGIN
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM json_each(NEW.proposed_changes_json)
    WHERE key NOT IN ('title', 'description', 'acceptance_criteria')
       OR type NOT IN ('text', 'null')
       OR (type = 'text' AND length(value) > 8000)
  ) THEN RAISE(ABORT, 'robot proposal contains a forbidden field or value') END;
END;
