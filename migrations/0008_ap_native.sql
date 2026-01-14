-- Yurucommu v6.0 - Complete AP-Native Refactor
-- WARNING: This migration drops all existing data and recreates with AP-native schema

-- Drop all existing tables
DROP TABLE IF EXISTS ap_activities;
DROP TABLE IF EXISTS ap_delivery_queue;
DROP TABLE IF EXISTS ap_followers;
DROP TABLE IF EXISTS ap_remote_actors;
DROP TABLE IF EXISTS ap_actor_keys;
DROP TABLE IF EXISTS ap_bans;
DROP TABLE IF EXISTS ap_invites;
DROP TABLE IF EXISTS attachments;
DROP TABLE IF EXISTS blocks;
DROP TABLE IF EXISTS bookmarks;
DROP TABLE IF EXISTS communities;
DROP TABLE IF EXISTS dm_conversations;
DROP TABLE IF EXISTS dm_messages;
DROP TABLE IF EXISTS follows;
DROP TABLE IF EXISTS likes;
DROP TABLE IF EXISTS local_followers;
DROP TABLE IF EXISTS members;
DROP TABLE IF EXISTS messages;
DROP TABLE IF EXISTS mutes;
DROP TABLE IF EXISTS notifications;
DROP TABLE IF EXISTS post_attachments;
DROP TABLE IF EXISTS posts;
DROP TABLE IF EXISTS remote_follows;
DROP TABLE IF EXISTS remote_posts;
DROP TABLE IF EXISTS reposts;
DROP TABLE IF EXISTS rooms;
DROP TABLE IF EXISTS thread_replies;
DROP TABLE IF EXISTS threads;
DROP TABLE IF EXISTS user_keys;

-- Keep sessions table for auth
-- DROP TABLE IF EXISTS sessions;

-- ============================================================
-- ACTORS (Local accounts - Person type)
-- ============================================================
CREATE TABLE actors (
  -- AP IRI as primary key: https://domain/ap/users/username
  ap_id TEXT PRIMARY KEY,
  type TEXT NOT NULL DEFAULT 'Person',

  -- Core AP fields
  preferred_username TEXT NOT NULL UNIQUE,
  name TEXT,  -- display name
  summary TEXT,  -- bio

  -- Profile images
  icon_url TEXT,
  header_url TEXT,

  -- AP endpoints (derived from ap_id but stored for convenience)
  inbox TEXT NOT NULL,
  outbox TEXT NOT NULL,
  followers_url TEXT NOT NULL,
  following_url TEXT NOT NULL,

  -- Crypto keys for signing
  public_key_pem TEXT NOT NULL,
  private_key_pem TEXT NOT NULL,

  -- Local account link (for authentication)
  takos_user_id TEXT UNIQUE,

  -- Stats (denormalized for performance)
  follower_count INTEGER DEFAULT 0,
  following_count INTEGER DEFAULT 0,
  post_count INTEGER DEFAULT 0,

  -- Settings
  is_private INTEGER DEFAULT 0,  -- requires follow approval

  -- Role for this instance
  role TEXT DEFAULT 'member' CHECK (role IN ('owner', 'moderator', 'member')),

  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_actors_username ON actors(preferred_username);
CREATE INDEX idx_actors_takos ON actors(takos_user_id);

-- ============================================================
-- ACTOR_CACHE (Remote actors - cached from federation)
-- ============================================================
CREATE TABLE actor_cache (
  -- AP IRI as primary key: https://remote.example/users/bob
  ap_id TEXT PRIMARY KEY,
  type TEXT NOT NULL DEFAULT 'Person',

  -- Core AP fields
  preferred_username TEXT,
  name TEXT,
  summary TEXT,

  -- Profile images
  icon_url TEXT,

  -- AP endpoints
  inbox TEXT NOT NULL,
  outbox TEXT,
  followers_url TEXT,
  following_url TEXT,
  shared_inbox TEXT,

  -- Public key for signature verification
  public_key_id TEXT,
  public_key_pem TEXT,

  -- Cache metadata
  raw_json TEXT NOT NULL,
  last_fetched_at TEXT DEFAULT (datetime('now')),
  created_at TEXT DEFAULT (datetime('now'))
);

-- ============================================================
-- OBJECTS (All AP objects - Note, Article, etc.)
-- ============================================================
CREATE TABLE objects (
  -- AP IRI as primary key: https://domain/ap/posts/abc123
  ap_id TEXT PRIMARY KEY,
  type TEXT NOT NULL DEFAULT 'Note',

  -- Author (AP IRI - either local actor or cached remote)
  attributed_to TEXT NOT NULL,

  -- Content
  content TEXT NOT NULL DEFAULT '',
  summary TEXT,  -- content warning

  -- Media attachments as JSON array
  attachments_json TEXT DEFAULT '[]',

  -- Threading
  in_reply_to TEXT,  -- AP IRI of parent object
  conversation TEXT,  -- Thread context ID

  -- Visibility (AP addressing)
  visibility TEXT DEFAULT 'public' CHECK (visibility IN ('public', 'unlisted', 'followers', 'direct')),
  to_json TEXT DEFAULT '[]',  -- AP to field
  cc_json TEXT DEFAULT '[]',  -- AP cc field

  -- Community (for Group posts)
  community_ap_id TEXT,  -- AP IRI of Group

  -- Stats (denormalized)
  like_count INTEGER DEFAULT 0,
  reply_count INTEGER DEFAULT 0,
  announce_count INTEGER DEFAULT 0,

  -- Timestamps
  published TEXT DEFAULT (datetime('now')),
  updated TEXT,

  -- Is this a local or remote object?
  is_local INTEGER DEFAULT 1,

  -- Raw AP JSON for remote objects
  raw_json TEXT
);

CREATE INDEX idx_objects_author ON objects(attributed_to);
CREATE INDEX idx_objects_reply ON objects(in_reply_to);
CREATE INDEX idx_objects_community ON objects(community_ap_id);
CREATE INDEX idx_objects_published ON objects(published DESC);
CREATE INDEX idx_objects_visibility ON objects(visibility);

-- ============================================================
-- FOLLOWS (Unified - all follow relationships)
-- ============================================================
CREATE TABLE follows (
  -- Both are AP IRIs
  follower_ap_id TEXT NOT NULL,
  following_ap_id TEXT NOT NULL,

  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected')),

  -- Activity reference
  activity_ap_id TEXT,

  created_at TEXT DEFAULT (datetime('now')),
  accepted_at TEXT,

  PRIMARY KEY (follower_ap_id, following_ap_id)
);

CREATE INDEX idx_follows_follower ON follows(follower_ap_id, status);
CREATE INDEX idx_follows_following ON follows(following_ap_id, status);

-- ============================================================
-- LIKES
-- ============================================================
CREATE TABLE likes (
  -- Actor who liked (AP IRI)
  actor_ap_id TEXT NOT NULL,
  -- Object that was liked (AP IRI)
  object_ap_id TEXT NOT NULL,

  -- Activity reference
  activity_ap_id TEXT,

  created_at TEXT DEFAULT (datetime('now')),

  PRIMARY KEY (actor_ap_id, object_ap_id)
);

CREATE INDEX idx_likes_object ON likes(object_ap_id);
CREATE INDEX idx_likes_actor ON likes(actor_ap_id);

-- ============================================================
-- ANNOUNCES (Reposts/Boosts)
-- ============================================================
CREATE TABLE announces (
  -- Actor who announced (AP IRI)
  actor_ap_id TEXT NOT NULL,
  -- Object that was announced (AP IRI)
  object_ap_id TEXT NOT NULL,

  -- Activity reference
  activity_ap_id TEXT,

  created_at TEXT DEFAULT (datetime('now')),

  PRIMARY KEY (actor_ap_id, object_ap_id)
);

CREATE INDEX idx_announces_object ON announces(object_ap_id);

-- ============================================================
-- BOOKMARKS (Local only - not federated)
-- ============================================================
CREATE TABLE bookmarks (
  actor_ap_id TEXT NOT NULL,
  object_ap_id TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (actor_ap_id, object_ap_id)
);

-- ============================================================
-- BLOCKS (Local only)
-- ============================================================
CREATE TABLE blocks (
  blocker_ap_id TEXT NOT NULL,
  blocked_ap_id TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (blocker_ap_id, blocked_ap_id)
);

-- ============================================================
-- MUTES (Local only)
-- ============================================================
CREATE TABLE mutes (
  muter_ap_id TEXT NOT NULL,
  muted_ap_id TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (muter_ap_id, muted_ap_id)
);

-- ============================================================
-- NOTIFICATIONS (Local only)
-- ============================================================
CREATE TABLE notifications (
  id TEXT PRIMARY KEY,

  -- Who receives the notification (local actor AP IRI)
  recipient_ap_id TEXT NOT NULL,

  -- Who triggered it (AP IRI - local or remote)
  actor_ap_id TEXT NOT NULL,

  -- Type and target
  type TEXT NOT NULL CHECK (type IN ('follow', 'follow_request', 'like', 'announce', 'reply', 'mention')),
  object_ap_id TEXT,  -- The object involved (post, etc.)

  read INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_notifications_recipient ON notifications(recipient_ap_id, read, created_at DESC);

-- ============================================================
-- ACTIVITIES (Activity log for federation)
-- ============================================================
CREATE TABLE activities (
  -- AP IRI as primary key
  ap_id TEXT PRIMARY KEY,
  type TEXT NOT NULL,

  -- Actor who performed (AP IRI)
  actor_ap_id TEXT NOT NULL,

  -- Object of the activity (AP IRI or embedded)
  object_ap_id TEXT,
  object_json TEXT,

  -- Target (for some activities)
  target_ap_id TEXT,

  -- Full raw JSON
  raw_json TEXT NOT NULL,

  -- Direction and processing status
  direction TEXT CHECK (direction IN ('inbound', 'outbound')),
  processed INTEGER DEFAULT 0,

  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_activities_actor ON activities(actor_ap_id);
CREATE INDEX idx_activities_object ON activities(object_ap_id);
CREATE INDEX idx_activities_direction ON activities(direction, processed);

-- ============================================================
-- DELIVERY_QUEUE (Outbound activity delivery)
-- ============================================================
CREATE TABLE delivery_queue (
  id TEXT PRIMARY KEY,
  activity_ap_id TEXT NOT NULL,
  inbox_url TEXT NOT NULL,
  attempts INTEGER DEFAULT 0,
  last_attempt_at TEXT,
  next_attempt_at TEXT DEFAULT (datetime('now')),
  error TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_delivery_next ON delivery_queue(next_attempt_at);

-- ============================================================
-- COMMUNITIES (AP Group type)
-- ============================================================
CREATE TABLE communities (
  -- AP IRI: https://domain/ap/groups/groupname
  ap_id TEXT PRIMARY KEY,
  type TEXT NOT NULL DEFAULT 'Group',

  preferred_username TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  summary TEXT,
  icon_url TEXT,

  -- AP endpoints
  inbox TEXT NOT NULL,
  outbox TEXT NOT NULL,
  followers_url TEXT NOT NULL,

  -- Settings
  visibility TEXT DEFAULT 'public' CHECK (visibility IN ('public', 'private')),
  join_policy TEXT DEFAULT 'open' CHECK (join_policy IN ('open', 'approval', 'invite')),
  post_policy TEXT DEFAULT 'members' CHECK (post_policy IN ('anyone', 'members', 'mods', 'owners')),

  -- Crypto keys
  public_key_pem TEXT NOT NULL,
  private_key_pem TEXT NOT NULL,

  -- Creator (local actor AP IRI)
  created_by TEXT NOT NULL,

  -- Stats
  member_count INTEGER DEFAULT 0,

  created_at TEXT DEFAULT (datetime('now'))
);

-- ============================================================
-- COMMUNITY_MEMBERS
-- ============================================================
CREATE TABLE community_members (
  community_ap_id TEXT NOT NULL,
  actor_ap_id TEXT NOT NULL,
  role TEXT DEFAULT 'member' CHECK (role IN ('owner', 'moderator', 'member')),
  joined_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (community_ap_id, actor_ap_id)
);

-- ============================================================
-- DM_CONVERSATIONS (Direct messages - local feature)
-- ============================================================
CREATE TABLE dm_conversations (
  id TEXT PRIMARY KEY,
  participant1_ap_id TEXT NOT NULL,
  participant2_ap_id TEXT NOT NULL,
  last_message_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(participant1_ap_id, participant2_ap_id)
);

-- ============================================================
-- DM_MESSAGES
-- ============================================================
CREATE TABLE dm_messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES dm_conversations(id) ON DELETE CASCADE,
  sender_ap_id TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_dm_messages_conv ON dm_messages(conversation_id, created_at DESC);

-- ============================================================
-- SESSIONS (Keep existing - just update foreign key concept)
-- ============================================================
-- Sessions table already exists, we just reference actors by ap_id now

-- Update sessions to reference actor ap_id instead of member id
-- For now, we'll handle this in code by storing the ap_id in the existing member_id column
