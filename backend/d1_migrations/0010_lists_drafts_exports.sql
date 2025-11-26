-- Add support for user lists, post drafts/scheduled posts, bookmarks, and data export requests

CREATE TABLE lists (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  is_public INTEGER NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  FOREIGN KEY(owner_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE list_members (
  list_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  added_at DATETIME NOT NULL,
  PRIMARY KEY (list_id, user_id),
  FOREIGN KEY(list_id) REFERENCES lists(id) ON DELETE CASCADE,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE post_plans (
  id TEXT PRIMARY KEY,
  author_id TEXT NOT NULL,
  community_id TEXT,
  type TEXT NOT NULL,
  text TEXT NOT NULL DEFAULT '',
  media_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'draft', -- draft | scheduled | published | failed | canceled
  scheduled_at DATETIME,
  post_id TEXT,
  broadcast_all INTEGER NOT NULL DEFAULT 0,
  visible_to_friends INTEGER NOT NULL DEFAULT 0,
  attributed_community_id TEXT,
  last_error TEXT,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  FOREIGN KEY(author_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY(community_id) REFERENCES communities(id) ON DELETE CASCADE
);

CREATE INDEX idx_post_plans_status_scheduled_at ON post_plans(status, scheduled_at);

CREATE TABLE bookmarks (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  post_id TEXT NOT NULL,
  created_at DATETIME NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY(post_id) REFERENCES posts(id) ON DELETE CASCADE
);

CREATE INDEX idx_bookmarks_user_id ON bookmarks(user_id);
CREATE INDEX idx_bookmarks_post_id ON bookmarks(post_id);

CREATE TABLE data_export_requests (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  format TEXT NOT NULL DEFAULT 'json',
  status TEXT NOT NULL DEFAULT 'pending', -- pending | processing | completed | failed
  requested_at DATETIME NOT NULL,
  processed_at DATETIME,
  download_url TEXT,
  result_json TEXT,
  error_message TEXT,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX idx_data_export_requests_status ON data_export_requests(status);
CREATE INDEX idx_data_export_requests_user_requested_at ON data_export_requests(user_id, requested_at);
