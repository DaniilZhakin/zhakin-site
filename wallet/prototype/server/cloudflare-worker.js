/**
 * Cloudflare Worker entrypoint for the isolated ZHAKIN Wallet market route.
 * Not deployed. Live access remains disabled unless both server flags are approved.
 */
import { createMarketDataHandler } from "./market-handler.js";
import { MarketState } from "./market-state.js";

const ALLOWED_ORIGINS = new Set([
  "https://xn--80alhhq.xn--p1ai",
  "https://жакин.рф"
]);
const GLOBAL_STATE_ID = "zhakin-wallet-market-global-v1";

function errorResponse(status, error, origin = "") {
  const headers = {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    "vary": "Origin"
  };
  if (origin) headers["access-control-allow-origin"] = origin;
  return new Response(JSON.stringify({ error }), { status, headers });
}

function createStateAdapters(env) {
  const id = env.MARKET_STATE.idFromName(GLOBAL_STATE_ID);
  const stub = env.MARKET_STATE.get(id);
  return {
    cache: {
      async get(key) {
        const response = await stub.fetch("https://market-state.local/cache/get", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ key })
        });
        if (!response.ok) throw new Error("market_cache_unavailable");
        const payload = await response.json();
        return payload.hit ? payload.value : null;
      },
      async put(key, value, ttlSeconds) {
        const response = await stub.fetch("https://market-state.local/cache/put", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ key, value, ttlSeconds })
        });
        if (!response.ok) throw new Error("market_cache_unavailable");
      }
    },
    rateLimiter: {
      async consume() {
        const response = await stub.fetch("https://market-state.local/limit/consume", { method: "POST" });
        if (!response.ok && response.status !== 429) throw new Error("market_limiter_unavailable");
        const payload = await response.json();
        return { allowed: payload.allowed === true };
      }
    }
  };
}

export function createMarketWorker({ fetchQuotes } = {}) {
  return {
    async fetch(request, env) {
      const origin = request.headers.get("Origin") || "";
      if (origin && !ALLOWED_ORIGINS.has(origin)) return errorResponse(403, "origin_not_allowed");
      const url = new URL(request.url);
      if (url.pathname !== "/api/v1/market/quotes") return errorResponse(404, "not_found", origin);
      if (request.method !== "GET") return errorResponse(405, "method_not_allowed", origin);
      if (!env.MARKET_STATE || typeof env.MARKET_STATE.idFromName !== "function" ||
          typeof env.MARKET_STATE.get !== "function") {
        return errorResponse(503, "market_state_unavailable", origin);
      }
      let adapters;
      try {
        adapters = createStateAdapters(env);
      } catch {
        return errorResponse(503, "market_state_unavailable", origin);
      }
      const handleMarketRequest = createMarketDataHandler({ fetchQuotes, ...adapters });
      const response = await handleMarketRequest(request, env);
      const headers = new Headers(response.headers);
      headers.set("vary", "Origin");
      if (origin) headers.set("access-control-allow-origin", origin);
      return new Response(response.body, { status: response.status, headers });
    }
  };
}

export class MarketStateDurableObject extends MarketState {}

export default createMarketWorker();
