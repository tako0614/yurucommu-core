CREATE TABLE IF NOT EXISTS notification_pushers (
  id TEXT PRIMARY KEY,
  actor_ap_id TEXT NOT NULL,
  product TEXT NOT NULL,
  scope TEXT,
  kind TEXT NOT NULL DEFAULT 'http',
  app_id TEXT NOT NULL,
  pushkey TEXT NOT NULL,
  pushkey_hash TEXT NOT NULL,
  app_display_name TEXT,
  device_display_name TEXT,
  profile_tag TEXT,
  lang TEXT,
  data_json TEXT NOT NULL DEFAULT '{}',
  gateway_url TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  last_seen_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (actor_ap_id) REFERENCES actors(ap_id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS notification_pushers_actor_product_app_pushkey_idx
  ON notification_pushers(actor_ap_id, product, app_id, pushkey_hash);

CREATE INDEX IF NOT EXISTS notification_pushers_actor_product_idx
  ON notification_pushers(actor_ap_id, product);

CREATE UNIQUE INDEX IF NOT EXISTS notification_pushers_device_idx
  ON notification_pushers(product, app_id, pushkey_hash);

CREATE INDEX IF NOT EXISTS notification_pushers_last_seen_idx
  ON notification_pushers(last_seen_at);

CREATE TABLE IF NOT EXISTS notification_push_jobs (
  id TEXT PRIMARY KEY,
  actor_ap_id TEXT NOT NULL,
  activity_ap_id TEXT NOT NULL,
  product TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  processing_token TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  pending_pusher_ids_json TEXT,
  next_attempt_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  delivered_at TEXT,
  FOREIGN KEY (actor_ap_id) REFERENCES actors(ap_id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS notification_push_jobs_actor_activity_idx
  ON notification_push_jobs(actor_ap_id, activity_ap_id);

CREATE INDEX IF NOT EXISTS notification_push_jobs_status_next_idx
  ON notification_push_jobs(status, next_attempt_at);

CREATE INDEX IF NOT EXISTS notification_push_jobs_terminal_retention_idx
  ON notification_push_jobs(status, updated_at);

CREATE INDEX IF NOT EXISTS notification_push_jobs_actor_idx
  ON notification_push_jobs(actor_ap_id);

-- Durable notification outbox: every unread inbox insert gets exactly one job.
-- The deterministic id contains only row identifiers and is never exposed to a
-- client. Delivery Queue messages carry this id, not pushkeys or content.
CREATE TRIGGER IF NOT EXISTS notification_push_jobs_after_inbox_insert
AFTER INSERT ON inbox
WHEN NEW.read = 0
BEGIN
  INSERT OR IGNORE INTO notification_push_jobs (
    id,
    actor_ap_id,
    activity_ap_id,
    product,
    status,
    attempts,
    next_attempt_at,
    created_at,
    updated_at
  ) VALUES (
    NEW.actor_ap_id || char(10) || NEW.activity_ap_id,
    NEW.actor_ap_id,
    NEW.activity_ap_id,
    NULL,
    'pending',
    0,
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  );
END;

CREATE TRIGGER IF NOT EXISTS notification_push_jobs_after_inbox_delete
AFTER DELETE ON inbox
BEGIN
  DELETE FROM notification_push_jobs
  WHERE actor_ap_id = OLD.actor_ap_id
    AND activity_ap_id = OLD.activity_ap_id
    AND status IN ('pending', 'queued', 'retry_wait');
END;
