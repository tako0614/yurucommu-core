-- Migration: Add ActivityPub fields to comments and reactions
-- Date: 2025-10-19

-- Add ActivityPub fields to comments
ALTER TABLE comments ADD COLUMN ap_object_id TEXT;
ALTER TABLE comments ADD COLUMN ap_activity_id TEXT;
CREATE UNIQUE INDEX idx_comments_ap_object_id ON comments(ap_object_id) WHERE ap_object_id IS NOT NULL;
CREATE UNIQUE INDEX idx_comments_ap_activity_id ON comments(ap_activity_id) WHERE ap_activity_id IS NOT NULL;

