/**
 * Pure Robot Office authorization policy.
 *
 * This module is a reference policy only. It does not authenticate users,
 * load grants, enforce HTTP/CSRF controls, or connect to D1. Callers must pass
 * a principal created by a trusted server-side authentication adapter and
 * grants loaded from the server-side role registry. Never pass browser claims.
 */

const ROLE_WORKSPACE = Object.freeze({
  treasury_agent: "treasury",
  human_treasury: "treasury",
  legal_agent: "legal",
  human_legal: "legal",
  command_agent: "command",
});

const ALLOWED_ACTIONS = Object.freeze({
  treasury_agent: new Set(["tasks:list", "tasks:read", "tasks:create", "tasks:update", "tasks:handoff", "documents:metadata:read", "documents:metadata:create", "approvals:request"]),
  legal_agent: new Set(["tasks:list", "tasks:read", "tasks:create", "tasks:update", "tasks:handoff", "documents:metadata:read", "documents:metadata:create", "approvals:request"]),
  human_treasury: new Set(["tasks:list", "tasks:read", "tasks:create", "tasks:update", "tasks:handoff", "documents:metadata:read", "documents:metadata:create", "documents:content:read", "approvals:request", "approvals:decide"]),
  human_legal: new Set(["tasks:list", "tasks:read", "tasks:create", "tasks:update", "tasks:handoff", "documents:metadata:read", "documents:metadata:create", "documents:content:read", "approvals:request", "approvals:decide"]),
  command_agent: new Set(["tasks:read_summary"]),
  access_admin: new Set(["access:grant", "access:revoke"]),
  auditor: new Set(["audit:read"]),
});

const deny = (reason) => Object.freeze({ allowed: false, reason });

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function grantIsActive(grant, now) {
  return grant &&
    isNonEmptyString(grant.subjectId) &&
    isNonEmptyString(grant.organizationId) &&
    isNonEmptyString(grant.role) &&
    grant.revokedAt == null &&
    (grant.expiresAt == null || Number.isFinite(grant.expiresAt) && grant.expiresAt > now) &&
    Number.isFinite(grant.grantedAt) &&
    grant.grantedAt <= now;
}

function grantCoversResource(grant, resource, role) {
  if (!resource || grant.organizationId !== resource.organizationId) return false;

  if (role === "command_agent") {
    return resource.kind === "handoff_summary" &&
      resource.isHandoffSummary === true &&
      (resource.workspace === "treasury" || resource.workspace === "legal") &&
      (grant.scope === "workspace" || grant.scope === "workspace:command" || grant.scope === "organization:handoff-summaries");
  }

  if (role === "auditor") {
    return resource.kind === "audit" &&
      (grant.scope === "organization:audit" || grant.scope === "organization");
  }

  const expectedWorkspace = ROLE_WORKSPACE[role];
  if (!expectedWorkspace || resource.workspace !== expectedWorkspace) return false;

  const scopeMatches = grant.scope === "workspace" ||
    grant.scope === `workspace:${expectedWorkspace}` ||
    grant.scope === `workspace:${expectedWorkspace}:restricted`;

  if (!scopeMatches) return false;
  if (resource.classification === "restricted" && grant.scope !== `workspace:${expectedWorkspace}:restricted`) return false;
  return true;
}

/**
 * @param {object} input
 * @param {{authenticated:boolean, subjectId:string, organizationId:string}} input.principal
 * @param {object[]} input.grants Server-loaded role grants for principal
 * @param {string} input.action
 * @param {object} input.resource
 * @param {number} [input.now] Unix milliseconds; injected for deterministic tests
 */
export function authorizeOfficeAccess({ principal, grants, action, resource, now = Date.now() }) {
  if (!principal || principal.authenticated !== true ||
      !isNonEmptyString(principal.subjectId) ||
      !isNonEmptyString(principal.organizationId)) {
    return deny("AUTHENTICATION_REQUIRED");
  }
  if (!Array.isArray(grants) || !isNonEmptyString(action) || !resource) {
    return deny("INVALID_AUTHORIZATION_CONTEXT");
  }
  if (resource.organizationId !== principal.organizationId) {
    return deny("ORGANIZATION_SCOPE_MISMATCH");
  }

  const candidates = grants.filter((grant) =>
    grantIsActive(grant, now) &&
    grant.subjectId === principal.subjectId &&
    grant.organizationId === principal.organizationId
  );

  for (const grant of candidates) {
    const role = grant.role;
    const actions = ALLOWED_ACTIONS[role];
    if (!actions || !actions.has(action)) continue;
    if (!grantCoversResource(grant, resource, role)) continue;

    if (action === "approvals:decide") {
      if (role !== "human_treasury" && role !== "human_legal") continue;
      if (!isNonEmptyString(resource.requestedBy) || resource.requestedBy === principal.subjectId) continue;
      if (resource.status !== "pending") continue;
    }

    if (action === "approvals:request" && (role === "treasury_agent" || role === "legal_agent")) {
      // Agents may request a human decision, but never decide one.
      if (resource.requestedBy && resource.requestedBy !== principal.subjectId) continue;
    }

    if (action === "tasks:read_summary" &&
        !(role === "command_agent" && resource.kind === "handoff_summary" && resource.isHandoffSummary === true)) continue;

    return Object.freeze({ allowed: true, role, reason: "GRANTED" });
  }

  return deny("FORBIDDEN");
}

export const OFFICE_AUTHORIZATION_ROLES = Object.freeze(Object.keys(ALLOWED_ACTIONS));
