/// <reference types="@cloudflare/workers-types" />

import type { AgentType } from "@takos/platform/server";

export type ConfigAuditAction = "config_import" | "ai_action_toggle";

export type ConfigAuditDetails = Record<string, unknown> | null;

export type ConfigAuditEntry = {
  id: number;
  action: ConfigAuditAction;
  actor_id: string | null;
  actor_handle: string | null;
  agent_type: AgentType | null;
  details: ConfigAuditDetails;
  created_at: string;
};

type ConfigAuditInput = {
  action: ConfigAuditAction;
  actorId?: string | null;
  actorHandle?: string | null;
  agentType?: AgentType | null;
  details?: ConfigAuditDetails;
  timestamp?: string;
};

const CREATE_AUDIT_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS config_audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  action TEXT NOT NULL,
  actor_id TEXT,
  actor_handle TEXT,
  agent_type TEXT,
  details_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
)`;

const CREATE_AUDIT_INDEX_SQL = `
CREATE INDEX IF NOT EXISTS idx_config_audit_created_at
ON config_audit_log (created_at, id DESC)`;

const INSERT_AUDIT_SQL = `
INSERT INTO config_audit_log (action, actor_id, actor_handle, agent_type, details_json, created_at)
VALUES (?, ?, ?, ?, ?, ?)`;

const SELECT_AUDIT_SQL = `
SELECT id, action, actor_id, actor_handle, agent_type, details_json, created_at
FROM config_audit_log
ORDER BY created_at DESC, id DESC
LIMIT ?`;

async function ensureAuditTable(db: D1Database): Promise<void> {
  await db.prepare(CREATE_AUDIT_TABLE_SQL).run();
  await db.prepare(CREATE_AUDIT_INDEX_SQL).run();
}

const parseDetails = (value: unknown): ConfigAuditDetails => {
  if (!value) return null;
  if (typeof value === "object") return value as ConfigAuditDetails;
  if (typeof value !== "string") return null;

  try {
    return JSON.parse(value) as ConfigAuditDetails;
  } catch {
    return null;
  }
};

const normalizeLimit = (limit?: number | null): number => {
  if (!limit || Number.isNaN(limit)) return 50;
  return Math.min(Math.max(limit, 1), 200);
};

export async function recordConfigAudit(db: D1Database, input: ConfigAuditInput): Promise<void> {
  await ensureAuditTable(db);
  const createdAt = input.timestamp ?? new Date().toISOString();
  const detailsJson = input.details ? JSON.stringify(input.details) : null;

  await db
    .prepare(INSERT_AUDIT_SQL)
    .bind(
      input.action,
      input.actorId ?? null,
      input.actorHandle ?? null,
      input.agentType ?? null,
      detailsJson,
      createdAt,
    )
    .run();
}

export async function listConfigAudit(
  db: D1Database,
  options?: { limit?: number },
): Promise<ConfigAuditEntry[]> {
  await ensureAuditTable(db);
  const limit = normalizeLimit(options?.limit);
  const res = await db.prepare(SELECT_AUDIT_SQL).bind(limit).all();
  const rows = (res.results || []) as Array<{
    id: number;
    action: ConfigAuditAction;
    actor_id?: string | null;
    actor_handle?: string | null;
    agent_type?: AgentType | null;
    details_json?: string | null;
    created_at?: string;
  }>;

  return rows.map((row) => ({
    id: Number(row.id),
    action: row.action,
    actor_id: row.actor_id ?? null,
    actor_handle: row.actor_handle ?? null,
    agent_type: (row.agent_type as AgentType | null) ?? null,
    details: parseDetails(row.details_json),
    created_at: row.created_at || new Date().toISOString(),
  }));
}
