#!/usr/bin/env python3
"""SQLite-only smoke tests for OFFICE_DB migrations 0001 + 0002; no live data."""
from pathlib import Path
import sqlite3
import unittest

ROOT = Path(__file__).resolve().parents[1]
MIGRATIONS = ROOT / "migrations"


class RobotRegistryMigrationTests(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(":memory:")
        self.db.execute("PRAGMA foreign_keys = ON")
        self.db.executescript((MIGRATIONS / "0001_office_core.sql").read_text())
        self.db.executescript((MIGRATIONS / "0002_robot_service_principals.sql").read_text())
        self.db.execute("INSERT INTO office_organizations(id,name) VALUES ('org-a','Org A')")
        self.db.execute("INSERT INTO office_users(id,identity_provider,provider_subject,display_name) VALUES ('human-a','issuer','subject-a','Owner A')")
        self.db.execute("INSERT INTO office_users(id,identity_provider,provider_subject,display_name) VALUES ('human-b','issuer','subject-b','Approver B')")
        self.db.execute("INSERT INTO office_projects(id,organization_id,code,title) VALUES ('project-a','org-a','P-A','Project A')")
        self.db.execute("""INSERT INTO office_tasks(id,organization_id,project_id,title,created_by_user_id)
                           VALUES ('task-a','org-a','project-a','Task A','human-a')""")
        self.db.execute("""INSERT INTO office_service_principals
          (id,organization_id,code,display_name,identity_issuer,identity_subject,created_by_user_id)
          VALUES ('robot-a','org-a','research-01','Research Robot','robot-issuer','robot-subject','human-a')""")

    def tearDown(self):
        self.db.close()

    def test_robot_is_not_a_human_user(self):
        self.assertEqual(self.db.execute("SELECT count(*) FROM office_users WHERE id='robot-a'").fetchone()[0], 0)
        self.assertEqual(self.db.execute("SELECT count(*) FROM office_service_principals WHERE id='robot-a'").fetchone()[0], 1)

    def test_identity_pair_is_unique(self):
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("""INSERT INTO office_service_principals
              (id,organization_id,code,display_name,identity_issuer,identity_subject,created_by_user_id)
              VALUES ('robot-b','org-a','research-02','Robot B','robot-issuer','robot-subject','human-a')""")

    def test_activation_requires_separate_human_approval_and_credential_reference(self):
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE office_service_principals SET status='active' WHERE id='robot-a'")
        self.db.execute("""UPDATE office_service_principals SET status='active',
          approved_by_user_id='human-b', approved_at='2026-11-16T00:00:00Z',
          valid_from='2026-11-16T00:00:00Z', credential_ref='vault-ref:robot-a'
          WHERE id='robot-a'""")
        self.assertEqual(self.db.execute("SELECT status FROM office_service_principals WHERE id='robot-a'").fetchone()[0], "active")

    def test_self_approval_is_rejected(self):
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("""UPDATE office_service_principals SET status='active',
              approved_by_user_id='human-a', approved_at='2026-11-16T00:00:00Z',
              valid_from='2026-11-16T00:00:00Z', credential_ref='vault-ref:robot-a'
              WHERE id='robot-a'""")

    def test_capability_requires_distinct_grantor_and_approver(self):
        self.db.execute("""INSERT INTO office_service_capability_scopes
          (id,service_principal_id,organization_id,project_id,task_id,capability_code,
           granted_by_user_id,approved_by_user_id,valid_from)
          VALUES ('scope-a','robot-a','org-a','project-a','task-a',
          'office.task.read_assigned','human-a','human-b','2026-11-16T00:00:00Z')""")
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("""INSERT INTO office_service_capability_scopes
              (id,service_principal_id,organization_id,project_id,task_id,capability_code,
               granted_by_user_id,approved_by_user_id,valid_from)
              VALUES ('scope-b','robot-a','org-a','project-a','task-a',
              'office.task.propose_update','human-a','human-a','2026-11-16T00:00:00Z')""")

    def test_task_scope_cannot_cross_project_or_organization(self):
        self.db.execute("INSERT INTO office_organizations(id,name) VALUES ('org-b','Org B')")
        self.db.execute("INSERT INTO office_projects(id,organization_id,code,title) VALUES ('project-b','org-b','P-B','Project B')")
        self.db.execute("""INSERT INTO office_tasks(id,organization_id,project_id,title,created_by_user_id)
                           VALUES ('task-b','org-b','project-b','Task B','human-a')""")
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("""INSERT INTO office_service_capability_scopes
              (id,service_principal_id,organization_id,project_id,task_id,capability_code,
               granted_by_user_id,approved_by_user_id,valid_from)
              VALUES ('scope-cross','robot-a','org-a','project-a','task-b',
              'office.task.read_assigned','human-a','human-b','2026-11-16T00:00:00Z')""")

    def test_revocation_requires_reason_and_timestamp(self):
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE office_service_principals SET status='revoked' WHERE id='robot-a'")
        self.db.execute("""UPDATE office_service_principals SET status='revoked',
          revoked_at='2026-11-16T01:00:00Z', revocation_reason='owner request'
          WHERE id='robot-a'""")
        self.assertEqual(self.db.execute("SELECT status FROM office_service_principals WHERE id='robot-a'").fetchone()[0], "revoked")

    def test_robot_audit_is_append_only_and_idempotent(self):
        self.db.execute("""INSERT INTO office_robot_audit_events
          (id,organization_id,service_principal_id,capability_code,action,object_type,object_id,
           request_id,idempotency_key,outcome)
          VALUES ('audit-a','org-a','robot-a','office.task.read_assigned','task.read',
          'task','task-a','req-a','idem-a','success')""")
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE office_robot_audit_events SET outcome='failed' WHERE id='audit-a'")
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("DELETE FROM office_robot_audit_events WHERE id='audit-a'")
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("""INSERT INTO office_robot_audit_events
              (id,organization_id,service_principal_id,capability_code,action,object_type,object_id,
               request_id,idempotency_key,outcome)
              VALUES ('audit-b','org-a','robot-a','office.task.read_assigned','task.read',
              'task','task-a','req-b','idem-a','success')""")

    def test_foreign_key_check_clean(self):
        self.assertEqual(self.db.execute("PRAGMA foreign_key_check").fetchall(), [])


if __name__ == "__main__":
    unittest.main(verbosity=2)
