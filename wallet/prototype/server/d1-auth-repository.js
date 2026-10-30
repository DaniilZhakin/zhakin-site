/**
 * Cloudflare D1 persistence adapter for Wallet email OTP and sessions.
 *
 * This adapter is intentionally separate from the read-only ledger adapter.
 * It requires migrations 0001 and 0002 and is not connected to a Worker or
 * any live database. D1 batch() is used for the two rate-counter writes;
 * challenge consumption is a single conditional UPDATE ... RETURNING.
 */
const RATE_WINDOW_MS = 15 * 60 * 1000;
const EMAIL_REQUEST_LIMIT = 3;
const SOURCE_REQUEST_LIMIT = 10;

function requireDb(db) {
  if (!db || typeof db.prepare !== "function" || typeof db.batch !== "function") {
    throw new TypeError("Cloudflare D1 binding with prepare() and batch() is required");
  }
}
function requiredString(value, name, max = 512) {
  if (typeof value !== "string" || value.length === 0 || value.length > max) {
    throw new TypeError(`${name} is invalid`);
  }
  return value;
}
function requiredTime(value, name) {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`${name} is invalid`);
  return value;
}
function requiredHash(value, name) {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) {
    throw new TypeError(`${name} must be a SHA-256 HMAC hex digest`);
  }
  return value;
}
function changed(result) {
  return Number(result?.meta?.changes ?? result?.changes ?? 0);
}

export function createD1WalletAuthRepository(db) {
  requireDb(db);
  return Object.freeze({
    async createOtpChallenge({
      challengeId, email, codeHash, emailRateKey, sourceRateKey, createdAt, expiresAt,
    }) {
      requiredString(challengeId, "challengeId", 64);
      requiredString(email, "email", 254);
      requiredHash(codeHash, "codeHash");
      requiredHash(emailRateKey, "emailRateKey");
      requiredHash(sourceRateKey, "sourceRateKey");
      requiredTime(createdAt, "createdAt");
      requiredTime(expiresAt, "expiresAt");
      if (expiresAt <= createdAt) throw new TypeError("challenge expiry must follow creation");

      const windowStartedAt = Math.floor(createdAt / RATE_WINDOW_MS) * RATE_WINDOW_MS;
      // D1 batch executes both counter upserts atomically. A counter at its
      // threshold is not incremented; no challenge is created unless both
      // writes succeeded. Keys are HMACs, never raw email/IP values.
      const counters = await db.batch([
        db.prepare(
          "INSERT INTO wallet_auth_rate_limits " +
          "(subject_hmac, window_started_at, request_count) VALUES (?, ?, 1) " +
          "ON CONFLICT(subject_hmac, window_started_at) DO UPDATE SET " +
          "request_count = request_count + 1 WHERE request_count < ?",
        ).bind(emailRateKey, windowStartedAt, EMAIL_REQUEST_LIMIT),
        db.prepare(
          "INSERT INTO wallet_auth_rate_limits " +
          "(subject_hmac, window_started_at, request_count) VALUES (?, ?, 1) " +
          "ON CONFLICT(subject_hmac, window_started_at) DO UPDATE SET " +
          "request_count = request_count + 1 WHERE request_count < ?",
        ).bind(sourceRateKey, windowStartedAt, SOURCE_REQUEST_LIMIT),
      ]);
      if (!Array.isArray(counters) || counters.length !== 2 ||
          changed(counters[0]) !== 1 || changed(counters[1]) !== 1) {
        return { deliverable: false };
      }

      // Unknown, suspended and closed participants receive no deliverable
      // challenge. The public service still returns a generic acceptance shape.
      const inserted = await db.prepare(
        "INSERT INTO wallet_otp_challenges " +
        "(id, email_normalized, code_hmac, attempts, created_at, expires_at) " +
        "SELECT ?, ?, ?, 0, ?, ? WHERE EXISTS (" +
        "SELECT 1 FROM wallet_participants WHERE email_normalized = ? AND status = 'active')",
      ).bind(challengeId, email, codeHash, createdAt, expiresAt, email).run();
      return { deliverable: changed(inserted) === 1 };
    },

    async consumeOtpChallenge({ challengeId, codeHash, now, maxAttempts }) {
      requiredString(challengeId, "challengeId", 64);
      requiredHash(codeHash, "codeHash");
      requiredTime(now, "now");
      if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 5) {
        throw new TypeError("maxAttempts is invalid");
      }
      // A single conditional UPDATE serializes competing verifications:
      // only one request can set consumed_at. Wrong codes increment attempts;
      // the fifth failed attempt exhausts the challenge.
      const row = await db.prepare(
        "UPDATE wallet_otp_challenges SET " +
        "attempts = attempts + 1, " +
        "consumed_at = CASE WHEN code_hmac = ? THEN ? ELSE consumed_at END " +
        "WHERE id = ? AND revoked_at IS NULL AND consumed_at IS NULL " +
        "AND expires_at > ? AND attempts < ? " +
        "RETURNING CASE WHEN code_hmac = ? THEN email_normalized ELSE NULL END AS email",
      ).bind(codeHash, now, challengeId, now, maxAttempts, codeHash).first();
      return typeof row?.email === "string" ? { email: row.email } : null;
    },

    async revokeOtpChallenge({ challengeId, revokedAt }) {
      requiredString(challengeId, "challengeId", 64);
      requiredTime(revokedAt, "revokedAt");
      const result = await db.prepare(
        "UPDATE wallet_otp_challenges SET revoked_at = ? " +
        "WHERE id = ? AND revoked_at IS NULL AND consumed_at IS NULL",
      ).bind(revokedAt, challengeId).run();
      return changed(result) === 1;
    },

    async findParticipantByEmail(email) {
      requiredString(email, "email", 254);
      return db.prepare(
        "SELECT id, status FROM wallet_participants WHERE email_normalized = ? LIMIT 1",
      ).bind(email).first();
    },

    async createSession({ tokenHash, participantId, createdAt, expiresAt }) {
      requiredHash(tokenHash, "tokenHash");
      requiredString(participantId, "participantId", 128);
      requiredTime(createdAt, "createdAt");
      requiredTime(expiresAt, "expiresAt");
      if (expiresAt <= createdAt) throw new TypeError("session expiry must follow creation");
      await db.prepare(
        "INSERT INTO wallet_auth_sessions " +
        "(token_hmac, participant_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
      ).bind(tokenHash, participantId, createdAt, expiresAt).run();
    },

    async findActiveSession({ tokenHash, now }) {
      requiredHash(tokenHash, "tokenHash");
      requiredTime(now, "now");
      const row = await db.prepare(
        "SELECT participant_id AS participantId FROM wallet_auth_sessions " +
        "WHERE token_hmac = ? AND revoked_at IS NULL AND expires_at > ? LIMIT 1",
      ).bind(tokenHash, now).first();
      return row ?? null;
    },

    async getParticipantById(participantId) {
      requiredString(participantId, "participantId", 128);
      const row = await db.prepare(
        "SELECT id, status FROM wallet_participants WHERE id = ? LIMIT 1",
      ).bind(participantId).first();
      return row ? { ...row, roles: [] } : null;
    },

    async revokeSession({ tokenHash, revokedAt }) {
      requiredHash(tokenHash, "tokenHash");
      requiredTime(revokedAt, "revokedAt");
      const result = await db.prepare(
        "UPDATE wallet_auth_sessions SET revoked_at = ? " +
        "WHERE token_hmac = ? AND revoked_at IS NULL",
      ).bind(revokedAt, tokenHash).run();
      return changed(result) === 1;
    },
  });
}
