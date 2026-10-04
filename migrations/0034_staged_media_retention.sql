-- New settled uploads alone receive a seven-day staged lifetime. Legacy
-- media_uploads and unknown putting attempts are never inferred or deleted.
-- Reference journaling is conservative: any normalized 64-hex media filename
-- in a scalar or JSON key publishes the key, regardless of origin/placement.
CREATE TABLE media_upload_lifetimes (
  r2_key TEXT PRIMARY KEY NOT NULL,
  upload_id TEXT NOT NULL UNIQUE,
  uploader_ap_id TEXT NOT NULL,
  public_key_pem TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'staged' CHECK(state IN ('staged','published','deleting')),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX media_upload_lifetimes_due_idx
  ON media_upload_lifetimes(state, expires_at, r2_key);
CREATE TABLE media_staged_references (
  r2_key TEXT NOT NULL,
  source_kind TEXT NOT NULL,
  source_id TEXT NOT NULL,
  PRIMARY KEY(r2_key,source_kind,source_id)
);
CREATE INDEX media_staged_references_source_idx
  ON media_staged_references(source_kind,source_id);
CREATE TABLE media_staged_ambiguity (
  source_kind TEXT NOT NULL,
  source_id TEXT NOT NULL,
  PRIMARY KEY(source_kind,source_id)
);
-- Transaction-local scratch: the processing trigger deletes each input before
-- its containing source write completes. Neither normal writes nor backfill
-- materialize the entire product in the normalization view.
CREATE TABLE media_staged_source_inputs (
  source_kind TEXT NOT NULL,
  source_id TEXT NOT NULL,
  payload TEXT NOT NULL,
  is_json INTEGER NOT NULL CHECK(is_json IN (0,1)),
  allow_ambiguous INTEGER NOT NULL DEFAULT 0 CHECK(allow_ambiguous IN (0,1)),
  PRIMARY KEY(source_kind,source_id)
);

-- Four finite decoder passes over at most 16K Unicode characters / 48 KiB UTF-8. Replacement recursion is
-- by a constant alphabet, not by character or number of permanent tombstones.
-- JSON escapes are decoded by guarded json_tree; keys and values are inspected.
CREATE VIEW media_staged_normalized AS
WITH RECURSIVE
  escapes(step,encoded,decoded) AS (VALUES
    (0,'%30','0'),
    (1,'%31','1'),
    (2,'%32','2'),
    (3,'%33','3'),
    (4,'%34','4'),
    (5,'%35','5'),
    (6,'%36','6'),
    (7,'%37','7'),
    (8,'%38','8'),
    (9,'%39','9'),
    (10,'%41','a'),
    (11,'%61','a'),
    (12,'%42','b'),
    (13,'%62','b'),
    (14,'%43','c'),
    (15,'%63','c'),
    (16,'%44','d'),
    (17,'%64','d'),
    (18,'%45','e'),
    (19,'%65','e'),
    (20,'%46','f'),
    (21,'%66','f'),
    (22,'%47','g'),
    (23,'%67','g'),
    (24,'%48','h'),
    (25,'%68','h'),
    (26,'%49','i'),
    (27,'%69','i'),
    (28,'%4a','j'),
    (29,'%6a','j'),
    (30,'%4b','k'),
    (31,'%6b','k'),
    (32,'%4c','l'),
    (33,'%6c','l'),
    (34,'%4d','m'),
    (35,'%6d','m'),
    (36,'%4e','n'),
    (37,'%6e','n'),
    (38,'%4f','o'),
    (39,'%6f','o'),
    (40,'%50','p'),
    (41,'%70','p'),
    (42,'%51','q'),
    (43,'%71','q'),
    (44,'%52','r'),
    (45,'%72','r'),
    (46,'%53','s'),
    (47,'%73','s'),
    (48,'%54','t'),
    (49,'%74','t'),
    (50,'%55','u'),
    (51,'%75','u'),
    (52,'%56','v'),
    (53,'%76','v'),
    (54,'%57','w'),
    (55,'%77','w'),
    (56,'%58','x'),
    (57,'%78','x'),
    (58,'%59','y'),
    (59,'%79','y'),
    (60,'%5a','z'),
    (61,'%7a','z'),
    (62,'%2e','.'),
    (63,'%09',char(9)),
    (64,'%0a',char(10)),
    (65,'%0d',char(13)),
    (66,'%25','%')
  ),
  scalars(source_kind,source_id,scalar_id,value) AS (
    SELECT source_kind,source_id,'url',payload FROM media_staged_source_inputs
      WHERE is_json=0 AND length(payload)<=16384 AND length(CAST(payload AS BLOB))<=49152
    UNION ALL
    SELECT input.source_kind,input.source_id,'v'||tree.id,CAST(tree.value AS TEXT)
      FROM media_staged_source_inputs AS input,
      json_tree(CASE WHEN length(input.payload)<=16384
        AND length(CAST(input.payload AS BLOB))<=49152 THEN
          CASE WHEN input.is_json=1 AND json_valid(input.payload) THEN
            CASE WHEN (SELECT count(*) FROM json_tree(CASE
              WHEN length(input.payload)<=16384 AND length(CAST(input.payload AS BLOB))<=49152 THEN
                CASE WHEN json_valid(input.payload) THEN input.payload ELSE '[]' END
              ELSE '[]' END))<=256 THEN input.payload ELSE '[]' END
          ELSE '[]' END
        ELSE '[]' END) AS tree
      WHERE input.is_json=1 AND tree.type='text'
    UNION ALL
    SELECT input.source_kind,input.source_id,'k'||tree.id,CAST(tree.key AS TEXT)
      FROM media_staged_source_inputs AS input,
      json_tree(CASE WHEN length(input.payload)<=16384
        AND length(CAST(input.payload AS BLOB))<=49152 THEN
          CASE WHEN input.is_json=1 AND json_valid(input.payload) THEN
            CASE WHEN (SELECT count(*) FROM json_tree(CASE
              WHEN length(input.payload)<=16384 AND length(CAST(input.payload AS BLOB))<=49152 THEN
                CASE WHEN json_valid(input.payload) THEN input.payload ELSE '[]' END
              ELSE '[]' END))<=256 THEN input.payload ELSE '[]' END
          ELSE '[]' END
        ELSE '[]' END) AS tree
      WHERE input.is_json=1 AND typeof(tree.key)='text'
  ),
  decoded(source_kind,source_id,scalar_id,step,value) AS (
    SELECT source_kind,source_id,scalar_id,0,lower(value) FROM scalars
    UNION ALL
    SELECT decoded.source_kind,decoded.source_id,decoded.scalar_id,decoded.step+1,
      lower(replace(decoded.value,escapes.encoded,escapes.decoded))
      FROM decoded JOIN escapes ON escapes.step=decoded.step % 67
      WHERE decoded.step<268 AND instr(decoded.value,'%')>0
  ),
  final(source_kind,source_id,scalar_id,value) AS (
    SELECT source_kind,source_id,scalar_id,
      replace(replace(replace(value,char(9),''),char(10),''),char(13),'')
      FROM decoded WHERE step=268 OR instr(value,'%')=0
  )
SELECT source_kind,source_id,scalar_id,value,
  CASE WHEN instr(value,char(0))>0
    OR length(value)-length(replace(value,'.',''))>256 OR EXISTS (
    SELECT 1 FROM escapes WHERE instr(value,encoded)>0
  ) THEN 1 ELSE 0 END AS ambiguous
FROM final;

CREATE VIEW media_staged_filename_candidates AS
WITH RECURSIVE
  dots(source_kind,source_id,scalar_id,value,position) AS (
    SELECT source_kind,source_id,scalar_id,value,instr(value,'.')
      FROM media_staged_normalized WHERE ambiguous=0 AND instr(value,'.')>0
    UNION ALL
    SELECT source_kind,source_id,scalar_id,value,
      position+instr(substr(value,position+1),'.')
      FROM dots WHERE instr(substr(value,position+1),'.')>0
  ),
  candidates(source_kind,source_id,filename) AS (
    SELECT source_kind,source_id,substr(value,position-64,64)||'.'||
      CASE WHEN substr(value,position+1,4) IN ('jpeg','webm','webp')
        THEN substr(value,position+1,4) ELSE substr(value,position+1,3) END
      FROM dots WHERE position>=65
        AND length(substr(value,position-64,64))=64
        AND substr(value,position-64,64) NOT GLOB '*[^0-9a-f]*'
        AND (substr(value,position+1,3) IN ('jpg','png','gif','mp4')
          OR substr(value,position+1,4) IN ('webm','webp'))
  )
SELECT DISTINCT source_kind,source_id,'uploads/'||filename AS r2_key FROM candidates;

-- A NULL cursor means unstarted; the first page includes empty legacy IDs.
-- NULL source IDs are retained and separately block claims via indexed probes.
-- Reference backfill advances in bounded engine-owned atomic pages. Claims
-- remain closed until all three cursors complete. Migration itself never scans
-- legacy payloads in a single unbounded trigger-heavy statement.
CREATE TABLE media_staged_backfill (
  source_kind TEXT PRIMARY KEY NOT NULL CHECK(source_kind IN ('object','actor','community')),
  cursor TEXT,
  complete INTEGER NOT NULL DEFAULT 0 CHECK(complete IN (0,1))
);
INSERT INTO media_staged_backfill(source_kind) VALUES ('object'),('actor'),('community');
CREATE TRIGGER media_staged_backfill_keep BEFORE DELETE ON media_staged_backfill
BEGIN SELECT RAISE(ABORT,'media reference invalid'); END;
CREATE TRIGGER media_staged_backfill_monotonic BEFORE UPDATE ON media_staged_backfill
WHEN NEW.source_kind IS NOT OLD.source_kind OR (OLD.cursor IS NOT NULL AND (NEW.cursor IS NULL OR NEW.cursor<OLD.cursor)) OR NEW.complete<OLD.complete
BEGIN SELECT RAISE(ABORT,'media reference invalid'); END;

CREATE TRIGGER media_staged_reference_fence
BEFORE INSERT ON media_staged_references
WHEN EXISTS (SELECT 1 FROM media_upload_lifetimes
  WHERE r2_key=NEW.r2_key AND state='deleting')
BEGIN SELECT RAISE(ABORT,'staged media deleted'); END;
CREATE TRIGGER media_staged_reference_publish
AFTER INSERT ON media_staged_references
BEGIN
  UPDATE media_upload_lifetimes SET state='published'
    WHERE r2_key=NEW.r2_key AND state='staged';
END;
CREATE TRIGGER media_staged_process_input
AFTER INSERT ON media_staged_source_inputs
BEGIN
  INSERT OR IGNORE INTO media_staged_ambiguity(source_kind,source_id)
    SELECT NEW.source_kind,NEW.source_id
    WHERE length(NEW.payload)>16384 OR length(CAST(NEW.payload AS BLOB))>49152
      OR (NEW.is_json=1 AND CASE WHEN length(NEW.payload)<=16384
        AND length(CAST(NEW.payload AS BLOB))<=49152 THEN NOT json_valid(NEW.payload) ELSE 0 END)
      OR (NEW.is_json=1 AND (SELECT count(*) FROM json_tree(
        CASE WHEN length(NEW.payload)<=16384 AND length(CAST(NEW.payload AS BLOB))<=49152 THEN
          CASE WHEN json_valid(NEW.payload) THEN NEW.payload ELSE '[]' END
        ELSE '[]' END))>256)
      OR EXISTS (SELECT 1 FROM media_staged_normalized
        WHERE source_kind=NEW.source_kind AND source_id=NEW.source_id AND ambiguous=1);
  SELECT CASE WHEN NEW.allow_ambiguous=0 AND EXISTS (
    SELECT 1 FROM media_staged_ambiguity
    WHERE source_kind=NEW.source_kind AND source_id=NEW.source_id
  ) THEN RAISE(ABORT,'media reference invalid') END;
  INSERT OR IGNORE INTO media_staged_references(r2_key,source_kind,source_id)
    SELECT r2_key,source_kind,source_id FROM media_staged_filename_candidates
      WHERE source_kind=NEW.source_kind AND source_id=NEW.source_id;
  DELETE FROM media_staged_source_inputs
    WHERE source_kind=NEW.source_kind AND source_id=NEW.source_id;
END;



CREATE TRIGGER media_staged_objects_insert AFTER INSERT ON objects
BEGIN INSERT INTO media_staged_source_inputs(source_kind,source_id,payload,is_json)
    VALUES('object',NEW.ap_id,coalesce(NEW.attachments_json,'[]'),1); END;
CREATE TRIGGER media_staged_objects_update AFTER UPDATE OF ap_id,attachments_json ON objects
WHEN NEW.ap_id IS NOT OLD.ap_id OR NEW.attachments_json IS NOT OLD.attachments_json
BEGIN
  DELETE FROM media_staged_references WHERE source_kind='object' AND source_id=OLD.ap_id;
  DELETE FROM media_staged_ambiguity WHERE source_kind='object' AND source_id=OLD.ap_id;
  INSERT INTO media_staged_source_inputs(source_kind,source_id,payload,is_json)
    VALUES('object',NEW.ap_id,coalesce(NEW.attachments_json,'[]'),1);
END;
CREATE TRIGGER media_staged_objects_delete AFTER DELETE ON objects
BEGIN DELETE FROM media_staged_references WHERE source_kind='object' AND source_id=OLD.ap_id;
  DELETE FROM media_staged_ambiguity WHERE source_kind='object' AND source_id=OLD.ap_id; END;



CREATE TRIGGER media_staged_actors_insert AFTER INSERT ON actors
BEGIN INSERT INTO media_staged_source_inputs(source_kind,source_id,payload,is_json)
    VALUES('actor',NEW.ap_id,coalesce(json_array(NEW.icon_url,NEW.header_url),'[]'),1); END;
CREATE TRIGGER media_staged_actors_update AFTER UPDATE OF ap_id,icon_url,header_url ON actors
WHEN NEW.ap_id IS NOT OLD.ap_id OR NEW.icon_url IS NOT OLD.icon_url OR NEW.header_url IS NOT OLD.header_url
BEGIN
  DELETE FROM media_staged_references WHERE source_kind='actor' AND source_id=OLD.ap_id;
  DELETE FROM media_staged_ambiguity WHERE source_kind='actor' AND source_id=OLD.ap_id;
  INSERT INTO media_staged_source_inputs(source_kind,source_id,payload,is_json)
    VALUES('actor',NEW.ap_id,coalesce(json_array(NEW.icon_url,NEW.header_url),'[]'),1);
END;
CREATE TRIGGER media_staged_actors_delete AFTER DELETE ON actors
BEGIN DELETE FROM media_staged_references WHERE source_kind='actor' AND source_id=OLD.ap_id;
  DELETE FROM media_staged_ambiguity WHERE source_kind='actor' AND source_id=OLD.ap_id; END;



CREATE TRIGGER media_staged_communities_insert AFTER INSERT ON communities
BEGIN INSERT INTO media_staged_source_inputs(source_kind,source_id,payload,is_json)
    VALUES('community',NEW.ap_id,coalesce(json_array(NEW.icon_url),'[]'),1); END;
CREATE TRIGGER media_staged_communities_update AFTER UPDATE OF ap_id,icon_url ON communities
WHEN NEW.ap_id IS NOT OLD.ap_id OR NEW.icon_url IS NOT OLD.icon_url
BEGIN
  DELETE FROM media_staged_references WHERE source_kind='community' AND source_id=OLD.ap_id;
  DELETE FROM media_staged_ambiguity WHERE source_kind='community' AND source_id=OLD.ap_id;
  INSERT INTO media_staged_source_inputs(source_kind,source_id,payload,is_json)
    VALUES('community',NEW.ap_id,coalesce(json_array(NEW.icon_url),'[]'),1);
END;
CREATE TRIGGER media_staged_communities_delete AFTER DELETE ON communities
BEGIN DELETE FROM media_staged_references WHERE source_kind='community' AND source_id=OLD.ap_id;
  DELETE FROM media_staged_ambiguity WHERE source_kind='community' AND source_id=OLD.ap_id; END;

CREATE TRIGGER media_staged_attempt_collision BEFORE INSERT ON media_upload_attempts
WHEN EXISTS(SELECT 1 FROM media_upload_lifetimes WHERE r2_key=NEW.r2_key)
  OR EXISTS(SELECT 1 FROM media_uploads WHERE r2_key=NEW.r2_key)
  OR EXISTS(SELECT 1 FROM media_blob_deletion_jobs WHERE r2_key=NEW.r2_key)
BEGIN SELECT RAISE(ABORT,'staged media deleted'); END;
CREATE TRIGGER media_staged_metadata_replay BEFORE INSERT ON media_uploads
WHEN EXISTS(SELECT 1 FROM media_upload_lifetimes WHERE r2_key=NEW.r2_key OR upload_id=NEW.id)
  OR EXISTS(SELECT 1 FROM media_blob_deletion_jobs WHERE r2_key=NEW.r2_key)
BEGIN SELECT RAISE(ABORT,'staged media deleted'); END;
CREATE TRIGGER media_staged_metadata_identity BEFORE UPDATE ON media_uploads
WHEN EXISTS(SELECT 1 FROM media_upload_lifetimes WHERE r2_key=OLD.r2_key OR r2_key=NEW.r2_key)
  AND (NEW.id IS NOT OLD.id OR NEW.r2_key IS NOT OLD.r2_key
    OR NEW.uploader_ap_id IS NOT OLD.uploader_ap_id)
BEGIN SELECT RAISE(ABORT,'staged media deleted'); END;
CREATE TRIGGER media_staged_lifetime_admission BEFORE INSERT ON media_upload_lifetimes
WHEN NEW.state<>'staged' OR length(NEW.upload_id)<>64
  OR julianday(NEW.created_at) IS NULL OR julianday(NEW.expires_at) IS NULL
  OR NEW.created_at IS NOT strftime('%Y-%m-%dT%H:%M:%fZ',NEW.created_at)
  OR NEW.expires_at IS NOT strftime('%Y-%m-%dT%H:%M:%fZ',NEW.expires_at)
  OR abs((julianday(NEW.expires_at)-julianday(NEW.created_at))*86400-604800)>0.001
  OR NEW.upload_id GLOB '*[^0-9a-f]*'
  OR NEW.r2_key NOT IN ('uploads/'||NEW.upload_id||'.jpg','uploads/'||NEW.upload_id||'.png',
    'uploads/'||NEW.upload_id||'.gif','uploads/'||NEW.upload_id||'.webp',
    'uploads/'||NEW.upload_id||'.mp4','uploads/'||NEW.upload_id||'.webm')
  OR NOT EXISTS(SELECT 1 FROM media_uploads
    WHERE id=NEW.upload_id AND r2_key=NEW.r2_key AND uploader_ap_id=NEW.uploader_ap_id)
  OR NOT EXISTS(SELECT 1 FROM media_upload_attempts
    WHERE id=NEW.upload_id AND r2_key=NEW.r2_key AND uploader_ap_id=NEW.uploader_ap_id
      AND public_key_pem=NEW.public_key_pem AND phase='cleanup')
  OR NOT EXISTS(SELECT 1 FROM actors WHERE ap_id=NEW.uploader_ap_id
    AND public_key_pem=NEW.public_key_pem AND deleted_at IS NULL)
  OR EXISTS(SELECT 1 FROM media_blob_deletion_jobs WHERE r2_key=NEW.r2_key)
BEGIN SELECT RAISE(ABORT,'staged media deleted'); END;
CREATE TRIGGER media_staged_lifetime_publish_existing AFTER INSERT ON media_upload_lifetimes
WHEN EXISTS(SELECT 1 FROM media_staged_references WHERE r2_key=NEW.r2_key)
BEGIN
  UPDATE media_upload_lifetimes SET state='published' WHERE r2_key=NEW.r2_key;
END;
CREATE TRIGGER media_staged_lifetime_immutable BEFORE UPDATE ON media_upload_lifetimes
WHEN NEW.r2_key IS NOT OLD.r2_key OR NEW.upload_id IS NOT OLD.upload_id
  OR NEW.uploader_ap_id IS NOT OLD.uploader_ap_id OR NEW.public_key_pem IS NOT OLD.public_key_pem
  OR NEW.created_at IS NOT OLD.created_at OR NEW.expires_at IS NOT OLD.expires_at
  OR (NEW.state IS NOT OLD.state AND NOT(OLD.state='staged' AND NEW.state IN ('published','deleting')))
BEGIN SELECT RAISE(ABORT,'staged media deleted'); END;
CREATE TRIGGER media_staged_lifetime_keep BEFORE DELETE ON media_upload_lifetimes
BEGIN SELECT RAISE(ABORT,'staged media deleted'); END;
CREATE TRIGGER media_staged_claim_proof BEFORE UPDATE OF state ON media_upload_lifetimes
WHEN OLD.state='staged' AND NEW.state='deleting' AND (
  (SELECT count(*) FROM media_staged_backfill)<>3
  OR EXISTS(SELECT 1 FROM media_staged_backfill WHERE complete=0)
  OR EXISTS(SELECT 1 FROM objects WHERE ap_id IS NULL LIMIT 1)
  OR EXISTS(SELECT 1 FROM actors WHERE ap_id IS NULL LIMIT 1)
  OR EXISTS(SELECT 1 FROM communities WHERE ap_id IS NULL LIMIT 1)
  OR
  EXISTS(SELECT 1 FROM media_staged_references WHERE r2_key=OLD.r2_key)
  OR EXISTS(SELECT 1 FROM media_staged_ambiguity LIMIT 1)
  OR EXISTS(SELECT 1 FROM media_upload_attempts WHERE r2_key=OLD.r2_key)
  OR NOT EXISTS(SELECT 1 FROM media_uploads WHERE id=OLD.upload_id
    AND r2_key=OLD.r2_key AND uploader_ap_id=OLD.uploader_ap_id)
)
BEGIN SELECT RAISE(ABORT,'media reference invalid'); END;
CREATE TRIGGER media_staged_claim_commit AFTER UPDATE OF state ON media_upload_lifetimes
WHEN OLD.state='staged' AND NEW.state='deleting'
BEGIN
  INSERT INTO media_blob_deletion_jobs(r2_key,uploader_ap_id)
    VALUES(NEW.r2_key,NEW.uploader_ap_id);
  DELETE FROM media_uploads WHERE id=NEW.upload_id AND r2_key=NEW.r2_key
    AND uploader_ap_id=NEW.uploader_ap_id;
END;
