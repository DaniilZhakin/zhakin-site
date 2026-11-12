import test from "node:test";
import assert from "node:assert/strict";
import { createD1WalletAuthRepository } from "./d1-auth-repository.js";

const HASH = "a".repeat(64);

function fakeD1({ rateRows = [{ subject_hmac: "b".repeat(64) }, { subject_hmac: "d".repeat(64) }], insertChanges = 1, firstRows = [], allRows = [] } = {}) {
  const calls = [];
  let firstIndex = 0;
  const db = {
    calls,
    prepare(sql) {
      const call = { sql, values: [] };
      calls.push(call);
      return {
        bind(...values) {
          call.values = values;
          return {
            first: async () => firstRows[firstIndex++] ?? null,
            all: async () => sql.includes("RETURNING subject_hmac")
              ? ({ results: rateRows }) : ({ results: allRows }),
            run: async () => ({ meta: { changes: insertChanges } }),
          };
        },
      };
    },
  };
  return db;
}

const challengeInput = {
  challengeId: "c".repeat(32),
  email: "member@example.org",
  codeHash: HASH,
  emailRateKey: "b".repeat(64),
  sourceRateKey: "d".repeat(64),
  createdAt: 1_800_000_000_000,
  expiresAt: 1_800_000_600_000,
};

test("D1 auth adapter requires prepare", () => {
  assert.throws(() => createD1WalletAuthRepository(null), /D1 binding/);
  assert.throws(() => createD1WalletAuthRepository({}), /prepare/);
});

test("challenge creation updates both keyed rate windows in one conditional SQL statement", async () => {
  const db = fakeD1();
  const repo = createD1WalletAuthRepository(db);
  const result = await repo.createOtpChallenge(challengeInput);
  assert.deepEqual(result, { deliverable: true });
  assert.equal(db.calls.length, 2);
  assert.match(db.calls[0].sql, /INSERT INTO wallet_auth_rate_limits/);
  assert.match(db.calls[0].sql, /WHERE NOT EXISTS/);
  assert.match(db.calls[0].sql, /ON CONFLICT\(subject_hmac, window_started_at\)/);
  assert.match(db.calls[0].sql, /RETURNING subject_hmac/);
  assert.deepEqual(db.calls[0].values, [
    1_800_000_000_000, "b".repeat(64), "d".repeat(64), 1_800_000_000_000,
    "b".repeat(64), 3, "d".repeat(64), 10,
  ]);
  assert.match(db.calls[1].sql, /email_normalized = \? AND status = 'active'/);
  assert.deepEqual(db.calls[1].values.slice(0, 3), [
    "c".repeat(32), "member@example.org", HASH,
  ]);
});

test("challenge is not inserted and neither rate counter is changed when either limit is exhausted", async () => {
  const db = fakeD1({ rateRows: [] });
  const repo = createD1WalletAuthRepository(db);
  const result = await repo.createOtpChallenge(challengeInput);
  assert.deepEqual(result, { deliverable: false });
  assert.equal(db.calls.length, 1);
  assert.match(db.calls[0].sql, /existing.request_count >= \?/);
});

test("challenge creation rejects identical rate subjects", async () => {
  const db = fakeD1();
  const repo = createD1WalletAuthRepository(db);
  await assert.rejects(repo.createOtpChallenge({
    ...challengeInput, sourceRateKey: challengeInput.emailRateKey,
  }), /distinct/);
  assert.equal(db.calls.length, 0);
});

test("OTP consumption is one conditional update with expiry, attempt and replay guards", async () => {
  const db = fakeD1({ firstRows: [{ email: "member@example.org" }] });
  const repo = createD1WalletAuthRepository(db);
  const result = await repo.consumeOtpChallenge({
    challengeId: "c".repeat(32), codeHash: HASH, now: 1_800_000_100_000, maxAttempts: 5,
  });
  assert.deepEqual(result, { email: "member@example.org" });
  assert.match(db.calls[0].sql, /attempts = attempts \+ 1/);
  assert.match(db.calls[0].sql, /consumed_at IS NULL/);
  assert.match(db.calls[0].sql, /expires_at > \?/);
  assert.match(db.calls[0].sql, /attempts < \?/);
  assert.match(db.calls[0].sql, /RETURNING/);
});

test("failed OTP update returns no email and cannot authenticate", async () => {
  const db = fakeD1({ firstRows: [{ email: null }] });
  const repo = createD1WalletAuthRepository(db);
  assert.equal(await repo.consumeOtpChallenge({
    challengeId: "c".repeat(32), codeHash: HASH, now: 1_800_000_100_000, maxAttempts: 5,
  }), null);
});

test("session lookup and revocation are participant-bound and expiry-aware", async () => {
  const db = fakeD1({ firstRows: [{ participantId: "participant-1" }] });
  const repo = createD1WalletAuthRepository(db);
  assert.deepEqual(await repo.findActiveSession({ tokenHash: HASH, now: 1_800_000_100_000 }), {
    participantId: "participant-1",
  });
  assert.match(db.calls[0].sql, /revoked_at IS NULL AND expires_at > \?/);
  await repo.revokeSession({ tokenHash: HASH, revokedAt: 1_800_000_200_000 });
  assert.match(db.calls[1].sql, /UPDATE wallet_auth_sessions SET revoked_at/);
});

test("repository rejects malformed HMACs and invalid limits before SQL execution", async () => {
  const db = fakeD1();
  const repo = createD1WalletAuthRepository(db);
  await assert.rejects(repo.findActiveSession({ tokenHash: "not-a-hash", now: 1 }), /HMAC/);
  await assert.rejects(repo.consumeOtpChallenge({
    challengeId: "c".repeat(32), codeHash: HASH, now: 1, maxAttempts: 6,
  }), /maxAttempts/);
  assert.equal(db.calls.length, 0);
});

test("participant roles are loaded only from active server-side grants", async () => {
  const db = fakeD1({
    firstRows: [{ id: "participant-1", status: "active" }],
    allRows: [
      { role: "admin" },
      { role: "coordinator" },
      { role: "admin" },
      { role: "unexpected-browser-role" },
    ],
  });
  const repo = createD1WalletAuthRepository(db);
  assert.deepEqual(await repo.getParticipantById("participant-1", 1_800_000_000_000), {
    id: "participant-1",
    status: "active",
    roles: ["admin", "coordinator"],
  });
  assert.match(db.calls[1].sql, /wallet_role_assignments/);
  assert.match(db.calls[1].sql, /status = 'active'/);
  assert.match(db.calls[1].sql, /scope_type = 'global' OR scope_type = 'project'/);
  assert.deepEqual(db.calls[1].values, ["participant-1"]);
});

test("missing participant never triggers role lookup", async () => {
  const db = fakeD1({ firstRows: [null] });
  const repo = createD1WalletAuthRepository(db);
  assert.equal(await repo.getParticipantById("missing", 1_800_000_000_000), null);
  assert.equal(db.calls.length, 1);
});
