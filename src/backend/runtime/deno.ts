// @ts-nocheck - This file is Deno-specific and should be type-checked by Deno's TypeScript
/**
 * Deno Runtime Adapters
 *
 * These adapters provide implementations for Deno environments
 * using Deno's SQLite (via x/sqlite), filesystem, and in-memory stores.
 */

import type {
  IDatabase,
  IObjectStorage,
  IKeyValueStore,
  IStaticAssets,
  PreparedStatement,
  QueryResult,
  FirstResult,
  RunResult,
  StorageObject,
  ListObjectsResult,
  ObjectMetadata,
  RuntimeEnv,
} from './types';

/**
 * In-Memory Key-Value Store Adapter (same as Node.js version)
 */
export class MemoryKV implements IKeyValueStore {
  private store = new Map<string, { value: string; expiration?: number; metadata?: Record<string, unknown> }>();

  get(key: string, options?: { type?: 'text' }): Promise<string | null>;
  get<T = unknown>(key: string, options: { type: 'json' }): Promise<T | null>;
  get(key: string, options: { type: 'arrayBuffer' }): Promise<ArrayBuffer | null>;
  async get(key: string, options?: { type?: 'text' | 'json' | 'arrayBuffer' }): Promise<string | ArrayBuffer | unknown | null> {
    const entry = this.store.get(key);
    if (!entry) return null;

    // Check expiration
    if (entry.expiration && entry.expiration < Date.now() / 1000) {
      this.store.delete(key);
      return null;
    }

    const type = options?.type ?? 'text';
    if (type === 'json') {
      return JSON.parse(entry.value);
    }
    if (type === 'arrayBuffer') {
      return new TextEncoder().encode(entry.value).buffer;
    }
    return entry.value;
  }

  async put(
    key: string,
    value: string | ArrayBuffer | ReadableStream,
    options?: {
      expirationTtl?: number;
      expiration?: number;
      metadata?: Record<string, unknown>;
    }
  ): Promise<void> {
    let strValue: string;
    if (typeof value === 'string') {
      strValue = value;
    } else if (value instanceof ArrayBuffer) {
      strValue = new TextDecoder().decode(value);
    } else {
      const reader = value.getReader();
      const chunks: Uint8Array[] = [];
      while (true) {
        const { done, value: chunk } = await reader.read();
        if (done) break;
        chunks.push(chunk);
      }
      const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
      const combined = new Uint8Array(totalLength);
      let offset = 0;
      for (const chunk of chunks) {
        combined.set(chunk, offset);
        offset += chunk.length;
      }
      strValue = new TextDecoder().decode(combined);
    }

    let expiration: number | undefined;
    if (options?.expiration) {
      expiration = options.expiration;
    } else if (options?.expirationTtl) {
      expiration = Math.floor(Date.now() / 1000) + options.expirationTtl;
    }

    this.store.set(key, {
      value: strValue,
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

      keys.push({
        name,
        expiration: entry.expiration,
        metadata: entry.metadata,
      });
    }

    const limit = options?.limit ?? 1000;
    const list_complete = keys.length <= limit;

    return {
      keys: keys.slice(0, limit),
      list_complete,
      cursor: list_complete ? undefined : String(limit),
    };
  }
}

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

  static async create(filename: string = ':memory:'): Promise<DenoDatabase> {
    // @ts-expect-error - Deno import
    const { Database } = await import('https://deno.land/x/sqlite3@0.12.0/mod.ts');
    const db = new Database(filename);
    db.exec('PRAGMA journal_mode = WAL');
    return new DenoDatabase(db);
  }

  prepare(query: string): PreparedStatement {
    return new DenoPreparedStatement(this.db, query);
  }

  async exec(query: string): Promise<void> {
    // @ts-expect-error - Deno SQLite type
    this.db.exec(query);
  }

  async batch<T = unknown>(statements: PreparedStatement[]): Promise<QueryResult<T>[]> {
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
    const row = stmt.get(...this.boundValues) as Record<string, unknown> | undefined;
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
    return `${this.basePath}/${key}.meta.json`;
  }

  async put(
    key: string,
    value: ReadableStream | ArrayBuffer | string,
    options?: {
      httpMetadata?: ObjectMetadata['httpMetadata'];
      customMetadata?: Record<string, string>;
    }
  ): Promise<void> {
    const filePath = this.getFilePath(key);

    // Ensure directory exists
    const dir = filePath.substring(0, filePath.lastIndexOf('/'));
    // @ts-expect-error - Deno API
    await Deno.mkdir(dir, { recursive: true });

    // Convert value to Uint8Array
    let content: Uint8Array;
    if (typeof value === 'string') {
      content = new TextEncoder().encode(value);
    } else if (value instanceof ArrayBuffer) {
      content = new Uint8Array(value);
    } else {
      const chunks: Uint8Array[] = [];
      const reader = value.getReader();
      while (true) {
        const { done, value: chunk } = await reader.read();
        if (done) break;
        chunks.push(chunk);
      }
      const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
      content = new Uint8Array(totalLength);
      let offset = 0;
      for (const chunk of chunks) {
        content.set(chunk, offset);
        offset += chunk.length;
      }
    }

    // @ts-expect-error - Deno API
    await Deno.writeFile(filePath, content);

    // Write metadata
    if (options?.httpMetadata || options?.customMetadata) {
      // @ts-expect-error - Deno API
      await Deno.writeTextFile(
        this.getMetaPath(key),
        JSON.stringify({
          httpMetadata: options.httpMetadata,
          customMetadata: options.customMetadata,
        })
      );
    }
  }

  async get(key: string): Promise<StorageObject | null> {
    const filePath = this.getFilePath(key);
    const metaPath = this.getMetaPath(key);

    try {
      // @ts-expect-error - Deno API
      const content = await Deno.readFile(filePath);
      let metadata: { httpMetadata?: ObjectMetadata['httpMetadata']; customMetadata?: Record<string, string> } = {};

      try {
        // @ts-expect-error - Deno API
        const metaContent = await Deno.readTextFile(metaPath);
        metadata = JSON.parse(metaContent);
      } catch {
        // No metadata file
      }

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
      try {
        // @ts-expect-error - Deno API
        await Deno.remove(this.getFilePath(k));
      } catch {
        // Ignore if not exists
      }
      try {
        // @ts-expect-error - Deno API
        await Deno.remove(this.getMetaPath(k));
      } catch {
        // Ignore if not exists
      }
    }
  }

  async list(options?: {
    prefix?: string;
    limit?: number;
    cursor?: string;
    delimiter?: string;
  }): Promise<ListObjectsResult> {
    const objects: ListObjectsResult['objects'] = [];

    const readDirRecursive = async (dir: string, prefix: string = '') => {
      try {
        // @ts-expect-error - Deno API
        for await (const entry of Deno.readDir(dir)) {
          const fullPath = `${dir}/${entry.name}`;
          const key = prefix ? `${prefix}/${entry.name}` : entry.name;

          if (entry.isDirectory) {
            await readDirRecursive(fullPath, key);
          } else if (!entry.name.endsWith('.meta.json')) {
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

    const limit = options?.limit ?? 1000;
    const truncated = objects.length > limit;

    return {
      objects: objects.slice(0, limit),
      truncated,
      cursor: truncated ? String(limit) : undefined,
    };
  }

  async head(key: string): Promise<ObjectMetadata | null> {
    const filePath = this.getFilePath(key);
    const metaPath = this.getMetaPath(key);

    try {
      // @ts-expect-error - Deno API
      const stats = await Deno.stat(filePath);
      let metadata: { httpMetadata?: ObjectMetadata['httpMetadata']; customMetadata?: Record<string, string> } = {};

      try {
        // @ts-expect-error - Deno API
        const metaContent = await Deno.readTextFile(metaPath);
        metadata = JSON.parse(metaContent);
      } catch {
        // No metadata file
      }

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
    const normalizedPath = filePath.replace(/\.\./g, '');
    if (normalizedPath !== filePath) {
      return new Response('Forbidden', { status: 403 });
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
      const ext = filePath.substring(filePath.lastIndexOf('.'));
      const contentType = getMimeType(ext);

      return new Response(content, {
        headers: {
          'Content-Type': contentType,
          'Content-Length': String(content.length),
        },
      });
    } catch {
      // SPA fallback - serve index.html for non-existent paths
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
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
  };
  return mimeTypes[ext] || 'application/octet-stream';
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
    AUTH_PASSWORD?: string;
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
    db: await DenoDatabase.create(config.databasePath || ':memory:'),
    storage: config.storagePath ? await DenoStorage.create(config.storagePath) : undefined,
    kv: new MemoryKV(),
    assets: config.assetsPath ? DenoAssets.create(config.assetsPath) : undefined,
    ...config.envVars,
  };
}
