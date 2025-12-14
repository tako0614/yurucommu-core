-- takos Core Schema v2.1
-- User/Actor integration: move user auth/profile fields onto actors and add missing core tables.

-- ============================================
-- actors: add missing columns
-- ============================================

ALTER TABLE actors ADD COLUMN local_id TEXT;
ALTER TABLE actors ADD COLUMN owner_id TEXT;
ALTER TABLE actors ADD COLUMN visibility TEXT;
ALTER TABLE actors ADD COLUMN profile_completed_at TEXT;
ALTER TABLE actors ADD COLUMN jwt_secret TEXT;
ALTER TABLE actors ADD COLUMN password_hash TEXT;

-- Backfill local_id for existing rows (legacy "user id" == handle)
UPDATE actors
SET local_id = COALESCE(local_id, handle)
WHERE local_id IS NULL OR local_id = '';

CREATE UNIQUE INDEX IF NOT EXISTS idx_actors_local_id ON actors(local_id);
CREATE INDEX IF NOT EXISTS idx_actors_owner_id ON actors(owner_id);

-- If an instance already has an owner_password hash, mirror it to local actors that do not yet have a password_hash.
UPDATE actors
SET password_hash = (SELECT password_hash FROM owner_password WHERE id = 1)
WHERE is_local = 1 AND (password_hash IS NULL OR password_hash = '')
  AND EXISTS (SELECT 1 FROM owner_password WHERE id = 1);

-- ============================================
-- notifications: add missing columns used by the API layer
-- ============================================

ALTER TABLE notifications ADD COLUMN ref_type TEXT;
ALTER TABLE notifications ADD COLUMN ref_id TEXT;
ALTER TABLE notifications ADD COLUMN message TEXT NOT NULL DEFAULT '';

-- ============================================
-- object_recipients
-- ============================================

CREATE TABLE IF NOT EXISTS object_recipients (
  id TEXT PRIMARY KEY,
  object_id TEXT NOT NULL,
  recipient TEXT NOT NULL,
  recipient_type TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_object_recipients_unique
  ON object_recipients(object_id, recipient, recipient_type);
CREATE INDEX IF NOT EXISTS idx_object_recipients_object ON object_recipients(object_id);
CREATE INDEX IF NOT EXISTS idx_object_recipients_recipient ON object_recipients(recipient);

-- ============================================
-- blocks / mutes (legacy compat)
-- ============================================

CREATE TABLE IF NOT EXISTS blocks (
  blocker_id TEXT NOT NULL,
  blocked_id TEXT NOT NULL,
  PRIMARY KEY (blocker_id, blocked_id)
);

CREATE INDEX IF NOT EXISTS idx_blocks_blocker_id ON blocks(blocker_id);
CREATE INDEX IF NOT EXISTS idx_blocks_blocked_id ON blocks(blocked_id);

CREATE TABLE IF NOT EXISTS mutes (
  muter_id TEXT NOT NULL,
  muted_id TEXT NOT NULL,
  PRIMARY KEY (muter_id, muted_id)
);

CREATE INDEX IF NOT EXISTS idx_mutes_muter_id ON mutes(muter_id);
CREATE INDEX IF NOT EXISTS idx_mutes_muted_id ON mutes(muted_id);

-- ============================================
-- media
-- ============================================

CREATE TABLE IF NOT EXISTS media (
  key TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL,
  url TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  content_type TEXT NOT NULL DEFAULT '',
  ref_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_media_actor_id ON media(actor_id);
CREATE INDEX IF NOT EXISTS idx_media_url ON media(url);

-- ============================================
-- user_accounts
-- ============================================

CREATE TABLE IF NOT EXISTS user_accounts (
  id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  provider_account_id TEXT NOT NULL,
  password_hash TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_accounts_provider_key
  ON user_accounts(provider, provider_account_id);
CREATE INDEX IF NOT EXISTS idx_user_accounts_actor_id ON user_accounts(actor_id);

