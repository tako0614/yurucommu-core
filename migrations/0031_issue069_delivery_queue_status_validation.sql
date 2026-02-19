-- Migration: 0031_issue069_delivery_queue_status_validation
-- Description: Verify existing delivery_queue rows satisfy the status domain.

CREATE TABLE IF NOT EXISTS _delivery_queue_status_validation_guard (
  id INTEGER PRIMARY KEY
);

CREATE TRIGGER IF NOT EXISTS trg_delivery_queue_status_validation_guard
BEFORE INSERT ON _delivery_queue_status_validation_guard
BEGIN
  SELECT CASE
    WHEN EXISTS (
      SELECT 1
      FROM delivery_queue
      WHERE status IS NULL
        OR status NOT IN ('pending', 'processing', 'delivered', 'retry_wait', 'failed', 'dead_letter')
    )
    THEN RAISE(ABORT, 'delivery_queue has invalid status values; fix rows before continuing')
  END;
END;

INSERT INTO _delivery_queue_status_validation_guard (id) VALUES (1);

DROP TRIGGER IF EXISTS trg_delivery_queue_status_validation_guard;
DROP TABLE IF EXISTS _delivery_queue_status_validation_guard;
