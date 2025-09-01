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

CREATE INDEX IF NOT EXISTS idx_t_accounts_tenant_created ON t_accounts(tenant_host, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_t_accounts_tenant_username ON t_accounts(tenant_host, user_name);
CREATE INDEX IF NOT EXISTS idx_t_sessions_tenant_session ON t_sessions(tenant_host, session_id);
`;
