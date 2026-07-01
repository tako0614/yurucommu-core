-- Activity records mirror ActivityPub payloads. actor_ap_id and object_ap_id
-- can point at remote actors/objects, so they must remain plain AP-ID strings
-- rather than local-table foreign keys.

PRAGMA foreign_keys = OFF;

CREATE TABLE IF NOT EXISTS activities (
  ap_id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  actor_ap_id TEXT NOT NULL,
  object_ap_id TEXT,
  object_json TEXT,
  target_ap_id TEXT,
  raw_json TEXT NOT NULL,
  direction TEXT,
  processed INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS activities_new (
  ap_id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  actor_ap_id TEXT NOT NULL,
  object_ap_id TEXT,
  object_json TEXT,
  target_ap_id TEXT,
  raw_json TEXT NOT NULL,
  direction TEXT,
  processed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO activities_new (
  ap_id,
  type,
  actor_ap_id,
  object_ap_id,
  object_json,
  target_ap_id,
  raw_json,
  direction,
  processed,
  created_at
)
SELECT
  ap_id,
  type,
  actor_ap_id,
  object_ap_id,
  object_json,
  target_ap_id,
  raw_json,
  direction,
  COALESCE(processed, 0),
  COALESCE(created_at, datetime('now'))
FROM activities;

DROP TABLE activities;
ALTER TABLE activities_new RENAME TO activities;

CREATE INDEX IF NOT EXISTS idx_activities_actor ON activities(actor_ap_id);
CREATE INDEX IF NOT EXISTS idx_activities_object ON activities(object_ap_id);
CREATE INDEX IF NOT EXISTS idx_activities_type ON activities(type);
CREATE INDEX IF NOT EXISTS idx_activities_type_created ON activities(type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activities_direction_processed ON activities(direction, processed);
CREATE INDEX IF NOT EXISTS idx_activities_direction_processed_created ON activities(direction, processed, created_at);

PRAGMA foreign_keys = ON;
