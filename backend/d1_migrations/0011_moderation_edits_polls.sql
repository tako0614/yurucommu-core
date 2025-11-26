-- Add edit count for posts
ALTER TABLE posts ADD COLUMN edit_count INTEGER NOT NULL DEFAULT 0;

-- Extend reports with category and updated status semantics
ALTER TABLE reports ADD COLUMN category TEXT NOT NULL DEFAULT 'other';
UPDATE reports SET category = 'other' WHERE category IS NULL;

-- Post edit history
CREATE TABLE IF NOT EXISTS post_edit_history (
  id TEXT PRIMARY KEY NOT NULL,
  post_id TEXT NOT NULL,
  editor_id TEXT NOT NULL,
  previous_text TEXT NOT NULL DEFAULT '',
  previous_media_json TEXT NOT NULL DEFAULT '[]',
  diff_json TEXT NOT NULL DEFAULT '{}',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
  FOREIGN KEY (editor_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_post_edit_history_post_created_at ON post_edit_history(post_id, created_at);

-- Poll tables
CREATE TABLE IF NOT EXISTS post_polls (
  id TEXT PRIMARY KEY NOT NULL,
  post_id TEXT NOT NULL UNIQUE,
  question TEXT NOT NULL DEFAULT '',
  allows_multiple INTEGER NOT NULL DEFAULT 0,
  anonymous INTEGER NOT NULL DEFAULT 1,
  expires_at DATETIME,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS post_poll_options (
  id TEXT PRIMARY KEY NOT NULL,
  poll_id TEXT NOT NULL,
  text TEXT NOT NULL,
  order_index INTEGER NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (poll_id) REFERENCES post_polls(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_post_poll_options_poll ON post_poll_options(poll_id);

CREATE TABLE IF NOT EXISTS post_poll_votes (
  id TEXT PRIMARY KEY NOT NULL,
  poll_id TEXT NOT NULL,
  option_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(poll_id, user_id, option_id),
  FOREIGN KEY (poll_id) REFERENCES post_polls(id) ON DELETE CASCADE,
  FOREIGN KEY (option_id) REFERENCES post_poll_options(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_post_poll_votes_poll ON post_poll_votes(poll_id);
