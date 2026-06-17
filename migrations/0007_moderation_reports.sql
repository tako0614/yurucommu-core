-- Moderation reports for federation abuse handling.
--
-- Inbound `Flag` activities are persisted here so operators can review them
-- via the moderation API instead of the report being lost to a log line.
-- Rows are append-only at ingest; an operator marks a report handled by
-- stamping `resolved_at`.

CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY,
  reporter_ap_id TEXT NOT NULL,
  target_ap_id TEXT,
  content TEXT,
  instance TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at TEXT
);

CREATE INDEX IF NOT EXISTS reports_created_idx
  ON reports(created_at);

CREATE INDEX IF NOT EXISTS reports_resolved_idx
  ON reports(resolved_at);
