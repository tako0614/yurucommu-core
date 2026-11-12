-- Additive endpoint-invalidation continuation. Historical rows acquire no
-- inferred recipients, recovery generation, or additional HTTP/reconcile budget.
ALTER TABLE delivery_queue ADD COLUMN endpoint_recovery_generation TEXT;
ALTER TABLE delivery_queue ADD COLUMN endpoint_recovery_pending INTEGER NOT NULL DEFAULT 0;
ALTER TABLE delivery_queue ADD COLUMN endpoint_recovery_cursor TEXT;
ALTER TABLE delivery_queue ADD COLUMN endpoint_recovery_processing_token TEXT;
ALTER TABLE delivery_queue ADD COLUMN endpoint_recovery_processing_started_at TEXT;
ALTER TABLE delivery_queue ADD COLUMN endpoint_recovery_next_attempt_at TEXT;
ALTER TABLE delivery_queue ADD COLUMN endpoint_recovery_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE delivery_queue ADD COLUMN endpoint_recovery_error TEXT;
CREATE INDEX delivery_queue_endpoint_recovery_due_idx
  ON delivery_queue(endpoint_recovery_pending, endpoint_recovery_next_attempt_at, id);
