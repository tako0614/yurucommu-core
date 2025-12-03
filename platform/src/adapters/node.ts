/**
 * Node.js Runtime Adapter
 *
 * Provides adapter implementation for Node.js environment.
 * Uses SQLite (better-sqlite3 or sql.js) for database,
 * local filesystem for object storage, and in-memory Map for KV.
 *
 * This adapter enables running takos on traditional Node.js hosting
 * without requiring Cloudflare Workers infrastructure.
 */

import type {
  RuntimeAdapter,
  KVStore,
  ObjectStorage,
  DatabaseAdapter,
  CryptoAdapter,
} from "./index";

export interface NodeAdapterConfig {
  databasePath?: string;
  storagePath?: string;
  kvStorePath?: string;
  env?: Record<string, string | undefined>;
}

// In-memory KV store for development/testing
// For production, use Redis or a file-based implementation
class InMemoryKVStore implements KVStore {
  private store = new Map<string, { value: string; expiration?: number }>();

  async get(key: string): Promise<string | null> {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expiration && entry.expiration < Date.now()) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  async put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void> {
    const expiration = options?.expirationTtl
      ? Date.now() + options.expirationTtl * 1000
      : undefined;
    this.store.set(key, { value, expiration });
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  async list(options?: { prefix?: string; limit?: number; cursor?: string }) {
    const prefix = options?.prefix || "";
    const limit = options?.limit || 1000;
    const cursorIndex = options?.cursor ? parseInt(options.cursor, 10) : 0;

    const keys: { name: string; expiration?: number }[] = [];
    let index = 0;
    const now = Date.now();

    for (const [name, entry] of this.store) {
      if (entry.expiration && entry.expiration < now) {
        this.store.delete(name);
        continue;
      }
      if (!name.startsWith(prefix)) continue;
      if (index < cursorIndex) {
        index++;
        continue;
      }
      if (keys.length >= limit) {
        return {
          keys,
          cursor: String(index),
          list_complete: false,
        };
      }
      keys.push({
        name,
        expiration: entry.expiration ? Math.floor(entry.expiration / 1000) : undefined,
      });
      index++;
    }

    return { keys, list_complete: true };
  }
}

// Filesystem-based object storage for Node.js
// Uses dynamic import to avoid bundling Node.js modules in browser/worker builds
class FileSystemStorage implements ObjectStorage {
  private storagePath: string;
  private fsPromises: typeof import("fs/promises") | null = null;
  private pathModule: typeof import("path") | null = null;

  constructor(storagePath: string) {
    this.storagePath = storagePath;
  }

  private async ensureModules() {
    if (!this.fsPromises || !this.pathModule) {
      this.fsPromises = await import("fs/promises");
      this.pathModule = await import("path");
      await this.fsPromises.mkdir(this.storagePath, { recursive: true });
    }
  }

  private resolvePath(key: string): string {
    if (!this.pathModule) throw new Error("Path module not loaded");
    return this.pathModule.join(this.storagePath, key);
  }

  async get(key: string) {
    await this.ensureModules();
    const fs = this.fsPromises!;
    const filePath = this.resolvePath(key);
    const metaPath = `${filePath}.meta.json`;

    try {
      const [data, metaRaw] = await Promise.all([
        fs.readFile(filePath),
        fs.readFile(metaPath, "utf-8").catch(() => "{}"),
      ]);

      const meta = JSON.parse(metaRaw);
      const stats = await fs.stat(filePath);

      // Convert Buffer to ReadableStream
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(data));
          controller.close();
        },
      });

      return {
        body: stream,
        httpMetadata: meta.httpMetadata,
        httpEtag: meta.httpEtag,
        size: stats.size,
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }
      throw error;
    }
  }

  async put(
    key: string,
    body: ReadableStream | ArrayBuffer | string | Blob,
    options?: { httpMetadata?: { contentType?: string; cacheControl?: string } }
  ): Promise<void> {
    await this.ensureModules();
    const fs = this.fsPromises!;
    const path = this.pathModule!;
    const filePath = this.resolvePath(key);
    const metaPath = `${filePath}.meta.json`;

    // Ensure directory exists
    await fs.mkdir(path.dirname(filePath), { recursive: true });

    // Convert body to Buffer
    let buffer: Buffer;
    if (typeof body === "string") {
      buffer = Buffer.from(body, "utf-8");
    } else if (body instanceof ArrayBuffer) {
      buffer = Buffer.from(body);
    } else if (body instanceof Blob) {
      const arrayBuffer = await body.arrayBuffer();
      buffer = Buffer.from(arrayBuffer);
    } else {
      // ReadableStream
      const chunks: Uint8Array[] = [];
      const reader = body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) chunks.push(value);
      }
      buffer = Buffer.concat(chunks);
    }

    // Write file and metadata
    const meta = {
      httpMetadata: options?.httpMetadata,
      httpEtag: `"${Date.now().toString(36)}"`,
    };

    await Promise.all([
      fs.writeFile(filePath, buffer),
      fs.writeFile(metaPath, JSON.stringify(meta)),
    ]);
  }

  async delete(key: string): Promise<void> {
    await this.ensureModules();
    const fs = this.fsPromises!;
    const filePath = this.resolvePath(key);
    const metaPath = `${filePath}.meta.json`;

    await Promise.all([
      fs.unlink(filePath).catch(() => {}),
      fs.unlink(metaPath).catch(() => {}),
    ]);
  }

  async list(options?: { prefix?: string; delimiter?: string; cursor?: string }) {
    await this.ensureModules();
    const fs = this.fsPromises!;
    const path = this.pathModule!;
    const prefix = options?.prefix || "";
    const delimiter = options?.delimiter;

    const objects: {
      key: string;
      size: number;
      uploaded: Date;
      httpEtag?: string;
      httpMetadata?: { contentType?: string; cacheControl?: string };
    }[] = [];
    const delimitedPrefixes = new Set<string>();

    const walkDir = async (dir: string, baseKey: string = "") => {
      try {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.name.endsWith(".meta.json")) continue;

          const key = baseKey ? `${baseKey}/${entry.name}` : entry.name;

          if (!key.startsWith(prefix)) continue;

          if (entry.isDirectory()) {
            if (delimiter) {
              const prefixAfter = key.slice(prefix.length);
              const delimIndex = prefixAfter.indexOf(delimiter);
              if (delimIndex >= 0) {
                delimitedPrefixes.add(prefix + prefixAfter.slice(0, delimIndex + 1));
                continue;
              }
            }
            await walkDir(path.join(dir, entry.name), key);
          } else {
            const filePath = path.join(dir, entry.name);
            const metaPath = `${filePath}.meta.json`;
            const [stats, metaRaw] = await Promise.all([
              fs.stat(filePath),
              fs.readFile(metaPath, "utf-8").catch(() => "{}"),
            ]);
            const meta = JSON.parse(metaRaw);
            objects.push({
              key,
              size: stats.size,
              uploaded: stats.mtime,
              httpEtag: meta.httpEtag,
              httpMetadata: meta.httpMetadata,
            });
          }
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          throw error;
        }
      }
    };

    await walkDir(this.storagePath);

    return {
      objects,
      delimitedPrefixes: delimiter ? Array.from(delimitedPrefixes) : undefined,
      truncated: false,
    };
  }
}

// SQLite database adapter using better-sqlite3 or sql.js
class SQLiteDatabase implements DatabaseAdapter {
  private databasePath: string;
  private db: any = null;
  private useSqlJs = false;

  constructor(databasePath: string) {
    this.databasePath = databasePath;
  }

  private async ensureDb() {
    if (this.db) return;

    // Try better-sqlite3 first (faster, but requires native compilation)
    try {
      const Database = (await import("better-sqlite3")).default;
      this.db = new Database(this.databasePath);
      this.useSqlJs = false;
      return;
    } catch {
      // Fall back to sql.js (pure JS, works everywhere)
    }

    try {
      const initSqlJs = (await import("sql.js")).default;
      const SQL = await initSqlJs();
      const fs = await import("fs/promises");

      try {
        const buffer = await fs.readFile(this.databasePath);
        this.db = new SQL.Database(buffer);
      } catch {
        this.db = new SQL.Database();
      }
      this.useSqlJs = true;
    } catch (error) {
      throw new Error(
        `Failed to initialize SQLite database: ${error}. ` +
        "Install either 'better-sqlite3' or 'sql.js' package."
      );
    }
  }

  private async saveIfSqlJs() {
    if (this.useSqlJs && this.db) {
      const fs = await import("fs/promises");
      const path = await import("path");
      await fs.mkdir(path.dirname(this.databasePath), { recursive: true });
      const data = this.db.export();
      await fs.writeFile(this.databasePath, Buffer.from(data));
    }
  }

  async execute(sql: string, params?: unknown[]) {
    await this.ensureDb();

    if (this.useSqlJs) {
      const stmt = this.db.prepare(sql);
      if (params) stmt.bind(params);
      const results: unknown[] = [];
      while (stmt.step()) {
        results.push(stmt.getAsObject());
      }
      stmt.free();
      await this.saveIfSqlJs();
      return {
        results,
        meta: { changes: this.db.getRowsModified() },
      };
    }

    // better-sqlite3
    const stmt = this.db.prepare(sql);
    if (sql.trim().toUpperCase().startsWith("SELECT")) {
      const results = params ? stmt.all(...params) : stmt.all();
      return { results, meta: {} };
    }
    const info = params ? stmt.run(...params) : stmt.run();
    return {
      results: [],
      meta: {
        changes: info.changes,
        last_row_id: info.lastInsertRowid ? Number(info.lastInsertRowid) : undefined,
      },
    };
  }

  async batch(statements: { sql: string; params?: unknown[] }[]) {
    await this.ensureDb();

    const results: { results: unknown[]; meta?: { changes?: number } }[] = [];

    if (this.useSqlJs) {
      this.db.exec("BEGIN TRANSACTION");
      try {
        for (const { sql, params } of statements) {
          const result = await this.execute(sql, params);
          results.push(result);
        }
        this.db.exec("COMMIT");
      } catch (error) {
        this.db.exec("ROLLBACK");
        throw error;
      }
      await this.saveIfSqlJs();
      return results;
    }

    // better-sqlite3
    const transaction = this.db.transaction(() => {
      for (const { sql, params } of statements) {
        const stmt = this.db.prepare(sql);
        if (sql.trim().toUpperCase().startsWith("SELECT")) {
          results.push({
            results: params ? stmt.all(...params) : stmt.all(),
            meta: {},
          });
        } else {
          const info = params ? stmt.run(...params) : stmt.run();
          results.push({
            results: [],
            meta: { changes: info.changes },
          });
        }
      }
    });
    transaction();
    return results;
  }
}

// Node.js crypto adapter using Web Crypto API (available in Node 15+)
class NodeCrypto implements CryptoAdapter {
  private cryptoModule: typeof globalThis.crypto | null = null;

  private async ensureCrypto() {
    if (this.cryptoModule) return;
    // Node.js 15+ has globalThis.crypto
    if (typeof globalThis.crypto !== "undefined") {
      this.cryptoModule = globalThis.crypto;
      return;
    }
    // For older Node.js, use the crypto module
    const { webcrypto } = await import("crypto");
    this.cryptoModule = webcrypto as unknown as typeof globalThis.crypto;
  }

  get subtle(): SubtleCrypto {
    if (!this.cryptoModule) {
      throw new Error("Crypto not initialized. Call initialize() first.");
    }
    return this.cryptoModule.subtle;
  }

  randomUUID(): string {
    if (!this.cryptoModule) {
      throw new Error("Crypto not initialized. Call initialize() first.");
    }
    return this.cryptoModule.randomUUID();
  }

  getRandomValues<T extends ArrayBufferView | null>(array: T): T {
    if (!this.cryptoModule) {
      throw new Error("Crypto not initialized. Call initialize() first.");
    }
    return this.cryptoModule.getRandomValues(array);
  }

  async initialize() {
    await this.ensureCrypto();
  }
}

export class NodeAdapter implements RuntimeAdapter {
  readonly name = "node";
  readonly version = "1.0.0";

  readonly kv: KVStore;
  readonly storage: ObjectStorage;
  readonly database: DatabaseAdapter;
  readonly crypto: CryptoAdapter;

  private envVars: Record<string, string | undefined>;

  constructor(config: NodeAdapterConfig = {}) {
    const storagePath = config.storagePath || "./data/storage";
    const databasePath = config.databasePath || "./data/takos.db";

    this.envVars = config.env || process.env as Record<string, string | undefined>;
    this.kv = new InMemoryKVStore();
    this.storage = new FileSystemStorage(storagePath);
    this.database = new SQLiteDatabase(databasePath);
    this.crypto = new NodeCrypto();
  }

  async initialize(): Promise<void> {
    await (this.crypto as NodeCrypto).initialize();
  }

  getEnv(key: string): string | undefined {
    return this.envVars[key];
  }

  isProduction(): boolean {
    const nodeEnv = this.getEnv("NODE_ENV") || "development";
    const context = this.getEnv("TAKOS_CONTEXT") || this.getEnv("APP_ENV") || nodeEnv;
    return !["dev", "development", "local", "test"].includes(context.toLowerCase());
  }
}

export function createNodeAdapter(config?: NodeAdapterConfig): RuntimeAdapter {
  return new NodeAdapter(config);
}
