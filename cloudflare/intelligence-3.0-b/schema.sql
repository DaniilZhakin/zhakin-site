-- Intelligence 3.0-B
-- Production deployment only after Cloudflare runtime verification.

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT NOT NULL,
  path TEXT NOT NULL,
  client_timestamp TEXT,
  referrer_class TEXT,
  content_id TEXT,
  schema_version TEXT NOT NULL,
  received_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_events_received_at ON events(received_at);
CREATE INDEX IF NOT EXISTS idx_events_event_type ON events(event_type);
CREATE INDEX IF NOT EXISTS idx_events_path ON events(path);
