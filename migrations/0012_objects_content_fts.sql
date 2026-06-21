-- Full-text index for post-content search (GET /api/search/posts).
--
-- The content search used `content LIKE '%query%'`, a leading-wildcard scan of
-- every object on each query. This adds an FTS5 index over objects.content using
-- the `trigram` tokenizer, which (unlike the default unicode61) matches arbitrary
-- substrings of spaceless CJK text — confirmed on D1 and the in-memory test
-- engine. The route uses MATCH for queries >= 3 chars (trigram's minimum) and
-- keeps LIKE only as a fallback for 1-2 char queries.
--
-- External-content table: the FTS index stores only the inverted index and reads
-- the text back from `objects` by rowid, kept in sync by the trigger trio below
-- (the canonical SQLite external-content pattern; DELETE/UPDATE use the special
-- 'delete' command with the OLD content so the right terms are removed). All
-- statements are idempotent so a direct re-apply is safe.

CREATE VIRTUAL TABLE IF NOT EXISTS objects_fts USING fts5(
  content,
  content='objects',
  content_rowid='rowid',
  tokenize='trigram'
);

CREATE TRIGGER IF NOT EXISTS objects_fts_ai AFTER INSERT ON objects BEGIN
  INSERT INTO objects_fts(rowid, content) VALUES (new.rowid, new.content);
END;

CREATE TRIGGER IF NOT EXISTS objects_fts_ad AFTER DELETE ON objects BEGIN
  INSERT INTO objects_fts(objects_fts, rowid, content)
    VALUES ('delete', old.rowid, old.content);
END;

CREATE TRIGGER IF NOT EXISTS objects_fts_au AFTER UPDATE OF content ON objects BEGIN
  INSERT INTO objects_fts(objects_fts, rowid, content)
    VALUES ('delete', old.rowid, old.content);
  INSERT INTO objects_fts(rowid, content) VALUES (new.rowid, new.content);
END;

-- Backfill the index from existing rows (no-op on a fresh database).
INSERT INTO objects_fts(objects_fts) VALUES ('rebuild');
