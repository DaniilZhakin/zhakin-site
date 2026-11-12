/**
 * ZHAKIN Wallet server API scaffold.
 * Not deployed. No provider or database is configured by this module.
 * All trust decisions and persistence must be supplied by server-side adapters.
 */
import {
  hasWalletGlobalAdminAccess,
  hasWalletProjectAccess,
} from "./wallet-project-authorization.js";

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

/**
 * Dependencies:
 * - authenticate(request, env): returns a server-verified principal or null.
 * - repository.getBalance(participantId)
 * - repository.listLedger(participantId, { limit, cursor })
 * - projectRepository.getProjectById(routeLookupId): resolves a project
 *   record on the server; the returned record's id is the canonical scope ID.
 *
 * No request body, header, query parameter, or browser-supplied ID is accepted
 * as proof of identity or permission. Project IDs in URLs are lookup keys only;
 * authorization uses the canonical ID returned by the trusted repository.
 */
export function createWalletHandler({
  authenticate,
  repository,
  projectRepository,
} = {}) {
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
        const result = await repository.listLedger(principal.id, {
          limit: 50,
          cursor: url.searchParams.get("cursor"),
        });
        const entries = Array.isArray(result) ? result : result?.entries;
        if (!Array.isArray(entries)) return json(503, { error: "ledger_unavailable" });
        const nextCursor = Array.isArray(result) ? null : (result.next_cursor ?? null);
        if (nextCursor !== null && typeof nextCursor !== "string") {
          return json(503, { error: "ledger_unavailable" });
        }
        return json(200, { entries, next_cursor: nextCursor });
      } catch {
        return json(503, { error: "ledger_unavailable" });
      }
    }

    // Global admin only. Coordinator grants, including global coordinators,
    // cannot enter the administrative namespace.
    if (path.startsWith("/api/v1/admin/") &&
        !hasWalletGlobalAdminAccess(principal)) {
      return json(403, { error: "forbidden" });
    }

    // Project routes are gated by a server-resolved canonical project ID.
    // The guard does not enable any project operation; those remain 501 below.
    const projectRoute = path.match(/^\/api\/v1\/projects\/([^/]+)(?:\/.*)?$/);
    if (projectRoute) {
      if (!projectRepository || typeof projectRepository.getProjectById !== "function") {
        return unavailable();
      }

      let project;
      try {
        project = await projectRepository.getProjectById(decodeURIComponent(projectRoute[1]));
      } catch {
        return json(503, { error: "project_lookup_unavailable" });
      }
      if (!project || typeof project.id !== "string" || project.id.length === 0) {
        return json(404, { error: "not_found" });
      }
      if (!hasWalletProjectAccess(principal, project.id)) {
        // Conceal resource existence from principals without project scope.
        return json(404, { error: "not_found" });
      }
    }

    // Mutations intentionally remain disabled until transactional repository,
    // persistent idempotency, review workflow and audit adapter are implemented.
    return json(501, { error: "not_implemented" });
  };
}
