-- DM typing indicator support

CREATE TABLE IF NOT EXISTS dm_typing (
  actor_ap_id TEXT NOT NULL,
  recipient_ap_id TEXT NOT NULL,
  last_typed_at TEXT NOT NULL,
  PRIMARY KEY (actor_ap_id, recipient_ap_id)
);

CREATE INDEX IF NOT EXISTS idx_dm_typing_recipient ON dm_typing(recipient_ap_id, last_typed_at DESC);
