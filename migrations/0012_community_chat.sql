-- Community Chat Feature
-- Adds support for group chat within communities

-- Community chat messages table
CREATE TABLE IF NOT EXISTS community_messages (
  id TEXT PRIMARY KEY,
  community_ap_id TEXT NOT NULL,
  sender_ap_id TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (community_ap_id) REFERENCES communities(ap_id) ON DELETE CASCADE
);

-- Index for efficient message retrieval by community
CREATE INDEX IF NOT EXISTS idx_community_messages_community ON community_messages(community_ap_id, created_at DESC);

-- last_message_at already exists in communities table (added previously)
