-- Track per-viewer read position for community (group) chats so the DM contact
-- list can show an unread badge for communities, mirroring `dm_read_status`
-- for one-to-one DMs.
--
-- A row records the most recent moment `actor_ap_id` read messages in
-- `community_ap_id`. Community unread = messages in the community published
-- after `last_read_at` that the viewer did not author. Absence of a row means
-- the viewer has never opened that community chat (treated as "read from epoch"
-- on the read path so a brand-new join does not surface a stale badge — the
-- contacts handler clamps the baseline to the join time). Idempotent.
CREATE TABLE IF NOT EXISTS dm_community_read_status (
  actor_ap_id TEXT NOT NULL,
  community_ap_id TEXT NOT NULL,
  last_read_at TEXT NOT NULL,
  PRIMARY KEY (actor_ap_id, community_ap_id)
);

CREATE INDEX IF NOT EXISTS dm_community_read_status_actor_idx
  ON dm_community_read_status(actor_ap_id);
