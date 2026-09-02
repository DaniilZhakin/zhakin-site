CREATE TABLE IF NOT EXISTS engagement_daily (
  event_day TEXT NOT NULL,
  event_type TEXT NOT NULL,
  path TEXT NOT NULL,
  content_id TEXT,
  referrer_class TEXT NOT NULL,
  event_count INTEGER NOT NULL DEFAULT 0 CHECK (event_count >= 0),
  PRIMARY KEY (event_day, event_type, path, content_id, referrer_class)
);

CREATE INDEX IF NOT EXISTS idx_engagement_daily_day
  ON engagement_daily (event_day);

CREATE INDEX IF NOT EXISTS idx_engagement_daily_type_day
  ON engagement_daily (event_type, event_day);

CREATE INDEX IF NOT EXISTS idx_engagement_daily_path_day
  ON engagement_daily (path, event_day);
