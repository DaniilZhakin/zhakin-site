import test from "node:test";
import assert from "node:assert/strict";
import {
  createD1WalletRepository,
  decodeLedgerCursor,
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

test("balance is derived from posted rows for the verified participant only", async () => {
  const db = fakeD1({ firstResult: { balance: 37 } });
  const repository = createD1WalletRepository(db);
  assert.equal(await repository.getBalance("verified-participant"), 37);
  assert.match(db.calls[0].sql, /participant_id = \?/);
  assert.match(db.calls[0].sql, /status = 'posted'/);
  assert.deepEqual(db.calls[0].values, ["verified-participant"]);
});

test("balance rejects unsafe storage values", async () => {
  const repository = createD1WalletRepository(
    fakeD1({ firstResult: { balance: Number.MAX_SAFE_INTEGER + 1 } }),
  );
  await assert.rejects(repository.getBalance("p1"), /safe integer/);
});

test("ledger pages are participant-scoped, bounded and return a next cursor", async () => {
  const rows = [
    { id: "e3", points: 3, createdAt: "2026-10-03T00:00:00.000Z", status: "posted" },
    { id: "e2", points: 2, createdAt: "2026-10-02T00:00:00.000Z", status: "posted" },
    { id: "e1", points: 1, createdAt: "2026-10-01T00:00:00.000Z", status: "posted" },
  ];
  const db = fakeD1({ allResult: { results: rows } });
  const repository = createD1WalletRepository(db);
  const page = await repository.listLedger("verified-participant", { limit: 2 });
  assert.deepEqual(page.entries.map((entry) => entry.id), ["e3", "e2"]);
  assert.equal(typeof page.next_cursor, "string");
  assert.match(db.calls[0].sql, /participant_id = \?/);
  assert.match(db.calls[0].sql, /ORDER BY created_at DESC, id DESC LIMIT \?/);
  assert.deepEqual(db.calls[0].values, ["verified-participant", 3]);
});

test("cursor applies a stable composite keyset boundary", async () => {
  const cursor = encodeLedgerCursor("2026-10-02T00:00:00.000Z", "e2");
  const db = fakeD1();
  const repository = createD1WalletRepository(db);
  await repository.listLedger("p1", { limit: 10, cursor });
  assert.match(db.calls[0].sql, /created_at < \? OR \(created_at = \? AND id < \?\)/);
  assert.deepEqual(db.calls[0].values, [
    "p1", "2026-10-02T00:00:00.000Z", "2026-10-02T00:00:00.000Z", "e2", 11,
  ]);
});

test("malformed cursors, unsafe limits and missing IDs are rejected before DB access", async () => {
  const db = fakeD1();
  const repository = createD1WalletRepository(db);
  await assert.rejects(repository.listLedger("p1", { cursor: "bad cursor" }), /cursor/);
  await assert.rejects(repository.listLedger("p1", { limit: 51 }), /page size/);
  await assert.rejects(repository.listLedger(" "), /participant ID/);
  await assert.rejects(repository.getBalance(""), /participant ID/);
  assert.equal(db.calls.length, 0);
});

test("cursor round-trips and malformed encoded data is rejected", () => {
  const encoded = encodeLedgerCursor("2026-10-01T00:00:00.000Z", "entry-1");
  assert.deepEqual(decodeLedgerCursor(encoded), {
    createdAt: "2026-10-01T00:00:00.000Z",
    id: "entry-1",
  });
  assert.throws(() => decodeLedgerCursor("bm90LWpzb24"), /cursor/);
});

test("repository requires a D1 binding", () => {
  assert.throws(() => createD1WalletRepository(null), /database binding/);
});
