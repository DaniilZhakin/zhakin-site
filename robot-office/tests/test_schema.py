"""Disposable SQLite smoke tests for Robot Office schema; no live D1 access."""
import sqlite3
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MIGRATIONS = [
    ROOT / "migrations" / "0001_robot_office_schema.sql",
    ROOT / "migrations" / "0002_handoff_summaries.sql",
    ROOT / "migrations" / "0003_role_approval_requests.sql",
    ROOT / "migrations" / "0004_role_approval_credentials.sql",
]


class RobotOfficeSchemaTests(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(":memory:")
        self.db.execute("PRAGMA foreign_keys = ON")
        for migration in MIGRATIONS:
            self.db.executescript(migration.read_text(encoding="utf-8"))
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

    def test_role_approval_request_requires_independent_subject_and_matching_scope(self):
        self.db.execute(
            """INSERT INTO office_role_approval_requests
               (id,organization_id,requested_by,subject_id,role,scope,request_id,
                idempotency_key,created_at,expires_at)
               VALUES('ra1','org-test','admin-1','robot-1','legal_agent',
                'workspace:legal','req-1','idem-role-1',100,200)"""
        )
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute(
                """INSERT INTO office_role_approval_requests
                   (id,organization_id,requested_by,subject_id,role,scope,request_id,
                    idempotency_key,created_at,expires_at)
                   VALUES('ra2','org-test','admin-1','robot-2','legal_agent',
                    'workspace:treasury','req-2','idem-role-2',100,200)"""
            )
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute(
                """INSERT INTO office_role_approval_requests
                   (id,organization_id,requested_by,subject_id,role,scope,request_id,
                    idempotency_key,created_at,expires_at)
                   VALUES('ra3','org-test','admin-1','admin-1','treasury_agent',
                    'workspace:treasury','req-3','idem-role-3',100,200)"""
            )

    def test_approval_state_requires_hash_and_independent_reviewer(self):
        self.db.execute(
            """INSERT INTO office_role_approval_requests
               (id,organization_id,requested_by,subject_id,role,scope,request_id,
                idempotency_key,created_at,expires_at)
               VALUES('ra-approved','org-test','admin-1','robot-1','treasury_agent',
                'workspace:treasury','req-approved','idem-approved',100,200)"""
        )
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute(
                """UPDATE office_role_approval_requests
                   SET status='approved', reviewer_id='reviewer', decided_at=110
                   WHERE id='ra-approved'"""
            )
        self.db.execute(
            """UPDATE office_role_approval_requests
               SET status='approved', reviewer_id='reviewer', decided_at=110,
                   decision_event_id='decision-1', token_hash='hash-1', token_expires_at=120
               WHERE id='ra-approved'"""
        )
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute(
                """UPDATE office_role_approval_requests
                   SET reviewer_id='admin-1'
                   WHERE id='ra-approved'"""
            )

        self.db.execute(
            """UPDATE office_role_approval_requests
               SET status='consumed', consumed_at=115, consumed_grant_id='grant-1'
               WHERE id='ra-approved'"""
        )
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute(
                """UPDATE office_role_approval_requests
                   SET consumed_grant_id='grant-2'
                   WHERE id='ra-approved'"""
            )

    def test_approval_credential_envelope_is_encrypted_and_bound(self):
        self.db.execute(
            """INSERT INTO office_role_approval_requests
               (id,organization_id,requested_by,subject_id,role,scope,request_id,
                idempotency_key,created_at,expires_at)
               VALUES('ra-envelope','org-test','admin-1','robot-1','legal_agent',
                'workspace:legal','req-envelope','idem-envelope',100,300)"""
        )
        self.db.execute(
            """UPDATE office_role_approval_requests
               SET status='approved', reviewer_id='reviewer', decided_at=110,
                   decision_event_id='decision-envelope', token_hash='hash-envelope',
                   token_expires_at=250
               WHERE id='ra-envelope'"""
        )
        self.db.execute(
            """INSERT INTO office_role_approval_credentials
               (approval_request_id,organization_id,iv,ciphertext,key_version,created_at)
               VALUES('ra-envelope','org-test','AAAAAAAAAAAAAAAA','ciphertext-base64url','v1',110)"""
        )
        columns = {row[1] for row in self.db.execute(
            "PRAGMA table_info(office_role_approval_credentials)"
        )}
        self.assertNotIn("token", columns)
        self.assertIn("ciphertext", columns)
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute(
                """UPDATE office_role_approval_credentials
                   SET retrieval_key_hash='k', retrieved_at=120, recovery_until=120
                   WHERE approval_request_id='ra-envelope'"""
            )
        self.db.execute(
            """UPDATE office_role_approval_credentials
               SET retrieval_key_hash='key-hash', retrieved_at=120, recovery_until=240
               WHERE approval_request_id='ra-envelope'"""
        )
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute(
                """UPDATE office_role_approval_credentials
                   SET retrieval_key_hash='other-key'
                   WHERE approval_request_id='ra-envelope'"""
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


    def test_handoff_summary_is_minimized_and_idempotent(self):
        self.db.execute(
            """INSERT INTO office_tasks
               (id,organization_id,workspace,owner_role,title,created_by,created_at)
               VALUES('task-h1','org-test','treasury','treasury_agent','Ledger review','robot-1',100)"""
        )
        self.db.execute(
            """INSERT INTO office_handoff_summaries
               (id,organization_id,task_id,workspace,task_version,summary,created_by,created_at,idempotency_key)
               VALUES('h1','org-test','task-h1','treasury',2,'Needs human review','robot-1',101,'idem-h1')"""
        )
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute(
                """INSERT INTO office_handoff_summaries
                   (id,organization_id,task_id,workspace,task_version,summary,created_by,created_at,idempotency_key)
                   VALUES('h2','org-test','task-h1','treasury',2,'Duplicate version','robot-1',102,'idem-h2')"""
            )
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute(
                """INSERT INTO office_handoff_summaries
                   (id,organization_id,task_id,workspace,task_version,summary,created_by,created_at,idempotency_key)
                   VALUES('h3','org-test','task-h1','treasury',3,?, 'robot-1',103,'idem-h3')""",
                ("x" * 1001,),
            )

if __name__ == "__main__":
    unittest.main()
