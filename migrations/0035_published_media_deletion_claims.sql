-- Permanent deletion authority for supported published/legacy media keys.
-- No existing upload or pending job is claimed by this migration. Reference
-- backfill and unknown-put settlement must finish before any runtime claim.
CREATE TABLE media_blob_deletion_claims (
  r2_key TEXT PRIMARY KEY NOT NULL,
  uploader_ap_id TEXT NOT NULL,
  upload_id TEXT,
  created_at TEXT NOT NULL
);

-- A pending job alone is not physical deletion authority. This indexed view
-- selects only exact, supported identities with complete conservative proof.
CREATE VIEW media_blob_deletion_claimable AS
SELECT job.r2_key,job.uploader_ap_id,upload.id AS upload_id
FROM media_blob_deletion_jobs AS job
LEFT JOIN media_uploads AS upload ON upload.r2_key=job.r2_key
WHERE length(substr(job.r2_key,9,instr(substr(job.r2_key,9),'.')-1))=64
  AND substr(job.r2_key,1,8)='uploads/'
  AND substr(job.r2_key,9,64) NOT GLOB '*[^0-9a-f]*'
  AND substr(job.r2_key,73) IN ('.jpg','.png','.gif','.webp','.mp4','.webm')
  AND length(job.uploader_ap_id)>0
  AND (upload.r2_key IS NULL OR (upload.id IS NOT NULL AND upload.uploader_ap_id=job.uploader_ap_id))
  AND NOT EXISTS(SELECT 1 FROM media_blob_deletion_claims WHERE r2_key=job.r2_key)
  AND (SELECT count(*) FROM media_staged_backfill)=3
  AND NOT EXISTS(SELECT 1 FROM media_staged_backfill WHERE complete=0)
  AND NOT EXISTS(SELECT 1 FROM objects WHERE ap_id IS NULL LIMIT 1)
  AND NOT EXISTS(SELECT 1 FROM actors WHERE ap_id IS NULL LIMIT 1)
  AND NOT EXISTS(SELECT 1 FROM communities WHERE ap_id IS NULL LIMIT 1)
  AND NOT EXISTS(SELECT 1 FROM media_staged_ambiguity LIMIT 1)
  AND NOT EXISTS(SELECT 1 FROM media_staged_references WHERE r2_key=job.r2_key)
  AND NOT EXISTS(SELECT 1 FROM media_upload_attempts WHERE r2_key=job.r2_key)
  AND NOT EXISTS(SELECT 1 FROM account_deletion_targets AS target
    WHERE target.actor_ap_id=job.uploader_ap_id AND NOT EXISTS(
      SELECT 1 FROM actor_write_assertions AS marker WHERE marker.operation_id=target.operation_id
    ));

-- A journal row proves liveness, never authority to delete its uploader's
-- blob. Only an owning source mutation may co-commit pending intent. Read OLD
-- before 0034 rebuilds the journal; same-key updates still retain their final
-- reference, so intent alone can never delete them.
-- Keep whitespace around CASE/END tokens: Wrangler's migration splitter needs
-- those boundaries to preserve the enclosing trigger as one SQL statement.
CREATE TRIGGER media_blob_owned_object_removed BEFORE DELETE ON objects
BEGIN
  INSERT INTO media_blob_deletion_jobs(r2_key,uploader_ap_id)
    SELECT DISTINCT upload.r2_key,upload.uploader_ap_id
    FROM json_tree( CASE WHEN length(OLD.attachments_json)<=16384
      AND length(CAST(OLD.attachments_json AS BLOB))<=49152
      AND json_valid(OLD.attachments_json) THEN OLD.attachments_json ELSE '[]' END ) AS value
    CROSS JOIN media_uploads AS upload
    WHERE upload.r2_key = CASE
      WHEN substr(value.value,1,7)='/media/' THEN 'uploads/'||substr(value.value,8)
      ELSE value.value END
      AND value.type='text' AND upload.uploader_ap_id=OLD.attributed_to
      AND substr(upload.r2_key,1,8)='uploads/'
    ON CONFLICT(r2_key) DO NOTHING;
END;
CREATE TRIGGER media_blob_owned_object_replaced BEFORE UPDATE OF attachments_json ON objects
WHEN NEW.attachments_json IS NOT OLD.attachments_json
BEGIN
  INSERT INTO media_blob_deletion_jobs(r2_key,uploader_ap_id)
    SELECT DISTINCT upload.r2_key,upload.uploader_ap_id
    FROM json_tree( CASE WHEN length(OLD.attachments_json)<=16384
      AND length(CAST(OLD.attachments_json AS BLOB))<=49152
      AND json_valid(OLD.attachments_json) THEN OLD.attachments_json ELSE '[]' END ) AS value
    CROSS JOIN media_uploads AS upload
    WHERE upload.r2_key = CASE
      WHEN substr(value.value,1,7)='/media/' THEN 'uploads/'||substr(value.value,8)
      ELSE value.value END
      AND value.type='text' AND upload.uploader_ap_id=OLD.attributed_to
      AND substr(upload.r2_key,1,8)='uploads/'
    ON CONFLICT(r2_key) DO NOTHING;
END;
CREATE TRIGGER media_blob_owned_profile_removed BEFORE DELETE ON actors
BEGIN
  INSERT INTO media_blob_deletion_jobs(r2_key,uploader_ap_id)
    SELECT r2_key,uploader_ap_id FROM media_uploads
    WHERE uploader_ap_id=OLD.ap_id AND r2_key IN (
      CASE WHEN substr(OLD.icon_url,1,7)='/media/' THEN 'uploads/'||substr(OLD.icon_url,8) END ,
      CASE WHEN substr(OLD.header_url,1,7)='/media/' THEN 'uploads/'||substr(OLD.header_url,8) END
    )
    ON CONFLICT(r2_key) DO NOTHING;
END;
CREATE TRIGGER media_blob_owned_profile_replaced BEFORE UPDATE OF icon_url,header_url ON actors
BEGIN
  INSERT INTO media_blob_deletion_jobs(r2_key,uploader_ap_id)
    SELECT r2_key,uploader_ap_id FROM media_uploads
    WHERE uploader_ap_id=OLD.ap_id AND r2_key IN (
      CASE WHEN NEW.icon_url IS NOT OLD.icon_url AND substr(OLD.icon_url,1,7)='/media/'
        THEN 'uploads/'||substr(OLD.icon_url,8) END ,
      CASE WHEN NEW.header_url IS NOT OLD.header_url AND substr(OLD.header_url,1,7)='/media/'
        THEN 'uploads/'||substr(OLD.header_url,8) END
    )
    ON CONFLICT(r2_key) DO NOTHING;
END;

CREATE TRIGGER media_blob_claim_admission BEFORE INSERT ON media_blob_deletion_claims
WHEN NOT EXISTS(SELECT 1 FROM media_blob_deletion_claimable AS proof
  WHERE proof.r2_key=NEW.r2_key AND proof.uploader_ap_id=NEW.uploader_ap_id
    AND proof.upload_id IS NEW.upload_id)
  OR NEW.created_at IS NOT strftime('%Y-%m-%dT%H:%M:%fZ',NEW.created_at)
  OR julianday(NEW.created_at) IS NULL
BEGIN SELECT RAISE(ABORT,'media reference invalid'); END;
CREATE TRIGGER media_blob_claim_keep BEFORE DELETE ON media_blob_deletion_claims
BEGIN SELECT RAISE(ABORT,'staged media deleted'); END;
CREATE TRIGGER media_blob_claim_immutable BEFORE UPDATE ON media_blob_deletion_claims
BEGIN SELECT RAISE(ABORT,'staged media deleted'); END;
CREATE TRIGGER media_blob_claim_commit AFTER INSERT ON media_blob_deletion_claims
BEGIN
  -- The exact pending job is already durable. Keep its identity across metadata
  -- removal, provider failure, process loss, and acknowledgment retry.
  DELETE FROM media_uploads WHERE id=NEW.upload_id AND r2_key=NEW.r2_key
    AND uploader_ap_id=NEW.uploader_ap_id;
END;
CREATE TRIGGER media_blob_reference_fence BEFORE INSERT ON media_staged_references
WHEN EXISTS(SELECT 1 FROM media_blob_deletion_claims WHERE r2_key=NEW.r2_key)
BEGIN SELECT RAISE(ABORT,'staged media deleted'); END;
CREATE TRIGGER media_blob_metadata_fence BEFORE INSERT ON media_uploads
WHEN EXISTS(SELECT 1 FROM media_blob_deletion_claims WHERE r2_key=NEW.r2_key)
BEGIN SELECT RAISE(ABORT,'staged media deleted'); END;
CREATE TRIGGER media_blob_metadata_update_fence BEFORE UPDATE ON media_uploads
WHEN EXISTS(SELECT 1 FROM media_blob_deletion_claims WHERE r2_key IN (OLD.r2_key,NEW.r2_key))
BEGIN SELECT RAISE(ABORT,'staged media deleted'); END;
CREATE TRIGGER media_blob_attempt_fence BEFORE INSERT ON media_upload_attempts
WHEN EXISTS(SELECT 1 FROM media_blob_deletion_claims WHERE r2_key=NEW.r2_key)
BEGIN SELECT RAISE(ABORT,'staged media deleted'); END;

-- A cascade cannot be marked complete or release durable account reservations
-- while any owned upload identity or pending/claimed physical deletion remains.
CREATE TRIGGER media_blob_account_cascade_complete BEFORE UPDATE OF cascade_complete ON account_deletion_targets
WHEN NEW.cascade_complete=1 AND (
  EXISTS(SELECT 1 FROM media_uploads WHERE uploader_ap_id=NEW.actor_ap_id)
  OR EXISTS(SELECT 1 FROM media_blob_deletion_jobs WHERE uploader_ap_id=NEW.actor_ap_id)
)
BEGIN SELECT RAISE(ABORT,'media reference invalid'); END;
CREATE TRIGGER media_blob_account_target_release BEFORE DELETE ON account_deletion_targets
WHEN EXISTS(SELECT 1 FROM media_uploads WHERE uploader_ap_id=OLD.actor_ap_id)
  OR EXISTS(SELECT 1 FROM media_blob_deletion_jobs WHERE uploader_ap_id=OLD.actor_ap_id)
BEGIN SELECT RAISE(ABORT,'media reference invalid'); END;
CREATE INDEX media_blob_deletion_jobs_uploader_idx ON media_blob_deletion_jobs(uploader_ap_id);
