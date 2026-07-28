-- Fence concurrent/retried ActivityPub inbox dispatches.
--
-- `activities.processed = 0` says an activity is retryable, but it does not say
-- whether another Worker is actively dispatching it. Keeping the lease in a
-- separate table preserves the public activities ledger shape and lets a
-- crashed owner expire without allowing an old owner to commit over a newer
-- retry.

CREATE TABLE IF NOT EXISTS inbound_activity_claims (
  activity_ap_id TEXT PRIMARY KEY,
  processing_token TEXT,
  lease_expires_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS inbound_activity_claims_lease_idx
  ON inbound_activity_claims(lease_expires_at);
