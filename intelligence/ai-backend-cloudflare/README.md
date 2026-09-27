# ЖАК — server-side AI backend (Cloudflare Worker)

This directory contains the **separate AI backend** for ЖАК. It is intentionally isolated from `intelligence/collector-cloudflare`, which remains the analytics collector.

## Contract

`POST /v1/ask`

Request:
```json
{"question":"..."}
```

Response:
```json
{"answer":"...","sources":[{"title":"...","url":"..."}]}
```

## Security

- The OpenAI API key is read only from the Worker secret `OPENAI_API_KEY`.
- No API key belongs in Git, Wrangler `vars`, or browser code.
- The Worker accepts requests only from `ALLOWED_ORIGIN`.
- Request size and question length are bounded.
- A Durable Object rate limiter is included at 30 requests per 60 seconds per client bucket.
- The public knowledge file is fetched from `KNOWLEDGE_URL`; the browser never receives the secret.

## Deployment gate

This is **implementation-ready code, not a production deployment**. A real Cloudflare account, Worker name, secret, production URL, CORS origin, and smoke test must be verified before the endpoint is placed into `data/intelligence-config.json`.

Cloudflare documents that sensitive values such as API keys should be stored as Worker secrets rather than plaintext variables: https://developers.cloudflare.com/workers/configuration/secrets/
