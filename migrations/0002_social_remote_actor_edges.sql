-- Social edge tables store ActivityPub actor IDs. Either side can be a
-- remote actor cached in actor_cache, so physical FKs to local actors block
-- federation under SQLite/D1 foreign-key enforcement.

CREATE TABLE IF NOT EXISTS follows_new (
  follower_ap_id TEXT NOT NULL,
  following_ap_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  activity_ap_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  accepted_at TEXT,
  PRIMARY KEY (follower_ap_id, following_ap_id)
);

INSERT OR IGNORE INTO follows_new (
  follower_ap_id,
  following_ap_id,
  status,
  activity_ap_id,
  created_at,
  accepted_at
)
SELECT
  follower_ap_id,
  following_ap_id,
  COALESCE(status, 'pending'),
  activity_ap_id,
  COALESCE(created_at, datetime('now')),
  accepted_at
FROM follows;

DROP TABLE follows;
ALTER TABLE follows_new RENAME TO follows;

CREATE INDEX IF NOT EXISTS idx_follows_follower_status ON follows(follower_ap_id, status);
CREATE INDEX IF NOT EXISTS idx_follows_following_status ON follows(following_ap_id, status);
CREATE INDEX IF NOT EXISTS idx_follows_following_created ON follows(following_ap_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_follows_activity ON follows(activity_ap_id);

CREATE TABLE IF NOT EXISTS blocks_new (
  blocker_ap_id TEXT NOT NULL,
  blocked_ap_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (blocker_ap_id, blocked_ap_id)
);

INSERT OR IGNORE INTO blocks_new (
  blocker_ap_id,
  blocked_ap_id,
  created_at,
  updated_at
)
SELECT
  blocker_ap_id,
  blocked_ap_id,
  COALESCE(created_at, datetime('now')),
  updated_at
FROM blocks;

DROP TABLE blocks;
ALTER TABLE blocks_new RENAME TO blocks;

CREATE INDEX IF NOT EXISTS idx_blocks_blocker ON blocks(blocker_ap_id);
CREATE INDEX IF NOT EXISTS idx_blocks_blocked ON blocks(blocked_ap_id);

CREATE TABLE IF NOT EXISTS mutes_new (
  muter_ap_id TEXT NOT NULL,
  muted_ap_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (muter_ap_id, muted_ap_id)
);

INSERT OR IGNORE INTO mutes_new (
  muter_ap_id,
  muted_ap_id,
  created_at,
  updated_at
)
SELECT
  muter_ap_id,
  muted_ap_id,
  COALESCE(created_at, datetime('now')),
  updated_at
FROM mutes;

DROP TABLE mutes;
ALTER TABLE mutes_new RENAME TO mutes;

CREATE INDEX IF NOT EXISTS idx_mutes_muter ON mutes(muter_ap_id);
CREATE INDEX IF NOT EXISTS idx_mutes_muted ON mutes(muted_ap_id);
