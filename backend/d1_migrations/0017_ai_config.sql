-- AI configuration storage (PLAN 6.x)

CREATE TABLE IF NOT EXISTS ai_config (
  id TEXT PRIMARY KEY,
  config_json TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
