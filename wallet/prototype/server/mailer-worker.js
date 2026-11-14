/**
 * Dedicated internal OTP mailer boundary for ZHAKIN Wallet.
 * Intended to be reachable only through a Cloudflare Service Binding.
 */
const MAX_BODY_BYTES = 2048;
const MAX_OTP_LIFETIME_MS = 10 * 60 * 1000;
const PROVIDER_URL = "https://wallet-email-provider.internal/v1/send";

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
    },
  });
}

async function readBoundedJson(request) {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return { ok: false, status: 415 };
  }
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return { ok: false, status: 413 };
  if (!request.body) return { ok: false, status: 400 };
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel();
        return { ok: false, status: 413 };
      }
      chunks.push(value);
    }
  } catch {
    return { ok: false, status: 400 };
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return { ok: true, value: JSON.parse(new TextDecoder().decode(bytes)) };
  } catch {
    return { ok: false, status: 400 };
  }
}

function validEmail(value) {
  return typeof value === "string" && value.length <= 254 &&
    value === value.trim().toLowerCase() && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function validSender(value) {
  return typeof value === "string" && value.length <= 254 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function createWalletMailer({ provider, from, now = () => Date.now() } = {}) {
  if (!provider || typeof provider.fetch !== "function") {
    throw new TypeError("private email provider service binding is required");
  }
  if (!validSender(from)) throw new TypeError("a valid verified sender address is required");

  return Object.freeze({
    async fetch(request) {
      const url = new URL(request.url);
      if (url.pathname !== "/v1/otp") return json(404, { error: "not_found" });
      if (request.method !== "POST") return json(405, { error: "method_not_allowed" });

      const parsed = await readBoundedJson(request);
      if (!parsed.ok) return json(parsed.status, { error: "invalid_request" });
      const payload = parsed.value;
      if (!payload || typeof payload !== "object" || Array.isArray(payload) ||
          Object.keys(payload).sort().join(",") !== "code,expires_at,to" ||
          !validEmail(payload.to) ||
          typeof payload.code !== "string" || !/^\d{6}$/.test(payload.code) ||
          !Number.isSafeInteger(payload.expires_at)) {
        return json(400, { error: "invalid_request" });
      }

      const current = now();
      if (payload.expires_at <= current ||
          payload.expires_at > current + MAX_OTP_LIFETIME_MS + 30_000) {
        return json(400, { error: "invalid_request" });
      }

      const text = [
        "Ваш код для входа в ZHAKIN Wallet:",
        payload.code,
        "",
        "Код действует 10 минут. Не передавайте его другим лицам.",
        "Если вы не запрашивали вход, просто проигнорируйте это письмо.",
      ].join("\n");

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      try {
        const upstream = await provider.fetch(new Request(PROVIDER_URL, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            from,
            to: payload.to,
            subject: "Код входа в ZHAKIN Wallet",
            text,
          }),
          signal: controller.signal,
        }));
        if (!upstream.ok) return json(503, { error: "delivery_unavailable" });
        return json(202, { accepted: true });
      } catch {
        return json(503, { error: "delivery_unavailable" });
      } finally {
        clearTimeout(timeout);
      }
    },
  });
}

export default {
  fetch(request, env) {
    try {
      return createWalletMailer({
        provider: env.WALLET_EMAIL_PROVIDER,
        from: env.WALLET_MAIL_FROM,
      }).fetch(request);
    } catch {
      return json(503, { error: "mailer_not_configured" });
    }
  },
};
