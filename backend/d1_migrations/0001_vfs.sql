-- VFS metadata tables for app workspaces (PLAN 15)

CREATE TABLE IF NOT EXISTS vfs_directories (
  workspace_id TEXT NOT NULL,
  path TEXT NOT NULL,
  name TEXT NOT NULL,
  parent_path TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (workspace_id, path),
  FOREIGN KEY (workspace_id) REFERENCES app_workspaces(id) ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS vfs_directories_parent_idx ON vfs_directories(workspace_id, parent_path);

CREATE TABLE IF NOT EXISTS vfs_files (
  workspace_id TEXT NOT NULL,
  path TEXT NOT NULL,
  directory_path TEXT NOT NULL,
  content_type TEXT,
  content_hash TEXT,
  size INTEGER DEFAULT 0,
  storage_key TEXT NOT NULL,
  is_cache INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (workspace_id, path),
  FOREIGN KEY (workspace_id) REFERENCES app_workspaces(id) ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS vfs_files_dir_idx ON vfs_files(workspace_id, directory_path);

CREATE TABLE IF NOT EXISTS app_workspace_snapshots (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  status TEXT NOT NULL,
  storage_key TEXT NOT NULL,
  size_bytes INTEGER,
  file_count INTEGER,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (workspace_id) REFERENCES app_workspaces(id) ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS app_workspace_snapshots_ws_idx ON app_workspace_snapshots(workspace_id);
