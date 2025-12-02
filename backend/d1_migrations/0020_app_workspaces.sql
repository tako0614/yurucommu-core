-- Migration: App workspace metadata and files

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS app_workspaces (
  id TEXT NOT NULL PRIMARY KEY,
  base_revision_id TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'validated', 'testing', 'ready', 'applied')),
  author_type TEXT NOT NULL CHECK (author_type IN ('human', 'agent')),
  author_name TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT app_workspaces_base_revision_id_fkey
    FOREIGN KEY (base_revision_id)
    REFERENCES app_revisions(id)
    ON DELETE SET NULL
    ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS app_workspace_files (
  workspace_id TEXT NOT NULL,
  path TEXT NOT NULL,
  content BLOB NOT NULL,
  content_type TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (workspace_id, path),
  CONSTRAINT app_workspace_files_workspace_id_fkey
    FOREIGN KEY (workspace_id)
    REFERENCES app_workspaces(id)
    ON DELETE CASCADE
    ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS app_workspace_files_workspace_id_idx
  ON app_workspace_files (workspace_id);
