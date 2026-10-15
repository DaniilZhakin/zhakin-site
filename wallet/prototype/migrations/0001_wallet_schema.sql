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

-- Ledger rows are append-only. Correct mistakes with a new adjustment/reversal;
-- never UPDATE or DELETE a posted row.
CREATE TABLE IF NOT EXISTS wallet_ledger_entries (
  id TEXT PRIMARY KEY,
  participant_id TEXT NOT NULL REFERENCES wallet_participants(id),
  activity_id TEXT REFERENCES wallet_activities(id),
  entry_type TEXT NOT NULL CHECK (entry_type IN ('accrual', 'reversal', 'adjustment')),
  points INTEGER NOT NULL CHECK (typeof(points) = 'integer' AND points != 0),
  reason TEXT NOT NULL CHECK (length(trim(reason)) > 0),
  actor_id TEXT NOT NULL CHECK (length(trim(actor_id)) > 0),
  idempotency_key TEXT NOT NULL UNIQUE CHECK (length(trim(idempotency_key)) > 0),
  status TEXT NOT NULL DEFAULT 'posted' CHECK (status = 'posted'),
  reversal_of_entry_id TEXT UNIQUE REFERENCES wallet_ledger_entries(id),
  created_at TEXT NOT NULL,
  CHECK (
    (entry_type = 'accrual' AND points > 0 AND activity_id IS NOT NULL AND reversal_of_entry_id IS NULL)
    OR (entry_type = 'reversal' AND points < 0 AND reversal_of_entry_id IS NOT NULL)
    OR (entry_type = 'adjustment' AND reversal_of_entry_id IS NULL)
  )
);

-- At most one accrual for an activity, regardless of retries or later corrections.
CREATE UNIQUE INDEX IF NOT EXISTS idx_wallet_ledger_one_accrual_per_activity
  ON wallet_ledger_entries(activity_id)
  WHERE entry_type = 'accrual';

-- A reversal must fully reverse one positive entry for the same participant.
CREATE TRIGGER IF NOT EXISTS trg_wallet_ledger_validate_reversal
BEFORE INSERT ON wallet_ledger_entries
WHEN NEW.entry_type = 'reversal'
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM wallet_ledger_entries original
    WHERE original.id = NEW.reversal_of_entry_id
      AND original.participant_id = NEW.participant_id
      AND original.points > 0
      AND original.entry_type IN ('accrual', 'adjustment')
      AND NEW.points = -original.points
  ) THEN RAISE(ABORT, 'invalid reversal target or amount') END;
END;

-- Reversal entries themselves cannot be reversed by this simple prototype model.
CREATE TRIGGER IF NOT EXISTS trg_wallet_ledger_no_reversal_of_reversal
BEFORE INSERT ON wallet_ledger_entries
WHEN NEW.entry_type = 'reversal'
 AND EXISTS (
   SELECT 1 FROM wallet_ledger_entries original
   WHERE original.id = NEW.reversal_of_entry_id
     AND original.entry_type = 'reversal'
 )
BEGIN
  SELECT RAISE(ABORT, 'cannot reverse a reversal entry');
END;

CREATE TRIGGER IF NOT EXISTS trg_wallet_ledger_no_update
BEFORE UPDATE ON wallet_ledger_entries
BEGIN
  SELECT RAISE(ABORT, 'ledger entries are append-only');
END;

CREATE TRIGGER IF NOT EXISTS trg_wallet_ledger_no_delete
BEFORE DELETE ON wallet_ledger_entries
BEGIN
  SELECT RAISE(ABORT, 'ledger entries are append-only');
END;

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

CREATE TRIGGER IF NOT EXISTS trg_wallet_audit_no_update
BEFORE UPDATE ON wallet_audit_events
BEGIN
  SELECT RAISE(ABORT, 'audit events are append-only');
END;

CREATE TRIGGER IF NOT EXISTS trg_wallet_audit_no_delete
BEFORE DELETE ON wallet_audit_events
BEGIN
  SELECT RAISE(ABORT, 'audit events are append-only');
END;

CREATE INDEX IF NOT EXISTS idx_wallet_activities_participant_status
  ON wallet_activities(participant_id, status);
CREATE INDEX IF NOT EXISTS idx_wallet_ledger_participant_created
  ON wallet_ledger_entries(participant_id, created_at);
CREATE INDEX IF NOT EXISTS idx_wallet_audit_target_created
  ON wallet_audit_events(target_type, target_id, created_at);
