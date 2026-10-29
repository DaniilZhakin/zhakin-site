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
  points INTEGER NOT NULL CHECK (
    typeof(points) = 'integer' AND points != 0 AND
    ((entry_type = 'accrual' AND points > 0) OR
     (entry_type = 'reversal' AND points < 0) OR
     (entry_type = 'adjustment' AND points != 0))
  ),
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


-- Prevent a ledger entry from being attached to an activity owned by another participant.
-- This is a database-level invariant, not a substitute for request authorization.
CREATE TRIGGER IF NOT EXISTS trg_wallet_ledger_activity_owner
BEFORE INSERT ON wallet_ledger_entries
WHEN NEW.activity_id IS NOT NULL AND NOT EXISTS (
  SELECT 1
  FROM wallet_activities AS activity
  WHERE activity.id = NEW.activity_id
    AND activity.participant_id = NEW.participant_id
)
BEGIN
  SELECT RAISE(ABORT, 'wallet activity participant mismatch');
END;


-- Ledger identity and ownership are immutable; only lifecycle status may change.
CREATE TRIGGER IF NOT EXISTS trg_wallet_ledger_identity_immutable
BEFORE UPDATE OF participant_id, activity_id, id, idempotency_key
ON wallet_ledger_entries
WHEN NEW.participant_id != OLD.participant_id
  OR NEW.activity_id IS NOT OLD.activity_id
  OR NEW.id != OLD.id
  OR NEW.idempotency_key != OLD.idempotency_key
BEGIN
  SELECT RAISE(ABORT, 'wallet ledger identity is immutable');
END;
