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
  decision_event_id TEXT UNIQUE,
  decision_reason TEXT NOT NULL DEFAULT '' CHECK (length(decision_reason) <= 1000),
  token_hash TEXT UNIQUE,
  token_expires_at INTEGER,
  consumed_at INTEGER,
  consumed_grant_id TEXT UNIQUE,
  CHECK (expires_at > created_at),
  CHECK (grant_expires_at IS NULL OR grant_expires_at > created_at),
  CHECK (
    (status = 'pending' AND reviewer_id IS NULL AND decided_at IS NULL AND decision_event_id IS NULL AND token_hash IS NULL AND consumed_at IS NULL AND consumed_grant_id IS NULL) OR
    (status = 'approved' AND reviewer_id IS NOT NULL AND decided_at IS NOT NULL AND decision_event_id IS NOT NULL AND token_hash IS NOT NULL AND token_expires_at IS NOT NULL AND consumed_at IS NULL AND consumed_grant_id IS NULL) OR
    (status = 'rejected' AND reviewer_id IS NOT NULL AND decided_at IS NOT NULL AND decision_event_id IS NOT NULL AND token_hash IS NULL AND consumed_at IS NULL AND consumed_grant_id IS NULL) OR
    (status = 'consumed' AND reviewer_id IS NOT NULL AND decided_at IS NOT NULL AND decision_event_id IS NOT NULL AND token_hash IS NOT NULL AND consumed_at IS NOT NULL AND consumed_grant_id IS NOT NULL) OR
    (status IN ('expired', 'cancelled') AND consumed_at IS NULL)
  ),
  CHECK (reviewer_id IS NULL OR reviewer_id <> requested_by),
  CHECK (subject_id <> requested_by)
);
CREATE INDEX IF NOT EXISTS idx_office_role_approvals_pending
  ON office_role_approval_requests(organization_id, status, expires_at);
CREATE INDEX IF NOT EXISTS idx_office_role_approvals_subject
  ON office_role_approval_requests(organization_id, subject_id, created_at);

-- Approval requests permit only pending -> decided -> consumed transitions.
-- A consumed token, decision event, target, or role binding cannot be rewritten.
CREATE TRIGGER IF NOT EXISTS office_role_approval_transition_guard
BEFORE UPDATE ON office_role_approval_requests
WHEN NOT (
  (
    OLD.status = 'pending' AND NEW.status IN ('approved', 'rejected') AND
    NEW.id = OLD.id AND NEW.organization_id = OLD.organization_id AND
    NEW.requested_by = OLD.requested_by AND NEW.subject_id = OLD.subject_id AND
    NEW.role = OLD.role AND NEW.scope = OLD.scope AND
    NEW.request_id = OLD.request_id AND NEW.idempotency_key = OLD.idempotency_key AND
    NEW.created_at = OLD.created_at AND NEW.expires_at = OLD.expires_at AND
    NEW.grant_expires_at IS OLD.grant_expires_at AND
    NEW.reviewer_id IS NOT NULL AND NEW.reviewer_id <> OLD.requested_by AND
    NEW.decided_at IS NOT NULL AND NEW.decision_event_id IS NOT NULL AND
    NEW.consumed_at IS NULL AND NEW.consumed_grant_id IS NULL
  ) OR
  (
    OLD.status = 'approved' AND NEW.status = 'consumed' AND
    NEW.id = OLD.id AND NEW.organization_id = OLD.organization_id AND
    NEW.requested_by = OLD.requested_by AND NEW.subject_id = OLD.subject_id AND
    NEW.role = OLD.role AND NEW.scope = OLD.scope AND
    NEW.request_id = OLD.request_id AND NEW.idempotency_key = OLD.idempotency_key AND
    NEW.created_at = OLD.created_at AND NEW.expires_at = OLD.expires_at AND
    NEW.grant_expires_at IS OLD.grant_expires_at AND
    NEW.reviewer_id = OLD.reviewer_id AND NEW.decided_at = OLD.decided_at AND
    NEW.decision_event_id = OLD.decision_event_id AND
    NEW.decision_reason = OLD.decision_reason AND NEW.token_hash = OLD.token_hash AND
    NEW.token_expires_at = OLD.token_expires_at AND
    NEW.consumed_at IS NOT NULL AND NEW.consumed_grant_id IS NOT NULL
  )
)
BEGIN
  SELECT RAISE(ABORT, 'invalid role approval state transition');
END;
