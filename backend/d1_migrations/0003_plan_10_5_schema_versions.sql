-- plan 10.2/10.5 v1.10: objects visibility tuning + AppRevision schema/core version guardrails
PRAGMA foreign_keys = ON;

-- Ensure recipient/visibility indexes used by DM exclusion and objects-first queries
CREATE INDEX IF NOT EXISTS idx_object_recipients_recipient ON object_recipients(recipient);
CREATE INDEX IF NOT EXISTS idx_object_recipients_recipient_type ON object_recipients(recipient_type);
CREATE INDEX IF NOT EXISTS idx_object_recipients_object ON object_recipients(object_id);

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

-- Align AppRevision metadata with takos-core v1.10
ALTER TABLE app_state ADD COLUMN schema_version TEXT DEFAULT '1.10';
ALTER TABLE app_state ADD COLUMN core_version TEXT DEFAULT '1.10.0';

UPDATE app_revisions
SET core_version = '1.10.0'
WHERE core_version IS NULL OR core_version = '' OR core_version = '1.8.0';

UPDATE app_state
SET
  schema_version = COALESCE(
    (SELECT schema_version FROM app_revisions WHERE id = active_revision_id),
    schema_version,
    '1.10'
  ),
  core_version = COALESCE(
    (SELECT core_version FROM app_revisions WHERE id = active_revision_id),
    core_version,
    '1.10.0'
  );

-- Guardrails: active app_state must mirror the selected revision versions
DROP TRIGGER IF EXISTS trg_app_state_version_check_insert;
CREATE TRIGGER trg_app_state_version_check_insert
BEFORE INSERT ON app_state
WHEN NEW.active_revision_id IS NOT NULL
BEGIN
  SELECT
    CASE
      WHEN (SELECT id FROM app_revisions WHERE id = NEW.active_revision_id) IS NULL
        THEN RAISE(ABORT, 'active app_revision not found')
    END;
  SELECT
    CASE
      WHEN (SELECT schema_version FROM app_revisions WHERE id = NEW.active_revision_id) != NEW.schema_version
        THEN RAISE(ABORT, 'schema_version mismatch between app_state and app_revisions')
    END;
  SELECT
    CASE
      WHEN (SELECT core_version FROM app_revisions WHERE id = NEW.active_revision_id) != NEW.core_version
        THEN RAISE(ABORT, 'core_version mismatch between app_state and app_revisions')
    END;
END;

DROP TRIGGER IF EXISTS trg_app_state_version_check_update;
CREATE TRIGGER trg_app_state_version_check_update
BEFORE UPDATE ON app_state
WHEN NEW.active_revision_id IS NOT NULL
BEGIN
  SELECT
    CASE
      WHEN (SELECT id FROM app_revisions WHERE id = NEW.active_revision_id) IS NULL
        THEN RAISE(ABORT, 'active app_revision not found')
    END;
  SELECT
    CASE
      WHEN (SELECT schema_version FROM app_revisions WHERE id = NEW.active_revision_id) != NEW.schema_version
        THEN RAISE(ABORT, 'schema_version mismatch between app_state and app_revisions')
    END;
  SELECT
    CASE
      WHEN (SELECT core_version FROM app_revisions WHERE id = NEW.active_revision_id) != NEW.core_version
        THEN RAISE(ABORT, 'core_version mismatch between app_state and app_revisions')
    END;
END;
