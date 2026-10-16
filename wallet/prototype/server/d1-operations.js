/**
 * Isolated D1 write-path prototype for approved ZHAKIN Wallet activity awards.
 *
 * NOT wired to the HTTP handler or any live database. The caller MUST pass
 * server-verified actor/participant context only after checking coordinator
 * permissions and activity approval workflow. This module is not an auth layer.
 *
 * D1 batch() executes the statements transactionally. The unique idempotency
 * key and partial unique activity index protect retries and double awards.
 * Successful ledger insert and its audit event are committed together.
 */

const MAX_REASON_LENGTH = 500;
const MAX_ID_LENGTH = 128;
const MAX_IDEMPOTENCY_KEY_LENGTH = 200;

function requireText(value, label, maxLength = MAX_ID_LENGTH) {
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    value.length > maxLength
  ) {
    throw new TypeError(`${label} is invalid`);
  }
  return value.trim();
}

function requireD1(db) {
  if (!db || typeof db.prepare !== "function" || typeof db.batch !== "function") {
    throw new TypeError("Cloudflare D1 binding with batch() is required");
  }
}

/**
 * Returns an operation service; never expose it directly to untrusted clients.
 * Input actorId/participantId must come from server-verified context, not body.
 */
export function createD1WalletOperations(db, {
  idFactory = () => crypto.randomUUID(),
  now = () => new Date().toISOString(),
} = {}) {
  requireD1(db);
  if (typeof idFactory !== "function" || typeof now !== "function") {
    throw new TypeError("server ID and clock providers are required");
  }

  return Object.freeze({
    async awardApprovedActivity(command) {
      if (!command || typeof command !== "object") {
        throw new TypeError("award command is required");
      }
      const participantId = requireText(command.participantId, "participantId");
      const activityId = requireText(command.activityId, "activityId");
      const actorId = requireText(command.actorId, "actorId");
      const idempotencyKey = requireText(
        command.idempotencyKey, "idempotencyKey", MAX_IDEMPOTENCY_KEY_LENGTH,
      );
      const reason = requireText(command.reason, "reason", MAX_REASON_LENGTH);
      const points = command.points;
      if (!Number.isSafeInteger(points) || points <= 0) {
        throw new TypeError("award points must be a positive safe integer");
      }

      const entryId = requireText(idFactory(), "server-generated ledger ID");
      const timestamp = requireText(now(), "server timestamp", 64);

      const insertLedger = db.prepare(
        "INSERT OR IGNORE INTO wallet_ledger_entries " +
        "(id, participant_id, activity_id, entry_type, points, reason, actor_id, " +
        "idempotency_key, status, created_at) " +
        "SELECT ?, a.participant_id, a.id, 'accrual', ?, ?, ?, ?, 'posted', ? " +
        "FROM wallet_activities AS a " +
        "WHERE a.id = ? AND a.participant_id = ? AND a.status = 'approved' " +
        "AND a.points_awarded = ? " +
        "AND NOT EXISTS (SELECT 1 FROM wallet_ledger_entries AS existing " +
        "WHERE existing.activity_id = a.id AND existing.entry_type = 'accrual')",
      ).bind(
        entryId, points, reason, actorId, idempotencyKey, timestamp,
        activityId, participantId, points,
      );

      // SQLite changes() observes the preceding ledger INSERT within this batch.
      // If the insert is ignored (retry, duplicate activity, or unapproved task),
      // no success audit event is written.
      const insertAudit = db.prepare(
        "INSERT INTO wallet_audit_events " +
        "(id, actor_id, action, target_type, target_id, reason, outcome, created_at) " +
        "SELECT ?, ?, 'wallet.activity_award', 'wallet_ledger_entry', ?, ?, 'success', ? " +
        "WHERE changes() = 1",
      ).bind(
        requireText(idFactory(), "server-generated audit ID"),
        actorId, entryId, reason, timestamp,
      );

      const results = await db.batch([insertLedger, insertAudit]);
      if (!Array.isArray(results) || results.length !== 2) {
        throw new TypeError("Cloudflare D1 returned an invalid batch result");
      }
      const changes = results[0]?.meta?.changes;
      if (!Number.isInteger(changes) || changes < 0) {
        throw new TypeError("Cloudflare D1 returned an invalid write result");
      }

      return changes === 1
        ? Object.freeze({ status: "awarded", entryId, points })
        : Object.freeze({ status: "not_applied" });
    },
  });
}
