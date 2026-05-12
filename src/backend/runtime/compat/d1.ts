/**
 * D1Database-compatible SQLite implementation
 *
 * Implements the runtime `IDatabase` contract on top of better-sqlite3.
 * Downstream code that needs the nominal Cloudflare `D1Database` type
 * goes through `runtime/cloudflare-binding.ts#toCloudflareBindings`.
 */

import type { Database, RunResult, Statement } from "better-sqlite3";
import { getDatabase, loadNodeModules } from "./node-modules.ts";
import type {
  FirstResult,
  IDatabase,
  PreparedStatement,
  QueryResult,
  RunResult as RuntimeRunResult,
} from "../types.ts";

function asRow(
  row: unknown,
): Record<string, unknown> | undefined {
  if (row === undefined || row === null) return undefined;
  if (typeof row !== "object") return undefined;
  return row as Record<string, unknown>;
}

export class D1CompatDatabase implements IDatabase {
  private db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  static async create(
    filename: string = ":memory:",
  ): Promise<D1CompatDatabase> {
    await loadNodeModules();
    const db = new (getDatabase())(filename);
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
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
    const transaction = this.db.transaction(() => {
      for (const stmt of compats) {
        try {
          const result = stmt.runSync();
          results.push({
            results: [],
            success: true,
            meta: {
              changes: result.changes,
              last_row_id: Number(result.lastInsertRowid),
            },
          });
        } catch {
          results.push({ results: [], success: false });
        }
      }
    });
    transaction();
    return results;
  }

  getRawDatabase(): Database {
    return this.db;
  }
}

export class D1CompatPreparedStatement implements PreparedStatement {
  private db: Database;
  private query: string;
  private boundValues: unknown[] = [];

  constructor(db: Database, query: string) {
    this.db = db;
    this.query = query;
  }

  private getStatement(): Statement {
    return this.db.prepare(this.query);
  }

  bind(...values: unknown[]): D1CompatPreparedStatement {
    this.boundValues = values;
    return this;
  }

  async first<T = unknown>(colName?: string): Promise<FirstResult<T>> {
    const row = asRow(this.getStatement().get(...this.boundValues));
    if (!row) return null;
    if (colName !== undefined) return row[colName] as T;
    return row as T;
  }

  async all<T = unknown>(): Promise<QueryResult<T>> {
    const rows = this.getStatement().all(...this.boundValues);
    return {
      results: rows as T[],
      success: true,
    };
  }

  async run(): Promise<RuntimeRunResult> {
    const result = this.runSync();
    return {
      success: true,
      meta: {
        changes: result.changes,
        last_row_id: Number(result.lastInsertRowid),
      },
    };
  }

  runSync(): RunResult {
    return this.getStatement().run(...this.boundValues);
  }
}
