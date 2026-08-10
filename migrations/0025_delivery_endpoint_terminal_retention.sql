-- Endpoint delivery jobs are a durable retry/idempotency ledger, but terminal
-- rows for Activities that remain in history otherwise grow without bound.
-- Retention keeps 30 days and deletes only bounded batches; index that scan
-- without rewriting or resetting protected production data.
CREATE INDEX IF NOT EXISTS delivery_queue_terminal_retention_idx
  ON delivery_queue(status, created_at);
