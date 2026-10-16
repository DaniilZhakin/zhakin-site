/**
 * Read-only Cloudflare D1 repository adapter for the ZHAKIN Wallet scaffold.
 *
 * This adapter implements only balance/history reads. It does not perform
 * writes, create accounts, award points, or replace server-side authentication.
 * Pass only the participant ID from the verified server principal.
 */

const MAX_CURSOR_LENGTH = 512;
const PAGE_SIZE_MAX = 50;

function encodeCursor(createdAt, id) {
  const bytes = new TextEncoder().encode(JSON.stringify({ createdAt, id }));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decodeCursor(cursor) {
  if (cursor == null) return null;
  if (typeof cursor !== "string" || cursor.length === 0 || cursor.length > MAX_CURSOR_LENGTH) {
    throw new TypeError("invalid ledger cursor");
  }
  if (!/^[A-Za-z0-9_-]+$/.test(cursor)) throw new TypeError("invalid ledger cursor");

  try {
    const base64 = cursor.replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4));
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    const value = JSON.parse(new TextDecoder().decode(bytes));
    if (
      !value ||
      typeof value.createdAt !== "string" ||
      value.createdAt.length === 0 ||
      typeof value.id !== "string" ||
      value.id.length === 0
    ) {
      throw new TypeError("invalid ledger cursor");
    }
    return value;
  } catch {
    throw new TypeError("invalid ledger cursor");
  }
}

function requireDatabase(db) {
  if (!db || typeof db.prepare !== "function") {
    throw new TypeError("Cloudflare D1 database binding is required");
  }
}

function requireParticipantId(participantId) {
  if (typeof participantId !== "string" || participantId.trim().length === 0) {
    throw new TypeError("verified participant ID is required");
  }
}

export function createD1WalletRepository(db) {
  requireDatabase(db);

  return Object.freeze({
    async getBalance(participantId) {
      requireParticipantId(participantId);
      const result = await db.prepare(
        "SELECT COALESCE(SUM(points), 0) AS balance " +
        "FROM wallet_ledger_entries " +
        "WHERE participant_id = ? AND status = 'posted'",
      ).bind(participantId).first();

      const balance = result?.balance;
      if (!Number.isSafeInteger(balance)) {
        throw new TypeError("stored wallet balance is not a safe integer");
      }
      return balance;
    },

    async listLedger(participantId, { limit = PAGE_SIZE_MAX, cursor = null } = {}) {
      requireParticipantId(participantId);
      if (!Number.isInteger(limit) || limit < 1 || limit > PAGE_SIZE_MAX) {
        throw new TypeError("ledger page size is invalid");
      }

      const decoded = decodeCursor(cursor);
      const baseQuery =
        "SELECT id, entry_type AS type, points, reason, activity_id AS activityId, " +
        "status, created_at AS createdAt " +
        "FROM wallet_ledger_entries " +
        "WHERE participant_id = ? AND status IN ('posted', 'voided') ";
      const pageQuery = decoded
        ? baseQuery +
          "AND (created_at < ? OR (created_at = ? AND id < ?)) " +
          "ORDER BY created_at DESC, id DESC LIMIT ?"
        : baseQuery + "ORDER BY created_at DESC, id DESC LIMIT ?";

      const statement = db.prepare(pageQuery);
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
      const lastEntry = entries.at(-1);
      return {
        entries,
        nextCursor: hasMore && lastEntry
          ? encodeCursor(lastEntry.createdAt, lastEntry.id)
          : null,
      };
    },
  });
}

export { decodeCursor as decodeLedgerCursor, encodeCursor as encodeLedgerCursor };
