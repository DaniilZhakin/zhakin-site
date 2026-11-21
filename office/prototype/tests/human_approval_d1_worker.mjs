/**
 * Disposable local-D1 integration probe for the real Human Approval Gateway.
 * Test-only identity verifier; never expose this worker as a production route.
 */
import { createHumanApprovalGateway } from "../src/human-approval-gateway.mjs";

const NOW = "2026-11-17T18:00:00.000Z";
const HUMAN_ISSUER = "https://office-test-identity.invalid";
const HUMAN_SUBJECT = "reviewer-subject";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function stmt(db, sql, ...args) {
  return db.prepare(sql).bind(...args);
}

async function seedBase(db) {
  await db.batch([
    stmt(db, "INSERT INTO office_organizations(id,name,status) VALUES ('org-d1','D1 Test Org','active')"),
    stmt(db, "INSERT INTO office_users(id,identity_provider,provider_subject,display_name,status) VALUES ('human-reviewer',? ,?,'Reviewer','active')", HUMAN_ISSUER, HUMAN_SUBJECT),
    stmt(db, "INSERT INTO office_users(id,identity_provider,provider_subject,display_name,status) VALUES ('human-grantor','https://office-test-identity.invalid','grantor','Grantor','active')"),
    stmt(db, "INSERT INTO office_users(id,identity_provider,provider_subject,display_name,status) VALUES ('human-approver','https://office-test-identity.invalid','approver','Grant approver','active')"),
    stmt(db, "INSERT INTO office_projects(id,organization_id,code,title,status) VALUES ('project-d1','org-d1','D1','D1 Test Project','active')"),
    stmt(db, `INSERT INTO office_service_principals
      (id,organization_id,code,display_name,identity_issuer,identity_subject,status,credential_ref,valid_from,created_by_user_id,approved_by_user_id,approved_at)
      VALUES ('robot-d1','org-d1','robot-d1','Test robot','https://robot.invalid','robot-subject','active','test-ref',?,'human-grantor','human-approver',?)`, NOW, NOW),
  ]);
}

async function seedProposal(db, suffix) {
  const taskId = `task-${suffix}`;
  const proposalId = `proposal-${suffix}`;
  const scopeId = `approver-scope-${suffix}`;
  const robotScopeId = `robot-scope-${suffix}`;
  await db.batch([
    stmt(db, `INSERT INTO office_tasks
      (id,organization_id,project_id,title,created_by_user_id,status,version)
      VALUES (?, 'org-d1','project-d1','Original title','human-grantor','in_progress',1)`, taskId),
    stmt(db, `INSERT INTO office_service_capability_scopes
      (id,service_principal_id,organization_id,project_id,task_id,capability_code,granted_by_user_id,approved_by_user_id,valid_from)
      VALUES (?,'robot-d1','org-d1','project-d1',?,'office.task.propose_update','human-grantor','human-approver',?)`, robotScopeId, taskId, NOW),
    stmt(db, `INSERT INTO office_robot_proposal_approver_scopes
      (id,user_id,organization_id,project_id,granted_by_user_id,approved_by_user_id,valid_from)
      VALUES (?,'human-reviewer','org-d1','project-d1','human-grantor','human-approver',?)`, scopeId, NOW),
    stmt(db, `INSERT INTO office_robot_task_proposals
      (id,organization_id,project_id,task_id,service_principal_id,expected_task_version,proposed_changes_json,idempotency_key,request_id,created_at)
      VALUES (?,'org-d1','project-d1',?,'robot-d1',1,'{"title":"Approved by D1 test"}',?,?,?)`, proposalId, taskId, `idem-${suffix}`, `request-${suffix}`, NOW),
  ]);
  return { taskId, proposalId, scopeId };
}

async function readOne(db, sql, ...args) {
  return db.prepare(sql).bind(...args).first();
}

export default {
  async fetch(_request, env) {
    const db = env.OFFICE_DB;
    try {
      await seedBase(db);
      const gateway = createHumanApprovalGateway({
        db,
        verifyCredential: async (token) => {
          if (token !== "test-human-token") throw new Error("test credential rejected");
          return { issuer: HUMAN_ISSUER, subject: HUMAN_SUBJECT };
        },
        clock: () => new Date(NOW),
      });

      const accepted = await seedProposal(db, "accept");
      const acceptResult = await gateway.reviewProposal({
        bearerToken: "test-human-token", proposalId: accepted.proposalId, action: "accept",
      });
      const acceptedTask = await readOne(db, "SELECT title,version FROM office_tasks WHERE id=?", accepted.taskId);
      const acceptedProposal = await readOne(db, "SELECT status FROM office_robot_task_proposals WHERE id=?", accepted.proposalId);
      assert(acceptResult.status === "accepted" && acceptedTask.title === "Approved by D1 test" && acceptedTask.version === 2 && acceptedProposal.status === "accepted", "acceptance did not atomically update task and proposal");

      const rejected = await seedProposal(db, "reject");
      const rejectResult = await gateway.reviewProposal({
        bearerToken: "test-human-token", proposalId: rejected.proposalId, action: "reject",
      });
      const rejectedTask = await readOne(db, "SELECT title,version FROM office_tasks WHERE id=?", rejected.taskId);
      const rejectedProposal = await readOne(db, "SELECT status FROM office_robot_task_proposals WHERE id=?", rejected.proposalId);
      assert(rejectResult.status === "rejected" && rejectedTask.title === "Original title" && rejectedTask.version === 1 && rejectedProposal.status === "rejected", "rejection mutated the task or failed to record decision");

      const stale = await seedProposal(db, "stale");
      await db.prepare("UPDATE office_tasks SET version=2 WHERE id=?").bind(stale.taskId).run();
      const staleResult = await gateway.reviewProposal({
        bearerToken: "test-human-token", proposalId: stale.proposalId, action: "accept",
      });
      const staleTask = await readOne(db, "SELECT title,version FROM office_tasks WHERE id=?", stale.taskId);
      const staleProposal = await readOne(db, "SELECT status FROM office_robot_task_proposals WHERE id=?", stale.proposalId);
      assert(staleResult.status === "stale" && staleTask.title === "Original title" && staleTask.version === 2 && staleProposal.status === "stale", "stale proposal was applied or not marked stale");

      const revoked = await seedProposal(db, "revoked");
      // Revoke every overlapping grant for this reviewer/resource. Other active
      // grants for the same project would legitimately preserve the authority.
      await db.prepare("UPDATE office_robot_proposal_approver_scopes SET revoked_at=? WHERE user_id='human-reviewer' AND organization_id='org-d1' AND project_id='project-d1' AND revoked_at IS NULL").bind(NOW).run();
      let revokedDenied = false;
      let revokedError = null;
      try {
        await gateway.reviewProposal({ bearerToken: "test-human-token", proposalId: revoked.proposalId, action: "accept" });
      } catch (error) {
        revokedError = { code: error.code || null, message: String(error.message || error) };
        revokedDenied = error.code === "reviewer_not_authorized";
      }
      const revokedGrant = await readOne(db, "SELECT revoked_at FROM office_robot_proposal_approver_scopes WHERE id=?", revoked.scopeId);
      const revokedProposal = await readOne(db, "SELECT status FROM office_robot_task_proposals WHERE id=?", revoked.proposalId);
      assert(revokedGrant?.revoked_at === NOW && revokedDenied && revokedProposal.status === "pending",
        `revoked reviewer scope was not denied before writes: ${JSON.stringify({ revokedGrant, revokedError, revokedProposal })}`);

      // Revoke after preflight authorization but immediately before D1.batch.
      // The gateway's in-batch scope recheck must stop the update and roll back.
      const revokeRace = await seedProposal(db, "revoke-race");
      const raceDb = {
        prepare: (...args) => db.prepare(...args),
        batch: async (statements) => {
          await db.prepare("UPDATE office_robot_proposal_approver_scopes SET revoked_at=? WHERE id=? AND revoked_at IS NULL").bind(NOW, revokeRace.scopeId).run();
          return db.batch(statements);
        },
      };
      const raceGateway = createHumanApprovalGateway({
        db: raceDb,
        verifyCredential: async () => ({ issuer: HUMAN_ISSUER, subject: HUMAN_SUBJECT }),
        clock: () => new Date(NOW),
      });
      let revokeRaceAborted = false;
      try {
        await raceGateway.reviewProposal({ bearerToken: "test-human-token", proposalId: revokeRace.proposalId, action: "accept" });
      } catch {
        revokeRaceAborted = true;
      }
      const raceTask = await readOne(db, "SELECT title,version FROM office_tasks WHERE id=?", revokeRace.taskId);
      const raceProposal = await readOne(db, "SELECT status FROM office_robot_task_proposals WHERE id=?", revokeRace.proposalId);
      const raceReviews = await readOne(db, "SELECT COUNT(*) AS count FROM office_robot_proposal_reviews WHERE proposal_id=?", revokeRace.proposalId);
      assert(revokeRaceAborted && raceTask.title === "Original title" && raceTask.version === 1
        && raceProposal.status === "pending" && raceReviews.count === 0,
        "revocation between preflight and batch was not fail-closed and atomic");

      // Force the final audit insert to fail; all preceding D1 batch statements
      // must roll back, leaving the task and proposal untouched.
      const auditFailure = await seedProposal(db, "audit-failure");
      assert(auditFailure.proposalId === "proposal-audit-failure", "unexpected deterministic audit-failure fixture ID");
      await db.prepare(`CREATE TRIGGER reject_office_test_audit
        BEFORE INSERT ON office_audit_events
        WHEN NEW.object_id = 'proposal-audit-failure'
        BEGIN SELECT RAISE(ABORT, 'injected audit persistence failure'); END`).run();
      let auditFailureAborted = false;
      try {
        await gateway.reviewProposal({ bearerToken: "test-human-token", proposalId: auditFailure.proposalId, action: "accept" });
      } catch {
        auditFailureAborted = true;
      }
      await db.prepare("DROP TRIGGER reject_office_test_audit").run();
      const auditFailureTask = await readOne(db, "SELECT title,version FROM office_tasks WHERE id=?", auditFailure.taskId);
      const auditFailureProposal = await readOne(db, "SELECT status FROM office_robot_task_proposals WHERE id=?", auditFailure.proposalId);
      const auditFailureReviews = await readOne(db, "SELECT COUNT(*) AS count FROM office_robot_proposal_reviews WHERE proposal_id=?", auditFailure.proposalId);
      assert(auditFailureAborted && auditFailureTask.title === "Original title" && auditFailureTask.version === 1
        && auditFailureProposal.status === "pending" && auditFailureReviews.count === 0,
        "audit failure did not roll back task, proposal and review as one D1 batch");

      const concurrent = await seedProposal(db, "concurrent");
      const concurrentResults = await Promise.allSettled([
        gateway.reviewProposal({ bearerToken: "test-human-token", proposalId: concurrent.proposalId, action: "accept" }),
        gateway.reviewProposal({ bearerToken: "test-human-token", proposalId: concurrent.proposalId, action: "accept" }),
      ]);
      const concurrentReviews = await readOne(db, "SELECT COUNT(*) AS count FROM office_robot_proposal_reviews WHERE proposal_id=?", concurrent.proposalId);
      const concurrentTask = await readOne(db, "SELECT version FROM office_tasks WHERE id=?", concurrent.taskId);
      const concurrentProposal = await readOne(db, "SELECT status FROM office_robot_task_proposals WHERE id=?", concurrent.proposalId);
      assert(concurrentResults.filter((result) => result.status === "fulfilled").length === 1, "concurrent duplicate review did not yield exactly one success");
      assert(concurrentReviews.count === 1 && concurrentTask.version === 2 && concurrentProposal.status === "accepted", "concurrent review caused duplicate history or task mutation");

      const audit = await readOne(db, "SELECT COUNT(*) AS count FROM office_audit_events WHERE object_type='robot_task_proposal'");
      assert(audit.count === 4, "expected exactly four successful review audit events");

      return Response.json({
        ok: true,
        acceptanceAtomicity: true,
        rejectionLeavesTaskUnchanged: true,
        staleProposalNotApplied: true,
        revokedApproverDenied: true,
        revocationRaceFailsClosed: true,
        auditFailureRollsBackDecision: true,
        concurrentDuplicateApprovalRejected: true,
        auditEvents: audit.count,
      });
    } catch (error) {
      return Response.json({ ok: false, error: String(error?.message || error), code: error?.code || null }, { status: 500 });
    }
  },
};
