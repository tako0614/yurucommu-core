-- Community join requests and invites for join_policy enforcement

CREATE TABLE IF NOT EXISTS community_join_requests (
  community_ap_id TEXT NOT NULL,
  actor_ap_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected')),
  created_at TEXT DEFAULT (datetime('now')),
  processed_at TEXT,
  PRIMARY KEY (community_ap_id, actor_ap_id)
);

CREATE INDEX IF NOT EXISTS idx_community_join_requests_community
  ON community_join_requests(community_ap_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_community_join_requests_actor
  ON community_join_requests(actor_ap_id, status);

CREATE TABLE IF NOT EXISTS community_invites (
  id TEXT PRIMARY KEY,
  community_ap_id TEXT NOT NULL,
  invited_by_ap_id TEXT NOT NULL,
  invited_ap_id TEXT,
  used_by_ap_id TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  used_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_community_invites_community
  ON community_invites(community_ap_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_community_invites_used
  ON community_invites(used_at);
