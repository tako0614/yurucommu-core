-- A verified inbound Delete(Actor) is durable lifecycle authority, not a
-- transient actor-document fetch failure. Keep it separate from both
-- actor_cache and remote_actor_fetch_failures so a late successful fetch
-- cannot recreate an identity after its teardown committed.
--
-- Additive only: protected existing data and prior migration history remain
-- untouched. Remote actor IDs intentionally have no actors/actor_cache FK.
CREATE TABLE IF NOT EXISTS remote_actor_tombstones (
  actor_ap_id TEXT PRIMARY KEY,
  delete_activity_ap_id TEXT NOT NULL,
  deleted_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
