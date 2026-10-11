/**
 * ZHAKIN Wallet server API scaffold.
 * Not deployed. No provider or database is configured by this module.
 * All trust decisions and persistence must be supplied by server-side adapters.
 */

const json = (status, payload) => new Response(JSON.stringify(payload), {
  status,
  headers: {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  },
});

const unavailable = () => json(503, {
  error: "service_not_configured",
  message: "Wallet service is not configured.",
});

function hasRole(principal, roles) {
  return Array.isArray(principal?.roles) && roles.some((role) => principal.roles.includes(role));
}

/**
 * Dependencies:
 * - authenticate(request, env): returns a server-verified principal or null.
 * - repository.getBalance(participantId)
 * - repository.listLedger(participantId, { limit, cursor })
 *
 * No request body, header, query parameter, or browser-supplied ID is accepted
 * as proof of identity. Authentication must validate a real session/token in
 * a trusted provider adapter before this handler can be used.
 */
export function createWalletHandler({ authenticate, repository } = {}) {
  return async function handleWalletRequest(request, env = {}) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === "GET" && path === "/health") {
      return json(200, { service: "zhakin-wallet-api", mode: "scaffold", ready: false });
    }

    if (!["GET", "POST"].includes(request.method)) {
      return json(405, { error: "method_not_allowed" });
    }

    // Fail closed when no trusted authentication adapter is wired.
    if (typeof authenticate !== "function") return unavailable();

    let principal;
    try {
      principal = await authenticate(request, env);
    } catch {
      return json(401, { error: "unauthenticated" });
    }
    if (!principal || typeof principal.id !== "string" || principal.id.length === 0) {
      return json(401, { error: "unauthenticated" });
    }

    if (request.method === "GET" && path === "/api/v1/me") {
      return json(200, {
        id: principal.id,
        roles: Array.isArray(principal.roles) ? principal.roles : [],
      });
    }

    if (request.method === "GET" && (
      path === "/api/v1/me/balance" || path === "/api/v1/me/ledger"
    )) {
      // No public or in-memory fallback is permitted for account data.
      if (!repository) return unavailable();

      try {
        if (path === "/api/v1/me/balance") {
          if (typeof repository.getBalance !== "function") return unavailable();
          const balance = await repository.getBalance(principal.id);
          if (!Number.isSafeInteger(balance)) {
            return json(503, { error: "ledger_unavailable" });
          }
          return json(200, { participant_id: principal.id, points: balance });
        }

        if (typeof repository.listLedger !== "function") return unavailable();
        const entries = await repository.listLedger(principal.id, {
          limit: 50,
          cursor: url.searchParams.get("cursor"),
        });
        if (!Array.isArray(entries)) return json(503, { error: "ledger_unavailable" });
        return json(200, { entries });
      } catch {
        return json(503, { error: "ledger_unavailable" });
      }
    }

    if (path.startsWith("/api/v1/admin/") && !hasRole(principal, ["admin", "coordinator"])) {
      return json(403, { error: "forbidden" });
    }

    // Mutations intentionally remain disabled until transactional repository,
    // persistent idempotency, review workflow and audit adapter are implemented.
    return json(501, { error: "not_implemented" });
  };
}
