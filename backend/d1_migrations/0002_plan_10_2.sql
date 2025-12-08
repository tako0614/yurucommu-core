-- plan 10.2/10.5: objects recipients/visibility hardening, audit chain, AppRevision core version
PRAGMA foreign_keys = ON;

-- Recipients normalization indexes
CREATE INDEX IF NOT EXISTS idx_object_recipients_recipient ON object_recipients(recipient);
CREATE INDEX IF NOT EXISTS idx_object_recipients_recipient_type ON object_recipients(recipient_type);
CREATE INDEX IF NOT EXISTS idx_object_recipients_object ON object_recipients(object_id);

-- Visibility-aware query tuning (DM exclusion + active rows)
DROP INDEX IF EXISTS idx_objects_visibility_published;
CREATE INDEX IF NOT EXISTS idx_objects_visibility_published
  ON objects(visibility, published DESC);
CREATE INDEX IF NOT EXISTS idx_objects_visibility_published_active
  ON objects(visibility, published DESC)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_objects_non_direct_recent
  ON objects(published DESC)
  WHERE deleted_at IS NULL AND (visibility IS NULL OR visibility != 'direct');
CREATE INDEX IF NOT EXISTS idx_objects_direct_context
  ON objects(context, published DESC)
  WHERE deleted_at IS NULL AND visibility = 'direct';

-- Tamper-evident audit log chain
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

-- AppRevision compatibility metadata
ALTER TABLE app_revisions ADD COLUMN core_version TEXT NOT NULL DEFAULT '1.8.0';
