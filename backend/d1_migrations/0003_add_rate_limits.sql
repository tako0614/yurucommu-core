-- Migration: Add rate limiting support
-- Created: 2025-01-XX

-- Rate limiting table
CREATE TABLE IF NOT EXISTS ap_rate_limits (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL,                    -- Namespace + identifier (e.g., "inbox:instance:mastodon.social")
  window_start INTEGER NOT NULL,        -- Unix timestamp in milliseconds
  created_at INTEGER NOT NULL           -- Unix timestamp in milliseconds
);

-- Index for efficient rate limit lookups
CREATE INDEX IF NOT EXISTS idx_rate_limits_key_window
  ON ap_rate_limits(key, window_start);

-- Index for cleanup queries
CREATE INDEX IF NOT EXISTS idx_rate_limits_created
  ON ap_rate_limits(created_at);

-- Access tokens for authenticated actions
CREATE TABLE IF NOT EXISTS access_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TEXT,
  last_used_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_access_tokens_user_id
  ON access_tokens(user_id);

-- Chat tables
CREATE TABLE IF NOT EXISTS chat_dm_threads (
  id TEXT PRIMARY KEY,
  participants_hash TEXT NOT NULL UNIQUE,
  participants_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS chat_dm_messages (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL,
  author_id TEXT NOT NULL,
  content_html TEXT NOT NULL,
  raw_activity_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (thread_id) REFERENCES chat_dm_threads(id)
);

CREATE INDEX IF NOT EXISTS idx_chat_dm_messages_thread
  ON chat_dm_messages(thread_id, created_at);

CREATE TABLE IF NOT EXISTS chat_channel_messages (
  id TEXT PRIMARY KEY,
  community_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  author_id TEXT NOT NULL,
  content_html TEXT NOT NULL,
  raw_activity_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_chat_channel_messages
  ON chat_channel_messages(community_id, channel_id, created_at);