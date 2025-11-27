-- Migration: Drop friendships table
-- Friend requests are now handled via ActivityPub Follow/Accept/Reject activities
-- using ap_followers and ap_follows tables

-- Drop the friendships table (no longer needed)
DROP TABLE IF EXISTS friendships;
