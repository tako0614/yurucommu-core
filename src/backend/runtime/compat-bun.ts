// @ts-nocheck - This file is Bun-specific and should be type-checked by Bun's TypeScript
/**
 * Bun Cloudflare Compatibility Layer
 *
 * These classes implement the same interface as Cloudflare D1/R2/KV
 * so existing code can work without changes on Bun.
 */

/**
 * D1Database-compatible SQLite implementation for Bun
 */
export class D1CompatDatabase {
  private db: import('bun:sqlite').Database;

  constructor(db: import('bun:sqlite').Database) {
    this.db = db;
  }

  static create(filename: string = ':memory:'): D1CompatDatabase {
    // @ts-expect-error - Bun runtime
    const { Database } = require('bun:sqlite');
    const db = new Database(filename);
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA foreign_keys = ON');
    return new D1CompatDatabase(db);
  }

  prepare(query: string): D1CompatPreparedStatement {
    return new D1CompatPreparedStatement(this.db, query);
  }

  async exec(query: string): Promise<void> {
    this.db.exec(query);
  }

  async batch<T = unknown>(statements: D1CompatPreparedStatement[]): Promise<Array<{ results: T[]; success: boolean; meta: object }>> {
    const results: Array<{ results: T[]; success: boolean; meta: object }> = [];
    this.db.transaction(() => {
      for (const stmt of statements) {
        try {
          const result = stmt.runSync();
          results.push({
            results: [],
            success: true,
            meta: { changes: result.changes, last_row_id: result.lastInsertRowid },
          });
        } catch (e) {
          results.push({
            results: [],
            success: false,
            meta: { error: String(e) },
          });
        }
      }
    })();
    return results;
  }

  getRawDatabase(): import('bun:sqlite').Database {
    return this.db;
  }
}

/**
 * D1PreparedStatement-compatible implementation for Bun
 */
export class D1CompatPreparedStatement {
  private db: import('bun:sqlite').Database;
  private query: string;
  private boundValues: unknown[] = [];

  constructor(db: import('bun:sqlite').Database, query: string) {
    this.db = db;
    this.query = query;
  }

  bind(...values: unknown[]): D1CompatPreparedStatement {
    this.boundValues = values;
    return this;
  }

  async first<T = unknown>(colName?: string): Promise<T | null> {
    const stmt = this.db.prepare(this.query);
    const row = stmt.get(...this.boundValues) as Record<string, unknown> | null;
    if (!row) return null;
    if (colName) return row[colName] as T;
    return row as T;
  }

  async all<T = unknown>(): Promise<{ results: T[]; success: boolean; meta: object }> {
    const stmt = this.db.prepare(this.query);
    const rows = stmt.all(...this.boundValues) as T[];
    return {
      results: rows,
      success: true,
      meta: {},
    };
  }

  async run(): Promise<{ success: boolean; meta: { changes: number; last_row_id: number } }> {
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
    const stmt = this.db.prepare(this.query);
    return stmt.run(...this.boundValues) as { changes: number; lastInsertRowid: number };
  }
}

/**
 * R2Bucket-compatible filesystem implementation for Bun
 */
export class R2CompatBucket {
  private basePath: string;

  constructor(basePath: string) {
    this.basePath = basePath;
  }

  static async create(basePath: string): Promise<R2CompatBucket> {
    const { mkdir } = await import('fs/promises');
    await mkdir(basePath, { recursive: true });
    return new R2CompatBucket(basePath);
  }

  private getFilePath(key: string): string {
    return `${this.basePath}/${key}`;
  }

  private getMetaPath(key: string): string {
    return `${this.basePath}/${key}.meta.json`;
  }

  async put(
    key: string,
    value: ReadableStream | ArrayBuffer | ArrayBufferView | string | Blob,
    options?: {
      httpMetadata?: { contentType?: string };
      customMetadata?: Record<string, string>;
    }
  ): Promise<{ key: string }> {
    const filePath = this.getFilePath(key);
    const metaPath = this.getMetaPath(key);

    // Ensure directory exists
    const dir = filePath.substring(0, filePath.lastIndexOf('/'));
    const { mkdir } = await import('fs/promises');
    await mkdir(dir, { recursive: true });

    let content: Uint8Array;
    if (typeof value === 'string') {
      content = new TextEncoder().encode(value);
    } else if (value instanceof ArrayBuffer) {
      content = new Uint8Array(value);
    } else if (ArrayBuffer.isView(value)) {
      content = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    } else if (value instanceof Blob) {
      content = new Uint8Array(await value.arrayBuffer());
    } else {
      // ReadableStream
      const chunks: Uint8Array[] = [];
      const reader = value.getReader();
      while (true) {
        const { done, value: chunk } = await reader.read();
        if (done) break;
        chunks.push(chunk);
      }
      const totalLength = chunks.reduce((acc, c) => acc + c.length, 0);
      content = new Uint8Array(totalLength);
      let offset = 0;
      for (const chunk of chunks) {
        content.set(chunk, offset);
        offset += chunk.length;
      }
    }

    // @ts-expect-error - Bun runtime
    await Bun.write(filePath, content);

    if (options?.httpMetadata || options?.customMetadata) {
      // @ts-expect-error - Bun runtime
      await Bun.write(
        metaPath,
        JSON.stringify({
          httpMetadata: options.httpMetadata,
          customMetadata: options.customMetadata,
          size: content.length,
          uploaded: new Date().toISOString(),
        })
      );
    }

    return { key };
  }

  async get(key: string): Promise<R2CompatObject | null> {
    const filePath = this.getFilePath(key);
    const metaPath = this.getMetaPath(key);

    try {
      // @ts-expect-error - Bun runtime
      const file = Bun.file(filePath);
      if (!(await file.exists())) return null;

      const content = new Uint8Array(await file.arrayBuffer());
      let metadata: {
        httpMetadata?: { contentType?: string };
        customMetadata?: Record<string, string>;
        size?: number;
        uploaded?: string;
      } = {};

      try {
        // @ts-expect-error - Bun runtime
        const metaFile = Bun.file(metaPath);
        if (await metaFile.exists()) {
          metadata = JSON.parse(await metaFile.text());
        }
      } catch {
        // No metadata file
      }

      return new R2CompatObject(key, content, metadata);
    } catch {
      return null;
    }
  }

  async delete(key: string | string[]): Promise<void> {
    const { unlink } = await import('fs/promises');
    const keys = Array.isArray(key) ? key : [key];
    for (const k of keys) {
      try {
        await unlink(this.getFilePath(k));
      } catch { /* ignore */ }
      try {
        await unlink(this.getMetaPath(k));
      } catch { /* ignore */ }
    }
  }

  async head(key: string): Promise<R2CompatObjectHead | null> {
    const filePath = this.getFilePath(key);
    const metaPath = this.getMetaPath(key);

    try {
      // @ts-expect-error - Bun runtime
      const file = Bun.file(filePath);
      if (!(await file.exists())) return null;

      let metadata: {
        httpMetadata?: { contentType?: string };
        customMetadata?: Record<string, string>;
      } = {};

      try {
        // @ts-expect-error - Bun runtime
        const metaFile = Bun.file(metaPath);
        if (await metaFile.exists()) {
          metadata = JSON.parse(await metaFile.text());
        }
      } catch { /* ignore */ }

      return {
        key,
        size: file.size,
        uploaded: new Date(),
        httpMetadata: metadata.httpMetadata,
        customMetadata: metadata.customMetadata,
      };
    } catch {
      return null;
    }
  }

  async list(options?: {
    prefix?: string;
    limit?: number;
    cursor?: string;
    delimiter?: string;
  }): Promise<{
    objects: Array<{ key: string; size: number; uploaded: Date }>;
    truncated: boolean;
    cursor?: string;
    delimitedPrefixes?: string[];
  }> {
    const { readdir, stat } = await import('fs/promises');
    const objects: Array<{ key: string; size: number; uploaded: Date }> = [];

    const readDirRecursive = async (dir: string, prefix: string = '') => {
      try {
        const entries = await readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = `${dir}/${entry.name}`;
          const key = prefix ? `${prefix}/${entry.name}` : entry.name;

          if (entry.isDirectory()) {
            await readDirRecursive(fullPath, key);
          } else if (!entry.name.endsWith('.meta.json')) {
            if (!options?.prefix || key.startsWith(options.prefix)) {
              const stats = await stat(fullPath);
              objects.push({ key, size: stats.size, uploaded: stats.mtime });
            }
          }
        }
      } catch { /* ignore */ }
    };

    await readDirRecursive(this.basePath);

    const limit = options?.limit ?? 1000;
    const truncated = objects.length > limit;

    return {
      objects: objects.slice(0, limit),
      truncated,
      cursor: truncated ? String(limit) : undefined,
    };
  }
}

/**
 * R2Object-compatible implementation
 */
class R2CompatObject {
  key: string;
  private content: Uint8Array;
  httpMetadata?: { contentType?: string };
  customMetadata?: Record<string, string>;
  size: number;
  uploaded: Date;
  body: ReadableStream<Uint8Array>;
  bodyUsed = false;

  constructor(
    key: string,
    content: Uint8Array,
    metadata: {
      httpMetadata?: { contentType?: string };
      customMetadata?: Record<string, string>;
      size?: number;
      uploaded?: string;
    }
  ) {
    this.key = key;
    this.content = content;
    this.httpMetadata = metadata.httpMetadata;
    this.customMetadata = metadata.customMetadata;
    this.size = content.length;
    this.uploaded = metadata.uploaded ? new Date(metadata.uploaded) : new Date();
    this.body = new ReadableStream({
      start: (controller) => {
        controller.enqueue(content);
        controller.close();
      },
    });
  }

  async arrayBuffer(): Promise<ArrayBuffer> {
    this.bodyUsed = true;
    return this.content.buffer as ArrayBuffer;
  }

  async text(): Promise<string> {
    this.bodyUsed = true;
    return new TextDecoder().decode(this.content);
  }

  async json<T>(): Promise<T> {
    this.bodyUsed = true;
    return JSON.parse(new TextDecoder().decode(this.content));
  }
}

interface R2CompatObjectHead {
  key: string;
  size: number;
  uploaded: Date;
  httpMetadata?: { contentType?: string };
  customMetadata?: Record<string, string>;
}

/**
 * KVNamespace-compatible in-memory implementation
 */
export class KVCompatNamespace {
  private store = new Map<string, {
    value: string | ArrayBuffer;
    expiration?: number;
    metadata?: unknown;
  }>();

  async get(key: string, options?: { type?: 'text' | 'json' | 'arrayBuffer' | 'stream' }): Promise<unknown> {
    const entry = this.store.get(key);
    if (!entry) return null;

    if (entry.expiration && entry.expiration < Date.now() / 1000) {
      this.store.delete(key);
      return null;
    }

    const type = options?.type ?? 'text';
    const value = entry.value;

    if (type === 'json') {
      return typeof value === 'string' ? JSON.parse(value) : JSON.parse(new TextDecoder().decode(value as ArrayBuffer));
    }
    if (type === 'arrayBuffer') {
      return typeof value === 'string' ? new TextEncoder().encode(value).buffer : value;
    }
    return typeof value === 'string' ? value : new TextDecoder().decode(value as ArrayBuffer);
  }

  async put(
    key: string,
    value: string | ArrayBuffer | ReadableStream,
    options?: {
      expirationTtl?: number;
      expiration?: number;
      metadata?: unknown;
    }
  ): Promise<void> {
    let storedValue: string | ArrayBuffer;

    if (typeof value === 'string') {
      storedValue = value;
    } else if (value instanceof ArrayBuffer) {
      storedValue = value;
    } else {
      const reader = value.getReader();
      const chunks: Uint8Array[] = [];
      while (true) {
        const { done, value: chunk } = await reader.read();
        if (done) break;
        chunks.push(chunk);
      }
      const totalLength = chunks.reduce((acc, c) => acc + c.length, 0);
      const result = new Uint8Array(totalLength);
      let offset = 0;
      for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.length;
      }
      storedValue = result.buffer;
    }

    let expiration: number | undefined;
    if (options?.expiration) {
      expiration = options.expiration;
    } else if (options?.expirationTtl) {
      expiration = Math.floor(Date.now() / 1000) + options.expirationTtl;
    }

    this.store.set(key, {
      value: storedValue,
      expiration,
      metadata: options?.metadata,
    });
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  async list(options?: {
    prefix?: string;
    limit?: number;
    cursor?: string;
  }): Promise<{
    keys: Array<{ name: string; expiration?: number; metadata?: unknown }>;
    list_complete: boolean;
    cursor?: string;
  }> {
    const keys: Array<{ name: string; expiration?: number; metadata?: unknown }> = [];
    const now = Date.now() / 1000;

    for (const [name, entry] of this.store.entries()) {
      if (entry.expiration && entry.expiration < now) continue;
      if (options?.prefix && !name.startsWith(options.prefix)) continue;
      keys.push({ name, expiration: entry.expiration, metadata: entry.metadata });
    }

    const limit = options?.limit ?? 1000;
    return {
      keys: keys.slice(0, limit),
      list_complete: keys.length <= limit,
      cursor: keys.length > limit ? String(limit) : undefined,
    };
  }
}

/**
 * Fetcher-compatible static assets implementation for Bun
 */
export class AssetsCompatFetcher {
  private basePath: string;

  constructor(basePath: string) {
    this.basePath = basePath;
  }

  static create(basePath: string): AssetsCompatFetcher {
    return new AssetsCompatFetcher(basePath);
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    let filePath = `${this.basePath}${url.pathname}`;

    // Security: prevent directory traversal
    const normalizedPath = filePath.replace(/\.\./g, '');
    if (normalizedPath !== filePath) {
      return new Response('Forbidden', { status: 403 });
    }

    try {
      // @ts-expect-error - Bun runtime
      let file = Bun.file(filePath);

      if (!(await file.exists())) {
        filePath = `${filePath}/index.html`;
        // @ts-expect-error - Bun runtime
        file = Bun.file(filePath);
      }

      if (await file.exists()) {
        return new Response(file);
      }

      // SPA fallback
      // @ts-expect-error - Bun runtime
      const indexFile = Bun.file(`${this.basePath}/index.html`);
      if (await indexFile.exists()) {
        return new Response(indexFile, {
          headers: { 'Content-Type': 'text/html' },
        });
      }

      return new Response('Not Found', { status: 404 });
    } catch {
      return new Response('Not Found', { status: 404 });
    }
  }
}

/**
 * Create Cloudflare-compatible environment from Bun
 */
export async function createBunEnv(config: {
  databasePath?: string;
  storagePath?: string;
  assetsPath?: string;
  APP_URL: string;
  AUTH_PASSWORD?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  X_CLIENT_ID?: string;
  X_CLIENT_SECRET?: string;
  TAKOS_URL?: string;
  TAKOS_CLIENT_ID?: string;
  TAKOS_CLIENT_SECRET?: string;
}) {
  const db = D1CompatDatabase.create(config.databasePath || './data/yurucommu.db');
  const storage = config.storagePath ? await R2CompatBucket.create(config.storagePath) : undefined;
  const kv = new KVCompatNamespace();
  const assets = config.assetsPath ? AssetsCompatFetcher.create(config.assetsPath) : undefined;

  return {
    DB: db as unknown as D1Database,
    MEDIA: storage as unknown as R2Bucket,
    KV: kv as unknown as KVNamespace,
    ASSETS: assets as unknown as Fetcher,
    APP_URL: config.APP_URL,
    AUTH_PASSWORD: config.AUTH_PASSWORD,
    GOOGLE_CLIENT_ID: config.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: config.GOOGLE_CLIENT_SECRET,
    X_CLIENT_ID: config.X_CLIENT_ID,
    X_CLIENT_SECRET: config.X_CLIENT_SECRET,
    TAKOS_URL: config.TAKOS_URL,
    TAKOS_CLIENT_ID: config.TAKOS_CLIENT_ID,
    TAKOS_CLIENT_SECRET: config.TAKOS_CLIENT_SECRET,
  };
}

/**
 * Run migrations from SQL files
 */
export async function runMigrations(db: D1CompatDatabase, migrationsDir: string): Promise<void> {
  const { readdir, readFile } = await import('fs/promises');

  const entries = await readdir(migrationsDir, { withFileTypes: true });
  const sqlFiles = entries
    .filter((e) => e.isFile() && e.name.endsWith('.sql'))
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
    .prepare('SELECT name FROM _cf_migrations')
    .all() as Array<{ name: string }>;
  const appliedSet = new Set(applied.map((r) => r.name));

  for (const file of sqlFiles) {
    if (appliedSet.has(file)) {
      console.log(`Migration ${file} already applied, skipping`);
      continue;
    }

    console.log(`Applying migration: ${file}`);
    const sql = await readFile(`${migrationsDir}/${file}`, 'utf-8');

    const statements = sql
      .split(';')
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
      .prepare('INSERT INTO _cf_migrations (name) VALUES (?)')
      .run(file);

    console.log(`Migration ${file} applied successfully`);
  }
}
