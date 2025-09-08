// Cloudflare D1 用スキーマ（tenant: takos hostのtenant用DB の最小項目）
export const D1_TENANT_SCHEMA = `
PRAGMA foreign_keys = ON;

-- テナント分離: tenant_host 列でスコープする（新規作成時は NOT NULL）
CREATE TABLE IF NOT EXISTS t_accounts (
  id TEXT PRIMARY KEY,
  tenant_host TEXT NOT NULL,
  user_name TEXT NOT NULL,
  display_name TEXT NOT NULL,
  avatar_initial TEXT NOT NULL,
  private_key TEXT,
  public_key TEXT NOT NULL,
  followers_json TEXT,
  following_json TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE(tenant_host, user_name)
);

CREATE TABLE IF NOT EXISTS t_sessions (
  session_id TEXT PRIMARY KEY,
  tenant_host TEXT NOT NULL,
  device_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS t_dms (
  id TEXT PRIMARY KEY,
  tenant_host TEXT NOT NULL,
  from_user TEXT NOT NULL,
  to_user TEXT NOT NULL,
  type TEXT NOT NULL,
  content TEXT,
  attachments_json TEXT,
  url TEXT,
  media_type TEXT,
  encryption_key TEXT,
  encryption_iv TEXT,
  preview_json TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS t_dm_conversations (
  id TEXT PRIMARY KEY,
  tenant_host TEXT NOT NULL,
  owner TEXT NOT NULL,
  participant_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(tenant_host, owner, participant_id)
);

CREATE TABLE IF NOT EXISTS t_posts (
  id TEXT PRIMARY KEY,
  tenant_host TEXT NOT NULL,
  type TEXT NOT NULL,
  actor TEXT NOT NULL,
  content TEXT,
  extra_json TEXT,
  to_json TEXT,
  cc_json TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS t_notifications (
  id TEXT PRIMARY KEY,
  tenant_host TEXT NOT NULL,
  owner TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  type TEXT NOT NULL,
  read_status INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS t_system_keys (
  id TEXT PRIMARY KEY,
  tenant_host TEXT NOT NULL,
  domain TEXT NOT NULL,
  private_key TEXT NOT NULL,
  public_key TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(tenant_host, domain)
);

CREATE TABLE IF NOT EXISTS t_remote_actors (
  id TEXT PRIMARY KEY,
  tenant_host TEXT NOT NULL,
  actor_url TEXT NOT NULL,
  name TEXT NOT NULL,
  preferred_username TEXT NOT NULL,
  icon_json TEXT,
  summary TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(tenant_host, actor_url)
);

CREATE TABLE IF NOT EXISTS t_groups (
  id TEXT PRIMARY KEY,
  tenant_host TEXT NOT NULL,
  group_name TEXT NOT NULL,
  display_name TEXT NOT NULL,
  summary TEXT,
  icon_json TEXT,
  image_json TEXT,
  membership_policy TEXT DEFAULT 'open',
  invite_policy TEXT DEFAULT 'members',
  visibility TEXT DEFAULT 'public',
  allow_invites INTEGER DEFAULT 1,
  followers_json TEXT,
  outbox_json TEXT,
  private_key TEXT,
  public_key TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(tenant_host, group_name)
);

CREATE TABLE IF NOT EXISTS t_invites (
  id TEXT PRIMARY KEY,
  tenant_host TEXT NOT NULL,
  inviter TEXT NOT NULL,
  invitee TEXT NOT NULL,
  group_name TEXT,
  status TEXT DEFAULT 'pending',
  extra_json TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS t_approvals (
  id TEXT PRIMARY KEY,
  tenant_host TEXT NOT NULL,
  requester TEXT NOT NULL,
  target TEXT NOT NULL,
  type TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  extra_json TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_t_accounts_tenant_created ON t_accounts(tenant_host, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_t_accounts_tenant_username ON t_accounts(tenant_host, user_name);
CREATE INDEX IF NOT EXISTS idx_t_sessions_tenant_session ON t_sessions(tenant_host, session_id);
CREATE INDEX IF NOT EXISTS idx_t_dms_tenant_users ON t_dms(tenant_host, from_user, to_user);
CREATE INDEX IF NOT EXISTS idx_t_dms_tenant_created ON t_dms(tenant_host, created_at);
CREATE INDEX IF NOT EXISTS idx_t_dm_conversations_tenant_owner ON t_dm_conversations(tenant_host, owner);
CREATE INDEX IF NOT EXISTS idx_t_posts_tenant_actor ON t_posts(tenant_host, actor);
CREATE INDEX IF NOT EXISTS idx_t_posts_tenant_created ON t_posts(tenant_host, created_at);
CREATE INDEX IF NOT EXISTS idx_t_posts_tenant_type ON t_posts(tenant_host, type);
CREATE INDEX IF NOT EXISTS idx_t_notifications_tenant_owner ON t_notifications(tenant_host, owner);
CREATE INDEX IF NOT EXISTS idx_t_notifications_tenant_created ON t_notifications(tenant_host, created_at);
CREATE INDEX IF NOT EXISTS idx_t_system_keys_tenant_domain ON t_system_keys(tenant_host, domain);
CREATE INDEX IF NOT EXISTS idx_t_remote_actors_tenant_url ON t_remote_actors(tenant_host, actor_url);
CREATE INDEX IF NOT EXISTS idx_t_groups_tenant_name ON t_groups(tenant_host, group_name);
CREATE INDEX IF NOT EXISTS idx_t_groups_tenant_created ON t_groups(tenant_host, created_at);
CREATE INDEX IF NOT EXISTS idx_t_invites_tenant_invitee ON t_invites(tenant_host, invitee);
CREATE INDEX IF NOT EXISTS idx_t_invites_tenant_status ON t_invites(tenant_host, status);
CREATE INDEX IF NOT EXISTS idx_t_approvals_tenant_target ON t_approvals(tenant_host, target);
CREATE INDEX IF NOT EXISTS idx_t_approvals_tenant_status ON t_approvals(tenant_host, status);

-- 日次レート制限カウンタ（テナント単位）
CREATE TABLE IF NOT EXISTS t_usage_counters (
  tenant_host TEXT NOT NULL,
  name TEXT NOT NULL,
  day INTEGER NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_host, name, day)
);
CREATE INDEX IF NOT EXISTS idx_usage_tenant_day ON t_usage_counters(tenant_host, day);

-- ストレージ使用量（テナント単位の合計バイト数）
CREATE TABLE IF NOT EXISTS t_storage_usage (
  tenant_host TEXT PRIMARY KEY,
  used_bytes INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

-- オブジェクトごとのサイズを保持（削除時の差分更新に利用）
CREATE TABLE IF NOT EXISTS t_storage_objects (
  tenant_host TEXT NOT NULL,
  key TEXT NOT NULL,
  size INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (tenant_host, key)
);
CREATE INDEX IF NOT EXISTS idx_storage_objs_tenant ON t_storage_objects(tenant_host);
`;
