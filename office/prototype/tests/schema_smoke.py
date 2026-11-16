#!/usr/bin/env python3
"""Isolated OFFICE_DB schema smoke test; uses only in-memory SQLite."""
from pathlib import Path
import sqlite3

ROOT = Path(__file__).resolve().parents[2]
MIGRATION = ROOT / "migrations" / "0001_office_core.sql"


def expect_integrity_error(connection, statement, params=()):
    try:
        connection.execute(statement, params)
    except sqlite3.IntegrityError:
        return
    raise AssertionError(f"Expected IntegrityError for: {statement}")


def main():
    sql = MIGRATION.read_text(encoding="utf-8")
    db = sqlite3.connect(":memory:")
    db.execute("PRAGMA foreign_keys = ON")
    db.executescript(sql)
    assert db.execute("PRAGMA foreign_keys").fetchone()[0] == 1

    tables = {
        row[0] for row in db.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'office_%'"
        )
    }
    required = {
        "office_organizations", "office_users", "office_roles", "office_projects",
        "office_user_role_scopes", "office_tasks", "office_decisions",
        "office_approval_requests", "office_audit_events", "office_evidence_files",
    }
    assert required <= tables, f"Missing tables: {required - tables}"

    db.execute("INSERT INTO office_organizations(id, name) VALUES ('org-a', 'Org A')")
    db.execute("INSERT INTO office_organizations(id, name) VALUES ('org-b', 'Org B')")
    db.execute(
        """INSERT INTO office_users
           (id, identity_provider, provider_subject, email_normalized,
            email_verified_at, display_name)
           VALUES ('user-a', 'https://issuer.example', 'subject-a',
                   'a@example.test', '2026-11-16T00:00:00Z', 'User A')"""
    )
    db.execute(
        """INSERT INTO office_users
           (id, identity_provider, provider_subject, display_name)
           VALUES ('user-b', 'https://issuer.example', 'subject-b', 'User B')"""
    )
    db.execute(
        """INSERT INTO office_projects(id, organization_id, code, title, owner_user_id)
           VALUES ('project-a', 'org-a', 'A-1', 'Project A', 'user-a')"""
    )

    # Provider identity is unique; unverified email is not a verified identity.
    expect_integrity_error(
        db,
        """INSERT INTO office_users
           (id, identity_provider, provider_subject, display_name)
           VALUES ('user-duplicate', 'https://issuer.example', 'subject-a', 'Duplicate')""",
    )
    expect_integrity_error(
        db,
        """INSERT INTO office_users
           (id, identity_provider, provider_subject, email_normalized,
            email_verified_at, display_name)
           VALUES ('user-email-duplicate', 'https://issuer.example', 'subject-c',
                   'a@example.test', '2026-11-16T00:00:00Z', 'Duplicate email')""",
    )

    # Composite foreign key prevents cross-organization project references.
    expect_integrity_error(
        db,
        """INSERT INTO office_tasks
           (id, organization_id, project_id, title, created_by_user_id)
           VALUES ('task-cross-org', 'org-b', 'project-a', 'Invalid scope', 'user-a')""",
    )

    # Scoped role cannot reference a project in another organization.
    expect_integrity_error(
        db,
        """INSERT INTO office_user_role_scopes
           (id, user_id, organization_id, project_id, role_id,
            granted_by_user_id, valid_from)
           VALUES ('grant-invalid', 'user-a', 'org-b', 'project-a',
                   'role_coordinator', 'user-b', '2026-11-16T00:00:00Z')""",
    )

    # Initiator cannot be their own approver.
    expect_integrity_error(
        db,
        """INSERT INTO office_approval_requests
           (id, organization_id, object_type, object_id, object_version,
            action, requested_by_user_id, approver_user_id)
           VALUES ('approval-self', 'org-a', 'decision', 'decision-a', 1,
                   'approve', 'user-a', 'user-a')""",
    )

    # A completed task must carry a completion timestamp.
    expect_integrity_error(
        db,
        """INSERT INTO office_tasks
           (id, organization_id, project_id, title, created_by_user_id, status)
           VALUES ('task-no-completion', 'org-a', 'project-a', 'No completion',
                   'user-a', 'done')""",
    )

    db.execute(
        """INSERT INTO office_audit_events
           (id, organization_id, actor_user_id, action, object_type,
            object_id, request_id, outcome)
           VALUES ('audit-1', 'org-a', 'user-a', 'task.create', 'task',
                   'task-a', 'request-1', 'success')"""
    )
    expect_integrity_error(db, "UPDATE office_audit_events SET outcome='failed' WHERE id='audit-1'")
    expect_integrity_error(db, "DELETE FROM office_audit_events WHERE id='audit-1'")

    fk_violations = db.execute("PRAGMA foreign_key_check").fetchall()
    assert not fk_violations, f"Foreign-key violations: {fk_violations}"

    print("OFFICE_DB schema smoke test: PASS")
    print(f"Tables verified: {len(required)}")
    print("Constraints verified: identity uniqueness, verified-email uniqueness, "
          "organization/project isolation, role scope, separation of duties, "
          "task completion, append-only audit, foreign keys")


if __name__ == "__main__":
    main()
