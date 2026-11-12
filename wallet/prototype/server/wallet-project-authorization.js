/**
 * Fail-closed authorization helpers for Wallet project-scoped actions.
 *
 * The principal must come from server-side session authentication. Callers
 * must resolve the target project/resource on the server and pass its
 * canonical project ID; never authorize against a browser-supplied role or
 * an unverified project ID.
 */

function isNonEmptyId(value) {
  return typeof value === "string" && value.length > 0 &&
    value.length <= 128 && value.trim() === value;
}

function isValidAssignment(assignment, now) {
  if (!assignment || typeof assignment !== "object" || Array.isArray(assignment)) return false;
  if (assignment.role !== "admin" && assignment.role !== "coordinator") return false;
  if (assignment.scopeType !== "global" && assignment.scopeType !== "project") return false;

  if (assignment.scopeType === "global" && assignment.scopeId !== "") return false;
  if (assignment.scopeType === "project" && !isNonEmptyId(assignment.scopeId)) return false;

  if (assignment.role === "admin" && assignment.scopeType !== "global") return false;

  return assignment.expiresAt === null ||
    (Number.isSafeInteger(assignment.expiresAt) && assignment.expiresAt > now);
}

function activeAssignments(principal, now) {
  if (!principal || typeof principal !== "object" || !Array.isArray(principal.roleAssignments)) {
    return [];
  }
  if (!Number.isSafeInteger(now) || now < 0) return [];
  return principal.roleAssignments.filter((grant) => isValidAssignment(grant, now));
}

/** Global admin is the only grant that can satisfy administrative access. */
export function hasWalletGlobalAdminAccess(principal, now = Date.now()) {
  return activeAssignments(principal, now).some((grant) =>
    grant.role === "admin" && grant.scopeType === "global" && grant.scopeId === ""
  );
}

/**
 * Project access is granted to a global admin, a global coordinator, or a
 * coordinator explicitly assigned to this exact project. Project-scoped
 * coordinator grants never authorize another project or an admin action.
 */
export function hasWalletProjectAccess(principal, projectId, now = Date.now()) {
  if (!isNonEmptyId(projectId)) return false;
  return activeAssignments(principal, now).some((grant) => {
    if (grant.role === "admin" && grant.scopeType === "global") return true;
    if (grant.role !== "coordinator") return false;
    if (grant.scopeType === "global") return grant.scopeId === "";
    return grant.scopeType === "project" && grant.scopeId === projectId;
  });
}
