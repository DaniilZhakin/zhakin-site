/**
 * ZHAKIN TEAM OFFICE — browser-facing boundary for human proposal review.
 *
 * This is an isolated handler factory, not a deployed Worker. The host must
 * inject a trusted verifier, an exact origin allowlist, and a distributed
 * rate limiter. No in-memory limiter is provided as a security control.
 */
const MAX_BODY_BYTES = 4096;
const ROUTE = /^\/office\/proposals\/([A-Za-z0-9_-]{1,128})\/review$/;

function json(status, code, origin = null) {
  const headers = new Headers({
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    "pragma": "no-cache",
  });
  if (origin) {
    headers.set("access-control-allow-origin", origin);
    headers.set("vary", "Origin");
    headers.set("access-control-allow-methods", "POST, OPTIONS");
    headers.set("access-control-allow-headers", "Authorization, Content-Type");
    headers.set("access-control-max-age", "300");
  }
  return new Response(JSON.stringify({ error: code }), { status, headers });
}

function validOrigin(value, allowlist) {
  if (!value || value === "null") return false;
  try {
    const parsed = new URL(value);
    return parsed.origin === value && allowlist.has(value);
  } catch {
    return false;
  }
}

async function readJsonBounded(request, maxBytes) {
  const declared = request.headers.get("content-length");
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > maxBytes)) {
    throw Object.assign(new Error("invalid_body_size"), { status: 413 });
  }
  if (!request.body) throw Object.assign(new Error("invalid_body"), { status: 400 });
  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw Object.assign(new Error("invalid_body_size"), { status: 413 });
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw Object.assign(new Error("invalid_body"), { status: 400 });
  }
}

function safeFailure(error) {
  const status = Number.isInteger(error?.status) ? error.status : 500;
  if (status === 400) return json(400, "invalid_request");
  if (status === 413) return json(413, "request_too_large");
  if (status === 401) return json(401, "authentication_failed");
  if (status === 403) return json(403, "not_authorized");
  if (status === 409) return json(409, "proposal_conflict");
  return json(500, "internal_error");
}

export function createHumanApprovalHttpHandler({
  gateway,
  allowedOrigins,
  rateLimit,
  maxBodyBytes = MAX_BODY_BYTES,
}) {
  if (!gateway || typeof gateway.reviewProposal !== "function"
    || !Array.isArray(allowedOrigins) || !allowedOrigins.length
    || allowedOrigins.some((origin) => {
      try { return new URL(origin).origin !== origin || new URL(origin).protocol !== "https:"; }
      catch { return true; }
    })
    || typeof rateLimit !== "function"
    || !Number.isInteger(maxBodyBytes) || maxBodyBytes < 1 || maxBodyBytes > MAX_BODY_BYTES) {
    throw new TypeError("Gateway, HTTPS origin allowlist, distributed rate limiter and bounded body limit are required");
  }
  const origins = new Set(allowedOrigins);

  return async function handleHumanApprovalRequest(request) {
    const origin = request.headers.get("origin");
    if (!validOrigin(origin, origins)) return json(403, "origin_not_allowed");

    if (request.method === "OPTIONS") {
      const requestedMethod = request.headers.get("access-control-request-method");
      const requestedHeaders = (request.headers.get("access-control-request-headers") || "")
        .split(",").map((value) => value.trim().toLowerCase()).filter(Boolean);
      if (requestedMethod !== "POST"
        || requestedHeaders.some((header) => !["authorization", "content-type"].includes(header))) {
        return json(403, "preflight_not_allowed");
      }
      return new Response(null, {
        status: 204,
        headers: {
          "access-control-allow-origin": origin,
          "vary": "Origin",
          "access-control-allow-methods": "POST, OPTIONS",
          "access-control-allow-headers": "Authorization, Content-Type",
          "access-control-max-age": "300",
          "cache-control": "no-store",
        },
      });
    }

    if (request.method !== "POST") return json(405, "method_not_allowed", origin);
    const fetchSite = request.headers.get("sec-fetch-site");
    if (fetchSite === "cross-site") return json(403, "cross_site_request_denied", origin);

    let url;
    try { url = new URL(request.url); } catch { return json(400, "invalid_request", origin); }
    const match = ROUTE.exec(url.pathname);
    if (!match || url.search || url.hash) return json(404, "not_found", origin);

    const contentType = (request.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    if (contentType !== "application/json") return json(415, "unsupported_media_type", origin);

    const authorization = request.headers.get("authorization") || "";
    const bearer = /^Bearer ([A-Za-z0-9._~-]{1,16384})$/.exec(authorization);
    if (!bearer) return json(401, "authentication_required", origin);

    let rateResult;
    try {
      rateResult = await rateLimit({
        request,
        route: "human-proposal-review",
        clientAddress: request.headers.get("cf-connecting-ip"),
      });
    } catch {
      return json(503, "security_control_unavailable", origin);
    }
    if (rateResult !== true) return json(429, "rate_limit_exceeded", origin);

    let body;
    try { body = await readJsonBounded(request, maxBodyBytes); }
    catch (error) {
      const response = safeFailure(error);
      response.headers.set("access-control-allow-origin", origin);
      response.headers.set("vary", "Origin");
      return response;
    }
    if (!body || typeof body !== "object" || Array.isArray(body)
      || Object.keys(body).some((key) => !["action", "comment"].includes(key))
      || !["accept", "reject"].includes(body.action)
      || (body.comment !== undefined && (typeof body.comment !== "string" || body.comment.length > 2000))) {
      return json(400, "invalid_request_body", origin);
    }

    try {
      const result = await gateway.reviewProposal({
        bearerToken: bearer[1],
        proposalId: match[1],
        action: body.action,
        comment: body.comment ?? null,
      });
      return new Response(JSON.stringify({
        proposalId: result.proposalId,
        status: result.status,
        taskChanged: result.taskChanged,
      }), {
        status: 200,
        headers: {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-store",
          "x-content-type-options": "nosniff",
          "referrer-policy": "no-referrer",
          "access-control-allow-origin": origin,
          "vary": "Origin",
        },
      });
    } catch (error) {
      const response = safeFailure(error);
      response.headers.set("access-control-allow-origin", origin);
      response.headers.set("vary", "Origin");
      return response;
    }
  };
}
