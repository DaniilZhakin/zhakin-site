# ZHAKIN Wallet internal OTP mailer scaffold

**Status: isolated code scaffold and contract tests only. Not deployed. No email provider, credentials, verified sender, service binding, or production route is configured.**

## Boundary

The `mailer-worker.js` service is intended to accept only `POST /v1/otp` through a Cloudflare Service Binding. It accepts a strict JSON payload:

```json
{ "to": "member@example.org", "code": "123456", "expires_at": 1800000000000 }
```

The Worker validates the recipient, six-digit code, exact payload keys, expiry window and a 2 KiB streamed body limit. It creates a plain-text Russian email and forwards it through the private `WALLET_EMAIL_PROVIDER` Service Binding. It does not accept caller-supplied sender, subject, HTML, headers, provider URL, or arbitrary template content.

## Required bindings

| Name | Type | Purpose |
|---|---|---|
| `WALLET_EMAIL_PROVIDER` | Service Binding | Private provider-adapter Worker; must implement `POST /v1/send` |
| `WALLET_MAIL_FROM` | Plaintext variable | Verified sender address; set only after provider verification |

The provider adapter contract receives JSON `{from,to,subject,text}`. It must keep vendor credentials in its own secret store, enforce a strict timeout, validate sender/recipient, return success only after accepting the message, avoid logging message bodies or OTP values, and return sanitized errors. No vendor-specific adapter is selected or implemented here.

**Deployment rule:** do not attach a public route or public hostname to this Worker. Bind it only from the dedicated Wallet Worker through a Cloudflare Service Binding. Keep the provider adapter private as well. The upstream Wallet Worker already calls `WALLET_MAILER` at `/v1/otp`; this scaffold is the implementation target for that binding, pending provider selection and non-production setup.

## Security and limitations

- No CORS or browser-facing routes are provided.
- Only one fixed internal path and one method are accepted.
- No caller-controlled sender, subject, HTML, attachments or provider endpoint.
- Request and provider errors are sanitized; responses are `no-store`.
- A 5-second provider timeout is enforced.
- No OTP values or email bodies are logged.
- This does not prove Cloudflare runtime behavior or real mail delivery.
- No participant onboarding, balances, ledger, ZP/BFU, exchange, deposits or withdrawals are enabled.

## Next non-production gates

1. Select and connect an email provider (for example Resend, Postmark, Mailgun or Amazon SES) using sandbox/test credentials.
2. Implement and test its private provider-adapter Worker against the contract above.
3. Verify the sender domain and configure `WALLET_MAIL_FROM`.
4. Provision a disposable D1 database and test-only Wallet Worker environment.
5. Deploy both Workers without public routes, bind service-to-service, then run OTP delivery, expiry, rate-limit, replay, session and iPhone tests.
6. Keep production participants and all financial functionality disabled until separate security review and approval.
