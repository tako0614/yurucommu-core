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

import { mkdir, readdir, readFile, stat } from "node:fs/promises";
import process from "node:process";
import { BunAssets, BunDatabase, BunStorage } from "./runtime/bun.ts";
import { MemoryKV } from "./runtime/memory-kv.ts";
import type { Env, EnvVars } from "./types.ts";
import type {
  DeliveryDlqMessageV1,
  DeliveryQueueMessageV1,
} from "./lib/delivery/types.ts";
import {
  buildDeliverEndpointMessage,
  enqueuePendingDeliveryEndpointJobs,
} from "./lib/delivery/queue.ts";
import { enqueuePendingDeliveryResolutionJobs } from "./lib/delivery/resolution-outbox.ts";
import { enqueuePendingDeliveryFanoutJobs } from "./lib/delivery/fanout-outbox.ts";
import { getDb, type Database } from "../db/index.ts";
import { logger } from "./lib/logger.ts";
import type {
  IQueueBatch,
  IQueueMessage,
  IQueueProducer,
  QueueBatchItem,
  QueueSendOptions,
} from "./runtime/queue.ts";

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

type LocalRuntimeEnvKey = Exclude<keyof EnvVars, "APP_URL">;

// Keep the Bun self-host adapter wire-equivalent to Worker bindings. Using a
// complete Record makes TypeScript fail whenever EnvVars gains a new runtime
// setting without an explicit local-runtime decision, instead of silently
// dropping authority/security configuration such as OIDC_OWNER_SUB.
const ENV_PASSTHROUGH_KEY_SET: Record<LocalRuntimeEnvKey, true> = {
  ENABLE_TAKOS_TOOLS: true,
  AUTH_PASSWORD_HASH: true,
  GOOGLE_CLIENT_ID: true,
  GOOGLE_CLIENT_SECRET: true,
  X_CLIENT_ID: true,
  X_CLIENT_SECRET: true,
  OIDC_ISSUER_URL: true,
  OIDC_CLIENT_ID: true,
  OIDC_CLIENT_SECRET: true,
  OAUTH_ISSUER_URL: true,
  TAKOSUMI_ACCOUNTS_ISSUER_URL: true,
  TAKOSUMI_ACCOUNTS_CLIENT_ID: true,
  TAKOSUMI_ACCOUNTS_CLIENT_SECRET: true,
  OIDC_OWNER_SUB: true,
  TAKOSUMI_ACCOUNTS_OWNER_SUB: true,
  ALLOW_UNPINNED_OWNER_CLAIM: true,
  OIDC_ALLOWED_SUBS: true,
  TAKOS_URL: true,
  AUTH_MODE: true,
  ENCRYPTION_KEY: true,
  YURUCOMMU_SESSION_HASH_SALT: true,
  DELIVERY_SHADOW_PROBE_HOSTS: true,
  DELIVERY_SHADOW_PROBE_SAMPLE_RATE: true,
  DELIVERY_QUEUE_NAME: true,
  DELIVERY_DLQ_NAME: true,
  YURUCOMMU_STRICT_READINESS: true,
  YURUCOMMU_ENABLE_LOCAL_SUBSTRATE_REMOTE_FETCHES: true,
  YURUCOMMU_ENABLE_LOCAL_DELIVERY_QUEUE: true,
  YURUCOMMU_SOFTWARE_VERSION: true,
  YURUCOMMU_NOTIFICATION_PUSH_GATEWAY_ALLOWED_HOSTS: true,
  YURUCOMMU_NOTIFICATION_PUSH_GATEWAY_URL: true,
  YURUCOMMU_NOTIFICATION_PUSH_GATEWAY_TOKEN: true,
  YURUCOMMU_NOTIFICATION_PUSH_GATEWAY_TIMEOUT_MS: true,
  YURUCOMMU_NOTIFICATION_PUSH_ALLOW_INSECURE_LOOPBACK: true,
  YURUCOMMU_NOTIFICATION_PUSH_WEB_PUSH_PUBLIC_KEY: true,
  CSRF_ALLOWED_ORIGINS: true,
  YURUCOMMU_RTC_ICE_SERVERS: true,
  YURUCOMMU_RTC_TURN_URIS: true,
  YURUCOMMU_RTC_TURN_SECRET: true,
  YURUCOMMU_RTC_TURN_TTL: true,
  YURUCOMMU_RTC_SFU_ADAPTER: true,
  YURUCOMMU_RTC_SFU_URL: true,
  YURUCOMMU_RTC_SFU_TOKEN: true,
  YURUCOMMU_RTC_SFU_APP_ID: true,
  YURUCOMMU_RTC_SFU_APP_SECRET: true,
  TAKOS_TRUST_PROXY: true,
};

const ENV_PASSTHROUGH_KEYS = Object.keys(
  ENV_PASSTHROUGH_KEY_SET,
) as LocalRuntimeEnvKey[];

export function buildLocalRuntimeEnvPassthrough(
  source: Readonly<Record<string, string | undefined>>,
): Partial<Record<LocalRuntimeEnvKey, string | undefined>> {
  const passthrough: Partial<Record<LocalRuntimeEnvKey, string | undefined>> =
    {};
  for (const key of ENV_PASSTHROUGH_KEYS) {
    passthrough[key] = source[key];
  }
  return passthrough;
}

function isTruthyEnv(value: string | undefined): boolean {
  if (!value) return false;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

type LocalQueueBody = DeliveryQueueMessageV1 | DeliveryDlqMessageV1;

function createLocalMessageBatch<T extends LocalQueueBody>(
  queueName: string,
  bodies: T[],
  requeue: (body: T, delaySeconds?: number) => void,
): IQueueBatch<T> {
  const messages = bodies.map((body): IQueueMessage<T> => {
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
    };
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
  };
}

function createLocalQueue<T extends LocalQueueBody>(
  env: LocalServerEnv,
  queueName: string,
): IQueueProducer<T> {
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
    send: async (body: T, options?: QueueSendOptions) => {
      enqueue(body, options?.delaySeconds);
    },
    sendBatch: async (messages: readonly QueueBatchItem<T>[]) => {
      for (const message of messages) {
        enqueue(message.body, message.delaySeconds);
      }
    },
  };
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

// ---------------------------------------------------------------------------
// Local delivery queue durability: reconciliation sweep
// ---------------------------------------------------------------------------
//
// The in-memory local queue (createLocalQueue) holds queued/retry-waiting
// deliveries only in process memory + setTimeout timers. On the supported
// bun/node-postgres self-host path a restart loses every in-flight delivery.
//
// The delivery_queue table is the durable record of work that still needs to
// run, so we reconcile it back into the in-memory queue on startup and on a
// periodic interval. We re-enqueue every row whose terminal disposition has
// not been reached:
//   - pending / retry_wait: enqueued or waiting for a retry that the lost
//     setTimeout would otherwise never fire.
//   - processing older than the stale threshold: a delivery that was claimed
//     by a worker that died before acking/finishing (queue-delivery.ts treats
//     such rows as reclaimable via STALE_PROCESSING_MS).
// Rows in delivered / dead_letter / failed are terminal and skipped.
//
// This is guarded to the local/bun queue path only — under Cloudflare Queues
// the platform persists in-flight messages and re-delivers them itself, so the
// sweep must not run there.

/** How often the periodic reconciliation sweep runs. */
const RECONCILE_SWEEP_INTERVAL_MS = 60 * 1000;

/**
 * Select non-terminal delivery_queue rows and re-enqueue them onto the local
 * delivery queue. Returns the number of rows re-enqueued.
 */
export async function reconcileLocalDeliveryQueue(
  env: LocalServerEnv,
): Promise<number> {
  return await enqueuePendingDeliveryEndpointJobs(env, new Date(), {
    // The local queue is process memory. Recreate even future retry timers now;
    // processDeliverEndpoint will defer them to their stored nextAttemptAt.
    includeDeferred: true,
    includeFreshPending: true,
  });
}

/**
 * Run the reconciliation sweep once at startup and then on a periodic
 * interval. Local/bun queue path only. Errors are logged and swallowed so a
 * transient DB hiccup never tears down the server.
 */
function startLocalDeliveryQueueReconciler(env: LocalServerEnv): void {
  const runSweep = async (trigger: "startup" | "interval") => {
    try {
      const fanoutJobs = await enqueuePendingDeliveryFanoutJobs(env, {
        // The local Queue is process memory. At startup, accepted-but-not-yet-
        // completed wakeups disappeared with the previous process.
        includePublished: trigger === "startup",
      });
      const endpointJobs = await reconcileLocalDeliveryQueue(env);
      const resolutionJobs = await enqueuePendingDeliveryResolutionJobs(env);
      const requeued = fanoutJobs + endpointJobs + resolutionJobs;
      if (requeued > 0) {
        log.info("Reconciled local delivery queue", {
          event: "server.local_delivery_queue.reconciled",
          trigger,
          requeued,
          fanoutJobs,
          endpointJobs,
          resolutionJobs,
        });
      }
    } catch (error) {
      log.error("Local delivery queue reconciliation failed", {
        event: "server.local_delivery_queue.reconcile_failed",
        trigger,
        error,
      });
    }
  };

  void runSweep("startup");
  const timer = setInterval(() => {
    void runSweep("interval");
  }, RECONCILE_SWEEP_INTERVAL_MS);
  // Do not keep the event loop alive solely for the reconciler.
  (timer as { unref?: () => void }).unref?.();
}

/**
 * Open the single SQLite connection used by both migrations and request
 * handling in Bun self-host mode.
 *
 * Keeping both surfaces on BunDatabase is intentional. A second libSQL
 * connection made Drizzle batch writes visible to that connection while the
 * process was alive without durably committing them to the SQLite file.
 */
export function createLocalDatabase(databasePath: string): {
  db: Database;
  rawDb: BunDatabase;
} {
  const rawDb = BunDatabase.create(databasePath);
  const db = getDb(
    rawDb as unknown as Parameters<typeof getDb>[0],
  ) as unknown as Database;
  return { db, rawDb };
}

async function createLocalServerEnv(config: {
  databasePath: string;
  storagePath: string;
  assetsPath: string;
  appUrl: string;
}): Promise<{ env: LocalServerEnv; rawDb: BunDatabase }> {
  const { db: dbInstance, rawDb } = createLocalDatabase(config.databasePath);
  const kv = new MemoryKV();
  const assets = BunAssets.create(config.assetsPath);
  const media = await BunStorage.create(config.storagePath);

  const passthrough = buildLocalRuntimeEnvPassthrough(process.env);

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
    env.__localDeliveryQueueEnabled = true;
  }

  return { env, rawDb };
}

type LocalServerEnv = Pick<
  Env,
  "DB_INSTANCE" | "MEDIA" | "KV" | "ASSETS" | "DELIVERY_QUEUE" | "DELIVERY_DLQ"
> & {
  APP_URL: string;
  /**
   * Set when the in-memory local delivery queue path is active (bun/node-
   * postgres self-host). Gates the durability reconciliation sweep so it never
   * runs on the Cloudflare Queues path.
   */
  __localDeliveryQueueEnabled?: boolean;
} & Partial<Record<(typeof ENV_PASSTHROUGH_KEYS)[number], string | undefined>>;

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

  // Throughput note: the connection is opened with WAL + synchronous=NORMAL
  // (see BunDatabase.create), so each per-migration transaction below commits
  // with a single fsync instead of one fsync per statement — what made a fresh
  // self-host boot take minutes.

  rawDb.exec(`
    CREATE TABLE IF NOT EXISTS yurucommu_migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      applied_at TEXT DEFAULT (datetime('now'))
    )
  `);

  const appliedStmt = rawDb.prepare("SELECT name FROM yurucommu_migrations");
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

    // If a migration file manages its own transaction, do not wrap it again —
    // nesting BEGIN inside an open transaction is a SQLite error. Detect a
    // leading BEGIN [IMMEDIATE|DEFERRED|EXCLUSIVE|TRANSACTION] anywhere in the
    // file (ignoring SQL line comments / leading whitespace).
    const ownsTransaction =
      /(^|\n)\s*BEGIN(\s+(IMMEDIATE|DEFERRED|EXCLUSIVE|TRANSACTION))?\s*;/i.test(
        sql,
      );

    // Wrap the schema change AND its migration ledger bookkeeping in one
    // transaction so the whole file commits with a single fsync, and so a
    // failure rolls back both the schema and the tracking record together.
    // Use the driver's transaction() wrapper (BEGIN/COMMIT/ROLLBACK handled
    // internally, committing with one fsync) rather than issuing BEGIN/COMMIT
    // as separate exec scripts. If the migration file manages its own
    // transaction, run it directly to avoid nesting BEGIN inside an open
    // transaction (a SQLite error).
    const applyMigration = () => {
      rawDb.exec(sql);

      const markAppliedStmt = rawDb.prepare(
        "INSERT INTO yurucommu_migrations (name) VALUES (?)",
      );
      try {
        markAppliedStmt.run(file);
      } finally {
        markAppliedStmt.finalize?.();
      }
    };

    try {
      if (ownsTransaction) {
        applyMigration();
      } else {
        rawDb.transaction(applyMigration)();
      }
    } catch (e) {
      log.error("Error executing migration", {
        event: "server.migration.error",
        migration: file,
        error: e,
      });
      throw e;
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
    fetch: (request: Request, server?: BunServerLike) => {
      // Stamp the authentic TCP peer address onto the (server-side, never
      // client-controllable) ExecutionContext props. getClientIP uses it as a
      // last resort so a directly-exposed self-host does not collapse every
      // caller into one "unknown" rate-limit / login-lockout bucket (which would
      // let any attacker DoS the single owner's login). It is NOT a header, so a
      // client cannot forge it; behind a reverse proxy it is the proxy's address
      // (set TAKOS_TRUST_PROXY to honour X-Forwarded-For instead).
      const socketIp = server?.requestIP?.(request)?.address;
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
        props: socketIp ? { socketIp } : {},
      };
      return backendApp.fetch(request, env, ctx);
    },
  });

  log.info("Server is running", {
    event: "server.bootstrap.running",
    port: PORT,
    appUrl: APP_URL,
  });

  // Local/bun queue path only: recover in-flight deliveries lost across a
  // restart by reconciling the durable delivery_queue table back into the
  // in-memory queue (startup sweep + periodic re-sweep). The Cloudflare Queues
  // path persists in-flight messages itself, so this is gated behind the
  // local-queue flag.
  if (env.__localDeliveryQueueEnabled && env.DELIVERY_QUEUE) {
    startLocalDeliveryQueueReconciler(env);
  }
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

type BunServerLike = {
  requestIP?: (request: Request) => { address?: string } | null;
};

type BunLike = {
  serve(options: {
    port: number;
    fetch: (
      request: Request,
      server?: BunServerLike,
    ) => Response | Promise<Response>;
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
