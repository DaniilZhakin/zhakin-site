import test from "node:test";
import assert from "node:assert/strict";
import { createD1WalletRepository } from "./d1-repository.js";

function makeDb({ batchError = null } = {}) {
  const prepared = [];
  const db = {
    prepare(sql) {
      const statement = {
        sql,
        values: [],
        bind(...values) {
          this.values = values;
          return this;
        },
      };
      prepared.push(statement);
      return statement;
    },
    async batch(statements) {
      if (batchError) throw batchError;
      return statements.map(() => ({ success: true }));
    },
  };
  return { db, prepared };
}

const validEntry = () => ({
  id: "ledger-1",
  participantId: "participant-1",
  type: "accrual",
  points: 25,
  reason: "approved activity",
  actorId: "reviewer-1",
  idempotencyKey: "activity-1-award",
  createdAt: "2026-10-21T12:00:00.000Z",
});

const validAudit = (overrides = {}) => ({
  id: "audit-1",
  actorId: "reviewer-1",
  action: "wallet.ledger.post",
  targetType: "ledger_entry",
  targetId: "ledger-1",
  outcome: "success",
  createdAt: "2026-10-21T12:00:00.000Z",
  ...overrides,
});

test("ledger insertion batches one ledger row with a matching successful audit event", async () => {
  const { db, prepared } = makeDb();
  const repository = createD1WalletRepository(db);

  const result = await repository.postLedgerEntry(validEntry(), validAudit());

  assert.equal(prepared.length, 2);
  assert.match(prepared[0].sql, /INSERT INTO wallet_ledger_entries/u);
  assert.match(prepared[1].sql, /INSERT INTO wallet_audit_events/u);
  assert.equal(prepared[0].values[6], "reviewer-1");
  assert.equal(prepared[1].values[1], "reviewer-1");
  assert.equal(prepared[1].values[6], "success");
  assert.equal(result.length, 2);
});

for (const outcome of ["denied", "failed"]) {
  test(`a ${outcome} audit outcome cannot create a ledger row`, async () => {
    const { db, prepared } = makeDb();
    const repository = createD1WalletRepository(db);

    await assert.rejects(
      repository.postLedgerEntry(validEntry(), validAudit({ outcome })),
      /ledger entries require a successful audit outcome/u,
    );
    assert.equal(prepared.length, 0, "no SQL statement should be prepared for a rejected write");
  });
}

test("ledger and audit actors must match", async () => {
  const { db, prepared } = makeDb();
  const repository = createD1WalletRepository(db);

  await assert.rejects(
    repository.postLedgerEntry(validEntry(), validAudit({ actorId: "different-reviewer" })),
    /entry and audit actor IDs must match/u,
  );
  assert.equal(prepared.length, 0, "mismatched actors must be rejected before SQL writes");
});

test("database batch errors propagate so callers cannot report a successful write", async () => {
  const failure = new Error("synthetic batch failure");
  const { db } = makeDb({ batchError: failure });
  const repository = createD1WalletRepository(db);

  await assert.rejects(
    repository.postLedgerEntry(validEntry(), validAudit()),
    (error) => error === failure,
  );
});
