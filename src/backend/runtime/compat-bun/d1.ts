/**
 * Bun Cloudflare Compatibility Layer - D1 Database
 *
 * Implements the runtime `IDatabase` contract on top of Bun's built-in
 * `bun:sqlite` module. The nominal Cloudflare `D1Database` is reached
 * through `runtime/cloudflare-binding.ts#toCloudflareBindings`.
 */

import { loadBunSqlite } from "./types.ts";
import type { BunSQLiteDatabase } from "./types.ts";
import type {
  FirstResult,
  IDatabase,
  PreparedStatement,
  QueryResult,
  RunResult,
} from "../types.ts";

declare const require: (specifier: string) => unknown;

interface BunRunResult {
  changes: number;
  lastInsertRowid: number;
}

function asRow(
  row: unknown,
): Record<string, unknown> | null {
  if (row === undefined || row === null) return null;
  if (typeof row !== "object") return null;
  return row as Record<string, unknown>;
}

function asBunRunResult(value: unknown): BunRunResult {
  if (
    typeof value !== "object" || value === null ||
    typeof (value as { changes?: unknown }).changes !== "number" ||
    typeof (value as { lastInsertRowid?: unknown }).lastInsertRowid !== "number"
  ) {
    return { changes: 0, lastInsertRowid: 0 };
  }
  return value as BunRunResult;
}

export class D1CompatDatabase implements IDatabase {
  private db: BunSQLiteDatabase;

  constructor(db: BunSQLiteDatabase) {
    this.db = db;
  }

  static create(filename: string = ":memory:"): D1CompatDatabase {
    const Database = loadBunSqlite(require);
    const db = new Database(filename);
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA foreign_keys = ON");
    return new D1CompatDatabase(db);
  }

  prepare(query: string): D1CompatPreparedStatement {
    return new D1CompatPreparedStatement(this.db, query);
  }

  async exec(query: string): Promise<void> {
    this.db.exec(query);
  }

  async batch<T = unknown>(
    statements: PreparedStatement[],
  ): Promise<QueryResult<T>[]> {
    const compats = statements.map((s) => {
      if (s instanceof D1CompatPreparedStatement) return s;
      throw new Error(
        "D1CompatDatabase.batch requires D1CompatPreparedStatement",
      );
    });
    const results: QueryResult<T>[] = [];
    this.db.transaction(() => {
      for (const stmt of compats) {
        try {
          const result = stmt.runSync();
          results.push({
            results: [],
            success: true,
            meta: {
              changes: result.changes,
              last_row_id: result.lastInsertRowid,
            },
          });
        } catch {
          results.push({ results: [], success: false });
        }
      }
    })();
    return results;
  }

  getRawDatabase(): BunSQLiteDatabase {
    return this.db;
  }
}

export class D1CompatPreparedStatement implements PreparedStatement {
  private db: BunSQLiteDatabase;
  private query: string;
  private boundValues: unknown[] = [];

  constructor(db: BunSQLiteDatabase, query: string) {
    this.db = db;
    this.query = query;
  }

  bind(...values: unknown[]): D1CompatPreparedStatement {
    this.boundValues = values;
    return this;
  }

  async first<T = unknown>(colName?: string): Promise<FirstResult<T>> {
    const stmt = this.db.prepare(this.query);
    const row = asRow(stmt.get(...this.boundValues));
    if (!row) return null;
    if (colName !== undefined) return row[colName] as T;
    return row as T;
  }

  async all<T = unknown>(): Promise<QueryResult<T>> {
    const stmt = this.db.prepare(this.query);
    const rows = stmt.all(...this.boundValues);
    return {
      results: rows as T[],
      success: true,
    };
  }

  async run(): Promise<RunResult> {
    const result = this.runSync();
    return {
      success: true,
      meta: {
        changes: result.changes,
        last_row_id: result.lastInsertRowid,
      },
    };
  }

  runSync(): BunRunResult {
    const stmt = this.db.prepare(this.query);
    return asBunRunResult(stmt.run(...this.boundValues));
  }
}
