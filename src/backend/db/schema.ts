export const SCHEMA = `
-- Local user (single user per tenant)
CREATE TABLE IF NOT EXISTS local_users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  avatar_url TEXT,
  header_url TEXT,
  public_key TEXT NOT NULL,
  private_key TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Sessions
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES local_users(id),
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);

-- Used JTIs (for replay protection)
CREATE TABLE IF NOT EXISTS used_jtis (
  jti TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_used_jtis_expires_at ON used_jtis(expires_at);

-- Posts
CREATE TABLE IF NOT EXISTS posts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES local_users(id),
  content TEXT NOT NULL,
  content_warning TEXT,
  visibility TEXT NOT NULL DEFAULT 'public' CHECK(visibility IN ('public', 'unlisted', 'followers', 'direct')),
  in_reply_to_id TEXT,
  in_reply_to_actor TEXT,
  published_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_posts_user_id ON posts(user_id);
CREATE INDEX IF NOT EXISTS idx_posts_published_at ON posts(published_at);
CREATE INDEX IF NOT EXISTS idx_posts_visibility ON posts(visibility);

-- Remote actors (cached)
CREATE TABLE IF NOT EXISTS remote_actors (
  id TEXT PRIMARY KEY,
  actor_url TEXT UNIQUE NOT NULL,
  inbox TEXT NOT NULL,
  shared_inbox TEXT,
  public_key TEXT NOT NULL,
  actor_json TEXT NOT NULL,
  fetched_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_remote_actors_actor_url ON remote_actors(actor_url);

-- Follows (both local->remote and remote->local)
CREATE TABLE IF NOT EXISTS follows (
  id TEXT PRIMARY KEY,
  follower_actor TEXT NOT NULL,
  following_actor TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'accepted', 'rejected')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(follower_actor, following_actor)
);

CREATE INDEX IF NOT EXISTS idx_follows_follower ON follows(follower_actor);
CREATE INDEX IF NOT EXISTS idx_follows_following ON follows(following_actor);
CREATE INDEX IF NOT EXISTS idx_follows_status ON follows(status);

-- Inbox queue (for async processing)
CREATE TABLE IF NOT EXISTS inbox_queue (
  id TEXT PRIMARY KEY,
  activity_type TEXT NOT NULL,
  actor_url TEXT NOT NULL,
  activity_json TEXT NOT NULL,
  received_at TEXT NOT NULL DEFAULT (datetime('now')),
  processed_at TEXT,
  error TEXT,
  signature_verified INTEGER NOT NULL DEFAULT 0,
  signature_error TEXT
);

CREATE INDEX IF NOT EXISTS idx_inbox_queue_processed ON inbox_queue(processed_at);
CREATE INDEX IF NOT EXISTS idx_inbox_queue_received ON inbox_queue(received_at);
CREATE INDEX IF NOT EXISTS idx_inbox_queue_signature ON inbox_queue(signature_verified);

-- Outbox queue (for delivery)
CREATE TABLE IF NOT EXISTS outbox_queue (
  id TEXT PRIMARY KEY,
  activity_json TEXT NOT NULL,
  target_inbox TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_attempt_at TEXT,
  next_attempt_at TEXT,
  completed_at TEXT,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_outbox_queue_next_attempt ON outbox_queue(next_attempt_at);
CREATE INDEX IF NOT EXISTS idx_outbox_queue_completed ON outbox_queue(completed_at);

-- Likes
CREATE TABLE IF NOT EXISTS likes (
  id TEXT PRIMARY KEY,
  actor_url TEXT NOT NULL,
  object_url TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(actor_url, object_url)
);

CREATE INDEX IF NOT EXISTS idx_likes_object ON likes(object_url);

-- Announces (boosts/reblogs)
CREATE TABLE IF NOT EXISTS announces (
  id TEXT PRIMARY KEY,
  actor_url TEXT NOT NULL,
  object_url TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(actor_url, object_url)
);

CREATE INDEX IF NOT EXISTS idx_announces_object ON announces(object_url);

-- Notifications
CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK(type IN ('follow', 'like', 'announce', 'mention', 'reply')),
  actor_url TEXT NOT NULL,
  object_url TEXT,
  read_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications(read_at);
CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications(created_at);

-- Tenant configuration (L1)
CREATE TABLE IF NOT EXISTS tenant_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Media file lookup
CREATE TABLE IF NOT EXISTS media_files (
  id TEXT PRIMARY KEY,
  r2_key TEXT NOT NULL,
  content_type TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_media_files_key ON media_files(r2_key);
`;
