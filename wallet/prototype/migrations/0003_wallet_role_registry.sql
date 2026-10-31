-- Server-side Wallet role registry for administrators and coordinators.
-- Prototype migration only; not applied to any live D1 database.
-- Role assignment/revocation requires a separately authorized human workflow.
CREATE TABLE IF NOT EXISTS wallet_participant_roles (
  id TEXT PRIMARY KEY,
  participant_id TEXT NOT NULL REFERENCES wallet_participants(id),
  role TEXT NOT NULL CHECK (role IN ('admin', 'coordinator')),
  scope TEXT NOT NULL DEFAULT 'wallet',
  granted_by TEXT NOT NULL,
  granted_at INTEGER NOT NULL,
  expires_at INTEGER,
  revoked_at INTEGER,
  CHECK (expires_at IS NULL OR expires_at > granted_at),
  CHECK (revoked_at IS NULL OR revoked_at >= granted_at)
);

CREATE INDEX IF NOT EXISTS idx_wallet_roles_participant_active
  ON wallet_participant_roles(participant_id, role, expires_at, revoked_at);
