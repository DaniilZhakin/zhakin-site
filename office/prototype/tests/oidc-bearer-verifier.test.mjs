import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { createOidcBearerVerifier } from "../src/oidc-bearer-verifier.mjs";

const ISSUER = "https://identity.example";
const AUDIENCE = "zhakin-office";
const JWKS_URL = "https://identity.example/.well-known/jwks.json";
const NOW = 1_794_936_000_000;
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: "jwk" }), kid: "key-1", use: "sig", alg: "RS256" };

function encode(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}
function token({ header = {}, claims = {}, signer = privateKey } = {}) {
  const h = encode({ alg: "RS256", typ: "JWT", kid: "key-1", ...header });
  const p = encode({
    iss: ISSUER, aud: AUDIENCE, sub: "reviewer-123",
    iat: Math.floor(NOW / 1000), exp: Math.floor(NOW / 1000) + 300,
    jti: "token-unique-123", ...claims,
  });
  const input = `${h}.${p}`;
  return `${input}.${sign("RSA-SHA256", Buffer.from(input), signer).toString("base64url")}`;
}
function setup({ revoked = false, fetchStatus = 200 } = {}) {
  let fetchCount = 0;
  const verifier = createOidcBearerVerifier({
    issuer: ISSUER,
    audience: AUDIENCE,
    jwksUrl: JWKS_URL,
    clock: () => NOW,
    isRevoked: async () => revoked,
    fetchImpl: async () => {
      fetchCount += 1;
      return new Response(JSON.stringify({ keys: [jwk] }), {
        status: fetchStatus,
        headers: { "content-type": "application/json" },
      });
    },
  });
  return { verifier, getFetchCount: () => fetchCount };
}

test("verifies RS256 signature and returns only trusted issuer+subject", async () => {
  const { verifier, getFetchCount } = setup();
  assert.deepEqual(await verifier(token()), { issuer: ISSUER, subject: "reviewer-123" });
  assert.equal(getFetchCount(), 1);
});

test("rejects unsigned and non-RS256 tokens", async () => {
  const { verifier } = setup();
  await assert.rejects(verifier(`${encode({ alg: "none" })}.${encode({})}.AA`));
  await assert.rejects(verifier(token({ header: { alg: "HS256" } })));
});

test("rejects expired, wrong issuer, wrong audience and over-age credentials", async () => {
  const { verifier } = setup();
  await assert.rejects(verifier(token({ claims: { exp: Math.floor(NOW / 1000) - 120 } })));
  await assert.rejects(verifier(token({ claims: { iss: "https://attacker.example" } })));
  await assert.rejects(verifier(token({ claims: { aud: "other-service" } })));
  await assert.rejects(verifier(token({ claims: { iat: Math.floor(NOW / 1000) - 3600 } })));
});

test("rejects invalid signature and unknown signing key", async () => {
  const other = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const { verifier } = setup();
  await assert.rejects(verifier(token({ signer: other.privateKey })));
  await assert.rejects(verifier(token({ header: { kid: "unknown-key" } })));
});

test("requires jti and a successful non-revoked status lookup", async () => {
  const { verifier } = setup();
  await assert.rejects(verifier(token({ claims: { jti: undefined } })));
  const revoked = setup({ revoked: true });
  await assert.rejects(revoked.verifier(token()));
});

test("fails closed when JWKS or revocation dependency is unavailable", async () => {
  const unavailableKeys = createOidcBearerVerifier({
    issuer: ISSUER, audience: AUDIENCE, jwksUrl: JWKS_URL,
    isRevoked: async () => false,
    fetchImpl: async () => new Response("unavailable", { status: 503 }),
    clock: () => NOW,
  });
  await assert.rejects(unavailableKeys(token()));
  const unavailableRevocation = createOidcBearerVerifier({
    issuer: ISSUER, audience: AUDIENCE, jwksUrl: JWKS_URL,
    isRevoked: async () => { throw new Error("database offline"); },
    fetchImpl: async () => new Response(JSON.stringify({ keys: [jwk] })),
    clock: () => NOW,
  });
  await assert.rejects(unavailableRevocation(token()));
});

test("requires explicit HTTPS identity configuration and revocation checker", () => {
  assert.throws(() => createOidcBearerVerifier({
    issuer: ISSUER, audience: AUDIENCE, jwksUrl: "http://identity.example/keys",
    isRevoked: async () => false,
  }));
  assert.throws(() => createOidcBearerVerifier({
    issuer: ISSUER, audience: AUDIENCE, jwksUrl: JWKS_URL,
  }));
});
