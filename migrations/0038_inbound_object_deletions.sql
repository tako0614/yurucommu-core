-- A verified remote Delete is terminal for that actor's object identity.
-- No FK or age-based expiry: object/Activity/cache cleanup must not erase the
-- evidence that keeps a late Create from resurrecting deleted content.
-- Existing activities (including processed no-ops) are not backfilled.
CREATE TABLE IF NOT EXISTS inbound_object_deletions (
  actor_ap_id TEXT NOT NULL,
  object_ap_id TEXT NOT NULL,
  delete_activity_ap_id TEXT,
  deleted_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (actor_ap_id, object_ap_id)
);
