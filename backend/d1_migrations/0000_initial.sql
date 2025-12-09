-- takos Core Schema v2.0
-- Minimal schema: actors, follows, objects, notifications, push_devices
-- All other features implemented in App layer

-- ============================================
-- Core: Actors (Users and other AP actors)
-- ============================================

CREATE TABLE IF NOT EXISTS actors (
  id TEXT PRIMARY KEY,
  handle TEXT UNIQUE NOT NULL,
  type TEXT NOT NULL DEFAULT 'Person',
  display_name TEXT,
  summary TEXT,
  avatar_url TEXT,
  header_url TEXT,
  inbox TEXT,
  outbox TEXT,
  followers TEXT,
  following TEXT,
  public_key_pem TEXT,
  private_key_pem TEXT,
  is_local INTEGER NOT NULL DEFAULT 1,
  is_bot INTEGER NOT NULL DEFAULT 0,
  manually_approves_followers INTEGER NOT NULL DEFAULT 0,
  discoverable INTEGER NOT NULL DEFAULT 1,
  metadata_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_actors_type ON actors(type);
CREATE INDEX IF NOT EXISTS idx_actors_is_local ON actors(is_local);

-- ============================================
-- Core: Follows
-- ============================================

CREATE TABLE IF NOT EXISTS follows (
  id TEXT PRIMARY KEY,
  follower_id TEXT NOT NULL,
  following_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  activity_id TEXT UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  accepted_at TEXT,
  FOREIGN KEY (follower_id) REFERENCES actors(id) ON DELETE CASCADE,
  FOREIGN KEY (following_id) REFERENCES actors(id) ON DELETE CASCADE,
  UNIQUE (follower_id, following_id)
);

CREATE INDEX IF NOT EXISTS idx_follows_follower ON follows(follower_id);
CREATE INDEX IF NOT EXISTS idx_follows_following ON follows(following_id);
CREATE INDEX IF NOT EXISTS idx_follows_status ON follows(status);

-- ============================================
-- Core: Objects (All ActivityPub objects)
-- ============================================

CREATE TABLE IF NOT EXISTS objects (
  id TEXT PRIMARY KEY,
  local_id TEXT UNIQUE,
  type TEXT NOT NULL,
  actor TEXT NOT NULL,
  published TEXT,
  updated TEXT,
  "to" TEXT,
  cc TEXT,
  bto TEXT,
  bcc TEXT,
  audience TEXT,
  context TEXT,
  in_reply_to TEXT,
  content TEXT NOT NULL,
  summary TEXT,
  sensitive INTEGER NOT NULL DEFAULT 0,
  is_local INTEGER NOT NULL DEFAULT 1,
  visibility TEXT NOT NULL DEFAULT 'public',
  deleted_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_objects_type ON objects(type);
CREATE INDEX IF NOT EXISTS idx_objects_actor ON objects(actor);
CREATE INDEX IF NOT EXISTS idx_objects_published ON objects(published DESC);
CREATE INDEX IF NOT EXISTS idx_objects_context ON objects(context);
CREATE INDEX IF NOT EXISTS idx_objects_in_reply_to ON objects(in_reply_to);
CREATE INDEX IF NOT EXISTS idx_objects_visibility ON objects(visibility);
CREATE INDEX IF NOT EXISTS idx_objects_is_local ON objects(is_local);
CREATE INDEX IF NOT EXISTS idx_objects_deleted_at ON objects(deleted_at);
CREATE INDEX IF NOT EXISTS idx_objects_visibility_published ON objects(visibility, published DESC);

-- ============================================
-- Core: Notifications
-- ============================================

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  recipient_id TEXT NOT NULL,
  type TEXT NOT NULL,
  actor_id TEXT,
  object_id TEXT,
  data_json TEXT,
  read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (recipient_id) REFERENCES actors(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_notifications_recipient ON notifications(recipient_id);
CREATE INDEX IF NOT EXISTS idx_notifications_recipient_read ON notifications(recipient_id, read);
CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications(created_at DESC);

-- ============================================
-- Core: Push Devices
-- ============================================

CREATE TABLE IF NOT EXISTS push_devices (
  id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL,
  token TEXT UNIQUE NOT NULL,
  platform TEXT NOT NULL,
  device_name TEXT NOT NULL DEFAULT '',
  locale TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (actor_id) REFERENCES actors(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_push_devices_actor ON push_devices(actor_id);

-- ============================================
-- Core: Sessions
-- ============================================

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT,
  FOREIGN KEY (actor_id) REFERENCES actors(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sessions_actor ON sessions(actor_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

-- ============================================
-- Core: Owner Password
-- ============================================

CREATE TABLE IF NOT EXISTS owner_password (
  id INTEGER PRIMARY KEY DEFAULT 1,
  password_hash TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============================================
-- ActivityPub: Delivery Queue
-- ============================================

CREATE TABLE IF NOT EXISTS ap_delivery_queue (
  id TEXT PRIMARY KEY,
  activity_json TEXT NOT NULL,
  target_inbox TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  status TEXT NOT NULL DEFAULT 'pending',
  last_attempt_at TEXT,
  next_attempt_at TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_ap_delivery_status ON ap_delivery_queue(status);
CREATE INDEX IF NOT EXISTS idx_ap_delivery_next ON ap_delivery_queue(next_attempt_at);

-- ============================================
-- ActivityPub: Instance metadata
-- ============================================

CREATE TABLE IF NOT EXISTS ap_instances (
  domain TEXT PRIMARY KEY,
  software TEXT,
  version TEXT,
  last_checked_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============================================
-- ActivityPub: Rate limiting
-- ============================================

CREATE TABLE IF NOT EXISTS ap_rate_limits (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ap_rate_limits_key ON ap_rate_limits(key, window_start);
