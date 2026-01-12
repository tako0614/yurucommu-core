-- Yurucommu v4.1 - Communities機能追加

-- Communities (コミュニティ)
CREATE TABLE IF NOT EXISTS communities (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  icon_url TEXT,
  sort_order INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- postsにcommunity_id追加
ALTER TABLE posts ADD COLUMN community_id TEXT REFERENCES communities(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_posts_community ON posts(community_id, created_at DESC);

-- デフォルトコミュニティ作成
INSERT INTO communities (id, name, description, sort_order) VALUES
  ('general', 'General', '一般', 0);

-- 既存postsをgeneralに紐付け
UPDATE posts SET community_id = 'general' WHERE community_id IS NULL;
