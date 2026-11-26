-- Server-side role registry for ZHAKIN Wallet prototype.
-- Not applied to any D1 database. Role claims must be resolved server-side.
-- Grant/revoke operations must be audited by the trusted application layer.

CREATE TABLE IF NOT EXISTS wallet_role_assignments (
  id TEXT PRIMARY KEY,
  participant_id TEXT NOT NULL REFERENCES wallet_participants(id),
  role TEXT NOT NULL CHECK (role IN ('admin', 'coordinator')),
  scope_type TEXT NOT NULL DEFAULT 'global'
    CHECK (scope_type IN ('global', 'project')),
  scope_id TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'revoked')),
  assigned_by TEXT NOT NULL REFERENCES wallet_participants(id),
  assignment_reason TEXT NOT NULL CHECK (length(trim(assignment_reason)) > 0),
  created_at TEXT NOT NULL,
  revoked_at TEXT,
  revoked_by TEXT REFERENCES wallet_participants(id),
  revocation_reason TEXT,
  CHECK (
    (scope_type = 'global' AND scope_id = '') OR
    (scope_type = 'project' AND length(trim(scope_id)) > 0)
  ),
  CHECK (role <> 'admin' OR scope_type = 'global'),
  CHECK (
    (status = 'active' AND revoked_at IS NULL AND revoked_by IS NULL AND revocation_reason IS NULL) OR
    (status = 'revoked' AND revoked_at IS NOT NULL AND revoked_by IS NOT NULL
      AND length(trim(COALESCE(revocation_reason, ''))) > 0)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_wallet_role_active_unique
  ON wallet_role_assignments(participant_id, role, scope_type, scope_id)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_wallet_role_participant_status
  ON wallet_role_assignments(participant_id, status, role);
