-- Migration: App revision tracking (prod)

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS app_revisions (
  id TEXT NOT NULL PRIMARY KEY,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  author_type TEXT NOT NULL,
  author_name TEXT,
  message TEXT,
  schema_version TEXT NOT NULL,
  manifest_snapshot TEXT NOT NULL,
  script_snapshot_ref TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS app_state (
  id INTEGER NOT NULL PRIMARY KEY CHECK (id = 1),
  active_revision_id TEXT,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT app_state_active_revision_id_fkey
    FOREIGN KEY (active_revision_id)
    REFERENCES app_revisions(id)
    ON DELETE SET NULL
    ON UPDATE CASCADE
);

INSERT OR IGNORE INTO app_state (id, updated_at) VALUES (1, CURRENT_TIMESTAMP);
