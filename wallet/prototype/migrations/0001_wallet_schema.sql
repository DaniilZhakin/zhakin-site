-- ZHAKIN Wallet prototype schema (SQLite / Cloudflare D1 compatible).
-- NOT applied to any database. Synthetic prototype only.
-- Do not use for production until auth, authorization, transactional workflows,
-- retention rules, backup/restore and security review are complete.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS wallet_participants (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'suspended', 'closed')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS wallet_activities (
  id TEXT PRIMARY KEY,
  participant_id TEXT NOT NULL REFERENCES wallet_participants(id),
  project_code TEXT NOT NULL,
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'submitted'
    CHECK (status IN ('draft', 'submitted', 'under_review', 'approved', 'rejected', 'cancelled')),
  points_awarded INTEGER CHECK (points_awarded IS NULL OR points_awarded > 0),
  submitted_at TEXT NOT NULL,
  reviewed_at TEXT,
  reviewed_by TEXT,
  review_reason TEXT
);

CREATE TABLE IF NOT EXISTS wallet_ledger_entries (
  id TEXT PRIMARY KEY,
  participant_id TEXT NOT NULL REFERENCES wallet_participants(id),
  activity_id TEXT REFERENCES wallet_activities(id),
  entry_type TEXT NOT NULL CHECK (entry_type IN ('accrual', 'reversal', 'adjustment')),
  points INTEGER NOT NULL CHECK (typeof(points) = 'integer' AND points != 0),
  reason TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'posted'
    CHECK (status IN ('posted', 'voided')),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS wallet_audit_events (
  id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  reason TEXT,
  outcome TEXT NOT NULL CHECK (outcome IN ('success', 'denied', 'failed')),
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_wallet_activities_participant_status
  ON wallet_activities(participant_id, status);
CREATE INDEX IF NOT EXISTS idx_wallet_ledger_participant_created
  ON wallet_ledger_entries(participant_id, created_at);
CREATE INDEX IF NOT EXISTS idx_wallet_audit_target_created
  ON wallet_audit_events(target_type, target_id, created_at);
