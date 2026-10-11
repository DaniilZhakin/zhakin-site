/**
 * ZHAKIN Wallet — domain prototype only.
 * In-memory helpers for tests; NOT a production ledger or API.
 * Never use client-supplied balances as authoritative data.
 */

const ALLOWED_TYPES = new Set(["accrual", "reversal", "adjustment"]);

export function calculateBalance(entries, participantId) {
  if (!Array.isArray(entries) || typeof participantId !== "string" || !participantId) {
    throw new TypeError("entries and participantId are required");
  }

  return entries
    .filter((entry) => entry.participantId === participantId && entry.status === "posted")
    .reduce((total, entry) => {
      if (!Number.isSafeInteger(entry.points)) {
        throw new TypeError("ledger points must be safe integers");
      }
      const nextTotal = total + entry.points;
      if (!Number.isSafeInteger(nextTotal)) {
        throw new RangeError("calculated balance exceeds the safe integer range");
      }
      return nextTotal;
    }, 0);
}

/**
 * Pure validation helper. Persistence, authorization, transactions,
 * idempotency storage and audit writes must be implemented server-side.
 */
export function validateLedgerCommand(command) {
  if (!command || typeof command !== "object") throw new TypeError("command is required");
  if (typeof command.participantId !== "string" || !command.participantId.trim()) {
    throw new TypeError("participantId is required");
  }
  if (!ALLOWED_TYPES.has(command.type)) throw new TypeError("unsupported ledger type");
  if (!Number.isSafeInteger(command.points) || command.points === 0) {
    throw new TypeError("points must be a non-zero safe integer");
  }
  if (typeof command.reason !== "string" || !command.reason.trim()) {
    throw new TypeError("reason is required");
  }
  if (typeof command.idempotencyKey !== "string" || !command.idempotencyKey.trim()) {
    throw new TypeError("idempotencyKey is required");
  }
  if (typeof command.actorId !== "string" || !command.actorId.trim()) {
    throw new TypeError("actorId is required");
  }
  if (command.type === "accrual" && command.points < 0) {
    throw new TypeError("accrual points must be positive");
  }
  if (command.type === "reversal" && command.points > 0) {
    throw new TypeError("reversal points must be negative");
  }
  return true;
}

/**
 * Creates a normalized entry for tests. Production code must first verify
 * actor permissions, task approval and idempotency inside a DB transaction.
 */
export function buildLedgerEntry(command, { id, now = new Date().toISOString() } = {}) {
  validateLedgerCommand(command);
  if (typeof id !== "string" || !id) throw new TypeError("server-generated id is required");

  return Object.freeze({
    id,
    participantId: command.participantId,
    type: command.type,
    points: command.points,
    reason: command.reason.trim(),
    activityId: command.activityId ?? null,
    actorId: command.actorId,
    idempotencyKey: command.idempotencyKey,
    status: "posted",
    createdAt: now,
  });
}
