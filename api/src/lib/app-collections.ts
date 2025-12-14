import type { Collection, CollectionQuery, CollectionWhereClause } from "@takos/app-sdk/server";
import type { PublicAccountBindings as Bindings } from "@takos/platform/server";

type D1Statement = {
  bind: (...args: any[]) => D1Statement;
  run: () => Promise<any>;
  all: () => Promise<{ results?: any[] }>;
  first?: <T = any>() => Promise<T | null>;
};

type D1DatabaseLike = {
  prepare: (sql: string) => D1Statement;
  exec?: (sql: string) => Promise<any>;
};

type OrderEntry = { column: string; direction: "asc" | "desc" };

const quoteIdentifier = (value: string): string => `"${value.replace(/"/g, "\"\"")}"`;

const sanitizeTableSegment = (value: string): string => {
  const cleaned = (value || "").toString().trim().replace(/[^A-Za-z0-9_]+/g, "_");
  const collapsed = cleaned.replace(/_+/g, "_").replace(/^_+|_+$/g, "");
  return collapsed || "x";
};

const normalizeCollectionKey = (name: string): string => {
  const trimmed = (name || "").trim();
  if (!trimmed.startsWith("app:")) {
    throw new Error(`Collection name must start with "app:" prefix. Got: "${trimmed}"`);
  }
  const rest = trimmed.slice("app:".length).trim();
  if (!rest) {
    throw new Error(`Collection name must include an id after "app:". Got: "${trimmed}"`);
  }
  return `app:${rest}`;
};

const resolveTableName = (appId: string, collectionName: string, workspaceId?: string | null): string => {
  const normalized = normalizeCollectionKey(collectionName);
  const namePart = normalized.slice("app:".length);
  const workspacePart = workspaceId ? `__ws_${sanitizeTableSegment(workspaceId)}` : "";
  return `app_${sanitizeTableSegment(appId)}${workspacePart}__${sanitizeTableSegment(namePart)}`;
};

const nowIso = (): string => new Date().toISOString();

const toSqlValue = (value: unknown): unknown => {
  if (value === undefined) return null;
  return value;
};

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

const buildWhere = (where: CollectionWhereClause | undefined): { sql: string; params: unknown[] } => {
  const entries = Object.entries(where ?? {}).filter(([, v]) => v !== undefined);
  if (entries.length === 0) return { sql: "", params: [] };

  const clauses: string[] = [];
  const params: unknown[] = [];

  for (const [key, value] of entries) {
    if (key === "id") {
      clauses.push(`${quoteIdentifier("id")} = ?`);
      params.push(toSqlValue(value));
      continue;
    }
    // JSON query on the stored `data` object.
    clauses.push(`json_extract(${quoteIdentifier("data")}, ?) = ?`);
    params.push(`$.${key}`);
    params.push(toSqlValue(value));
  }

  return { sql: clauses.join(" AND "), params };
};

class AppCollectionQuery<T extends Record<string, unknown>> implements CollectionQuery<T> {
  private whereClause: CollectionWhereClause;
  private order: OrderEntry[] = [];
  private take?: number;
  private skip?: number;

  constructor(
    private readonly runSelect: (options: {
      where: CollectionWhereClause;
      order: OrderEntry[];
      limit?: number;
      offset?: number;
    }) => Promise<T[]>,
    private readonly runCount: (where: CollectionWhereClause) => Promise<number>,
    where?: CollectionWhereClause,
  ) {
    this.whereClause = { ...(where ?? {}) };
  }

  where(where: CollectionWhereClause): CollectionQuery<T> {
    this.whereClause = { ...this.whereClause, ...(where ?? {}) };
    return this;
  }

  orderBy(column: string, direction: "asc" | "desc" = "asc"): CollectionQuery<T> {
    this.order.push({ column, direction });
    return this;
  }

  limit(limit: number): CollectionQuery<T> {
    this.take = Math.max(0, Math.trunc(limit));
    return this;
  }

  offset(offset: number): CollectionQuery<T> {
    this.skip = Math.max(0, Math.trunc(offset));
    return this;
  }

  async all(): Promise<T[]> {
    return this.runSelect({
      where: this.whereClause,
      order: this.order,
      limit: this.take,
      offset: this.skip,
    });
  }

  async first(): Promise<T | null> {
    const rows = await this.runSelect({
      where: this.whereClause,
      order: this.order,
      limit: this.take ?? 1,
      offset: this.skip,
    });
    return rows[0] ?? null;
  }

  async count(): Promise<number> {
    return this.runCount(this.whereClause);
  }
}

export function createAppCollectionFactory(
  env: Bindings,
  appId: string,
  workspaceId?: string | null,
): (name: string) => Collection {
  const db = (env as any)?.DB as D1DatabaseLike | undefined;
  if (!db?.prepare) {
    return () => {
      throw new Error("DB binding is not configured; App Collection API is unavailable");
    };
  }

  const ensuredTables = new Set<string>();

  const ensureTable = async (tableName: string): Promise<void> => {
    if (ensuredTables.has(tableName)) return;
    const sql =
      `CREATE TABLE IF NOT EXISTS ${quoteIdentifier(tableName)} (` +
      `${quoteIdentifier("id")} TEXT PRIMARY KEY, ` +
      `${quoteIdentifier("data")} TEXT NOT NULL, ` +
      `${quoteIdentifier("created_at")} TEXT NOT NULL, ` +
      `${quoteIdentifier("updated_at")} TEXT NOT NULL` +
      `)`;
    await db.prepare(sql).run();
    ensuredTables.add(tableName);
  };

  const readRow = (row: any): Record<string, unknown> => {
    if (!row) return {};
    const raw = typeof row.data === "string" ? row.data : "{}";
    try {
      const parsed = JSON.parse(raw);
      if (isPlainObject(parsed)) {
        return { ...parsed, id: row.id ?? parsed.id };
      }
      return { id: row.id, value: parsed };
    } catch {
      return { id: row.id, value: raw };
    }
  };

  const generateId = (): string => {
    // @ts-ignore crypto may exist in Workers
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
    return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
  };

  const createCollection = (name: string): Collection => {
    const tableName = resolveTableName(appId, name, workspaceId);

    const runSelect = async (options: {
      where: CollectionWhereClause;
      order: OrderEntry[];
      limit?: number;
      offset?: number;
    }): Promise<Record<string, unknown>[]> => {
      await ensureTable(tableName);
      const whereBuilt = buildWhere(options.where);
      const clauses: string[] = [
        `SELECT ${quoteIdentifier("id")}, ${quoteIdentifier("data")} FROM ${quoteIdentifier(tableName)}`,
      ];
      const params: unknown[] = [];
      if (whereBuilt.sql) {
        clauses.push(`WHERE ${whereBuilt.sql}`);
        params.push(...whereBuilt.params);
      }
      if (options.order.length > 0) {
        const orderParts = options.order.map((entry) => {
          if (entry.column === "id") {
            return `${quoteIdentifier("id")} ${entry.direction === "desc" ? "DESC" : "ASC"}`;
          }
          return `json_extract(${quoteIdentifier("data")}, '${`$.${entry.column}`}' ) ${entry.direction === "desc" ? "DESC" : "ASC"}`;
        });
        clauses.push(`ORDER BY ${orderParts.join(", ")}`);
      }
      if (typeof options.limit === "number") {
        clauses.push("LIMIT ?");
        params.push(options.limit);
      }
      if (typeof options.offset === "number") {
        clauses.push("OFFSET ?");
        params.push(options.offset);
      }

      const result = await db.prepare(clauses.join(" ")).bind(...params).all();
      return (result?.results ?? []).map(readRow);
    };

    const runCount = async (where: CollectionWhereClause): Promise<number> => {
      await ensureTable(tableName);
      const whereBuilt = buildWhere(where);
      const clauses: string[] = [
        `SELECT COUNT(*) as cnt FROM ${quoteIdentifier(tableName)}`,
      ];
      const params: unknown[] = [];
      if (whereBuilt.sql) {
        clauses.push(`WHERE ${whereBuilt.sql}`);
        params.push(...whereBuilt.params);
      }
      const row = await db.prepare(clauses.join(" ")).bind(...params).first?.<any>();
      return Number((row as any)?.cnt ?? 0);
    };

    const collection: Collection = {
      find: (where?: CollectionWhereClause) =>
        new AppCollectionQuery(runSelect, runCount, where ?? {}),

      findById: async (id: string | number) => {
        await ensureTable(tableName);
        const row = await db
          .prepare(
            `SELECT ${quoteIdentifier("id")}, ${quoteIdentifier("data")} FROM ${quoteIdentifier(tableName)} WHERE ${quoteIdentifier("id")} = ? LIMIT 1`,
          )
          .bind(String(id))
          .first?.<any>();
        if (!row) return null;
        return readRow(row);
      },

      create: async (data: Record<string, unknown>) => {
        await ensureTable(tableName);
        const record: Record<string, unknown> = { ...(isPlainObject(data) ? data : { value: data }) };
        const existingId = record["id"];
        const id =
          typeof existingId === "string" && existingId.trim() ? existingId.trim() : generateId();
        record["id"] = id;
        const timestamp = nowIso();
        const payload = JSON.stringify(record);
        await db
          .prepare(
            `INSERT INTO ${quoteIdentifier(tableName)} (${quoteIdentifier("id")}, ${quoteIdentifier("data")}, ${quoteIdentifier("created_at")}, ${quoteIdentifier("updated_at")}) VALUES (?, ?, ?, ?)`,
          )
          .bind(id, payload, timestamp, timestamp)
          .run();
        return record;
      },

      update: async (where: CollectionWhereClause, changes: Record<string, unknown>) => {
        const rows = await runSelect({ where, order: [], limit: undefined, offset: undefined });
        if (rows.length === 0) return 0;
        let updated = 0;
        for (const row of rows) {
          const id = String((row as any).id ?? "");
          if (!id) continue;
          const merged = { ...row, ...(isPlainObject(changes) ? changes : {}) };
          (merged as any).id = id;
          const payload = JSON.stringify(merged);
          await db
            .prepare(
              `UPDATE ${quoteIdentifier(tableName)} SET ${quoteIdentifier("data")} = ?, ${quoteIdentifier("updated_at")} = ? WHERE ${quoteIdentifier("id")} = ?`,
            )
            .bind(payload, nowIso(), id)
            .run();
          updated += 1;
        }
        return updated;
      },

      updateById: async (id: string | number, changes: Record<string, unknown>) => {
        const existing = await collection.findById(String(id));
        if (!existing) return null;
        const merged = { ...existing, ...(isPlainObject(changes) ? changes : {}) };
        (merged as any).id = String(id);
        await db
          .prepare(
            `UPDATE ${quoteIdentifier(tableName)} SET ${quoteIdentifier("data")} = ?, ${quoteIdentifier("updated_at")} = ? WHERE ${quoteIdentifier("id")} = ?`,
          )
          .bind(JSON.stringify(merged), nowIso(), String(id))
          .run();
        return merged;
      },

      delete: async (where: CollectionWhereClause) => {
        const keys = Object.keys(where ?? {});
        if (keys.length === 0) {
          throw new Error("Delete requires at least one condition to avoid removing all records");
        }
        const rows = await runSelect({ where, order: [], limit: undefined, offset: undefined });
        const ids = rows.map((row) => String((row as any).id ?? "")).filter(Boolean);
        if (ids.length === 0) return 0;
        const placeholders = ids.map(() => "?").join(", ");
        await db
          .prepare(
            `DELETE FROM ${quoteIdentifier(tableName)} WHERE ${quoteIdentifier("id")} IN (${placeholders})`,
          )
          .bind(...ids)
          .run();
        return ids.length;
      },

      deleteById: async (id: string | number) => {
        await ensureTable(tableName);
        const res = await db
          .prepare(`DELETE FROM ${quoteIdentifier(tableName)} WHERE ${quoteIdentifier("id")} = ?`)
          .bind(String(id))
          .run();
        const changes = Number((res as any)?.meta?.changes ?? (res as any)?.changes ?? 0);
        return changes > 0;
      },

      transaction: async <R>(callback: (tx: Collection) => Promise<R>) => {
        await ensureTable(tableName);
        if (typeof db.exec !== "function") {
          return callback(collection);
        }
        await db.exec("BEGIN");
        try {
          const result = await callback(collection);
          await db.exec("COMMIT");
          return result;
        } catch (error) {
          await db.exec("ROLLBACK");
          throw error;
        }
      },
    };

    return collection;
  };

  return createCollection;
}
