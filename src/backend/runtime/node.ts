/**
 * Node.js Runtime Adapters
 *
 * These adapters provide implementations for Node.js environments
 * using better-sqlite3, filesystem, and in-memory stores.
 */

import { Buffer } from "node:buffer";
import type {
  FirstResult,
  IDatabase,
  IObjectStorage,
  IStaticAssets,
  ListObjectsResult,
  ObjectMetadata,
  PreparedStatement,
  QueryResult,
  RunResult,
  RuntimeEnv,
  StorageObject,
} from "./types.ts";
import { MemoryKV } from "./memory-kv.ts";
import {
  DEFAULT_LIST_LIMIT,
  getMimeType,
  META_SUFFIX,
  readStream,
} from "./shared.ts";

// Dynamic imports for Node.js modules (only loaded when needed)
import type BetterSqlite3 from "better-sqlite3";
type DatabaseConstructor = typeof BetterSqlite3;
let Database: DatabaseConstructor | null = null;
let fs: typeof import("fs/promises") | null = null;
let path: typeof import("path") | null = null;

async function loadNodeModules() {
  if (!Database) {
    const sqlite = await import("better-sqlite3");
    Database =
      (sqlite as unknown as { default: DatabaseConstructor }).default ??
        sqlite as unknown as DatabaseConstructor;
  }
  if (!fs) {
    fs = await import("fs/promises");
  }
  if (!path) {
    path = await import("path");
  }
}

/**
 * Node.js SQLite Database Adapter (using better-sqlite3)
 */
export class NodeDatabase implements IDatabase {
  private db: import("better-sqlite3").Database;

  constructor(db: import("better-sqlite3").Database) {
    this.db = db;
  }

  static async create(filename: string = ":memory:"): Promise<NodeDatabase> {
    await loadNodeModules();
    const db = new Database!(filename);
    db.pragma("journal_mode = WAL");
    return new NodeDatabase(db);
  }

  prepare(query: string): PreparedStatement {
    return new NodePreparedStatement(this.db, query);
  }

  async exec(query: string): Promise<void> {
    this.db.exec(query);
  }

  async batch<T = unknown>(
    statements: PreparedStatement[],
  ): Promise<QueryResult<T>[]> {
    const results: QueryResult<T>[] = [];
    const transaction = this.db.transaction(() => {
      for (const stmt of statements) {
        if (stmt instanceof NodePreparedStatement) {
          const result = stmt.runSync();
          results.push({
            results: [] as T[],
            success: true,
            meta: { changes: result.changes },
          });
        }
      }
    });
    transaction();
    return results;
  }
}

/**
 * Node.js SQLite Prepared Statement Adapter
 */
class NodePreparedStatement implements PreparedStatement {
  private db: import("better-sqlite3").Database;
  private query: string;
  private boundValues: unknown[] = [];

  constructor(db: import("better-sqlite3").Database, query: string) {
    this.db = db;
    this.query = query;
  }

  bind(...values: unknown[]): PreparedStatement {
    this.boundValues = values;
    return this;
  }

  async first<T = unknown>(colName?: string): Promise<FirstResult<T>> {
    const stmt = this.db.prepare(this.query);
    const row = stmt.get(...this.boundValues) as
      | Record<string, unknown>
      | undefined;
    if (!row) return null;
    if (colName) return row[colName] as T;
    return row as T;
  }

  async all<T = unknown>(): Promise<QueryResult<T>> {
    const stmt = this.db.prepare(this.query);
    const rows = stmt.all(...this.boundValues) as T[];
    return {
      results: rows,
      success: true,
    };
  }

  async run(): Promise<RunResult> {
    const result = this.runSync();
    return {
      success: true,
      meta: {
        changes: result.changes,
        last_row_id: Number(result.lastInsertRowid),
      },
    };
  }

  runSync(): import("better-sqlite3").RunResult {
    const stmt = this.db.prepare(this.query);
    return stmt.run(...this.boundValues);
  }
}

/** Parsed storage metadata shape. */
type StorageMeta = {
  httpMetadata?: ObjectMetadata["httpMetadata"];
  customMetadata?: Record<string, string>;
};

/**
 * Node.js Filesystem Storage Adapter
 */
export class NodeStorage implements IObjectStorage {
  private basePath: string;

  constructor(basePath: string) {
    this.basePath = basePath;
  }

  static async create(basePath: string): Promise<NodeStorage> {
    await loadNodeModules();
    await fs!.mkdir(basePath, { recursive: true });
    return new NodeStorage(basePath);
  }

  private getFilePath(key: string): string {
    return path!.join(this.basePath, key);
  }

  private getMetaPath(key: string): string {
    return path!.join(this.basePath, `${key}${META_SUFFIX}`);
  }

  /** Read and parse the .meta.json sidecar, returning empty object on failure. */
  private async loadMeta(key: string): Promise<StorageMeta> {
    try {
      const raw = await fs!.readFile(this.getMetaPath(key), "utf-8");
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }

  async put(
    key: string,
    value: ReadableStream | ArrayBuffer | string,
    options?: {
      httpMetadata?: ObjectMetadata["httpMetadata"];
      customMetadata?: Record<string, string>;
    },
  ): Promise<void> {
    const filePath = this.getFilePath(key);

    await fs!.mkdir(path!.dirname(filePath), { recursive: true });

    let content: Buffer;
    if (typeof value === "string") {
      content = Buffer.from(value, "utf-8");
    } else if (value instanceof ArrayBuffer) {
      content = Buffer.from(value);
    } else {
      content = Buffer.from(await readStream(value));
    }

    await fs!.writeFile(filePath, content);

    if (options?.httpMetadata || options?.customMetadata) {
      await fs!.writeFile(
        this.getMetaPath(key),
        JSON.stringify({
          httpMetadata: options.httpMetadata,
          customMetadata: options.customMetadata,
        }),
      );
    }
  }

  async get(key: string): Promise<StorageObject | null> {
    try {
      const content = await fs!.readFile(this.getFilePath(key));
      const metadata = await this.loadMeta(key);

      let bodyUsed = false;
      const arrayBuffer = content.buffer.slice(
        content.byteOffset,
        content.byteOffset + content.byteLength,
      ) as ArrayBuffer;

      return {
        key,
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array(content));
            controller.close();
          },
        }),
        bodyUsed,
        arrayBuffer: async () => {
          bodyUsed = true;
          return arrayBuffer;
        },
        text: async () => {
          bodyUsed = true;
          return content.toString("utf-8");
        },
        json: async <T>() => {
          bodyUsed = true;
          return JSON.parse(content.toString("utf-8")) as T;
        },
        httpMetadata: metadata.httpMetadata,
        customMetadata: metadata.customMetadata,
      };
    } catch {
      return null;
    }
  }

  async delete(key: string | string[]): Promise<void> {
    const keys = Array.isArray(key) ? key : [key];
    for (const k of keys) {
      for (const filePath of [this.getFilePath(k), this.getMetaPath(k)]) {
        try {
          await fs!.unlink(filePath);
        } catch {
          // Ignore if not exists
        }
      }
    }
  }

  async list(options?: {
    prefix?: string;
    limit?: number;
    cursor?: string;
    delimiter?: string;
  }): Promise<ListObjectsResult> {
    const objects: ListObjectsResult["objects"] = [];

    const readDir = async (dir: string, prefix: string = "") => {
      try {
        const entries = await fs!.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path!.join(dir, entry.name);
          const key = path!.join(prefix, entry.name);

          if (entry.isDirectory()) {
            await readDir(fullPath, key);
          } else if (!entry.name.endsWith(META_SUFFIX)) {
            if (!options?.prefix || key.startsWith(options.prefix)) {
              const stats = await fs!.stat(fullPath);
              objects.push({
                key,
                size: stats.size,
                uploaded: stats.mtime,
              });
            }
          }
        }
      } catch {
        // Directory doesn't exist
      }
    };

    await readDir(this.basePath);

    const limit = options?.limit ?? DEFAULT_LIST_LIMIT;
    const truncated = objects.length > limit;

    return {
      objects: objects.slice(0, limit),
      truncated,
      cursor: truncated ? String(limit) : undefined,
    };
  }

  async head(key: string): Promise<ObjectMetadata | null> {
    try {
      const stats = await fs!.stat(this.getFilePath(key));
      const metadata = await this.loadMeta(key);

      return {
        contentLength: stats.size,
        httpMetadata: metadata.httpMetadata,
        customMetadata: metadata.customMetadata,
      };
    } catch {
      return null;
    }
  }
}

/**
 * Static file server for Node.js
 */
export class NodeAssets implements IStaticAssets {
  private basePath: string;

  constructor(basePath: string) {
    this.basePath = basePath;
  }

  static async create(basePath: string): Promise<NodeAssets> {
    await loadNodeModules();
    return new NodeAssets(basePath);
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    let filePath = path!.join(this.basePath, url.pathname);

    // Security: prevent directory traversal
    if (!filePath.startsWith(this.basePath)) {
      return new Response("Forbidden", { status: 403 });
    }

    try {
      const stats = await fs!.stat(filePath);

      // If directory, try index.html
      if (stats.isDirectory()) {
        filePath = path!.join(filePath, "index.html");
      }

      const content = await fs!.readFile(filePath);
      const ext = path!.extname(filePath).toLowerCase();
      const contentType = getMimeType(ext);

      return new Response(content, {
        headers: {
          "Content-Type": contentType,
          "Content-Length": String(content.length),
        },
      });
    } catch {
      // SPA fallback - serve index.html for non-existent paths
      try {
        const indexPath = path!.join(this.basePath, "index.html");
        const content = await fs!.readFile(indexPath);
        return new Response(content, {
          headers: { "Content-Type": "text/html" },
        });
      } catch {
        return new Response("Not Found", { status: 404 });
      }
    }
  }
}

/**
 * Create runtime environment for Node.js
 */
export async function createNodeRuntime(config: {
  databasePath?: string;
  storagePath?: string;
  assetsPath?: string;
  envVars: {
    APP_URL: string;
    GOOGLE_CLIENT_ID?: string;
    GOOGLE_CLIENT_SECRET?: string;
    DISCORD_CLIENT_ID?: string;
    DISCORD_CLIENT_SECRET?: string;
    GITHUB_CLIENT_ID?: string;
    GITHUB_CLIENT_SECRET?: string;
  };
}): Promise<RuntimeEnv> {
  return {
    db: await NodeDatabase.create(config.databasePath || ":memory:"),
    storage: config.storagePath
      ? await NodeStorage.create(config.storagePath)
      : undefined,
    kv: new MemoryKV(),
    assets: config.assetsPath
      ? await NodeAssets.create(config.assetsPath)
      : undefined,
    ...config.envVars,
  };
}
