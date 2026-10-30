import test from "node:test";
import assert from "node:assert/strict";
import { createEmailOtpAuth } from "./email-otp-auth.js";

const SECRET = "test-only-secret-with-at-least-32-characters";
const fixedNow = () => 1793361600000;

function fakeRepository() {
  const state = { challenges: new Map(), sessions: new Map(), revoked: [] };
  return {
    state,
    async createOtpChallenge(challenge) {
      state.challenges.set(challenge.challengeId, { ...challenge, attempts: 0, consumed: false });
      return { deliverable: true };
    },
    async consumeOtpChallenge({ challengeId, codeHash, now, maxAttempts }) {
      const challenge = state.challenges.get(challengeId);
      if (!challenge || challenge.consumed || challenge.expiresAt <= now ||
          challenge.attempts >= maxAttempts) return null;
      if (challenge.codeHash !== codeHash) {
        challenge.attempts += 1;
        return null;
      }
      challenge.consumed = true;
      return { email: challenge.email };
    },
    async revokeOtpChallenge({ challengeId, revokedAt }) {
      const challenge = state.challenges.get(challengeId);
      if (challenge) challenge.revokedAt = revokedAt;
    },
    async findParticipantByEmail(email) {
      return email === "member@example.org"
        ? { id: "participant-verified-1", status: "active" }
        : null;
    },
    async createSession(session) { state.sessions.set(session.tokenHash, session); },
    async findActiveSession({ tokenHash, now }) {
      const session = state.sessions.get(tokenHash);
      if (!session || session.revokedAt || session.expiresAt <= now) return null;
      return { participantId: session.participantId };
    },
    async getParticipantById(id) {
      return id === "participant-verified-1"
        ? { id, status: "active", roles: ["participant"] }
        : null;
    },
    async revokeSession({ tokenHash, revokedAt }) {
      const session = state.sessions.get(tokenHash);
      if (session) session.revokedAt = revokedAt;
      state.revoked.push(tokenHash);
    },
  };
}

test("request creates a short-lived hashed challenge and sends code only through injected mailer", async () => {
  const repository = fakeRepository();
  let delivered;
  const auth = createEmailOtpAuth({
    repository,
    secret: SECRET,
    now: fixedNow,
    deliverEmail: async (message) => { delivered = message; },
  });
  const result = await auth.requestCode(" Member@Example.org ", { sourceKey: "198.51.100.7" });
  assert.equal(result.accepted, true);
  assert.equal(result.expires_in, 600);
  assert.match(result.challenge_id, /^[a-f0-9]{32}$/);
  assert.equal(delivered.to, "member@example.org");
  assert.match(delivered.code, /^\d{6}$/);
  assert.equal(repository.state.challenges.get(result.challenge_id).codeHash.includes(delivered.code), false);
  assert.equal(JSON.stringify(result).includes(delivered.code), false);
});

test("successful OTP is single-use and creates a secure HttpOnly session cookie", async () => {
  const repository = fakeRepository();
  let delivered;
  const auth = createEmailOtpAuth({
    repository, secret: SECRET, now: fixedNow,
    deliverEmail: async (message) => { delivered = message; },
  });
  const challenge = await auth.requestCode("member@example.org", { sourceKey: "198.51.100.7" });
  const verified = await auth.verifyCode({ challengeId: challenge.challenge_id, code: delivered.code });
  assert.equal(verified.authenticated, true);
  assert.deepEqual(verified.participant, { id: "participant-verified-1" });
  assert.match(verified.setCookie, /HttpOnly/);
  assert.match(verified.setCookie, /Secure/);
  assert.match(verified.setCookie, /SameSite=Strict/);
  assert.equal(JSON.stringify(verified).includes(delivered.code), false);

  const replay = await auth.verifyCode({ challengeId: challenge.challenge_id, code: delivered.code });
  assert.deepEqual(replay, { authenticated: false });
});

test("authenticated principal comes from stored session and participant registry, not request parameters", async () => {
  const repository = fakeRepository();
  let delivered;
  const auth = createEmailOtpAuth({
    repository, secret: SECRET, now: fixedNow,
    deliverEmail: async (message) => { delivered = message; },
  });
  const challenge = await auth.requestCode("member@example.org", { sourceKey: "198.51.100.7" });
  const verified = await auth.verifyCode({ challengeId: challenge.challenge_id, code: delivered.code });
  const token = verified.setCookie.match(/zhakin_wallet_session=([^;]+)/)[1];
  const request = new Request("https://wallet.test/api/v1/me?participant_id=attacker", {
    headers: { cookie: `zhakin_wallet_session=${token}` },
  });
  assert.deepEqual(await auth.authenticate(request), {
    id: "participant-verified-1",
    roles: ["participant"],
  });
});

test("invalid, malformed, expired, or unknown challenges fail closed", async () => {
  const repository = fakeRepository();
  const auth = createEmailOtpAuth({
    repository, secret: SECRET, now: fixedNow, deliverEmail: async () => {},
  });
  assert.deepEqual(await auth.verifyCode({ challengeId: "../bad", code: "123456" }), {
    authenticated: false,
  });
  assert.deepEqual(await auth.verifyCode({ challengeId: "a".repeat(32), code: "bad" }), {
    authenticated: false,
  });
  assert.deepEqual(await auth.verifyCode({ challengeId: "a".repeat(32), code: "123456" }), {
    authenticated: false,
  });
  assert.equal(await auth.authenticate(new Request("https://wallet.test")), null);
});

test("email delivery failure revokes the challenge and does not expose provider errors", async () => {
  const repository = fakeRepository();
  const auth = createEmailOtpAuth({
    repository, secret: SECRET, now: fixedNow,
    deliverEmail: async () => { throw new Error("mail provider secret detail"); },
  });
  const result = await auth.requestCode("member@example.org", { sourceKey: "198.51.100.7" });
  assert.equal(result.accepted, true);
  assert.equal(repository.state.challenges.get(result.challenge_id).revokedAt, fixedNow());
  assert.equal(JSON.stringify(result).includes("mail provider"), false);
});

test("logout revokes the session and expires the cookie", async () => {
  const repository = fakeRepository();
  let delivered;
  const auth = createEmailOtpAuth({
    repository, secret: SECRET, now: fixedNow,
    deliverEmail: async (message) => { delivered = message; },
  });
  const challenge = await auth.requestCode("member@example.org", { sourceKey: "198.51.100.7" });
  const verified = await auth.verifyCode({ challengeId: challenge.challenge_id, code: delivered.code });
  const token = verified.setCookie.match(/zhakin_wallet_session=([^;]+)/)[1];
  const result = await auth.logout(new Request("https://wallet.test/api/v1/auth/logout", {
    headers: { cookie: `zhakin_wallet_session=${token}` },
  }));
  assert.match(result.setCookie, /Max-Age=0/);
  assert.equal(repository.state.revoked.length, 1);
  assert.equal(await auth.authenticate(new Request("https://wallet.test", {
    headers: { cookie: `zhakin_wallet_session=${token}` },
  })), null);
});

test("constructor refuses missing repository, mailer, or weak secret", () => {
  assert.throws(() => createEmailOtpAuth({}), /repository/);
  assert.throws(() => createEmailOtpAuth({
    repository: fakeRepository(), secret: SECRET,
  }), /delivery adapter/);
  assert.throws(() => createEmailOtpAuth({
    repository: fakeRepository(), deliverEmail: async () => {}, secret: "short",
  }), /32 characters/);
});

test("request without trusted source metadata does not create or send a challenge", async () => {
  const repository = fakeRepository();
  let deliveries = 0;
  const auth = createEmailOtpAuth({
    repository, secret: SECRET, now: fixedNow,
    deliverEmail: async () => { deliveries += 1; },
  });
  const result = await auth.requestCode("member@example.org");
  assert.equal(result.accepted, true);
  assert.equal(result.challenge_id, null);
  assert.equal(repository.state.challenges.size, 0);
  assert.equal(deliveries, 0);
});

test("challenge storage receives keyed rate-limit subjects, not raw source address", async () => {
  const repository = fakeRepository();
  let delivered;
  const auth = createEmailOtpAuth({
    repository, secret: SECRET, now: fixedNow,
    deliverEmail: async (message) => { delivered = message; },
  });
  const result = await auth.requestCode("member@example.org", { sourceKey: "198.51.100.7" });
  const challenge = repository.state.challenges.get(result.challenge_id);
  assert.match(challenge.emailRateKey, /^[a-f0-9]{64}$/);
  assert.match(challenge.sourceRateKey, /^[a-f0-9]{64}$/);
  assert.equal(challenge.sourceRateKey.includes("198.51.100.7"), false);
  assert.equal(delivered.to, "member@example.org");
});
