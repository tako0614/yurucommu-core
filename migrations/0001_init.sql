-- Yurucommu Initial Schema (consolidated from Prisma schema)
-- Generated 2026-03-07

-- ============================================================
-- ACTORS (Local accounts - Person type)
-- ============================================================
CREATE TABLE IF NOT EXISTS actors (
  ap_id TEXT PRIMARY KEY,
  type TEXT NOT NULL DEFAULT 'Person',
  preferred_username TEXT NOT NULL UNIQUE,
  name TEXT,
  summary TEXT,
  icon_url TEXT,
  header_url TEXT,
  inbox TEXT NOT NULL,
  outbox TEXT NOT NULL,
  followers_url TEXT NOT NULL,
  following_url TEXT NOT NULL,
  public_key_pem TEXT NOT NULL,
  private_key_pem TEXT NOT NULL,
  takos_user_id TEXT UNIQUE,
  follower_count INTEGER DEFAULT 0,
  following_count INTEGER DEFAULT 0,
  post_count INTEGER DEFAULT 0,
  is_private INTEGER DEFAULT 0,
  role TEXT DEFAULT 'member',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  deleted_at TEXT,
  owner_actor_ap_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_actors_preferred_username ON actors(preferred_username);
CREATE INDEX IF NOT EXISTS idx_actors_takos_user_id ON actors(takos_user_id);
CREATE INDEX IF NOT EXISTS idx_actors_deleted_at ON actors(deleted_at);

-- ============================================================
-- ACTOR_CACHE (Remote actors - cached from federation)
-- ============================================================
CREATE TABLE IF NOT EXISTS actor_cache (
  ap_id TEXT PRIMARY KEY,
  type TEXT NOT NULL DEFAULT 'Person',
  preferred_username TEXT,
  name TEXT,
  summary TEXT,
  icon_url TEXT,
  inbox TEXT NOT NULL,
  outbox TEXT,
  followers_url TEXT,
  following_url TEXT,
  shared_inbox TEXT,
  public_key_id TEXT,
  public_key_pem TEXT,
  raw_json TEXT NOT NULL,
  last_fetched_at TEXT DEFAULT (datetime('now')),
  created_at TEXT DEFAULT (datetime('now'))
);

-- ============================================================
-- COMMUNITIES (must be before objects due to FK reference)
-- ============================================================
CREATE TABLE IF NOT EXISTS communities (
  ap_id TEXT PRIMARY KEY,
  type TEXT NOT NULL DEFAULT 'Group',
  preferred_username TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  summary TEXT,
  icon_url TEXT,
  inbox TEXT NOT NULL,
  outbox TEXT NOT NULL,
  followers_url TEXT NOT NULL,
  visibility TEXT DEFAULT 'public',
  join_policy TEXT DEFAULT 'open',
  post_policy TEXT DEFAULT 'members',
  public_key_pem TEXT NOT NULL,
  private_key_pem TEXT NOT NULL,
  created_by TEXT NOT NULL,
  member_count INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  last_message_at TEXT,
  deleted_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_communities_deleted_at ON communities(deleted_at);
CREATE INDEX IF NOT EXISTS idx_communities_visibility ON communities(visibility);

-- ============================================================
-- OBJECTS (All AP objects - Note, Article, etc.)
-- ============================================================
CREATE TABLE IF NOT EXISTS objects (
  ap_id TEXT PRIMARY KEY,
  type TEXT NOT NULL DEFAULT 'Note',
  attributed_to TEXT NOT NULL REFERENCES actors(ap_id) ON DELETE CASCADE,
  content TEXT NOT NULL DEFAULT '',
  summary TEXT,
  attachments_json TEXT DEFAULT '[]',
  in_reply_to TEXT,
  conversation TEXT,
  visibility TEXT DEFAULT 'public',
  to_json TEXT DEFAULT '[]',
  cc_json TEXT DEFAULT '[]',
  audience_json TEXT DEFAULT '[]',
  community_ap_id TEXT REFERENCES communities(ap_id) ON DELETE SET NULL,
  end_time TEXT,
  like_count INTEGER DEFAULT 0,
  reply_count INTEGER DEFAULT 0,
  announce_count INTEGER DEFAULT 0,
  share_count INTEGER DEFAULT 0,
  published TEXT DEFAULT (datetime('now')),
  updated TEXT,
  is_local INTEGER DEFAULT 1,
  raw_json TEXT,
  deleted_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_objects_attributed_to ON objects(attributed_to);
CREATE INDEX IF NOT EXISTS idx_objects_in_reply_to ON objects(in_reply_to);
CREATE INDEX IF NOT EXISTS idx_objects_community_ap_id ON objects(community_ap_id);
CREATE INDEX IF NOT EXISTS idx_objects_published ON objects(published DESC);
CREATE INDEX IF NOT EXISTS idx_objects_visibility ON objects(visibility);
CREATE INDEX IF NOT EXISTS idx_objects_end_time ON objects(end_time);
CREATE INDEX IF NOT EXISTS idx_objects_deleted_at ON objects(deleted_at);
CREATE INDEX IF NOT EXISTS idx_objects_attributed_to_published ON objects(attributed_to, published DESC);
CREATE INDEX IF NOT EXISTS idx_objects_visibility_published ON objects(visibility, published DESC);
CREATE INDEX IF NOT EXISTS idx_objects_type_visibility_published ON objects(type, visibility, published DESC);
CREATE INDEX IF NOT EXISTS idx_objects_conversation ON objects(conversation);
CREATE INDEX IF NOT EXISTS idx_objects_community_published ON objects(community_ap_id, published DESC);
CREATE INDEX IF NOT EXISTS idx_objects_is_local ON objects(is_local);

-- ============================================================
-- FOLLOWS
-- ============================================================
CREATE TABLE IF NOT EXISTS follows (
  follower_ap_id TEXT NOT NULL REFERENCES actors(ap_id) ON DELETE CASCADE,
  following_ap_id TEXT NOT NULL REFERENCES actors(ap_id) ON DELETE CASCADE,
  status TEXT DEFAULT 'pending',
  activity_ap_id TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  accepted_at TEXT,
  PRIMARY KEY (follower_ap_id, following_ap_id)
);

CREATE INDEX IF NOT EXISTS idx_follows_follower_status ON follows(follower_ap_id, status);
CREATE INDEX IF NOT EXISTS idx_follows_following_status ON follows(following_ap_id, status);
CREATE INDEX IF NOT EXISTS idx_follows_following_created ON follows(following_ap_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_follows_activity ON follows(activity_ap_id);

-- ============================================================
-- LIKES
-- ============================================================
CREATE TABLE IF NOT EXISTS likes (
  actor_ap_id TEXT NOT NULL REFERENCES actors(ap_id) ON DELETE CASCADE,
  object_ap_id TEXT NOT NULL REFERENCES objects(ap_id) ON DELETE CASCADE,
  activity_ap_id TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (actor_ap_id, object_ap_id)
);

CREATE INDEX IF NOT EXISTS idx_likes_object ON likes(object_ap_id);
CREATE INDEX IF NOT EXISTS idx_likes_actor ON likes(actor_ap_id);
CREATE INDEX IF NOT EXISTS idx_likes_actor_object ON likes(actor_ap_id, object_ap_id);

-- ============================================================
-- ANNOUNCES (Reposts/Boosts)
-- ============================================================
CREATE TABLE IF NOT EXISTS announces (
  actor_ap_id TEXT NOT NULL REFERENCES actors(ap_id) ON DELETE CASCADE,
  object_ap_id TEXT NOT NULL REFERENCES objects(ap_id) ON DELETE CASCADE,
  activity_ap_id TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (actor_ap_id, object_ap_id)
);

CREATE INDEX IF NOT EXISTS idx_announces_object ON announces(object_ap_id);
CREATE INDEX IF NOT EXISTS idx_announces_actor ON announces(actor_ap_id);
CREATE INDEX IF NOT EXISTS idx_announces_actor_object ON announces(actor_ap_id, object_ap_id);

-- ============================================================
-- BOOKMARKS
-- ============================================================
CREATE TABLE IF NOT EXISTS bookmarks (
  actor_ap_id TEXT NOT NULL REFERENCES actors(ap_id) ON DELETE CASCADE,
  object_ap_id TEXT NOT NULL REFERENCES objects(ap_id) ON DELETE CASCADE,
  created_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (actor_ap_id, object_ap_id)
);

CREATE INDEX IF NOT EXISTS idx_bookmarks_actor ON bookmarks(actor_ap_id);

-- ============================================================
-- BLOCKS
-- ============================================================
CREATE TABLE IF NOT EXISTS blocks (
  blocker_ap_id TEXT NOT NULL REFERENCES actors(ap_id) ON DELETE CASCADE,
  blocked_ap_id TEXT NOT NULL REFERENCES actors(ap_id) ON DELETE CASCADE,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (blocker_ap_id, blocked_ap_id)
);

CREATE INDEX IF NOT EXISTS idx_blocks_blocker ON blocks(blocker_ap_id);
CREATE INDEX IF NOT EXISTS idx_blocks_blocked ON blocks(blocked_ap_id);

-- ============================================================
-- MUTES
-- ============================================================
CREATE TABLE IF NOT EXISTS mutes (
  muter_ap_id TEXT NOT NULL REFERENCES actors(ap_id) ON DELETE CASCADE,
  muted_ap_id TEXT NOT NULL REFERENCES actors(ap_id) ON DELETE CASCADE,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (muter_ap_id, muted_ap_id)
);

CREATE INDEX IF NOT EXISTS idx_mutes_muter ON mutes(muter_ap_id);
CREATE INDEX IF NOT EXISTS idx_mutes_muted ON mutes(muted_ap_id);

-- ============================================================
-- ACTIVITIES
-- ============================================================
CREATE TABLE IF NOT EXISTS activities (
  ap_id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  actor_ap_id TEXT NOT NULL REFERENCES actors(ap_id) ON DELETE CASCADE,
  object_ap_id TEXT REFERENCES objects(ap_id) ON DELETE SET NULL,
  object_json TEXT,
  target_ap_id TEXT,
  raw_json TEXT NOT NULL,
  direction TEXT,
  processed INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_activities_actor ON activities(actor_ap_id);
CREATE INDEX IF NOT EXISTS idx_activities_object ON activities(object_ap_id);
CREATE INDEX IF NOT EXISTS idx_activities_type ON activities(type);
CREATE INDEX IF NOT EXISTS idx_activities_type_created ON activities(type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activities_direction_processed ON activities(direction, processed);
CREATE INDEX IF NOT EXISTS idx_activities_direction_processed_created ON activities(direction, processed, created_at);

-- ============================================================
-- DELIVERY_QUEUE
-- ============================================================
CREATE TABLE IF NOT EXISTS delivery_queue (
  id TEXT PRIMARY KEY,
  activity_ap_id TEXT NOT NULL,
  inbox_url TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  attempts INTEGER DEFAULT 0,
  last_attempt_at TEXT,
  processing_started_at TEXT,
  next_attempt_at TEXT DEFAULT (datetime('now')),
  delivered_at TEXT,
  error TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_delivery_queue_activity ON delivery_queue(activity_ap_id);
CREATE INDEX IF NOT EXISTS idx_delivery_queue_next ON delivery_queue(next_attempt_at);
CREATE INDEX IF NOT EXISTS idx_delivery_queue_status_next ON delivery_queue(status, next_attempt_at);

-- ============================================================
-- DELIVERY_CIRCUIT (Circuit breaker state per endpoint)
-- ============================================================
CREATE TABLE IF NOT EXISTS delivery_circuit (
  endpoint TEXT PRIMARY KEY,
  state TEXT DEFAULT 'closed',
  consecutive_failures INTEGER DEFAULT 0,
  recent_outcomes_json TEXT DEFAULT '[]',
  open_until TEXT,
  half_open_probe_attempts INTEGER DEFAULT 0,
  half_open_probe_successes INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_delivery_circuit_state ON delivery_circuit(state, updated_at);

-- ============================================================
-- COMMUNITY_MEMBERS
-- ============================================================
CREATE TABLE IF NOT EXISTS community_members (
  community_ap_id TEXT NOT NULL REFERENCES communities(ap_id) ON DELETE CASCADE,
  actor_ap_id TEXT NOT NULL REFERENCES actors(ap_id) ON DELETE CASCADE,
  role TEXT DEFAULT 'member',
  joined_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (community_ap_id, actor_ap_id)
);

CREATE INDEX IF NOT EXISTS idx_community_members_actor ON community_members(actor_ap_id);
CREATE INDEX IF NOT EXISTS idx_community_members_role ON community_members(community_ap_id, role, joined_at);

-- ============================================================
-- COMMUNITY_JOIN_REQUESTS
-- ============================================================
CREATE TABLE IF NOT EXISTS community_join_requests (
  community_ap_id TEXT NOT NULL REFERENCES communities(ap_id) ON DELETE CASCADE,
  actor_ap_id TEXT NOT NULL REFERENCES actors(ap_id) ON DELETE CASCADE,
  status TEXT DEFAULT 'pending',
  created_at TEXT DEFAULT (datetime('now')),
  processed_at TEXT,
  PRIMARY KEY (community_ap_id, actor_ap_id)
);

CREATE INDEX IF NOT EXISTS idx_community_join_requests_status ON community_join_requests(community_ap_id, status);
CREATE INDEX IF NOT EXISTS idx_community_join_requests_actor ON community_join_requests(actor_ap_id);

-- ============================================================
-- COMMUNITY_INVITES
-- ============================================================
CREATE TABLE IF NOT EXISTS community_invites (
  id TEXT PRIMARY KEY,
  community_ap_id TEXT NOT NULL REFERENCES communities(ap_id) ON DELETE CASCADE,
  invited_by_ap_id TEXT NOT NULL REFERENCES actors(ap_id) ON DELETE CASCADE,
  invited_ap_id TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  expires_at TEXT,
  used_at TEXT,
  used_by_ap_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_community_invites_community ON community_invites(community_ap_id);
CREATE INDEX IF NOT EXISTS idx_community_invites_invited_by ON community_invites(invited_by_ap_id);

-- ============================================================
-- OBJECT_RECIPIENTS
-- ============================================================
CREATE TABLE IF NOT EXISTS object_recipients (
  object_ap_id TEXT NOT NULL REFERENCES objects(ap_id) ON DELETE CASCADE,
  recipient_ap_id TEXT NOT NULL REFERENCES actors(ap_id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (object_ap_id, recipient_ap_id)
);

CREATE INDEX IF NOT EXISTS idx_object_recipients_recipient ON object_recipients(recipient_ap_id, created_at DESC);

-- ============================================================
-- INBOX
-- ============================================================
CREATE TABLE IF NOT EXISTS inbox (
  actor_ap_id TEXT NOT NULL REFERENCES actors(ap_id) ON DELETE CASCADE,
  activity_ap_id TEXT NOT NULL REFERENCES activities(ap_id) ON DELETE CASCADE,
  read INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (actor_ap_id, activity_ap_id)
);

CREATE INDEX IF NOT EXISTS idx_inbox_actor_read ON inbox(actor_ap_id, read, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inbox_activity ON inbox(activity_ap_id);

-- ============================================================
-- SESSIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES actors(ap_id) ON DELETE CASCADE,
  access_token TEXT NOT NULL UNIQUE,
  refresh_token TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  provider TEXT,
  provider_access_token TEXT,
  provider_refresh_token TEXT,
  provider_token_expires_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_sessions_member ON sessions(member_id);
CREATE INDEX IF NOT EXISTS idx_sessions_provider ON sessions(provider);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

-- ============================================================
-- STORY_VIEWS
-- ============================================================
CREATE TABLE IF NOT EXISTS story_views (
  actor_ap_id TEXT NOT NULL REFERENCES actors(ap_id) ON DELETE CASCADE,
  story_ap_id TEXT NOT NULL REFERENCES objects(ap_id) ON DELETE CASCADE,
  viewed_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (actor_ap_id, story_ap_id)
);

CREATE INDEX IF NOT EXISTS idx_story_views_actor ON story_views(actor_ap_id);
CREATE INDEX IF NOT EXISTS idx_story_views_story ON story_views(story_ap_id);

-- ============================================================
-- STORY_VOTES
-- ============================================================
CREATE TABLE IF NOT EXISTS story_votes (
  id TEXT PRIMARY KEY,
  story_ap_id TEXT NOT NULL REFERENCES objects(ap_id) ON DELETE CASCADE,
  actor_ap_id TEXT NOT NULL REFERENCES actors(ap_id) ON DELETE CASCADE,
  option_index INTEGER NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(story_ap_id, actor_ap_id)
);

CREATE INDEX IF NOT EXISTS idx_story_votes_story ON story_votes(story_ap_id);
CREATE INDEX IF NOT EXISTS idx_story_votes_actor ON story_votes(actor_ap_id);

-- ============================================================
-- STORY_SHARES
-- ============================================================
CREATE TABLE IF NOT EXISTS story_shares (
  id TEXT PRIMARY KEY,
  story_ap_id TEXT NOT NULL REFERENCES objects(ap_id) ON DELETE CASCADE,
  actor_ap_id TEXT NOT NULL REFERENCES actors(ap_id) ON DELETE CASCADE,
  shared_at TEXT DEFAULT (datetime('now')),
  UNIQUE(story_ap_id, actor_ap_id)
);

CREATE INDEX IF NOT EXISTS idx_story_shares_story ON story_shares(story_ap_id);
CREATE INDEX IF NOT EXISTS idx_story_shares_actor ON story_shares(actor_ap_id);

-- ============================================================
-- NOTIFICATION_ARCHIVED
-- ============================================================
CREATE TABLE IF NOT EXISTS notification_archived (
  actor_ap_id TEXT NOT NULL,
  activity_ap_id TEXT NOT NULL,
  archived_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (actor_ap_id, activity_ap_id)
);

CREATE INDEX IF NOT EXISTS idx_notification_archived_actor ON notification_archived(actor_ap_id);
CREATE INDEX IF NOT EXISTS idx_notification_archived_actor_at ON notification_archived(actor_ap_id, archived_at);

-- ============================================================
-- INSTANCE_ACTOR
-- ============================================================
CREATE TABLE IF NOT EXISTS instance_actor (
  ap_id TEXT PRIMARY KEY,
  preferred_username TEXT NOT NULL,
  name TEXT,
  summary TEXT,
  public_key_pem TEXT NOT NULL,
  private_key_pem TEXT NOT NULL,
  join_policy TEXT DEFAULT 'open',
  posting_policy TEXT DEFAULT 'members',
  visibility TEXT DEFAULT 'public',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- ============================================================
-- DM_TYPING
-- ============================================================
CREATE TABLE IF NOT EXISTS dm_typing (
  actor_ap_id TEXT NOT NULL,
  recipient_ap_id TEXT NOT NULL,
  last_typed_at TEXT NOT NULL,
  PRIMARY KEY (actor_ap_id, recipient_ap_id)
);

CREATE INDEX IF NOT EXISTS idx_dm_typing_recipient ON dm_typing(recipient_ap_id, last_typed_at DESC);

-- ============================================================
-- DM_READ_STATUS
-- ============================================================
CREATE TABLE IF NOT EXISTS dm_read_status (
  actor_ap_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  last_read_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (actor_ap_id, conversation_id)
);

CREATE INDEX IF NOT EXISTS idx_dm_read_status_actor ON dm_read_status(actor_ap_id);
CREATE INDEX IF NOT EXISTS idx_dm_read_status_actor_at ON dm_read_status(actor_ap_id, last_read_at DESC);

-- ============================================================
-- DM_ARCHIVED_CONVERSATIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS dm_archived_conversations (
  actor_ap_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  archived_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (actor_ap_id, conversation_id)
);

CREATE INDEX IF NOT EXISTS idx_dm_archived_actor ON dm_archived_conversations(actor_ap_id);

-- ============================================================
-- MEDIA_UPLOADS
-- ============================================================
CREATE TABLE IF NOT EXISTS media_uploads (
  id TEXT PRIMARY KEY,
  r2_key TEXT NOT NULL UNIQUE,
  uploader_ap_id TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_media_uploads_uploader ON media_uploads(uploader_ap_id);
CREATE INDEX IF NOT EXISTS idx_media_uploads_r2_key ON media_uploads(r2_key);
