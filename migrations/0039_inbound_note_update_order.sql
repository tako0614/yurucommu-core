-- Only new, explicitly admitted Note Update patches enter this state. Historical
-- processed Activities are not validated projections and are not backfilled.
-- No actor/object/Activity FK may erase retry order or make a retained event new.
CREATE TABLE IF NOT EXISTS inbound_note_update_events (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  activity_ap_id TEXT NOT NULL,
  actor_ap_id TEXT NOT NULL,
  object_ap_id TEXT NOT NULL,
  patch_json TEXT CHECK (patch_json IS NULL OR json_valid(patch_json))
);
CREATE UNIQUE INDEX IF NOT EXISTS inbound_note_update_event_activity_idx
  ON inbound_note_update_events(activity_ap_id);
CREATE INDEX IF NOT EXISTS inbound_note_update_event_object_sequence_idx
  ON inbound_note_update_events(actor_ap_id, object_ap_id, sequence);
CREATE TABLE IF NOT EXISTS inbound_note_update_heads (
  actor_ap_id TEXT NOT NULL,
  object_ap_id TEXT NOT NULL,
  applied_sequence INTEGER NOT NULL DEFAULT 0 CHECK (applied_sequence >= 0),
  creation_activity_ap_id TEXT,
  PRIMARY KEY (actor_ap_id, object_ap_id)
);
