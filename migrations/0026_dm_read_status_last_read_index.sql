-- Add index for dm_read_status last_read_at
CREATE INDEX IF NOT EXISTS idx_dm_read_status_last_read_at ON dm_read_status(last_read_at);
