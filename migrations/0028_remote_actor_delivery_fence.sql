-- A verified remote Actor Delete is durable recipient authority. Keep the
-- fence at the delivery_resolutions write boundary so every caller, including
-- a stale fanout page or endpoint-invalidation replay, converges under either
-- serialization order:
--   1. resolution INSERT first -> the Actor Delete batch removes it;
--   2. tombstone first -> this trigger removes the inserted row atomically.
--
-- AFTER INSERT + targeted DELETE is deliberate. It applies independently to
-- every row in a multi-row INSERT without aborting unrelated recipients that
-- may share the same fanout page.
CREATE TRIGGER IF NOT EXISTS delivery_resolutions_remote_tombstone_fence
AFTER INSERT ON delivery_resolutions
WHEN EXISTS (
  SELECT 1
  FROM remote_actor_tombstones
  WHERE actor_ap_id = NEW.recipient_actor_ap_id
)
BEGIN
  DELETE FROM delivery_resolutions WHERE id = NEW.id;
END;

-- Converge any row that was written after 0027 established a tombstone but
-- before this fence was installed. These jobs must not contact a self-deleted
-- identity; processResolveActor already treats that state as terminal.
DELETE FROM delivery_resolutions
WHERE EXISTS (
  SELECT 1
  FROM remote_actor_tombstones
  WHERE actor_ap_id = delivery_resolutions.recipient_actor_ap_id
);
