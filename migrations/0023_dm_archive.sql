-- DM conversation archive support
-- Allows users to archive/hide conversations without deleting them

CREATE TABLE IF NOT EXISTS dm_archived_conversations (
  actor_ap_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  archived_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (actor_ap_id, conversation_id)
);

CREATE INDEX IF NOT EXISTS idx_dm_archived_actor
  ON dm_archived_conversations(actor_ap_id);
