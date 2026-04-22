/**
 * Bun Cloudflare Compatibility Layer - D1 Database
 */

import { loadBunSqlite } from "./types.ts";
import type { BunSQLiteDatabase } from "./types.ts";

declare const require: (specifier: string) => unknown;

/**
 * D1Database-compatible SQLite implementation for Bun
 */
export class D1CompatDatabase {
  private db: BunSQLiteDatabase;

  constructor(db: unknown) {
    this.db = db as BunSQLiteDatabase;
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
    statements: D1CompatPreparedStatement[],
  ): Promise<Array<{ results: T[]; success: boolean; meta: object }>> {
    const results: Array<{ results: T[]; success: boolean; meta: object }> = [];
    this.db.transaction(() => {
      for (const stmt of statements) {
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
        } catch (e) {
          results.push({
            results: [],
            success: false,
            meta: { error: String(e) },
          });
        }
      }
    })();
    return results;
  }

  getRawDatabase(): BunSQLiteDatabase {
    return this.db;
  }
}

/**
 * D1PreparedStatement-compatible implementation for Bun
 */
export class D1CompatPreparedStatement {
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

  async first<T = unknown>(colName?: string): Promise<T | null> {
    const stmt = this.db.prepare(this.query);
    const row = stmt.get(...this.boundValues) as Record<string, unknown> | null;
    if (!row) return null;
    if (colName) return row[colName] as T;
    return row as T;
  }

  async all<T = unknown>(): Promise<
    { results: T[]; success: boolean; meta: object }
  > {
    const stmt = this.db.prepare(this.query);
    const rows = stmt.all(...this.boundValues) as T[];
    return {
      results: rows,
      success: true,
      meta: {},
    };
  }

  async run(): Promise<
    { success: boolean; meta: { changes: number; last_row_id: number } }
  > {
    const result = this.runSync();
    return {
      success: true,
      meta: {
        changes: result.changes,
        last_row_id: result.lastInsertRowid,
      },
    };
  }

  runSync(): { changes: number; lastInsertRowid: number } {
    const stmt = this.db.prepare(this.query);
    return stmt.run(...this.boundValues) as {
      changes: number;
      lastInsertRowid: number;
    };
  }
}
