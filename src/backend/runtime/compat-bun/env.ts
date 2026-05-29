/**
 * Bun Cloudflare Compatibility Layer - Environment & Migrations
 */

import { readdir, readFile } from "./utils.ts";
import { D1CompatDatabase } from "./d1.ts";
import { R2CompatBucket } from "./r2.ts";
import { KVCompatNamespace } from "./kv.ts";
import { AssetsCompatFetcher } from "./assets.ts";
import { toCloudflareBindings } from "../cloudflare-binding.ts";
import { logger } from "../../lib/logger.ts";

const log = logger.child({ component: "runtime.compat.bun" });

/**
 * Create Cloudflare-compatible environment from Bun
 */
export async function createBunEnv(config: {
  databasePath?: string;
  storagePath?: string;
  assetsPath?: string;
  APP_URL: string;
  AUTH_PASSWORD_HASH?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  X_CLIENT_ID?: string;
  X_CLIENT_SECRET?: string;
  OIDC_ISSUER_URL?: string;
  OIDC_CLIENT_ID?: string;
  OIDC_CLIENT_SECRET?: string;
  OAUTH_ISSUER_URL?: string;
  TAKOSUMI_ACCOUNTS_ISSUER_URL?: string;
  TAKOSUMI_ACCOUNTS_CLIENT_ID?: string;
  TAKOSUMI_ACCOUNTS_CLIENT_SECRET?: string;
  TAKOS_URL?: string;
}) {
  const db = D1CompatDatabase.create(
    config.databasePath || "./data/yurucommu.db",
  );
  const storage = config.storagePath
    ? await R2CompatBucket.create(config.storagePath)
    : undefined;
  const kv = new KVCompatNamespace();
  const assets = config.assetsPath
    ? AssetsCompatFetcher.create(config.assetsPath)
    : undefined;

  const { getDbSQLite } = await import("../../../db/index.ts");
  const dbInstance = await getDbSQLite(
    config.databasePath || "./data/yurucommu.db",
  );

  return {
    ...toCloudflareBindings({ db, media: storage, kv, assets }),
    DB_INSTANCE: dbInstance,
    APP_URL: config.APP_URL,
    AUTH_PASSWORD_HASH: config.AUTH_PASSWORD_HASH,
    GOOGLE_CLIENT_ID: config.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: config.GOOGLE_CLIENT_SECRET,
    X_CLIENT_ID: config.X_CLIENT_ID,
    X_CLIENT_SECRET: config.X_CLIENT_SECRET,
    OIDC_ISSUER_URL: config.OIDC_ISSUER_URL,
    OIDC_CLIENT_ID: config.OIDC_CLIENT_ID,
    OIDC_CLIENT_SECRET: config.OIDC_CLIENT_SECRET,
    OAUTH_ISSUER_URL: config.OAUTH_ISSUER_URL,
    TAKOSUMI_ACCOUNTS_ISSUER_URL: config.TAKOSUMI_ACCOUNTS_ISSUER_URL,
    TAKOSUMI_ACCOUNTS_CLIENT_ID: config.TAKOSUMI_ACCOUNTS_CLIENT_ID,
    TAKOSUMI_ACCOUNTS_CLIENT_SECRET: config.TAKOSUMI_ACCOUNTS_CLIENT_SECRET,
    TAKOS_URL: config.TAKOS_URL,
  };
}

/**
 * Run migrations from SQL files
 */
export async function runMigrations(
  db: D1CompatDatabase,
  migrationsDir: string,
): Promise<void> {
  const entries = await readdir(migrationsDir, { withFileTypes: true });
  const sqlFiles = entries
    .filter((e) => e.isFile() && e.name.endsWith(".sql"))
    .map((e) => e.name)
    .sort();

  // Create migrations tracking table
  db.getRawDatabase().exec(`
    CREATE TABLE IF NOT EXISTS _cf_migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      applied_at TEXT DEFAULT (datetime('now'))
    )
  `);

  const applied = db.getRawDatabase()
    .prepare("SELECT name FROM _cf_migrations")
    .all() as Array<{ name: string }>;
  const appliedSet = new Set(applied.map((r) => r.name));

  for (const file of sqlFiles) {
    if (appliedSet.has(file)) {
      log.info("Migration already applied, skipping", {
        event: "migration.skip",
        file,
      });
      continue;
    }

    log.info("Applying migration", { event: "migration.apply", file });
    const sql = await readFile(`${migrationsDir}/${file}`, "utf-8");

    const rawDb = db.getRawDatabase();

    // Apply the whole migration file atomically. We let SQLite's own
    // multi-statement `exec()` tokenize the file (it correctly handles `;`
    // inside string literals, comments, and `CREATE TRIGGER ... BEGIN ...
    // END;` bodies) instead of naively splitting on `;`, and we wrap the
    // file in a transaction so a mid-file failure rolls back every statement
    // and the `_cf_migrations` ledger row is only written on full success.
    // Without this, a failure at statement N would leave statements 1..N-1
    // committed but unledgered, and a re-run would replay the whole file
    // (e.g. a non-idempotent `DROP TABLE` / `RENAME`) against a half-applied
    // schema, risking a wedged deploy or data loss.
    rawDb.exec("BEGIN IMMEDIATE");
    try {
      rawDb.exec(sql);
      rawDb
        .prepare("INSERT INTO _cf_migrations (name) VALUES (?)")
        .run(file);
      rawDb.exec("COMMIT");
    } catch (e) {
      rawDb.exec("ROLLBACK");
      // Do NOT log the raw SQL: migration files can carry inline values
      // (seed data, default keys, etc). Log structured fields only.
      log.error("Error applying migration", {
        event: "migration.failed",
        file,
        errorMessage: e instanceof Error ? e.message : String(e),
      });
      throw e;
    }

    log.info("Migration applied successfully", {
      event: "migration.applied",
      file,
    });
  }
}
