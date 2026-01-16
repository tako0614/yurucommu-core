-- OAuth sessions support
-- Adds columns for multi-provider OAuth (Google, X, Takos)

-- Provider information
ALTER TABLE sessions ADD COLUMN provider TEXT;
ALTER TABLE sessions ADD COLUMN provider_access_token TEXT;
ALTER TABLE sessions ADD COLUMN provider_refresh_token TEXT;
ALTER TABLE sessions ADD COLUMN provider_token_expires_at TEXT;

-- Index for faster lookups
CREATE INDEX IF NOT EXISTS idx_sessions_provider ON sessions(provider);
