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
role_schema_path = schema_path.with_name("0002_wallet_role_assignments.sql")
connection.executescript(role_schema_path.read_text(encoding="utf-8"))
otp_schema_path = schema_path.with_name("0003_wallet_email_otp.sql")
connection.executescript(otp_schema_path.read_text(encoding="utf-8"))

connection.executemany(
    "INSERT INTO wallet_participants (id, status, created_at, updated_at) VALUES (?, 'active', ?, ?)",
    [
        ("participant-1", "2026-11-04T15:00:00Z", "2026-11-04T15:00:00Z"),
        ("admin-1", "2026-11-04T15:00:00Z", "2026-11-04T15:00:00Z"),
    ],
)
connection.execute(
    "UPDATE wallet_participants SET email_normalized = ? WHERE id = ?",
    ("participant@example.org", "participant-1"),
)
connection.execute(
    """INSERT INTO wallet_auth_sessions
       (token_hmac, participant_id, created_at, expires_at)
       VALUES (?, ?, ?, ?)""",
    ("a" * 64, "participant-1", 100, 200),
)
connection.execute(
    """INSERT INTO wallet_otp_challenges
       (id, email_normalized, code_hmac, attempts, created_at, expires_at)
       VALUES (?, ?, ?, 0, ?, ?)""",
    ("challenge-1", "participant@example.org", "b" * 64, 100, 200),
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

connection.execute(
    """INSERT INTO wallet_role_assignments
       (id, participant_id, role, scope_type, scope_id, assigned_by, assignment_reason, created_at)
       VALUES (?, ?, 'admin', 'global', '', ?, ?, ?)""",
    ("role-admin-1", "participant-1", "admin-1", "Synthetic role grant", "2026-11-04T15:03:00Z"),
)
connection.execute(
    """INSERT INTO wallet_role_assignments
       (id, participant_id, role, scope_type, scope_id, assigned_by, assignment_reason, created_at)
       VALUES (?, ?, 'coordinator', 'project', ?, ?, ?, ?)""",
    ("role-coord-1", "participant-1", "PROJECT-A", "admin-1", "Synthetic project role", "2026-11-04T15:04:00Z"),
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

must_reject(
    """INSERT INTO wallet_role_assignments
       (id, participant_id, role, scope_type, scope_id, assigned_by, assignment_reason, created_at)
       VALUES ('role-duplicate', 'participant-1', 'admin', 'global', '', 'admin-1', 'duplicate grant', '2026-11-04T15:05:00Z')""",
    (),
    "duplicate active role assignment",
)
must_reject(
    """INSERT INTO wallet_role_assignments
       (id, participant_id, role, scope_type, scope_id, assigned_by, assignment_reason, created_at)
       VALUES ('role-admin-project', 'participant-1', 'admin', 'project', 'PROJECT-A', 'admin-1', 'invalid scope', '2026-11-04T15:05:00Z')""",
    (),
    "project-scoped admin assignment",
)
must_reject(
    """INSERT INTO wallet_role_assignments
       (id, participant_id, role, scope_type, scope_id, assigned_by, assignment_reason, status, revoked_at, revoked_by, revocation_reason, created_at)
       VALUES ('role-bad-revoke', 'participant-1', 'coordinator', 'global', '', 'admin-1', 'test', 'revoked', '2026-11-04T15:06:00Z', NULL, NULL, '2026-11-04T15:05:00Z')""",
    (),
    "revocation without actor and reason",
)

connection.close()
print("SQLite schema, role registry, OTP and session smoke checks passed; no D1 database was contacted.")
