/**
 * Drizzle ORM Database Client for Yurucommu
 *
 * Multi-runtime support:
 * - Cloudflare Workers (D1) via `drizzle-orm/d1`
 * - Node.js / Bun (libsql) via `drizzle-orm/libsql`
 *
 * Both factories return distinct subclasses of `BaseSQLiteDatabase`, with
 * different concrete result-row types (`D1Result` vs libsql's `ResultSet`).
 * The query-builder surface this app uses (`select`, `insert`, `update`,
 * `delete`, transactions) is inherited from the common base. The `Database`
 * union below preserves both result-row types; consumers that need to
 * inspect post-mutation metadata go through `affectedRowCount`.
 */

import type { D1Database, D1Result } from "@cloudflare/workers-types";
import { drizzle as drizzleD1, type DrizzleD1Database } from "drizzle-orm/d1";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";
import type { ResultSet } from "@libsql/client";
import { isNull } from "drizzle-orm";
import * as schema from "./schema.ts";

export type Database = BaseSQLiteDatabase<
  "async",
  D1Result | ResultSet,
  typeof schema
>;

/**
 * Create a Drizzle client for Cloudflare D1
 */
export function getDb(d1: D1Database): DrizzleD1Database<typeof schema> {
  return drizzleD1(d1, { schema });
}

// Singleton for non-D1 runtimes
let sqliteDb: LibSQLDatabase<typeof schema> | null = null;

/**
 * Create or get a Drizzle client for Node.js/Bun with SQLite file (libsql).
 */
export async function getDbSQLite(databasePath: string): Promise<Database> {
  if (sqliteDb) return sqliteDb;

  const { createClient } = await import("@libsql/client");
  const { drizzle } = await import("drizzle-orm/libsql");

  const client = createClient({ url: `file:${databasePath}` });
  // Enable real FK enforcement so the ON DELETE CASCADE / SET NULL edges
  // declared in the migrations are honoured at the engine level. SQLite has
  // foreign keys OFF by default per connection; without this, deleting an
  // object would orphan its likes/announces/bookmarks/recipients/story rows.
  // (The application-level cascade in delete-cascade.ts still runs so the
  // behaviour is identical on D1, which ignores this pragma.)
  await client.execute("PRAGMA foreign_keys = ON");
  sqliteDb = drizzle(client, { schema });
  return sqliteDb;
}

/**
 * Cross-runtime rows-affected accessor.
 *
 * Drizzle D1 returns `D1Result` with `meta.changes`; drizzle libsql returns
 * `ResultSet` with `rowsAffected`. Use this helper to read affected-row
 * counts portably after `update`/`delete`/`insert` builders.
 */
export function affectedRowCount(result: unknown): number {
  if (typeof result !== "object" || result === null) return 0;
  const candidate = result as {
    meta?: { changes?: number };
    rowsAffected?: number;
  };
  if (typeof candidate.meta?.changes === "number") {
    return candidate.meta.changes;
  }
  if (typeof candidate.rowsAffected === "number") return candidate.rowsAffected;
  return 0;
}

/**
 * Soft-delete helper: returns `isNull(table.deletedAt)` condition.
 * Use in WHERE clauses for tables with soft-delete (actors, objects, communities).
 */
export function notDeleted(
  table:
    | typeof schema.actors
    | typeof schema.objects
    | typeof schema.communities,
) {
  return isNull(table.deletedAt);
}

export { nowIso } from "./schema.ts";
export * from "./schema.ts";
