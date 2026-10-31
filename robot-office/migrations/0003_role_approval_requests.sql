-- Human approval lifecycle for Robot Office role assignments.
-- Applied only to disposable local/test databases until separately reviewed.
CREATE TABLE IF NOT EXISTS office_role_approval_requests (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES office_organizations(id),
  requested_by TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN (
    'treasury_agent', 'legal_agent', 'command_agent',
    'human_treasury', 'human_legal'
  )),
  scope TEXT NOT NULL CHECK (
    (role IN ('treasury_agent','human_treasury') AND scope = 'workspace:treasury') OR
    (role IN ('legal_agent','human_legal') AND scope = 'workspace:legal') OR
    (role = 'command_agent' AND scope = 'organization:handoff-summaries')
  ),
  grant_expires_at INTEGER,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'consumed', 'expired', 'cancelled')),
  request_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  reviewer_id TEXT,
  decided_at INTEGER,
  decision_reason TEXT NOT NULL DEFAULT '' CHECK (length(decision_reason) <= 1000),
  token_hash TEXT UNIQUE,
  token_expires_at INTEGER,
  consumed_at INTEGER,
  CHECK (expires_at > created_at),
  CHECK (grant_expires_at IS NULL OR grant_expires_at > created_at),
  CHECK (
    (status = 'pending' AND reviewer_id IS NULL AND decided_at IS NULL AND token_hash IS NULL AND consumed_at IS NULL) OR
    (status = 'approved' AND reviewer_id IS NOT NULL AND decided_at IS NOT NULL AND token_hash IS NOT NULL AND token_expires_at IS NOT NULL AND consumed_at IS NULL) OR
    (status = 'rejected' AND reviewer_id IS NOT NULL AND decided_at IS NOT NULL AND token_hash IS NULL AND consumed_at IS NULL) OR
    (status = 'consumed' AND reviewer_id IS NOT NULL AND decided_at IS NOT NULL AND token_hash IS NOT NULL AND consumed_at IS NOT NULL) OR
    (status IN ('expired', 'cancelled') AND consumed_at IS NULL)
  ),
  CHECK (reviewer_id IS NULL OR reviewer_id <> requested_by),
  CHECK (subject_id <> requested_by)
);
CREATE INDEX IF NOT EXISTS idx_office_role_approvals_pending
  ON office_role_approval_requests(organization_id, status, expires_at);
CREATE INDEX IF NOT EXISTS idx_office_role_approvals_subject
  ON office_role_approval_requests(organization_id, subject_id, created_at);
