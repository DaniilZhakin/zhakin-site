/**
 * Isolated HTTP adapter for the Robot Office service.
 *
 * Integration contract:
 * - resolvePrincipal(request, env) MUST validate a server-side session and
 *   return { authenticated: true, subjectId, organizationId } from trusted data.
 * - Never derive identity, organization, roles or scopes from request JSON,
 *   query parameters, headers supplied by the browser, or unsigned cookies.
 * - Bind a disposable/test D1 database as env.ROBOT_OFFICE_DB for local QA.
 *
 * This module is not wired to the site's Worker entrypoint or production.
 */
import { createOfficeTask, listOfficeTasks } from "./office-service.mjs";

const MAX_BODY_BYTES = 12_000;
const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store, max-age=0",
  "pragma": "no-cache",
  "x-content-type-options": "nosniff",
};

function response(status, payload, requestId) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...JSON_HEADERS, "x-request-id": requestId },
  });
}

function originAllowed(request, allowedOrigins, mutation) {
  const origin = request.headers.get("Origin");
  if (!origin) return !mutation;
  return Array.isArray(allowedOrigins) && allowedOrigins.includes(origin);
}

function statusOf(error) {
  return Number.isInteger(error?.status) ? error.status : 500;
}

/**
 * @param {Request} request
 * @param {{
 *   env: { ROBOT_OFFICE_DB: object },
 *   resolvePrincipal: (request: Request, env: object) => Promise<object|null>,
 *   allowedOrigins: string[],
 *   now?: number
 * }} options
 */
export async function handleRobotOfficeRequest(request, {
  env, resolvePrincipal, allowedOrigins = [], now = Date.now(),
}) {
  const requestId = crypto.randomUUID();
  const url = new URL(request.url);
  const method = request.method.toUpperCase();
  const isMutation = method === "POST";

  if (url.pathname !== "/api/robot-office/tasks" || !["GET", "POST"].includes(method)) {
    return response(404, { error: "NOT_FOUND", requestId }, requestId);
  }
  if (!originAllowed(request, allowedOrigins, isMutation)) {
    return response(403, { error: "ORIGIN_NOT_ALLOWED", requestId }, requestId);
  }
  if (!env?.ROBOT_OFFICE_DB || typeof resolvePrincipal !== "function") {
    return response(503, { error: "SERVICE_NOT_CONFIGURED", requestId }, requestId);
  }

  try {
    const principal = await resolvePrincipal(request, env);
    if (!principal || principal.authenticated !== true) {
      return response(401, { error: "AUTHENTICATION_REQUIRED", requestId }, requestId);
    }

    if (method === "GET") {
      const tasks = await listOfficeTasks({ db: env.ROBOT_OFFICE_DB, principal, now });
      return response(200, { data: tasks, requestId }, requestId);
    }

    if (request.headers.get("Content-Type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
      return response(415, { error: "JSON_REQUIRED", requestId }, requestId);
    }
    const declaredLength = Number(request.headers.get("Content-Length") ?? 0);
    if (declaredLength > MAX_BODY_BYTES) {
      return response(413, { error: "PAYLOAD_TOO_LARGE", requestId }, requestId);
    }
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) {
      return response(413, { error: "PAYLOAD_TOO_LARGE", requestId }, requestId);
    }

    let input;
    try { input = JSON.parse(raw); }
    catch { return response(400, { error: "INVALID_JSON", requestId }, requestId); }

    const task = await createOfficeTask({
      db: env.ROBOT_OFFICE_DB, principal, input, requestId, now,
    });
    return response(201, { data: task, requestId }, requestId);
  } catch (error) {
    const status = statusOf(error);
    const publicCode = status === 401 ? "AUTHENTICATION_REQUIRED"
      : status === 403 ? "FORBIDDEN"
      : status === 400 ? "INVALID_REQUEST" : "INTERNAL_ERROR";
    // Do not expose SQL, provider, session, or stack details to the client.
    return response(status, { error: publicCode, requestId }, requestId);
  }
}
