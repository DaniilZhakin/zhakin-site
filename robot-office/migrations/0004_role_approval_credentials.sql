-- Encrypted delivery envelope for human-approved role credentials.
-- Apply only to isolated/test databases until the complete security review is accepted.
CREATE TABLE IF NOT EXISTS office_role_approval_credentials (
  approval_request_id TEXT PRIMARY KEY
    REFERENCES office_role_approval_requests(id) ON DELETE CASCADE,
  organization_id TEXT NOT NULL REFERENCES office_organizations(id),
  iv TEXT NOT NULL CHECK (length(iv) BETWEEN 12 AND 32),
  ciphertext TEXT NOT NULL CHECK (length(ciphertext) BETWEEN 1 AND 512),
  key_version TEXT NOT NULL CHECK (key_version = 'v1'),
  created_at INTEGER NOT NULL,
  retrieval_key_hash TEXT,
  retrieved_at INTEGER,
  recovery_until INTEGER,
  CHECK (
    (retrieval_key_hash IS NULL AND retrieved_at IS NULL AND recovery_until IS NULL) OR
    (retrieval_key_hash IS NOT NULL AND retrieved_at IS NOT NULL AND recovery_until IS NOT NULL
      AND recovery_until > retrieved_at)
  )
);
CREATE INDEX IF NOT EXISTS idx_office_role_approval_credentials_recovery
  ON office_role_approval_credentials(organization_id, recovery_until);

-- Envelope contents are immutable. Retrieval metadata may transition once from
-- unclaimed to claimed and can never be rotated or rewritten.
CREATE TRIGGER IF NOT EXISTS office_role_approval_credential_guard
BEFORE UPDATE ON office_role_approval_credentials
WHEN
  NEW.approval_request_id <> OLD.approval_request_id OR
  NEW.organization_id <> OLD.organization_id OR
  NEW.iv <> OLD.iv OR NEW.ciphertext <> OLD.ciphertext OR
  NEW.key_version <> OLD.key_version OR NEW.created_at <> OLD.created_at OR
  OLD.retrieval_key_hash IS NOT NULL OR
  (OLD.retrieval_key_hash IS NULL AND (
    NEW.retrieval_key_hash IS NULL OR NEW.retrieved_at IS NULL OR
    NEW.recovery_until IS NULL OR NEW.recovery_until <= NEW.retrieved_at
  ))
BEGIN
  SELECT RAISE(ABORT, 'invalid approval credential envelope update');
END;
