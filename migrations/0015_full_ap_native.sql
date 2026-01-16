-- Yurucommu v7.0 - Full ActivityPub Native
-- All messaging flows through AP objects/activities
-- No more "local only" concepts

-- ============================================================
-- DROP NON-AP TABLES
-- ============================================================

-- DM tables - replaced by direct addressing on objects
DROP TABLE IF EXISTS dm_messages;
DROP TABLE IF EXISTS dm_conversations;
DROP TABLE IF EXISTS dm_contacts;
DROP TABLE IF EXISTS dm_requests;

-- Community chat - replaced by objects with audience
DROP TABLE IF EXISTS community_messages;

-- Notifications - derived from activities
DROP TABLE IF EXISTS notifications;

-- ============================================================
-- ENSURE objects TABLE HAS ALL REQUIRED FIELDS
-- ============================================================

-- Add audience field for Group addressing (if not exists)
-- audience_json contains AP IRIs of groups this is posted to
ALTER TABLE objects ADD COLUMN audience_json TEXT DEFAULT '[]';

-- Ensure conversation exists for threading DMs
-- (conversation is already in 0008, but verify)

-- ============================================================
-- NEW: OBJECT_RECIPIENTS for tracking direct message recipients
-- This is essentially a denormalized view of to/cc for efficient querying
-- ============================================================
CREATE TABLE IF NOT EXISTS object_recipients (
  object_ap_id TEXT NOT NULL,
  recipient_ap_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('to', 'cc', 'bcc', 'audience')),
  created_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (object_ap_id, recipient_ap_id)
);

CREATE INDEX IF NOT EXISTS idx_object_recipients_recipient ON object_recipients(recipient_ap_id, created_at DESC);

-- ============================================================
-- NEW: INBOX - Track what activities have been delivered to each actor's inbox
-- This is the AP inbox - activities received by an actor
-- ============================================================
CREATE TABLE IF NOT EXISTS inbox (
  actor_ap_id TEXT NOT NULL,        -- The inbox owner (local actor)
  activity_ap_id TEXT NOT NULL,     -- The activity in the inbox
  read INTEGER DEFAULT 0,           -- Read status
  created_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (actor_ap_id, activity_ap_id)
);

CREATE INDEX IF NOT EXISTS idx_inbox_actor ON inbox(actor_ap_id, read, created_at DESC);

-- ============================================================
-- INDEXES FOR EFFICIENT DM/CHAT QUERIES
-- ============================================================

-- For DMs: find objects where visibility='direct' and recipient is in to_json
CREATE INDEX IF NOT EXISTS idx_objects_direct ON objects(visibility) WHERE visibility = 'direct';

-- For community chat: find objects by audience (group)
CREATE INDEX IF NOT EXISTS idx_objects_audience ON objects(audience_json) WHERE audience_json != '[]';

-- ============================================================
-- VISIBILITY IS NOW DERIVED (KEEP FOR CACHE BUT COMPUTE FROM to/cc)
-- visibility rules:
-- - 'public': as:Public in to
-- - 'unlisted': as:Public in cc (not in to)
-- - 'followers': followers collection in to, no Public
-- - 'direct': specific actors only, no collections
-- ============================================================

-- We keep visibility column as a cache but it should be computed
-- The code will compute visibility from to_json/cc_json on insert/update
