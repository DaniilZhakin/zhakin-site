/**
 * ZHAKIN TEAM OFFICE — strict OIDC-style RS256 bearer verifier.
 *
 * This module is intentionally provider-agnostic. The caller must supply
 * deployment-owned issuer, audience and JWKS URL configuration plus an
 * authoritative revocation lookup. It never trusts decoded claims.
 */
const MAX_TOKEN_LENGTH = 16 * 1024;
const MAX_JWKS_BYTES = 128 * 1024;
const MAX_JWKS_KEYS = 32;
const JWKS_CACHE_TTL_MS = 5 * 60 * 1000;
const CLOCK_SKEW_SECONDS = 60;

function authError(code = "invalid_credential") {
  const error = new Error("Credential verification failed");
  error.code = code;
  error.status = 401;
  return error;
}

function decodeBase64Url(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw authError();
  }
  const padded = value.replace(/-/g, "+").replace(/_/g, "/")
    + "=".repeat((4 - (value.length % 4)) % 4);
  let binary;
  try { binary = atob(padded); } catch { throw authError(); }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function decodeJsonPart(value) {
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(decodeBase64Url(value)));
  } catch {
    throw authError();
  }
}

function constantTimeEqual(left, right) {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return diff === 0;
}

function validHttpsUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.hash;
  } catch {
    return false;
  }
}

export function createOidcBearerVerifier({
  issuer,
  audience,
  jwksUrl,
  isRevoked,
  fetchImpl = fetch,
  clock = () => Date.now(),
  cacheTtlMs = JWKS_CACHE_TTL_MS,
}) {
  if (typeof issuer !== "string" || !issuer || typeof audience !== "string" || !audience
    || !validHttpsUrl(jwksUrl) || typeof isRevoked !== "function"
    || typeof fetchImpl !== "function" || !Number.isFinite(cacheTtlMs) || cacheTtlMs < 0) {
    throw new TypeError("Explicit issuer, audience, HTTPS JWKS URL and revocation checker are required");
  }

  let cachedKeys = null;
  let cachedAt = 0;
  let inflight = null;

  async function loadKeys(force = false) {
    const now = clock();
    if (!force && cachedKeys && now - cachedAt < cacheTtlMs) return cachedKeys;
    if (inflight) return inflight;
    inflight = (async () => {
      let response;
      try {
        response = await fetchImpl(jwksUrl, {
          method: "GET",
          redirect: "error",
          headers: { accept: "application/json" },
        });
      } catch {
        throw authError("identity_keys_unavailable");
      }
      if (!response?.ok) throw authError("identity_keys_unavailable");
      const body = await response.text();
      if (body.length > MAX_JWKS_BYTES) throw authError("identity_keys_invalid");
      let parsed;
      try { parsed = JSON.parse(body); } catch { throw authError("identity_keys_invalid"); }
      if (!parsed || !Array.isArray(parsed.keys) || parsed.keys.length < 1
        || parsed.keys.length > MAX_JWKS_KEYS) throw authError("identity_keys_invalid");
      const usable = parsed.keys.filter((key) => key && key.kty === "RSA"
        && key.use === "sig" && key.alg === "RS256"
        && typeof key.kid === "string" && key.kid.length > 0
        && typeof key.n === "string" && typeof key.e === "string");
      if (!usable.length) throw authError("identity_keys_invalid");
      cachedKeys = usable;
      cachedAt = clock();
      return usable;
    })();
    try { return await inflight; } finally { inflight = null; }
  }

  return async function verifyBearerCredential(token) {
    if (typeof token !== "string" || token.length > MAX_TOKEN_LENGTH) throw authError();
    const parts = token.split(".");
    if (parts.length !== 3 || parts.some((part) => !part)) throw authError();
    const [encodedHeader, encodedPayload, encodedSignature] = parts;
    const header = decodeJsonPart(encodedHeader);
    const claims = decodeJsonPart(encodedPayload);

    if (!header || header.alg !== "RS256" || typeof header.kid !== "string"
      || !header.kid || header.crit !== undefined || header.jku !== undefined
      || header.x5u !== undefined || header.zip !== undefined) throw authError();

    if (!claims || typeof claims !== "object" || Array.isArray(claims)
      || !constantTimeEqual(String(claims.iss || ""), issuer)
      || !(claims.aud === audience || (Array.isArray(claims.aud) && claims.aud.includes(audience)))
      || typeof claims.sub !== "string" || !claims.sub
      || !Number.isFinite(claims.exp) || !Number.isFinite(claims.iat)) throw authError();

    const now = Math.floor(clock() / 1000);
    if (claims.exp <= now - CLOCK_SKEW_SECONDS
      || claims.iat > now + CLOCK_SKEW_SECONDS
      || claims.iat < now - 15 * 60
      || (claims.nbf !== undefined && (!Number.isFinite(claims.nbf) || claims.nbf > now + CLOCK_SKEW_SECONDS))
      || claims.exp - claims.iat > 60 * 60) throw authError();

    if (Array.isArray(claims.aud) && claims.aud.length > 1
      && (typeof claims.azp !== "string" || claims.azp !== audience)) throw authError();

    if (typeof claims.jti !== "string" || !claims.jti || claims.jti.length > 256) throw authError();

    let keys = await loadKeys(false);
    let jwk = keys.find((key) => key.kid === header.kid);
    if (!jwk) {
      keys = await loadKeys(true);
      jwk = keys.find((key) => key.kid === header.kid);
    }
    if (!jwk) throw authError();

    let publicKey;
    try {
      publicKey = await crypto.subtle.importKey(
        "jwk",
        { kty: "RSA", n: jwk.n, e: jwk.e, alg: "RS256", ext: true, key_ops: ["verify"] },
        { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
        false,
        ["verify"],
      );
    } catch {
      throw authError("identity_key_invalid");
    }

    const signed = new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`);
    let signatureValid = false;
    try {
      signatureValid = await crypto.subtle.verify(
        { name: "RSASSA-PKCS1-v1_5" },
        publicKey,
        decodeBase64Url(encodedSignature),
        signed,
      );
    } catch {
      throw authError();
    }
    if (!signatureValid) throw authError();

    let revoked;
    try { revoked = await isRevoked({ issuer, subject: claims.sub, tokenId: claims.jti, expiresAt: claims.exp }); }
    catch { throw authError("credential_status_unavailable"); }
    if (revoked !== false) throw authError();

    return Object.freeze({ issuer, subject: claims.sub });
  };
}
