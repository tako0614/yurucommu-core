-- 0010: object_recipients.recipient_ap_id must NOT reference actors(ap_id).
--
-- object_recipients addresses an object to a recipient that is EITHER an actor
-- (direct messages) OR a community (group-chat audience). The group-chat reader
-- GET /api/communities/:id/messages selects rows where
--   recipient_ap_id = community.apId AND type = 'audience'
-- so a community apId is a legitimate recipient value. But a community is not an
-- actor, so the original `REFERENCES actors(ap_id)` foreign key made every
-- community group-chat send fail with a foreign-key violation (HTTP 500) on
-- Cloudflare D1, where foreign keys are enforced. (The send handler tried to
-- "bypass" the FK with raw SQL, which does not actually bypass enforcement.)
--
-- Rebuild the table keeping the objects FK (a recipient row always references a
-- real object) + primary key + recipient index, dropping only the spurious
-- actors FK. This matches the Drizzle schema, which already declares no FK on
-- recipient_ap_id (the FK was schema drift inherited from 0001_init.sql).

CREATE TABLE object_recipients_new (
  object_ap_id TEXT NOT NULL REFERENCES objects(ap_id) ON DELETE CASCADE,
  recipient_ap_id TEXT NOT NULL,
  type TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (object_ap_id, recipient_ap_id)
);

INSERT INTO object_recipients_new (object_ap_id, recipient_ap_id, type, created_at)
  SELECT object_ap_id, recipient_ap_id, type, created_at FROM object_recipients;

DROP TABLE object_recipients;

ALTER TABLE object_recipients_new RENAME TO object_recipients;

CREATE INDEX IF NOT EXISTS idx_object_recipients_recipient
  ON object_recipients(recipient_ap_id, created_at DESC);
