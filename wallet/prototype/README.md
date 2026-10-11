# ZHAKIN Wallet — isolated domain prototype

**Status: prototype / not deployed / not production-ready.**

This directory contains only pure domain helpers and Node.js tests. It does not expose an API, authenticate users, persist balances, or connect to the public site.

## Run tests

Requires Node.js 20 or newer:

```sh
npm test
```

## Important boundaries

- The code is an in-memory domain prototype, not an authoritative ledger.
- Before any real use, server-side authentication and role checks, database transactions, persistent idempotency, approved-activity validation, append-only audit events, rate limits, privacy controls, backups and recovery tests must be implemented.
- Never accept a balance from the browser or deploy this prototype as a wallet API.
- Use synthetic test data only.
- ZHAKIN Points are internal activity-accounting points in this design; this prototype does not create a financial product or token.
- This work is isolated from the public site, the ЖАК backend, the analytics collector, AppDeploy backups and COIN УСЕРДИЕ / BFU.
