import test from "node:test";
import assert from "node:assert/strict";
import { createD1WalletAuthRepository } from "./d1-auth-repository.js";

const HASH = "a".repeat(64);

function fakeD1({ batchChanges = [1, 1], insertChanges = 1, firstRows = [] } = {}) {
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
            run: async () => ({ meta: { changes: insertChanges } }),
          };
        },
      };
    },
    async batch(statements) {
      calls.push({ batchSize: statements.length });
      return batchChanges.map((changes) => ({ meta: { changes } }));
    },
  };
  return db;
}

test("D1 auth adapter requires prepare and batch", () => {
  assert.throws(() => createD1WalletAuthRepository(null), /D1 binding/);
  assert.throws(() => createD1WalletAuthRepository({ prepare() {} }), /batch/);
});

test("challenge creation atomically increments keyed email and source windows", async () => {
  const db = fakeD1();
  const repo = createD1WalletAuthRepository(db);
  const result = await repo.createOtpChallenge({
    challengeId: "c".repeat(32),
    email: "member@example.org",
    codeHash: HASH,
    emailRateKey: "b".repeat(64),
    sourceRateKey: "d".repeat(64),
    createdAt: 1_800_000_000_000,
    expiresAt: 1_800_000_600_000,
  });
  assert.deepEqual(result, { deliverable: true });
  assert.equal(db.calls[0].batchSize, 2);
  assert.match(db.calls[1].sql, /email_normalized = \? AND status = 'active'/);
  assert.deepEqual(db.calls[1].values.slice(0, 3), [
    "c".repeat(32), "member@example.org", HASH,
  ]);
  assert.equal(db.calls[1].values[5], "member@example.org");
});

test("challenge is not inserted when either rate counter is exhausted", async () => {
  const db = fakeD1({ batchChanges: [1, 0] });
  const repo = createD1WalletAuthRepository(db);
  const result = await repo.createOtpChallenge({
    challengeId: "c".repeat(32), email: "member@example.org",
    codeHash: HASH, emailRateKey: "b".repeat(64), sourceRateKey: "d".repeat(64),
    createdAt: 1_800_000_000_000, expiresAt: 1_800_000_600_000,
  });
  assert.deepEqual(result, { deliverable: false });
  assert.equal(db.calls.length, 1);
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
