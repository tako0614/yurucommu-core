-- Issue 067/068 hardening
-- - Session access token uniqueness/index safety
-- - Missing indexes for notification archive / delivery queue / community members

-- Keep the newest session row per access token before adding uniqueness.
DELETE FROM sessions
WHERE rowid IN (
  SELECT older.rowid
  FROM sessions AS older
  JOIN sessions AS newer
    ON older.access_token = newer.access_token
   AND older.rowid < newer.rowid
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_access_token_unique
  ON sessions(access_token);

CREATE INDEX IF NOT EXISTS idx_notification_archived_actor_archived_at
  ON notification_archived(actor_ap_id, archived_at);

CREATE INDEX IF NOT EXISTS idx_delivery_queue_activity_ap_id
  ON delivery_queue(activity_ap_id);

CREATE INDEX IF NOT EXISTS idx_community_members_community_role_joined_at
  ON community_members(community_ap_id, role, joined_at);
