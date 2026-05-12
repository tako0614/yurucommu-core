/**
 * Drizzle ORM Database Client for Yurucommu
 *
 * Multi-runtime support:
 * - Cloudflare Workers (D1)
 * - Node.js / Bun (libsql)
 */

import type { D1Database } from "@cloudflare/workers-types";
import { drizzle as drizzleD1 } from "drizzle-orm/d1";
import { isNull } from "drizzle-orm";
import * as schema from "./schema.ts";

export type Database = ReturnType<typeof getDb>;

/**
 * Create a Drizzle client for Cloudflare D1
 */
export function getDb(d1: D1Database) {
  return drizzleD1(d1, { schema });
}

// Singleton for non-D1 runtimes
let sqliteDb: Database | null = null;

/**
 * Create or get a Drizzle client for Node.js/Bun with SQLite file (libsql)
 *
 * The `drizzle-orm/libsql` factory returns a wrapper that mirrors the
 * `drizzle-orm/d1` wrapper's query surface but with its own runtime-specific
 * generics. The two are intentionally structurally compatible across the
 * subset of methods this codebase invokes (CRUD via the SQL builder), so we
 * funnel through a single bridging assignment to project libsql results onto
 * the D1 `Database` alias the rest of the codebase consumes. Update
 * `routes/**.ts` if libsql ever diverges on the result-meta shape.
 */
export async function getDbSQLite(databasePath: string): Promise<Database> {
  if (sqliteDb) return sqliteDb;

  const { createClient } = await import("@libsql/client");
  const { drizzle } = await import("drizzle-orm/libsql");

  const client = createClient({ url: `file:${databasePath}` });
  sqliteDb = drizzle(client, { schema }) as unknown as Database;
  return sqliteDb;
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
