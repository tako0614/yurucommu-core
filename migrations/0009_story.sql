-- Yurucommu Story Feature
-- Adds support for 24-hour ephemeral content (Stories)

-- Add end_time column to objects table for story expiration
ALTER TABLE objects ADD COLUMN end_time TEXT;

-- Index for efficient story expiration queries
CREATE INDEX idx_objects_end_time ON objects(end_time) WHERE end_time IS NOT NULL;

-- Story view tracking (who has seen which story)
CREATE TABLE story_views (
  actor_ap_id TEXT NOT NULL,
  story_ap_id TEXT NOT NULL,
  viewed_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (actor_ap_id, story_ap_id)
);

-- Index for efficient lookup of viewed stories
CREATE INDEX idx_story_views_actor ON story_views(actor_ap_id);
