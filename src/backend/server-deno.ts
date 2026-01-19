// @ts-nocheck - This file is Deno-specific and should be type-checked by Deno's TypeScript
/**
 * Deno Server Entry Point
 *
 * This file starts the yurucommu backend on Deno.
 *
 * Usage:
 *   deno run --allow-net --allow-read --allow-write --allow-env src/backend/server-deno.ts
 *
 * Environment variables:
 *   PORT             - Server port (default: 3000)
 *   DATABASE_PATH    - SQLite database path (default: ./data/yurucommu.db)
 *   STORAGE_PATH     - File storage path (default: ./data/storage)
 *   ASSETS_PATH      - Static assets path (default: ./dist)
 *   APP_URL          - Application URL (default: http://localhost:3000)
 *   AUTH_PASSWORD    - Optional password authentication
 *   GOOGLE_CLIENT_ID/SECRET - Google OAuth
 *   X_CLIENT_ID/SECRET - X (Twitter) OAuth
 *   TAKOS_URL/CLIENT_ID/SECRET - Takos OAuth
 */

// @ts-expect-error - Deno runtime
const PORT = parseInt(Deno.env.get('PORT') || '3000', 10);
// @ts-expect-error - Deno runtime
const DATABASE_PATH = Deno.env.get('DATABASE_PATH') || './data/yurucommu.db';
// @ts-expect-error - Deno runtime
const STORAGE_PATH = Deno.env.get('STORAGE_PATH') || './data/storage';
// @ts-expect-error - Deno runtime
const ASSETS_PATH = Deno.env.get('ASSETS_PATH') || './dist';
// @ts-expect-error - Deno runtime
const MIGRATIONS_PATH = Deno.env.get('MIGRATIONS_PATH') || './migrations';
// @ts-expect-error - Deno runtime
const APP_URL = Deno.env.get('APP_URL') || `http://localhost:${PORT}`;

/**
 * D1Database-compatible SQLite implementation for Deno
 */
class D1CompatDatabase {
  // @ts-expect-error - Deno SQLite type
  private db: unknown;

  // @ts-expect-error - Deno SQLite type
  constructor(db: unknown) {
    this.db = db;
  }

  static async create(filename: string = ':memory:'): Promise<D1CompatDatabase> {
    // @ts-expect-error - Deno import
    const { Database } = await import('https://deno.land/x/sqlite3@0.12.0/mod.ts');
    const db = new Database(filename);
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA foreign_keys = ON');
    return new D1CompatDatabase(db);
  }

  prepare(query: string): D1CompatPreparedStatement {
    return new D1CompatPreparedStatement(this.db, query);
  }

  async exec(query: string): Promise<void> {
    // @ts-expect-error - Deno SQLite type
    this.db.exec(query);
  }

  async batch<T = unknown>(statements: D1CompatPreparedStatement[]): Promise<Array<{ results: T[]; success: boolean; meta: object }>> {
    const results: Array<{ results: T[]; success: boolean; meta: object }> = [];
    // @ts-expect-error - Deno SQLite type
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

  // @ts-expect-error - Deno SQLite type
  getRawDatabase(): unknown {
    return this.db;
  }
}

/**
 * D1PreparedStatement-compatible implementation for Deno
 */
class D1CompatPreparedStatement {
  // @ts-expect-error - Deno SQLite type
  private db: unknown;
  private query: string;
  private boundValues: unknown[] = [];

  // @ts-expect-error - Deno SQLite type
  constructor(db: unknown, query: string) {
    this.db = db;
    this.query = query;
  }

  bind(...values: unknown[]): D1CompatPreparedStatement {
    this.boundValues = values;
    return this;
  }

  async first<T = unknown>(colName?: string): Promise<T | null> {
    // @ts-expect-error - Deno SQLite type
    const stmt = this.db.prepare(this.query);
    const row = stmt.get(...this.boundValues) as Record<string, unknown> | undefined;
    stmt.finalize();
    if (!row) return null;
    if (colName) return row[colName] as T;
    return row as T;
  }

  async all<T = unknown>(): Promise<{ results: T[]; success: boolean; meta: object }> {
    // @ts-expect-error - Deno SQLite type
    const stmt = this.db.prepare(this.query);
    const rows = stmt.all(...this.boundValues) as T[];
    stmt.finalize();
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

/**
 * KVNamespace-compatible in-memory implementation
 */
class KVCompatNamespace {
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
 * Fetcher-compatible static assets implementation for Deno
 */
class AssetsCompatFetcher {
  private basePath: string;

  constructor(basePath: string) {
    this.basePath = basePath;
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
      // @ts-expect-error - Deno API
      const stat = await Deno.stat(filePath);
      if (stat.isDirectory) {
        filePath = `${filePath}/index.html`;
      }

      // @ts-expect-error - Deno API
      const content = await Deno.readFile(filePath);
      const ext = filePath.substring(filePath.lastIndexOf('.'));
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
        // @ts-expect-error - Deno API
        const content = await Deno.readFile(`${this.basePath}/index.html`);
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
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.webp': 'image/webp',
    '.ico': 'image/x-icon',
  };
  return mimeTypes[ext] || 'application/octet-stream';
}

/**
 * Create Cloudflare-compatible environment from Deno
 */
async function createDenoEnv(config: {
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
  const db = await D1CompatDatabase.create(config.databasePath || './data/yurucommu.db');
  const kv = new KVCompatNamespace();
  const assets = config.assetsPath ? new AssetsCompatFetcher(config.assetsPath) : undefined;

  return {
    DB: db as unknown,
    MEDIA: undefined, // Storage not implemented in Deno entry point for simplicity
    KV: kv as unknown,
    ASSETS: assets as unknown,
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
async function runMigrations(db: D1CompatDatabase, migrationsDir: string): Promise<void> {
  // @ts-expect-error - Deno API
  const entries = [];
  // @ts-expect-error - Deno API
  for await (const entry of Deno.readDir(migrationsDir)) {
    if (entry.isFile && entry.name.endsWith('.sql')) {
      entries.push(entry.name);
    }
  }
  entries.sort();

  // Create migrations tracking table
  // @ts-expect-error - Deno SQLite type
  db.getRawDatabase().exec(`
    CREATE TABLE IF NOT EXISTS _cf_migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      applied_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // @ts-expect-error - Deno SQLite type
  const applied = db.getRawDatabase()
    .prepare('SELECT name FROM _cf_migrations')
    .all() as Array<{ name: string }>;
  const appliedSet = new Set(applied.map((r) => r.name));

  for (const file of entries) {
    if (appliedSet.has(file)) {
      console.log(`Migration ${file} already applied, skipping`);
      continue;
    }

    console.log(`Applying migration: ${file}`);
    // @ts-expect-error - Deno API
    const sql = await Deno.readTextFile(`${migrationsDir}/${file}`);

    const statements = sql
      .split(';')
      .map((s: string) => s.trim())
      .filter((s: string) => s.length > 0);

    for (const stmt of statements) {
      try {
        // @ts-expect-error - Deno SQLite type
        db.getRawDatabase().exec(stmt);
      } catch (e) {
        console.error(`Error executing statement in ${file}:`, stmt);
        throw e;
      }
    }

    // @ts-expect-error - Deno SQLite type
    db.getRawDatabase()
      .prepare('INSERT INTO _cf_migrations (name) VALUES (?)')
      .run(file);

    console.log(`Migration ${file} applied successfully`);
  }
}

async function main() {
  console.log('🚀 Starting Yurucommu server (Deno mode)...');

  // Ensure data directory exists
  const dataDir = DATABASE_PATH.substring(0, DATABASE_PATH.lastIndexOf('/'));
  try {
    // @ts-expect-error - Deno API
    await Deno.mkdir(dataDir, { recursive: true });
  } catch { /* ignore if exists */ }

  // Create environment with Deno adapters
  const env = await createDenoEnv({
    databasePath: DATABASE_PATH,
    storagePath: STORAGE_PATH,
    assetsPath: ASSETS_PATH,
    APP_URL,
    // @ts-expect-error - Deno API
    AUTH_PASSWORD_HASH: Deno.env.get('AUTH_PASSWORD_HASH'),
    // @ts-expect-error - Deno API
    AUTH_PASSWORD: Deno.env.get('AUTH_PASSWORD'),
    // @ts-expect-error - Deno API
    GOOGLE_CLIENT_ID: Deno.env.get('GOOGLE_CLIENT_ID'),
    // @ts-expect-error - Deno API
    GOOGLE_CLIENT_SECRET: Deno.env.get('GOOGLE_CLIENT_SECRET'),
    // @ts-expect-error - Deno API
    X_CLIENT_ID: Deno.env.get('X_CLIENT_ID'),
    // @ts-expect-error - Deno API
    X_CLIENT_SECRET: Deno.env.get('X_CLIENT_SECRET'),
    // @ts-expect-error - Deno API
    TAKOS_URL: Deno.env.get('TAKOS_URL'),
    // @ts-expect-error - Deno API
    TAKOS_CLIENT_ID: Deno.env.get('TAKOS_CLIENT_ID'),
    // @ts-expect-error - Deno API
    TAKOS_CLIENT_SECRET: Deno.env.get('TAKOS_CLIENT_SECRET'),
  });

  // Run migrations
  try {
    // @ts-expect-error - Deno API
    await Deno.stat(MIGRATIONS_PATH);
    console.log('📦 Running database migrations...');
    await runMigrations(env.DB as unknown as D1CompatDatabase, MIGRATIONS_PATH);
    console.log('✅ Migrations complete');
  } catch {
    console.log('⚠️  No migrations directory found, skipping migrations');
  }

  // Start server
  console.log(`\n📡 Server starting on http://localhost:${PORT}`);
  console.log(`   APP_URL: ${APP_URL}`);
  console.log(`   Database: ${DATABASE_PATH}`);
  console.log(`   Storage: ${STORAGE_PATH}`);
  console.log(`   Assets: ${ASSETS_PATH}`);
  console.log('');

  // Dynamic import of Hono app
  // @ts-expect-error - Deno requires .ts extension for imports
  const { default: app } = await import('./index.ts');

  // @ts-expect-error - Deno API
  Deno.serve({ port: PORT }, (request: Request) => {
    return app.fetch(request, env);
  });

  console.log(`✅ Server is running at http://localhost:${PORT}`);
}

main().catch((error) => {
  console.error('❌ Failed to start server:', error);
  // @ts-expect-error - Deno API
  Deno.exit(1);
});
