#!/usr/bin/env python3
"""Apply the prototype schema chain to isolated in-memory SQLite and verify constraints."""
from pathlib import Path
import sqlite3

MIGRATIONS = (
    "0001_wallet_schema.sql",
    "0002_wallet_email_otp.sql",
    "0003_wallet_role_registry.sql",
)

def main() -> None:
    root = Path(__file__).resolve().parent
    db = sqlite3.connect(":memory:")
    db.execute("PRAGMA foreign_keys = ON")

    for migration in MIGRATIONS:
        db.executescript((root / migration).read_text(encoding="utf-8"))

    db.execute(
        "INSERT INTO wallet_participants (id, created_at, updated_at) VALUES (?, ?, ?)",
        ("p1", "2026-10-31T00:00:00Z", "2026-10-31T00:00:00Z"),
    )
    db.execute(
        "UPDATE wallet_participants SET email_normalized = ? WHERE id = ?",
        ("member@example.org", "p1"),
    )
    try:
        db.execute(
            "INSERT INTO wallet_participants (id, email_normalized, created_at, updated_at) "
            "VALUES (?, ?, ?, ?)",
            ("p2", "member@example.org", "2026-10-31T00:00:00Z", "2026-10-31T00:00:00Z"),
        )
    except sqlite3.IntegrityError:
        pass
    else:
        raise AssertionError("normalized participant email must be unique")

    db.execute(
        "INSERT INTO wallet_auth_sessions (token_hmac, participant_id, created_at, expires_at) "
        "VALUES (?, ?, ?, ?)",
        ("a" * 64, "p1", 100, 200),
    )
    db.execute(
        "INSERT INTO wallet_participant_roles "
        "(id, participant_id, role, scope, granted_by, granted_at) "
        "VALUES (?, ?, ?, ?, ?, ?)",
        ("r1", "p1", "admin", "wallet", "human-admin", 100),
    )
    db.execute(
        "INSERT INTO wallet_participant_roles "
        "(id, participant_id, role, scope, granted_by, granted_at) "
        "VALUES (?, ?, ?, ?, ?, ?)",
        ("r2", "p1", "admin", "other-system", "human-admin", 100),
    )

    rows = db.execute(
        "SELECT role FROM wallet_participant_roles "
        "WHERE participant_id = ? AND scope = 'wallet' AND granted_at <= ? "
        "AND (expires_at IS NULL OR expires_at > ?) AND revoked_at IS NULL",
        ("p1", 150, 150),
    ).fetchall()
    assert rows == [("admin",)], f"out-of-scope grant leaked into Wallet: {rows!r}"

    try:
        db.execute(
            "INSERT INTO wallet_participant_roles "
            "(id, participant_id, role, scope, granted_by, granted_at, expires_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            ("r3", "p1", "coordinator", "wallet", "human-admin", 100, 100),
        )
    except sqlite3.IntegrityError:
        pass
    else:
        raise AssertionError("role expiry must be later than grant time")

    try:
        db.execute(
            "INSERT INTO wallet_participant_roles "
            "(id, participant_id, role, scope, granted_by, granted_at) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            ("r4", "missing-participant", "admin", "wallet", "human-admin", 100),
        )
    except sqlite3.IntegrityError:
        pass
    else:
        raise AssertionError("role grants must reference an existing participant")

    db.close()
    print("SQLite migration chain 0001 -> 0002 -> 0003: PASS")

if __name__ == "__main__":
    main()
