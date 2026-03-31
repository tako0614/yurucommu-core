/**
 * D1Database-compatible SQLite implementation
 *
 * Provides D1CompatDatabase and D1CompatPreparedStatement classes
 * that implement the same interface as Cloudflare D1.
 */

import { loadNodeModules, getDatabase } from './node-modules.ts';

/**
 * D1Database-compatible SQLite implementation
 */
export class D1CompatDatabase {
  private db: import('better-sqlite3').Database;

  constructor(db: import('better-sqlite3').Database) {
    this.db = db;
  }

  static async create(filename: string = ':memory:'): Promise<D1CompatDatabase> {
    await loadNodeModules();
    const db = new (getDatabase())(filename);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    return new D1CompatDatabase(db);
  }

  prepare(query: string): D1CompatPreparedStatement {
    return new D1CompatPreparedStatement(this.db, query);
  }

  async exec(query: string): Promise<void> {
    this.db.exec(query);
  }

  async batch<T = unknown>(statements: D1CompatPreparedStatement[]): Promise<Array<{ results: T[]; success: boolean; meta: object }>> {
    const results: Array<{ results: T[]; success: boolean; meta: object }> = [];
    const transaction = this.db.transaction(() => {
      for (const stmt of statements) {
        try {
          const result = stmt.runSync();
          results.push({
            results: [],
            success: true,
            meta: { changes: result.changes, last_row_id: Number(result.lastInsertRowid) },
          });
        } catch (e) {
          results.push({
            results: [],
            success: false,
            meta: { error: String(e) },
          });
        }
      }
    });
    transaction();
    return results;
  }

  getRawDatabase(): import('better-sqlite3').Database {
    return this.db;
  }
}

/**
 * D1PreparedStatement-compatible implementation
 */
export class D1CompatPreparedStatement {
  private db: import('better-sqlite3').Database;
  private query: string;
  private boundValues: unknown[] = [];

  constructor(db: import('better-sqlite3').Database, query: string) {
    this.db = db;
    this.query = query;
  }

  bind(...values: unknown[]): D1CompatPreparedStatement {
    this.boundValues = values;
    return this;
  }

  async first<T = unknown>(colName?: string): Promise<T | null> {
    const stmt = this.db.prepare(this.query);
    const row = stmt.get(...this.boundValues) as Record<string, unknown> | undefined;
    if (!row) return null;
    if (colName) return row[colName] as T;
    return row as T;
  }

  async all<T = unknown>(): Promise<{ results: T[]; success: boolean; meta: object }> {
    const stmt = this.db.prepare(this.query);
    const rows = stmt.all(...this.boundValues) as T[];
    return {
      results: rows,
      success: true,
      meta: {},
    };
  }

  async run(): Promise<{ success: boolean; meta: { changes: number; last_row_id: number } }> {
    const result = this.runSync();
    return {
      success: true,
      meta: {
        changes: result.changes,
        last_row_id: Number(result.lastInsertRowid),
      },
    };
  }

  runSync(): import('better-sqlite3').RunResult {
    const stmt = this.db.prepare(this.query);
    return stmt.run(...this.boundValues);
  }
}
