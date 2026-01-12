-- Yurucommu v4.0 マイグレーション - ソーシャルネットワーク化

-- ===== 新規テーブル作成 =====

-- 投稿 (Posts)
CREATE TABLE IF NOT EXISTS posts (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  reply_to_id TEXT REFERENCES posts(id) ON DELETE SET NULL,
  repost_of_id TEXT REFERENCES posts(id) ON DELETE SET NULL,
  visibility TEXT DEFAULT 'public' CHECK (visibility IN ('public', 'followers', 'private')),
  like_count INTEGER DEFAULT 0,
  reply_count INTEGER DEFAULT 0,
  repost_count INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_posts_member ON posts(member_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_timeline ON posts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_replies ON posts(reply_to_id, created_at ASC);

-- 投稿添付ファイル
CREATE TABLE IF NOT EXISTS post_attachments (
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  r2_key TEXT NOT NULL,
  content_type TEXT NOT NULL,
  filename TEXT,
  size INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_post_attachments ON post_attachments(post_id);

-- フォロー (相互フォロー制)
CREATE TABLE IF NOT EXISTS follows (
  id TEXT PRIMARY KEY,
  follower_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  following_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected')),
  created_at TEXT DEFAULT (datetime('now')),
  accepted_at TEXT,
  UNIQUE(follower_id, following_id)
);

CREATE INDEX IF NOT EXISTS idx_follows_follower ON follows(follower_id, status);
CREATE INDEX IF NOT EXISTS idx_follows_following ON follows(following_id, status);

-- いいね
CREATE TABLE IF NOT EXISTS likes (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(member_id, post_id)
);

CREATE INDEX IF NOT EXISTS idx_likes_post ON likes(post_id);
CREATE INDEX IF NOT EXISTS idx_likes_member ON likes(member_id);

-- 通知
CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  actor_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('follow_request', 'follow_accepted', 'like', 'reply', 'repost', 'mention')),
  target_type TEXT CHECK (target_type IN ('post', 'member')),
  target_id TEXT,
  read INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_notifications_member ON notifications(member_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications(member_id, read);

-- ブックマーク
CREATE TABLE IF NOT EXISTS bookmarks (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(member_id, post_id)
);

CREATE INDEX IF NOT EXISTS idx_bookmarks_member ON bookmarks(member_id, created_at DESC);

-- ===== membersテーブル拡張 =====

ALTER TABLE members ADD COLUMN follower_count INTEGER DEFAULT 0;
ALTER TABLE members ADD COLUMN following_count INTEGER DEFAULT 0;
ALTER TABLE members ADD COLUMN post_count INTEGER DEFAULT 0;
ALTER TABLE members ADD COLUMN header_url TEXT;
ALTER TABLE members ADD COLUMN is_private INTEGER DEFAULT 0;

-- ===== 旧テーブル削除 =====

DROP TABLE IF EXISTS thread_replies;
DROP TABLE IF EXISTS threads;
DROP TABLE IF EXISTS attachments;
DROP TABLE IF EXISTS messages;
DROP TABLE IF EXISTS rooms;
DROP TABLE IF EXISTS unread_counts;
