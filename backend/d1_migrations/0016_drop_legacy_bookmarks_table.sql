-- Migration: Drop legacy bookmarks table
-- The bookmarks table is now replaced by post_bookmarks
-- This migration removes the duplicate/legacy table

-- Drop the legacy bookmarks table (post_bookmarks is the canonical table)
DROP TABLE IF EXISTS bookmarks;
