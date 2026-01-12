-- Yurucommu v3.0 追加マイグレーション (Invites & Bans)

-- 招待管理
CREATE TABLE IF NOT EXISTS ap_invites (
  id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL,           -- 招待対象のActor IRI
  invited_by TEXT,                  -- 招待したメンバーID (ローカル)
  activity_id TEXT,                 -- Invite Activity ID
  accepted INTEGER DEFAULT 0,       -- 招待を受諾したか
  created_at TEXT DEFAULT (datetime('now')),
  expires_at TEXT,                  -- 有効期限
  UNIQUE(actor_id)
);

-- BAN管理
CREATE TABLE IF NOT EXISTS ap_bans (
  id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL UNIQUE,    -- BANされたActor IRI
  reason TEXT,
  banned_by TEXT,                   -- BANしたメンバーID
  created_at TEXT DEFAULT (datetime('now'))
);

-- messages に context 追加
ALTER TABLE messages ADD COLUMN context TEXT;

-- threads に ap_article_id 追加
ALTER TABLE threads ADD COLUMN ap_article_id TEXT;
