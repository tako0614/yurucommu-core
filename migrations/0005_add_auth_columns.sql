-- Migration: 0005_add_auth_columns
-- Description: Add authentication columns for Email/Password and OAuth2

-- Add authentication columns to local_users
ALTER TABLE local_users ADD COLUMN email TEXT UNIQUE;
ALTER TABLE local_users ADD COLUMN password_hash TEXT;
ALTER TABLE local_users ADD COLUMN auth_provider TEXT NOT NULL DEFAULT 'local';
-- auth_provider: 'local' | 'oauth2'
ALTER TABLE local_users ADD COLUMN external_user_id TEXT;

-- OAuth2 state storage (for CSRF protection and PKCE)
CREATE TABLE IF NOT EXISTS oauth_states (
  id TEXT PRIMARY KEY,
  state TEXT UNIQUE NOT NULL,
  code_verifier TEXT NOT NULL,
  redirect_uri TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_oauth_states_state ON oauth_states(state);
CREATE INDEX IF NOT EXISTS idx_oauth_states_expires ON oauth_states(expires_at);

-- OAuth2 tokens (for storing tokens from IdP)
CREATE TABLE IF NOT EXISTS oauth_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES local_users(id),
  access_token TEXT NOT NULL,
  refresh_token TEXT,
  token_type TEXT NOT NULL DEFAULT 'Bearer',
  scope TEXT,
  expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_oauth_tokens_user ON oauth_tokens(user_id);
