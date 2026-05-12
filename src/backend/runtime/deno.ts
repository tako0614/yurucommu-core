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
  assertPathChainWithinBasePath,
  DEFAULT_LIST_LIMIT,
  getMimeType,
  isPathWithinBasePath,
  META_SUFFIX,
  readStream,
  resolvePathWithinBasePath,
} from "./shared.ts";
import path from "node:path";

type DenoSQLiteRunResult = {
  changes: number;
  lastInsertRowid: number;
};

interface DenoSQLiteStatement {
  get(...values: unknown[]): unknown;
  all(...values: unknown[]): unknown[];
  run(...values: unknown[]): void;
  finalize(): void;
}

interface DenoSQLiteDatabase {
  exec(query: string): void;
  prepare(query: string): DenoSQLiteStatement;
  transaction(callback: () => void): () => void;
  readonly changes: number;
  readonly lastInsertRowId: number;
}

type DenoSQLiteDatabaseConstructor = {
  new (filename: string): DenoSQLiteDatabase;
};

type DenoSQLiteModule = {
  Database: DenoSQLiteDatabaseConstructor;
};

function asDenoSQLiteDatabase(db: unknown): DenoSQLiteDatabase {
  return db as DenoSQLiteDatabase;
}

function asDenoSQLiteModule(module: unknown): DenoSQLiteModule {
  if (typeof module !== "object" || module === null) {
    throw new Error("deno sqlite3 module must be an object");
  }
  const candidate = (module as { Database?: unknown }).Database;
  if (typeof candidate !== "function") {
    throw new Error(
      "deno sqlite3 module must export a `Database` constructor",
    );
  }
  return { Database: candidate as DenoSQLiteDatabaseConstructor };
}

/**
 * Deno SQLite Database Adapter
 * Uses Deno's built-in SQLite via FFI or x/sqlite3
 */
export class DenoDatabase implements IDatabase {
  private db: DenoSQLiteDatabase;

  constructor(db: unknown) {
    this.db = asDenoSQLiteDatabase(db);
  }

  static async create(filename: string = ":memory:"): Promise<DenoDatabase> {
    const sqliteModule = asDenoSQLiteModule(
      await import("https://deno.land/x/sqlite3@0.12.0/mod.ts"),
    );
    const db = new sqliteModule.Database(filename);
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA foreign_keys = ON");
    return new DenoDatabase(db);
  }

  prepare(query: string): PreparedStatement {
    return new DenoPreparedStatement(this.db, query);
  }

  async exec(query: string): Promise<void> {
    this.db.exec(query);
  }

  async batch<T = unknown>(
    statements: PreparedStatement[],
  ): Promise<QueryResult<T>[]> {
    const results: QueryResult<T>[] = [];
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
  private db: DenoSQLiteDatabase;
  private query: string;
  private boundValues: unknown[] = [];

  constructor(db: unknown, query: string) {
    this.db = asDenoSQLiteDatabase(db);
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
    stmt.finalize();
    if (!row) return null;
    if (colName) return row[colName] as T;
    return row as T;
  }

  async all<T = unknown>(): Promise<QueryResult<T>> {
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

  runSync(): DenoSQLiteRunResult {
    const stmt = this.db.prepare(this.query);
    stmt.run(...this.boundValues);
    const changes = this.db.changes;
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
  private realBasePath: string | null = null;

  constructor(basePath: string) {
    this.basePath = basePath;
  }

  static async create(basePath: string): Promise<DenoStorage> {
    await Deno.mkdir(basePath, { recursive: true });
    return new DenoStorage(basePath);
  }

  private getFilePath(key: string): string {
    return resolvePathWithinBasePath(this.getResolvedBasePath(), key);
  }

  private getMetaPath(key: string): string {
    return resolvePathWithinBasePath(
      this.getResolvedBasePath(),
      `${key}${META_SUFFIX}`,
    );
  }

  private getResolvedBasePath(): string {
    return path.resolve(this.basePath);
  }

  private async getRealBasePath(): Promise<string> {
    if (this.realBasePath) return this.realBasePath;
    try {
      this.realBasePath = await Deno.realPath(this.getResolvedBasePath());
    } catch {
      this.realBasePath = this.getResolvedBasePath();
    }
    return this.realBasePath;
  }

  private async resolveExistingPath(filePath: string): Promise<string | null> {
    try {
      const realPath = await Deno.realPath(filePath);
      const realBasePath = await this.getRealBasePath();
      if (!isPathWithinBasePath(realBasePath, realPath)) {
        throw new Error("Path escapes base directory");
      }
      return realPath;
    } catch {
      return null;
    }
  }

  /** Read and parse the .meta.json sidecar, returning empty object on failure. */
  private async loadMeta(key: string): Promise<StorageMeta> {
    try {
      const metaPath = await this.resolveExistingPath(this.getMetaPath(key));
      if (!metaPath) return {};
      const raw = await Deno.readTextFile(metaPath);
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
    const dir = path.dirname(filePath);
    await assertPathChainWithinBasePath(
      await this.getRealBasePath(),
      filePath,
      async (p) => {
        return await Deno.realPath(p);
      },
    );
    await Deno.mkdir(dir, { recursive: true });

    const realBasePath = await this.getRealBasePath();
    let realFilePath: string | null = null;
    try {
      realFilePath = await Deno.realPath(filePath);
    } catch {
      realFilePath = null;
    }
    if (realFilePath) {
      if (!isPathWithinBasePath(realBasePath, realFilePath)) {
        throw new Error("Path escapes base directory");
      }
    } else {
      const realDirPath = await Deno.realPath(dir);
      if (!isPathWithinBasePath(realBasePath, realDirPath)) {
        throw new Error("Path escapes base directory");
      }
    }

    let content: Uint8Array;
    if (typeof value === "string") {
      content = new TextEncoder().encode(value);
    } else if (value instanceof ArrayBuffer) {
      content = new Uint8Array(value);
    } else {
      content = await readStream(value);
    }

    await Deno.writeFile(filePath, content);

    if (options?.httpMetadata || options?.customMetadata) {
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
      const filePath = await this.resolveExistingPath(this.getFilePath(key));
      if (!filePath) return null;
      const content = await Deno.readFile(filePath);
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
      for (
        const getPath of [
          () => this.getFilePath(k),
          () => this.getMetaPath(k),
        ]
      ) {
        try {
          const filePath = await this.resolveExistingPath(getPath());
          if (!filePath) continue;
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
    const realBasePath = await this.getRealBasePath();

    const readDirRecursive = async (dir: string, prefix: string = "") => {
      try {
        for await (const entry of Deno.readDir(dir)) {
          const fullPath = `${dir}/${entry.name}`;
          const realFullPath = await Deno.realPath(fullPath);
          if (!isPathWithinBasePath(realBasePath, realFullPath)) continue;
          const key = prefix ? `${prefix}/${entry.name}` : entry.name;

          if (entry.isDirectory) {
            await readDirRecursive(fullPath, key);
          } else if (!entry.name.endsWith(META_SUFFIX)) {
            if (!options?.prefix || key.startsWith(options.prefix)) {
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

    await readDirRecursive(realBasePath);

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
      const filePath = await this.resolveExistingPath(this.getFilePath(key));
      if (!filePath) return null;
      const stats = await Deno.stat(filePath);
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
  private realBasePath: string | null = null;

  constructor(basePath: string) {
    this.basePath = basePath;
  }

  static create(basePath: string): DenoAssets {
    return new DenoAssets(basePath);
  }

  private getResolvedBasePath(): string {
    return path.resolve(this.basePath);
  }

  private async getRealBasePath(): Promise<string> {
    if (this.realBasePath) return this.realBasePath;
    try {
      this.realBasePath = await Deno.realPath(this.getResolvedBasePath());
    } catch {
      this.realBasePath = this.getResolvedBasePath();
    }
    return this.realBasePath;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    let filePath: string;
    try {
      filePath = resolvePathWithinBasePath(
        this.getResolvedBasePath(),
        `.${url.pathname}`,
      );
    } catch {
      return new Response("Forbidden", { status: 403 });
    }

    const realBasePath = await this.getRealBasePath();

    try {
      const realFilePath = await Deno.realPath(filePath);
      if (!isPathWithinBasePath(realBasePath, realFilePath)) {
        return new Response("Forbidden", { status: 403 });
      }

      const stats = await Deno.stat(realFilePath);

      // If directory, try index.html
      if (stats.isDirectory) {
        const indexPath = path.join(realFilePath, "index.html");
        const realIndexPath = await Deno.realPath(indexPath);
        if (!isPathWithinBasePath(realBasePath, realIndexPath)) {
          return new Response("Forbidden", { status: 403 });
        }
        filePath = realIndexPath;
      } else {
        filePath = realFilePath;
      }

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
        const indexPath = path.join(this.getResolvedBasePath(), "index.html");
        const realIndexPath = await Deno.realPath(indexPath);
        if (!isPathWithinBasePath(realBasePath, realIndexPath)) {
          return new Response("Forbidden", { status: 403 });
        }
        const content = await Deno.readFile(realIndexPath);
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
    OIDC_ISSUER_URL?: string;
    OIDC_CLIENT_ID?: string;
    OIDC_CLIENT_SECRET?: string;
    OAUTH_ISSUER_URL?: string;
    TAKOSUMI_ACCOUNTS_ISSUER_URL?: string;
    TAKOSUMI_ACCOUNTS_CLIENT_ID?: string;
    TAKOSUMI_ACCOUNTS_CLIENT_SECRET?: string;
    CLIENT_ID?: string;
    CLIENT_SECRET?: string;
    TAKOS_URL?: string;
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
