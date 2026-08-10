-- Durable first-hop outbox for outbound recipients whose inbox endpoint is not
-- yet known. Queue publication is not durable evidence: the producer RPC can
-- fail after the Activity has committed and before delivery_queue has an
-- endpoint job. Retain the (activity, recipient) intent until resolution has
-- either produced that endpoint job or reached a bounded terminal state.
--
-- No foreign keys: Activity deletion owns explicit projection cleanup, matching
-- delivery_queue and the rest of the production D1-safe federation ledger.
CREATE TABLE IF NOT EXISTS delivery_resolutions (
  id TEXT PRIMARY KEY,
  activity_ap_id TEXT NOT NULL,
  recipient_actor_ap_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  processing_token TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  resolved_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS delivery_resolutions_activity_actor_idx
  ON delivery_resolutions(activity_ap_id, recipient_actor_ap_id);

CREATE INDEX IF NOT EXISTS delivery_resolutions_status_next_idx
  ON delivery_resolutions(status, next_attempt_at);

CREATE INDEX IF NOT EXISTS delivery_resolutions_terminal_retention_idx
  ON delivery_resolutions(status, updated_at);

CREATE INDEX IF NOT EXISTS delivery_resolutions_activity_idx
  ON delivery_resolutions(activity_ap_id);
