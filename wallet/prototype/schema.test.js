import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const schemaUrl = new URL("./migrations/0001_wallet_schema.sql", import.meta.url);
const schema = await readFile(schemaUrl, "utf8");

test("ledger schema restricts entry types and sign rules", () => {
  assert.match(schema, /entry_type IN \('accrual', 'reversal', 'adjustment'\)/);
  assert.match(schema, /entry_type = 'accrual' AND points > 0 AND activity_id IS NOT NULL/);
  assert.match(schema, /entry_type = 'reversal' AND points < 0 AND reversal_of_entry_id IS NOT NULL/);
  assert.match(schema, /typeof\(points\) = 'integer' AND points != 0/);
});

test("ledger schema prevents duplicate accruals for the same activity", () => {
  assert.match(schema, /CREATE UNIQUE INDEX IF NOT EXISTS idx_wallet_ledger_one_accrual_per_activity/);
  assert.match(schema, /ON wallet_ledger_entries\(activity_id\)\s+WHERE entry_type = 'accrual'/);
  assert.match(schema, /idempotency_key TEXT NOT NULL UNIQUE/);
});

test("reversals must target an equal positive entry for the same participant", () => {
  assert.match(schema, /trg_wallet_ledger_validate_reversal/);
  assert.match(schema, /original\.participant_id = NEW\.participant_id/);
  assert.match(schema, /NEW\.points = -original\.points/);
  assert.match(schema, /reversal_of_entry_id TEXT UNIQUE REFERENCES wallet_ledger_entries\(id\)/);
});

test("ledger and audit rows are append-only", () => {
  assert.match(schema, /trg_wallet_ledger_no_update[\s\S]*?BEFORE UPDATE ON wallet_ledger_entries/);
  assert.match(schema, /trg_wallet_ledger_no_delete[\s\S]*?BEFORE DELETE ON wallet_ledger_entries/);
  assert.match(schema, /trg_wallet_audit_no_update[\s\S]*?BEFORE UPDATE ON wallet_audit_events/);
  assert.match(schema, /trg_wallet_audit_no_delete[\s\S]*?BEFORE DELETE ON wallet_audit_events/);
});
