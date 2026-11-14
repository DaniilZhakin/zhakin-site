import test from "node:test";
import assert from "node:assert/strict";
import { createWalletWorker } from "./worker.js";

const ORIGIN = "https://zhakin.test";
const env = { WALLET_ALLOWED_ORIGIN: ORIGIN };
const jsonRequest = (path, value, extraHeaders = {}) => new Request(`https://wallet.test${path}`, {
  method: "POST",
  headers: { origin: ORIGIN, "content-type": "application/json", ...extraHeaders },
  body: JSON.stringify(value),
});

function fakeAuth() {
  const calls = [];
  return {
    calls,
    async requestCode(email, options) {
      calls.push({ action: "request", email, options });
      return { accepted: true, challenge_id: "a".repeat(32), expires_in: 600 };
    },
    async verifyCode(input) {
      calls.push({ action: "verify", input });
      return { authenticated: true, participant: { id: "participant-1", email: "private@example.org", roles: ["admin"] },
        setCookie: "zhakin_wallet_session=abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGH; Path=/api/v1; HttpOnly; Secure; SameSite=Strict; Max-Age=43200" };
    },
    async authenticate(request) {
      calls.push({ action: "authenticate", cookie: request.headers.get("cookie") });
      return request.headers.get("cookie") ? { id: "participant-1" } : null;
    },
    async logout(request) {
      calls.push({ action: "logout", cookie: request.headers.get("cookie") });
      return { setCookie: "zhakin_wallet_session=; Path=/api/v1; HttpOnly; Secure; SameSite=Strict; Max-Age=0" };
    },
  };
}

test("health is explicit and never claims the service is ready", async () => {
  const worker = createWalletWorker();
  const response = await worker.fetch(new Request("https://wallet.test/health"));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    service: "zhakin-wallet-api", mode: "scaffold", ready: false,
  });
});

test("auth routes fail closed when D1, HMAC secret, mailer, or origin is not configured", async () => {
  const worker = createWalletWorker();
  const response = await worker.fetch(jsonRequest("/api/v1/auth/otp/request", { email: "member@example.org" }), {});
  assert.equal(response.status, 403);
  const configuredOrigin = await worker.fetch(jsonRequest("/api/v1/auth/otp/request", { email: "member@example.org" }), env);
  assert.equal(configuredOrigin.status, 503);
  assert.deepEqual(await configuredOrigin.json(), { error: "service_not_configured" });
});

test("OTP request passes only Cloudflare source metadata, never body-supplied source values", async () => {
  const auth = fakeAuth();
  const worker = createWalletWorker({ createAuth: async () => auth });
  const response = await worker.fetch(jsonRequest("/api/v1/auth/otp/request", {
    email: "member@example.org", sourceKey: "attacker-controlled", ip: "203.0.113.9",
  }, { "cf-connecting-ip": "198.51.100.8" }), env);
  assert.equal(response.status, 202);
  assert.deepEqual(await response.json(), {
    accepted: true, challenge_id: "a".repeat(32), expires_in: 600,
  });
  assert.deepEqual(auth.calls[0], {
    action: "request", email: "member@example.org",
    options: { sourceKey: "198.51.100.8" },
  });
});

test("OTP request rejects missing source metadata without trusting client fields", async () => {
  const auth = fakeAuth();
  const worker = createWalletWorker({ createAuth: async () => auth });
  const response = await worker.fetch(jsonRequest("/api/v1/auth/otp/request", {
    email: "member@example.org", sourceKey: "198.51.100.8",
  }), env);
  assert.equal(response.status, 202);
  assert.equal(auth.calls[0].options.sourceKey, null);
});

test("OTP verify sets only the HttpOnly secure session cookie and returns minimal identity", async () => {
  const auth = fakeAuth();
  const worker = createWalletWorker({ createAuth: async () => auth });
  const response = await worker.fetch(jsonRequest("/api/v1/auth/otp/verify", {
    challenge_id: "a".repeat(32), code: "123456",
  }), env);
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.deepEqual(payload, {
    authenticated: true, participant: { id: "participant-1" },
  });
  assert.match(response.headers.get("set-cookie"), /HttpOnly/);
  assert.match(response.headers.get("set-cookie"), /Secure/);
  assert.deepEqual(payload, { authenticated: true, participant: { id: "participant-1" } });
  assert.equal(JSON.stringify(payload).includes("private@example.org"), false);
});

test("invalid OTP never creates a session cookie", async () => {
  const auth = fakeAuth();
  auth.verifyCode = async () => ({ authenticated: false });
  const worker = createWalletWorker({ createAuth: async () => auth });
  const response = await worker.fetch(jsonRequest("/api/v1/auth/otp/verify", {
    challenge_id: "a".repeat(32), code: "000000",
  }), env);
  assert.equal(response.status, 401);
  assert.equal(response.headers.get("set-cookie"), null);
});

test("session route trusts only the auth adapter and returns minimal participant identity", async () => {
  const auth = fakeAuth();
  const worker = createWalletWorker({ createAuth: async () => auth });
  const response = await worker.fetch(new Request("https://wallet.test/api/v1/auth/session", {
    headers: { origin: ORIGIN, cookie: "zhakin_wallet_session=opaque" },
  }), env);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    authenticated: true, participant: { id: "participant-1" },
  });
});

test("session route rejects unauthenticated requests", async () => {
  const auth = fakeAuth();
  const worker = createWalletWorker({ createAuth: async () => auth });
  const response = await worker.fetch(new Request("https://wallet.test/api/v1/auth/session", {
    headers: { origin: ORIGIN },
  }), env);
  assert.equal(response.status, 401);
});

test("logout revokes through the auth adapter and expires the cookie", async () => {
  const auth = fakeAuth();
  const worker = createWalletWorker({ createAuth: async () => auth });
  const response = await worker.fetch(jsonRequest("/api/v1/auth/logout", {}, {
    cookie: "zhakin_wallet_session=opaque",
  }), env);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("set-cookie"), /Max-Age=0/);
  assert.equal(auth.calls[0].action, "logout");
});

test("untrusted origins and missing Origin on mutations are rejected", async () => {
  const worker = createWalletWorker({ createAuth: async () => fakeAuth() });
  const hostile = await worker.fetch(new Request("https://wallet.test/api/v1/auth/logout", {
    method: "POST", headers: { origin: "https://evil.test" },
  }), env);
  assert.equal(hostile.status, 403);
  const missing = await worker.fetch(new Request("https://wallet.test/api/v1/auth/logout", {
    method: "POST",
  }), env);
  assert.equal(missing.status, 403);
});

test("OPTIONS preflight is exact-origin and credentialed, never wildcard", async () => {
  const worker = createWalletWorker();
  const allowed = await worker.fetch(new Request("https://wallet.test/api/v1/auth/session", {
    method: "OPTIONS", headers: { origin: ORIGIN },
  }), env);
  assert.equal(allowed.status, 204);
  assert.equal(allowed.headers.get("access-control-allow-origin"), ORIGIN);
  assert.equal(allowed.headers.get("access-control-allow-credentials"), "true");
  assert.notEqual(allowed.headers.get("access-control-allow-origin"), "*");
  const denied = await worker.fetch(new Request("https://wallet.test/api/v1/auth/session", {
    method: "OPTIONS", headers: { origin: "https://evil.test" },
  }), env);
  assert.equal(denied.status, 403);
});

test("route methods are enforced and unknown paths never invoke authentication", async () => {
  const auth = fakeAuth();
  const worker = createWalletWorker({ createAuth: async () => auth });
  const wrongMethod = await worker.fetch(new Request("https://wallet.test/api/v1/auth/session", {
    method: "POST", headers: { origin: ORIGIN },
  }), env);
  assert.equal(wrongMethod.status, 405);
  const unknown = await worker.fetch(new Request("https://wallet.test/api/v1/admin/roles", {
    headers: { origin: ORIGIN },
  }), env);
  assert.equal(unknown.status, 404);
  assert.equal(auth.calls.length, 0);
});

test("JSON content type and streaming body limit are enforced", async () => {
  const worker = createWalletWorker({ createAuth: async () => fakeAuth() });
  const wrongType = await worker.fetch(new Request("https://wallet.test/api/v1/auth/otp/request", {
    method: "POST", headers: { origin: ORIGIN, "content-type": "text/plain" }, body: "{}",
  }), env);
  assert.equal(wrongType.status, 415);
  const tooLarge = await worker.fetch(new Request("https://wallet.test/api/v1/auth/otp/request", {
    method: "POST", headers: { origin: ORIGIN, "content-type": "application/json" },
    body: JSON.stringify({ email: "a".repeat(5000) }),
  }), env);
  assert.equal(tooLarge.status, 413);
});

test("auth adapter exceptions are sanitized and never leak internal details", async () => {
  const worker = createWalletWorker({ createAuth: async () => {
    throw new Error("private database credential");
  } });
  const response = await worker.fetch(jsonRequest("/api/v1/auth/otp/request", {
    email: "member@example.org",
  }, { "cf-connecting-ip": "198.51.100.8" }), env);
  assert.equal(response.status, 503);
  assert.equal(JSON.stringify(await response.json()).includes("credential"), false);
});

test("invalid configured origins, including wildcard and non-origin URLs, fail closed", async () => {
  const worker = createWalletWorker({ createAuth: async () => fakeAuth() });
  for (const invalidOrigin of ["*", "null", "https://zhakin.test/path", "http://zhakin.test"]) {
    const response = await worker.fetch(jsonRequest("/api/v1/auth/otp/request", {
      email: "member@example.org",
    }), { WALLET_ALLOWED_ORIGIN: invalidOrigin });
    assert.equal(response.status, 403, invalidOrigin);
  }
});

test("verification rejects cookies missing required security attributes", async () => {
  const auth = fakeAuth();
  auth.verifyCode = async () => ({
    authenticated: true,
    participant: { id: "participant-1" },
    setCookie: "zhakin_wallet_session=weak; Path=/; SameSite=None",
  });
  const worker = createWalletWorker({ createAuth: async () => auth });
  const response = await worker.fetch(jsonRequest("/api/v1/auth/otp/verify", {
    challenge_id: "a".repeat(32), code: "123456",
  }), env);
  assert.equal(response.status, 401);
  assert.equal(response.headers.get("set-cookie"), null);
});
