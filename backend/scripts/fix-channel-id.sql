-- Fix channel IDs that conflict with URL routing
-- This updates channels with ID "channel" to use a proper UUID

-- First, check what channels exist with problematic IDs
SELECT id, community_id, name FROM community_channels WHERE id = 'channel';

-- Update the problematic channels to use proper UUIDs
-- Note: You may need to run this for each community_id individually
-- Replace 'YOUR_COMMUNITY_ID' with the actual community ID from the SELECT above

-- Example:
-- UPDATE community_channels
-- SET id = 'ch-' || substr(lower(hex(randomblob(4))), 1, 8)
-- WHERE community_id = 'YOUR_COMMUNITY_ID' AND id = 'channel';
