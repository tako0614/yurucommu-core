-- DM read status tracking
-- Tracks when a user last read messages in a conversation

CREATE TABLE IF NOT EXISTS dm_read_status (
  actor_ap_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  last_read_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (actor_ap_id, conversation_id)
);

CREATE INDEX IF NOT EXISTS idx_dm_read_status_actor ON dm_read_status(actor_ap_id);
