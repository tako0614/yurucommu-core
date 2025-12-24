-- Migration: 0003_add_tenant_config
-- Description: Add tenant_config table for tenant configuration storage

CREATE TABLE IF NOT EXISTS tenant_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
