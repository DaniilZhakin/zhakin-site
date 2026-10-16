import test from "node:test";
import assert from "node:assert/strict";
import {
  createD1WalletRepository,
  encodeLedgerCursor,
} from "./d1-repository.js";

function fakeD1({ firstResult = { balance: 0 }, allResult = { results: [] } } = {}) {
  const calls = [];
  return {
    calls,
    prepare(sql) {
      const call = { sql, values: [] };
      calls.push(call);
      return {
        bind(...values) {
          call.values = values;
          return {
            first: async () => firstResult,
            all: async () => allResult,
          };
        },
      };
    },
  };
}

test("balance query is scoped to the verified participant and posted rows", async () => {
  const db = fakeD1({ firstResult: { balance: 37 } });
  const repository = createD1WalletRepository(db);

  assert.equal(await repository.getBalance("verified-participant"), 37);
  assert.match(db.calls[0].sql, /participant_id = \?/);
  assert.match(db.calls[0].sql, /status = 'posted'/);
  assert.deepEqual(db.calls[0].values, ["verified-participant"]);
});

test("balance rejects a non-safe integer from storage", async () => {
  const db = fakeD1({ firstResult: { balance: Number.MAX_SAFE_INTEGER + 1 } });
  const repository = createD1WalletRepository(db);
  await assert.rejects(repository.getBalance("p1"), /safe integer/);
});

test("ledger query scopes rows to the participant and bounds the page", async () => {
  const rows = Array.from({ length: 3 }, (_, index) => ({
    id: `entry-${index}`,
    points: 5,
    createdAt: `2026-10-1${index}T00:00:00.000Z`,
    status: "posted",
  }));
  const db = fakeD1({ allResult: { results: rows } });
  const repository = createD1WalletRepository(db);

  const page = await repository.listLedger("verified-participant", { limit: 2 });
  assert.equal(page.entries.length, 2);
  assert.equal(typeof page.nextCursor, "string");
  assert.equal(page.entries[0].nextCursor, undefined);
  assert.match(db.calls[0].sql, /participant_id = \?/);
  assert.match(db.calls[0].sql, /ORDER BY created_at DESC, id DESC LIMIT \?/);
  assert.deepEqual(db.calls[0].values, ["verified-participant", 3]);
});

test("ledger cursor applies a stable composite keyset boundary", async () => {
  const cursor = encodeLedgerCursor("2026-10-10T00:00:00.000Z", "entry-9");
  const db = fakeD1();
  const repository = createD1WalletRepository(db);

  await repository.listLedger("p1", { limit: 10, cursor });
  assert.match(db.calls[0].sql, /created_at < \? OR \(created_at = \? AND id < \?\)/);
  assert.deepEqual(db.calls[0].values, [
    "p1",
    "2026-10-10T00:00:00.000Z",
    "2026-10-10T00:00:00.000Z",
    "entry-9",
    11,
  ]);
});

test("ledger rejects malformed cursors, invalid page sizes, and missing participant IDs", async () => {
  const db = fakeD1();
  const repository = createD1WalletRepository(db);

  await assert.rejects(repository.listLedger("p1", { cursor: "not-a-valid-cursor!" }), /cursor/);
  await assert.rejects(repository.listLedger("p1", { limit: 51 }), /page size/);
  await assert.rejects(repository.listLedger(" "), /participant ID/);
  await assert.rejects(repository.getBalance(""), /participant ID/);
  assert.equal(db.calls.length, 0);
});

test("repository cannot be created without a D1 binding", () => {
  assert.throws(() => createD1WalletRepository(null), /database binding/);
});
