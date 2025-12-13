-- App 開発環境: Workspaces + VFS (plan 15)

-- Workspace metadata
CREATE TABLE IF NOT EXISTS app_workspaces (
  id TEXT PRIMARY KEY,
  base_revision_id TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  author_type TEXT NOT NULL DEFAULT 'human',
  author_name TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_app_workspaces_status ON app_workspaces(status);
CREATE INDEX IF NOT EXISTS idx_app_workspaces_updated_at ON app_workspaces(updated_at DESC);

-- Legacy workspace file storage (D1-only fallback)
CREATE TABLE IF NOT EXISTS app_workspace_files (
  workspace_id TEXT NOT NULL,
  path TEXT NOT NULL,
  content BLOB NOT NULL,
  content_type TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (workspace_id, path)
);

CREATE INDEX IF NOT EXISTS idx_app_workspace_files_workspace ON app_workspace_files(workspace_id);
CREATE INDEX IF NOT EXISTS idx_app_workspace_files_workspace_path ON app_workspace_files(workspace_id, path);

-- Workspace snapshots (stored in R2, referenced from D1)
CREATE TABLE IF NOT EXISTS app_workspace_snapshots (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  status TEXT NOT NULL,
  storage_key TEXT NOT NULL,
  size_bytes INTEGER,
  file_count INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_app_workspace_snapshots_workspace_created ON app_workspace_snapshots(workspace_id, created_at DESC);

-- VFS directory structure (metadata only)
CREATE TABLE IF NOT EXISTS vfs_directories (
  workspace_id TEXT NOT NULL,
  path TEXT NOT NULL,
  name TEXT NOT NULL,
  parent_path TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (workspace_id, path)
);

CREATE INDEX IF NOT EXISTS idx_vfs_directories_workspace_parent ON vfs_directories(workspace_id, parent_path);

-- VFS file metadata (content stored in R2 under storage_key)
CREATE TABLE IF NOT EXISTS vfs_files (
  workspace_id TEXT NOT NULL,
  path TEXT NOT NULL,
  directory_path TEXT NOT NULL,
  content_type TEXT,
  content_hash TEXT,
  size INTEGER NOT NULL DEFAULT 0,
  storage_key TEXT,
  is_cache INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (workspace_id, path)
);

CREATE INDEX IF NOT EXISTS idx_vfs_files_workspace_directory ON vfs_files(workspace_id, directory_path);
CREATE INDEX IF NOT EXISTS idx_vfs_files_workspace_path ON vfs_files(workspace_id, path);
CREATE INDEX IF NOT EXISTS idx_vfs_files_workspace_cache ON vfs_files(workspace_id, is_cache);
