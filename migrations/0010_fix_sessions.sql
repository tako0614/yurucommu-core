-- Fix sessions table to remove foreign key constraint to old members table
-- Since we now use actors table, member_id stores ap_id instead

-- Drop old sessions table and recreate without FK constraint
DROP TABLE IF EXISTS sessions;

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL,  -- stores actor ap_id
  access_token TEXT NOT NULL,
  refresh_token TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_sessions_member ON sessions(member_id);
