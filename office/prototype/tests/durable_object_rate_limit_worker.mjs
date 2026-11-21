import { OfficeRateLimitDurableObject, createDurableObjectRateLimiter } from "../src/durable-object-rate-limiter.mjs";

export { OfficeRateLimitDurableObject };

export default {
  async fetch(_request, env) {
    const limiter = createDurableObjectRateLimiter({
      namespace: env.OFFICE_RATE_LIMITER,
      limit: 3,
      windowSeconds: 60,
    });
    try {
      const decisions = await Promise.all(Array.from({ length: 12 }, () => limiter({
        route: "human-proposal-review",
        clientAddress: "198.51.100.42",
      })));
      const allowed = decisions.filter(Boolean).length;
      const denied = decisions.length - allowed;
      const ok = allowed === 3 && denied === 9;
      return new Response(JSON.stringify({
        ok,
        atomicAdmission: ok,
        allowed,
        denied,
      }), {
        status: ok ? 200 : 500,
        headers: { "content-type": "application/json", "cache-control": "no-store" },
      });
    } catch {
      return new Response(JSON.stringify({ ok: false, error: "rate_limit_smoke_failed" }), {
        status: 500,
        headers: { "content-type": "application/json", "cache-control": "no-store" },
      });
    }
  },
};
