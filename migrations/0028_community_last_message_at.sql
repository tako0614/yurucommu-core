-- Migration: 0028_community_last_message_at
-- Description: Add last_message_at to communities and backfill from existing messages

ALTER TABLE communities
ADD COLUMN last_message_at TEXT;

CREATE INDEX IF NOT EXISTS idx_communities_last_message_at
ON communities(last_message_at);

UPDATE communities
SET last_message_at = (
  SELECT MAX(created_at)
  FROM community_messages
  WHERE community_messages.community_ap_id = communities.ap_id
)
WHERE EXISTS (
  SELECT 1
  FROM community_messages
  WHERE community_messages.community_ap_id = communities.ap_id
);
