CREATE TABLE IF NOT EXISTS call_sessions (
  id TEXT PRIMARY KEY,
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
  FOREIGN KEY (local_actor_ap_id) REFERENCES actors(ap_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS call_sessions_local_created_idx
  ON call_sessions(local_actor_ap_id, created_at);

CREATE INDEX IF NOT EXISTS call_sessions_state_idx
  ON call_sessions(state);
