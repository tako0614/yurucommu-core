-- Add owner-scoped history without rebuilding or backfilling applied history.
-- Old writers must be closed before serving the corresponding engine.
CREATE TABLE IF NOT EXISTS actor_call_sessions (
  id TEXT NOT NULL,
  local_actor_ap_id TEXT NOT NULL,
  peer_actor_ap_id TEXT NOT NULL,
  direction TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'ringing',
  media_audio INTEGER NOT NULL DEFAULT 1,
  media_video INTEGER NOT NULL DEFAULT 0,
  sfu_focus TEXT,
  peer_signal_endpoint TEXT,
  end_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  connected_at TEXT,
  ended_at TEXT,
  PRIMARY KEY (local_actor_ap_id, id),
  FOREIGN KEY (local_actor_ap_id) REFERENCES actors(ap_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS actor_call_sessions_local_created_idx
  ON actor_call_sessions(local_actor_ap_id, created_at);
CREATE INDEX IF NOT EXISTS actor_call_sessions_state_idx
  ON actor_call_sessions(state);

-- Preserve the same owner/peer deletion reservations as legacy history.
CREATE TRIGGER IF NOT EXISTS account_deletion_actor_call_sessions_insert
BEFORE INSERT ON actor_call_sessions
WHEN EXISTS (
  SELECT 1 FROM account_deletion_targets AS target
  WHERE target.actor_ap_id IN (NEW.local_actor_ap_id, NEW.peer_actor_ap_id)
    AND NOT EXISTS (
      SELECT 1 FROM actor_write_assertions AS marker
      WHERE marker.operation_id = target.operation_id
    )
)
BEGIN
  SELECT RAISE(ABORT, 'account deletion reserved');
END;

CREATE TRIGGER IF NOT EXISTS account_deletion_actor_call_sessions_update
BEFORE UPDATE ON actor_call_sessions
WHEN EXISTS (
  SELECT 1 FROM account_deletion_targets AS target
  WHERE (target.actor_ap_id IN (OLD.local_actor_ap_id, OLD.peer_actor_ap_id)
    OR target.actor_ap_id IN (NEW.local_actor_ap_id, NEW.peer_actor_ap_id))
    AND NOT EXISTS (
      SELECT 1 FROM actor_write_assertions AS marker
      WHERE marker.operation_id = target.operation_id
    )
)
BEGIN
  SELECT RAISE(ABORT, 'account deletion reserved');
END;

CREATE TRIGGER IF NOT EXISTS account_deletion_actor_call_sessions_delete
BEFORE DELETE ON actor_call_sessions
WHEN EXISTS (
  SELECT 1 FROM account_deletion_targets AS target
  WHERE target.actor_ap_id IN (OLD.local_actor_ap_id, OLD.peer_actor_ap_id)
) AND NOT EXISTS (
  SELECT 1 FROM actor_write_assertions AS marker
  WHERE marker.operation_id IN (
    SELECT target.operation_id FROM account_deletion_targets AS target
    WHERE target.actor_ap_id IN (OLD.local_actor_ap_id, OLD.peer_actor_ap_id)
  )
)
BEGIN
  SELECT RAISE(ABORT, 'account deletion reserved');
END;
