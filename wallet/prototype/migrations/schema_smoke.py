"""Local SQLite compatibility smoke test for the unapplied Wallet schema.

This is not a Cloudflare D1 integration test. It validates SQL constraints and
basic ledger invariants using Python's standard-library SQLite engine.
"""
from pathlib import Path
import sqlite3

schema_path = Path(__file__).with_name("0001_wallet_schema.sql")
connection = sqlite3.connect(":memory:")
connection.execute("PRAGMA foreign_keys = ON")
connection.executescript(schema_path.read_text(encoding="utf-8"))

connection.execute(
    "INSERT INTO wallet_participants (id, status, created_at, updated_at) VALUES (?, 'active', ?, ?)",
    ("participant-1", "2026-11-04T15:00:00Z", "2026-11-04T15:00:00Z"),
)
connection.execute(
    """INSERT INTO wallet_activities
       (id, participant_id, project_code, description, status, submitted_at)
       VALUES (?, ?, ?, ?, 'approved', ?)""",
    ("activity-1", "participant-1", "DEMO", "Synthetic approved activity", "2026-11-04T15:01:00Z"),
)
connection.execute(
    """INSERT INTO wallet_ledger_entries
       (id, participant_id, activity_id, entry_type, points, reason, actor_id,
        idempotency_key, status, created_at)
       VALUES (?, ?, ?, 'accrual', 100, ?, ?, ?, 'posted', ?)""",
    ("ledger-1", "participant-1", "activity-1", "Synthetic test", "admin-1", "idem-1", "2026-11-04T15:02:00Z"),
)
connection.execute(
    """INSERT INTO wallet_audit_events
       (id, actor_id, action, target_type, target_id, reason, outcome, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'success', ?)""",
    ("audit-1", "admin-1", "ledger.accrual", "wallet_ledger_entry", "ledger-1", "Synthetic test", "2026-11-04T15:02:00Z"),
)

balance = connection.execute(
    "SELECT COALESCE(SUM(points), 0) FROM wallet_ledger_entries WHERE participant_id = ? AND status = 'posted'",
    ("participant-1",),
).fetchone()[0]
assert balance == 100, f"unexpected posted balance: {balance}"

def must_reject(sql, params, label):
    try:
        connection.execute(sql, params)
    except sqlite3.IntegrityError:
        return
    raise AssertionError(f"schema did not reject {label}")

must_reject(
    """INSERT INTO wallet_ledger_entries
       (id, participant_id, entry_type, points, reason, actor_id, idempotency_key, created_at)
       VALUES ('ledger-duplicate', 'participant-1', 'accrual', 1, 'test', 'admin-1', 'idem-1', '2026-11-04T15:03:00Z')""",
    (),
    "duplicate idempotency key",
)
must_reject(
    """INSERT INTO wallet_ledger_entries
       (id, participant_id, entry_type, points, reason, actor_id, idempotency_key, created_at)
       VALUES ('ledger-fk', 'missing-participant', 'accrual', 1, 'test', 'admin-1', 'idem-fk', '2026-11-04T15:03:00Z')""",
    (),
    "unknown participant foreign key",
)
must_reject(
    """INSERT INTO wallet_ledger_entries
       (id, participant_id, entry_type, points, reason, actor_id, idempotency_key, created_at)
       VALUES ('ledger-fraction', 'participant-1', 'accrual', 1.5, 'test', 'admin-1', 'idem-fraction', '2026-11-04T15:03:00Z')""",
    (),
    "fractional points",
)

connection.close()
print("SQLite schema smoke checks passed; no D1 database was contacted.")
