-- 0036 repairs published Core 3.2.0's already-applied 0019. Filenames are
-- ledger identities: changing current 0019 cannot remove its historical FKs.
-- Apply this complete file AND its ledger mark atomically, with all application,
-- inbox, push/queue/cron and account-deletion writers/consumers closed.
-- Keep every row and state column. Both historical and current schemas already
-- enforce global device uniqueness. No filtering, deduplication, cascade,
-- inferred identity reassignment or pending-job reset is permitted here.
-- Push tables reference actors only outward; no shipped table references them.
-- Validate the actual target's schema and backup before operator application.
-- DROP removes table-owned guards, and dangling inbox triggers break ALTER, so
-- remove the two inbox triggers before either rebuild and restore all five.

-- An extra column, inbound FK or custom table-owned trigger may carry state
-- this known-shape rebuild cannot preserve. Fail before any DROP rather than
-- silently discarding it. Known CREATE declarations are checked below as well;
-- this guard does not replace operator schema/ledger/quiescence inspection.
-- These exact supported CREATE declarations come from published Core 3.2.0
-- and current 0019/0031. SQLite strips IF NOT EXISTS and the terminating ; in
-- sqlite_master. Exact comparison intentionally refuses reformatted/customized
-- schemas: column/type/default/constraint/generated-column, custom index, or
-- named-trigger changes require a separately reviewed repair instead of loss.
CREATE TABLE notification_push_repair_expected_schema_0036 (
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  definition TEXT NOT NULL
);
INSERT INTO notification_push_repair_expected_schema_0036 VALUES ('table', 'notification_pushers', 'CREATE TABLE notification_pushers (
  id TEXT PRIMARY KEY,
  actor_ap_id TEXT NOT NULL,
  product TEXT NOT NULL,
  scope TEXT,
  kind TEXT NOT NULL DEFAULT ''http'',
  app_id TEXT NOT NULL,
  pushkey TEXT NOT NULL,
  pushkey_hash TEXT NOT NULL,
  app_display_name TEXT,
  device_display_name TEXT,
  profile_tag TEXT,
  lang TEXT,
  data_json TEXT NOT NULL DEFAULT ''{}'',
  gateway_url TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime(''%Y-%m-%dT%H:%M:%fZ'', ''now'')),
  updated_at TEXT NOT NULL DEFAULT (strftime(''%Y-%m-%dT%H:%M:%fZ'', ''now'')),
  last_seen_at TEXT NOT NULL DEFAULT (strftime(''%Y-%m-%dT%H:%M:%fZ'', ''now''))
)');
INSERT INTO notification_push_repair_expected_schema_0036 VALUES ('table', 'notification_push_jobs', 'CREATE TABLE notification_push_jobs (
  id TEXT PRIMARY KEY,
  actor_ap_id TEXT NOT NULL,
  activity_ap_id TEXT NOT NULL,
  product TEXT,
  status TEXT NOT NULL DEFAULT ''pending'',
  processing_token TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  pending_pusher_ids_json TEXT,
  next_attempt_at TEXT NOT NULL DEFAULT (strftime(''%Y-%m-%dT%H:%M:%fZ'', ''now'')),
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime(''%Y-%m-%dT%H:%M:%fZ'', ''now'')),
  updated_at TEXT NOT NULL DEFAULT (strftime(''%Y-%m-%dT%H:%M:%fZ'', ''now'')),
  delivered_at TEXT
)');
INSERT INTO notification_push_repair_expected_schema_0036 VALUES ('index', 'notification_pushers_actor_product_idx', 'CREATE INDEX notification_pushers_actor_product_idx
  ON notification_pushers(actor_ap_id, product)');
INSERT INTO notification_push_repair_expected_schema_0036 VALUES ('index', 'notification_pushers_device_idx', 'CREATE UNIQUE INDEX notification_pushers_device_idx
  ON notification_pushers(product, app_id, pushkey_hash)');
INSERT INTO notification_push_repair_expected_schema_0036 VALUES ('index', 'notification_pushers_last_seen_idx', 'CREATE INDEX notification_pushers_last_seen_idx
  ON notification_pushers(last_seen_at)');
INSERT INTO notification_push_repair_expected_schema_0036 VALUES ('index', 'notification_push_jobs_actor_activity_idx', 'CREATE UNIQUE INDEX notification_push_jobs_actor_activity_idx
  ON notification_push_jobs(actor_ap_id, activity_ap_id)');
INSERT INTO notification_push_repair_expected_schema_0036 VALUES ('index', 'notification_push_jobs_status_next_idx', 'CREATE INDEX notification_push_jobs_status_next_idx
  ON notification_push_jobs(status, next_attempt_at)');
INSERT INTO notification_push_repair_expected_schema_0036 VALUES ('index', 'notification_push_jobs_terminal_retention_idx', 'CREATE INDEX notification_push_jobs_terminal_retention_idx
  ON notification_push_jobs(status, updated_at)');
INSERT INTO notification_push_repair_expected_schema_0036 VALUES ('index', 'notification_push_jobs_actor_idx', 'CREATE INDEX notification_push_jobs_actor_idx
  ON notification_push_jobs(actor_ap_id)');
INSERT INTO notification_push_repair_expected_schema_0036 VALUES ('table', 'notification_pushers', 'CREATE TABLE notification_pushers (
  id TEXT PRIMARY KEY,
  actor_ap_id TEXT NOT NULL,
  product TEXT NOT NULL,
  scope TEXT,
  kind TEXT NOT NULL DEFAULT ''http'',
  app_id TEXT NOT NULL,
  pushkey TEXT NOT NULL,
  pushkey_hash TEXT NOT NULL,
  app_display_name TEXT,
  device_display_name TEXT,
  profile_tag TEXT,
  lang TEXT,
  data_json TEXT NOT NULL DEFAULT ''{}'',
  gateway_url TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime(''%Y-%m-%dT%H:%M:%fZ'', ''now'')),
  updated_at TEXT NOT NULL DEFAULT (strftime(''%Y-%m-%dT%H:%M:%fZ'', ''now'')),
  last_seen_at TEXT NOT NULL DEFAULT (strftime(''%Y-%m-%dT%H:%M:%fZ'', ''now'')),
  FOREIGN KEY (actor_ap_id) REFERENCES actors(ap_id) ON DELETE CASCADE
)');
INSERT INTO notification_push_repair_expected_schema_0036 VALUES ('table', 'notification_push_jobs', 'CREATE TABLE notification_push_jobs (
  id TEXT PRIMARY KEY,
  actor_ap_id TEXT NOT NULL,
  activity_ap_id TEXT NOT NULL,
  product TEXT,
  status TEXT NOT NULL DEFAULT ''pending'',
  processing_token TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  pending_pusher_ids_json TEXT,
  next_attempt_at TEXT NOT NULL DEFAULT (strftime(''%Y-%m-%dT%H:%M:%fZ'', ''now'')),
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime(''%Y-%m-%dT%H:%M:%fZ'', ''now'')),
  updated_at TEXT NOT NULL DEFAULT (strftime(''%Y-%m-%dT%H:%M:%fZ'', ''now'')),
  delivered_at TEXT,
  FOREIGN KEY (actor_ap_id) REFERENCES actors(ap_id) ON DELETE CASCADE
)');
INSERT INTO notification_push_repair_expected_schema_0036 VALUES ('index', 'notification_pushers_actor_product_app_pushkey_idx', 'CREATE UNIQUE INDEX notification_pushers_actor_product_app_pushkey_idx
  ON notification_pushers(actor_ap_id, product, app_id, pushkey_hash)');
INSERT INTO notification_push_repair_expected_schema_0036 VALUES ('trigger', 'notification_push_jobs_after_inbox_insert', 'CREATE TRIGGER notification_push_jobs_after_inbox_insert
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
    ''pending'',
    0,
    strftime(''%Y-%m-%dT%H:%M:%fZ'', ''now''),
    strftime(''%Y-%m-%dT%H:%M:%fZ'', ''now''),
    strftime(''%Y-%m-%dT%H:%M:%fZ'', ''now'')
  );
END');
INSERT INTO notification_push_repair_expected_schema_0036 VALUES ('trigger', 'notification_push_jobs_after_inbox_delete', 'CREATE TRIGGER notification_push_jobs_after_inbox_delete
AFTER DELETE ON inbox
BEGIN
  DELETE FROM notification_push_jobs
  WHERE actor_ap_id = OLD.actor_ap_id
    AND activity_ap_id = OLD.activity_ap_id
    AND status IN (''pending'', ''queued'', ''retry_wait'');
END');
INSERT INTO notification_push_repair_expected_schema_0036 VALUES ('trigger', 'account_deletion_notification_pushers_insert', 'CREATE TRIGGER account_deletion_notification_pushers_insert
BEFORE INSERT ON notification_pushers
WHEN EXISTS (
  SELECT 1 FROM account_deletion_targets AS target
  WHERE (target.actor_ap_id IN (NEW.actor_ap_id))
    AND NOT EXISTS (
      SELECT 1 FROM actor_write_assertions AS marker
      WHERE marker.operation_id = target.operation_id
    )
)
BEGIN
  SELECT RAISE(ABORT, ''account deletion reserved'');
END');
INSERT INTO notification_push_repair_expected_schema_0036 VALUES ('trigger', 'account_deletion_notification_pushers_update', 'CREATE TRIGGER account_deletion_notification_pushers_update
BEFORE UPDATE ON notification_pushers
WHEN EXISTS (
  SELECT 1 FROM account_deletion_targets AS target
  WHERE (target.actor_ap_id IN (OLD.actor_ap_id)
    OR target.actor_ap_id IN (NEW.actor_ap_id))
    AND NOT EXISTS (
      SELECT 1 FROM actor_write_assertions AS marker
      WHERE marker.operation_id = target.operation_id
    )
)
BEGIN
  SELECT RAISE(ABORT, ''account deletion reserved'');
END');
INSERT INTO notification_push_repair_expected_schema_0036 VALUES ('trigger', 'account_deletion_notification_push_jobs_insert', 'CREATE TRIGGER account_deletion_notification_push_jobs_insert
BEFORE INSERT ON notification_push_jobs
WHEN EXISTS (
  SELECT 1 FROM account_deletion_targets AS target
  WHERE (target.actor_ap_id IN (NEW.actor_ap_id))
    AND NOT EXISTS (
      SELECT 1 FROM actor_write_assertions AS marker
      WHERE marker.operation_id = target.operation_id
    )
)
BEGIN
  SELECT RAISE(ABORT, ''account deletion reserved'');
END');

CREATE TABLE notification_push_repair_shape_guard_0036 (
  supported INTEGER NOT NULL CHECK (supported = 1)
);
INSERT INTO notification_push_repair_shape_guard_0036 (supported)
SELECT CASE WHEN
  (SELECT COUNT(*) FROM pragma_table_info('notification_pushers')) = 17
  AND NOT EXISTS (SELECT 1 FROM pragma_table_info('notification_pushers') WHERE name NOT IN ('id', 'actor_ap_id', 'product', 'scope', 'kind', 'app_id', 'pushkey', 'pushkey_hash', 'app_display_name', 'device_display_name', 'profile_tag', 'lang', 'data_json', 'gateway_url', 'created_at', 'updated_at', 'last_seen_at'))
  AND NOT EXISTS (SELECT 1 FROM pragma_foreign_key_list('notification_pushers') WHERE "table" <> 'actors' OR "from" <> 'actor_ap_id' OR "to" <> 'ap_id' OR on_delete <> 'CASCADE' OR on_update <> 'NO ACTION')
  AND (SELECT COUNT(*) FROM pragma_foreign_key_list('notification_pushers')) <= 1
  AND (SELECT COUNT(*) FROM pragma_table_info('notification_push_jobs')) = 13
  AND NOT EXISTS (SELECT 1 FROM pragma_table_info('notification_push_jobs') WHERE name NOT IN ('id', 'actor_ap_id', 'activity_ap_id', 'product', 'status', 'processing_token', 'attempts', 'pending_pusher_ids_json', 'next_attempt_at', 'last_error', 'created_at', 'updated_at', 'delivered_at'))
  AND NOT EXISTS (SELECT 1 FROM pragma_foreign_key_list('notification_push_jobs') WHERE "table" <> 'actors' OR "from" <> 'actor_ap_id' OR "to" <> 'ap_id' OR on_delete <> 'CASCADE' OR on_update <> 'NO ACTION')
  AND (SELECT COUNT(*) FROM pragma_foreign_key_list('notification_push_jobs')) <= 1
  -- Only declarations containing a target identifier can reference these
  -- tables. Do not introspect unrelated D1 internals such as _cf_METADATA:
  -- foreign_key_list on that platform-owned table raises SQLITE_AUTH.
  -- This is a declaration filter, not a prefix allowlist for operator tables.
  AND NOT EXISTS (
    SELECT 1 FROM sqlite_master AS source
    JOIN pragma_foreign_key_list(source.name) AS edge
    WHERE source.type = 'table'
      AND (instr(lower(source.sql), 'notification_pushers') > 0
        OR instr(lower(source.sql), 'notification_push_jobs') > 0)
      AND lower(edge."table") IN ('notification_pushers', 'notification_push_jobs')
  )
  AND NOT EXISTS (SELECT 1 FROM sqlite_master WHERE type = 'trigger' AND tbl_name IN ('notification_pushers', 'notification_push_jobs') AND name NOT IN ('account_deletion_notification_pushers_insert', 'account_deletion_notification_pushers_update', 'account_deletion_notification_push_jobs_insert'))
  AND NOT EXISTS (
    SELECT 1 FROM sqlite_master AS actual
    WHERE ((actual.type = 'table' AND actual.name IN ('notification_pushers', 'notification_push_jobs'))
      OR (actual.type = 'index' AND actual.tbl_name IN ('notification_pushers', 'notification_push_jobs') AND actual.sql IS NOT NULL)
      OR (actual.type = 'trigger' AND (actual.tbl_name IN ('notification_pushers', 'notification_push_jobs')
        OR instr(lower(actual.sql), 'notification_pushers') > 0
        OR instr(lower(actual.sql), 'notification_push_jobs') > 0)))
      AND NOT EXISTS (
        SELECT 1 FROM notification_push_repair_expected_schema_0036 AS expected
        WHERE expected.kind = actual.type AND expected.name = actual.name
          AND expected.definition = actual.sql
      )
  )
  AND NOT EXISTS (
    SELECT 1 FROM notification_push_repair_expected_schema_0036 AS expected
    WHERE expected.kind IN ('index', 'trigger')
      AND expected.name <> 'notification_pushers_actor_product_app_pushkey_idx'
      AND NOT EXISTS (
        SELECT 1 FROM sqlite_master AS actual
        WHERE actual.type = expected.kind AND actual.name = expected.name
          AND actual.sql = expected.definition
      )
  )
  AND NOT EXISTS (
    SELECT 1 FROM sqlite_master WHERE type = 'view'
      AND (instr(lower(sql), 'notification_pushers') > 0
        OR instr(lower(sql), 'notification_push_jobs') > 0)
  )
THEN 1 ELSE 0 END;
DROP TABLE notification_push_repair_shape_guard_0036;
DROP TABLE notification_push_repair_expected_schema_0036;

DROP TRIGGER notification_push_jobs_after_inbox_insert;
DROP TRIGGER notification_push_jobs_after_inbox_delete;

CREATE TABLE notification_pushers_repair_0036 (
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
  last_seen_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

INSERT INTO notification_pushers_repair_0036 (
  id,
  actor_ap_id,
  product,
  scope,
  kind,
  app_id,
  pushkey,
  pushkey_hash,
  app_display_name,
  device_display_name,
  profile_tag,
  lang,
  data_json,
  gateway_url,
  created_at,
  updated_at,
  last_seen_at
)
SELECT
  id,
  actor_ap_id,
  product,
  scope,
  kind,
  app_id,
  pushkey,
  pushkey_hash,
  app_display_name,
  device_display_name,
  profile_tag,
  lang,
  data_json,
  gateway_url,
  created_at,
  updated_at,
  last_seen_at
FROM notification_pushers;

DROP TABLE notification_pushers;
ALTER TABLE notification_pushers_repair_0036 RENAME TO notification_pushers;

CREATE INDEX notification_pushers_actor_product_idx
  ON notification_pushers(actor_ap_id, product);

CREATE UNIQUE INDEX notification_pushers_device_idx
  ON notification_pushers(product, app_id, pushkey_hash);

CREATE INDEX notification_pushers_last_seen_idx
  ON notification_pushers(last_seen_at);

CREATE TABLE notification_push_jobs_repair_0036 (
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
  delivered_at TEXT
);

INSERT INTO notification_push_jobs_repair_0036 (
  id,
  actor_ap_id,
  activity_ap_id,
  product,
  status,
  processing_token,
  attempts,
  pending_pusher_ids_json,
  next_attempt_at,
  last_error,
  created_at,
  updated_at,
  delivered_at
)
SELECT
  id,
  actor_ap_id,
  activity_ap_id,
  product,
  status,
  processing_token,
  attempts,
  pending_pusher_ids_json,
  next_attempt_at,
  last_error,
  created_at,
  updated_at,
  delivered_at
FROM notification_push_jobs;

DROP TABLE notification_push_jobs;
ALTER TABLE notification_push_jobs_repair_0036 RENAME TO notification_push_jobs;

CREATE UNIQUE INDEX notification_push_jobs_actor_activity_idx
  ON notification_push_jobs(actor_ap_id, activity_ap_id);

CREATE INDEX notification_push_jobs_status_next_idx
  ON notification_push_jobs(status, next_attempt_at);

CREATE INDEX notification_push_jobs_terminal_retention_idx
  ON notification_push_jobs(status, updated_at);

CREATE INDEX notification_push_jobs_actor_idx
  ON notification_push_jobs(actor_ap_id);

CREATE TRIGGER notification_push_jobs_after_inbox_insert
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

CREATE TRIGGER notification_push_jobs_after_inbox_delete
AFTER DELETE ON inbox
BEGIN
  DELETE FROM notification_push_jobs
  WHERE actor_ap_id = OLD.actor_ap_id
    AND activity_ap_id = OLD.activity_ap_id
    AND status IN ('pending', 'queued', 'retry_wait');
END;

CREATE TRIGGER account_deletion_notification_pushers_insert
BEFORE INSERT ON notification_pushers
WHEN EXISTS (
  SELECT 1 FROM account_deletion_targets AS target
  WHERE (target.actor_ap_id IN (NEW.actor_ap_id))
    AND NOT EXISTS (
      SELECT 1 FROM actor_write_assertions AS marker
      WHERE marker.operation_id = target.operation_id
    )
)
BEGIN
  SELECT RAISE(ABORT, 'account deletion reserved');
END;

CREATE TRIGGER account_deletion_notification_pushers_update
BEFORE UPDATE ON notification_pushers
WHEN EXISTS (
  SELECT 1 FROM account_deletion_targets AS target
  WHERE (target.actor_ap_id IN (OLD.actor_ap_id)
    OR target.actor_ap_id IN (NEW.actor_ap_id))
    AND NOT EXISTS (
      SELECT 1 FROM actor_write_assertions AS marker
      WHERE marker.operation_id = target.operation_id
    )
)
BEGIN
  SELECT RAISE(ABORT, 'account deletion reserved');
END;

CREATE TRIGGER account_deletion_notification_push_jobs_insert
BEFORE INSERT ON notification_push_jobs
WHEN EXISTS (
  SELECT 1 FROM account_deletion_targets AS target
  WHERE (target.actor_ap_id IN (NEW.actor_ap_id))
    AND NOT EXISTS (
      SELECT 1 FROM actor_write_assertions AS marker
      WHERE marker.operation_id = target.operation_id
    )
)
BEGIN
  SELECT RAISE(ABORT, 'account deletion reserved');
END;
