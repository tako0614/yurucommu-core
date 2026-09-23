-- Durable intent for deleting object-attached media after the owning object
-- mutation has committed. The key is the product-owned identity; provider
-- details stay in the ObjectStore adapter and are never persisted here.
CREATE TABLE IF NOT EXISTS media_blob_deletion_jobs (
  r2_key TEXT PRIMARY KEY NOT NULL,
  uploader_ap_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  next_attempt_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS media_blob_deletion_jobs_due_idx
  ON media_blob_deletion_jobs(next_attempt_at, created_at, r2_key);
