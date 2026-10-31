-- Explicit revocation ledger for approved, unconsumed role credentials.
-- Apply only to isolated/test databases until independent security review.
CREATE TABLE IF NOT EXISTS office_role_approval_revocations (
  approval_request_id TEXT PRIMARY KEY
    REFERENCES office_role_approval_requests(id),
  organization_id TEXT NOT NULL REFERENCES office_organizations(id),
  revoked_by TEXT NOT NULL,
  revoked_at INTEGER NOT NULL,
  request_id TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '' CHECK (length(reason) <= 1000)
);
CREATE INDEX IF NOT EXISTS idx_office_role_approval_revocations_org_time
  ON office_role_approval_revocations(organization_id, revoked_at);

CREATE TRIGGER IF NOT EXISTS office_role_approval_revocation_no_update
BEFORE UPDATE ON office_role_approval_revocations
BEGIN
  SELECT RAISE(ABORT, 'approval revocation records are immutable');
END;

CREATE TRIGGER IF NOT EXISTS office_role_approval_revocation_no_delete
BEFORE DELETE ON office_role_approval_revocations
BEGIN
  SELECT RAISE(ABORT, 'approval revocation records are immutable');
END;

CREATE TRIGGER IF NOT EXISTS office_role_approval_revocation_validate_insert
BEFORE INSERT ON office_role_approval_revocations
WHEN NOT EXISTS (
  SELECT 1 FROM office_role_approval_requests r
  WHERE r.id = NEW.approval_request_id
    AND r.organization_id = NEW.organization_id
    AND r.requested_by = NEW.revoked_by
    AND r.status = 'approved'
)
BEGIN
  SELECT RAISE(ABORT, 'only the original requester may revoke an approved credential');
END;
