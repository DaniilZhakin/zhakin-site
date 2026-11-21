-- ZHAKIN TEAM OFFICE — robot service-principal registry (additive prototype migration)
-- Proposal only. Apply only to a disposable OFFICE_DB-compatible test database after review.
-- This migration does not create credentials, activate robots, or grant production access.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS office_service_principals (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL,
  code TEXT NOT NULL CHECK (length(trim(code)) BETWEEN 2 AND 80),
  display_name TEXT NOT NULL CHECK (length(trim(display_name)) BETWEEN 1 AND 160),
  identity_issuer TEXT NOT NULL CHECK (length(trim(identity_issuer)) BETWEEN 1 AND 500),
  identity_subject TEXT NOT NULL CHECK (length(trim(identity_subject)) BETWEEN 1 AND 500),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'suspended', 'revoked')),
  credential_ref TEXT,
  valid_from TEXT,
  valid_until TEXT,
  created_by_user_id TEXT NOT NULL,
  approved_by_user_id TEXT,
  approved_at TEXT,
  revoked_at TEXT,
  revocation_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (organization_id, code),
  UNIQUE (identity_issuer, identity_subject),
  UNIQUE (id, organization_id),
  FOREIGN KEY (organization_id) REFERENCES office_organizations(id) ON DELETE RESTRICT,
  FOREIGN KEY (created_by_user_id) REFERENCES office_users(id) ON DELETE RESTRICT,
  FOREIGN KEY (approved_by_user_id) REFERENCES office_users(id) ON DELETE RESTRICT,
  CHECK (valid_until IS NULL OR valid_from IS NULL OR valid_until > valid_from),
  CHECK (approved_by_user_id IS NULL OR approved_by_user_id != created_by_user_id),
  CHECK (
    (status = 'active' AND approved_by_user_id IS NOT NULL AND approved_at IS NOT NULL
      AND valid_from IS NOT NULL AND credential_ref IS NOT NULL)
    OR status != 'active'
  ),
  CHECK (
    (status = 'revoked' AND revoked_at IS NOT NULL AND length(trim(coalesce(revocation_reason, ''))) > 0)
    OR status != 'revoked'
  )
);

CREATE INDEX IF NOT EXISTS office_service_principals_org_status_idx
  ON office_service_principals(organization_id, status, valid_until);

CREATE TABLE IF NOT EXISTS office_robot_capabilities (
  code TEXT PRIMARY KEY NOT NULL CHECK (code IN (
    'office.task.read_assigned',
    'office.task.propose_update',
    'office.robot.handoff_submit',
    'office.evidence.metadata_read',
    'office.research.submit'
  )),
  description TEXT NOT NULL
);

INSERT OR IGNORE INTO office_robot_capabilities(code, description) VALUES
  ('office.task.read_assigned', 'Read only explicitly scoped task context'),
  ('office.task.propose_update', 'Submit a proposed task update for human review'),
  ('office.robot.handoff_submit', 'Submit a minimized handoff summary to an explicitly authorized audience'),
  ('office.evidence.metadata_read', 'Read permitted evidence metadata, never raw storage credentials'),
  ('office.research.submit', 'Attach research output to an explicitly scoped task');

CREATE TABLE IF NOT EXISTS office_service_capability_scopes (
  id TEXT PRIMARY KEY NOT NULL,
  service_principal_id TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  project_id TEXT,
  task_id TEXT,
  capability_code TEXT NOT NULL,
  granted_by_user_id TEXT NOT NULL,
  approved_by_user_id TEXT NOT NULL,
  valid_from TEXT NOT NULL,
  valid_until TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (service_principal_id, organization_id)
    REFERENCES office_service_principals(id, organization_id) ON DELETE RESTRICT,
  FOREIGN KEY (project_id, organization_id)
    REFERENCES office_projects(id, organization_id) ON DELETE RESTRICT,
  FOREIGN KEY (task_id) REFERENCES office_tasks(id) ON DELETE RESTRICT,
  FOREIGN KEY (capability_code) REFERENCES office_robot_capabilities(code) ON DELETE RESTRICT,
  FOREIGN KEY (granted_by_user_id) REFERENCES office_users(id) ON DELETE RESTRICT,
  FOREIGN KEY (approved_by_user_id) REFERENCES office_users(id) ON DELETE RESTRICT,
  CHECK (granted_by_user_id != approved_by_user_id),
  CHECK (valid_until IS NULL OR valid_until > valid_from),
  CHECK (revoked_at IS NULL OR revoked_at >= valid_from),
  CHECK (task_id IS NULL OR project_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS office_service_capability_lookup_idx
  ON office_service_capability_scopes(service_principal_id, organization_id, project_id, task_id, capability_code, valid_until, revoked_at);

CREATE TABLE IF NOT EXISTS office_robot_audit_events (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL,
  project_id TEXT,
  service_principal_id TEXT NOT NULL,
  capability_code TEXT NOT NULL,
  action TEXT NOT NULL CHECK (length(trim(action)) BETWEEN 1 AND 120),
  object_type TEXT NOT NULL CHECK (length(trim(object_type)) BETWEEN 1 AND 80),
  object_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('success', 'denied', 'failed')),
  reason_code TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (service_principal_id, organization_id)
    REFERENCES office_service_principals(id, organization_id) ON DELETE RESTRICT,
  FOREIGN KEY (project_id, organization_id)
    REFERENCES office_projects(id, organization_id) ON DELETE RESTRICT,
  FOREIGN KEY (capability_code) REFERENCES office_robot_capabilities(code) ON DELETE RESTRICT,
  UNIQUE (service_principal_id, idempotency_key),
  UNIQUE (request_id, action, object_type, object_id)
);

CREATE INDEX IF NOT EXISTS office_robot_audit_scope_time_idx
  ON office_robot_audit_events(organization_id, project_id, created_at);

CREATE TRIGGER IF NOT EXISTS office_robot_audit_no_update
BEFORE UPDATE ON office_robot_audit_events
BEGIN
  SELECT RAISE(ABORT, 'robot audit events are append-only');
END;

CREATE TRIGGER IF NOT EXISTS office_robot_audit_no_delete
BEFORE DELETE ON office_robot_audit_events
BEGIN
  SELECT RAISE(ABORT, 'robot audit events are append-only');
END;

-- Cross-table state rules that cannot be expressed with SQLite CHECK constraints.
CREATE TRIGGER IF NOT EXISTS office_service_principal_activation_guard
BEFORE UPDATE OF status ON office_service_principals
WHEN NEW.status = 'active'
BEGIN
  SELECT CASE WHEN NEW.approved_by_user_id IS NULL
    OR NEW.approved_at IS NULL
    OR NEW.valid_from IS NULL
    OR NEW.credential_ref IS NULL
    THEN RAISE(ABORT, 'robot activation requires separate human approval and credential reference')
  END;
END;

CREATE TRIGGER IF NOT EXISTS office_service_principal_revoke_guard
BEFORE UPDATE OF status ON office_service_principals
WHEN NEW.status = 'revoked'
BEGIN
  SELECT CASE WHEN NEW.revoked_at IS NULL
    OR length(trim(coalesce(NEW.revocation_reason, ''))) = 0
    THEN RAISE(ABORT, 'robot revocation requires timestamp and reason')
  END;
END;

-- A task-scoped capability must point to a task in the same organization and project.
CREATE TRIGGER IF NOT EXISTS office_service_scope_task_guard_insert
BEFORE INSERT ON office_service_capability_scopes
WHEN NEW.task_id IS NOT NULL
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM office_tasks t
    WHERE t.id = NEW.task_id
      AND t.organization_id = NEW.organization_id
      AND t.project_id = NEW.project_id
  ) THEN RAISE(ABORT, 'robot task scope must match organization and project') END;
END;

CREATE TRIGGER IF NOT EXISTS office_service_scope_task_guard_update
BEFORE UPDATE OF task_id, organization_id, project_id ON office_service_capability_scopes
WHEN NEW.task_id IS NOT NULL
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM office_tasks t
    WHERE t.id = NEW.task_id
      AND t.organization_id = NEW.organization_id
      AND t.project_id = NEW.project_id
  ) THEN RAISE(ABORT, 'robot task scope must match organization and project') END;
END;
