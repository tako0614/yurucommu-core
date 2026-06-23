-- Durable per-community bans. Removing a member only deleted their membership
-- state, with no record — so a kicked user could immediately re-join an OPEN
-- community (local re-POST /join, or a remote re-Follow that auto-Accepts). A
-- ban row makes a removal stick: the local join route and the inbound Group
-- Follow handler consult it, and explicit re-admission (approve / invite / add)
-- clears it. No FK to actors (a banned actor may be REMOTE, with no local
-- actors row — same rationale as the other remote-actor-referencing tables).
CREATE TABLE IF NOT EXISTS community_bans (
  community_ap_id TEXT NOT NULL,
  banned_ap_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (community_ap_id, banned_ap_id)
);

CREATE INDEX IF NOT EXISTS community_bans_banned_idx
  ON community_bans (banned_ap_id);
