-- Story share tracking
-- Tracks when users share stories

CREATE TABLE IF NOT EXISTS story_shares (
  id TEXT PRIMARY KEY,
  story_ap_id TEXT NOT NULL,
  actor_ap_id TEXT NOT NULL,
  shared_at TEXT DEFAULT (datetime('now')),
  UNIQUE(story_ap_id, actor_ap_id)
);

CREATE INDEX IF NOT EXISTS idx_story_shares_story ON story_shares(story_ap_id);
CREATE INDEX IF NOT EXISTS idx_story_shares_actor ON story_shares(actor_ap_id);

-- Add share_count column to objects table for stories
-- SQLite doesn't support IF NOT EXISTS for columns, so we use a workaround
-- This will fail silently if column exists
ALTER TABLE objects ADD COLUMN share_count INTEGER DEFAULT 0;
