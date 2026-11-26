/**
 * ZHAKIN Wallet — Cloudflare D1 repository adapter (prototype).
 *
 * This module is not wired to a Worker, identity provider, or production DB.
 * Callers must authorize the actor and validate the business workflow before
 * invoking postLedgerEntry(). Apply migrations explicitly in a non-production
 * environment first. D1 batch provides transactional execution; the unique
 * idempotency_key constraint in 0001_wallet_schema.sql prevents duplicate
 * operations. A constraint error must be treated as a conflict, never retried
 * with a new key automatically.
 */

const SAFE_LIMIT_MIN = 1;
const SAFE_LIMIT_MAX = 100;
const CURSOR_PATTERN = /^[0-9]{1,16}:[A-Za-z0-9_-]{1,128}$/;

function requireDb(db) {
  if (!db || typeof db.prepare !== "function" || typeof db.batch !== "function") {
    throw new TypeError("A compatible D1 database binding is required");
  }
}

function parseCursor(cursor) {
  if (cursor == null || cursor === "") return null;
  if (typeof cursor !== "string" || !CURSOR_PATTERN.test(cursor)) {
    throw new TypeError("Invalid ledger cursor");
  }
  const separator = cursor.indexOf(":");
  const createdAt = cursor.slice(0, separator);
  const id = cursor.slice(separator + 1);
  return { createdAt, id };
}

function encodeCursor(entry) {
  // Timestamp characters are encoded to keep the cursor opaque and bounded.
  return btoa(JSON.stringify([entry.created_at, entry.id]))
    .replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

/**
 * Creates a repository compatible with createWalletHandler().
 * The database binding must be supplied by trusted server configuration.
 */
export function createD1WalletRepository(db) {
  requireDb(db);

  return {
    async getBalance(participantId) {
      if (typeof participantId !== "string" || !participantId) {
        throw new TypeError("participantId is required");
      }
      const row = await db.prepare(`
        SELECT COALESCE(SUM(points), 0) AS points
        FROM wallet_ledger_entries
        WHERE participant_id = ? AND status = 'posted'
      `).bind(participantId).first();

      const balance = row?.points;
      if (!Number.isSafeInteger(balance)) {
        throw new RangeError("Stored ledger balance is not a safe integer");
      }
      return balance;
    },

    async listLedger(participantId, { limit = 50, cursor = null } = {}) {
      if (typeof participantId !== "string" || !participantId) {
        throw new TypeError("participantId is required");
      }
      if (!Number.isInteger(limit) || limit < SAFE_LIMIT_MIN || limit > SAFE_LIMIT_MAX) {
        throw new RangeError("limit must be between 1 and 100");
      }

      // Cursor is base64url JSON [created_at, id]. It is a pagination marker,
      // not an authorization token; participant scope is always in the SQL.
      let marker = null;
      if (cursor != null && cursor !== "") {
        if (typeof cursor !== "string" || cursor.length > 512) {
          throw new TypeError("Invalid ledger cursor");
        }
        try {
          const normalized = cursor.replaceAll("-", "+").replaceAll("_", "/");
          const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
          const decoded = JSON.parse(atob(padded));
          if (!Array.isArray(decoded) || decoded.length !== 2 ||
              typeof decoded[0] !== "string" || typeof decoded[1] !== "string") {
            throw new Error("bad cursor");
          }
          marker = { createdAt: decoded[0], id: decoded[1] };
        } catch {
          throw new TypeError("Invalid ledger cursor");
        }
      }

      const query = marker
        ? db.prepare(`
            SELECT id, activity_id, entry_type, points, reason, status, created_at
            FROM wallet_ledger_entries
            WHERE participant_id = ? AND status IN ('posted', 'voided')
              AND (created_at < ? OR (created_at = ? AND id < ?))
            ORDER BY created_at DESC, id DESC LIMIT ?
          `).bind(participantId, marker.createdAt, marker.createdAt, marker.id, limit + 1)
        : db.prepare(`
            SELECT id, activity_id, entry_type, points, reason, status, created_at
            FROM wallet_ledger_entries
            WHERE participant_id = ? AND status IN ('posted', 'voided')
            ORDER BY created_at DESC, id DESC LIMIT ?
          `).bind(participantId, limit + 1);

      const result = await query.all();
      const rows = Array.isArray(result?.results) ? result.results : [];
      const hasMore = rows.length > limit;
      const page = rows.slice(0, limit).map((row) => ({
        id: row.id,
        activity_id: row.activity_id ?? null,
        type: row.entry_type,
        points: row.points,
        reason: row.reason,
        status: row.status,
        created_at: row.created_at,
      }));
      return {
        entries: page,
        next_cursor: hasMore ? encodeCursor(rows[limit - 1]) : null,
      };
    },

    /**
     * Atomically inserts a ledger row and its audit event.
     * The caller must provide server-generated IDs/timestamp and a verified
     * actor. The unique idempotency_key constraint is the durable replay guard.
     * Duplicate-key errors propagate to the caller; they are not silently
     * converted into a new accrual.
     */
    async postLedgerEntry(entry, auditEvent) {
      if (!entry || !auditEvent) throw new TypeError("entry and auditEvent are required");
      const requiredEntry = ["id", "participantId", "type", "points", "reason", "actorId", "idempotencyKey", "createdAt"];
      for (const key of requiredEntry) {
        if (entry[key] === undefined || entry[key] === null || entry[key] === "") {
          throw new TypeError(`entry.${key} is required`);
        }
      }
      if (!Number.isSafeInteger(entry.points) || entry.points === 0) {
        throw new TypeError("entry.points must be a non-zero safe integer");
      }
      if (!["accrual", "reversal", "adjustment"].includes(entry.type)) {
        throw new TypeError("entry.type is invalid");
      }
      if (typeof entry.idempotencyKey !== "string" || entry.idempotencyKey.length > 200) {
        throw new TypeError("entry.idempotencyKey is invalid");
      }
      for (const key of ["id", "actorId", "action", "targetType", "targetId", "outcome", "createdAt"]) {
        if (auditEvent[key] === undefined || auditEvent[key] === null || auditEvent[key] === "") {
          throw new TypeError(`auditEvent.${key} is required`);
        }
      }
      if (!["success", "denied", "failed"].includes(auditEvent.outcome)) {
        throw new TypeError("auditEvent.outcome is invalid");
      }

      const ledgerInsert = db.prepare(`
        INSERT INTO wallet_ledger_entries
          (id, participant_id, activity_id, entry_type, points, reason, actor_id, idempotency_key, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'posted', ?)
      `).bind(entry.id, entry.participantId, entry.activityId ?? null, entry.type,
        entry.points, entry.reason, entry.actorId, entry.idempotencyKey, entry.createdAt);

      const auditInsert = db.prepare(`
        INSERT INTO wallet_audit_events
          (id, actor_id, action, target_type, target_id, reason, outcome, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(auditEvent.id, auditEvent.actorId, auditEvent.action,
        auditEvent.targetType, auditEvent.targetId, auditEvent.reason ?? null,
        auditEvent.outcome, auditEvent.createdAt);

      return db.batch([ledgerInsert, auditInsert]);
    },
  };
}
