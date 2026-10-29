import test from "node:test";
import assert from "node:assert/strict";
import { createD1WalletRepository } from "./d1-repository.js";

function fakeDb({ first = null, rows = [], batchResult = [] } = {}) {
  const prepared = [];
  const batches = [];
  const db = {
    prepared,
    batches,
    prepare(sql) {
      const statement = {
        sql,
        params: [],
        bind(...params) { this.params = params; return this; },
        async first() { return first; },
        async all() { return { results: rows }; },
      };
      prepared.push(statement);
      return statement;
    },
    async batch(statements) { batches.push(statements); return batchResult; },
  };
  return db;
}

test("D1 balance query is scoped to the server-supplied participant ID", async () => {
  const db = fakeDb({ first: { points: 420 } });
  const repo = createD1WalletRepository(db);
  assert.equal(await repo.getBalance("participant-verified"), 420);
  assert.match(db.prepared[0].sql, /WHERE participant_id = \?/);
  assert.deepEqual(db.prepared[0].params, ["participant-verified"]);
});

test("D1 balance rejects unsafe or missing database values", async () => {
  for (const first of [{ points: Number.MAX_SAFE_INTEGER + 1 }, { points: "420" }, null]) {
    const repo = createD1WalletRepository(fakeDb({ first }));
    await assert.rejects(() => repo.getBalance("participant-verified"), RangeError);
  }
});

test("ledger pagination remains participant-scoped and emits a cursor for the last returned row", async () => {
  const rows = [
    { id: "entry-3", created_at: "2026-10-29T12:03:00Z", activity_id: null, entry_type: "accrual", points: 30, reason: "synthetic", status: "posted" },
    { id: "entry-2", created_at: "2026-10-29T12:02:00Z", activity_id: "activity-1", entry_type: "accrual", points: 20, reason: "synthetic", status: "posted" },
    { id: "entry-1", created_at: "2026-10-29T12:01:00Z", activity_id: null, entry_type: "reversal", points: -10, reason: "synthetic", status: "voided" },
  ];
  const db = fakeDb({ rows });
  const repo = createD1WalletRepository(db);
  const page = await repo.listLedger("participant-verified", { limit: 2 });
  assert.equal(page.entries.length, 2);
  assert.equal(page.entries[0].id, "entry-3");
  assert.equal(page.entries[1].id, "entry-2");
  assert.match(db.prepared[0].sql, /WHERE participant_id = \?/);
  assert.deepEqual(db.prepared[0].params, ["participant-verified", 3]);
  const normalized = page.next_cursor.replaceAll("-", "+").replaceAll("_", "/");
  const decoded = JSON.parse(atob(normalized + "=".repeat((4 - normalized.length % 4) % 4)));
  assert.deepEqual(decoded, ["2026-10-29T12:02:00Z", "entry-2"]);
});

test("ledger pagination rejects malformed cursors and out-of-range limits", async () => {
  const repo = createD1WalletRepository(fakeDb());
  await assert.rejects(() => repo.listLedger("p-1", { cursor: "%%%not-a-cursor%%%" }), /Invalid ledger cursor/);
  await assert.rejects(() => repo.listLedger("p-1", { limit: 0 }), /limit must be between 1 and 100/);
  await assert.rejects(() => repo.listLedger("p-1", { limit: 101 }), /limit must be between 1 and 100/);
});

test("ledger entry and audit event are submitted together in one D1 batch", async () => {
  const db = fakeDb();
  const repo = createD1WalletRepository(db);
  await repo.postLedgerEntry({
    id: "ledger-1", participantId: "participant-verified", activityId: "activity-1",
    type: "accrual", points: 25, reason: "synthetic test", actorId: "admin-verified",
    idempotencyKey: "idem-001", createdAt: "2026-10-29T12:00:00Z",
  }, {
    id: "audit-1", actorId: "admin-verified", action: "ledger.accrual",
    targetType: "wallet_ledger_entry", targetId: "ledger-1", reason: "synthetic test",
    outcome: "success", createdAt: "2026-10-29T12:00:00Z",
  });
  assert.equal(db.batches.length, 1);
  assert.equal(db.batches[0].length, 2);
  assert.match(db.batches[0][0].sql, /INSERT INTO wallet_ledger_entries/);
  assert.match(db.batches[0][1].sql, /INSERT INTO wallet_audit_events/);
});

test("invalid ledger mutation fails before touching the database", async () => {
  const db = fakeDb();
  const repo = createD1WalletRepository(db);
  await assert.rejects(() => repo.postLedgerEntry({
    id: "ledger-1", participantId: "participant-verified", type: "accrual", points: 0,
    reason: "invalid zero points", actorId: "admin-verified", idempotencyKey: "idem-001",
    createdAt: "2026-10-29T12:00:00Z",
  }, {
    id: "audit-1", actorId: "admin-verified", action: "ledger.accrual",
    targetType: "wallet_ledger_entry", targetId: "ledger-1", outcome: "success",
    createdAt: "2026-10-29T12:00:00Z",
  }), /non-zero safe integer/);
  assert.equal(db.batches.length, 0);
});


test("ledger rejects accrual/reversal signs that would invert their meaning", async () => {
  const db = fakeDb();
  const repo = createD1WalletRepository(db);
  const baseEntry = {
    id: "ledger-sign", participantId: "participant-verified", activityId: null,
    reason: "synthetic sign test", actorId: "admin-verified",
    idempotencyKey: "idem-sign", createdAt: "2026-10-29T12:00:00Z",
  };
  const audit = {
    id: "audit-sign", actorId: "admin-verified", action: "ledger.test",
    targetType: "wallet_ledger_entry", targetId: "ledger-sign",
    outcome: "success", createdAt: "2026-10-29T12:00:00Z",
  };
  await assert.rejects(() => repo.postLedgerEntry({ ...baseEntry, type: "accrual", points: -5 }, audit), /sign does not match/);
  await assert.rejects(() => repo.postLedgerEntry({ ...baseEntry, type: "reversal", points: 5 }, audit), /sign does not match/);
  assert.equal(db.batches.length, 0);
});

test("ledger permits only the expected sign for accrual and reversal", async () => {
  const db = fakeDb();
  const repo = createD1WalletRepository(db);
  const audit = {
    id: "audit-sign-ok", actorId: "admin-verified", action: "ledger.test",
    targetType: "wallet_ledger_entry", targetId: "ledger-sign-ok",
    outcome: "success", createdAt: "2026-10-29T12:00:00Z",
  };
  const common = {
    id: "ledger-sign-ok", participantId: "participant-verified", activityId: null,
    reason: "synthetic sign test", actorId: "admin-verified",
    idempotencyKey: "idem-sign-ok", createdAt: "2026-10-29T12:00:00Z",
  };
  await repo.postLedgerEntry({ ...common, type: "accrual", points: 5 }, audit);
  assert.equal(db.batches.length, 1);
  const reversalDb = fakeDb();
  await createD1WalletRepository(reversalDb).postLedgerEntry(
    { ...common, id: "ledger-reversal-ok", idempotencyKey: "idem-reversal-ok", type: "reversal", points: -5 },
    { ...audit, id: "audit-reversal-ok", targetId: "ledger-reversal-ok" }
  );
  assert.equal(reversalDb.batches.length, 1);
});
