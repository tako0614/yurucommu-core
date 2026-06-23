-- Notification-list index (2026-06-23).
--
-- GET /api/notifications (the most-polled endpoint — list + badge) drives from
-- `inbox` with WHERE actor_ap_id = ? (no constraint on `read`) ORDER BY
-- created_at DESC, activity_ap_id DESC. The only inbox index
-- (actor_ap_id, read, created_at) cannot serve that ORDER BY: the unconstrained
-- `read` column sits BETWEEN the equality prefix and the sort key, so SQLite can
-- only use the actor_ap_id = prefix and must then FILESORT the matched rows
-- (a near-full inbox scan + temp B-tree on every poll). The unread COUNT query
-- (which DOES constrain read = 0) keeps using the existing index and is unaffected.
--
-- This composite covers the equality + both sort columns so the list query seeks
-- by actor and reads in (created_at, activity_ap_id) order with no filesort.
CREATE INDEX IF NOT EXISTS inbox_actor_created_idx
  ON inbox (actor_ap_id, created_at, activity_ap_id);
