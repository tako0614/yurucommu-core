CREATE TABLE IF NOT EXISTS actor_notes (
  actor_ap_id TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  expires_at TEXT NOT NULL,
  deleted_at TEXT,
  FOREIGN KEY (actor_ap_id) REFERENCES actors(ap_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS actor_notes_expires_idx
  ON actor_notes(expires_at);

CREATE INDEX IF NOT EXISTS actor_notes_updated_idx
  ON actor_notes(updated_at);

CREATE INDEX IF NOT EXISTS actor_notes_deleted_idx
  ON actor_notes(deleted_at);
