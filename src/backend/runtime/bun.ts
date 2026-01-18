// @ts-nocheck - This file is Bun-specific and should be type-checked by Bun's TypeScript
/**
 * Bun Runtime Adapters
 *
 * These adapters provide implementations for Bun environments
 * using Bun's native SQLite, filesystem, and in-memory stores.
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

// Re-export MemoryKV from node.ts as it works in Bun too
export { MemoryKV } from './node';

/**
 * Bun SQLite Database Adapter (using bun:sqlite)
 */
export class BunDatabase implements IDatabase {
  private db: import('bun:sqlite').Database;

  constructor(db: import('bun:sqlite').Database) {
    this.db = db;
  }

  static create(filename: string = ':memory:'): BunDatabase {
    // @ts-expect-error - Bun.sql is available in Bun runtime
    const { Database } = require('bun:sqlite');
    const db = new Database(filename);
    db.exec('PRAGMA journal_mode = WAL');
    return new BunDatabase(db);
  }

  prepare(query: string): PreparedStatement {
    return new BunPreparedStatement(this.db, query);
  }

  async exec(query: string): Promise<void> {
    this.db.exec(query);
  }

  async batch<T = unknown>(statements: PreparedStatement[]): Promise<QueryResult<T>[]> {
    const results: QueryResult<T>[] = [];
    this.db.transaction(() => {
      for (const stmt of statements) {
        if (stmt instanceof BunPreparedStatement) {
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
 * Bun SQLite Prepared Statement Adapter
 */
class BunPreparedStatement implements PreparedStatement {
  private db: import('bun:sqlite').Database;
  private query: string;
  private boundValues: unknown[] = [];

  constructor(db: import('bun:sqlite').Database, query: string) {
    this.db = db;
    this.query = query;
  }

  bind(...values: unknown[]): PreparedStatement {
    this.boundValues = values;
    return this;
  }

  async first<T = unknown>(colName?: string): Promise<FirstResult<T>> {
    const stmt = this.db.prepare(this.query);
    const row = stmt.get(...this.boundValues) as Record<string, unknown> | null;
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
 * Bun Filesystem Storage Adapter
 */
export class BunStorage implements IObjectStorage {
  private basePath: string;

  constructor(basePath: string) {
    this.basePath = basePath;
  }

  static async create(basePath: string): Promise<BunStorage> {
    const { mkdir } = await import('fs/promises');
    await mkdir(basePath, { recursive: true });
    return new BunStorage(basePath);
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
    const { mkdir } = await import('fs/promises');
    await mkdir(dir, { recursive: true });

    // Convert value to appropriate format
    let content: Uint8Array;
    if (typeof value === 'string') {
      content = new TextEncoder().encode(value);
    } else if (value instanceof ArrayBuffer) {
      content = new Uint8Array(value);
    } else {
      // ReadableStream
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

    // @ts-expect-error - Bun.write is available in Bun runtime
    await Bun.write(filePath, content);

    // Write metadata
    if (options?.httpMetadata || options?.customMetadata) {
      // @ts-expect-error - Bun.write is available in Bun runtime
      await Bun.write(
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
      // @ts-expect-error - Bun.file is available in Bun runtime
      const file = Bun.file(filePath);
      if (!(await file.exists())) return null;

      const content = new Uint8Array(await file.arrayBuffer());
      let metadata: { httpMetadata?: ObjectMetadata['httpMetadata']; customMetadata?: Record<string, string> } = {};

      try {
        // @ts-expect-error - Bun.file is available in Bun runtime
        const metaFile = Bun.file(metaPath);
        if (await metaFile.exists()) {
          metadata = JSON.parse(await metaFile.text());
        }
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
    const { unlink } = await import('fs/promises');
    const keys = Array.isArray(key) ? key : [key];
    for (const k of keys) {
      try {
        await unlink(this.getFilePath(k));
      } catch {
        // Ignore if not exists
      }
      try {
        await unlink(this.getMetaPath(k));
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
    const { readdir, stat } = await import('fs/promises');
    const objects: ListObjectsResult['objects'] = [];

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
      // @ts-expect-error - Bun.file is available in Bun runtime
      const file = Bun.file(filePath);
      if (!(await file.exists())) return null;

      let metadata: { httpMetadata?: ObjectMetadata['httpMetadata']; customMetadata?: Record<string, string> } = {};

      try {
        // @ts-expect-error - Bun.file is available in Bun runtime
        const metaFile = Bun.file(metaPath);
        if (await metaFile.exists()) {
          metadata = JSON.parse(await metaFile.text());
        }
      } catch {
        // No metadata file
      }

      return {
        contentLength: file.size,
        httpMetadata: metadata.httpMetadata,
        customMetadata: metadata.customMetadata,
      };
    } catch {
      return null;
    }
  }
}

/**
 * Static file server for Bun
 */
export class BunAssets implements IStaticAssets {
  private basePath: string;

  constructor(basePath: string) {
    this.basePath = basePath;
  }

  static create(basePath: string): BunAssets {
    return new BunAssets(basePath);
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
      // @ts-expect-error - Bun.file is available in Bun runtime
      let file = Bun.file(filePath);

      // If directory, try index.html
      if (!(await file.exists())) {
        filePath = `${filePath}/index.html`;
        // @ts-expect-error - Bun.file is available in Bun runtime
        file = Bun.file(filePath);
      }

      if (await file.exists()) {
        return new Response(file);
      }

      // SPA fallback - serve index.html for non-existent paths
      // @ts-expect-error - Bun.file is available in Bun runtime
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
 * Create runtime environment for Bun
 */
export function createBunRuntime(config: {
  databasePath?: string;
  storagePath?: string;
  assetsPath?: string;
  envVars: {
    APP_URL: string;
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
}): RuntimeEnv {
  const { MemoryKV } = require('./node');

  return {
    db: BunDatabase.create(config.databasePath || ':memory:'),
    storage: config.storagePath ? new BunStorage(config.storagePath) : undefined,
    kv: new MemoryKV(),
    assets: config.assetsPath ? BunAssets.create(config.assetsPath) : undefined,
    ...config.envVars,
  };
}
