-- Story Votes Feature
-- Adds support for poll voting on Stories

-- Story votes table
CREATE TABLE IF NOT EXISTS story_votes (
  id TEXT PRIMARY KEY,
  story_ap_id TEXT NOT NULL,
  actor_ap_id TEXT NOT NULL,
  option_index INTEGER NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(story_ap_id, actor_ap_id)
);

-- Index for efficient vote counting by story
CREATE INDEX IF NOT EXISTS idx_story_votes_story ON story_votes(story_ap_id);
