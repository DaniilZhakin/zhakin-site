#!/usr/bin/env python3
"""SQLite contract tests for human approval of robot task proposals; no live data."""
from pathlib import Path
import sqlite3
import unittest

ROOT = Path(__file__).resolve().parents[1]
MIGRATIONS = ROOT / "migrations"
NOW = "2026-11-16T12:00:00.000Z"


class HumanApprovalTests(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(":memory:")
        self.db.execute("PRAGMA foreign_keys = ON")
        for migration in ("0001_office_core.sql", "0002_robot_service_principals.sql",
                          "0003_robot_task_proposals.sql", "0004_human_proposal_approval.sql"):
            self.db.executescript((MIGRATIONS / migration).read_text())
        self.db.execute("INSERT INTO office_organizations(id,name) VALUES ('org-a','Org A')")
        for user_id in ("human-a", "human-b", "human-c"):
            self.db.execute("""INSERT INTO office_users
              (id,identity_provider,provider_subject,display_name)
              VALUES (?, 'issuer', ?, ?)""", (user_id, user_id, user_id))
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

    def add_approver(self, user="human-b"):
        self.db.execute("""INSERT INTO office_robot_proposal_approver_scopes
          (id,user_id,organization_id,project_id,granted_by_user_id,approved_by_user_id,valid_from)
          VALUES ('approver-' || ?,?,'org-a','project-a','human-a','human-c',?)""",
          (user, user, NOW))

    def add_proposal(self, proposal_id="proposal-a", payload='{"title":"Suggested"}'):
        self.db.execute("""INSERT INTO office_robot_task_proposals
          (id,organization_id,project_id,task_id,service_principal_id,
           expected_task_version,proposed_changes_json,idempotency_key,request_id,created_at)
          VALUES (?,'org-a','project-a','task-a','robot-a',3,?,?,?,?)""",
          (proposal_id, payload, "once-" + proposal_id, "request-" + proposal_id, NOW))

    def add_review(self, action="accepted", reviewer="human-b", proposal="proposal-a"):
        self.db.execute("""INSERT INTO office_robot_proposal_reviews
          (id,proposal_id,organization_id,project_id,task_id,reviewer_user_id,
           action,expected_task_version,request_id,decided_at)
          VALUES ('review-a',?,'org-a','project-a','task-a',?,?,3,'review-request',?)""",
          (proposal, reviewer, action, NOW))

    def transition(self, status="accepted", reviewer="human-b", proposal="proposal-a"):
        self.db.execute("""UPDATE office_robot_task_proposals
          SET status=?,reviewed_by_user_id=?,reviewed_at=?
          WHERE id=?""", (status, reviewer, NOW, proposal))

    def test_accept_requires_scoped_human_and_updates_version_first(self):
        self.add_approver()
        self.add_proposal()
        self.db.execute("""UPDATE office_tasks SET title='Suggested',version=version+1
          WHERE id='task-a' AND version=3""")
        self.add_review("accepted")
        self.transition("accepted")
        self.assertEqual(self.db.execute(
            "SELECT title,version FROM office_tasks WHERE id='task-a'"
        ).fetchone(), ("Suggested", 4))
        self.assertEqual(self.db.execute(
            "SELECT status FROM office_robot_task_proposals WHERE id='proposal-a'"
        ).fetchone()[0], "accepted")

    def test_unscoped_or_inactive_human_cannot_review(self):
        self.add_proposal()
        with self.assertRaises(sqlite3.IntegrityError):
            self.add_review("rejected")
        self.add_approver()
        self.db.execute("UPDATE office_users SET status='suspended' WHERE id='human-b'")
        with self.assertRaises(sqlite3.IntegrityError):
            self.add_review("rejected")

    def test_revoked_approver_grant_cannot_review(self):
        self.add_proposal()
        self.add_approver()
        self.db.execute("UPDATE office_robot_proposal_approver_scopes SET revoked_at=? WHERE user_id='human-b'", (NOW,))
        with self.assertRaises(sqlite3.IntegrityError):
            self.add_review("rejected")

    def test_rejection_does_not_change_task(self):
        self.add_proposal()
        self.add_approver()
        before = self.db.execute("SELECT title,version FROM office_tasks WHERE id='task-a'").fetchone()
        self.add_review("rejected")
        self.transition("rejected")
        after = self.db.execute("SELECT title,version FROM office_tasks WHERE id='task-a'").fetchone()
        self.assertEqual(after, before)

    def test_stale_proposal_can_only_be_marked_stale(self):
        self.add_proposal()
        self.add_approver()
        self.db.execute("UPDATE office_tasks SET version=version+1 WHERE id='task-a'")
        self.add_review("stale")
        self.transition("stale")
        self.assertEqual(self.db.execute(
            "SELECT status FROM office_robot_task_proposals WHERE id='proposal-a'"
        ).fetchone()[0], "stale")

    def test_accept_with_wrong_task_version_rolls_back_at_review_guard(self):
        self.add_proposal()
        self.add_approver()
        with self.assertRaises(sqlite3.IntegrityError):
            self.add_review("accepted")
        self.assertEqual(self.db.execute(
            "SELECT status FROM office_robot_task_proposals WHERE id='proposal-a'"
        ).fetchone()[0], "pending")

    def test_proposal_cannot_be_transitioned_without_review_record(self):
        self.add_proposal()
        self.add_approver()
        with self.assertRaises(sqlite3.IntegrityError):
            self.transition("rejected")

    def test_review_history_is_append_only(self):
        self.add_proposal()
        self.add_approver()
        self.add_review("rejected")
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE office_robot_proposal_reviews SET comment='rewrite' WHERE id='review-a'")
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("DELETE FROM office_robot_proposal_reviews WHERE id='review-a'")

    def test_approver_grant_requires_dual_control_and_cannot_be_deleted(self):
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("""INSERT INTO office_robot_proposal_approver_scopes
              (id,user_id,organization_id,project_id,granted_by_user_id,approved_by_user_id,valid_from)
              VALUES ('bad','human-b','org-a','project-a','human-a','human-b',?)""", (NOW,))
        self.add_approver()
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("DELETE FROM office_robot_proposal_approver_scopes WHERE user_id='human-b'")

    def test_foreign_key_check_clean(self):
        self.assertEqual(self.db.execute("PRAGMA foreign_key_check").fetchall(), [])


if __name__ == "__main__":
    unittest.main(verbosity=2)
