-- ZHAKIN Robot Office data layer — isolated prototype schema.
-- SQLite / Cloudflare D1 compatible. NOT applied to any database.
-- Application-layer authorization is still mandatory; schema constraints do not
-- replace tenant, role, workspace, object-level, or document-storage checks.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS office_organizations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'suspended', 'closed')),
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS office_role_grants (
  id TEXT PRIMARY KEY,
  subject_id TEXT NOT NULL,
  organization_id TEXT NOT NULL REFERENCES office_organizations(id),
  role TEXT NOT NULL CHECK (role IN (
    'treasury_agent', 'legal_agent', 'command_agent',
    'human_treasury', 'human_legal', 'access_admin', 'auditor'
  )),
  scope TEXT NOT NULL DEFAULT 'workspace',
  granted_by TEXT NOT NULL,
  granted_at INTEGER NOT NULL,
  expires_at INTEGER,
  revoked_at INTEGER,
  CHECK (expires_at IS NULL OR expires_at > granted_at),
  CHECK (revoked_at IS NULL OR revoked_at >= granted_at)
);
CREATE INDEX IF NOT EXISTS idx_office_grants_subject_org
  ON office_role_grants(subject_id, organization_id, role, expires_at, revoked_at);

CREATE TABLE IF NOT EXISTS office_tasks (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES office_organizations(id),
  workspace TEXT NOT NULL CHECK (workspace IN ('treasury', 'legal', 'command')),
  owner_role TEXT NOT NULL CHECK (owner_role IN (
    'treasury_agent', 'legal_agent', 'command_agent',
    'human_treasury', 'human_legal'
  )),
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'in_progress', 'blocked', 'handed_off', 'completed', 'cancelled')),
  priority TEXT NOT NULL DEFAULT 'normal'
    CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  description TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 10000),
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  due_at INTEGER,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  CHECK (
    (workspace = 'treasury' AND owner_role IN ('treasury_agent', 'human_treasury')) OR
    (workspace = 'legal' AND owner_role IN ('legal_agent', 'human_legal')) OR
    (workspace = 'command' AND owner_role = 'command_agent')
  )
);
CREATE INDEX IF NOT EXISTS idx_office_tasks_org_workspace_status
  ON office_tasks(organization_id, workspace, status, created_at);

CREATE TABLE IF NOT EXISTS office_document_metadata (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES office_organizations(id),
  workspace TEXT NOT NULL CHECK (workspace IN ('treasury', 'legal')),
  classification TEXT NOT NULL
    CHECK (classification IN ('public', 'internal', 'confidential', 'restricted')),
  storage_object_id TEXT NOT NULL UNIQUE,
  original_filename TEXT NOT NULL CHECK (length(original_filename) BETWEEN 1 AND 255),
  media_type TEXT NOT NULL CHECK (length(media_type) <= 120),
  byte_size INTEGER NOT NULL CHECK (byte_size >= 0 AND byte_size <= 26214400),
  checksum_sha256 TEXT NOT NULL CHECK (length(checksum_sha256) = 64),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  retention_until INTEGER,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'quarantined', 'deleted')),
  CHECK (retention_until IS NULL OR retention_until >= created_at)
);
CREATE INDEX IF NOT EXISTS idx_office_docs_org_workspace_class
  ON office_document_metadata(organization_id, workspace, classification, status);

CREATE TABLE IF NOT EXISTS office_approvals (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES office_organizations(id),
  object_type TEXT NOT NULL CHECK (object_type IN ('task', 'document')),
  object_id TEXT NOT NULL,
  requested_by TEXT NOT NULL,
  reviewer_id TEXT,
  decision TEXT NOT NULL DEFAULT 'pending'
    CHECK (decision IN ('pending', 'approved', 'rejected', 'cancelled')),
  reason TEXT NOT NULL DEFAULT '' CHECK (length(reason) <= 4000),
  idempotency_key TEXT NOT NULL UNIQUE,
  requested_at INTEGER NOT NULL,
  decided_at INTEGER,
  CHECK (
    (decision = 'pending' AND reviewer_id IS NULL AND decided_at IS NULL) OR
    (decision <> 'pending' AND reviewer_id IS NOT NULL AND decided_at IS NOT NULL)
  ),
  CHECK (reviewer_id IS NULL OR reviewer_id <> requested_by)
);
CREATE INDEX IF NOT EXISTS idx_office_approvals_org_state
  ON office_approvals(organization_id, decision, requested_at);

CREATE TABLE IF NOT EXISTS office_audit_events (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES office_organizations(id),
  actor_id TEXT NOT NULL,
  actor_role TEXT NOT NULL,
  action TEXT NOT NULL,
  object_type TEXT NOT NULL,
  object_id TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('success', 'denied', 'failed')),
  request_id TEXT NOT NULL,
  occurred_at INTEGER NOT NULL,
  details_redacted TEXT NOT NULL DEFAULT '' CHECK (length(details_redacted) <= 4000)
);
CREATE INDEX IF NOT EXISTS idx_office_audit_org_time
  ON office_audit_events(organization_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_office_audit_object
  ON office_audit_events(object_type, object_id, occurred_at);

-- Append-only audit: corrections are represented by new events, never mutation.
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
