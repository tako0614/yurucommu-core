CREATE TABLE IF NOT EXISTS mobile_push_registrations (
  id TEXT PRIMARY KEY,
  actor_ap_id TEXT NOT NULL,
  product TEXT NOT NULL,
  token TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  environment TEXT NOT NULL DEFAULT 'production',
  host_url TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  last_seen_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (actor_ap_id) REFERENCES actors(ap_id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS mobile_push_registrations_actor_product_token_idx
  ON mobile_push_registrations(actor_ap_id, product, token_hash);

CREATE INDEX IF NOT EXISTS mobile_push_registrations_actor_idx
  ON mobile_push_registrations(actor_ap_id);

CREATE INDEX IF NOT EXISTS mobile_push_registrations_last_seen_idx
  ON mobile_push_registrations(last_seen_at);
