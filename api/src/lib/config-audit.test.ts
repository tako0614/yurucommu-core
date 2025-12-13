import { beforeEach, describe, expect, it } from "vitest";
import { listConfigAudit, recordConfigAudit } from "./config-audit";

type MockAuditRow = {
  id: number;
  action: string;
  actor_id: string | null;
  actor_handle: string | null;
  agent_type: string | null;
  details_json: string | null;
  created_at: string;
};

const createMockD1 = () => {
  const rows: MockAuditRow[] = [];
  return {
    prepare(sql: string) {
      const normalized = sql.replace(/\s+/g, " ").trim().toUpperCase();
      let bound: any[] = [];
      const statement = {
        bind: (...args: any[]) => {
          bound = args;
          return statement;
        },
        run: async () => {
          if (normalized.startsWith("CREATE TABLE IF NOT EXISTS CONFIG_AUDIT_LOG")) {
            return { success: true };
          }
          if (normalized.startsWith("CREATE INDEX IF NOT EXISTS IDX_CONFIG_AUDIT_CREATED_AT")) {
            return { success: true };
          }
          if (normalized.startsWith("INSERT INTO CONFIG_AUDIT_LOG")) {
            const [action, actorId, actorHandle, agentType, detailsJson, createdAt] = bound;
            const id = rows.length + 1;
            rows.push({
              id,
              action,
              actor_id: actorId ?? null,
              actor_handle: actorHandle ?? null,
              agent_type: agentType ?? null,
              details_json: detailsJson ?? null,
              created_at: createdAt ?? new Date().toISOString(),
            });
            return { success: true };
          }
          throw new Error(`Unsupported SQL for run(): ${sql}`);
        },
        all: async () => {
          if (normalized.startsWith("SELECT ID, ACTION")) {
            const limit = bound[0] ?? 50;
            const sorted = [...rows].sort((a, b) => {
              if (a.created_at === b.created_at) return b.id - a.id;
              return b.created_at.localeCompare(a.created_at);
            });
            return { results: sorted.slice(0, limit) };
          }
          throw new Error(`Unsupported SQL for all(): ${sql}`);
        },
      };
      return statement;
    },
  };
};

describe("config audit logging", () => {
  let db: any;

  beforeEach(() => {
    db = createMockD1();
  });

  it("records config imports and toggles with parsed details", async () => {
    await recordConfigAudit(db, {
      action: "config_import",
      actorId: "admin",
      actorHandle: "root",
      agentType: "system",
      details: { schema_version: "1.0" },
      timestamp: "2024-01-01T00:00:00.000Z",
    });

    await recordConfigAudit(db, {
      action: "ai_action_toggle",
      actorId: "admin",
      details: { action_id: "ai.summary", before_enabled: false, after_enabled: true },
      timestamp: "2024-02-01T00:00:00.000Z",
    });

    const entries = await listConfigAudit(db, { limit: 10 });

    expect(entries.length).toBe(2);
    expect(entries[0].action).toBe("ai_action_toggle");
    expect(entries[0].actor_id).toBe("admin");
    expect(entries[0].details).toMatchObject({ action_id: "ai.summary", after_enabled: true });
    expect(entries[1].details).toMatchObject({ schema_version: "1.0" });
  });

  it("applies limit bounds when listing audit entries", async () => {
    await recordConfigAudit(db, {
      action: "config_import",
      actorId: "admin",
      details: { schema_version: "1.0" },
      timestamp: "2024-03-01T00:00:00.000Z",
    });
    await recordConfigAudit(db, {
      action: "ai_action_toggle",
      actorId: "admin",
      details: { action_id: "ai.tag-suggest", after_enabled: true },
      timestamp: "2024-03-02T00:00:00.000Z",
    });
    await recordConfigAudit(db, {
      action: "ai_action_toggle",
      actorId: "admin",
      details: { action_id: "ai.dm-moderator", after_enabled: false },
      timestamp: "2024-03-03T00:00:00.000Z",
    });

    const limited = await listConfigAudit(db, { limit: 1 });
    expect(limited.length).toBe(1);
    expect(limited[0].details).toMatchObject({ action_id: "ai.dm-moderator" });
  });
});
