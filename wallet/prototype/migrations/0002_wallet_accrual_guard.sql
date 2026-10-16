-- Prevent more than one accrual entry for a single activity.
-- NOT applied to any database. Review existing rows before applying anywhere.
-- Reversals remain separate entries and must be explicitly authorized.
CREATE UNIQUE INDEX IF NOT EXISTS idx_wallet_one_accrual_per_activity
  ON wallet_ledger_entries(activity_id)
  WHERE entry_type = 'accrual' AND activity_id IS NOT NULL;
