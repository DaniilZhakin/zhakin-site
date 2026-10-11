import test from "node:test";
import assert from "node:assert/strict";
import { buildLedgerEntry, calculateBalance, validateLedgerCommand } from "./ledger.js";

const base = {
  participantId: "participant-test-001",
  type: "accrual",
  points: 25,
  reason: "Подтверждённое тестовое задание",
  activityId: "activity-test-001",
  actorId: "coordinator-test-001",
  idempotencyKey: "test-idempotency-001",
};

test("builds a normalized ledger entry with server-supplied ID", () => {
  const entry = buildLedgerEntry(base, {
    id: "ledger-test-001",
    now: "2026-10-11T00:00:00.000Z",
  });
  assert.equal(entry.points, 25);
  assert.equal(entry.status, "posted");
  assert.equal(entry.id, "ledger-test-001");
  assert.equal(Object.isFrozen(entry), true);
});

test("rejects zero, fractional and unsafe point amounts", () => {
  for (const points of [0, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => validateLedgerCommand({ ...base, points }), /points/);
  }
});

test("rejects negative accrual and positive reversal", () => {
  assert.throws(() => validateLedgerCommand({ ...base, points: -10 }), /accrual/);
  assert.throws(
    () => validateLedgerCommand({ ...base, type: "reversal", points: 10 }),
    /reversal/,
  );
});

test("requires reason, actor and idempotency key", () => {
  assert.throws(() => validateLedgerCommand({ ...base, reason: " " }), /reason/);
  assert.throws(() => validateLedgerCommand({ ...base, actorId: "" }), /actorId/);
  assert.throws(() => validateLedgerCommand({ ...base, idempotencyKey: "" }), /idempotencyKey/);
});

test("calculates balance from posted entries only and isolates participants", () => {
  const entries = [
    { participantId: "p1", points: 25, status: "posted" },
    { participantId: "p1", points: -5, status: "posted" },
    { participantId: "p1", points: 100, status: "pending" },
    { participantId: "p2", points: 900, status: "posted" },
  ];
  assert.equal(calculateBalance(entries, "p1"), 20);
  assert.equal(calculateBalance(entries, "p2"), 900);
});

test("rejects entries with non-integer point values when calculating balance", () => {
  assert.throws(
    () => calculateBalance([{ participantId: "p1", points: 2.2, status: "posted" }], "p1"),
    /safe integers/,
  );
});
