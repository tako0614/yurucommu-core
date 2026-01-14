-- Yurucommu v5.0 マイグレーション - Person Federation (個人ActivityPub対応)

-- ユーザーごとのRSA鍵ペア
CREATE TABLE IF NOT EXISTS user_keys (
  member_id TEXT PRIMARY KEY REFERENCES members(id) ON DELETE CASCADE,
  public_key_pem TEXT NOT NULL,
  private_key_pem TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

-- リモートフォロー (ローカルユーザーがリモートユーザーをフォロー)
CREATE TABLE IF NOT EXISTS remote_follows (
  id TEXT PRIMARY KEY,
  local_member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  remote_actor_id TEXT NOT NULL,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected')),
  created_at TEXT DEFAULT (datetime('now')),
  accepted_at TEXT,
  UNIQUE(local_member_id, remote_actor_id)
);

CREATE INDEX IF NOT EXISTS idx_remote_follows_local ON remote_follows(local_member_id, status);
CREATE INDEX IF NOT EXISTS idx_remote_follows_remote ON remote_follows(remote_actor_id);

-- ローカルフォロワー (リモートユーザーがローカルユーザーをフォロー)
CREATE TABLE IF NOT EXISTS local_followers (
  id TEXT PRIMARY KEY,
  local_member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  remote_actor_id TEXT NOT NULL,
  accepted INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(local_member_id, remote_actor_id)
);

CREATE INDEX IF NOT EXISTS idx_local_followers_member ON local_followers(local_member_id, accepted);

-- リモート投稿キャッシュ (フォロー中のリモートユーザーの投稿)
CREATE TABLE IF NOT EXISTS remote_posts (
  id TEXT PRIMARY KEY,
  ap_id TEXT NOT NULL UNIQUE,
  remote_actor_id TEXT NOT NULL,
  content TEXT NOT NULL,
  visibility TEXT DEFAULT 'public',
  reply_to_ap_id TEXT,
  attachments TEXT,  -- JSON array
  published TEXT NOT NULL,
  raw_json TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_remote_posts_actor ON remote_posts(remote_actor_id, published DESC);
CREATE INDEX IF NOT EXISTS idx_remote_posts_timeline ON remote_posts(published DESC);

-- postsテーブルにAP ID追加
ALTER TABLE posts ADD COLUMN ap_id TEXT;
CREATE INDEX IF NOT EXISTS idx_posts_ap_id ON posts(ap_id);
