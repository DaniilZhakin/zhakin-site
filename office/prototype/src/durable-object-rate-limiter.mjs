/**
 * OFFICE distributed request limiter backed by a Cloudflare Durable Object.
 *
 * The namespace is private to the Worker binding. The caller hashes the
 * trusted Cloudflare client address before deriving an object ID; raw client
 * addresses are never persisted. This module is not wired to a Worker route.
 */
const MAX_ROUTE_LENGTH = 64;
const ALLOWED_ROUTES = new Set(["human-proposal-review"]);
const MAX_LIMIT = 1000;
const MAX_WINDOW_SECONDS = 3600;

function json(status, value) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

function validConfig(limit, windowSeconds) {
  return Number.isInteger(limit) && limit >= 1 && limit <= MAX_LIMIT
    && Number.isInteger(windowSeconds) && windowSeconds >= 1
    && windowSeconds <= MAX_WINDOW_SECONDS;
}

export class OfficeRateLimitDurableObject {
  constructor(state) {
    this.state = state;
  }

  async fetch(request) {
    if (request.method !== "POST") return json(405, { error: "method_not_allowed" });
    const type = (request.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    if (type !== "application/json") return json(415, { error: "unsupported_media_type" });

    let input;
    try {
      const raw = await request.text();
      if (raw.length > 512) return json(413, { error: "request_too_large" });
      input = JSON.parse(raw);
    } catch {
      return json(400, { error: "invalid_request" });
    }
    const { limit, windowSeconds, nowSeconds } = input ?? {};
    if (!validConfig(limit, windowSeconds) || !Number.isSafeInteger(nowSeconds) || nowSeconds < 0) {
      return json(400, { error: "invalid_rate_limit_config" });
    }

    const windowStart = Math.floor(nowSeconds / windowSeconds) * windowSeconds;
    try {
      const outcome = await this.state.storage.transaction(async (txn) => {
        const stored = await txn.get("counter");
        const current = stored?.windowStart === windowStart
          ? stored.count
          : 0;
        if (!Number.isSafeInteger(current) || current < 0) {
          throw new Error("rate_limit_state_corrupt");
        }
        if (current >= limit) {
          return {
            allowed: false,
            remaining: 0,
            retryAfter: Math.max(1, windowStart + windowSeconds - nowSeconds),
          };
        }
        const count = current + 1;
        await txn.put("counter", { windowStart, count });
        return {
          allowed: true,
          remaining: limit - count,
          retryAfter: 0,
        };
      });
      return json(200, outcome);
    } catch {
      // Storage/transaction errors are security-control failures, never allows.
      return json(503, { error: "rate_limit_unavailable" });
    }
  }
}

/**
 * Adapter for createHumanApprovalHttpHandler({ rateLimit }).
 * clientAddress must come from Cloudflare's trusted cf-connecting-ip header.
 */
export function createDurableObjectRateLimiter({
  namespace,
  limit = 10,
  windowSeconds = 60,
  clock = () => Date.now(),
}) {
  if (!namespace || typeof namespace.idFromName !== "function"
    || typeof namespace.get !== "function" || !validConfig(limit, windowSeconds)
    || typeof clock !== "function") {
    throw new TypeError("Durable Object namespace and bounded rate-limit configuration are required");
  }

  return async function rateLimit({ route, clientAddress }) {
    if (!ALLOWED_ROUTES.has(route) || typeof clientAddress !== "string"
      || clientAddress.length < 3 || clientAddress.length > 64
      || /[\s,]/.test(clientAddress)) {
      throw new Error("trusted_client_address_required");
    }

    const material = new TextEncoder().encode(`zhakin-office-rate-v1| ${route}| ${clientAddress}`);
    const digest = await crypto.subtle.digest("SHA-256", material);
    const name = [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, "0")).join("");
    const id = namespace.idFromName(name);
    const stub = namespace.get(id);
    const response = await stub.fetch("https://office-rate-limit.internal/check", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        limit,
        windowSeconds,
        nowSeconds: Math.floor(clock() / 1000),
      }),
    });
    if (!response.ok) throw new Error("rate_limit_unavailable");
    const result = await response.json();
    if (typeof result?.allowed !== "boolean") throw new Error("invalid_rate_limit_response");
    return result.allowed;
  };
}
