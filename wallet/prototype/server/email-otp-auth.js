/**
 * Provider-neutral email OTP authentication service for ZHAKIN Wallet.
 *
 * Isolated scaffold only: no mail provider, D1 binding, Worker route, or
 * production secret is configured here. Storage methods must be implemented
 * with atomic D1 operations before deployment.
 */
const OTP_TTL_MS = 10 * 60 * 1000;
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const MAX_OTP_ATTEMPTS = 5;
const encoder = new TextEncoder();

function requireDependencies({ repository, deliverEmail, secret }) {
  const methods = [
    "createOtpChallenge",
    "consumeOtpChallenge",
    "revokeOtpChallenge",
    "findParticipantByEmail",
    "createSession",
    "findActiveSession",
    "getParticipantById",
    "revokeSession",
  ];
  if (!repository || methods.some((name) => typeof repository[name] !== "function")) {
    throw new TypeError("complete server-side wallet auth repository is required");
  }
  if (typeof deliverEmail !== "function") {
    throw new TypeError("server-side email delivery adapter is required");
  }
  if (typeof secret !== "string" || secret.length < 32) {
    throw new TypeError("wallet auth HMAC secret must contain at least 32 characters");
  }
}

function normalizeEmail(value) {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}

function randomBytes(length) {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}

function toHex(bytes) {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function toBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function randomOtp() {
  // Rejection sampling avoids modulo bias over the six-digit code space.
  const ceiling = 4294000000; // 4294 * 1,000,000
  while (true) {
    const bytes = randomBytes(4);
    const value = new DataView(bytes.buffer).getUint32(0, false);
    if (value < ceiling) return String(value % 1000000).padStart(6, "0");
  }
}

async function hmac(secret, value) {
  const key = await crypto.subtle.importKey(
    "raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  return toHex(new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(value))));
}

function readCookie(request, name) {
  const header = request.headers.get("cookie") || "";
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() === name) {
      return part.slice(separator + 1).trim();
    }
  }
  return null;
}

const sessionCookie = (token) =>
  `zhakin_wallet_session=${token}; Path=/api/v1; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_TTL_MS / 1000}`;
const clearedCookie =
  "zhakin_wallet_session=; Path=/api/v1; HttpOnly; Secure; SameSite=Strict; Max-Age=0";

export function createEmailOtpAuth({ repository, deliverEmail, secret, now = () => Date.now() } = {}) {
  requireDependencies({ repository, deliverEmail, secret });

  return Object.freeze({
    /**
     * Always returns a generic acceptance shape. The repository must persist
     * a challenge and enforce per-email + per-source rate limits atomically.
     * It returns { deliverable: boolean }; false means no registered account.
     */
    async requestCode(rawEmail) {
      const email = normalizeEmail(rawEmail);
      if (!email) return { accepted: true, challenge_id: null, expires_in: OTP_TTL_MS / 1000 };

      const challengeId = toHex(randomBytes(16));
      const code = randomOtp();
      const createdAt = now();
      const expiresAt = createdAt + OTP_TTL_MS;
      const codeHash = await hmac(secret, `otp:${challengeId}:${code}`);

      const result = await repository.createOtpChallenge({
        challengeId, email, codeHash, createdAt, expiresAt,
      });
      if (result?.deliverable === true) {
        try {
          await deliverEmail({ to: email, code, expiresAt });
        } catch {
          await repository.revokeOtpChallenge({ challengeId, revokedAt: now() });
          // Do not reveal delivery/provider state to the public caller.
        }
      }

      return { accepted: true, challenge_id: challengeId, expires_in: OTP_TTL_MS / 1000 };
    },

    /**
     * consumeOtpChallenge MUST atomically compare the HMAC, enforce expiry and
     * attempt count, increment failed attempts, and consume a successful code.
     */
    async verifyCode({ challengeId, code } = {}) {
      if (typeof challengeId !== "string" || !/^[a-f0-9]{32}$/.test(challengeId) ||
          typeof code !== "string" || !/^\d{6}$/.test(code)) {
        return { authenticated: false };
      }

      const codeHash = await hmac(secret, `otp:${challengeId}:${code}`);
      const consumed = await repository.consumeOtpChallenge({
        challengeId, codeHash, now: now(), maxAttempts: MAX_OTP_ATTEMPTS,
      });
      if (!consumed || typeof consumed.email !== "string") return { authenticated: false };

      const participant = await repository.findParticipantByEmail(consumed.email);
      if (!participant || typeof participant.id !== "string" || participant.status !== "active") {
        return { authenticated: false };
      }

      const token = toBase64Url(randomBytes(32));
      const tokenHash = await hmac(secret, `session:${token}`);
      const createdAt = now();
      await repository.createSession({
        tokenHash,
        participantId: participant.id,
        createdAt,
        expiresAt: createdAt + SESSION_TTL_MS,
      });

      return {
        authenticated: true,
        participant: { id: participant.id },
        setCookie: sessionCookie(token),
      };
    },

    /** Returns only a server-verified principal; browser IDs are never read. */
    async authenticate(request) {
      const token = readCookie(request, "zhakin_wallet_session");
      if (!token || !/^[A-Za-z0-9_-]{40,64}$/.test(token)) return null;

      const tokenHash = await hmac(secret, `session:${token}`);
      const session = await repository.findActiveSession({ tokenHash, now: now() });
      if (!session || typeof session.participantId !== "string") return null;

      const participant = await repository.getParticipantById(session.participantId);
      if (!participant || participant.status !== "active" || typeof participant.id !== "string") {
        return null;
      }
      return {
        id: participant.id,
        roles: Array.isArray(participant.roles) ? participant.roles : [],
      };
    },

    async logout(request) {
      const token = readCookie(request, "zhakin_wallet_session");
      if (token && /^[A-Za-z0-9_-]{40,64}$/.test(token)) {
        const tokenHash = await hmac(secret, `session:${token}`);
        await repository.revokeSession({ tokenHash, revokedAt: now() });
      }
      return { setCookie: clearedCookie };
    },
  });
}

export const walletEmailOtpPolicy = Object.freeze({
  otpTtlSeconds: OTP_TTL_MS / 1000,
  sessionTtlSeconds: SESSION_TTL_MS / 1000,
  maxOtpAttempts: MAX_OTP_ATTEMPTS,
  cookieName: "zhakin_wallet_session",
});
