-- takos objects-first hardening (plan 10.2)
PRAGMA foreign_keys = ON;

-- Normalize recipients for visibility / DM filtering
CREATE TABLE IF NOT EXISTS object_recipients (
  object_id TEXT NOT NULL,
  recipient TEXT NOT NULL,
  recipient_type TEXT NOT NULL,
  PRIMARY KEY (object_id, recipient, recipient_type),
  FOREIGN KEY (object_id) REFERENCES objects(id) ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_object_recipients_recipient ON object_recipients(recipient);
CREATE INDEX IF NOT EXISTS idx_object_recipients_recipient_type ON object_recipients(recipient_type);
CREATE INDEX IF NOT EXISTS idx_object_recipients_object ON object_recipients(object_id);

-- Visibility-aware indexes (exclude deleted rows)
CREATE INDEX IF NOT EXISTS idx_objects_visibility_published_active
  ON objects(visibility, published DESC)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_objects_non_direct_recent
  ON objects(published DESC)
  WHERE deleted_at IS NULL AND (visibility IS NULL OR visibility != 'direct');
CREATE INDEX IF NOT EXISTS idx_objects_direct_context
  ON objects(context, published DESC)
  WHERE deleted_at IS NULL AND visibility = 'direct';

-- Tamper-evident audit chain
CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  timestamp TEXT DEFAULT CURRENT_TIMESTAMP,
  actor_type TEXT NOT NULL,
  actor_id TEXT,
  action TEXT NOT NULL,
  target TEXT,
  details_json TEXT,
  checksum TEXT NOT NULL,
  prev_checksum TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log(action);
CREATE INDEX IF NOT EXISTS idx_audit_log_timestamp ON audit_log(timestamp DESC);
