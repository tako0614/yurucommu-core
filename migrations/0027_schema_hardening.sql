-- Migration: 0027_schema_hardening
-- Description: Fix HIGH severity database schema issues
-- - Add missing indexes for performance
-- - Add audit columns to tables missing them
-- - Add soft delete pattern for critical data
-- Date: 2025-01-19

-- ============================================================================
-- 1. Add missing indexes for objects table performance
-- ============================================================================

-- Note: idx_objects_reply and idx_objects_community already exist from 0008_ap_native.sql
-- But we add additional composite indexes for common query patterns

-- Composite index for efficient timeline queries by author
CREATE INDEX IF NOT EXISTS idx_objects_author_timeline ON objects(attributed_to, published DESC);

-- Index for conversation/thread queries
CREATE INDEX IF NOT EXISTS idx_objects_conversation ON objects(conversation);

-- Composite index for community feed queries
CREATE INDEX IF NOT EXISTS idx_objects_community_timeline ON objects(community_ap_id, published DESC);

-- Index for local vs remote object filtering
CREATE INDEX IF NOT EXISTS idx_objects_local ON objects(is_local);

-- Composite index for visibility-based queries
CREATE INDEX IF NOT EXISTS idx_objects_visibility_published ON objects(visibility, published DESC);

-- ============================================================================
-- 2. Add audit columns to community_members table
-- ============================================================================

-- Add updated_at column
ALTER TABLE community_members ADD COLUMN updated_at TEXT DEFAULT (datetime('now'));

-- Create trigger to auto-update updated_at
CREATE TRIGGER IF NOT EXISTS trg_community_members_updated_at
AFTER UPDATE ON community_members
BEGIN
  UPDATE community_members SET updated_at = datetime('now') WHERE rowid = NEW.rowid;
END;

-- ============================================================================
-- 3. Add audit columns to blocks table
-- ============================================================================

-- blocks already has created_at, add updated_at
ALTER TABLE blocks ADD COLUMN updated_at TEXT DEFAULT (datetime('now'));

-- Create trigger to auto-update updated_at
CREATE TRIGGER IF NOT EXISTS trg_blocks_updated_at
AFTER UPDATE ON blocks
BEGIN
  UPDATE blocks SET updated_at = datetime('now') WHERE rowid = NEW.rowid;
END;

-- ============================================================================
-- 4. Add audit columns to mutes table
-- ============================================================================

-- mutes already has created_at, add updated_at
ALTER TABLE mutes ADD COLUMN updated_at TEXT DEFAULT (datetime('now'));

-- Create trigger to auto-update updated_at
CREATE TRIGGER IF NOT EXISTS trg_mutes_updated_at
AFTER UPDATE ON mutes
BEGIN
  UPDATE mutes SET updated_at = datetime('now') WHERE rowid = NEW.rowid;
END;

-- ============================================================================
-- 5. Add soft delete pattern for critical tables
-- ============================================================================

-- Add deleted_at column to actors table
ALTER TABLE actors ADD COLUMN deleted_at TEXT;
CREATE INDEX IF NOT EXISTS idx_actors_deleted ON actors(deleted_at);

-- Add deleted_at column to objects table
ALTER TABLE objects ADD COLUMN deleted_at TEXT;
CREATE INDEX IF NOT EXISTS idx_objects_deleted ON objects(deleted_at);

-- Add deleted_at column to communities table
ALTER TABLE communities ADD COLUMN deleted_at TEXT;
CREATE INDEX IF NOT EXISTS idx_communities_deleted ON communities(deleted_at);

-- ============================================================================
-- 6. Add triggers to prevent cascade delete on critical relationships
-- ============================================================================

-- Trigger to prevent hard delete of actors with objects
CREATE TRIGGER IF NOT EXISTS prevent_actor_hard_delete
BEFORE DELETE ON actors
BEGIN
  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM objects WHERE attributed_to = OLD.ap_id AND deleted_at IS NULL)
    THEN RAISE(ABORT, 'Cannot delete actor with active objects. Use soft delete instead.')
  END;
END;

-- Trigger to prevent hard delete of communities with members
CREATE TRIGGER IF NOT EXISTS prevent_community_hard_delete
BEFORE DELETE ON communities
BEGIN
  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM community_members WHERE community_ap_id = OLD.ap_id)
    THEN RAISE(ABORT, 'Cannot delete community with members. Remove members first or use soft delete.')
  END;
END;

-- ============================================================================
-- 7. Add indexes for follows table performance
-- ============================================================================

-- Composite index for checking accepted follows
CREATE INDEX IF NOT EXISTS idx_follows_accepted ON follows(following_ap_id, status) WHERE status = 'accepted';

-- Index for pending follow requests
CREATE INDEX IF NOT EXISTS idx_follows_pending ON follows(following_ap_id, created_at DESC) WHERE status = 'pending';

-- ============================================================================
-- 8. Add indexes for likes and announces performance
-- ============================================================================

-- Composite index for checking if user liked an object
CREATE INDEX IF NOT EXISTS idx_likes_check ON likes(actor_ap_id, object_ap_id);

-- Composite index for checking if user announced an object
CREATE INDEX IF NOT EXISTS idx_announces_check ON announces(actor_ap_id, object_ap_id);

-- ============================================================================
-- 9. Add indexes for activity queries
-- ============================================================================

-- Index for activities by type
CREATE INDEX IF NOT EXISTS idx_activities_type ON activities(type);

-- Composite index for unprocessed activities
CREATE INDEX IF NOT EXISTS idx_activities_unprocessed ON activities(direction, processed, created_at) WHERE processed = 0;
