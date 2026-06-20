-- 0011: drop the stale `REFERENCES actors(ap_id)` foreign keys that block
-- INBOUND federation, WITHOUT cascade-deleting child rows.
--
-- Remote actors live ONLY in `actor_cache`, never in `actors`. The inbound
-- handlers store a remote actor's Note in `objects` (attributed_to = remote),
-- their Like in `likes`, their Announce in `announces`, story interactions in
-- `story_*`, and the raw activity in `inbox` — all keyed by a remote actor that
-- is absent from `actors`. 0001_init.sql declared these columns with
-- `REFERENCES actors(ap_id)`; 0002/0003 stripped the equivalent FKs from
-- follows/blocks/mutes/activities but missed these tables. Cloudflare D1
-- ENFORCES foreign keys (the "D1 ignores FK" assumption is wrong), so every
-- inbound remote post/like/boost/story insert fails with a foreign-key
-- violation. The Drizzle schema declares NO foreign keys at all.
--
-- CRITICAL ordering: `objects` is referenced by likes / announces / bookmarks /
-- object_recipients / story_views / story_votes / story_shares with
-- `ON DELETE CASCADE`. On D1 (which will not honour `PRAGMA foreign_keys=OFF`)
-- a DROP of `objects` performs an implicit DELETE that FIRES those cascades and
-- wipes the child rows. So every child is rebuilt FIRST to drop its FK to
-- `objects` (and its actor FK), and only then is `objects` itself rebuilt — by
-- which point no surviving table has a cascade edge into it. All row data is
-- copied through every rebuild. This matches the Drizzle schema (zero FKs);
-- application code already manages cascades (routes/posts/delete-cascade.ts).

PRAGMA defer_foreign_keys = TRUE;

-- ---- children of objects: rebuilt first, dropping ALL their FKs ----

-- likes
CREATE TABLE likes_new (
  actor_ap_id TEXT NOT NULL,
  object_ap_id TEXT NOT NULL,
  activity_ap_id TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (actor_ap_id, object_ap_id)
);
INSERT INTO likes_new (actor_ap_id, object_ap_id, activity_ap_id, created_at)
  SELECT actor_ap_id, object_ap_id, activity_ap_id, created_at FROM likes;
DROP TABLE likes;
ALTER TABLE likes_new RENAME TO likes;
CREATE INDEX idx_likes_object ON likes(object_ap_id);
CREATE INDEX idx_likes_actor ON likes(actor_ap_id);
CREATE INDEX idx_likes_actor_object ON likes(actor_ap_id, object_ap_id);

-- announces
CREATE TABLE announces_new (
  actor_ap_id TEXT NOT NULL,
  object_ap_id TEXT NOT NULL,
  activity_ap_id TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (actor_ap_id, object_ap_id)
);
INSERT INTO announces_new (actor_ap_id, object_ap_id, activity_ap_id, created_at)
  SELECT actor_ap_id, object_ap_id, activity_ap_id, created_at FROM announces;
DROP TABLE announces;
ALTER TABLE announces_new RENAME TO announces;
CREATE INDEX idx_announces_object ON announces(object_ap_id);
CREATE INDEX idx_announces_actor ON announces(actor_ap_id);
CREATE INDEX idx_announces_actor_object ON announces(actor_ap_id, object_ap_id);

-- bookmarks
CREATE TABLE bookmarks_new (
  actor_ap_id TEXT NOT NULL,
  object_ap_id TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (actor_ap_id, object_ap_id)
);
INSERT INTO bookmarks_new (actor_ap_id, object_ap_id, created_at)
  SELECT actor_ap_id, object_ap_id, created_at FROM bookmarks;
DROP TABLE bookmarks;
ALTER TABLE bookmarks_new RENAME TO bookmarks;
CREATE INDEX idx_bookmarks_actor ON bookmarks(actor_ap_id);

-- story_views
CREATE TABLE story_views_new (
  actor_ap_id TEXT NOT NULL,
  story_ap_id TEXT NOT NULL,
  viewed_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (actor_ap_id, story_ap_id)
);
INSERT INTO story_views_new (actor_ap_id, story_ap_id, viewed_at)
  SELECT actor_ap_id, story_ap_id, viewed_at FROM story_views;
DROP TABLE story_views;
ALTER TABLE story_views_new RENAME TO story_views;
CREATE INDEX idx_story_views_actor ON story_views(actor_ap_id);
CREATE INDEX idx_story_views_story ON story_views(story_ap_id);

-- story_votes
CREATE TABLE story_votes_new (
  id TEXT PRIMARY KEY,
  story_ap_id TEXT NOT NULL,
  actor_ap_id TEXT NOT NULL,
  option_index INTEGER NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(story_ap_id, actor_ap_id)
);
INSERT INTO story_votes_new (id, story_ap_id, actor_ap_id, option_index, created_at)
  SELECT id, story_ap_id, actor_ap_id, option_index, created_at FROM story_votes;
DROP TABLE story_votes;
ALTER TABLE story_votes_new RENAME TO story_votes;
CREATE INDEX idx_story_votes_story ON story_votes(story_ap_id);
CREATE INDEX idx_story_votes_actor ON story_votes(actor_ap_id);

-- story_shares
CREATE TABLE story_shares_new (
  id TEXT PRIMARY KEY,
  story_ap_id TEXT NOT NULL,
  actor_ap_id TEXT NOT NULL,
  shared_at TEXT DEFAULT (datetime('now')),
  UNIQUE(story_ap_id, actor_ap_id)
);
INSERT INTO story_shares_new (id, story_ap_id, actor_ap_id, shared_at)
  SELECT id, story_ap_id, actor_ap_id, shared_at FROM story_shares;
DROP TABLE story_shares;
ALTER TABLE story_shares_new RENAME TO story_shares;
CREATE INDEX idx_story_shares_story ON story_shares(story_ap_id);
CREATE INDEX idx_story_shares_actor ON story_shares(actor_ap_id);

-- object_recipients (0010 already dropped its actors FK; drop the objects FK too
-- so it is not a cascade edge into objects)
CREATE TABLE object_recipients_new (
  object_ap_id TEXT NOT NULL,
  recipient_ap_id TEXT NOT NULL,
  type TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (object_ap_id, recipient_ap_id)
);
INSERT INTO object_recipients_new (object_ap_id, recipient_ap_id, type, created_at)
  SELECT object_ap_id, recipient_ap_id, type, created_at FROM object_recipients;
DROP TABLE object_recipients;
ALTER TABLE object_recipients_new RENAME TO object_recipients;
CREATE INDEX idx_object_recipients_recipient
  ON object_recipients(recipient_ap_id, created_at DESC);

-- ---- objects: rebuilt last, now that no surviving table cascades into it ----
-- drop attributed_to -> actors; keep community_ap_id -> communities.
CREATE TABLE objects_new (
  ap_id TEXT PRIMARY KEY,
  type TEXT NOT NULL DEFAULT 'Note',
  attributed_to TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  summary TEXT,
  attachments_json TEXT DEFAULT '[]',
  in_reply_to TEXT,
  conversation TEXT,
  visibility TEXT DEFAULT 'public',
  to_json TEXT DEFAULT '[]',
  cc_json TEXT DEFAULT '[]',
  audience_json TEXT DEFAULT '[]',
  community_ap_id TEXT REFERENCES communities(ap_id) ON DELETE SET NULL,
  end_time TEXT,
  like_count INTEGER DEFAULT 0,
  reply_count INTEGER DEFAULT 0,
  announce_count INTEGER DEFAULT 0,
  share_count INTEGER DEFAULT 0,
  published TEXT DEFAULT (datetime('now')),
  updated TEXT,
  is_local INTEGER DEFAULT 1,
  raw_json TEXT,
  deleted_at TEXT,
  tags_json TEXT NOT NULL DEFAULT '[]'
);
INSERT INTO objects_new (
  ap_id, type, attributed_to, content, summary, attachments_json, in_reply_to,
  conversation, visibility, to_json, cc_json, audience_json, community_ap_id,
  end_time, like_count, reply_count, announce_count, share_count, published,
  updated, is_local, raw_json, deleted_at, tags_json
)
SELECT
  ap_id, type, attributed_to, content, summary, attachments_json, in_reply_to,
  conversation, visibility, to_json, cc_json, audience_json, community_ap_id,
  end_time, like_count, reply_count, announce_count, share_count, published,
  updated, is_local, raw_json, deleted_at, tags_json
FROM objects;
DROP TABLE objects;
ALTER TABLE objects_new RENAME TO objects;
CREATE INDEX idx_objects_attributed_to ON objects(attributed_to);
CREATE INDEX idx_objects_in_reply_to ON objects(in_reply_to);
CREATE INDEX idx_objects_community_ap_id ON objects(community_ap_id);
CREATE INDEX idx_objects_published ON objects(published DESC);
CREATE INDEX idx_objects_visibility ON objects(visibility);
CREATE INDEX idx_objects_end_time ON objects(end_time);
CREATE INDEX idx_objects_deleted_at ON objects(deleted_at);
CREATE INDEX idx_objects_attributed_to_published ON objects(attributed_to, published DESC);
CREATE INDEX idx_objects_visibility_published ON objects(visibility, published DESC);
CREATE INDEX idx_objects_type_visibility_published ON objects(type, visibility, published DESC);
CREATE INDEX idx_objects_conversation ON objects(conversation);
CREATE INDEX idx_objects_community_published ON objects(community_ap_id, published DESC);
CREATE INDEX idx_objects_is_local ON objects(is_local);
CREATE INDEX idx_objects_type_community_end ON objects(type, community_ap_id, end_time);

-- inbox: references activities (not objects); drop only the actors FK.
CREATE TABLE inbox_new (
  actor_ap_id TEXT NOT NULL,
  activity_ap_id TEXT NOT NULL REFERENCES activities(ap_id) ON DELETE CASCADE,
  read INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (actor_ap_id, activity_ap_id)
);
INSERT INTO inbox_new (actor_ap_id, activity_ap_id, read, created_at)
  SELECT actor_ap_id, activity_ap_id, read, created_at FROM inbox;
DROP TABLE inbox;
ALTER TABLE inbox_new RENAME TO inbox;
CREATE INDEX idx_inbox_actor_read ON inbox(actor_ap_id, read, created_at DESC);
CREATE INDEX idx_inbox_activity ON inbox(activity_ap_id);
