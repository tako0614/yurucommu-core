import { describe, expect, it } from "vitest";
import { AppDataAdapter } from "./data-store";

type StatementCall = {
  sql: string;
  params: unknown[];
  type: "run" | "all";
};

class MockStatement {
  params: unknown[] = [];
  constructor(private readonly sql: string, private readonly calls: StatementCall[]) {}

  bind(...params: unknown[]) {
    this.params = params;
    return this;
  }

  async run() {
    this.calls.push({ sql: this.sql, params: this.params, type: "run" });
    return { success: true, meta: { changes: 1 } };
  }

  async all() {
    this.calls.push({ sql: this.sql, params: this.params, type: "all" });
    return { results: [] };
  }
}

class MockD1Database {
  calls: StatementCall[] = [];

  prepare(sql: string) {
    return new MockStatement(sql, this.calls);
  }
}

describe("AppDataAdapter", () => {
  it("creates tables, indexes, and runs selects with filters", async () => {
    const db = new MockD1Database();
    const adapter = new AppDataAdapter(
      {
        "app:notes": {
          schema: {
            id: { type: "text", primaryKey: true },
            owner_id: { type: "text", notNull: true },
            title: { type: "text" },
          },
          indexes: [{ columns: ["owner_id"] }],
        },
      },
      db as unknown as D1Database,
    );

    const rows = await adapter
      .collection("app:notes")
      .find({ owner_id: "alice" })
      .orderBy("owner_id", "desc")
      .limit(10)
      .all();

    expect(rows).toEqual([]);
    const sqls = db.calls.map((call) => call.sql);
    expect(sqls[0]).toMatch(/CREATE TABLE IF NOT EXISTS "app_app_notes"/);
    expect(sqls[0]).toMatch(/"id" TEXT PRIMARY KEY/);
    expect(sqls[0]).toMatch(/"owner_id" TEXT NOT NULL/);
    expect(sqls[1]).toMatch(/CREATE INDEX IF NOT EXISTS "app_app_notes_idx_app_notes_owner_id"/);
    expect(sqls[2]).toMatch(/SELECT \* FROM "app_app_notes" WHERE "owner_id" = \?/);
    expect(db.calls[2]?.params).toEqual(["alice", 10]);
  });

  it("runs inserts and updates with validation", async () => {
    const db = new MockD1Database();
    const adapter = new AppDataAdapter(
      {
        "app:notes": {
          schema: {
            id: { type: "text", primaryKey: true },
            owner_id: { type: "text" },
            title: { type: "text" },
          },
        },
      },
      db as unknown as D1Database,
    );
    const dao = adapter.collection("app:notes");
    await dao.insert({ id: "n1", owner_id: "alice", title: "hello" });
    await dao.update({ id: "n1" }, { title: "updated" });

    const insertCall = db.calls.find((call) => call.sql.startsWith("INSERT INTO"));
    expect(insertCall?.params).toEqual(["n1", "alice", "hello"]);

    const updateCall = db.calls.find((call) => call.sql.startsWith("UPDATE"));
    expect(updateCall?.sql).toMatch(/WHERE "id" = \?/);
    expect(updateCall?.params).toEqual(["updated", "n1"]);
  });

  it("requires where clause for delete and rejects unknown columns", async () => {
    const db = new MockD1Database();
    const adapter = new AppDataAdapter(
      {
        "app:notes": {
          schema: {
            id: { type: "text", primaryKey: true },
          },
        },
      },
      db as unknown as D1Database,
    );
    const dao = adapter.collection("app:notes");
    await expect(dao.delete({} as any)).rejects.toThrow("Delete requires at least one condition");
    await expect(dao.find({ missing: "x" }).all()).rejects.toThrow('Column "missing" is not defined');
  });

  it("resolves workspace-specific databases and table prefixes", async () => {
    const defaultDb = new MockD1Database();
    const workspaceDb = new MockD1Database();
    const adapter = new AppDataAdapter(
      {
        "app:notes": {
          schema: {
            id: { type: "text", primaryKey: true },
          },
          indexes: [{ columns: ["id"], unique: true }],
        },
      },
      defaultDb as unknown as D1Database,
      {
        resolveDatabase: (workspace) => (workspace ? (workspaceDb as unknown as D1Database) : undefined),
      },
    );

    await adapter.collection("app:notes", "ws_dev").find({ id: "x" }).first();

    expect(defaultDb.calls).toHaveLength(0);
    expect(workspaceDb.calls[0]?.sql).toMatch(/CREATE TABLE IF NOT EXISTS "app_ws_ws_dev__app_notes"/);
    expect(workspaceDb.calls[1]?.sql).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS "app_ws_ws_dev__app_notes_uidx_app_notes_id"/,
    );
  });
});
