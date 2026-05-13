/**
 * Environment builder and migration runner
 *
 * Provides createNodeEnv to build a Cloudflare-compatible environment
 * from Node.js configuration, and runMigrations for database setup.
 */

import { getFs, getPath, loadNodeModules } from "./node-modules.ts";
import { D1CompatDatabase } from "./d1.ts";
import { R2CompatBucket } from "./r2.ts";
import { KVCompatNamespace } from "./kv.ts";
import { AssetsCompatFetcher } from "./assets.ts";
import { toCloudflareBindings } from "../cloudflare-binding.ts";

/**
 * Create Cloudflare-compatible environment from Node.js
 */
export async function createNodeEnv(config: {
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
  const db = await D1CompatDatabase.create(
    config.databasePath || "./data/yurucommu.db",
  );
  const storage = config.storagePath
    ? await R2CompatBucket.create(config.storagePath)
    : undefined;
  const kv = new KVCompatNamespace();
  const assets = config.assetsPath
    ? await AssetsCompatFetcher.create(config.assetsPath)
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
  await loadNodeModules();
  const fs = getFs();
  const path = getPath();

  const entries = await fs.readdir(migrationsDir, { withFileTypes: true });
  const sqlFiles = entries
    .filter((e) => e.isFile() && e.name.endsWith(".sql"))
    .map((e) => e.name)
    .sort();

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
      console.log(`Migration ${file} already applied, skipping`);
      continue;
    }

    console.log(`Applying migration: ${file}`);
    const sql = await fs.readFile(path.join(migrationsDir, file), "utf-8");

    const statements = sql
      .split(";")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    for (const stmt of statements) {
      try {
        db.getRawDatabase().exec(stmt);
      } catch (e) {
        console.error(`Error executing statement in ${file}:`, stmt);
        throw e;
      }
    }

    db.getRawDatabase()
      .prepare("INSERT INTO _cf_migrations (name) VALUES (?)")
      .run(file);

    console.log(`Migration ${file} applied successfully`);
  }
}
