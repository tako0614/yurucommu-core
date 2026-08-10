-- A missing actor_cache row can still be referenced by a durable remote
-- Follow edge. Profile recovery must distinguish terminal Gone from transient
-- network/remote failures without re-fetching the same hostile or unavailable
-- actor on every local page view. Keep that negative-cache/backoff authority
-- separate from actor_cache so a failure can never masquerade as an actor.
--
-- Additive only: protected existing data and prior migration history remain
-- untouched. Remote actor IDs intentionally have no actors/actor_cache FK.
CREATE TABLE IF NOT EXISTS remote_actor_fetch_failures (
  actor_ap_id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  reason TEXT NOT NULL,
  http_status INTEGER,
  failure_count INTEGER NOT NULL DEFAULT 1,
  retry_at TEXT,
  processing_token TEXT,
  lease_expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS remote_actor_fetch_failures_retry_idx
  ON remote_actor_fetch_failures(retry_at);

CREATE INDEX IF NOT EXISTS remote_actor_fetch_failures_lease_idx
  ON remote_actor_fetch_failures(lease_expires_at);

CREATE INDEX IF NOT EXISTS remote_actor_fetch_failures_updated_idx
  ON remote_actor_fetch_failures(updated_at);
