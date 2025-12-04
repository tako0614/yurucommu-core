-- Migration: App manifest validation tracking

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS app_manifest_validation (
  id INTEGER NOT NULL PRIMARY KEY CHECK (id = 1),
  status TEXT NOT NULL,
  message TEXT NOT NULL,
  errors TEXT NOT NULL DEFAULT '[]',
  warnings TEXT NOT NULL DEFAULT '[]',
  validated_at DATETIME NOT NULL,
  manifest_version TEXT,
  schema_version TEXT
);

INSERT OR IGNORE INTO app_manifest_validation
  (id, status, message, errors, warnings, validated_at)
VALUES
  (1, 'unknown', 'No validation has been run yet', '[]', '[]', CURRENT_TIMESTAMP);
