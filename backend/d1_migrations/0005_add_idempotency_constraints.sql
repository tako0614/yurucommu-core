-- Migration: Add idempotency and concurrency controls
-- Date: 2025-10-19
-- Purpose: Prevent duplicate activity processing and worker race conditions

-- Add unique constraints for idempotency

-- ap_follows: Prevent duplicate follow relationships
CREATE UNIQUE INDEX IF NOT EXISTS idx_ap_follows_unique 
  ON ap_follows(local_user_id, remote_actor_id);

-- ap_followers: Prevent duplicate follower relationships
CREATE UNIQUE INDEX IF NOT EXISTS idx_ap_followers_unique 
  ON ap_followers(local_user_id, remote_actor_id);

-- ap_inbox_activities: Prevent duplicate activity processing
CREATE UNIQUE INDEX IF NOT EXISTS idx_ap_inbox_unique_activity 
  ON ap_inbox_activities(local_user_id, activity_id);

-- ap_delivery_queue: Prevent duplicate deliveries
-- Add new columns first
ALTER TABLE ap_delivery_queue ADD COLUMN retry_count INTEGER DEFAULT 0;
ALTER TABLE ap_delivery_queue ADD COLUMN delivered_at TEXT;
ALTER TABLE ap_delivery_queue ADD COLUMN last_error TEXT;

-- Create unique index for delivery queue
CREATE UNIQUE INDEX IF NOT EXISTS idx_ap_delivery_unique 
  ON ap_delivery_queue(activity_id, target_inbox_url);

-- Add index for worker queue processing (to avoid race conditions)
CREATE INDEX IF NOT EXISTS idx_ap_inbox_status_created 
  ON ap_inbox_activities(status, created_at);

CREATE INDEX IF NOT EXISTS idx_ap_delivery_status_created 
  ON ap_delivery_queue(status, created_at);

