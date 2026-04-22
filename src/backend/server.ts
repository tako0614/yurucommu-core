/**
 * Deno Server Entry Point (unified)
 *
 * This file starts the yurucommu backend on Deno.
 *
 * Usage:
 *   deno run --allow-net --allow-read --allow-write --allow-env src/backend/server.ts
 *
 * Environment variables:
 *   PORT             - Server port (default: 3000)
 *   DATABASE_PATH    - SQLite database path (default: ./data/yurucommu.db)
 *   STORAGE_PATH     - File storage path (default: ./data/storage)
 *   ASSETS_PATH      - Static assets path (default: ./dist)
 *   APP_URL          - Application URL (default: http://localhost:3000)
 *   AUTH_PASSWORD_HASH - PBKDF2-hashed password authentication
 *   GOOGLE_CLIENT_ID/SECRET - Google OAuth
 *   X_CLIENT_ID/SECRET - X (Twitter) OAuth
 *   TAKOS_URL/CLIENT_ID/SECRET - Takos OAuth
 */

import { DenoAssets, DenoDatabase, DenoStorage } from "./runtime/deno.ts";
import { MemoryKV } from "./runtime/memory-kv.ts";

// ---------------------------------------------------------------------------
// Deno sqlite3 type definitions (subset of https://deno.land/x/sqlite3 API)
// ---------------------------------------------------------------------------

/** Minimal interface for a Deno sqlite3 prepared statement. */
interface DenoSqlite3Statement {
  get(...params: unknown[]): Record<string, unknown> | undefined;
  all(...params: unknown[]): Record<string, unknown>[];
  run(...params: unknown[]): void;
  finalize(): void;
}

/** Minimal interface for a Deno sqlite3 Database (https://deno.land/x/sqlite3). */
interface DenoSqlite3Database {
  exec(sql: string): void;
  prepare(sql: string): DenoSqlite3Statement;
  transaction<T>(fn: () => T): () => T;
  changes: number;
  lastInsertRowId: number;
}

// ---------------------------------------------------------------------------
// Deno env helpers
// ---------------------------------------------------------------------------

const PORT = parseInt(Deno.env.get("PORT") ?? "3000", 10);
const DATABASE_PATH = Deno.env.get("DATABASE_PATH") ?? "./data/yurucommu.db";
const STORAGE_PATH = Deno.env.get("STORAGE_PATH") ?? "./data/storage";
const ASSETS_PATH = Deno.env.get("ASSETS_PATH") ?? "./dist";
const MIGRATIONS_PATH = Deno.env.get("MIGRATIONS_PATH") ?? "./migrations";
const APP_URL = Deno.env.get("APP_URL") ?? `http://localhost:${PORT}`;

// ---------------------------------------------------------------------------
// Create Cloudflare-compatible environment from Deno
// ---------------------------------------------------------------------------

const ENV_PASSTHROUGH_KEYS = [
  "AUTH_PASSWORD_HASH",
  "ENCRYPTION_KEY",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "X_CLIENT_ID",
  "X_CLIENT_SECRET",
  "TAKOS_URL",
  "TAKOS_CLIENT_ID",
  "TAKOS_CLIENT_SECRET",
  "CLIENT_ID",
  "CLIENT_SECRET",
  "AUTH_MODE",
  "ENABLE_TAKOS_PROXY",
  "ENABLE_TAKOS_TOOLS",
  "DELIVERY_SHADOW_PROBE_HOSTS",
  "DELIVERY_SHADOW_PROBE_SAMPLE_RATE",
] as const;

async function createDenoEnv(config: {
  databasePath: string;
  storagePath: string;
  assetsPath: string;
  appUrl: string;
}) {
  const db = await DenoDatabase.create(config.databasePath);
  const kv = new MemoryKV();
  const assets = DenoAssets.create(config.assetsPath);
  const media = await DenoStorage.create(config.storagePath);

  const passthrough: Record<string, string | undefined> = {};
  for (const key of ENV_PASSTHROUGH_KEYS) {
    passthrough[key] = Deno.env.get(key);
  }

  return {
    DB: db as unknown as D1Database,
    MEDIA: media as unknown as R2Bucket,
    KV: kv as unknown as KVNamespace,
    ASSETS: assets as unknown as Fetcher,
    APP_URL: config.appUrl,
    ...passthrough,
  };
}

// ---------------------------------------------------------------------------
// Run migrations from SQL files
// ---------------------------------------------------------------------------

export async function runMigrations(
  db: DenoDatabase,
  migrationsDir: string,
): Promise<void> {
  const entries: string[] = [];
  for await (const entry of Deno.readDir(migrationsDir)) {
    if (entry.isFile && entry.name.endsWith(".sql")) {
      entries.push(entry.name);
    }
  }
  entries.sort();

  const rawDb = db.getRawDatabase() as DenoSqlite3Database;

  rawDb.exec(`
    CREATE TABLE IF NOT EXISTS _cf_migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      applied_at TEXT DEFAULT (datetime('now'))
    )
  `);

  const appliedStmt = rawDb.prepare("SELECT name FROM _cf_migrations");
  let applied: Array<{ name: string }>;
  try {
    applied = appliedStmt.all() as Array<{ name: string }>;
  } finally {
    appliedStmt.finalize();
  }
  const appliedSet = new Set(applied.map((r) => r.name));

  for (const file of entries) {
    if (appliedSet.has(file)) {
      console.log(`Migration ${file} already applied, skipping`);
      continue;
    }

    console.log(`Applying migration: ${file}`);
    const sql = await Deno.readTextFile(`${migrationsDir}/${file}`);

    try {
      rawDb.exec(sql);
    } catch (e) {
      console.error(`Error executing migration ${file}`);
      throw e;
    }

    const markAppliedStmt = rawDb.prepare(
      "INSERT INTO _cf_migrations (name) VALUES (?)",
    );
    try {
      markAppliedStmt.run(file);
    } finally {
      markAppliedStmt.finalize();
    }
    console.log(`Migration ${file} applied successfully`);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("Starting Yurucommu server (Deno mode)...");

  // Ensure data directory exists
  const dataDir = DATABASE_PATH.substring(0, DATABASE_PATH.lastIndexOf("/"));
  try {
    await Deno.mkdir(dataDir, { recursive: true });
  } catch { /* ignore if exists */ }

  const env = await createDenoEnv({
    databasePath: DATABASE_PATH,
    storagePath: STORAGE_PATH,
    assetsPath: ASSETS_PATH,
    appUrl: APP_URL,
  });

  // Run migrations
  try {
    await Deno.stat(MIGRATIONS_PATH);
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) {
      throw error;
    }
    console.log("No migrations directory found, skipping migrations");
    await startServer(env);
    return;
  }

  console.log("Running database migrations...");
  await runMigrations(env.DB as unknown as DenoDatabase, MIGRATIONS_PATH);
  console.log("Migrations complete");

  await startServer(env);
}

async function startServer(env: Awaited<ReturnType<typeof createDenoEnv>>) {
  console.log(`\nServer starting on http://localhost:${PORT}`);
  console.log(`  APP_URL: ${APP_URL}`);
  console.log(`  Database: ${DATABASE_PATH}`);
  console.log(`  Storage: ${STORAGE_PATH}`);
  console.log(`  Assets: ${ASSETS_PATH}`);
  console.log("");

  const { default: app } = await import("./index.ts");

  Deno.serve({ port: PORT }, (request: Request) => {
    const ctx = {
      waitUntil: (promise: Promise<unknown>) => {
        promise.catch((error) => {
          console.error("Background task failed:", error);
        });
      },
      passThroughOnException: () => {},
    } as ExecutionContext;
    return app.fetch(request, env, ctx);
  });

  console.log(`Server is running at http://localhost:${PORT}`);
}

if (import.meta.main) {
  main().catch((error) => {
    console.error("Failed to start server:", error);
    Deno.exit(1);
  });
}
