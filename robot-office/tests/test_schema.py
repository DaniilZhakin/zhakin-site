"""Disposable SQLite smoke tests for Robot Office schema; no live D1 access."""
import sqlite3
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MIGRATIONS = [ROOT / "migrations" / "0001_robot_office_schema.sql", ROOT / "migrations" / "0002_handoff_summaries.sql""


class RobotOfficeSchemaTests(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(":memory:")
        self.db.execute("PRAGMA foreign_keys = ON")
        for migration in MIGRATIONS:\n            self.db.executescript(migration.read_text(encoding="utf-8"))
        self.db.execute(
            "INSERT INTO office_organizations(id,name,created_at) VALUES(?,?,?)",
            ("org-test", "Synthetic Test Org", 100),
        )

    def tearDown(self):
        self.db.close()

    def test_workspace_owner_role_boundary(self):
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute(
                """INSERT INTO office_tasks
                   (id,organization_id,workspace,owner_role,title,created_by,created_at)
                   VALUES('bad','org-test','treasury','legal_agent','Bad task','tester',101)"""
            )

    def test_role_grant_expiry_and_revocation_fields(self):
        self.db.execute(
            """INSERT INTO office_role_grants
               (id,subject_id,organization_id,role,scope,granted_by,granted_at,expires_at)
               VALUES('g1','robot-1','org-test','treasury_agent','workspace','admin-1',100,200)"""
        )
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute(
                """INSERT INTO office_role_grants
                   (id,subject_id,organization_id,role,scope,granted_by,granted_at,expires_at)
                   VALUES('g2','robot-2','org-test','legal_agent','workspace','admin-1',100,99)"""
            )

    def test_approval_idempotency_and_separation_of_duties(self):
        self.db.execute(
            """INSERT INTO office_approvals
               (id,organization_id,object_type,object_id,requested_by,idempotency_key,requested_at)
               VALUES('a1','org-test','task','t1','requester','idem-1',100)"""
        )
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute(
                """INSERT INTO office_approvals
                   (id,organization_id,object_type,object_id,requested_by,idempotency_key,requested_at)
                   VALUES('a2','org-test','task','t1','requester','idem-1',101)"""
            )
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute(
                """UPDATE office_approvals
                   SET decision='approved', reviewer_id='requester', decided_at=102
                   WHERE id='a1'"""
            )
        self.db.execute(
            """UPDATE office_approvals
               SET decision='approved', reviewer_id='reviewer', decided_at=102
               WHERE id='a1'"""
        )

    def test_document_metadata_rejects_oversize_file(self):
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute(
                """INSERT INTO office_document_metadata
                   (id,organization_id,workspace,classification,storage_object_id,
                    original_filename,media_type,byte_size,checksum_sha256,created_by,created_at)
                   VALUES('d1','org-test','legal','restricted','obj-1','contract.pdf',
                    'application/pdf',26214401,?, 'user-1',100)""",
                ("a" * 64,),
            )

    def test_audit_is_append_only(self):
        self.db.execute(
            """INSERT INTO office_audit_events
               (id,organization_id,actor_id,actor_role,action,object_type,object_id,
                outcome,request_id,occurred_at)
               VALUES('e1','org-test','robot-1','treasury_agent','task.read',
                'task','t1','success','req-1',100)"""
        )
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE office_audit_events SET action='tampered' WHERE id='e1'")
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("DELETE FROM office_audit_events WHERE id='e1'")

    def test_foreign_keys_reject_unknown_organization(self):
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute(
                """INSERT INTO office_tasks
                   (id,organization_id,workspace,owner_role,title,created_by,created_at)
                   VALUES('t1','missing-org','command','command_agent','Task','tester',100)"""
            )


if __name__ == "__main__":
    unittest.main()
