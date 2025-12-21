-- Migration: 0004_add_media_files
-- Description: Add media_files table for fast media lookup

CREATE TABLE IF NOT EXISTS media_files (
  id TEXT PRIMARY KEY,
  r2_key TEXT NOT NULL,
  content_type TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_media_files_key ON media_files(r2_key);
