#!/usr/bin/env python3
"""SQLite-only checks for the guarded robot proposal inbox; no live data."""
from pathlib import Path
import sqlite3
import unittest

ROOT = Path(__file__).resolve().parents[1]
MIGRATIONS = ROOT / "migrations"
NOW = "2026-11-16T12:00:00.000Z"


class RobotProposalTests(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(":memory:")
        self.db.execute("PRAGMA foreign_keys = ON")
        for migration in ("0001_office_core.sql", "0002_robot_service_principals.sql",
                          "0003_robot_task_proposals.sql", "0004_human_proposal_approval.sql"):
            self.db.executescript((MIGRATIONS / migration).read_text())
        self.db.execute("INSERT INTO office_organizations(id,name) VALUES ('org-a','Org A')")
        for user_id, subject in (("human-a", "a"), ("human-b", "b")):
            self.db.execute("""INSERT INTO office_users
              (id,identity_provider,provider_subject,display_name)
              VALUES (?, 'issuer', ?, ?)""", (user_id, subject, user_id))
        self.db.execute("""INSERT INTO office_projects(id,organization_id,code,title)
          VALUES ('project-a','org-a','P-A','Project A')""")
        self.db.execute("""INSERT INTO office_tasks
          (id,organization_id,project_id,title,created_by_user_id,version,status)
          VALUES ('task-a','org-a','project-a','Task A','human-a',3,'in_progress')""")
        self.db.execute("""INSERT INTO office_service_principals
          (id,organization_id,code,display_name,identity_issuer,identity_subject,
           status,credential_ref,valid_from,created_by_user_id,approved_by_user_id,approved_at)
          VALUES ('robot-a','org-a','robot-a','Robot A','robot-issuer','robot-subject',
          'active','vault-ref:robot-a',?,?,?,?)""",
          (NOW, "human-a", "human-b", NOW))
        self.db.execute("""INSERT INTO office_service_capability_scopes
          (id,service_principal_id,organization_id,project_id,task_id,capability_code,
           granted_by_user_id,approved_by_user_id,valid_from)
          VALUES ('scope-a','robot-a','org-a','project-a','task-a',
          'office.task.propose_update','human-a','human-b',?)""", (NOW,))

    def tearDown(self):
        self.db.close()

    def insert_proposal(self, **overrides):
        values = {
            "id": "proposal-a", "organization_id": "org-a", "project_id": "project-a",
            "task_id": "task-a", "service_principal_id": "robot-a",
            "expected_task_version": 3, "proposed_changes_json": '{"title":"Suggested"}',
            "idempotency_key": "once", "request_id": "request-a", "created_at": NOW,
        }
        values.update(overrides)
        self.db.execute("""INSERT INTO office_robot_task_proposals
          (id,organization_id,project_id,task_id,service_principal_id,
           expected_task_version,proposed_changes_json,idempotency_key,request_id,created_at)
          VALUES (:id,:organization_id,:project_id,:task_id,:service_principal_id,
           :expected_task_version,:proposed_changes_json,:idempotency_key,:request_id,:created_at)""",
          values)

    def test_valid_proposal_is_pending_and_does_not_change_task(self):
        self.insert_proposal()
        self.assertEqual(self.db.execute(
            "SELECT status FROM office_robot_task_proposals WHERE id='proposal-a'"
        ).fetchone()[0], "pending")
        self.assertEqual(self.db.execute(
            "SELECT title,version FROM office_tasks WHERE id='task-a'"
        ).fetchone(), ("Task A", 3))

    def test_stale_version_is_rejected(self):
        with self.assertRaises(sqlite3.IntegrityError):
            self.insert_proposal(expected_task_version=2)

    def test_revoked_or_suspended_principal_is_rejected(self):
        self.db.execute("UPDATE office_service_principals SET status='suspended' WHERE id='robot-a'")
        with self.assertRaises(sqlite3.IntegrityError):
            self.insert_proposal()

    def test_revoked_scope_is_rejected(self):
        self.db.execute("UPDATE office_service_capability_scopes SET revoked_at=? WHERE id='scope-a'", (NOW,))
        with self.assertRaises(sqlite3.IntegrityError):
            self.insert_proposal()

    def test_duplicate_idempotency_key_is_rejected(self):
        self.insert_proposal()
        with self.assertRaises(sqlite3.IntegrityError):
            self.insert_proposal(id="proposal-b", request_id="request-b")

    def test_invalid_or_non_object_json_is_rejected(self):
        for payload in ("not-json", '["title"]', '{"status":"done"}'):
            with self.subTest(payload=payload):
                with self.assertRaises(sqlite3.IntegrityError):
                    self.insert_proposal(proposed_changes_json=payload)

    def test_proposal_cannot_be_reviewed_without_human_review_record(self):
        self.insert_proposal()
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("""UPDATE office_robot_task_proposals
              SET status='accepted',reviewed_by_user_id='human-b',reviewed_at=?
              WHERE id='proposal-a'""", (NOW,))
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("DELETE FROM office_robot_task_proposals WHERE id='proposal-a'")

    def test_foreign_key_check_clean(self):
        self.assertEqual(self.db.execute("PRAGMA foreign_key_check").fetchall(), [])


if __name__ == "__main__":
    unittest.main(verbosity=2)
