/**
 * Read-only Cloudflare D1 adapter for the ZHAKIN Wallet prototype.
 *
 * Not connected to a Worker, identity provider, or live database.
 * The caller must pass only the participant ID from a server-verified
 * principal. This module deliberately exposes no write operations.
 */
const MAX_CURSOR_LENGTH = 512;
const MAX_PAGE_SIZE = 50;

function requireDatabase(db) {
  if (!db || typeof db.prepare !== "function") {
    throw new TypeError("Cloudflare D1 database binding is required");
  }
}

function requireParticipantId(participantId) {
  if (typeof participantId !== "string" || participantId.trim() === "") {
    throw new TypeError("verified participant ID is required");
  }
}

export function encodeLedgerCursor(createdAt, id) {
  if (typeof createdAt !== "string" || !createdAt || typeof id !== "string" || !id) {
    throw new TypeError("cursor fields are required");
  }
  const bytes = new TextEncoder().encode(JSON.stringify({ createdAt, id }));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function decodeLedgerCursor(cursor) {
  if (cursor == null || cursor === "") return null;
  if (typeof cursor !== "string" || cursor.length > MAX_CURSOR_LENGTH ||
      !/^[A-Za-z0-9_-]+$/.test(cursor)) {
    throw new TypeError("invalid ledger cursor");
  }
  try {
    const base64 = cursor.replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4));
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    const value = JSON.parse(new TextDecoder().decode(bytes));
    if (!value || typeof value.createdAt !== "string" || !value.createdAt ||
        typeof value.id !== "string" || !value.id) {
      throw new TypeError("invalid ledger cursor");
    }
    return { createdAt: value.createdAt, id: value.id };
  } catch {
    throw new TypeError("invalid ledger cursor");
  }
}

export function createD1WalletRepository(db) {
  requireDatabase(db);
  return Object.freeze({
    async getBalance(participantId) {
      requireParticipantId(participantId);
      const row = await db.prepare(
        "SELECT COALESCE(SUM(points), 0) AS balance " +
        "FROM wallet_ledger_entries " +
        "WHERE participant_id = ? AND status = 'posted'",
      ).bind(participantId).first();
      if (!Number.isSafeInteger(row?.balance)) {
        throw new TypeError("stored wallet balance is not a safe integer");
      }
      return row.balance;
    },

    async listLedger(participantId, { limit = MAX_PAGE_SIZE, cursor = null } = {}) {
      requireParticipantId(participantId);
      if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE_SIZE) {
        throw new TypeError("ledger page size is invalid");
      }
      const decoded = decodeLedgerCursor(cursor);
      const base = "SELECT id, entry_type AS type, points, reason, " +
        "activity_id AS activityId, status, created_at AS createdAt " +
        "FROM wallet_ledger_entries " +
        "WHERE participant_id = ? AND status IN ('posted', 'voided') ";
      const query = decoded
        ? base + "AND (created_at < ? OR (created_at = ? AND id < ?)) " +
          "ORDER BY created_at DESC, id DESC LIMIT ?"
        : base + "ORDER BY created_at DESC, id DESC LIMIT ?";
      const statement = db.prepare(query);
      const result = decoded
        ? await statement.bind(
          participantId, decoded.createdAt, decoded.createdAt, decoded.id, limit + 1,
        ).all()
        : await statement.bind(participantId, limit + 1).all();
      if (!Array.isArray(result?.results)) {
        throw new TypeError("Cloudflare D1 returned an invalid ledger result");
      }
      const rows = result.results;
      const hasMore = rows.length > limit;
      const entries = rows.slice(0, limit);
      const last = entries.at(-1);
      const nextCursor = hasMore && last
        ? encodeLedgerCursor(last.createdAt, last.id)
        : null;
      // The main-branch handler contract uses snake_case.
      return Object.freeze({ entries, next_cursor: nextCursor });
    },
  });
}
