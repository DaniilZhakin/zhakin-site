import test from "node:test";
import assert from "node:assert/strict";
import {
  createRoleGrantApprovalRequest,
  decideRoleGrantApproval,
  findApprovedRoleGrantToken,
} from "../src/role-approval-service.mjs";

const NOW = 1_800_000_000_000;
const admin = {authenticated:true,subjectId:"admin-1",organizationId:"org-a"};
const reviewer = {authenticated:true,subjectId:"human-legal-1",organizationId:"org-a"};
const adminGrant = {id:"g-admin",subject_id:"admin-1",organization_id:"org-a",
  role:"access_admin",scope:"organization",granted_at:NOW-1000,expires_at:null,revoked_at:null};
const reviewerGrant = {id:"g-human",subject_id:"human-legal-1",organization_id:"org-a",
  role:"human_legal",scope:"workspace:legal",granted_at:NOW-1000,expires_at:null,revoked_at:null};
const pending = {id:"req-db-1",organization_id:"org-a",requested_by:"admin-1",
  subject_id:"robot-legal-1",role:"legal_agent",scope:"workspace:legal",
  status:"pending",expires_at:NOW+86_400_000,grant_expires_at:null};
function fakeDb({grants=[adminGrant],request=pending,tokenRow=null,changes=[1,1]}={}) {
  const calls=[];
  return {
    calls,
    prepare(sql) {
      return {sql,values:[],bind(...values){this.values=values;return this;},
        async all() {
          calls.push({type:"all",sql,values:this.values});
          if(sql.includes("FROM office_role_approval_requests") && sql.includes("WHERE id = ?")) return {results:request?[request]:[]};
          if(sql.includes("FROM office_role_approval_requests") && sql.includes("token_hash = ?")) return {results:tokenRow?[tokenRow]:[]};
          if(sql.includes("FROM office_role_grants")) return {results:grants};
          return {results:[]};
        }};
    },
    async batch(statements) {
      calls.push({type:"batch",statements});
      return statements.map((_,i)=>({meta:{changes:changes[i]??0}}));
    }
  };
}

test("only access administrator may create a bounded approval request", async()=>{
  const db=fakeDb();
  const result=await createRoleGrantApprovalRequest({db,principal:admin,subjectId:"robot-legal-1",
    role:"legal_agent",requestId:"request-1",idempotencyKey:"idem-1",now:NOW});
  assert.equal(result.status,"pending");
  assert.equal(result.scope,"workspace:legal");
  assert.equal(result.expires_at,NOW+86_400_000);
  const batch=db.calls.find(x=>x.type==="batch").statements;
  assert.match(batch[0].sql,/INSERT INTO office_role_approval_requests/);
  assert.match(batch[1].sql,/INSERT INTO office_audit_events/);
});

test("approval request rejects self-target, invalid role, and excessive request lifetime",async()=>{
  for(const args of [
    {subjectId:"admin-1",role:"legal_agent",ttlMs:86_400_000},
    {subjectId:"robot",role:"access_admin",ttlMs:86_400_000},
    {subjectId:"robot",role:"legal_agent",ttlMs:8*86_400_000},
  ]) {
    const db=fakeDb();
    await assert.rejects(()=>createRoleGrantApprovalRequest({db,principal:admin,
      subjectId:args.subjectId,role:args.role,requestId:"r",idempotencyKey:"i",
      ttlMs:args.ttlMs,now:NOW}));
    assert.equal(db.calls.some(x=>x.type==="batch"),false);
  }
});

test("matching human reviewer approves once and returns a one-time opaque token",async()=>{
  const db=fakeDb({grants:[reviewerGrant]});
  const result=await decideRoleGrantApproval({db,principal:reviewer,
    approvalRequestId:"req-db-1",decision:"approved",reason:"Reviewed",now:NOW});
  assert.equal(result.status,"approved");
  assert.match(result.token,/^[A-Za-z0-9_-]{43}$/);
  assert.equal(result.token_expires_at,NOW+600_000);
  const batch=db.calls.find(x=>x.type==="batch").statements;
  assert.match(batch[0].sql,/status = 'pending'/);
  assert.match(batch[0].sql,/token_hash = \?/);
  assert.equal(batch[0].values.includes(result.token),false);
  assert.match(batch[1].sql,/INSERT INTO office_audit_events/);
});

test("requester, target, wrong workspace reviewer, and expired request cannot approve",async()=>{
  const cases=[
    {principal:admin,grants:[adminGrant],request:pending},
    {principal:{...reviewer,subjectId:"robot-legal-1"},grants:[],request:pending},
    {principal:{authenticated:true,subjectId:"human-treasury-1",organizationId:"org-a"},
      grants:[{...reviewerGrant,subject_id:"human-treasury-1",role:"human_treasury",scope:"workspace:treasury"}],request:pending},
    {principal:reviewer,grants:[reviewerGrant],request:{...pending,expires_at:NOW}},
  ];
  for(const item of cases) {
    const db=fakeDb(item);
    await assert.rejects(()=>decideRoleGrantApproval({db,principal:item.principal,
      approvalRequestId:"req-db-1",decision:"approved",now:NOW}));
    assert.equal(db.calls.some(x=>x.type==="batch"),false);
  }
});

test("approval lookup binds token to requester, target, role, expiry and scope",async()=>{
  const tokenRow={id:"req-db-1",organization_id:"org-a",requested_by:"admin-1",
    subject_id:"robot-legal-1",role:"legal_agent",scope:"workspace:legal",
    reviewer_id:"human-legal-1",status:"approved",expires_at:NOW+86_400_000,
    grant_expires_at:null,token_expires_at:NOW+600_000,consumed_at:null};
  const db=fakeDb({tokenRow});
  const result=await findApprovedRoleGrantToken({db,token:"opaque-token",principal:admin,
    subjectId:"robot-legal-1",role:"legal_agent",expiresAt:null,now:NOW});
  assert.equal(result.approval.id,"req-db-1");
  assert.match(result.consumeStatement.sql,/status = 'consumed'/);
  assert.equal(result.consumeStatement.values.includes("opaque-token"),false);
});

test("approval lookup rejects expired, consumed, mismatched and absent tokens",async()=>{
  const base={id:"req-db-1",organization_id:"org-a",requested_by:"admin-1",
    subject_id:"robot-legal-1",role:"legal_agent",scope:"workspace:legal",
    reviewer_id:"human-legal-1",status:"approved",expires_at:NOW+86_400_000,
    grant_expires_at:null,token_expires_at:NOW+600_000,consumed_at:null};
  for(const tokenRow of [
    {...base,token_expires_at:NOW},
    {...base,consumed_at:NOW},
    {...base,grant_expires_at:NOW+5000},
    {...base,scope:"workspace:treasury"},
    null,
  ]) {
    const db=fakeDb({tokenRow});
    await assert.rejects(()=>findApprovedRoleGrantToken({db,token:"opaque-token",
      principal:admin,subjectId:"robot-legal-1",role:"legal_agent",expiresAt:null,now:NOW}),
      {status:403});
  }
});
