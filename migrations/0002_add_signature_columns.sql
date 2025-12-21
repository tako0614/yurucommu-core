-- Migration: 0002_add_signature_columns
-- Description: Add HTTP Signature verification columns to inbox_queue

ALTER TABLE inbox_queue ADD COLUMN signature_verified INTEGER NOT NULL DEFAULT 0;
ALTER TABLE inbox_queue ADD COLUMN signature_error TEXT;

CREATE INDEX IF NOT EXISTS idx_inbox_queue_signature ON inbox_queue(signature_verified);
