-- B0.3 — give Stories a community scope dimension.
--
-- Stories are stored in the shared `objects` table (type='Story'). That table
-- already carries `community_ap_id` (added in 0001 for community-scoped posts),
-- so no column change is required: a community story simply sets it, a personal
-- story leaves it NULL.
--
-- The new read path filters active community stories by
--   (type='Story' AND community_ap_id=? AND end_time>?)
-- so add a covering index for it. Idempotent: re-applying is a no-op.

CREATE INDEX IF NOT EXISTS idx_objects_type_community_end
  ON objects(type, community_ap_id, end_time);
