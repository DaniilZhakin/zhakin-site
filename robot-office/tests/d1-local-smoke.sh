#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CONFIG="$(mktemp "$ROOT/.wrangler-d1-XXXXXX.toml")"
trap 'rm -f "$CONFIG"' EXIT

cat > "$CONFIG" <<'EOF'
name = "robot-office-d1-smoke"
compatibility_date = "2026-10-31"

[[d1_databases]]
binding = "DB"
database_name = "robot-office-d1-smoke"
database_id = "00000000-0000-0000-0000-000000000001"
migrations_dir = "robot-office/migrations"
EOF

cd "$ROOT"

run_d1() {
  npx --yes wrangler@4 d1 execute DB --local --config "$CONFIG" "$@"
}

expect_failure() {
  local label="$1"
  shift
  if "$@" >/tmp/robot-office-d1-negative.log 2>&1; then
    echo "FAIL: expected D1 rejection: $label"
    cat /tmp/robot-office-d1-negative.log
    exit 1
  fi
  echo "PASS: D1 rejected invalid operation: $label"
}

echo "Applying migrations to Wrangler's disposable local D1 database..."
run_d1 --command "SELECT 1 AS bootstrap_check" >/dev/null
npx --yes wrangler@4 d1 migrations apply DB --local --config "$CONFIG"

echo "Seeding synthetic organization, role grant, and task..."
run_d1 --command "INSERT INTO office_organizations(id,name,created_at) VALUES('org-d1-test','Synthetic D1 Test',100);" >/dev/null
run_d1 --command "INSERT INTO office_role_grants(id,subject_id,organization_id,role,scope,granted_by,granted_at) VALUES('grant-d1','robot-d1','org-d1-test','treasury_agent','workspace','admin-d1',100);" >/dev/null
run_d1 --command "INSERT INTO office_tasks(id,organization_id,workspace,owner_role,title,created_by,created_at) VALUES('task-d1','org-d1-test','treasury','treasury_agent','D1 concurrency probe','robot-d1',100);" >/dev/null

echo "Checking human role-approval request constraints and one-time state lifecycle..."
run_d1 --command "INSERT INTO office_role_approval_requests(id,organization_id,requested_by,subject_id,role,scope,status,request_id,idempotency_key,created_at,expires_at) VALUES('role-approval-d1','org-d1-test','admin-d1','robot-d1','treasury_agent','workspace:treasury','pending','req-approval-d1','idem-approval-d1',100,200);" >/dev/null
expect_failure "role approval cannot cross role/workspace scope" bash -c "cd '$ROOT' && npx --yes wrangler@4 d1 execute DB --local --config '$CONFIG' --command \"INSERT INTO office_role_approval_requests(id,organization_id,requested_by,subject_id,role,scope,request_id,idempotency_key,created_at,expires_at) VALUES('role-approval-bad','org-d1-test','admin-d1','robot-d1','legal_agent','workspace:treasury','req-bad','idem-bad',100,200)\""
expect_failure "role approval cannot be self-requested" bash -c "cd '$ROOT' && npx --yes wrangler@4 d1 execute DB --local --config '$CONFIG' --command \"INSERT INTO office_role_approval_requests(id,organization_id,requested_by,subject_id,role,scope,request_id,idempotency_key,created_at,expires_at) VALUES('role-approval-self','org-d1-test','admin-d1','admin-d1','treasury_agent','workspace:treasury','req-self','idem-self',100,200)\""
result="$(run_d1 --command "SELECT COUNT(*) AS pending_approval_rows FROM office_role_approval_requests WHERE id='role-approval-d1' AND status='pending' AND token_hash IS NULL;" --json)"
if ! grep -Eq '"pending_approval_rows"[[:space:]]*:[[:space:]]*1' <<<"$result"; then
  echo "FAIL: pending approval request has unexpected initial state"
  printf '%s\\n' "$result"
  exit 1
fi
run_d1 --command "UPDATE office_role_approval_requests SET status='approved', reviewer_id='human-d1', decided_at=110, decision_event_id='decision-d1', token_hash='hash-d1', token_expires_at=150 WHERE id='role-approval-d1' AND status='pending';" >/dev/null
echo "Checking encrypted approval credential envelope claim is immutable..."
run_d1 --command "INSERT INTO office_role_approval_credentials(approval_request_id,organization_id,iv,ciphertext,key_version,created_at) VALUES('role-approval-d1','org-d1-test','AAAAAAAAAAAAAAAA','synthetic-ciphertext','v1',110);" >/dev/null
run_d1 --command "UPDATE office_role_approval_credentials SET retrieval_key_hash='synthetic-key-hash', retrieved_at=111, recovery_until=140 WHERE approval_request_id='role-approval-d1';" >/dev/null
expect_failure "credential envelope cannot be claimed or rebound a second time" bash -c "cd '$ROOT' && npx --yes wrangler@4 d1 execute DB --local --config '$CONFIG' --command \\"UPDATE office_role_approval_credentials SET retrieval_key_hash='different-key' WHERE approval_request_id='role-approval-d1'\\""
run_d1 --command "UPDATE office_role_approval_requests SET status='consumed', consumed_at=120, consumed_grant_id='grant-role-d1' WHERE id='role-approval-d1' AND status='approved';" >/dev/null
expect_failure "consumed approval cannot be replayed or rebound to another grant" bash -c "cd '$ROOT' && npx --yes wrangler@4 d1 execute DB --local --config '$CONFIG' --command \"UPDATE office_role_approval_requests SET consumed_grant_id='grant-role-replay' WHERE id='role-approval-d1'\""
echo "PASS: approval request scope, independence, and initial state constraints"

echo "Checking task compare-and-swap and stale-version rejection..."
run_d1 --command "UPDATE office_tasks SET status='handed_off',version=version+1 WHERE id='task-d1' AND organization_id='org-d1-test' AND workspace='treasury' AND version=1 AND status IN ('open','in_progress','blocked');" >/dev/null
run_d1 --command "INSERT INTO office_handoff_summaries(id,organization_id,task_id,workspace,task_version,summary,created_by,created_at,idempotency_key) SELECT 'handoff-stale','org-d1-test',id,'treasury',2,'stale replay','robot-d1',101,'idem-stale' FROM office_tasks WHERE id='task-d1' AND version=1;" >/dev/null
result="$(run_d1 --command "SELECT COUNT(*) AS stale_rows FROM office_handoff_summaries WHERE id='handoff-stale';" --json)"
if ! grep -Eq '"stale_rows"[[:space:]]*:[[:space:]]*0' <<<"$result"; then
  echo "FAIL: stale task version created a handoff summary"
  printf '%s\\n' "$result"
  exit 1
fi
echo "PASS: stale task version creates no handoff summary"

echo "Checking handoff idempotency and task-version uniqueness..."
run_d1 --command "INSERT INTO office_handoff_summaries(id,organization_id,task_id,workspace,task_version,summary,created_by,created_at,idempotency_key) VALUES('handoff-d1','org-d1-test','task-d1','treasury',2,'Synthetic minimized summary','robot-d1',101,'idem-d1');" >/dev/null
expect_failure "duplicate idempotency key" bash -c "cd '$ROOT' && npx --yes wrangler@4 d1 execute DB --local --config '$CONFIG' --command \"INSERT INTO office_handoff_summaries(id,organization_id,task_id,workspace,task_version,summary,created_by,created_at,idempotency_key) VALUES('handoff-duplicate','org-d1-test','task-d1','treasury',3,'duplicate key','robot-d1',102,'idem-d1')\""
expect_failure "duplicate task version" bash -c "cd '$ROOT' && npx --yes wrangler@4 d1 execute DB --local --config '$CONFIG' --command \"INSERT INTO office_handoff_summaries(id,organization_id,task_id,workspace,task_version,summary,created_by,created_at,idempotency_key) VALUES('handoff-version-duplicate','org-d1-test','task-d1','treasury',2,'duplicate version','robot-d1',102,'idem-d2')\""

echo "Checking append-only audit constraints..."
run_d1 --command "INSERT INTO office_audit_events(id,organization_id,actor_id,actor_role,action,object_type,object_id,outcome,request_id,occurred_at) VALUES('audit-d1','org-d1-test','robot-d1','treasury_agent','task:handoff','task','task-d1','success','req-d1',101);" >/dev/null
expect_failure "audit update is forbidden" bash -c "cd '$ROOT' && npx --yes wrangler@4 d1 execute DB --local --config '$CONFIG' --command \"UPDATE office_audit_events SET action='tampered' WHERE id='audit-d1'\""
expect_failure "audit delete is forbidden" bash -c "cd '$ROOT' && npx --yes wrangler@4 d1 execute DB --local --config '$CONFIG' --command \"DELETE FROM office_audit_events WHERE id='audit-d1'\""

echo "Checking role revocation is persisted and visible to subsequent reads..."
run_d1 --command "UPDATE office_role_grants SET revoked_at=102 WHERE id='grant-d1';" >/dev/null
result="$(run_d1 --command "SELECT COUNT(*) AS active_grants FROM office_role_grants WHERE id='grant-d1' AND revoked_at IS NULL;" --json)"
if ! grep -Eq '"active_grants"[[:space:]]*:[[:space:]]*0' <<<"$result"; then
  echo "FAIL: revoked grant still appears active"
  printf '%s\n' "$result"
  exit 1
fi

echo "PASS: disposable local D1 migrations and constraint smoke tests completed."
