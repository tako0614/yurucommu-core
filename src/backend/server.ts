/**
 * Bun Server Entry Point (unified)
 *
 * This file starts the yurucommu backend on Bun.
 *
 * Usage:
 *   bun src/backend/server.ts
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
 *   OIDC_ISSUER_URL / OIDC_CLIENT_ID / OIDC_CLIENT_SECRET - OIDC login
 *   TAKOS_URL       - Optional Takos API base URL for proxy/tool integration
 */

import type { Message, MessageBatch, Queue } from "@cloudflare/workers-types";
import { mkdir, readdir, readFile, stat } from "node:fs/promises";
import process from "node:process";
import { BunAssets, BunDatabase, BunStorage } from "./runtime/bun.ts";
import { MemoryKV } from "./runtime/memory-kv.ts";
import type { Env } from "./types.ts";
import type {
  DeliveryDlqMessageV1,
  DeliveryQueueMessageV1,
} from "./lib/delivery/types.ts";
import { getDbSQLite } from "../db/index.ts";
import { logger } from "./lib/logger.ts";

const log = logger.child({ component: "server.bootstrap" });

// ---------------------------------------------------------------------------
// sqlite3 type definitions used by the local database adapter
// ---------------------------------------------------------------------------

/** Minimal interface for a sqlite3 prepared statement. */
interface LocalSqlite3Statement {
  get(...params: unknown[]): Record<string, unknown> | undefined;
  all(...params: unknown[]): Record<string, unknown>[];
  run(...params: unknown[]): void;
  finalize?(): void;
}

/** Minimal interface for a sqlite3 database. */
interface LocalSqlite3Database {
  exec(sql: string): void;
  prepare(sql: string): LocalSqlite3Statement;
  transaction<T>(fn: () => T): () => T;
  changes: number;
  lastInsertRowId: number;
}

// ---------------------------------------------------------------------------
// Runtime env helpers
// ---------------------------------------------------------------------------

const PORT = parseInt(process.env.PORT ?? "3000", 10);
const DATABASE_PATH = process.env.DATABASE_PATH ?? "./data/yurucommu.db";
const STORAGE_PATH = process.env.STORAGE_PATH ?? "./data/storage";
const ASSETS_PATH = process.env.ASSETS_PATH ?? "./dist";
const MIGRATIONS_PATH = process.env.MIGRATIONS_PATH ?? "./migrations";
const APP_URL = process.env.APP_URL ?? `http://localhost:${PORT}`;

// ---------------------------------------------------------------------------
// Create Cloudflare-compatible environment from the local runtime
// ---------------------------------------------------------------------------

const ENV_PASSTHROUGH_KEYS = [
  "AUTH_PASSWORD_HASH",
  "ENCRYPTION_KEY",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "X_CLIENT_ID",
  "X_CLIENT_SECRET",
  "OIDC_ISSUER_URL",
  "OIDC_CLIENT_ID",
  "OIDC_CLIENT_SECRET",
  "OAUTH_ISSUER_URL",
  "TAKOSUMI_ACCOUNTS_ISSUER_URL",
  "TAKOSUMI_ACCOUNTS_CLIENT_ID",
  "TAKOSUMI_ACCOUNTS_CLIENT_SECRET",
  "TAKOS_URL",
  "AUTH_MODE",
  "ENABLE_TAKOS_PROXY",
  "ENABLE_TAKOS_TOOLS",
  "DELIVERY_SHADOW_PROBE_HOSTS",
  "DELIVERY_SHADOW_PROBE_SAMPLE_RATE",
  "DELIVERY_QUEUE_NAME",
  "DELIVERY_DLQ_NAME",
  "YURUCOMMU_ENABLE_LOCAL_SUBSTRATE_REMOTE_FETCHES",
  "YURUCOMMU_ENABLE_LOCAL_DELIVERY_QUEUE",
] as const;

function isTruthyEnv(value: string | undefined): boolean {
  if (!value) return false;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

type LocalQueueBody = DeliveryQueueMessageV1 | DeliveryDlqMessageV1;

type LocalQueueSendOptions = {
  delaySeconds?: number;
};

type LocalQueueBatchItem<T> = {
  body: T;
  delaySeconds?: number;
};

function createLocalMessageBatch<T extends LocalQueueBody>(
  queueName: string,
  bodies: T[],
  requeue: (body: T, delaySeconds?: number) => void,
): MessageBatch<T> {
  const messages = bodies.map((body): Message<T> => {
    let settled = false;
    return {
      id: crypto.randomUUID(),
      timestamp: new Date(),
      attempts: 1,
      body,
      ack: () => {
        settled = true;
      },
      retry: (options?: { delaySeconds?: number }) => {
        if (settled) return;
        settled = true;
        requeue(body, options?.delaySeconds);
      },
    } as Message<T>;
  });

  return {
    queue: queueName,
    messages,
    ackAll: () => {
      for (const message of messages) message.ack();
    },
    retryAll: (options?: { delaySeconds?: number }) => {
      for (const message of messages) message.retry(options);
    },
  } as unknown as MessageBatch<T>;
}

function createLocalQueue<T extends LocalQueueBody>(
  env: LocalServerEnv,
  queueName: string,
): Queue<T> {
  const pending: T[] = [];
  let draining = false;
  let drainScheduled = false;

  const enqueue = (body: T, delaySeconds?: number) => {
    if (delaySeconds && delaySeconds > 0) {
      setTimeout(() => enqueue(body), delaySeconds * 1000);
      return;
    }
    pending.push(body);
    scheduleDrain();
  };

  const drain = async () => {
    if (draining) return;
    draining = true;
    try {
      while (pending.length > 0) {
        const batchBodies = pending.splice(0, 100);
        const { handleYurucommuQueueBatch } = await import("./index.ts");
        await handleYurucommuQueueBatch(
          createLocalMessageBatch(queueName, batchBodies, enqueue),
          env,
        );
      }
    } catch (error) {
      log.error("Local delivery queue drain failed", {
        event: "server.local_delivery_queue.drain_failed",
        queueName,
        error,
      });
    } finally {
      draining = false;
      if (pending.length > 0) scheduleDrain();
    }
  };

  function scheduleDrain() {
    if (drainScheduled) return;
    drainScheduled = true;
    queueMicrotask(() => {
      drainScheduled = false;
      void drain();
    });
  }

  return {
    send: async (body: T, options?: LocalQueueSendOptions) => {
      enqueue(body, options?.delaySeconds);
    },
    sendBatch: async (messages: Array<LocalQueueBatchItem<T>>) => {
      for (const message of messages) {
        enqueue(message.body, message.delaySeconds);
      }
    },
  } as unknown as Queue<T>;
}

function attachLocalDeliveryQueues(env: LocalServerEnv): void {
  const deliveryQueueName = env.DELIVERY_QUEUE_NAME ?? "yurucommu-delivery";
  const deliveryDlqName = env.DELIVERY_DLQ_NAME ?? "yurucommu-delivery-dlq";
  env.DELIVERY_QUEUE = createLocalQueue<DeliveryQueueMessageV1>(
    env,
    deliveryQueueName,
  );
  env.DELIVERY_DLQ = createLocalQueue<DeliveryDlqMessageV1>(
    env,
    deliveryDlqName,
  );
  log.info("Enabled local delivery queue bindings", {
    event: "server.local_delivery_queue.enabled",
    deliveryQueueName,
    deliveryDlqName,
  });
}

async function createLocalServerEnv(config: {
  databasePath: string;
  storagePath: string;
  assetsPath: string;
  appUrl: string;
}): Promise<{ env: LocalServerEnv; rawDb: BunDatabase }> {
  const db = BunDatabase.create(config.databasePath);
  const kv = new MemoryKV();
  const assets = BunAssets.create(config.assetsPath);
  const media = await BunStorage.create(config.storagePath);

  const passthrough: Record<string, string | undefined> = {};
  for (const key of ENV_PASSTHROUGH_KEYS) {
    passthrough[key] = process.env[key];
  }

  const dbInstance = await getDbSQLite(config.databasePath);
  const env: LocalServerEnv = {
    DB_INSTANCE: dbInstance,
    MEDIA: media,
    KV: kv,
    ASSETS: assets,
    APP_URL: config.appUrl,
    ...passthrough,
  };

  if (isTruthyEnv(process.env.YURUCOMMU_ENABLE_LOCAL_DELIVERY_QUEUE)) {
    attachLocalDeliveryQueues(env);
  }

  return { env, rawDb: db };
}

type LocalServerEnv = Pick<
  Env,
  "DB_INSTANCE" | "MEDIA" | "KV" | "ASSETS" | "DELIVERY_QUEUE" | "DELIVERY_DLQ"
> & { APP_URL: string } & Partial<
    Record<(typeof ENV_PASSTHROUGH_KEYS)[number], string | undefined>
  >;

// ---------------------------------------------------------------------------
// Run migrations from SQL files
// ---------------------------------------------------------------------------

export async function runMigrations(
  db: BunDatabase,
  migrationsDir: string,
): Promise<void> {
  const entries: string[] = [];
  for (const entry of await readdir(migrationsDir, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith(".sql")) {
      entries.push(entry.name);
    }
  }
  entries.sort();

  const rawDb = db.getRawDatabase() as LocalSqlite3Database;

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
    appliedStmt.finalize?.();
  }
  const appliedSet = new Set(applied.map((r) => r.name));

  for (const file of entries) {
    if (appliedSet.has(file)) {
      log.debug("Migration already applied, skipping", {
        event: "server.migration.skipped",
        migration: file,
      });
      continue;
    }

    log.info("Applying migration", {
      event: "server.migration.applying",
      migration: file,
    });
    const sql = await readFile(`${migrationsDir}/${file}`, "utf8");

    try {
      rawDb.exec(sql);
    } catch (e) {
      log.error("Error executing migration", {
        event: "server.migration.error",
        migration: file,
        error: e,
      });
      throw e;
    }

    const markAppliedStmt = rawDb.prepare(
      "INSERT INTO _cf_migrations (name) VALUES (?)",
    );
    try {
      markAppliedStmt.run(file);
    } finally {
      markAppliedStmt.finalize?.();
    }
    log.info("Migration applied successfully", {
      event: "server.migration.applied",
      migration: file,
    });
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  log.info("Starting Yurucommu server (Bun mode)", {
    event: "server.bootstrap.start",
    mode: "bun",
  });

  // Ensure data directory exists
  const dataDir = DATABASE_PATH.substring(0, DATABASE_PATH.lastIndexOf("/"));
  try {
    await mkdir(dataDir, { recursive: true });
  } catch {
    /* ignore if exists */
  }

  const { env, rawDb } = await createLocalServerEnv({
    databasePath: DATABASE_PATH,
    storagePath: STORAGE_PATH,
    assetsPath: ASSETS_PATH,
    appUrl: APP_URL,
  });

  // Run migrations
  try {
    await stat(MIGRATIONS_PATH);
  } catch (error) {
    if (!isNotFoundError(error)) {
      throw error;
    }
    log.info("No migrations directory found, skipping migrations", {
      event: "server.migrations.absent",
      migrationsPath: MIGRATIONS_PATH,
    });
    await startServer(env);
    return;
  }

  log.info("Running database migrations", {
    event: "server.migrations.running",
    migrationsPath: MIGRATIONS_PATH,
  });
  await runMigrations(rawDb, MIGRATIONS_PATH);
  log.info("Migrations complete", { event: "server.migrations.complete" });

  await startServer(env);
}

async function startServer(env: LocalServerEnv) {
  log.info("Server starting", {
    event: "server.bootstrap.starting",
    port: PORT,
    appUrl: APP_URL,
    databasePath: DATABASE_PATH,
    storagePath: STORAGE_PATH,
    assetsPath: ASSETS_PATH,
  });

  const { backendApp } = await import("./index.ts");

  bunLike().serve({
    port: PORT,
    fetch: (request: Request) => {
      const ctx: ExecutionContext = {
        waitUntil: (promise: Promise<unknown>) => {
          promise.catch((error) => {
            log.error("Background task failed", {
              event: "server.background_task.failed",
              error,
            });
          });
        },
        passThroughOnException: () => {},
        props: {},
      };
      return backendApp.fetch(request, env, ctx);
    },
  });

  log.info("Server is running", {
    event: "server.bootstrap.running",
    port: PORT,
    appUrl: APP_URL,
  });
}

if (import.meta.main) {
  main().catch((error) => {
    log.error("Failed to start server", {
      event: "server.bootstrap.failed",
      error,
    });
    process.exit(1);
  });
}

type BunLike = {
  serve(options: {
    port: number;
    fetch: (request: Request) => Response | Promise<Response>;
  }): unknown;
};

function bunLike(): BunLike {
  const bun = (globalThis as { Bun?: BunLike }).Bun;
  if (!bun) throw new Error("Bun runtime is required to start yurucommu");
  return bun;
}

function isNotFoundError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}
