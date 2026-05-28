-- Blocklist tables for federation moderation.
--
-- `blocked_domains` blocks every actor whose AP-ID hostname matches.
-- `blocked_actors` blocks an individual remote actor (and is the authoritative
-- record consulted by inbox content handlers).
--
-- Both tables are read on every inbound activity, so each lookup column has
-- its own index (PRIMARY KEY for the natural identifier covers the lookup).

CREATE TABLE IF NOT EXISTS blocked_domains (
  domain TEXT PRIMARY KEY,
  reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_blocked_domains_created
  ON blocked_domains(created_at);

CREATE TABLE IF NOT EXISTS blocked_actors (
  actor_ap_id TEXT PRIMARY KEY,
  reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_blocked_actors_created
  ON blocked_actors(created_at);
