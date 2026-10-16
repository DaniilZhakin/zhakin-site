import test from "node:test";
import assert from "node:assert/strict";
import { createD1WalletOperations } from "./d1-operations.js";

function fakeD1({ changes = 1 } = {}) {
  const calls = [];
  const db = {
    calls,
    batches: [],
    prepare(sql) {
      const call = { sql, values: [] };
      calls.push(call);
      return {
        bind(...values) {
          call.values = values;
          return call;
        },
      };
    },
    async batch(statements) {
      this.batches.push(statements);
      return [
        { success: true, meta: { changes } },
        { success: true, meta: { changes: changes === 1 ? 1 : 0 } },
      ];
    },
  };
  return db;
}

const command = {
  participantId: "verified-participant",
  activityId: "approved-activity",
  actorId: "verified-coordinator",
  points: 25,
  reason: "Подтверждённая активность",
  idempotencyKey: "award-request-001",
};

test("approved award uses one D1 batch for ledger and audit", async () => {
  const db = fakeD1({ changes: 1 });
  let id = 0;
  const operations = createD1WalletOperations(db, {
    idFactory: () => `server-id-${++id}`,
    now: () => "2026-10-16T12:00:00.000Z",
  });

  assert.deepEqual(await operations.awardApprovedActivity(command), {
    status: "awarded",
    entryId: "server-id-1",
    points: 25,
  });
  assert.equal(db.batches.length, 1);
  assert.equal(db.batches[0].length, 2);
  assert.match(db.calls[0].sql, /INSERT OR IGNORE INTO wallet_ledger_entries/);
  assert.match(db.calls[0].sql, /a\.status = 'approved'/);
  assert.match(db.calls[0].sql, /a\.points_awarded = \?/);
  assert.match(db.calls[0].sql, /NOT EXISTS/);
  assert.match(db.calls[0].sql, /idempotency_key/);
  assert.deepEqual(db.calls[0].values, [
    "server-id-1", 25, "Подтверждённая активность", "verified-coordinator",
    "award-request-001", "2026-10-16T12:00:00.000Z",
    "approved-activity", "verified-participant", 25,
  ]);
  assert.match(db.calls[1].sql, /WHERE changes\(\) = 1/);
  assert.deepEqual(db.calls[1].values, [
    "server-id-2", "verified-coordinator", "server-id-1",
    "Подтверждённая активность", "2026-10-16T12:00:00.000Z",
  ]);
});

test("duplicate, unapproved, or mismatched activity is not reported as awarded", async () => {
  const db = fakeD1({ changes: 0 });
  const operations = createD1WalletOperations(db, {
    idFactory: (() => { let id = 0; return () => `id-${++id}`; })(),
  });
  assert.deepEqual(await operations.awardApprovedActivity(command), {
    status: "not_applied",
  });
  assert.equal(db.batches.length, 1);
});

test("rejects unsafe amounts and missing trusted context before database calls", async () => {
  const db = fakeD1();
  const operations = createD1WalletOperations(db);

  await assert.rejects(
    operations.awardApprovedActivity({ ...command, points: 0 }),
    /positive safe integer/,
  );
  await assert.rejects(
    operations.awardApprovedActivity({ ...command, actorId: " " }),
    /actorId/,
  );
  await assert.rejects(
    operations.awardApprovedActivity({ ...command, reason: "x".repeat(501) }),
    /reason/,
  );
  assert.equal(db.calls.length, 0);
  assert.equal(db.batches.length, 0);
});

test("requires a D1 batch-capable binding", () => {
  assert.throws(() => createD1WalletOperations({ prepare() {} }), /batch/);
});
