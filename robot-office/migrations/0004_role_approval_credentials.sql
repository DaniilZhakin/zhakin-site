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
