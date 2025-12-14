import { describe, expect, it } from "vitest";
import { createAppCollectionFactory } from "./app-collections";

const createMockD1 = () => {
  const tables = new Map<string, Map<string, any>>();
  const statements: string[] = [];

  const getTable = (sql: string): string | null => {
    const match =
      sql.match(/FROM\s+"([^"]+)"/i) ??
      sql.match(/INTO\s+"([^"]+)"/i) ??
      sql.match(/UPDATE\s+"([^"]+)"/i) ??
      sql.match(/TABLE IF NOT EXISTS\s+"([^"]+)"/i);
    return match?.[1] ?? null;
  };

  const db: any = {
    _statements: statements,
    prepare(sql: string) {
      statements.push(sql);
      const normalized = sql.replace(/\\s+/g, " ").trim().toUpperCase();
      const table = getTable(sql);
      let bound: any[] = [];
      const stmt: any = {
        bind: (...args: any[]) => {
          bound = args;
          return stmt;
        },
        run: async () => {
          if (normalized.startsWith("CREATE TABLE IF NOT EXISTS")) {
            if (table && !tables.has(table)) tables.set(table, new Map());
            return { success: true };
          }
          if (normalized.startsWith("INSERT INTO")) {
            if (!table) throw new Error("missing table");
            if (!tables.has(table)) tables.set(table, new Map());
            const [id, data, createdAt, updatedAt] = bound;
            tables.get(table)!.set(String(id), { id: String(id), data, created_at: createdAt, updated_at: updatedAt });
            return { meta: { changes: 1 } };
          }
          if (normalized.startsWith("UPDATE")) {
            if (!table) throw new Error("missing table");
            const store = tables.get(table) ?? new Map();
            const [data, updatedAt, id] = bound;
            const existing = store.get(String(id));
            if (!existing) return { meta: { changes: 0 } };
            store.set(String(id), { ...existing, data, updated_at: updatedAt });
            tables.set(table, store);
            return { meta: { changes: 1 } };
          }
          if (normalized.startsWith("DELETE FROM") && normalized.includes("WHERE \"ID\" = ?")) {
            if (!table) throw new Error("missing table");
            const store = tables.get(table) ?? new Map();
            const id = bound[0];
            const existed = store.delete(String(id));
            tables.set(table, store);
            return { meta: { changes: existed ? 1 : 0 } };
          }
          if (normalized.startsWith("DELETE FROM") && normalized.includes("WHERE \"ID\" IN")) {
            if (!table) throw new Error("missing table");
            const store = tables.get(table) ?? new Map();
            let changes = 0;
            for (const id of bound) {
              if (store.delete(String(id))) changes += 1;
            }
            tables.set(table, store);
            return { meta: { changes } };
          }
          throw new Error(`Unsupported SQL for run(): ${sql}`);
        },
        all: async () => {
          if (!table) throw new Error("missing table");
          const store = tables.get(table) ?? new Map();
          if (normalized.startsWith("SELECT \"ID\", \"DATA\"") && normalized.includes("WHERE \"ID\" = ?")) {
            const id = bound[0];
            const row = store.get(String(id));
            return { results: row ? [row] : [] };
          }
          if (normalized.startsWith("SELECT \"ID\", \"DATA\"")) {
            return { results: Array.from(store.values()) };
          }
          throw new Error(`Unsupported SQL for all(): ${sql}`);
        },
        first: async () => {
          if (!table) throw new Error("missing table");
          const store = tables.get(table) ?? new Map();
          if (normalized.startsWith("SELECT \"ID\", \"DATA\"") && normalized.includes("WHERE \"ID\" = ?")) {
            const id = bound[0];
            return store.get(String(id)) ?? null;
          }
          if (normalized.startsWith("SELECT COUNT(*) AS CNT")) {
            return { cnt: store.size };
          }
          throw new Error(`Unsupported SQL for first(): ${sql}`);
        },
      };
      return stmt;
    },
    exec: async (_sql: string) => ({ success: true }),
  };

  return db;
};

describe("app collections", () => {
  it("creates and reads records via core.db(app:*)", async () => {
    const DB = createMockD1();
    const env: any = { DB };
    const dbFactory = createAppCollectionFactory(env, "default");
    const notes = dbFactory("app:notes");

    const created = await notes.create({ title: "hello" });
    expect(typeof (created as any).id).toBe("string");

    const loaded = await notes.findById((created as any).id);
    expect(loaded).toMatchObject({ id: (created as any).id, title: "hello" });

    const count = await notes.find({}).count();
    expect(count).toBe(1);
  });

  it("updates and deletes by id", async () => {
    const DB = createMockD1();
    const env: any = { DB };
    const dbFactory = createAppCollectionFactory(env, "default");
    const notes = dbFactory("app:notes");

    const created = await notes.create({ title: "before" });
    const updated = await notes.updateById((created as any).id, { title: "after" });
    expect(updated).toMatchObject({ id: (created as any).id, title: "after" });

    const deleted = await notes.deleteById((created as any).id);
    expect(deleted).toBe(true);
    expect(await notes.findById((created as any).id)).toBeNull();
  });

  it("isolates tables by workspace id when provided", async () => {
    const DB = createMockD1();
    const env: any = { DB };
    const wsA = createAppCollectionFactory(env, "default", "ws_a");
    const wsB = createAppCollectionFactory(env, "default", "ws_b");
    const notesA = wsA("app:notes");
    const notesB = wsB("app:notes");

    const a = await notesA.create({ title: "a" });
    const b = await notesB.create({ title: "b" });

    expect(await notesA.findById((a as any).id)).toMatchObject({ title: "a" });
    expect(await notesA.findById((b as any).id)).toBeNull();
    expect(await notesB.findById((b as any).id)).toMatchObject({ title: "b" });
  });
});
