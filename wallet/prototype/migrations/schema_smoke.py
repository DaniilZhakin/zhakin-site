"""Local SQLite compatibility smoke test for the unapplied Wallet schema.

This is not a Cloudflare D1 integration test. It validates SQL constraints and
basic ledger invariants using Python's standard-library SQLite engine.
"""
from pathlib import Path
import sqlite3

schema_path = Path(__file__).with_name("0001_wallet_schema.sql")
connection = sqlite3.connect(":memory:")
connection.execute("PRAGMA foreign_keys = ON")
base_schema = schema_path.read_text(encoding="utf-8")
assert "PRAGMA foreign_keys" not in base_schema.upper(), (
    "base migration must rely on D1-enforced foreign keys, not toggle PRAGMA"
)
connection.executescript(base_schema)
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

# Additional auth-schema and referential-integrity checks.
# All checks run against the in-memory SQLite database above.
must_reject(
    """INSERT INTO wallet_participants
       (id, status, created_at, updated_at, email_normalized)
       VALUES ('participant-duplicate-email', 'active', '2026-11-04T15:00:00Z',
               '2026-11-04T15:00:00Z', 'participant@example.org')""",
    (),
    "duplicate normalized participant email",
)

must_reject(
    """INSERT INTO wallet_otp_challenges
       (id, email_normalized, code_hmac, attempts, created_at, expires_at)
       VALUES ('challenge-bad-expiry', 'participant@example.org', ?, 0, 200, 200)""",
    ("c" * 64,),
    "OTP challenge with non-positive lifetime",
)
must_reject(
    """INSERT INTO wallet_otp_challenges
       (id, email_normalized, code_hmac, attempts, created_at, expires_at)
       VALUES ('challenge-too-many-attempts', 'participant@example.org', ?, 6, 100, 200)""",
    ("d" * 64,),
    "OTP challenge above attempt limit",
)
must_reject(
    """INSERT INTO wallet_auth_sessions
       (token_hmac, participant_id, created_at, expires_at)
       VALUES (?, 'participant-1', 200, 200)""",
    ("f" * 64,),
    "session with non-positive lifetime",
)
must_reject(
    """INSERT INTO wallet_auth_rate_limits
       (subject_hmac, window_started_at, request_count)
       VALUES (?, 100, -1)""",
    ("1" * 64,),
    "negative authentication rate counter",
)

connection.execute(
    """INSERT INTO wallet_auth_rate_limits
       (subject_hmac, window_started_at, request_count)
       VALUES (?, 100, 2)""",
    ("2" * 64,),
)
must_reject(
    """INSERT INTO wallet_auth_rate_limits
       (subject_hmac, window_started_at, request_count)
       VALUES (?, 100, 3)""",
    ("2" * 64,),
    "duplicate rate-limit window key",
)

foreign_key_errors = connection.execute("PRAGMA foreign_key_check").fetchall()
assert not foreign_key_errors, f"foreign key violations: {foreign_key_errors}"

required_tables = {
    "wallet_participants",
    "wallet_activities",
    "wallet_ledger_entries",
    "wallet_audit_events",
    "wallet_role_assignments",
    "wallet_otp_challenges",
    "wallet_auth_sessions",
    "wallet_auth_rate_limits",
}
actual_tables = {
    row[0]
    for row in connection.execute(
        "SELECT name FROM sqlite_master WHERE type = 'table'"
    ).fetchall()
}
missing_tables = required_tables - actual_tables
assert not missing_tables, f"migration sequence missing tables: {sorted(missing_tables)}"

required_indexes = {
    "idx_wallet_participants_email_normalized",
    "idx_wallet_role_active_unique",
    "idx_wallet_otp_email_created",
    "idx_wallet_otp_expiry",
    "idx_wallet_sessions_participant_expiry",
}
actual_indexes = {
    row[0]
    for row in connection.execute(
        "SELECT name FROM sqlite_master WHERE type = 'index'"
    ).fetchall()
}
missing_indexes = required_indexes - actual_indexes
assert not missing_indexes, f"migration sequence missing indexes: {sorted(missing_indexes)}"



# Execute the same SQL shapes used by d1-auth-repository.js against SQLite.
# This verifies query semantics, not Cloudflare D1 runtime or concurrency behavior.
RATE_WINDOW_MS = 15 * 60 * 1000
EMAIL_REQUEST_LIMIT = 3
SOURCE_REQUEST_LIMIT = 10
rate_sql = (
    "INSERT INTO wallet_auth_rate_limits "
    "(subject_hmac, window_started_at, request_count) "
    "SELECT subjects.subject_hmac, ?, 1 "
    "FROM (SELECT ? AS subject_hmac UNION ALL SELECT ?) AS subjects "
    "WHERE NOT EXISTS ("
    "SELECT 1 FROM wallet_auth_rate_limits existing "
    "WHERE existing.window_started_at = ? AND ("
    "(existing.subject_hmac = ? AND existing.request_count >= ?) OR "
    "(existing.subject_hmac = ? AND existing.request_count >= ?))) "
    "ON CONFLICT(subject_hmac, window_started_at) DO UPDATE SET "
    "request_count = request_count + 1 RETURNING subject_hmac"
)

def attempt_rate_window(email_key, source_key, timestamp):
    window = (timestamp // RATE_WINDOW_MS) * RATE_WINDOW_MS
    rows = connection.execute(
        rate_sql,
        (window, email_key, source_key, window,
         email_key, EMAIL_REQUEST_LIMIT, source_key, SOURCE_REQUEST_LIMIT),
    ).fetchall()
    return len(rows) == 2

rate_time = 1_800_000_000_000
email_subject = "e" * 64
source_subject = "s" * 64
assert attempt_rate_window(email_subject, source_subject, rate_time)
assert attempt_rate_window(email_subject, source_subject, rate_time + 1)
assert attempt_rate_window(email_subject, source_subject, rate_time + 2)
assert not attempt_rate_window(email_subject, source_subject, rate_time + 3)
rate_window = (rate_time // RATE_WINDOW_MS) * RATE_WINDOW_MS
email_count = connection.execute(
    "SELECT request_count FROM wallet_auth_rate_limits "
    "WHERE subject_hmac = ? AND window_started_at = ?",
    (email_subject, rate_window),
).fetchone()[0]
source_count = connection.execute(
    "SELECT request_count FROM wallet_auth_rate_limits "
    "WHERE subject_hmac = ? AND window_started_at = ?",
    (source_subject, rate_window),
).fetchone()[0]
assert email_count == 3 and source_count == 3, (
    f"rate-limit threshold changed counters unexpectedly: {email_count}, {source_count}"
)

# Verify the source-level limit independently while each email subject is new.
shared_source = "t" * 64
for index in range(SOURCE_REQUEST_LIMIT):
    unique_email = format(index + 1, "064x")
    assert attempt_rate_window(unique_email, shared_source, rate_time)
assert not attempt_rate_window("f" * 64, shared_source, rate_time)
source_count = connection.execute(
    "SELECT request_count FROM wallet_auth_rate_limits "
    "WHERE subject_hmac = ? AND window_started_at = ?",
    (shared_source, rate_window),
).fetchone()[0]
assert source_count == SOURCE_REQUEST_LIMIT, (
    f"source rate-limit threshold changed unexpectedly: {source_count}"
)

consume_sql = (
    "UPDATE wallet_otp_challenges SET "
    "attempts = attempts + 1, "
    "consumed_at = CASE WHEN code_hmac = ? THEN ? ELSE consumed_at END "
    "WHERE id = ? AND revoked_at IS NULL AND consumed_at IS NULL "
    "AND expires_at > ? AND attempts < ? "
    "RETURNING CASE WHEN code_hmac = ? THEN email_normalized ELSE NULL END AS email"
)
consumed = connection.execute(
    consume_sql, ("b" * 64, 150, "challenge-1", 150, 5, "b" * 64)
).fetchone()
assert consumed == ("participant@example.org",), f"valid OTP not consumed: {consumed}"
replayed = connection.execute(
    consume_sql, ("b" * 64, 151, "challenge-1", 151, 5, "b" * 64)
).fetchone()
assert replayed is None, f"replayed OTP was accepted: {replayed}"

connection.execute(
    "INSERT INTO wallet_otp_challenges "
    "(id, email_normalized, code_hmac, attempts, created_at, expires_at) "
    "VALUES ('challenge-wrong-attempts', 'participant@example.org', ?, 0, 100, 300)",
    ("c" * 64,),
)
for attempt in range(5):
    wrong = connection.execute(
        consume_sql, ("d" * 64, 160 + attempt, "challenge-wrong-attempts",
                      160 + attempt, 5, "d" * 64)
    ).fetchone()
    assert wrong == (None,), f"wrong OTP returned an unexpected identity on attempt {attempt + 1}: {wrong}"
attempts = connection.execute(
    "SELECT attempts FROM wallet_otp_challenges WHERE id = 'challenge-wrong-attempts'"
).fetchone()[0]
assert attempts == 5, f"failed OTP attempts not counted: {attempts}"
exhausted = connection.execute(
    consume_sql, ("c" * 64, 170, "challenge-wrong-attempts", 170, 5, "c" * 64)
).fetchone()
assert exhausted is None, f"OTP authenticated after attempt limit: {exhausted}"

connection.close()
print("SQLite schema, constraints, rate-limit query semantics, OTP replay/attempt semantics, indexes and foreign-key smoke checks passed; no D1 database was contacted.")
