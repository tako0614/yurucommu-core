-- Yurucommu v3.0 Migration (ActivityPub Federation)

-- ActivityPub Activities (受信・送信ログ)
CREATE TABLE IF NOT EXISTS ap_activities (
  id TEXT PRIMARY KEY,
  activity_id TEXT NOT NULL UNIQUE,
  activity_type TEXT NOT NULL,
  actor TEXT NOT NULL,
  object TEXT,
  target TEXT,
  raw_json TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  processed INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_ap_activities_type ON ap_activities(activity_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ap_activities_actor ON ap_activities(actor);

-- Remote Actors (キャッシュ)
CREATE TABLE IF NOT EXISTS ap_remote_actors (
  id TEXT PRIMARY KEY,
  actor_type TEXT NOT NULL,
  preferred_username TEXT,
  name TEXT,
  summary TEXT,
  inbox TEXT NOT NULL,
  outbox TEXT,
  followers TEXT,
  following TEXT,
  public_key_id TEXT,
  public_key_pem TEXT,
  icon_url TEXT,
  raw_json TEXT NOT NULL,
  last_fetched_at TEXT DEFAULT (datetime('now')),
  created_at TEXT DEFAULT (datetime('now'))
);

-- Followers (メンバー = Group の followers)
CREATE TABLE IF NOT EXISTS ap_followers (
  id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL UNIQUE,
  accepted INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Delivery Queue (配信キュー)
CREATE TABLE IF NOT EXISTS ap_delivery_queue (
  id TEXT PRIMARY KEY,
  activity_id TEXT NOT NULL,
  target_inbox TEXT NOT NULL,
  attempts INTEGER DEFAULT 0,
  last_attempt_at TEXT,
  next_retry_at TEXT,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'success', 'failed')),
  error_message TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_ap_delivery_pending ON ap_delivery_queue(status, next_retry_at);

-- 既存テーブル変更
ALTER TABLE members ADD COLUMN ap_actor_id TEXT;
ALTER TABLE members ADD COLUMN is_remote INTEGER DEFAULT 0;

ALTER TABLE messages ADD COLUMN ap_note_id TEXT;

-- Actor Keys (RSA鍵ペア保存)
CREATE TABLE IF NOT EXISTS ap_actor_keys (
  id TEXT PRIMARY KEY DEFAULT 'main',
  public_key_pem TEXT NOT NULL,
  private_key_pem TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);
