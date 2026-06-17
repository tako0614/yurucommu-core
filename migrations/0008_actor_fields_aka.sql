-- Mastodon-parity actor profile + account-migration fields.
--
-- `fields_json` holds the structured profile metadata rows (PropertyValue
-- attachments) shown on a profile, stored as a JSON array of {name,value}.
-- `also_known_as_json` holds the actor's declared aliases (other AP IDs the
-- account claims), the prerequisite for an incoming Move that points here.
-- `moved_to` records the target AP ID once this actor has migrated away; when
-- set it is emitted as `movedTo` on the served actor document so remote
-- servers can follow the Move.
--
-- All three default to portable, federation-safe values: empty arrays and a
-- NULL (not yet moved) target.

ALTER TABLE actors ADD COLUMN fields_json TEXT NOT NULL DEFAULT '[]';

ALTER TABLE actors ADD COLUMN also_known_as_json TEXT NOT NULL DEFAULT '[]';

ALTER TABLE actors ADD COLUMN moved_to TEXT;
