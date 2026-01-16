-- Notification archive support
-- Allows users to archive notifications without deleting them

CREATE TABLE IF NOT EXISTS notification_archived (
  actor_ap_id TEXT NOT NULL,
  activity_ap_id TEXT NOT NULL,
  archived_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (actor_ap_id, activity_ap_id)
);

CREATE INDEX IF NOT EXISTS idx_notification_archived_actor
  ON notification_archived(actor_ap_id);
