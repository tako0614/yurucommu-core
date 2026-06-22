-- Efficiency indexes (2026-06-22).

-- Composite (conversation, published) so the ~4s-polled DM message reader
-- (WHERE conversation = ? ORDER BY published DESC) reads in index order instead
-- of filesorting the conversation's rows on every poll.
CREATE INDEX IF NOT EXISTS objects_conversation_published_idx
  ON objects (conversation, published);

-- Mirror of follows_following_created_idx for the FOLLOWING-list direction
-- (WHERE follower_ap_id = ? ORDER BY created_at) — previously only the followers
-- direction (following_ap_id, created_at) had a created-at covering index.
CREATE INDEX IF NOT EXISTS follows_follower_created_idx
  ON follows (follower_ap_id, created_at);
