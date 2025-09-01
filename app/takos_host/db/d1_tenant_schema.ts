// Cloudflare D1 用スキーマ（tenant: takos core の最小項目）
export const D1_TENANT_SCHEMA = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS t_accounts (
  id TEXT PRIMARY KEY,
  user_name TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  avatar_initial TEXT NOT NULL,
  private_key TEXT,
  public_key TEXT NOT NULL,
  followers_json TEXT,
  following_json TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS t_sessions (
  session_id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_accounts_name ON t_accounts(user_name);
`;

