/**
 * Cloudflare Compatibility Layer
 *
 * These classes implement the same interface as Cloudflare D1/R2/KV
 * so existing code can work without changes on Node.js, Bun, Deno.
 */

// Dynamic imports
import type BetterSqlite3 from 'better-sqlite3';
type DatabaseConstructor = typeof BetterSqlite3;
let Database: DatabaseConstructor | null = null;
let fs: typeof import('fs/promises') | null = null;
let path: typeof import('path') | null = null;

async function loadNodeModules() {
  if (!Database) {
    // Dynamic import with esModuleInterop
    const sqlite = await import('better-sqlite3');
    Database = (sqlite as unknown as { default: DatabaseConstructor }).default ?? sqlite as unknown as DatabaseConstructor;
  }
  if (!fs) {
    fs = await import('fs/promises');
  }
  if (!path) {
    path = await import('path');
  }
}

/**
 * D1Database-compatible SQLite implementation
 */
export class D1CompatDatabase {
  private db: import('better-sqlite3').Database;

  constructor(db: import('better-sqlite3').Database) {
    this.db = db;
  }

  static async create(filename: string = ':memory:'): Promise<D1CompatDatabase> {
    await loadNodeModules();
    const db = new Database!(filename);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
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
    const transaction = this.db.transaction(() => {
      for (const stmt of statements) {
        try {
          const result = stmt.runSync();
          results.push({
            results: [],
            success: true,
            meta: { changes: result.changes, last_row_id: Number(result.lastInsertRowid) },
          });
        } catch (e) {
          results.push({
            results: [],
            success: false,
            meta: { error: String(e) },
          });
        }
      }
    });
    transaction();
    return results;
  }

  // For direct access if needed
  getRawDatabase(): import('better-sqlite3').Database {
    return this.db;
  }
}

/**
 * D1PreparedStatement-compatible implementation
 */
export class D1CompatPreparedStatement {
  private db: import('better-sqlite3').Database;
  private query: string;
  private boundValues: unknown[] = [];

  constructor(db: import('better-sqlite3').Database, query: string) {
    this.db = db;
    this.query = query;
  }

  bind(...values: unknown[]): D1CompatPreparedStatement {
    this.boundValues = values;
    return this;
  }

  async first<T = unknown>(colName?: string): Promise<T | null> {
    const stmt = this.db.prepare(this.query);
    const row = stmt.get(...this.boundValues) as Record<string, unknown> | undefined;
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
        last_row_id: Number(result.lastInsertRowid),
      },
    };
  }

  runSync(): import('better-sqlite3').RunResult {
    const stmt = this.db.prepare(this.query);
    return stmt.run(...this.boundValues);
  }
}

/**
 * R2Bucket-compatible filesystem implementation
 */
export class R2CompatBucket {
  private basePath: string;

  constructor(basePath: string) {
    this.basePath = basePath;
  }

  static async create(basePath: string): Promise<R2CompatBucket> {
    await loadNodeModules();
    await fs!.mkdir(basePath, { recursive: true });
    return new R2CompatBucket(basePath);
  }

  private getFilePath(key: string): string {
    return path!.join(this.basePath, key);
  }

  private getMetaPath(key: string): string {
    return path!.join(this.basePath, `${key}.meta.json`);
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

    await fs!.mkdir(path!.dirname(filePath), { recursive: true });

    let content: Buffer;
    if (typeof value === 'string') {
      content = Buffer.from(value, 'utf-8');
    } else if (value instanceof ArrayBuffer) {
      content = Buffer.from(value);
    } else if (ArrayBuffer.isView(value)) {
      content = Buffer.from(value.buffer, value.byteOffset, value.byteLength);
    } else if (value instanceof Blob) {
      content = Buffer.from(await value.arrayBuffer());
    } else {
      // ReadableStream
      const chunks: Uint8Array[] = [];
      const reader = value.getReader();
      while (true) {
        const { done, value: chunk } = await reader.read();
        if (done) break;
        chunks.push(chunk);
      }
      content = Buffer.concat(chunks);
    }

    await fs!.writeFile(filePath, content);

    if (options?.httpMetadata || options?.customMetadata) {
      await fs!.writeFile(
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
      const content = await fs!.readFile(filePath);
      let metadata: {
        httpMetadata?: { contentType?: string };
        customMetadata?: Record<string, string>;
        size?: number;
        uploaded?: string;
      } = {};

      try {
        const metaContent = await fs!.readFile(metaPath, 'utf-8');
        metadata = JSON.parse(metaContent);
      } catch {
        // No metadata file
      }

      return new R2CompatObject(key, content, metadata);
    } catch {
      return null;
    }
  }

  async delete(key: string | string[]): Promise<void> {
    const keys = Array.isArray(key) ? key : [key];
    for (const k of keys) {
      try {
        await fs!.unlink(this.getFilePath(k));
      } catch { /* ignore */ }
      try {
        await fs!.unlink(this.getMetaPath(k));
      } catch { /* ignore */ }
    }
  }

  async head(key: string): Promise<R2CompatObjectHead | null> {
    const filePath = this.getFilePath(key);
    const metaPath = this.getMetaPath(key);

    try {
      const stats = await fs!.stat(filePath);
      let metadata: {
        httpMetadata?: { contentType?: string };
        customMetadata?: Record<string, string>;
      } = {};

      try {
        const metaContent = await fs!.readFile(metaPath, 'utf-8');
        metadata = JSON.parse(metaContent);
      } catch { /* ignore */ }

      return {
        key,
        size: stats.size,
        uploaded: stats.mtime,
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
    const objects: Array<{ key: string; size: number; uploaded: Date }> = [];

    const readDir = async (dir: string, prefix: string = '') => {
      try {
        const entries = await fs!.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path!.join(dir, entry.name);
          const key = prefix ? `${prefix}/${entry.name}` : entry.name;

          if (entry.isDirectory()) {
            await readDir(fullPath, key);
          } else if (!entry.name.endsWith('.meta.json')) {
            if (!options?.prefix || key.startsWith(options.prefix)) {
              const stats = await fs!.stat(fullPath);
              objects.push({ key, size: stats.size, uploaded: stats.mtime });
            }
          }
        }
      } catch { /* ignore */ }
    };

    await readDir(this.basePath);

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
  private content: Buffer;
  httpMetadata?: { contentType?: string };
  customMetadata?: Record<string, string>;
  size: number;
  uploaded: Date;
  body: ReadableStream<Uint8Array>;
  bodyUsed = false;

  constructor(
    key: string,
    content: Buffer,
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
        controller.enqueue(new Uint8Array(content));
        controller.close();
      },
    });
  }

  async arrayBuffer(): Promise<ArrayBuffer> {
    this.bodyUsed = true;
    return this.content.buffer.slice(
      this.content.byteOffset,
      this.content.byteOffset + this.content.byteLength
    ) as ArrayBuffer;
  }

  async text(): Promise<string> {
    this.bodyUsed = true;
    return this.content.toString('utf-8');
  }

  async json<T>(): Promise<T> {
    this.bodyUsed = true;
    return JSON.parse(this.content.toString('utf-8'));
  }
}

/**
 * R2ObjectHead-compatible implementation
 */
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
      // ReadableStream
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
 * Fetcher-compatible static assets implementation
 */
export class AssetsCompatFetcher {
  private basePath: string;

  constructor(basePath: string) {
    this.basePath = basePath;
  }

  static async create(basePath: string): Promise<AssetsCompatFetcher> {
    await loadNodeModules();
    return new AssetsCompatFetcher(basePath);
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    let filePath = path!.join(this.basePath, url.pathname);

    // Security: prevent directory traversal
    const resolvedPath = path!.resolve(filePath);
    if (!resolvedPath.startsWith(path!.resolve(this.basePath))) {
      return new Response('Forbidden', { status: 403 });
    }

    try {
      const stats = await fs!.stat(filePath);
      if (stats.isDirectory()) {
        filePath = path!.join(filePath, 'index.html');
      }

      const content = await fs!.readFile(filePath);
      const ext = path!.extname(filePath).toLowerCase();
      const contentType = getMimeType(ext);

      return new Response(content, {
        headers: {
          'Content-Type': contentType,
          'Content-Length': String(content.length),
        },
      });
    } catch {
      // SPA fallback
      try {
        const indexPath = path!.join(this.basePath, 'index.html');
        const content = await fs!.readFile(indexPath);
        return new Response(content, {
          headers: { 'Content-Type': 'text/html' },
        });
      } catch {
        return new Response('Not Found', { status: 404 });
      }
    }
  }
}

function getMimeType(ext: string): string {
  const mimeTypes: Record<string, string> = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.mjs': 'application/javascript',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.webp': 'image/webp',
    '.ico': 'image/x-icon',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
  };
  return mimeTypes[ext] || 'application/octet-stream';
}

/**
 * Create Cloudflare-compatible environment from Node.js
 */
export async function createNodeEnv(config: {
  databasePath?: string;
  storagePath?: string;
  assetsPath?: string;
  APP_URL: string;
  AUTH_PASSWORD_HASH?: string;
  AUTH_PASSWORD?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  X_CLIENT_ID?: string;
  X_CLIENT_SECRET?: string;
  TAKOS_URL?: string;
  TAKOS_CLIENT_ID?: string;
  TAKOS_CLIENT_SECRET?: string;
}) {
  const db = await D1CompatDatabase.create(config.databasePath || './data/yurucommu.db');
  const storage = config.storagePath ? await R2CompatBucket.create(config.storagePath) : undefined;
  const kv = new KVCompatNamespace();
  const assets = config.assetsPath ? await AssetsCompatFetcher.create(config.assetsPath) : undefined;

  // Create Prisma client with libsql adapter for Node.js
  const { getPrismaSQLite } = await import('../lib/db');
  const prisma = await getPrismaSQLite(config.databasePath || './data/yurucommu.db');

  return {
    DB: db as unknown as D1Database,
    MEDIA: storage as unknown as R2Bucket,
    KV: kv as unknown as KVNamespace,
    ASSETS: assets as unknown as Fetcher,
    PRISMA: prisma,
    APP_URL: config.APP_URL,
    AUTH_PASSWORD_HASH: config.AUTH_PASSWORD_HASH,
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
  await loadNodeModules();

  const entries = await fs!.readdir(migrationsDir, { withFileTypes: true });
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
    const sql = await fs!.readFile(path!.join(migrationsDir, file), 'utf-8');

    // Split by semicolons and execute each statement
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
