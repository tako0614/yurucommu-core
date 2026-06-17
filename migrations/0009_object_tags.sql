-- Object-level ActivityPub `tag` array (Mentions, etc.).
--
-- Wave 1 made the outbound `Create` carry a `Mention` tag, but the served
-- object at `GET /ap/objects/:id` could not emit `tag` because the `objects`
-- table had no column for it (mentions lived only in the outbound Create's
-- `activities.rawJson`). Persist the computed Mention tag array onto the
-- object row so the object can be served faithfully (`tag` round-trips).
--
-- Stored as the JSON-encoded array of `{ type, href, name }` tag entries that
-- also goes on the Create; defaults to an empty array for posts with no tags
-- and for legacy rows created before this column existed.

ALTER TABLE objects ADD COLUMN tags_json TEXT NOT NULL DEFAULT '[]';
