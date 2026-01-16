-- DM Message Requests
-- Messages from people not in your contacts go here for approval

CREATE TABLE IF NOT EXISTS dm_requests (
  id TEXT PRIMARY KEY,
  recipient_ap_id TEXT NOT NULL,   -- Who receives the request
  sender_ap_id TEXT NOT NULL,      -- Who sent the request
  content TEXT NOT NULL,           -- First message content
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected')),
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(recipient_ap_id, sender_ap_id)
);

CREATE INDEX IF NOT EXISTS idx_dm_requests_recipient ON dm_requests(recipient_ap_id, status, created_at DESC);
