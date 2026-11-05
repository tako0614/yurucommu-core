-- Additive opt-in receipts. Existing timestamps and messages are untouched.
-- Seed a viewer's currently timestamp-read objects only in the atomic init
-- request; applying the migration neither changes unread state nor opts in.
CREATE TABLE IF NOT EXISTS talk_read_modes (
  actor_ap_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('user', 'community')),
  target_ap_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  epoch TEXT NOT NULL,
  started_at TEXT NOT NULL,
  PRIMARY KEY (actor_ap_id, kind, target_ap_id)
);
CREATE TABLE IF NOT EXISTS talk_message_reads (
  actor_ap_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('user', 'community')),
  target_ap_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  epoch TEXT NOT NULL,
  object_ap_id TEXT NOT NULL,
  read_at TEXT NOT NULL,
  PRIMARY KEY (actor_ap_id, kind, target_ap_id, thread_id, epoch, object_ap_id)
);
CREATE INDEX IF NOT EXISTS talk_message_reads_object_idx ON talk_message_reads(object_ap_id);
CREATE TABLE IF NOT EXISTS talk_read_assertions (
  id TEXT PRIMARY KEY,
  valid INTEGER NOT NULL CONSTRAINT talk_read_assertion_valid CHECK (valid = 1)
);

-- No FK to local actors: peer identities may be remote, and the family uses
-- explicit cleanup after its historical remote-actor FK repairs.
CREATE TRIGGER IF NOT EXISTS talk_reads_object_delete AFTER DELETE ON objects
BEGIN
  DELETE FROM talk_message_reads WHERE object_ap_id = OLD.ap_id;
END;
CREATE TRIGGER IF NOT EXISTS talk_reads_actor_delete AFTER DELETE ON actors
BEGIN
  DELETE FROM talk_message_reads WHERE actor_ap_id = OLD.ap_id;
  DELETE FROM talk_read_modes WHERE actor_ap_id = OLD.ap_id;
END;
CREATE TRIGGER IF NOT EXISTS talk_reads_member_delete AFTER DELETE ON community_members
BEGIN
  DELETE FROM talk_message_reads WHERE actor_ap_id = OLD.actor_ap_id AND kind = 'community' AND target_ap_id = OLD.community_ap_id;
  DELETE FROM talk_read_modes WHERE actor_ap_id = OLD.actor_ap_id AND kind = 'community' AND target_ap_id = OLD.community_ap_id;
END;
CREATE TRIGGER IF NOT EXISTS talk_reads_member_epoch AFTER UPDATE OF joined_at ON community_members
WHEN NEW.joined_at <> OLD.joined_at
BEGIN
  DELETE FROM talk_message_reads WHERE actor_ap_id = OLD.actor_ap_id AND kind = 'community' AND target_ap_id = OLD.community_ap_id;
  DELETE FROM talk_read_modes WHERE actor_ap_id = OLD.actor_ap_id AND kind = 'community' AND target_ap_id = OLD.community_ap_id;
END;

CREATE TRIGGER IF NOT EXISTS talk_reads_community_delete AFTER DELETE ON communities
BEGIN
  DELETE FROM talk_message_reads WHERE kind = 'community' AND target_ap_id = OLD.ap_id;
  DELETE FROM talk_read_modes WHERE kind = 'community' AND target_ap_id = OLD.ap_id;
END;
CREATE TRIGGER IF NOT EXISTS talk_reads_object_tombstone AFTER UPDATE OF deleted_at ON objects
WHEN NEW.deleted_at IS NOT NULL
BEGIN
  DELETE FROM talk_message_reads WHERE object_ap_id = OLD.ap_id;
END;

-- A reservation denies new writes/rewrites of the reader's metadata. Deletes
-- after the parent object/actor/membership is gone are sidecar cleanup only;
-- they must not block another author's deletion or retain orphan identities.
CREATE TRIGGER IF NOT EXISTS account_deletion_talk_read_modes_insert
BEFORE INSERT ON talk_read_modes
WHEN EXISTS (SELECT 1 FROM account_deletion_targets target
    WHERE (target.actor_ap_id = NEW.actor_ap_id) AND NOT EXISTS (SELECT 1 FROM actor_write_assertions marker
      WHERE marker.operation_id = target.operation_id))
BEGIN
  SELECT RAISE(ABORT, 'account deletion reserved');
END;
CREATE TRIGGER IF NOT EXISTS account_deletion_talk_read_modes_update
BEFORE UPDATE ON talk_read_modes
WHEN EXISTS (SELECT 1 FROM account_deletion_targets target
    WHERE (target.actor_ap_id = OLD.actor_ap_id OR target.actor_ap_id = NEW.actor_ap_id) AND NOT EXISTS (SELECT 1 FROM actor_write_assertions marker
      WHERE marker.operation_id = target.operation_id))
BEGIN
  SELECT RAISE(ABORT, 'account deletion reserved');
END;
CREATE TRIGGER IF NOT EXISTS account_deletion_talk_read_modes_delete
BEFORE DELETE ON talk_read_modes
WHEN EXISTS (SELECT 1 FROM account_deletion_targets target
    WHERE (target.actor_ap_id = OLD.actor_ap_id) AND NOT EXISTS (SELECT 1 FROM actor_write_assertions marker
      WHERE marker.operation_id = target.operation_id)) AND EXISTS (SELECT 1 FROM actors WHERE ap_id = OLD.actor_ap_id) AND (OLD.kind = 'user' OR EXISTS (SELECT 1 FROM community_members cm JOIN communities c ON c.ap_id = cm.community_ap_id WHERE cm.actor_ap_id = OLD.actor_ap_id AND cm.community_ap_id = OLD.target_ap_id AND c.deleted_at IS NULL))
BEGIN
  SELECT RAISE(ABORT, 'account deletion reserved');
END;
CREATE TRIGGER IF NOT EXISTS account_deletion_talk_message_reads_insert
BEFORE INSERT ON talk_message_reads
WHEN EXISTS (SELECT 1 FROM account_deletion_targets target
    WHERE (target.actor_ap_id = NEW.actor_ap_id) AND NOT EXISTS (SELECT 1 FROM actor_write_assertions marker
      WHERE marker.operation_id = target.operation_id))
BEGIN
  SELECT RAISE(ABORT, 'account deletion reserved');
END;
CREATE TRIGGER IF NOT EXISTS account_deletion_talk_message_reads_update
BEFORE UPDATE ON talk_message_reads
WHEN EXISTS (SELECT 1 FROM account_deletion_targets target
    WHERE (target.actor_ap_id = OLD.actor_ap_id OR target.actor_ap_id = NEW.actor_ap_id) AND NOT EXISTS (SELECT 1 FROM actor_write_assertions marker
      WHERE marker.operation_id = target.operation_id))
BEGIN
  SELECT RAISE(ABORT, 'account deletion reserved');
END;
CREATE TRIGGER IF NOT EXISTS account_deletion_talk_message_reads_delete
BEFORE DELETE ON talk_message_reads
WHEN EXISTS (SELECT 1 FROM account_deletion_targets target
    WHERE (target.actor_ap_id = OLD.actor_ap_id) AND NOT EXISTS (SELECT 1 FROM actor_write_assertions marker
      WHERE marker.operation_id = target.operation_id)) AND EXISTS (SELECT 1 FROM actors WHERE ap_id = OLD.actor_ap_id) AND EXISTS (SELECT 1 FROM objects WHERE ap_id = OLD.object_ap_id AND deleted_at IS NULL) AND (OLD.kind = 'user' OR EXISTS (SELECT 1 FROM community_members cm JOIN communities c ON c.ap_id = cm.community_ap_id WHERE cm.actor_ap_id = OLD.actor_ap_id AND cm.community_ap_id = OLD.target_ap_id AND c.deleted_at IS NULL))
BEGIN
  SELECT RAISE(ABORT, 'account deletion reserved');
END;

-- New archive writes are peer-scoped. Keep every original coarse marker;
-- only an authenticated explicit operation atomically seeds current peers and
-- records expansion. Merely applying this file changes no archive visibility.
CREATE TABLE IF NOT EXISTS dm_peer_archived_conversations (
  actor_ap_id TEXT NOT NULL,
  target_ap_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  archived_at TEXT NOT NULL,
  PRIMARY KEY (actor_ap_id, target_ap_id)
);
CREATE TABLE IF NOT EXISTS dm_archive_expansions (
  actor_ap_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  expanded_at TEXT NOT NULL,
  PRIMARY KEY (actor_ap_id, conversation_id)
);
CREATE TRIGGER IF NOT EXISTS talk_peer_archives_actor_delete AFTER DELETE ON actors
BEGIN
  DELETE FROM dm_peer_archived_conversations WHERE actor_ap_id = OLD.ap_id;
  DELETE FROM dm_archive_expansions WHERE actor_ap_id = OLD.ap_id;
END;
CREATE TRIGGER IF NOT EXISTS account_deletion_dm_peer_archived_conversations_insert
BEFORE INSERT ON dm_peer_archived_conversations
WHEN EXISTS (SELECT 1 FROM account_deletion_targets target
    WHERE (target.actor_ap_id = NEW.actor_ap_id) AND NOT EXISTS (SELECT 1 FROM actor_write_assertions marker
      WHERE marker.operation_id = target.operation_id))
BEGIN
  SELECT RAISE(ABORT, 'account deletion reserved');
END;
CREATE TRIGGER IF NOT EXISTS account_deletion_dm_peer_archived_conversations_update
BEFORE UPDATE ON dm_peer_archived_conversations
WHEN EXISTS (SELECT 1 FROM account_deletion_targets target
    WHERE (target.actor_ap_id = OLD.actor_ap_id OR target.actor_ap_id = NEW.actor_ap_id) AND NOT EXISTS (SELECT 1 FROM actor_write_assertions marker
      WHERE marker.operation_id = target.operation_id))
BEGIN
  SELECT RAISE(ABORT, 'account deletion reserved');
END;
CREATE TRIGGER IF NOT EXISTS account_deletion_dm_peer_archived_conversations_delete
BEFORE DELETE ON dm_peer_archived_conversations
WHEN EXISTS (SELECT 1 FROM account_deletion_targets target
    WHERE (target.actor_ap_id = OLD.actor_ap_id) AND NOT EXISTS (SELECT 1 FROM actor_write_assertions marker
      WHERE marker.operation_id = target.operation_id)) AND EXISTS (SELECT 1 FROM actors WHERE ap_id = OLD.actor_ap_id)
BEGIN
  SELECT RAISE(ABORT, 'account deletion reserved');
END;
CREATE TRIGGER IF NOT EXISTS account_deletion_dm_archive_expansions_insert
BEFORE INSERT ON dm_archive_expansions
WHEN EXISTS (SELECT 1 FROM account_deletion_targets target
    WHERE (target.actor_ap_id = NEW.actor_ap_id) AND NOT EXISTS (SELECT 1 FROM actor_write_assertions marker
      WHERE marker.operation_id = target.operation_id))
BEGIN
  SELECT RAISE(ABORT, 'account deletion reserved');
END;
CREATE TRIGGER IF NOT EXISTS account_deletion_dm_archive_expansions_update
BEFORE UPDATE ON dm_archive_expansions
WHEN EXISTS (SELECT 1 FROM account_deletion_targets target
    WHERE (target.actor_ap_id = OLD.actor_ap_id OR target.actor_ap_id = NEW.actor_ap_id) AND NOT EXISTS (SELECT 1 FROM actor_write_assertions marker
      WHERE marker.operation_id = target.operation_id))
BEGIN
  SELECT RAISE(ABORT, 'account deletion reserved');
END;
CREATE TRIGGER IF NOT EXISTS account_deletion_dm_archive_expansions_delete
BEFORE DELETE ON dm_archive_expansions
WHEN EXISTS (SELECT 1 FROM account_deletion_targets target
    WHERE (target.actor_ap_id = OLD.actor_ap_id) AND NOT EXISTS (SELECT 1 FROM actor_write_assertions marker
      WHERE marker.operation_id = target.operation_id)) AND EXISTS (SELECT 1 FROM actors WHERE ap_id = OLD.actor_ap_id)
BEGIN
  SELECT RAISE(ABORT, 'account deletion reserved');
END;
