import test from "node:test";
import assert from "node:assert/strict";
import {
  createRoleGrantApprovalRequest,
  decideRoleGrantApproval,
  findApprovedRoleGrantToken,
  retrieveRoleGrantApprovalCredential,
  revokeRoleGrantApproval,
} from "../src/role-approval-service.mjs";

const NOW = 1_800_000_000_000;
const ENCRYPTION_KEY = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const admin = {authenticated:true,subjectId:"admin-1",organizationId:"org-a"};
const reviewer = {authenticated:true,subjectId:"human-legal-1",organizationId:"org-a"};
const adminGrant = {id:"g-admin",subject_id:"admin-1",organization_id:"org-a",
  role:"access_admin",scope:"organization",granted_at:NOW-1000,expires_at:null,revoked_at:null};
const reviewerGrant = {id:"g-human",subject_id:"human-legal-1",organization_id:"org-a",
  role:"human_legal",scope:"workspace:legal",granted_at:NOW-1000,expires_at:null,revoked_at:null};
const pending = {id:"req-db-1",organization_id:"org-a",requested_by:"admin-1",
  subject_id:"robot-legal-1",role:"legal_agent",scope:"workspace:legal",
  status:"pending",expires_at:NOW+86_400_000,grant_expires_at:null};
function fakeDb({grants=[adminGrant],request=pending,tokenRow=null,changes=[1,1,1],credential=null}={}) {
  const calls=[];
  const state={credential};
  return {
    calls,state,
    prepare(sql) {
      return {sql,values:[],bind(...values){this.values=values;return this;},
        async all() {
          calls.push({type:"all",sql,values:this.values});
          if(sql.includes("JOIN office_role_approval_credentials")) return {results:request && state.credential ? [{...request,...state.credential}] : []};
          if(sql.includes("FROM office_role_approval_requests") && sql.includes("WHERE id = ?")) return {results:request?[request]:[]};
          if(sql.includes("FROM office_role_approval_requests") && sql.includes("token_hash = ?")) return {results:tokenRow?[tokenRow]:[]};
          if(sql.includes("FROM office_role_grants")) return {results:grants};
          return {results:[]};
        },
        async run() {
          calls.push({type:"run",sql,values:this.values});
          if(sql.includes("UPDATE office_role_approval_credentials")) {
            if(!state.credential || state.credential.retrieval_key_hash !== null) return {meta:{changes:0}};
            state.credential={...state.credential,retrieval_key_hash:this.values[0],retrieved_at:this.values[1],recovery_until:this.values[2]};
            return {meta:{changes:1}};
          }
          return {meta:{changes:0}};
        }
      };
    },
    async batch(statements) {
      calls.push({type:"batch",statements});
      if(statements.some(s=>s.sql.includes("INSERT INTO office_role_approval_credentials"))) {
        const s=statements.find(s=>s.sql.includes("INSERT INTO office_role_approval_credentials"));
        state.credential={iv:s.values[2],ciphertext:s.values[3],key_version:s.values[4],retrieval_key_hash:null,retrieved_at:null,recovery_until:null};
      }
      if(statements.some(s=>s.sql.includes("UPDATE office_role_approval_credentials"))) {
        const s=statements.find(s=>s.sql.includes("UPDATE office_role_approval_credentials"));
        if(state.credential && state.credential.retrieval_key_hash === null && (changes[0]??1) === 1) {
          state.credential={...state.credential,retrieval_key_hash:s.values[0],
            retrieved_at:s.values[1],recovery_until:s.values[2]};
        }
      }
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

test("matching human reviewer approves once without returning the bearer credential",async()=>{
  const db=fakeDb({grants:[reviewerGrant]});
  const result=await decideRoleGrantApproval({db,principal:reviewer,
    approvalRequestId:"req-db-1",decision:"approved",reason:"Reviewed",now:NOW,
    credentialEncryptionKey:ENCRYPTION_KEY});
  assert.equal(result.status,"approved");
  assert.equal(Object.hasOwn(result,"token"),false);
  assert.equal(result.token_expires_at,NOW+600_000);
  const batch=db.calls.find(x=>x.type==="batch").statements;
  assert.match(batch[0].sql,/status = 'pending'/);
  assert.ok(batch[0].sql.includes("token_hash = ?"));
  assert.match(batch[1].sql,/INSERT INTO office_role_approval_credentials/);
  assert.equal(typeof batch[1].values[3],"string");
  assert.notEqual(batch[1].values[3].length,43);
  assert.match(batch[2].sql,/INSERT INTO office_audit_events/);
  assert.ok(batch[2].sql.includes("decision_event_id = ?"));
});

test("encrypted credential is recoverable only by requester with same idempotency key",async()=>{
  const request={...pending};
  const db=fakeDb({grants:[reviewerGrant,adminGrant],request});
  const decision=await decideRoleGrantApproval({db,principal:reviewer,
    approvalRequestId:"req-db-1",decision:"approved",now:NOW,
    credentialEncryptionKey:ENCRYPTION_KEY});
  request.status="approved";
  request.reviewer_id=reviewer.subjectId;
  request.token_expires_at=decision.token_expires_at;
  const retrievalKey="B".repeat(43);
  const first=await retrieveRoleGrantApprovalCredential({db,principal:admin,
    approvalRequestId:"req-db-1",retrievalIdempotencyKey:retrievalKey,
    credentialEncryptionKey:ENCRYPTION_KEY,now:NOW+1});
  assert.match(first.token,/^[A-Za-z0-9_-]{43}$/);
  assert.equal(first.recovery_until,NOW+120_001);
  await assert.rejects(()=>retrieveRoleGrantApprovalCredential({db,principal:admin,
    approvalRequestId:"req-db-1",retrievalIdempotencyKey:retrievalKey,
    credentialEncryptionKey:"C".repeat(43),now:NOW+2}),{status:500});
  const originalExpiry=request.expires_at;
  request.expires_at=originalExpiry+1;
  await assert.rejects(()=>retrieveRoleGrantApprovalCredential({db,principal:admin,
    approvalRequestId:"req-db-1",retrievalIdempotencyKey:retrievalKey,
    credentialEncryptionKey:ENCRYPTION_KEY,now:NOW+2}),{status:500});
  request.expires_at=originalExpiry;
  const retry=await retrieveRoleGrantApprovalCredential({db,principal:admin,
    approvalRequestId:"req-db-1",retrievalIdempotencyKey:retrievalKey,
    credentialEncryptionKey:ENCRYPTION_KEY,now:NOW+2});
  assert.equal(retry.token,first.token);
  await assert.rejects(()=>retrieveRoleGrantApprovalCredential({db,principal:admin,
    approvalRequestId:"req-db-1",retrievalIdempotencyKey:retrievalKey,
    credentialEncryptionKey:ENCRYPTION_KEY,now:NOW+120_002}),{status:409});
  await assert.rejects(()=>retrieveRoleGrantApprovalCredential({db,principal:admin,
    approvalRequestId:"req-db-1",retrievalIdempotencyKey:"C".repeat(43),
    credentialEncryptionKey:ENCRYPTION_KEY,now:NOW+2}),{status:409});
  const retrievalBatch=db.calls.filter(x=>x.type==="batch")[1].statements;
  assert.match(retrievalBatch[1].sql,/role:credential_retrieve/);
  assert.equal(retrievalBatch[1].values[5],"credential=claimed;recovery_window_seconds=120");
  assert.equal(db.calls.filter(x=>x.type==="batch").length,2);
});
test("approval fails closed when encryption key is absent",async()=>{
  const db=fakeDb({grants:[reviewerGrant]});
  await assert.rejects(()=>decideRoleGrantApproval({db,principal:reviewer,
    approvalRequestId:"req-db-1",decision:"approved",now:NOW}),{status:500});
  assert.equal(db.calls.some(x=>x.type==="batch"),false);
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

test("concurrent decision conflict does not append a success audit",async()=>{
  const db=fakeDb({grants:[reviewerGrant],changes:[0,0,0]});
  await assert.rejects(()=>decideRoleGrantApproval({db,principal:reviewer,
    approvalRequestId:"req-db-1",decision:"approved",now:NOW,
    credentialEncryptionKey:ENCRYPTION_KEY}),{status:409});
  const batch=db.calls.find(x=>x.type==="batch").statements;
  assert.match(batch[0].sql,/status = 'pending'/);
  assert.match(batch[2].sql,/FROM office_role_approval_requests/);
});

test("approval lookup binds token to requester, target, role, expiry and scope",async()=>{
  const tokenRow={id:"req-db-1",organization_id:"org-a",requested_by:"admin-1",
    subject_id:"robot-legal-1",role:"legal_agent",scope:"workspace:legal",
    reviewer_id:"human-legal-1",status:"approved",expires_at:NOW+86_400_000,
    grant_expires_at:null,token_expires_at:NOW+600_000,consumed_at:null,consumed_grant_id:null};
  const db=fakeDb({tokenRow});
  const result=await findApprovedRoleGrantToken({db,token:"opaque-token",principal:admin,
    subjectId:"robot-legal-1",role:"legal_agent",expiresAt:null,grantId:"grant-new",now:NOW});
  assert.equal(result.approval.id,"req-db-1");
  assert.match(result.consumeStatement.sql,/status = 'consumed'/);
  assert.match(result.consumeStatement.sql,/office_role_approval_revocations/);
  assert.ok(db.calls.some(call => call.sql?.includes("EXISTS (") && call.sql?.includes("office_role_approval_credentials")));
  assert.equal(result.consumeStatement.values.includes("opaque-token"),false);
});

test("requester can revoke an approved credential and atomically delete its envelope",async()=>{
  const approved={...pending,status:"approved",reviewer_id:reviewer.subjectId,
    decided_at:NOW,decision_event_id:"decision-1",token_hash:"hash-1",
    token_expires_at:NOW+600_000};
  const db=fakeDb({request:approved,changes:[1,1,1]});
  const result=await revokeRoleGrantApproval({db,principal:admin,
    approvalRequestId:"req-db-1",requestId:"revoke-request-1",
    reason:"Credential delivery was not completed",now:NOW+121_000});
  assert.deepEqual(result,{id:"req-db-1",status:"revoked",revoked_at:NOW+121_000});
  const batch=db.calls.find(call=>call.type==="batch").statements;
  assert.match(batch[0].sql,/INSERT INTO office_role_approval_revocations/);
  assert.match(batch[0].sql,/requested_by = \?/);
  assert.match(batch[1].sql,/DELETE FROM office_role_approval_credentials/);
  assert.equal(batch.length,2);
  assert.equal(batch.some(statement=>statement.values.includes("hash-1")),false);
});

test("only the original requester may revoke and revocation fails closed on conflict",async()=>{
  const approved={...pending,status:"approved",reviewer_id:reviewer.subjectId,
    decided_at:NOW,decision_event_id:"decision-1",token_hash:"hash-1",
    token_expires_at:NOW+600_000};
  const otherAdmin={...admin,subjectId:"other-admin"};
  const db=fakeDb({grants:[{...adminGrant,subject_id:"other-admin"}],request:approved});
  await assert.rejects(()=>revokeRoleGrantApproval({db,principal:otherAdmin,
    approvalRequestId:"req-db-1",requestId:"revoke-request-2",now:NOW}),{status:409});
  assert.equal(db.calls.some(call=>call.type==="batch"),false);

  const conflictDb=fakeDb({request:approved,changes:[0,0,0]});
  await assert.rejects(()=>revokeRoleGrantApproval({db:conflictDb,principal:admin,
    approvalRequestId:"req-db-1",requestId:"revoke-request-3",now:NOW}),{status:409});
});

test("approval lookup rejects expired, consumed, mismatched and absent tokens",async()=>{
  const base={id:"req-db-1",organization_id:"org-a",requested_by:"admin-1",
    subject_id:"robot-legal-1",role:"legal_agent",scope:"workspace:legal",
    reviewer_id:"human-legal-1",status:"approved",expires_at:NOW+86_400_000,
    grant_expires_at:null,token_expires_at:NOW+600_000,consumed_at:null,consumed_grant_id:null};
  for(const tokenRow of [
    {...base,token_expires_at:NOW},
    {...base,consumed_at:NOW},
    {...base,grant_expires_at:NOW+5000},
    {...base,scope:"workspace:treasury"},
    null,
  ]) {
    const db=fakeDb({tokenRow});
    await assert.rejects(()=>findApprovedRoleGrantToken({db,token:"opaque-token",
      principal:admin,subjectId:"robot-legal-1",role:"legal_agent",expiresAt:null,grantId:"grant-new",now:NOW}),
      {status:403});
  }
});
