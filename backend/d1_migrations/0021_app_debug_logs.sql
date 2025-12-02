-- Migration: App runtime debug logs

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS app_debug_logs (
  id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  timestamp DATETIME NOT NULL,
  mode TEXT NOT NULL,
  workspace_id TEXT,
  run_id TEXT NOT NULL,
  handler TEXT,
  level TEXT NOT NULL,
  message TEXT NOT NULL,
  data_json TEXT
);

CREATE INDEX IF NOT EXISTS app_debug_logs_timestamp_idx
  ON app_debug_logs (timestamp DESC, id DESC);

CREATE INDEX IF NOT EXISTS app_debug_logs_workspace_idx
  ON app_debug_logs (workspace_id);

CREATE INDEX IF NOT EXISTS app_debug_logs_handler_idx
  ON app_debug_logs (handler);
