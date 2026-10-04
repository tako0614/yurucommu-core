-- Additive: no table rebuild, row deletion, recipient rewrite, or Activity
-- history change. Legacy reconciliation generations only existed in Queue
-- messages and cannot be reconstructed safely. Preserve their status/attempts
-- but conservatively exhaust the additional reconciliation budget (five).
-- New endpoint materialization explicitly sets reconcile_attempt to zero.
ALTER TABLE delivery_queue
  ADD COLUMN reconcile_attempt INTEGER NOT NULL DEFAULT 5
  CHECK (reconcile_attempt BETWEEN 0 AND 5);
ALTER TABLE delivery_queue
  ADD COLUMN dlq_pending INTEGER NOT NULL DEFAULT 0
  CHECK (dlq_pending IN (0, 1));
ALTER TABLE delivery_queue ADD COLUMN processing_token TEXT;

-- next_attempt_at is the persisted six-hour reconciliation due time while
-- status=dead_letter and dlq_pending=1. The intent survives accepted-but-lost
-- in-memory Queue sends and is consumed only by the reconcile CAS.
CREATE INDEX delivery_queue_reconcile_due_idx
  ON delivery_queue(next_attempt_at)
  WHERE status = 'dead_letter' AND dlq_pending = 1;
