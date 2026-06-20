/**
 * Bun Runtime Adapters
 *
 * These adapters provide implementations for Bun environments
 * using Bun's native SQLite, filesystem, and in-memory stores.
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
import {
  assertPathChainWithinBasePath,
  isPathWithinBasePath,
  resolvePathWithinBasePath,
} from "./shared.ts";
import { MemoryKV } from "./memory-kv.ts";
import { loadBunSqlite } from "./compat-bun/types.ts";
import type { BunRuntime, BunSQLiteDatabase } from "./compat-bun/types.ts";
import path from "node:path";

declare const Bun: BunRuntime;
declare const require: (specifier: string) => unknown;

// Re-export MemoryKV as it works in Bun too.
export { MemoryKV };

const { mkdir, unlink, readdir, stat, realpath } = await import("fs/promises");

/**
 * Drain a ReadableStream into a single Uint8Array.
 */
async function drainStream(
  stream: ReadableStream<Uint8Array>,
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  const reader = stream.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

/**
 * Convert a put() value to Uint8Array.
 */
async function toUint8Array(
  value: ReadableStream | ArrayBuffer | string,
): Promise<Uint8Array> {
  if (typeof value === "string") return new TextEncoder().encode(value);
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  return drainStream(value);
}

/**
 * Read the JSON metadata sidecar for a storage key.
 * Returns an empty object if the sidecar doesn't exist or can't be parsed.
 */
async function readMetadata(metaPath: string): Promise<{
  httpMetadata?: ObjectMetadata["httpMetadata"];
  customMetadata?: Record<string, string>;
}> {
  try {
    const metaFile = Bun.file(metaPath);
    if (await metaFile.exists()) {
      return JSON.parse(await metaFile.text());
    }
  } catch {
    // No metadata file or unreadable
  }
  return {};
}

/**
 * Bun SQLite Database Adapter (using bun:sqlite)
 */
export class BunDatabase implements IDatabase {
  private db: BunSQLiteDatabase;

  constructor(db: unknown) {
    this.db = db as BunSQLiteDatabase;
  }

  static create(filename: string = ":memory:"): BunDatabase {
    const Database = loadBunSqlite(require);
    const db = new Database(filename);
    db.exec("PRAGMA journal_mode = WAL");
    // synchronous=NORMAL pairs with WAL to avoid an fsync on every statement.
    // Set once at connection open (a connection-level setting) so a fresh
    // self-host boot does not auto-commit+fsync per migration statement.
    db.exec("PRAGMA synchronous = NORMAL");
    // Foreign keys are intentionally left OFF (SQLite's per-connection default)
    // so the Bun/libsql engine matches Cloudflare D1, which ignores the FK
    // constraints declared in the migrations. Remote actors live in
    // actor_cache (never in actors), yet objects.attributed_to / follows.* /
    // likes.* / announces.* FK-reference actors(ap_id); enabling enforcement
    // would make every inbound federated activity from a remote actor violate
    // the FK and fail to insert. Referential cleanup is handled at the app
    // level by deleteObjectCascade()/delete-cascade.ts, identically on D1.
    return new BunDatabase(db);
  }

  prepare(query: string): PreparedStatement {
    return new BunPreparedStatement(this.db, query);
  }

  getRawDatabase(): unknown {
    return this.db;
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
  private db: BunSQLiteDatabase;
  private query: string;
  private boundValues: unknown[] = [];

  constructor(db: BunSQLiteDatabase, query: string) {
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
    return stmt.run(...this.boundValues) as {
      changes: number;
      lastInsertRowid: number;
    };
  }
}

/**
 * Bun Filesystem Storage Adapter
 */
export class BunStorage implements IObjectStorage {
  private basePath: string;
  private realBasePath: string | null = null;

  constructor(basePath: string) {
    this.basePath = basePath;
  }

  static async create(basePath: string): Promise<BunStorage> {
    await mkdir(basePath, { recursive: true });
    return new BunStorage(basePath);
  }

  private getFilePath(key: string): string {
    return resolvePathWithinBasePath(this.getResolvedBasePath(), key);
  }

  private getMetaPath(key: string): string {
    return resolvePathWithinBasePath(
      this.getResolvedBasePath(),
      `${key}.meta.json`,
    );
  }

  private getResolvedBasePath(): string {
    return path.resolve(this.basePath);
  }

  private async getRealBasePath(): Promise<string> {
    if (this.realBasePath) return this.realBasePath;
    try {
      await mkdir(this.getResolvedBasePath(), { recursive: true });
      this.realBasePath = await realpath(this.getResolvedBasePath());
    } catch {
      this.realBasePath = this.getResolvedBasePath();
    }
    return this.realBasePath;
  }

  private async resolveExistingPath(filePath: string): Promise<string | null> {
    try {
      const realPath = await realpath(filePath);
      const realBasePath = await this.getRealBasePath();
      if (!isPathWithinBasePath(realBasePath, realPath)) {
        throw new Error("Path escapes base directory");
      }
      return realPath;
    } catch {
      return null;
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
      realpath,
    );

    await mkdir(dir, { recursive: true });

    const realBasePath = await this.getRealBasePath();
    let realFilePath: string | null = null;
    try {
      realFilePath = await realpath(filePath);
    } catch {
      realFilePath = null;
    }
    if (realFilePath) {
      if (!isPathWithinBasePath(realBasePath, realFilePath)) {
        throw new Error("Path escapes base directory");
      }
    } else {
      const realDirPath = await realpath(dir);
      if (!isPathWithinBasePath(realBasePath, realDirPath)) {
        throw new Error("Path escapes base directory");
      }
    }

    const content = await toUint8Array(value);
    await Bun.write(filePath, content);

    if (options?.httpMetadata || options?.customMetadata) {
      await Bun.write(
        this.getMetaPath(key),
        JSON.stringify({
          httpMetadata: options.httpMetadata,
          customMetadata: options.customMetadata,
        }),
      );
    }
  }

  async get(key: string): Promise<StorageObject | null> {
    const filePath = this.getFilePath(key);

    try {
      const resolvedFilePath = await this.resolveExistingPath(filePath);
      if (!resolvedFilePath) return null;
      const file = Bun.file(resolvedFilePath);
      if (!(await file.exists())) return null;

      const content = new Uint8Array(await file.arrayBuffer());
      const resolvedMetaPath = await this.resolveExistingPath(
        this.getMetaPath(key),
      );
      const metadata = resolvedMetaPath
        ? await readMetadata(resolvedMetaPath)
        : {};

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
        const filePath = await this.resolveExistingPath(this.getFilePath(k));
        if (filePath) await unlink(filePath);
      } catch {
        /* ignore */
      }
      try {
        const metaPath = await this.resolveExistingPath(this.getMetaPath(k));
        if (metaPath) await unlink(metaPath);
      } catch {
        /* ignore */
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
        const entries = await readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = `${dir}/${entry.name}`;
          const realFullPath = await realpath(fullPath);
          if (!isPathWithinBasePath(realBasePath, realFullPath)) continue;
          const key = prefix ? `${prefix}/${entry.name}` : entry.name;

          if (entry.isDirectory()) {
            await readDirRecursive(fullPath, key);
          } else if (!entry.name.endsWith(".meta.json")) {
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

    await readDirRecursive(realBasePath);

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

    try {
      const resolvedFilePath = await this.resolveExistingPath(filePath);
      if (!resolvedFilePath) return null;
      const file = Bun.file(resolvedFilePath);
      if (!(await file.exists())) return null;

      const resolvedMetaPath = await this.resolveExistingPath(
        this.getMetaPath(key),
      );
      const metadata = resolvedMetaPath
        ? await readMetadata(resolvedMetaPath)
        : {};
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
// Extension -> MIME fallback for static assets, used when Bun.file.type is
// empty. Mirrors the worker's getMimeType so the self-host (Bun) path serves
// the same Content-Types as the Cloudflare ASSETS binding.
const ASSET_MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  // JSON-LD context documents (yurucommu.com/ns/*) need the ld+json media type
  // so strict JSON-LD processors accept a dereferenced @context.
  ".jsonld": "application/ld+json",
  ".jsonl": "application/x-ndjson",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".map": "application/json; charset=utf-8",
  ".wasm": "application/wasm",
  ".txt": "text/plain; charset=utf-8",
};

function mimeFromExt(filePath: string): string {
  const ext = filePath.slice(filePath.lastIndexOf(".")).toLowerCase();
  return ASSET_MIME[ext] || "application/octet-stream";
}

// Backend route prefixes (API, ActivityPub, well-known, media, health). A path
// under one of these that reaches the static asset handler means the backend
// router did not match it — that is a genuine 404 for an API/AP client, NOT a
// candidate for the SPA HTML fallback (which would return 200 text/html and
// break clients that expect JSON / an AP document).
const NON_SPA_PREFIXES = [
  "/api",
  "/ap",
  "/.well-known",
  "/nodeinfo",
  "/media",
  "/hosted",
  "/.takos",
  "/healthz",
  "/readyz",
];

export class BunAssets implements IStaticAssets {
  private basePath: string;
  private realBasePath: string | null = null;

  constructor(basePath: string) {
    this.basePath = basePath;
  }

  static create(basePath: string): BunAssets {
    return new BunAssets(basePath);
  }

  private getResolvedBasePath(): string {
    return path.resolve(this.basePath);
  }

  private async getRealBasePath(): Promise<string> {
    if (this.realBasePath) return this.realBasePath;
    try {
      this.realBasePath = await realpath(this.getResolvedBasePath());
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

    // A missing path falls back to the SPA's index.html ONLY when it is a
    // genuine CLIENT-SIDE route (/, /search, /profile, /post/<id>, ...), so a
    // deep link / refresh / shared URL loads the app instead of 404ing. It must
    // NOT serve the SPA when the path is either:
    //   - a real static ASSET request (a known asset extension) — a missing
    //     asset is a genuine 404, not the HTML shell; or
    //   - a BACKEND route prefix (/api, /ap, /.well-known, ...) — reaching the
    //     static handler means the API/AP route did not match, which an API/AP
    //     client expects as a 404, never an HTML 200.
    const lastDot = url.pathname.lastIndexOf(".");
    const ext = lastDot >= 0 ? url.pathname.slice(lastDot).toLowerCase() : "";
    const hasAssetExt = ext !== "" && ext !== ".html" && ext in ASSET_MIME;
    const isBackendPath = NON_SPA_PREFIXES.some(
      (p) => url.pathname === p || url.pathname.startsWith(p + "/"),
    );
    const spaFallbackEligible = !hasAssetExt && !isBackendPath;

    let realFilePath: string;
    try {
      realFilePath = await realpath(filePath);
    } catch {
      // Path does not exist: a client route falls back to the SPA shell; a real
      // asset or an unmatched backend route is a genuine 404.
      return spaFallbackEligible
        ? this.serveSpaIndex(realBasePath)
        : new Response("Not Found", { status: 404 });
    }

    try {
      if (!isPathWithinBasePath(realBasePath, realFilePath)) {
        return new Response("Forbidden", { status: 403 });
      }

      const stats = await stat(realFilePath);
      let servePath = realFilePath;
      let file = Bun.file(realFilePath);

      // If directory, serve its index.html.
      if (stats.isDirectory()) {
        const realIndexPath = await realpath(
          path.join(realFilePath, "index.html"),
        );
        if (!isPathWithinBasePath(realBasePath, realIndexPath)) {
          return new Response("Forbidden", { status: 403 });
        }
        servePath = realIndexPath;
        file = Bun.file(servePath);
      }

      if (await file.exists()) {
        // Set Content-Type explicitly from the file extension: the global
        // response pipeline emits X-Content-Type-Options: nosniff, so a missing
        // type makes the browser refuse to render the SPA / execute its module
        // scripts. (new Response(Bun.file) does not reliably propagate a type
        // through the Hono pipeline here, so set it ourselves.)
        return new Response(file, {
          headers: { "Content-Type": mimeFromExt(servePath) },
        });
      }

      return spaFallbackEligible
        ? this.serveSpaIndex(realBasePath)
        : new Response("Not Found", { status: 404 });
    } catch {
      return spaFallbackEligible
        ? this.serveSpaIndex(realBasePath)
        : new Response("Not Found", { status: 404 });
    }
  }

  /**
   * Serve the SPA shell (index.html) for client-side routes. Returns 404 only
   * if the bundle's index.html is genuinely missing.
   */
  private async serveSpaIndex(realBasePath: string): Promise<Response> {
    try {
      const realIndexPath = await realpath(
        path.join(this.getResolvedBasePath(), "index.html"),
      );
      if (!isPathWithinBasePath(realBasePath, realIndexPath)) {
        return new Response("Forbidden", { status: 403 });
      }
      const indexFile = Bun.file(realIndexPath);
      if (await indexFile.exists()) {
        return new Response(indexFile, {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }
    } catch {
      // index.html missing/unreadable — fall through to 404.
    }
    return new Response("Not Found", { status: 404 });
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
    TAKOS_URL?: string;
    AUTH_MODE?: string;
  };
}): RuntimeEnv {
  return {
    db: BunDatabase.create(config.databasePath || ":memory:"),
    storage: config.storagePath
      ? new BunStorage(config.storagePath)
      : undefined,
    kv: new MemoryKV(),
    assets: config.assetsPath ? BunAssets.create(config.assetsPath) : undefined,
    ...config.envVars,
  };
}
