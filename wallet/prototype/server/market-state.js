/**
 * One globally named Durable Object stores the shared quote cache and enforces
 * a global provider-refresh budget. Storage operations are server-side only.
 */
const CACHE_PREFIX = "quote-cache:";
const CACHE_KEY_ALLOWLIST = new Set(["zhakin-wallet-market-v1"]);
const CACHE_TTL_MAX_SECONDS = 30;
const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 8;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
  });
}

export class MarketState {
  constructor(ctx) {
    this.ctx = ctx;
  }

  async fetch(request) {
    if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
    const path = new URL(request.url).pathname;

    if (path === "/limit/consume") {
      const now = Date.now();
      const allowed = await this.ctx.storage.transaction(async (txn) => {
        const current = await txn.get("provider-rate-window") || { startedAt: now, count: 0 };
        const active = now - current.startedAt < RATE_WINDOW_MS
          ? current
          : { startedAt: now, count: 0 };
        if (active.count >= RATE_LIMIT_MAX) return false;
        await txn.put("provider-rate-window", {
          startedAt: active.startedAt,
          count: active.count + 1
        });
        return true;
      });
      return json({ allowed, limit: RATE_LIMIT_MAX, window_seconds: 60 }, allowed ? 200 : 429);
    }

    if (path === "/cache/get") {
      let payload;
      try { payload = await request.json(); } catch { return json({ error: "invalid_json" }, 400); }
      if (!CACHE_KEY_ALLOWLIST.has(payload?.key)) return json({ error: "invalid_cache_key" }, 400);
      const entry = await this.ctx.storage.get(CACHE_PREFIX + payload.key);
      if (!entry || entry.expiresAt <= Date.now()) {
        if (entry) await this.ctx.storage.delete(CACHE_PREFIX + payload.key);
        return json({ hit: false });
      }
      return json({ hit: true, value: entry.value });
    }

    if (path === "/cache/put") {
      let payload;
      try { payload = await request.json(); } catch { return json({ error: "invalid_json" }, 400); }
      const ttl = Number(payload?.ttlSeconds);
      if (!CACHE_KEY_ALLOWLIST.has(payload?.key) ||
          !Number.isInteger(ttl) || ttl < 1 || ttl > CACHE_TTL_MAX_SECONDS ||
          !payload.value || typeof payload.value !== "object" || Array.isArray(payload.value)) {
        return json({ error: "invalid_cache_entry" }, 400);
      }
      await this.ctx.storage.put(CACHE_PREFIX + payload.key, {
        value: payload.value,
        expiresAt: Date.now() + ttl * 1000
      });
      return json({ stored: true });
    }

    return json({ error: "not_found" }, 404);
  }
}
