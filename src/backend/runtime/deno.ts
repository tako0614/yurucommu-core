// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck - This file is Deno-specific and should be type-checked by Deno's TypeScript
/**
 * Deno Runtime Adapters
 *
 * These adapters provide implementations for Deno environments
 * using Deno's SQLite (via x/sqlite), filesystem, and in-memory stores.
 */

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

/**
 * Deno SQLite Database Adapter
 * Uses Deno's built-in SQLite via FFI or x/sqlite3
 */
export class DenoDatabase implements IDatabase {
  // @ts-expect-error - Deno SQLite type
  private db: unknown;

  // @ts-expect-error - Deno SQLite type
  constructor(db: unknown) {
    this.db = db;
  }

  static async create(filename: string = ":memory:"): Promise<DenoDatabase> {
    // @ts-expect-error - Deno import
    const { Database } = await import(
      "https://deno.land/x/sqlite3@0.12.0/mod.ts"
    );
    const db = new Database(filename);
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA foreign_keys = ON");
    return new DenoDatabase(db);
  }

  prepare(query: string): PreparedStatement {
    return new DenoPreparedStatement(this.db, query);
  }

  async exec(query: string): Promise<void> {
    // @ts-expect-error - Deno SQLite type
    this.db.exec(query);
  }

  async batch<T = unknown>(
    statements: PreparedStatement[],
  ): Promise<QueryResult<T>[]> {
    const results: QueryResult<T>[] = [];
    // @ts-expect-error - Deno SQLite type
    this.db.transaction(() => {
      for (const stmt of statements) {
        if (stmt instanceof DenoPreparedStatement) {
          const result = stmt.runSync();
          results.push({
            results: [] as T[],
            success: true,
            meta: { changes: result.changes },
          });
        }
      }
    })();
    return results;
  }

  getRawDatabase(): unknown {
    return this.db;
  }
}

/**
 * Deno SQLite Prepared Statement Adapter
 */
class DenoPreparedStatement implements PreparedStatement {
  // @ts-expect-error - Deno SQLite type
  private db: unknown;
  private query: string;
  private boundValues: unknown[] = [];

  // @ts-expect-error - Deno SQLite type
  constructor(db: unknown, query: string) {
    this.db = db;
    this.query = query;
  }

  bind(...values: unknown[]): PreparedStatement {
    this.boundValues = values;
    return this;
  }

  async first<T = unknown>(colName?: string): Promise<FirstResult<T>> {
    // @ts-expect-error - Deno SQLite type
    const stmt = this.db.prepare(this.query);
    const row = stmt.get(...this.boundValues) as
      | Record<string, unknown>
      | undefined;
    stmt.finalize();
    if (!row) return null;
    if (colName) return row[colName] as T;
    return row as T;
  }

  async all<T = unknown>(): Promise<QueryResult<T>> {
    // @ts-expect-error - Deno SQLite type
    const stmt = this.db.prepare(this.query);
    const rows = stmt.all(...this.boundValues) as T[];
    stmt.finalize();
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
        last_row_id: result.lastInsertRowid,
      },
    };
  }

  runSync(): { changes: number; lastInsertRowid: number } {
    // @ts-expect-error - Deno SQLite type
    const stmt = this.db.prepare(this.query);
    stmt.run(...this.boundValues);
    // @ts-expect-error - Deno SQLite type
    const changes = this.db.changes;
    // @ts-expect-error - Deno SQLite type
    const lastInsertRowid = this.db.lastInsertRowId;
    stmt.finalize();
    return { changes, lastInsertRowid };
  }
}

/** Parsed storage metadata shape. */
type StorageMeta = {
  httpMetadata?: ObjectMetadata["httpMetadata"];
  customMetadata?: Record<string, string>;
};

/**
 * Deno Filesystem Storage Adapter
 */
export class DenoStorage implements IObjectStorage {
  private basePath: string;

  constructor(basePath: string) {
    this.basePath = basePath;
  }

  static async create(basePath: string): Promise<DenoStorage> {
    // @ts-expect-error - Deno API
    await Deno.mkdir(basePath, { recursive: true });
    return new DenoStorage(basePath);
  }

  private getFilePath(key: string): string {
    return `${this.basePath}/${key}`;
  }

  private getMetaPath(key: string): string {
    return `${this.basePath}/${key}${META_SUFFIX}`;
  }

  /** Read and parse the .meta.json sidecar, returning empty object on failure. */
  private async loadMeta(key: string): Promise<StorageMeta> {
    try {
      // @ts-expect-error - Deno API
      const raw = await Deno.readTextFile(this.getMetaPath(key));
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

    const dir = filePath.substring(0, filePath.lastIndexOf("/"));
    // @ts-expect-error - Deno API
    await Deno.mkdir(dir, { recursive: true });

    let content: Uint8Array;
    if (typeof value === "string") {
      content = new TextEncoder().encode(value);
    } else if (value instanceof ArrayBuffer) {
      content = new Uint8Array(value);
    } else {
      content = await readStream(value);
    }

    // @ts-expect-error - Deno API
    await Deno.writeFile(filePath, content);

    if (options?.httpMetadata || options?.customMetadata) {
      // @ts-expect-error - Deno API
      await Deno.writeTextFile(
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
      // @ts-expect-error - Deno API
      const content = await Deno.readFile(this.getFilePath(key));
      const metadata = await this.loadMeta(key);

      let bodyUsed = false;

      return {
        key,
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(content);
            controller.close();
          },
        }),
        bodyUsed,
        arrayBuffer: async () => {
          bodyUsed = true;
          return content.buffer as ArrayBuffer;
        },
        text: async () => {
          bodyUsed = true;
          return new TextDecoder().decode(content);
        },
        json: async <T>() => {
          bodyUsed = true;
          return JSON.parse(new TextDecoder().decode(content)) as T;
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
          // @ts-expect-error - Deno API
          await Deno.remove(filePath);
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

    const readDirRecursive = async (dir: string, prefix: string = "") => {
      try {
        // @ts-expect-error - Deno API
        for await (const entry of Deno.readDir(dir)) {
          const fullPath = `${dir}/${entry.name}`;
          const key = prefix ? `${prefix}/${entry.name}` : entry.name;

          if (entry.isDirectory) {
            await readDirRecursive(fullPath, key);
          } else if (!entry.name.endsWith(META_SUFFIX)) {
            if (!options?.prefix || key.startsWith(options.prefix)) {
              // @ts-expect-error - Deno API
              const stats = await Deno.stat(fullPath);
              objects.push({
                key,
                size: stats.size,
                uploaded: new Date(stats.mtime ?? Date.now()),
              });
            }
          }
        }
      } catch {
        // Directory doesn't exist
      }
    };

    await readDirRecursive(this.basePath);

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
      // @ts-expect-error - Deno API
      const stats = await Deno.stat(this.getFilePath(key));
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
 * Static file server for Deno
 */
export class DenoAssets implements IStaticAssets {
  private basePath: string;

  constructor(basePath: string) {
    this.basePath = basePath;
  }

  static create(basePath: string): DenoAssets {
    return new DenoAssets(basePath);
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    let filePath = `${this.basePath}${url.pathname}`;

    // Security: prevent directory traversal
    const normalizedPath = filePath.replace(/\.\./g, "");
    if (normalizedPath !== filePath) {
      return new Response("Forbidden", { status: 403 });
    }

    try {
      // @ts-expect-error - Deno API
      const stats = await Deno.stat(filePath);

      // If directory, try index.html
      if (stats.isDirectory) {
        filePath = `${filePath}/index.html`;
      }

      // @ts-expect-error - Deno API
      const content = await Deno.readFile(filePath);
      const ext = filePath.substring(filePath.lastIndexOf("."));
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
        // @ts-expect-error - Deno API
        const content = await Deno.readFile(`${this.basePath}/index.html`);
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
 * Create runtime environment for Deno
 */
export async function createDenoRuntime(config: {
  databasePath?: string;
  storagePath?: string;
  assetsPath?: string;
  envVars: {
    APP_URL: string;
    AUTH_PASSWORD_HASH?: string;
    GOOGLE_CLIENT_ID?: string;
    GOOGLE_CLIENT_SECRET?: string;
    X_CLIENT_ID?: string;
    X_CLIENT_SECRET?: string;
    TAKOS_URL?: string;
    TAKOS_CLIENT_ID?: string;
    TAKOS_CLIENT_SECRET?: string;
    AUTH_MODE?: string;
  };
}): Promise<RuntimeEnv> {
  return {
    db: await DenoDatabase.create(config.databasePath || ":memory:"),
    storage: config.storagePath
      ? await DenoStorage.create(config.storagePath)
      : undefined,
    kv: new MemoryKV(),
    assets: config.assetsPath
      ? DenoAssets.create(config.assetsPath)
      : undefined,
    ...config.envVars,
  };
}
