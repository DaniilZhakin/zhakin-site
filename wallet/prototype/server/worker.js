/**
 * ZHAKIN Wallet Cloudflare Worker route scaffold.
 *
 * Dedicated service boundary. No deployment configuration is included.
 * Requires a test-only D1 binding, HMAC secret, exact allowed origin, and
 * an explicitly configured mailer service binding before any auth route works.
 */
import { createD1WalletAuthRepository } from "./d1-auth-repository.js";
import { createEmailOtpAuth } from "./email-otp-auth.js";

const MAX_BODY_BYTES = 4096;
const MAILER_URL = "https://wallet-mailer.internal/v1/otp";

const json = (status, payload, headers = {}) => new Response(JSON.stringify(payload), {
  status,
  headers: {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    ...headers,
  },
});

function corsHeaders(origin) {
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-credentials": "true",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type",
    "access-control-max-age": "600",
    "vary": "Origin",
  };
}

function isAllowedOrigin(value) {
  if (typeof value !== "string" || value.length > 255) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && parsed.origin === value &&
      !parsed.username && !parsed.password && parsed.hostname !== "null";
  } catch {
    return false;
  }
}

function isSessionCookie(value, { logout = false } = {}) {
  if (typeof value !== "string" || !value.startsWith("zhakin_wallet_session=")) return false;
  const attributes = value.split(";").slice(1).map((part) => part.trim().toLowerCase());
  const required = ["path=/api/v1", "httponly", "secure", "samesite=strict"];
  if (!required.every((item) => attributes.includes(item))) return false;
  const cookieValue = value.slice("zhakin_wallet_session=".length).split(";")[0];
  if (logout) return cookieValue === "" && attributes.includes("max-age=0");
  return /^[A-Za-z0-9_-]{40,64}$/.test(cookieValue) &&
    attributes.includes("max-age=43200");
}

async function readJson(request) {
  const contentType = request.headers.get("content-type") || "";
  if (!/^application\/json(?:\s*;|$)/i.test(contentType)) {
    return { error: "unsupported_media_type" };
  }
  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null) {
    const length = Number(declaredLength);
    if (!Number.isSafeInteger(length) || length < 0) return { error: "invalid_content_length" };
    if (length > MAX_BODY_BYTES) return { error: "payload_too_large" };
  }
  if (!request.body) return { error: "invalid_json" };

  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_BODY_BYTES) {
        await reader.cancel();
        return { error: "payload_too_large" };
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { error: "invalid_json" };
    }
    return { value: parsed };
  } catch {
    return { error: "invalid_json" };
  } finally {
    reader.releaseLock();
  }
}

function createDefaultAuth(env) {
  if (!env?.WALLET_DB || typeof env.WALLET_DB.prepare !== "function" ||
      typeof env.WALLET_AUTH_HMAC_SECRET !== "string" ||
      env.WALLET_AUTH_HMAC_SECRET.length < 32 ||
      !env.WALLET_MAILER || typeof env.WALLET_MAILER.fetch !== "function") {
    return null;
  }
  const repository = createD1WalletAuthRepository(env.WALLET_DB);
  const deliverEmail = async ({ to, code, expiresAt }) => {
    const response = await env.WALLET_MAILER.fetch(MAILER_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ to, code, expires_at: expiresAt }),
    });
    if (!response?.ok) throw new Error("mail_delivery_failed");
  };
  return createEmailOtpAuth({
    repository,
    deliverEmail,
    secret: env.WALLET_AUTH_HMAC_SECRET,
  });
}

export function createWalletWorker({ createAuth = createDefaultAuth } = {}) {
  return {
    async fetch(request, env = {}) {
      const url = new URL(request.url);
      const path = url.pathname;
      if (request.method === "GET" && path === "/health") {
        return json(200, { service: "zhakin-wallet-api", mode: "scaffold", ready: false });
      }

      const allowedOrigin = isAllowedOrigin(env.WALLET_ALLOWED_ORIGIN)
        ? env.WALLET_ALLOWED_ORIGIN : "";
      const origin = request.headers.get("origin") || "";

      if (request.method === "OPTIONS") {
        if (!allowedOrigin || origin !== allowedOrigin) {
          return json(403, { error: "origin_not_allowed" });
        }
        return new Response(null, { status: 204, headers: corsHeaders(allowedOrigin) });
      }

      const isMutation = request.method === "POST";
      if (isMutation && (!allowedOrigin || origin !== allowedOrigin)) {
        return json(403, { error: "origin_not_allowed" });
      }
      if (!isMutation && origin && (!allowedOrigin || origin !== allowedOrigin)) {
        return json(403, { error: "origin_not_allowed" });
      }

      const routeMethods = new Map([
        ["/api/v1/auth/otp/request", "POST"],
        ["/api/v1/auth/otp/verify", "POST"],
        ["/api/v1/auth/session", "GET"],
        ["/api/v1/auth/logout", "POST"],
        ["/api/v1/me", "GET"],
      ]);
      const expectedMethod = routeMethods.get(path);
      if (!expectedMethod) return json(404, { error: "not_found" });
      if (request.method !== expectedMethod) {
        return json(405, { error: "method_not_allowed" }, allowedOrigin ? corsHeaders(allowedOrigin) : {});
      }
      if (!allowedOrigin) return json(503, { error: "service_not_configured" });

      let auth;
      try {
        auth = await createAuth(env);
      } catch {
        auth = null;
      }
      if (!auth || typeof auth.requestCode !== "function" ||
          typeof auth.verifyCode !== "function" || typeof auth.authenticate !== "function" ||
          typeof auth.logout !== "function") {
        return json(503, { error: "service_not_configured" }, corsHeaders(allowedOrigin));
      }

      const headers = corsHeaders(allowedOrigin);
      if (path === "/api/v1/auth/otp/request") {
        const parsed = await readJson(request);
        if (parsed.error) {
          const status = parsed.error === "payload_too_large" ? 413
            : parsed.error === "unsupported_media_type" ? 415 : 400;
          return json(status, { error: parsed.error }, headers);
        }
        if (typeof parsed.value.email !== "string" || parsed.value.email.length > 254) {
          return json(400, { error: "invalid_request" }, headers);
        }
        // Cloudflare overwrites CF-Connecting-IP at the edge. Never accept a
        // client-provided IP/source key from the body, query, or custom header.
        const sourceKey = request.headers.get("cf-connecting-ip");
        try {
          const result = await auth.requestCode(parsed.value.email, { sourceKey });
          return json(202, {
            accepted: result?.accepted === true,
            challenge_id: typeof result?.challenge_id === "string" ? result.challenge_id : null,
            expires_in: Number.isSafeInteger(result?.expires_in) ? result.expires_in : 600,
          }, headers);
        } catch {
          return json(503, { error: "authentication_unavailable" }, headers);
        }
      }

      if (path === "/api/v1/auth/otp/verify") {
        const parsed = await readJson(request);
        if (parsed.error) {
          const status = parsed.error === "payload_too_large" ? 413
            : parsed.error === "unsupported_media_type" ? 415 : 400;
          return json(status, { error: parsed.error }, headers);
        }
        try {
          const result = await auth.verifyCode({
            challengeId: parsed.value.challenge_id,
            code: parsed.value.code,
          });
          if (!result?.authenticated || !isSessionCookie(result.setCookie) ||
              typeof result.participant?.id !== "string" || !result.participant.id) {
            return json(401, { error: "invalid_or_expired_code" }, headers);
          }
          return json(200, { authenticated: true, participant: { id: result.participant.id } }, {
            ...headers,
            "set-cookie": result.setCookie,
          });
        } catch {
          return json(503, { error: "authentication_unavailable" }, headers);
        }
      }

      if (path === "/api/v1/auth/logout") {
        const parsed = await readJson(request);
        if (parsed.error) {
          const status = parsed.error === "payload_too_large" ? 413
            : parsed.error === "unsupported_media_type" ? 415 : 400;
          return json(status, { error: parsed.error }, headers);
        }
        try {
          const result = await auth.logout(request);
          if (!isSessionCookie(result?.setCookie, { logout: true })) {
            return json(503, { error: "authentication_unavailable" }, headers);
          }
          return json(200, { authenticated: false }, {
            ...headers,
            "set-cookie": result.setCookie,
          });
        } catch {
          return json(503, { error: "authentication_unavailable" }, headers);
        }
      }

      try {
        const principal = await auth.authenticate(request);
        if (!principal || typeof principal.id !== "string" || !principal.id) {
          return json(401, { error: "unauthenticated" }, headers);
        }
        return json(200, { authenticated: true, participant: { id: principal.id } }, headers);
      } catch {
        return json(503, { error: "authentication_unavailable" }, headers);
      }
    },
  };
}

export default createWalletWorker();
