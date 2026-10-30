-- Email OTP and server-side session records for ZHAKIN Wallet.
-- Prototype schema only. Not applied to a live Cloudflare D1 database.
-- This migration depends on 0001_wallet_schema.sql (wallet_participants).
-- Rate-limit enforcement and challenge consumption MUST be atomic in the
-- future D1 repository adapter; this schema alone does not enforce that logic.
-- email_normalized is personal data: apply access minimization, retention,
-- deletion and privacy controls before any real participant is registered.

ALTER TABLE wallet_participants ADD COLUMN email_normalized TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_wallet_participants_email_normalized
  ON wallet_participants(email_normalized)
  WHERE email_normalized IS NOT NULL;

CREATE TABLE IF NOT EXISTS wallet_otp_challenges (
  id TEXT PRIMARY KEY,
  email_normalized TEXT NOT NULL,
  code_hmac TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0 AND attempts <= 5),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER,
  revoked_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_wallet_otp_email_created
  ON wallet_otp_challenges(email_normalized, created_at);
CREATE INDEX IF NOT EXISTS idx_wallet_otp_expiry
  ON wallet_otp_challenges(expires_at);

CREATE TABLE IF NOT EXISTS wallet_auth_sessions (
  token_hmac TEXT PRIMARY KEY,
  participant_id TEXT NOT NULL REFERENCES wallet_participants(id),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_wallet_sessions_participant_expiry
  ON wallet_auth_sessions(participant_id, expires_at);

CREATE TABLE IF NOT EXISTS wallet_auth_rate_limits (
  subject_hmac TEXT NOT NULL,
  window_started_at INTEGER NOT NULL,
  request_count INTEGER NOT NULL CHECK (request_count >= 0),
  PRIMARY KEY (subject_hmac, window_started_at)
);
