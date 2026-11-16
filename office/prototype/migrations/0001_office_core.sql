-- ZHAKIN TEAM OFFICE — initial isolated schema
-- Target: dedicated Cloudflare D1 binding OFFICE_DB only.
-- Never apply this migration to WALLET_DB or production without explicit approval.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS office_organizations (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 200),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'archived')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS office_users (
  id TEXT PRIMARY KEY NOT NULL,
  identity_provider TEXT NOT NULL CHECK (length(trim(identity_provider)) BETWEEN 1 AND 500),
  provider_subject TEXT NOT NULL CHECK (length(trim(provider_subject)) BETWEEN 1 AND 500),
  email_normalized TEXT,
  email_verified_at TEXT,
  display_name TEXT NOT NULL CHECK (length(trim(display_name)) BETWEEN 1 AND 200),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'disabled')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (identity_provider, provider_subject),
  UNIQUE (id, status),
  CHECK (email_normalized IS NULL OR (length(email_normalized) BETWEEN 3 AND 320 AND email_normalized = lower(trim(email_normalized)))),
  CHECK (email_verified_at IS NULL OR email_normalized IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS office_users_verified_email_uq
  ON office_users(email_normalized)
  WHERE email_normalized IS NOT NULL AND email_verified_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS office_roles (
  id TEXT PRIMARY KEY NOT NULL,
  code TEXT NOT NULL UNIQUE CHECK (code IN (
    'office_viewer', 'project_coordinator', 'document_editor',
    'security_auditor', 'office_admin'
  )),
  description TEXT NOT NULL
);

INSERT OR IGNORE INTO office_roles (id, code, description) VALUES
  ('role_viewer', 'office_viewer', 'Read access to explicitly scoped office projects'),
  ('role_coordinator', 'project_coordinator', 'Manage tasks within explicitly scoped projects'),
  ('role_document_editor', 'document_editor', 'Prepare documents within explicitly scoped projects'),
  ('role_security_auditor', 'security_auditor', 'Read permitted audit events'),
  ('role_admin', 'office_admin', 'Office administration subject to separate approval policy');

CREATE TABLE IF NOT EXISTS office_projects (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL,
  code TEXT NOT NULL CHECK (length(trim(code)) BETWEEN 1 AND 80),
  title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 240),
  description TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('draft', 'active', 'blocked', 'completed', 'archived')),
  owner_user_id TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (organization_id, code),
  UNIQUE (id, organization_id),
  FOREIGN KEY (organization_id) REFERENCES office_organizations(id) ON DELETE RESTRICT,
  FOREIGN KEY (owner_user_id) REFERENCES office_users(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS office_user_role_scopes (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  project_id TEXT,
  role_id TEXT NOT NULL,
  granted_by_user_id TEXT NOT NULL,
  valid_from TEXT NOT NULL,
  valid_until TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (user_id) REFERENCES office_users(id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id) REFERENCES office_organizations(id) ON DELETE RESTRICT,
  FOREIGN KEY (project_id, organization_id) REFERENCES office_projects(id, organization_id) ON DELETE RESTRICT,
  FOREIGN KEY (role_id) REFERENCES office_roles(id) ON DELETE RESTRICT,
  FOREIGN KEY (granted_by_user_id) REFERENCES office_users(id) ON DELETE RESTRICT,
  CHECK (granted_by_user_id != user_id),
  CHECK (valid_until IS NULL OR valid_until > valid_from),
  CHECK (revoked_at IS NULL OR revoked_at >= valid_from)
);

CREATE INDEX IF NOT EXISTS office_role_scopes_lookup_idx
  ON office_user_role_scopes(user_id, organization_id, project_id, role_id, valid_until, revoked_at);

CREATE TABLE IF NOT EXISTS office_tasks (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 240),
  description TEXT,
  acceptance_criteria TEXT,
  created_by_user_id TEXT NOT NULL,
  assignee_user_id TEXT,
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'critical')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'open', 'in_progress', 'blocked', 'in_review', 'done', 'cancelled')),
  due_at TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  completed_at TEXT,
  FOREIGN KEY (project_id, organization_id) REFERENCES office_projects(id, organization_id) ON DELETE RESTRICT,
  FOREIGN KEY (created_by_user_id) REFERENCES office_users(id) ON DELETE RESTRICT,
  FOREIGN KEY (assignee_user_id) REFERENCES office_users(id) ON DELETE RESTRICT,
  CHECK (status != 'done' OR completed_at IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS office_tasks_project_status_idx
  ON office_tasks(organization_id, project_id, status, due_at);
CREATE INDEX IF NOT EXISTS office_tasks_assignee_idx
  ON office_tasks(assignee_user_id, status, due_at);

CREATE TABLE IF NOT EXISTS office_decisions (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL,
  project_id TEXT,
  title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 240),
  decision_text TEXT NOT NULL CHECK (length(trim(decision_text)) > 0),
  rationale TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'approved', 'rejected', 'withdrawn')),
  proposed_by_user_id TEXT NOT NULL,
  approved_by_user_id TEXT,
  proposed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  approved_at TEXT,
  effective_at TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  FOREIGN KEY (organization_id) REFERENCES office_organizations(id) ON DELETE RESTRICT,
  FOREIGN KEY (project_id, organization_id) REFERENCES office_projects(id, organization_id) ON DELETE RESTRICT,
  FOREIGN KEY (proposed_by_user_id) REFERENCES office_users(id) ON DELETE RESTRICT,
  FOREIGN KEY (approved_by_user_id) REFERENCES office_users(id) ON DELETE RESTRICT,
  CHECK (approved_by_user_id IS NULL OR approved_by_user_id != proposed_by_user_id),
  CHECK (
    (status = 'approved' AND approved_by_user_id IS NOT NULL AND approved_at IS NOT NULL)
    OR status != 'approved'
  )
);

CREATE INDEX IF NOT EXISTS office_decisions_scope_status_idx
  ON office_decisions(organization_id, project_id, status, proposed_at);

CREATE TABLE IF NOT EXISTS office_approval_requests (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL,
  object_type TEXT NOT NULL CHECK (object_type IN ('decision', 'task', 'document', 'role_grant')),
  object_id TEXT NOT NULL,
  object_version INTEGER NOT NULL CHECK (object_version >= 1),
  action TEXT NOT NULL CHECK (action IN ('approve', 'reject')),
  requested_by_user_id TEXT NOT NULL,
  approver_user_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled', 'stale')),
  reason TEXT,
  requested_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  decided_at TEXT,
  decision_comment TEXT,
  FOREIGN KEY (organization_id) REFERENCES office_organizations(id) ON DELETE RESTRICT,
  FOREIGN KEY (requested_by_user_id) REFERENCES office_users(id) ON DELETE RESTRICT,
  FOREIGN KEY (approver_user_id) REFERENCES office_users(id) ON DELETE RESTRICT,
  CHECK (requested_by_user_id != approver_user_id),
  CHECK (
    (status = 'pending' AND decided_at IS NULL)
    OR (status IN ('approved', 'rejected', 'cancelled', 'stale') AND decided_at IS NOT NULL)
  ),
  CHECK (status != 'approved' OR action = 'approve'),
  CHECK (status != 'rejected' OR action = 'reject')
);

CREATE INDEX IF NOT EXISTS office_approvals_inbox_idx
  ON office_approval_requests(approver_user_id, status, requested_at);

CREATE TABLE IF NOT EXISTS office_audit_events (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL,
  project_id TEXT,
  actor_user_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (length(trim(action)) BETWEEN 1 AND 120),
  object_type TEXT NOT NULL CHECK (length(trim(object_type)) BETWEEN 1 AND 80),
  object_id TEXT NOT NULL,
  before_hash TEXT,
  after_hash TEXT,
  reason TEXT,
  request_id TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('success', 'denied', 'failed')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (organization_id) REFERENCES office_organizations(id) ON DELETE RESTRICT,
  FOREIGN KEY (project_id, organization_id) REFERENCES office_projects(id, organization_id) ON DELETE RESTRICT,
  FOREIGN KEY (actor_user_id) REFERENCES office_users(id) ON DELETE RESTRICT,
  UNIQUE (request_id, action, object_type, object_id)
);

CREATE INDEX IF NOT EXISTS office_audit_scope_time_idx
  ON office_audit_events(organization_id, project_id, created_at);
CREATE INDEX IF NOT EXISTS office_audit_actor_time_idx
  ON office_audit_events(actor_user_id, created_at);

CREATE TRIGGER IF NOT EXISTS office_audit_no_update
BEFORE UPDATE ON office_audit_events
BEGIN
  SELECT RAISE(ABORT, 'office audit events are append-only');
END;

CREATE TRIGGER IF NOT EXISTS office_audit_no_delete
BEFORE DELETE ON office_audit_events
BEGIN
  SELECT RAISE(ABORT, 'office audit events are append-only');
END;

CREATE TABLE IF NOT EXISTS office_evidence_files (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  uploaded_by_user_id TEXT NOT NULL,
  storage_key TEXT NOT NULL UNIQUE,
  mime_type TEXT NOT NULL CHECK (length(trim(mime_type)) BETWEEN 3 AND 160),
  size_bytes INTEGER NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 20971520),
  sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
  classification TEXT NOT NULL CHECK (classification IN ('internal', 'confidential', 'restricted')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (project_id, organization_id) REFERENCES office_projects(id, organization_id) ON DELETE RESTRICT,
  FOREIGN KEY (uploaded_by_user_id) REFERENCES office_users(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS office_evidence_project_idx
  ON office_evidence_files(organization_id, project_id, created_at);
