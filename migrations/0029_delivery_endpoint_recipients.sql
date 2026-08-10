-- Endpoint jobs aggregate by (Activity, inbox endpoint), especially when
-- several remote actors share one inbox. Retain the recipient identities that
-- justified each NEW job so a later verified Actor Delete can remove only that
-- actor and cancel the endpoint job only when no live recipient remains.
--
-- Existing jobs predate this authority and cannot be reconstructed safely.
-- Keep them explicitly unattributed (0); new materialization sets the flag to
-- 1 only when it creates the job under the recipient-aware implementation.
ALTER TABLE delivery_queue
  ADD COLUMN recipient_attribution_complete INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS delivery_endpoint_recipients (
  delivery_job_id TEXT NOT NULL,
  recipient_actor_ap_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (delivery_job_id, recipient_actor_ap_id)
);

CREATE INDEX IF NOT EXISTS delivery_endpoint_recipients_actor_idx
  ON delivery_endpoint_recipients(recipient_actor_ap_id, delivery_job_id);

-- Projection cleanup is owned by delivery_queue deletion. Avoid a foreign key:
-- the engine's production D1 schema uses explicit projection cleanup so remote
-- identities and migration rebuilds do not diverge between runtimes.
CREATE TRIGGER IF NOT EXISTS delivery_endpoint_recipients_after_job_delete
AFTER DELETE ON delivery_queue
BEGIN
  DELETE FROM delivery_endpoint_recipients
  WHERE delivery_job_id = OLD.id;
END;

-- The attribution write is itself race-fenced. If Delete won before a stale
-- planner/materializer batch, strip only the deleted actor's mapping; the
-- materializer's final empty-job cleanup then decides whether the endpoint job
-- still represents another recipient.
CREATE TRIGGER IF NOT EXISTS delivery_endpoint_recipients_remote_tombstone_fence
AFTER INSERT ON delivery_endpoint_recipients
WHEN EXISTS (
  SELECT 1
  FROM remote_actor_tombstones
  WHERE actor_ap_id = NEW.recipient_actor_ap_id
)
BEGIN
  DELETE FROM delivery_endpoint_recipients
  WHERE delivery_job_id = NEW.delivery_job_id
    AND recipient_actor_ap_id = NEW.recipient_actor_ap_id;
END;
