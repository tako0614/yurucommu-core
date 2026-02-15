-- Federation delivery scaling (delivery queue state + circuit breaker)

-- Extend delivery_queue with state fields.
ALTER TABLE delivery_queue ADD COLUMN status TEXT NOT NULL DEFAULT 'pending'
  CHECK (status IN ('pending', 'processing', 'delivered', 'retry_wait', 'failed', 'dead_letter'));
ALTER TABLE delivery_queue ADD COLUMN processing_started_at TEXT;
ALTER TABLE delivery_queue ADD COLUMN delivered_at TEXT;

CREATE INDEX IF NOT EXISTS idx_delivery_queue_status_next ON delivery_queue(status, next_attempt_at);

-- Circuit breaker state per endpoint.
CREATE TABLE IF NOT EXISTS delivery_circuit (
  endpoint TEXT PRIMARY KEY,
  state TEXT NOT NULL DEFAULT 'closed' CHECK (state IN ('closed', 'open', 'half_open')),
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  recent_outcomes_json TEXT NOT NULL DEFAULT '[]',
  open_until TEXT,
  half_open_probe_attempts INTEGER NOT NULL DEFAULT 0,
  half_open_probe_successes INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_delivery_circuit_state ON delivery_circuit(state, updated_at);

