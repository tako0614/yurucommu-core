-- Add retry metadata and limits for data export requests

ALTER TABLE data_export_requests ADD COLUMN attempt_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE data_export_requests ADD COLUMN max_attempts INTEGER NOT NULL DEFAULT 3;
