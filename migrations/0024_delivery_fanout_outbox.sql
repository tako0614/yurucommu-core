-- Durable first-hop outbox for follower/community fanout. The Activity is
-- committed before the initial Queue RPC, so a producer outage must leave a
-- recoverable intent instead of silently losing every recipient plan.
--
-- Queue messages are wakeups. Retain the intent through publication until the
-- final fanout page completes; this also lets the Bun self-host rebuild its
-- in-memory queue after a process restart.
--
-- No foreign keys: Activity deletion owns explicit projection cleanup, matching
-- delivery_queue and delivery_resolutions on production D1.
CREATE TABLE IF NOT EXISTS delivery_fanouts (
  id TEXT PRIMARY KEY,
  activity_ap_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  target_ap_id TEXT NOT NULL,
  announce_activity_ap_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  publications INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  completed_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS delivery_fanouts_intent_idx
  ON delivery_fanouts(activity_ap_id, kind, target_ap_id, announce_activity_ap_id);

CREATE INDEX IF NOT EXISTS delivery_fanouts_status_created_idx
  ON delivery_fanouts(status, created_at);

CREATE INDEX IF NOT EXISTS delivery_fanouts_terminal_retention_idx
  ON delivery_fanouts(status, updated_at);

CREATE INDEX IF NOT EXISTS delivery_fanouts_activity_idx
  ON delivery_fanouts(activity_ap_id);
