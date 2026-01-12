-- Yurucommu v2.0 Migration

-- Add join_policy to rooms
ALTER TABLE rooms ADD COLUMN join_policy TEXT DEFAULT 'open' CHECK (join_policy IN ('open', 'inviteOnly', 'moderated'));

-- Add bio and password_hash to members
ALTER TABLE members ADD COLUMN bio TEXT;
ALTER TABLE members ADD COLUMN password_hash TEXT;

-- Threads (Forum)
CREATE TABLE IF NOT EXISTS threads (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  content TEXT,
  pinned INTEGER DEFAULT 0,
  locked INTEGER DEFAULT 0,
  reply_count INTEGER DEFAULT 0,
  last_reply_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_threads_room ON threads(room_id, last_reply_at DESC);

-- Thread replies
CREATE TABLE IF NOT EXISTS thread_replies (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_thread_replies ON thread_replies(thread_id, created_at ASC);

-- DM conversations
CREATE TABLE IF NOT EXISTS dm_conversations (
  id TEXT PRIMARY KEY,
  member1_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  member2_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  last_message_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(member1_id, member2_id)
);

-- DM messages
CREATE TABLE IF NOT EXISTS dm_messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES dm_conversations(id) ON DELETE CASCADE,
  sender_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_dm_messages ON dm_messages(conversation_id, created_at DESC);

-- Unread counts
CREATE TABLE IF NOT EXISTS unread_counts (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL CHECK (target_type IN ('room', 'dm')),
  target_id TEXT NOT NULL,
  count INTEGER DEFAULT 0,
  last_read_at TEXT,
  UNIQUE(member_id, target_type, target_id)
);
