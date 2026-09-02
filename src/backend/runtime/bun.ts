/**
 * Bun Runtime Adapters
 *
 * These adapters provide implementations for Bun environments
 * using Bun's native SQLite, filesystem, and in-memory stores.
 */

import type {
  FirstResult,
  IDatabase,
  ObjectStore,
  ObjectStoreBody,
  ObjectStoreObject,
  ObjectStorePutOptions,
  IStaticAssets,
  PreparedStatement,
  QueryResult,
  RunResult,
} from "./types.ts";
import { constants as fsConstants } from "node:fs";
import type { FileHandle } from "node:fs/promises";
import { createHash } from "node:crypto";
import {
  assertPathChainWithinBasePath,
  isPathWithinBasePath,
  resolvePathWithinBasePath,
} from "./node-paths.ts";
import { MemoryKV } from "./memory-kv.ts";
import { isBackendPath } from "../lib/backend-paths.ts";
import { loadBunSqlite } from "./compat-bun/types.ts";
import type { BunRuntime, BunSQLiteDatabase } from "./compat-bun/types.ts";
import path from "node:path";

declare const Bun: BunRuntime;
declare const require: (specifier: string) => unknown;

// Re-export MemoryKV as it works in Bun too.
export { MemoryKV };

const {
  mkdir,
  unlink,
  readdir,
  stat,
  lstat,
  realpath,
  open,
  rename,
  readFile,
  readlink,
} = await import("fs/promises");

// Generation state is deliberately kept outside the public object namespace.
// The sibling directory name is derived from the storage directory, so a
// legacy object literally named `.yurucommu-objects` (or any descendant) is
// still a valid user key under the public root.
const INTERNAL_STORE_ROOT = ".yurucommu-objects";
const COMMIT_FILE = "commit.json";
const GENERATION_MARKER = "generation-";
const TEMP_MARKER = "tmp-";
const LEASE_SUFFIX = "lease";
const READER_LEASE_MARKER = "reader-";
const MARKER_READ_ATTEMPTS = 32;
const OBJECT_RESOLVE_ATTEMPTS = 64;
const OPEN_READ_FLAGS = fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW;
const GENERATION_ID_PATTERN = /^[0-9a-f-]{16,}$/u;
const DIGEST_PATTERN = /^[0-9a-f]{64}$/u;
const LEASE_BOOT_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const LEASE_PID_NAMESPACE_ID_PATTERN = /^pid:\[[1-9][0-9]*\]$/u;
const LEASE_PROCESS_START_TOKEN_PATTERN = /^[0-9]{1,32}$/u;
const LEASE_TOKEN_MAX_LENGTH = 128;

type CommitState =
  | { version: 1; state: "committed"; generation: string }
  | { version: 1; state: "deleted"; generation: null };

type CommitRecord = CommitState & { key: string; keyHash: string };

type ResolvedObject = {
  filePath: string;
  bodyHandle?: FileHandle;
  metadata: {
    contentType?: string;
  };
  releaseBody?: () => Promise<void>;
};

type TempLease = (() => Promise<void>) & {
  assertOwned(): Promise<void>;
};

type LeaseProcessIdentity = {
  bootId: string;
  pidNamespaceId: string;
  processStartToken: string;
};

type LeaseOwner = {
  version: 2;
  pid: number;
  token: string;
  processIdentity: LeaseProcessIdentity;
};

type LeaseOwnerState = "live" | "dead" | "unknown";

type LeaseProcessProbe = {
  readPidNamespace(pid: number): Promise<string>;
  readPidStat(pid: number): Promise<string>;
  signal0(pid: number): void;
};

const defaultLeaseProcessProbe: LeaseProcessProbe = {
  readPidNamespace(pid) {
    return readlink(`/proc/${pid}/ns/pid`);
  },
  readPidStat(pid) {
    return readFile(`/proc/${pid}/stat`, "utf8");
  },
  signal0(pid) {
    process.kill(pid, 0);
  },
};

type LiveLeaseState = {
  generations: Set<string>;
  reader: boolean;
};

type FileIdentity = {
  dev: number;
  ino: number;
  nlink: number;
  mode: number;
};

type BunStorageOptions = {
  syncDirectory?: typeof syncDirectory;
  /** Deterministic test seam at the lease-assertion/publication boundary. */
  beforeCommitRename?: (commitPath: string) => Promise<void>;
  /** Deterministic test seam for Linux /proc visibility and PID incarnation. */
  leaseProcessProbe?: LeaseProcessProbe;
};

function fileIdentity(stats: FileIdentity): FileIdentity {
  return {
    dev: stats.dev,
    ino: stats.ino,
    nlink: stats.nlink,
    mode: stats.mode,
  };
}

function isSameFileIdentity(
  expected: FileIdentity,
  actual: FileIdentity,
): boolean {
  return (
    expected.dev === actual.dev &&
    expected.ino === actual.ino &&
    // A concurrent atomic replacement may unlink the just-opened inode
    // between lstat() and fstat(); POSIX then reports nlink=0 on the still
    // valid descriptor.  It is safe to accept that transition because the
    // pre-open lstat required nlink===1 and dev/ino/type still match.  Any
    // other link count indicates a hardlink or inode substitution.
    (expected.nlink === actual.nlink ||
      actual.nlink === 0 ||
      (expected.nlink === 0 && actual.nlink === 1)) &&
    expected.mode === actual.mode
  );
}

function isInternalStorageName(name: string): boolean {
  return name.endsWith(".meta.json");
}

function keyHash(key: string): string {
  return createHash("sha256").update(key, "utf8").digest("hex");
}

function isNotFoundError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}

function isFileIdentityRace(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message === "BunStorage file changed while opening"
  );
}

function hasExactObjectKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const keys = Object.keys(value).sort();
  return (
    keys.length === expected.length &&
    expected.every((key, index) => keys[index] === key)
  );
}

function parseLeaseProcessIdentity(
  value: unknown,
): LeaseProcessIdentity | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  if (
    !hasExactObjectKeys(record, [
      "bootId",
      "pidNamespaceId",
      "processStartToken",
    ]) ||
    typeof record.bootId !== "string" ||
    !LEASE_BOOT_ID_PATTERN.test(record.bootId) ||
    typeof record.pidNamespaceId !== "string" ||
    !LEASE_PID_NAMESPACE_ID_PATTERN.test(record.pidNamespaceId) ||
    typeof record.processStartToken !== "string" ||
    !LEASE_PROCESS_START_TOKEN_PATTERN.test(record.processStartToken)
  ) {
    return undefined;
  }
  return {
    bootId: record.bootId,
    pidNamespaceId: record.pidNamespaceId,
    processStartToken: record.processStartToken,
  };
}

function parseLeaseOwner(ownerText: string): LeaseOwner | undefined {
  try {
    const value = JSON.parse(ownerText) as unknown;
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return undefined;
    }
    const record = value as Record<string, unknown>;
    const processIdentity = parseLeaseProcessIdentity(record.processIdentity);
    if (
      !hasExactObjectKeys(record, [
        "pid",
        "processIdentity",
        "token",
        "version",
      ]) ||
      record.version !== 2 ||
      typeof record.pid !== "number" ||
      !Number.isSafeInteger(record.pid) ||
      record.pid <= 0 ||
      typeof record.token !== "string" ||
      record.token.length === 0 ||
      record.token.length > LEASE_TOKEN_MAX_LENGTH ||
      !processIdentity
    ) {
      return undefined;
    }
    return {
      version: 2,
      pid: record.pid,
      token: record.token,
      processIdentity,
    };
  } catch {
    return undefined;
  }
}

function parseProcessStartToken(statText: string): string | undefined {
  // /proc/<pid>/stat field 2 is parenthesized and may itself contain spaces or
  // parentheses. The final ')' closes it; field 22 is then tail index 19.
  const commandEnd = statText.lastIndexOf(")");
  if (commandEnd < 0) return undefined;
  const token = statText
    .slice(commandEnd + 1)
    .trim()
    .split(/\s+/u)[19];
  return token && LEASE_PROCESS_START_TOKEN_PATTERN.test(token)
    ? token
    : undefined;
}

async function loadLocalLeaseProcessIdentity(): Promise<
  LeaseProcessIdentity | undefined
> {
  try {
    const [bootId, pidNamespaceId, statText] = await Promise.all([
      readFile("/proc/sys/kernel/random/boot_id", "utf8"),
      readlink("/proc/self/ns/pid"),
      readFile("/proc/self/stat", "utf8"),
    ]);
    return parseLeaseProcessIdentity({
      bootId: bootId.trim(),
      pidNamespaceId,
      processStartToken: parseProcessStartToken(statText),
    });
  } catch {
    return undefined;
  }
}

let localLeaseProcessIdentity:
  Promise<LeaseProcessIdentity | undefined> | undefined;

function getLocalLeaseProcessIdentity(): Promise<
  LeaseProcessIdentity | undefined
> {
  localLeaseProcessIdentity ??= loadLocalLeaseProcessIdentity();
  return localLeaseProcessIdentity;
}

function pidIsDefinitelyAbsent(pid: number, probe: LeaseProcessProbe): boolean {
  try {
    probe.signal0(pid);
    return false;
  } catch (error) {
    return (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: unknown }).code === "ESRCH"
    );
  }
}

async function classifyLeaseOwner(
  owner: LeaseOwner,
  probe: LeaseProcessProbe,
): Promise<LeaseOwnerState> {
  const localIdentity = await getLocalLeaseProcessIdentity();
  if (
    !localIdentity ||
    owner.processIdentity.bootId !== localIdentity.bootId ||
    owner.processIdentity.pidNamespaceId !== localIdentity.pidNamespaceId
  ) {
    return "unknown";
  }

  let targetNamespaceId: string;
  try {
    targetNamespaceId = await probe.readPidNamespace(owner.pid);
  } catch (error) {
    if (!isNotFoundError(error)) return "unknown";
    // hidepid=2 deliberately presents a live different-UID process as ENOENT.
    // Only ESRCH from signal 0 corroborates that this same-boot/same-namespace
    // PID is absent; EPERM and every other result remain unknown/fail-safe.
    return pidIsDefinitelyAbsent(owner.pid, probe) ? "dead" : "unknown";
  }
  if (targetNamespaceId !== localIdentity.pidNamespaceId) return "unknown";

  let targetStat: string;
  try {
    targetStat = await probe.readPidStat(owner.pid);
  } catch (error) {
    if (!isNotFoundError(error)) return "unknown";
    return pidIsDefinitelyAbsent(owner.pid, probe) ? "dead" : "unknown";
  }
  const targetStartToken = parseProcessStartToken(targetStat);
  if (!targetStartToken) return "unknown";
  return targetStartToken === owner.processIdentity.processStartToken
    ? "live"
    : "dead";
}

const emittedLeaseDiagnostics = new Set<string>();

function reportUnknownLeaseRetention(): void {
  const code = "lease-owner-unknown";
  if (emittedLeaseDiagnostics.has(code)) return;
  emittedLeaseDiagnostics.add(code);
  console.warn(
    "BunStorage retained an unverifiable lease; automatic reclaim is disabled. Confirm that no writer is active before operator cleanup (lease-owner-unknown).",
  );
}

function yieldForFilesystem(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

export async function writeBufferFully(
  handle: FileHandle,
  buffer: Uint8Array,
): Promise<void> {
  let offset = 0;
  while (offset < buffer.byteLength) {
    const result = await handle.write(buffer.subarray(offset));
    const bytesWritten =
      typeof result === "number" ? result : result?.bytesWritten;
    if (
      !Number.isInteger(bytesWritten) ||
      bytesWritten <= 0 ||
      bytesWritten > buffer.byteLength - offset
    ) {
      throw new Error(
        `filesystem short write: expected ${buffer.byteLength - offset} bytes, received ${String(bytesWritten)}`,
      );
    }
    offset += bytesWritten;
  }
}

async function writeStreamToFile(
  handle: FileHandle,
  stream: ReadableStream<Uint8Array>,
): Promise<void> {
  const reader = stream.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return;
      if (!(value instanceof Uint8Array)) {
        throw new Error("filesystem stream yielded a non-byte chunk");
      }
      await writeBufferFully(handle, value);
    }
  } catch (error) {
    await reader.cancel(error).catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
}

async function writeValueToFile(
  handle: FileHandle,
  value: Blob | ReadableStream | ArrayBuffer | string,
): Promise<void> {
  if (typeof value === "string") {
    await writeBufferFully(handle, new TextEncoder().encode(value));
    return;
  }
  if (value instanceof ArrayBuffer) {
    await writeBufferFully(handle, new Uint8Array(value));
    return;
  }
  const stream = value instanceof Blob ? value.stream() : value;
  await writeStreamToFile(handle, stream as ReadableStream<Uint8Array>);
}

async function syncAndClose(handle: FileHandle): Promise<void> {
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function syncDirectory(directoryPath: string): Promise<void> {
  let handle: FileHandle | undefined;
  try {
    // On Bun's POSIX filesystem, syncing the containing directory makes the
    // preceding atomic rename durable across power loss, not just the file
    // contents themselves.
    handle = await open(directoryPath, "r");
    await handle.sync();
  } finally {
    if (handle) await handle.close().catch(() => undefined);
  }
}

async function readFileHandleFully(handle: FileHandle): Promise<Uint8Array> {
  const size = (await handle.stat()).size;
  if (!Number.isSafeInteger(size) || size < 0) {
    throw new Error("invalid filesystem object size");
  }
  const content = new Uint8Array(size);
  let offset = 0;
  while (offset < content.byteLength) {
    const result = await handle.read(
      content,
      offset,
      content.byteLength - offset,
      null,
    );
    if (
      !Number.isInteger(result.bytesRead) ||
      result.bytesRead <= 0 ||
      result.bytesRead > content.byteLength - offset
    ) {
      throw new Error(
        `filesystem short read: expected ${content.byteLength - offset} bytes, received ${String(result.bytesRead)}`,
      );
    }
    offset += result.bytesRead;
  }
  return content;
}

/**
 * Expose an already-open object file as a lazy body stream.
 *
 * Pathname leases are released before this stream is returned. A writer may
 * publish a replacement or unlink the selected generation while a response is
 * still being sent, but the open descriptor keeps those exact bytes stable on
 * POSIX until the stream is consumed or cancelled.
 */
function createFileBodyStream(
  handle: FileHandle,
  byteLength: number,
  release: () => Promise<void>,
): ReadableStream<Uint8Array> {
  const chunkSize = 64 * 1024;
  let offset = 0;
  let released = false;

  const finish = async (): Promise<void> => {
    if (released) return;
    released = true;
    await release().catch(() => undefined);
  };

  return new ReadableStream<Uint8Array>(
    {
      async pull(controller) {
        if (offset >= byteLength) {
          controller.close();
          await finish();
          return;
        }
        const buffer = new Uint8Array(Math.min(chunkSize, byteLength - offset));
        try {
          const result = await handle.read(
            buffer,
            0,
            buffer.byteLength,
            offset,
          );
          if (
            !Number.isInteger(result.bytesRead) ||
            result.bytesRead <= 0 ||
            result.bytesRead > buffer.byteLength
          ) {
            throw new Error(
              `filesystem short read: expected ${buffer.byteLength} bytes, received ${String(result.bytesRead)}`,
            );
          }
          offset += result.bytesRead;
          controller.enqueue(buffer.subarray(0, result.bytesRead));
          if (offset >= byteLength) {
            controller.close();
            await finish();
          }
        } catch (error) {
          controller.error(error);
          await finish();
        }
      },
      async cancel() {
        await finish();
      },
    },
    { highWaterMark: 0 },
  );
}

async function readFileHandleText(handle: FileHandle): Promise<string> {
  return new TextDecoder().decode(await readFileHandleFully(handle));
}

function parseObjectMetadata(valueText: string): {
  contentType?: string;
} {
  const value = JSON.parse(valueText) as {
    contentType?: unknown;
    httpMetadata?: unknown;
  };
  if (value === null || typeof value !== "object") {
    throw new Error("Invalid BunStorage generation metadata");
  }
  const legacyHttpMetadata = value.httpMetadata;
  const legacyContentType =
    legacyHttpMetadata !== null &&
    typeof legacyHttpMetadata === "object" &&
    "contentType" in legacyHttpMetadata
      ? (legacyHttpMetadata as { contentType?: unknown }).contentType
      : undefined;
  const contentType =
    typeof value.contentType === "string"
      ? value.contentType
      : typeof legacyContentType === "string"
        ? legacyContentType
        : undefined;
  return contentType === undefined ? {} : { contentType };
}

/**
 * Read the JSON metadata sidecar for a storage key.
 * Returns an empty object if the sidecar doesn't exist or can't be parsed.
 */
async function readMetadata(metaPath: string): Promise<{
  contentType?: string;
}> {
  try {
    const metaFile = Bun.file(metaPath);
    if (await metaFile.exists()) {
      return parseObjectMetadata(await metaFile.text());
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
 * Bun Filesystem Storage Adapter.
 *
 * The generation/lease protocol requires a local Linux POSIX filesystem with
 * atomic same-directory rename and stable open-descriptor semantics. It does
 * not claim multi-host fencing. A lease from another boot, PID namespace, or
 * unreadable /proc owner is retained for explicit operator inspection rather
 * than automatically reclaimed.
 */
export class BunStorage implements ObjectStore {
  private basePath: string;
  /**
   * Keep the directory-sync dependency injectable for deterministic storage
   * durability tests. Production callers use the real fsync implementation.
   */
  private readonly syncDirectory: typeof syncDirectory;
  private readonly beforeCommitRename?: (commitPath: string) => Promise<void>;
  private readonly leaseProcessProbe: LeaseProcessProbe;
  private realBasePath: string | null = null;
  private realInternalStorePath: string | null = null;
  /**
   * Generations currently being assembled by this adapter instance. A
   * concurrent writer can have renamed its body before publishing the commit
   * marker; keep that generation out of eager GC until its marker is durable.
   */
  private readonly activeGenerations = new Set<string>();
  /**
   * In-process read leases keep a resolved generation alive until its bytes
   * have been opened/read. GC may run concurrently with a reader, so path
   * resolution alone is not a sufficient lifetime guarantee.
   */
  private readonly generationReaders = new Map<string, number>();
  /**
   * A short reservation held while a reader resolves the current marker and
   * opens its generation. It closes the race between reading the marker and
   * acquiring the generation-specific lease.
   */
  private readonly keyReadReservations = new Map<string, number>();
  /**
   * Serialize the conservative post-reader reclamation pass per key. A hot
   * object can have many concurrent streaming readers; running a full
   * directory scan for every EOF makes writers wait behind an unbounded queue
   * of equivalent cleanup work.
   */
  private readonly reclaimTasks = new Map<
    string,
    { requested: boolean; promise: Promise<void> }
  >();
  /**
   * Last marker successfully read by this adapter.  Atomic marker replacement
   * can make a path disappear or resolve to the next inode for a few syscalls;
   * retaining the last validated record lets readers use the old generation
   * while the marker is in flight instead of reporting a false null.
   */
  private readonly lastCommitRecords = new Map<string, CommitRecord>();

  constructor(basePath: string, options: BunStorageOptions = {}) {
    this.basePath = basePath;
    this.syncDirectory = options.syncDirectory ?? syncDirectory;
    this.beforeCommitRename = options.beforeCommitRename;
    this.leaseProcessProbe =
      options.leaseProcessProbe ?? defaultLeaseProcessProbe;
  }

  static async create(
    basePath: string,
    options: BunStorageOptions = {},
  ): Promise<BunStorage> {
    await mkdir(basePath, { recursive: true });
    const storage = new BunStorage(basePath, options);
    await storage.recoverInternalStore();
    return storage;
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

  private getInternalStorePath(): string {
    const publicRoot = this.getResolvedBasePath();
    return path.join(
      path.dirname(publicRoot),
      `.${path.basename(publicRoot) || "root"}${INTERNAL_STORE_ROOT}`,
    );
  }

  private getInternalObjectPath(key: string): string {
    return path.join(this.getInternalStorePath(), keyHash(key));
  }

  private isInternalStorePath(filePath: string): boolean {
    return isPathWithinBasePath(
      this.getInternalStorePath(),
      path.resolve(filePath),
    );
  }

  private getCommitPath(key: string): string {
    return path.join(this.getInternalObjectPath(key), COMMIT_FILE);
  }

  private getGenerationPath(
    key: string,
    generation: string,
    suffix: "body" | "meta.json",
  ): string {
    if (!GENERATION_ID_PATTERN.test(generation)) {
      throw new Error("Invalid BunStorage generation identifier");
    }
    return path.join(
      this.getInternalObjectPath(key),
      `${GENERATION_MARKER}${generation}.${suffix}`,
    );
  }

  private generationLeaseKey(key: string, generation: string): string {
    return `${keyHash(key)}:${generation}`;
  }

  private acquireGenerationLease(
    key: string,
    generation: string,
  ): () => Promise<void> {
    const leaseKey = this.generationLeaseKey(key, generation);
    this.generationReaders.set(
      leaseKey,
      (this.generationReaders.get(leaseKey) ?? 0) + 1,
    );
    let released = false;
    return async () => {
      if (released) return;
      released = true;
      const count = this.generationReaders.get(leaseKey) ?? 0;
      if (count <= 1) this.generationReaders.delete(leaseKey);
      else this.generationReaders.set(leaseKey, count - 1);
      // A writer may have deferred this generation while the reader held its
      // lease. Re-run conservative GC after release; failure is non-fatal and
      // startup recovery remains the final orphan cleanup authority. Queue the
      // pass so EOF never blocks behind another reader's identical scan.
      this.scheduleReclaim(key);
    };
  }

  private hasGenerationLease(key: string, generation: string): boolean {
    return (
      (this.generationReaders.get(this.generationLeaseKey(key, generation)) ??
        0) > 0
    );
  }

  private acquireKeyReadReservation(key: string): () => void {
    this.keyReadReservations.set(
      key,
      (this.keyReadReservations.get(key) ?? 0) + 1,
    );
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const count = this.keyReadReservations.get(key) ?? 0;
      if (count <= 1) this.keyReadReservations.delete(key);
      else this.keyReadReservations.set(key, count - 1);
    };
  }

  private hasKeyReadReservation(key: string): boolean {
    return (this.keyReadReservations.get(key) ?? 0) > 0;
  }

  private scheduleReclaim(key: string): void {
    const active = this.reclaimTasks.get(key);
    if (active) {
      // One trailing pass is enough to observe a lease released while the
      // current scan was in flight; never build one promise per reader.
      active.requested = true;
      return;
    }
    const state: { requested: boolean; promise: Promise<void> } = {
      requested: false,
      promise: Promise.resolve(),
    };
    state.promise = (async () => {
      state.requested = false;
      await this.reclaimUnreferencedGenerations(key).catch(() => undefined);
    })();
    this.reclaimTasks.set(key, state);
    void state.promise
      .finally(() => {
        if (this.reclaimTasks.get(key) === state) {
          this.reclaimTasks.delete(key);
        }
        if (state.requested) this.scheduleReclaim(key);
      })
      .catch(() => undefined);
  }

  private async createTempLease(
    objectPath: string,
    leaseId: string,
    kind: "generation" | "reader" = "generation",
  ): Promise<TempLease> {
    const marker = kind === "reader" ? READER_LEASE_MARKER : "";
    const leasePath = path.join(
      objectPath,
      `${TEMP_MARKER}${marker}${leaseId}.${LEASE_SUFFIX}`,
    );
    const leaseToken = crypto.randomUUID();
    const processIdentity = await getLocalLeaseProcessIdentity();
    const leaseOwner = JSON.stringify({
      version: 2,
      pid: process.pid,
      token: leaseToken,
      // A missing /proc identity is deliberately persisted as unknown. This
      // writer can still release its own inode/token, but a later process must
      // retain it for operator inspection rather than guess that it is dead.
      processIdentity: processIdentity ?? null,
    });
    let leaseHandle: FileHandle | undefined;
    let leaseIdentity: FileIdentity | undefined;
    try {
      leaseHandle = await open(leasePath, "wx");
      await writeBufferFully(leaseHandle, new TextEncoder().encode(leaseOwner));
      await leaseHandle.sync();
      leaseIdentity = fileIdentity(await leaseHandle.stat());
      await this.assertOwnedInternalFile(leasePath);
    } catch (error) {
      if (leaseHandle) await leaseHandle.close().catch(() => undefined);
      await this.unlinkOwnedInternalFile(leasePath);
      throw error;
    }

    const ownsLease = async (): Promise<boolean> => {
      if (!leaseHandle || !leaseIdentity) return false;
      let currentPathHandle: FileHandle | undefined;
      try {
        const heldIdentity = fileIdentity(await leaseHandle.stat());
        if (
          heldIdentity.nlink !== 1 ||
          heldIdentity.dev !== leaseIdentity.dev ||
          heldIdentity.ino !== leaseIdentity.ino ||
          heldIdentity.mode !== leaseIdentity.mode
        ) {
          return false;
        }
        const opened = await this.openOwnedInternalFile(leasePath);
        currentPathHandle = opened.handle;
        if (
          opened.identity.dev !== leaseIdentity.dev ||
          opened.identity.ino !== leaseIdentity.ino ||
          opened.identity.mode !== leaseIdentity.mode
        ) {
          return false;
        }
        return (await readFileHandleText(currentPathHandle)) === leaseOwner;
      } catch {
        return false;
      } finally {
        if (currentPathHandle) {
          await currentPathHandle.close().catch(() => undefined);
        }
      }
    };

    let released = false;
    const release = async () => {
      if (released) return;
      released = true;
      try {
        if (await ownsLease()) await this.unlinkOwnedInternalFile(leasePath);
      } finally {
        await leaseHandle?.close().catch(() => undefined);
        leaseHandle = undefined;
      }
    };
    return Object.assign(release, {
      async assertOwned(): Promise<void> {
        if (released || !(await ownsLease())) {
          throw new Error("BunStorage writer lease ownership lost");
        }
      },
    });
  }

  private async createReaderLease(key: string): Promise<TempLease | undefined> {
    const objectPath = this.getInternalObjectPath(key);
    try {
      await assertPathChainWithinBasePath(
        await this.getRealInternalStorePath(),
        objectPath,
        realpath,
      );
      await this.assertRealInternalDirectory(objectPath);
      return await this.createTempLease(
        objectPath,
        crypto.randomUUID(),
        "reader",
      );
    } catch (error) {
      if (isNotFoundError(error)) return undefined;
      throw error;
    }
  }

  private async isLiveTempLease(leasePath: string): Promise<boolean> {
    let leaseHandle: FileHandle | undefined;
    try {
      try {
        const opened = await this.openOwnedInternalFile(leasePath);
        leaseHandle = opened.handle;
      } catch (error) {
        if (isNotFoundError(error)) return false;
        reportUnknownLeaseRetention();
        return true;
      }

      const leaseOwner = parseLeaseOwner(await readFileHandleText(leaseHandle));
      if (!leaseOwner) {
        reportUnknownLeaseRetention();
        return true;
      }
      const state = await classifyLeaseOwner(
        leaseOwner,
        this.leaseProcessProbe,
      );
      if (state === "unknown") reportUnknownLeaseRetention();
      // Absence or a different start token is proof that this exact local
      // process incarnation is dead. Every other state is fail-safe retained.
      return state !== "dead";
    } catch {
      reportUnknownLeaseRetention();
      return true;
    } finally {
      if (leaseHandle) await leaseHandle.close().catch(() => undefined);
    }
  }

  private async liveTempLeases(
    objectPath: string,
    entries: Array<{ name: string; isDirectory(): boolean }>,
  ): Promise<LiveLeaseState> {
    const generations = new Set<string>();
    let reader = false;
    for (const entry of entries) {
      if (entry.isDirectory()) continue;
      const generationMatch = entry.name.match(
        /^tmp-([0-9a-f-]{16,})\.lease$/u,
      );
      const readerMatch = entry.name.match(
        /^tmp-reader-([0-9a-f-]{16,})\.lease$/u,
      );
      if (!generationMatch && !readerMatch) continue;
      const leasePath = path.join(objectPath, entry.name);
      if (await this.isLiveTempLease(leasePath)) {
        if (readerMatch) reader = true;
        else generations.add(generationMatch![1]!);
      } else {
        await this.unlinkOwnedInternalFile(leasePath);
      }
    }
    return { generations, reader };
  }

  private async hasLiveReaderLease(objectPath: string): Promise<boolean> {
    try {
      const entries = await readdir(objectPath, { withFileTypes: true });
      return (await this.liveTempLeases(objectPath, entries)).reader;
    } catch {
      return false;
    }
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

  private async getRealInternalStorePath(): Promise<string> {
    if (this.realInternalStorePath) {
      // Re-check the lexical root on every access. A rolling process or an
      // operator-side repair can replace the directory with a symlink after
      // startup; the cached realpath must not make that substitution trusted.
      await this.assertRealInternalDirectory(this.getInternalStorePath());
      return this.realInternalStorePath;
    }
    const internalRoot = this.getInternalStorePath();
    const internalParent = path.dirname(internalRoot);
    const realInternalParent = await realpath(internalParent);
    // The metadata namespace is allowed outside the public root, but it must
    // remain within the same trusted parent and may not be redirected through
    // a symlink to an unrelated filesystem location.
    await assertPathChainWithinBasePath(
      realInternalParent,
      internalRoot,
      realpath,
    );
    try {
      const rootStats = await lstat(internalRoot);
      if (rootStats.isSymbolicLink() || !rootStats.isDirectory()) {
        throw new Error("BunStorage metadata root must be a real directory");
      }
    } catch (error) {
      if (!isNotFoundError(error)) throw error;
    }
    await mkdir(internalRoot, { recursive: true });
    const createdRootStats = await lstat(internalRoot);
    if (createdRootStats.isSymbolicLink() || !createdRootStats.isDirectory()) {
      throw new Error("BunStorage metadata root must be a real directory");
    }
    await this.syncDirectory(internalParent);
    const resolvedRoot = await realpath(internalRoot);
    if (!isPathWithinBasePath(realInternalParent, resolvedRoot)) {
      throw new Error("BunStorage metadata path escapes its parent");
    }
    this.realInternalStorePath = resolvedRoot;
    return resolvedRoot;
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

  private async resolveExistingInternalPath(
    filePath: string,
  ): Promise<string | null> {
    try {
      const realPath = await realpath(filePath);
      const realInternalRoot = await this.getRealInternalStorePath();
      if (!isPathWithinBasePath(realInternalRoot, realPath)) {
        throw new Error("BunStorage metadata path escapes its root");
      }
      return realPath;
    } catch {
      return null;
    }
  }

  private async assertRealInternalDirectory(
    directoryPath: string,
  ): Promise<void> {
    const directoryStats = await lstat(directoryPath);
    if (directoryStats.isSymbolicLink() || !directoryStats.isDirectory()) {
      throw new Error("BunStorage internal path must be a real directory");
    }
  }

  /**
   * Open an adapter-owned regular file without following a final symlink or
   * accepting a hardlink to an external inode. The lstat/fstat identity check
   * closes the realpath-to-open replacement window; callers read through the
   * returned descriptor rather than reopening the path.
   */
  private async openOwnedRegularFile(
    filePath: string,
    rootPath: string,
  ): Promise<{ handle: FileHandle; identity: FileIdentity }> {
    await this.assertOwnedPathChain(rootPath, filePath);
    const before = await lstat(filePath);
    if (
      before.isSymbolicLink() ||
      !before.isFile() ||
      // During an atomic rename/unlink, Bun can expose the just-unlinked
      // inode as nlink=0 for one stat result. It is still safe to open only
      // when no additional link (nlink>1) is present.
      before.nlink < 0 ||
      before.nlink > 1
    ) {
      throw new Error("BunStorage file is not an owned regular file");
    }
    const expected = fileIdentity(before);
    let handle: FileHandle | undefined;
    try {
      handle = await open(filePath, OPEN_READ_FLAGS);
      const after = fileIdentity(await handle.stat());
      if (!isSameFileIdentity(expected, after)) {
        throw new Error("BunStorage file changed while opening");
      }
      // Re-check the path after opening as well.  O_NOFOLLOW protects the
      // final component, while this catches a parent-directory replacement
      // that happened between the initial containment check and open().
      await this.assertOwnedPathChain(rootPath, filePath, false);
      return { handle, identity: after };
    } catch (error) {
      if (handle) await handle.close().catch(() => undefined);
      throw error;
    }
  }

  /**
   * Internal files are adapter-owned, so every path component must be a real
   * directory/file rather than a symlink.  realpath containment alone is not
   * sufficient: a symlink can point to another in-root inode and still win a
   * later path lookup, and the final lstat/open pair has a TOCTOU window.
   */
  private async assertOwnedPathChain(
    rootPath: string,
    targetPath: string,
    includeTarget = true,
  ): Promise<void> {
    const root = path.resolve(rootPath);
    const target = path.resolve(targetPath);
    if (!isPathWithinBasePath(root, target)) {
      throw new Error("BunStorage path escapes its owned root");
    }
    const relativePath = path.relative(root, target);
    let current = root;
    const components = relativePath ? relativePath.split(path.sep) : [];
    if (!includeTarget) components.pop();
    for (const component of components) {
      current = path.join(current, component);
      const stats = await lstat(current);
      if (stats.isSymbolicLink()) {
        throw new Error("BunStorage internal path contains a symlink");
      }
    }
  }

  private async readOwnedInternalFileText(filePath: string): Promise<string> {
    const opened = await this.openOwnedInternalFile(filePath);
    try {
      return await readFileHandleText(opened.handle);
    } finally {
      await opened.handle.close().catch(() => undefined);
    }
  }

  private async readOwnedInternalFileMetadata(filePath: string): Promise<{
    contentType?: string;
  }> {
    return this.parseGenerationMetadata(
      await this.readOwnedInternalFileText(filePath),
    );
  }

  private async openOwnedInternalFile(
    filePath: string,
  ): Promise<{ handle: FileHandle; identity: FileIdentity }> {
    return this.openOwnedRegularFile(
      filePath,
      await this.getRealInternalStorePath(),
    );
  }

  private async assertOwnedRegularFile(
    filePath: string,
    rootPath: string,
  ): Promise<FileIdentity> {
    const opened = await this.openOwnedRegularFile(filePath, rootPath);
    await opened.handle.close();
    return opened.identity;
  }

  private async assertOwnedInternalFile(
    filePath: string,
  ): Promise<FileIdentity> {
    return this.assertOwnedRegularFile(
      filePath,
      await this.getRealInternalStorePath(),
    );
  }

  /**
   * Remove only an owned regular file. A symlink or hardlink is left in place
   * for recovery/security inspection rather than unlinking an unowned inode.
   */
  private async unlinkOwnedRegularFile(
    filePath: string,
    rootPath: string,
  ): Promise<void> {
    try {
      await this.assertOwnedRegularFile(filePath, rootPath);
    } catch (error) {
      if (isNotFoundError(error)) return;
      return;
    }
    await unlink(filePath).catch(() => undefined);
  }

  private async unlinkOwnedInternalFile(filePath: string): Promise<void> {
    await this.unlinkOwnedRegularFile(
      filePath,
      await this.getRealInternalStorePath(),
    );
  }

  private async recoverInternalStore(): Promise<void> {
    try {
      // Validate the sibling namespace before creating or traversing it. A
      // symlink at this exact path must never redirect recovery elsewhere.
      const resolvedRoot = await this.getRealInternalStorePath();
      const objectEntries = await readdir(resolvedRoot, {
        withFileTypes: true,
      });
      for (const objectEntry of objectEntries) {
        if (!DIGEST_PATTERN.test(objectEntry.name)) {
          continue;
        }
        const objectPath = path.join(resolvedRoot, objectEntry.name);
        await this.assertRealInternalDirectory(objectPath);
        const resolvedObjectPath =
          await this.resolveExistingInternalPath(objectPath);
        if (!resolvedObjectPath) continue;
        const files = await readdir(resolvedObjectPath, {
          withFileTypes: true,
        });
        const liveLeaseState = await this.liveTempLeases(
          resolvedObjectPath,
          files,
        );
        let objectKey: string | undefined;
        let retainedGeneration: string | null = null;
        try {
          const markerPath = path.join(resolvedObjectPath, COMMIT_FILE);
          const markerStats = await lstat(markerPath).catch(() => null);
          if (markerStats && markerStats.isFile() && markerStats.nlink === 1) {
            const record = JSON.parse(
              await this.readOwnedInternalFileText(markerPath),
            ) as Partial<CommitRecord>;
            if (
              record.version === 1 &&
              typeof record.key === "string" &&
              record.keyHash === objectEntry.name &&
              keyHash(record.key) === objectEntry.name
            ) {
              objectKey = record.key;
            }
            if (
              objectKey !== undefined &&
              record.state === "committed" &&
              typeof record.generation === "string" &&
              GENERATION_ID_PATTERN.test(record.generation)
            ) {
              const bodyPath = path.join(
                resolvedObjectPath,
                `${GENERATION_MARKER}${record.generation}.body`,
              );
              const metaPath = path.join(
                resolvedObjectPath,
                `${GENERATION_MARKER}${record.generation}.meta.json`,
              );
              try {
                const body = await this.openOwnedInternalFile(bodyPath);
                await body.handle.close();
                // Parse metadata during recovery so a partially-written or
                // corrupt sidecar cannot be retained as a live generation.
                await this.readGenerationMetadata(metaPath);
                retainedGeneration = record.generation;
              } catch {
                // Missing, symlinked, hardlinked, or corrupt generations are
                // not eligible to remain referenced by the marker.
              }
            }
          }
        } catch {
          retainedGeneration = null;
        }

        for (const entry of files) {
          if (entry.isDirectory()) continue;
          const leaseMatch = entry.name.match(/^tmp-([0-9a-f-]{16,})\.lease$/u);
          const readerLeaseMatch = entry.name.match(
            /^tmp-reader-([0-9a-f-]{16,})\.lease$/u,
          );
          if (leaseMatch || readerLeaseMatch) {
            if (
              (leaseMatch && liveLeaseState.generations.has(leaseMatch[1]!)) ||
              (readerLeaseMatch && liveLeaseState.reader)
            ) {
              continue;
            }
            await this.unlinkOwnedInternalFile(
              path.join(resolvedObjectPath, entry.name),
            );
            continue;
          }
          if (entry.name.startsWith(TEMP_MARKER)) {
            const tempGeneration = entry.name.match(
              /^tmp-([0-9a-f-]{16,})\./u,
            )?.[1];
            if (
              tempGeneration &&
              liveLeaseState.generations.has(tempGeneration)
            ) {
              continue;
            }
            await this.unlinkOwnedInternalFile(
              path.join(resolvedObjectPath, entry.name),
            );
            continue;
          }
          const generationMatch = entry.name.match(
            /^generation-([0-9a-f-]{16,})\.(?:body|meta\.json)$/u,
          );
          if (
            generationMatch &&
            generationMatch[1] !== retainedGeneration &&
            !liveLeaseState.generations.has(generationMatch[1]!) &&
            !liveLeaseState.reader
          ) {
            // Recovery can overlap a rolling writer. The marker and lease
            // values above are only scan snapshots: if a valid marker gave us
            // the object key, re-establish the same fresh deletion authority
            // used by steady-state GC immediately before unlinking.
            if (
              objectKey !== undefined &&
              !(await this.canReclaimGeneration(objectKey, generationMatch[1]!))
            ) {
              continue;
            }
            await this.unlinkOwnedInternalFile(
              path.join(resolvedObjectPath, entry.name),
            );
          }
        }
      }
    } catch (error) {
      // A storage directory can disappear between mkdir and recovery; the
      // first normal put will recreate its digest directory. Security and
      // namespace validation failures must remain observable instead of being
      // mistaken for an empty store.
      if (!isNotFoundError(error)) throw error;
    }
  }

  private async readCommitRecord(
    key: string,
    allowCachedFallback = true,
  ): Promise<CommitRecord | undefined> {
    const markerPath = this.getCommitPath(key);
    let markerObserved = false;
    let markerText: string | undefined;
    let lastNotFound: unknown;
    for (let attempt = 0; attempt < MARKER_READ_ATTEMPTS; attempt += 1) {
      let markerHandle: FileHandle | undefined;
      try {
        // Validate every existing path component before opening the marker.
        // This distinguishes a missing marker (normal legacy fallback) from a
        // symlinked internal namespace that escapes its sibling root.
        const opened = await this.openOwnedInternalFile(markerPath);
        markerHandle = opened.handle;
        markerObserved = true;
        // Read through an open descriptor. Resolving the path and then asking
        // Bun.file() to open it leaves a rename/unlink window where Bun can
        // retain a stale `(... deleted)` path; an FD is either the old
        // complete marker or the new complete marker after atomic rename.
        markerText = await readFileHandleText(markerHandle);
        break;
      } catch (error) {
        if (!isNotFoundError(error) && !isFileIdentityRace(error)) throw error;
        lastNotFound = error;
        try {
          const markerStats = await lstat(markerPath);
          if (
            markerStats.isSymbolicLink() ||
            !markerStats.isFile() ||
            markerStats.nlink < 0 ||
            markerStats.nlink > 1
          ) {
            throw new Error("BunStorage commit marker is not owned");
          }
          markerObserved = true;
        } catch (probeError) {
          if (!isNotFoundError(probeError)) throw probeError;
        }
        if (attempt + 1 < MARKER_READ_ATTEMPTS) {
          await yieldForFilesystem();
          continue;
        }
      } finally {
        if (markerHandle) await markerHandle.close().catch(() => undefined);
      }
    }
    if (markerText === undefined) {
      // A marker that was ever visible must not silently fall through to the
      // legacy path after a rename race. The caller's resolve loop will reread
      // the marker; a truly absent marker still enables legacy compatibility.
      const cached = this.lastCommitRecords.get(key);
      if (allowCachedFallback && cached && lastNotFound) return cached;
      // Reclamation must never act on a cached marker. An absent/racing marker
      // is insufficient authority to delete a generation; a later pass or
      // startup recovery can retry after the marker is readable.
      if (!allowCachedFallback && lastNotFound) throw lastNotFound;
      if (markerObserved && lastNotFound) throw lastNotFound;
      return undefined;
    }

    const record = JSON.parse(markerText) as Partial<CommitRecord>;
    if (
      record.version !== 1 ||
      typeof record.key !== "string" ||
      typeof record.keyHash !== "string" ||
      record.key !== key ||
      record.keyHash !== keyHash(key)
    ) {
      throw new Error("Invalid BunStorage commit marker identity");
    }
    if (record.state === "deleted" && record.generation === null) {
      this.lastCommitRecords.set(key, record as CommitRecord);
      return record as CommitRecord;
    }
    if (
      record.state !== "committed" ||
      typeof record.generation !== "string" ||
      !GENERATION_ID_PATTERN.test(record.generation)
    ) {
      throw new Error("Invalid BunStorage commit marker");
    }
    this.lastCommitRecords.set(key, record as CommitRecord);
    return record as CommitRecord;
  }

  private async readGenerationMetadata(metaPath: string): Promise<{
    contentType?: string;
  }> {
    return this.readOwnedInternalFileMetadata(metaPath);
  }

  private parseGenerationMetadata(valueText: string): {
    contentType?: string;
  } {
    return parseObjectMetadata(valueText);
  }

  private async readGenerationMetadataHandle(handle: FileHandle): Promise<{
    contentType?: string;
  }> {
    return this.parseGenerationMetadata(await readFileHandleText(handle));
  }

  private async resolveObject(
    key: string,
    withLease = false,
  ): Promise<ResolvedObject | null> {
    const releaseKeyRead = withLease
      ? this.acquireKeyReadReservation(key)
      : undefined;
    let readerLease: TempLease | undefined;
    const releaseReaderLease = async () => {
      const release = readerLease;
      readerLease = undefined;
      await release?.();
      if (release) this.scheduleReclaim(key);
    };
    try {
      if (withLease) readerLease = await this.createReaderLease(key);
      for (let attempt = 0; attempt < OBJECT_RESOLVE_ATTEMPTS; attempt += 1) {
        let commit: CommitRecord | undefined;
        try {
          commit = await this.readCommitRecord(key);
        } catch (error) {
          if (
            (isNotFoundError(error) || isFileIdentityRace(error)) &&
            attempt + 1 < OBJECT_RESOLVE_ATTEMPTS
          ) {
            await yieldForFilesystem();
            continue;
          }
          throw error;
        }
        if (commit) {
          if (commit.state === "deleted") return null;
          const generation = commit.generation;
          const generationLease = withLease
            ? this.acquireGenerationLease(key, generation)
            : undefined;
          let bodyHandle: FileHandle | undefined;
          let metadataHandle: FileHandle | undefined;
          let generationProtectionReleased = false;
          const releaseGenerationProtection = async () => {
            if (generationProtectionReleased) return;
            generationProtectionReleased = true;
            await generationLease?.();
          };
          let bodyReleased = false;
          const releaseBody = async () => {
            if (bodyReleased) return;
            bodyReleased = true;
            if (metadataHandle) {
              await metadataHandle.close().catch(() => undefined);
              metadataHandle = undefined;
            }
            if (bodyHandle) {
              await bodyHandle.close().catch(() => undefined);
              bodyHandle = undefined;
            }
          };
          const releaseAttempt = async () => {
            await releaseBody();
            await releaseGenerationProtection();
          };
          try {
            const filePath = this.getGenerationPath(key, generation, "body");
            const metaPath = this.getGenerationPath(
              key,
              generation,
              "meta.json",
            );
            const resolvedFilePath =
              await this.resolveExistingInternalPath(filePath);
            const resolvedMetaPath =
              await this.resolveExistingInternalPath(metaPath);
            if (!resolvedFilePath || !resolvedMetaPath) {
              await releaseAttempt();
              await yieldForFilesystem();
              continue;
            }

            if (withLease) {
              // Open both files before releasing the marker read. Once the body
              // descriptor is open, a concurrent unlink cannot invalidate this
              // read on POSIX; a missing path simply causes a bounded marker
              // reread/retry against the winning generation.  The owned-open
              // helper rejects hardlinks/symlinks and reads through the FD,
              // closing both the identity and path-swap windows.
              bodyHandle = (await this.openOwnedInternalFile(filePath)).handle;
              metadataHandle = (await this.openOwnedInternalFile(metaPath))
                .handle;
              const metadata =
                await this.readGenerationMetadataHandle(metadataHandle);
              await metadataHandle.close();
              metadataHandle = undefined;
              // Once the body FD is open and metadata is materialized, POSIX
              // unlink semantics keep those exact bytes readable without any
              // pathname lease. Release both local and cross-instance path
              // protection now so an undrained lazy stream cannot retain every
              // superseded generation or one lease FD per object lifetime.
              await releaseGenerationProtection();
              await releaseReaderLease();
              return {
                filePath: resolvedFilePath,
                bodyHandle,
                metadata,
                releaseBody,
              };
            }

            const openedBody = await this.openOwnedInternalFile(filePath);
            const openedMeta = await this.openOwnedInternalFile(metaPath);
            await openedBody.handle.close();
            await openedMeta.handle.close();
            const metadata =
              await this.readGenerationMetadata(resolvedMetaPath);
            await releaseGenerationProtection();
            return { filePath: resolvedFilePath, metadata };
          } catch (error) {
            await releaseAttempt();
            if (
              isNotFoundError(error) &&
              attempt + 1 < OBJECT_RESOLVE_ATTEMPTS
            ) {
              await yieldForFilesystem();
              continue;
            }
            throw error;
          }
        }

        // If the generation namespace exists but its marker was observed as
        // missing, an atomic rename may be between unlink and replacement.
        // Do not fall through to the legacy path (and return null) during that
        // churn; retry the marker read while the internal object directory is
        // present. A genuinely marker-less legacy object still falls through
        // after the bounded resolve attempts.
        if (withLease) {
          const internalObjectPath = this.getInternalObjectPath(key);
          if (
            (await this.resolveExistingInternalPath(internalObjectPath)) &&
            attempt + 1 < OBJECT_RESOLVE_ATTEMPTS
          ) {
            await yieldForFilesystem();
            continue;
          }
        }

        // Objects written by older BunStorage versions use the body + metadata
        // sidecar layout. Keep those reads working until the object is rewritten.
        const filePath = this.getFilePath(key);
        const resolvedFilePath = await this.resolveExistingPath(filePath);
        if (!resolvedFilePath) return null;
        const file = Bun.file(resolvedFilePath);
        if (!(await file.exists())) return null;
        if (withLease) {
          let bodyHandle: FileHandle | undefined;
          let metadataHandle: FileHandle | undefined;
          try {
            const openedBody = await this.openOwnedRegularFile(
              resolvedFilePath,
              await this.getRealBasePath(),
            );
            bodyHandle = openedBody.handle;
            const resolvedMetaPath = await this.resolveExistingPath(
              this.getMetaPath(key),
            );
            let metadata: ResolvedObject["metadata"] = {};
            if (resolvedMetaPath) {
              const openedMeta = await this.openOwnedRegularFile(
                resolvedMetaPath,
                await this.getRealBasePath(),
              );
              metadataHandle = openedMeta.handle;
              metadata = this.parseGenerationMetadata(
                await readFileHandleText(metadataHandle),
              );
              await metadataHandle.close();
              metadataHandle = undefined;
            }
            let released = false;
            const releaseBody = async () => {
              if (released) return;
              released = true;
              if (bodyHandle) {
                await bodyHandle.close().catch(() => undefined);
                bodyHandle = undefined;
              }
            };
            await releaseReaderLease();
            return {
              filePath: resolvedFilePath,
              bodyHandle,
              metadata,
              releaseBody,
            };
          } catch (error) {
            if (metadataHandle)
              await metadataHandle.close().catch(() => undefined);
            if (bodyHandle) await bodyHandle.close().catch(() => undefined);
            if (isNotFoundError(error) && attempt < 2) continue;
            throw error;
          }
        }
        const resolvedMetaPath = await this.resolveExistingPath(
          this.getMetaPath(key),
        );
        const metadata = resolvedMetaPath
          ? await readMetadata(resolvedMetaPath)
          : {};
        return { filePath: resolvedFilePath, metadata };
      }
      return null;
    } finally {
      releaseKeyRead?.();
      await releaseReaderLease();
    }
  }

  private async writeCommitRecord(
    key: string,
    record: CommitState,
  ): Promise<void> {
    const objectPath = this.getInternalObjectPath(key);
    await assertPathChainWithinBasePath(
      await this.getRealInternalStorePath(),
      objectPath,
      realpath,
    );
    await mkdir(objectPath, { recursive: true });
    await this.assertRealInternalDirectory(objectPath);
    await this.syncDirectory(path.dirname(objectPath));
    const markerPath = this.getCommitPath(key);
    const markerGeneration = crypto.randomUUID();
    const markerTempPath = path.join(
      objectPath,
      `${TEMP_MARKER}${markerGeneration}.commit.json`,
    );
    const releaseLease = await this.createTempLease(
      objectPath,
      markerGeneration,
    );
    const commitPayload: CommitRecord = {
      ...record,
      key,
      keyHash: keyHash(key),
    };
    let markerHandle: FileHandle | undefined;
    let markerTempCreated = false;
    try {
      markerHandle = await open(markerTempPath, "wx");
      markerTempCreated = true;
      await writeBufferFully(
        markerHandle,
        new TextEncoder().encode(JSON.stringify(commitPayload)),
      );
      await syncAndClose(markerHandle);
      markerHandle = undefined;
      await releaseLease.assertOwned();
      await this.beforeCommitRename?.(markerPath);
      await rename(markerTempPath, markerPath);
      // The marker rename is the publication point. Mark the temporary path
      // gone immediately so a subsequent directory-fsync error cannot make
      // finally misclassify the committed marker as unpublished.
      markerTempCreated = false;
      await this.syncDirectory(objectPath);
    } finally {
      if (markerHandle) await markerHandle.close().catch(() => undefined);
      if (markerTempCreated) await this.unlinkOwnedInternalFile(markerTempPath);
      await releaseLease();
    }
  }

  private async removeGenerationIfUnreferenced(
    key: string,
    generation: string | null | undefined,
  ): Promise<void> {
    if (generation && (await this.canReclaimGeneration(key, generation))) {
      for (const suffix of ["body", "meta.json"] as const) {
        // Re-establish authority for each unlink. A reader or delayed writer
        // can publish/acquire a lease after removal of the paired file starts;
        // leaving one orphan is safer than deleting a newly-current pair.
        if (!(await this.canReclaimGeneration(key, generation))) break;
        const filePath = this.getGenerationPath(key, generation, suffix);
        await this.unlinkOwnedInternalFile(filePath);
      }
    }
    await this.reclaimUnreferencedGenerations(key);
  }

  /**
   * Establish deletion authority for one generation without trusting a stale
   * marker snapshot.
   *
   * Writer ordering is lease -> generation files -> commit marker -> lease
   * release. Reader ordering is reader lease -> marker/open body -> lease
   * release. Checking both leases around an uncached marker read therefore
   * prevents GC from unlinking either the currently published generation or a
   * generation that an already-started reader can still reference.
   */
  private async canReclaimGeneration(
    key: string,
    generation: string,
  ): Promise<boolean> {
    if (
      this.activeGenerations.has(`${keyHash(key)}:${generation}`) ||
      this.hasGenerationLease(key, generation) ||
      this.hasKeyReadReservation(key)
    ) {
      return false;
    }

    const objectPath = this.getInternalObjectPath(key);
    const generationLeasePath = path.join(
      objectPath,
      `${TEMP_MARKER}${generation}.${LEASE_SUFFIX}`,
    );
    if (
      (await this.isLiveTempLease(generationLeasePath)) ||
      (await this.hasLiveReaderLease(objectPath))
    ) {
      return false;
    }

    let current: CommitRecord | undefined;
    try {
      current = await this.readCommitRecord(key, false);
    } catch {
      return false;
    }
    if (current?.state === "committed" && current.generation === generation) {
      return false;
    }

    // A reader can acquire its cross-instance lease immediately before the
    // authoritative marker read and still hold the previous generation after
    // a concurrent publication. Recheck after the marker decision closes that
    // window. Rechecking the writer lease keeps deletion fail-closed if a
    // generation lease was transiently unreadable during the first probe.
    return !(
      (await this.hasLiveReaderLease(objectPath)) ||
      (await this.isLiveTempLease(generationLeasePath))
    );
  }

  private async reclaimUnreferencedGenerations(key: string): Promise<void> {
    let current: CommitRecord | undefined;
    try {
      current = await this.readCommitRecord(key);
    } catch {
      // A malformed marker is fail-closed; startup recovery will handle it.
      return;
    }
    const retainedGeneration =
      current?.state === "committed" ? current.generation : null;
    const objectPath = this.getInternalObjectPath(key);
    const resolvedObjectPath =
      await this.resolveExistingInternalPath(objectPath);
    if (!resolvedObjectPath) return;
    let entries;
    try {
      entries = await readdir(resolvedObjectPath, { withFileTypes: true });
    } catch {
      return;
    }
    const liveLeaseState = await this.liveTempLeases(
      resolvedObjectPath,
      entries,
    );
    if (liveLeaseState.reader) return;
    for (const entry of entries) {
      if (entry.isDirectory()) continue;
      const generationMatch = entry.name.match(
        /^generation-([0-9a-f-]{16,})\.(?:body|meta\.json)$/u,
      );
      if (!generationMatch) continue;
      const generation = generationMatch[1]!;
      if (generation === retainedGeneration) continue;
      const activeKey = `${keyHash(key)}:${generation}`;
      // A writer may have renamed one or both generation files while its
      // commit marker is still pending. Preserve it until that writer has
      // either committed or cleaned up its temporary files.
      if (
        this.activeGenerations.has(activeKey) ||
        this.hasGenerationLease(key, generation) ||
        this.hasKeyReadReservation(key) ||
        liveLeaseState.generations.has(generation)
      ) {
        continue;
      }
      // `retainedGeneration` and `liveLeaseState` are scan snapshots. A writer
      // may publish and release its lease while this reclamation pass is in
      // flight, so re-establish current marker + lease authority immediately
      // before every destructive unlink.
      if (!(await this.canReclaimGeneration(key, generation))) continue;
      await this.unlinkOwnedInternalFile(
        path.join(resolvedObjectPath, entry.name),
      );
    }
    // A crashed local writer can leave body/metadata/marker temp files after
    // its exact owner incarnation is proved dead. Keep only temps belonging to
    // an active/retained generation; proved-unowned artifacts are reclaimed
    // during steady-state GC as well as startup recovery.
    for (const entry of entries) {
      if (entry.isDirectory() || !entry.name.startsWith(TEMP_MARKER)) {
        continue;
      }
      if (entry.name.endsWith(`.${LEASE_SUFFIX}`)) continue;
      const tempGeneration = entry.name.match(/^tmp-([0-9a-f-]{16,})\./u)?.[1];
      if (
        tempGeneration &&
        (this.activeGenerations.has(`${keyHash(key)}:${tempGeneration}`) ||
          this.hasGenerationLease(key, tempGeneration) ||
          this.hasKeyReadReservation(key) ||
          liveLeaseState.generations.has(tempGeneration))
      ) {
        continue;
      }
      await this.unlinkOwnedInternalFile(
        path.join(resolvedObjectPath, entry.name),
      );
    }
  }

  async put(
    key: string,
    value: ObjectStoreBody,
    options?: ObjectStorePutOptions,
  ): Promise<void> {
    // Serialize before touching the filesystem. A metadata-shape failure must
    // leave the currently committed generation completely untouched.
    const metadataPayload = JSON.stringify({
      contentType: options?.contentType,
      httpMetadata:
        options?.contentType === undefined
          ? undefined
          : { contentType: options.contentType },
    });
    const filePath = this.getFilePath(key);

    await assertPathChainWithinBasePath(
      await this.getRealBasePath(),
      filePath,
      realpath,
    );

    const internalObjectPath = this.getInternalObjectPath(key);
    await assertPathChainWithinBasePath(
      await this.getRealInternalStorePath(),
      internalObjectPath,
      realpath,
    );
    await mkdir(internalObjectPath, { recursive: true });
    await this.assertRealInternalDirectory(internalObjectPath);
    await this.syncDirectory(path.dirname(internalObjectPath));

    const previousCommit = await this.readCommitRecord(key);
    const previousGeneration =
      previousCommit?.state === "committed"
        ? previousCommit.generation
        : undefined;

    // Body and metadata are prepared as one generation. Readers only follow
    // the commit marker, which is atomically replaced after both files are
    // complete and synced. This prevents bytes from one writer pairing with
    // metadata from another writer.
    const generation = crypto.randomUUID();
    const generationPath = this.getGenerationPath(key, generation, "body");
    const generationMetaPath = this.getGenerationPath(
      key,
      generation,
      "meta.json",
    );
    const commitPath = this.getCommitPath(key);
    const bodyTempPath = path.join(
      internalObjectPath,
      `${TEMP_MARKER}${generation}.body`,
    );
    const metadataTempPath = path.join(
      internalObjectPath,
      `${TEMP_MARKER}${generation}.meta.json`,
    );
    const commitTempPath = path.join(
      internalObjectPath,
      `${TEMP_MARKER}${generation}.commit.json`,
    );
    const activeGenerationKey = `${keyHash(key)}:${generation}`;
    this.activeGenerations.add(activeGenerationKey);
    let releaseLease: TempLease | undefined;
    let bodyHandle: FileHandle | undefined;
    let metadataHandle: FileHandle | undefined;
    let commitHandle: FileHandle | undefined;
    let bodyTempCreated = false;
    let metadataTempCreated = false;
    let commitTempCreated = false;
    let bodyGenerationCreated = false;
    let metadataGenerationCreated = false;
    let commitPublished = false;
    try {
      releaseLease = await this.createTempLease(internalObjectPath, generation);
      bodyHandle = await open(bodyTempPath, "wx");
      bodyTempCreated = true;
      await writeValueToFile(bodyHandle, value);
      await syncAndClose(bodyHandle);
      bodyHandle = undefined;
      await rename(bodyTempPath, generationPath);
      await this.syncDirectory(internalObjectPath);
      bodyTempCreated = false;
      bodyGenerationCreated = true;

      metadataHandle = await open(metadataTempPath, "wx");
      metadataTempCreated = true;
      await writeBufferFully(
        metadataHandle,
        new TextEncoder().encode(metadataPayload),
      );
      await syncAndClose(metadataHandle);
      metadataHandle = undefined;
      await rename(metadataTempPath, generationMetaPath);
      await this.syncDirectory(internalObjectPath);
      metadataTempCreated = false;
      metadataGenerationCreated = true;

      const commitPayload: CommitRecord = {
        version: 1,
        key,
        keyHash: keyHash(key),
        state: "committed",
        generation,
      };
      commitHandle = await open(commitTempPath, "wx");
      commitTempCreated = true;
      await writeBufferFully(
        commitHandle,
        new TextEncoder().encode(JSON.stringify(commitPayload)),
      );
      await syncAndClose(commitHandle);
      commitHandle = undefined;
      // Publication is permitted only while this exact lease inode/token is
      // still owned. Recovery never expires a possibly-live owner solely by
      // age, so this assertion and the marker rename form the fencing edge:
      // a dead owner cannot resume, and a live owner cannot be reclaimed.
      await releaseLease.assertOwned();
      await this.beforeCommitRename?.(commitPath);
      await rename(commitTempPath, commitPath);
      // Rename makes the complete body+metadata generation authoritative.
      // Set both flags before fsync: if syncing the containing directory
      // fails, the marker still names a valid committed generation and must
      // never be deleted by the cleanup path below.
      commitTempCreated = false;
      commitPublished = true;
      await this.syncDirectory(internalObjectPath);
    } finally {
      if (bodyHandle) await bodyHandle.close().catch(() => undefined);
      if (metadataHandle) await metadataHandle.close().catch(() => undefined);
      if (commitHandle) await commitHandle.close().catch(() => undefined);
      if (!commitPublished) {
        if (bodyTempCreated) await this.unlinkOwnedInternalFile(bodyTempPath);
        if (metadataTempCreated)
          await this.unlinkOwnedInternalFile(metadataTempPath);
        if (commitTempCreated)
          await this.unlinkOwnedInternalFile(commitTempPath);
        if (bodyGenerationCreated)
          await this.unlinkOwnedInternalFile(generationPath);
        if (metadataGenerationCreated)
          await this.unlinkOwnedInternalFile(generationMetaPath);
      }
      this.activeGenerations.delete(activeGenerationKey);
      await releaseLease?.();
    }

    // Legacy body/sidecar files are no longer needed once the generation is
    // committed. Removing them is best-effort; the marker remains the source
    // of truth even if an operator-owned filesystem refuses cleanup.
    if (!this.isInternalStorePath(filePath)) {
      await unlink(filePath).catch(() => undefined);
    }
    const legacyMetaPath = this.getMetaPath(key);
    if (!this.isInternalStorePath(legacyMetaPath)) {
      await unlink(legacyMetaPath).catch(() => undefined);
    }
    await this.removeGenerationIfUnreferenced(key, previousGeneration);
  }

  async get(key: string): Promise<ObjectStoreObject | null> {
    let releaseBody: (() => Promise<void>) | undefined;
    let bodyHandedOff = false;
    try {
      const resolvedObject = await this.resolveObject(key, true);
      if (!resolvedObject) return null;
      releaseBody = resolvedObject.releaseBody;
      const metadata = resolvedObject.metadata;

      if (!resolvedObject.bodyHandle) {
        throw new Error("BunStorage object body is not open");
      }
      const byteLength = (await resolvedObject.bodyHandle.stat()).size;
      if (!Number.isSafeInteger(byteLength) || byteLength < 0) {
        throw new Error("invalid filesystem object size");
      }
      const body = createFileBodyStream(
        resolvedObject.bodyHandle,
        byteLength,
        async () => {
          await releaseBody?.();
          releaseBody = undefined;
        },
      );
      bodyHandedOff = true;

      return {
        key,
        body,
        contentType: metadata.contentType,
        byteLength,
      };
    } catch {
      return null;
    } finally {
      if (!bodyHandedOff) await releaseBody?.();
    }
  }

  async delete(key: string | readonly string[]): Promise<void> {
    const keys = Array.isArray(key) ? key : [key];
    for (const k of keys) {
      let markerPath: string;
      let legacyPath: string;
      let legacyMetaPath: string;
      try {
        markerPath = this.getCommitPath(k);
        legacyPath = this.getFilePath(k);
        legacyMetaPath = this.getMetaPath(k);
      } catch {
        // Preserve the historical delete contract: an invalid/traversal key
        // is ignored rather than becoming an observable filesystem error.
        continue;
      }
      try {
        await assertPathChainWithinBasePath(
          await this.getRealInternalStorePath(),
          markerPath,
          realpath,
        );
      } catch {
        // Do not create a tombstone through a symlinked path outside storage.
        continue;
      }
      const markerExists = await Bun.file(markerPath).exists();
      const legacyExists =
        !this.isInternalStorePath(legacyPath) &&
        (await Bun.file(legacyPath).exists());
      const legacyMetaExists =
        !this.isInternalStorePath(legacyMetaPath) &&
        (await Bun.file(legacyMetaPath).exists());
      if (!markerExists && !legacyExists && !legacyMetaExists) continue;

      let previousGeneration: string | undefined;
      try {
        const previousCommit = await this.readCommitRecord(k);
        previousGeneration =
          previousCommit?.state === "committed"
            ? previousCommit.generation
            : undefined;
      } catch {
        // A malformed marker is still replaced with a tombstone below; no
        // generation is trusted for eager cleanup in that case.
      }

      // Publish a tombstone before removing legacy files. If cleanup is
      // interrupted, the tombstone still prevents a stale legacy body from
      // resurfacing through the compatibility read path.
      await this.writeCommitRecord(k, {
        version: 1,
        state: "deleted",
        generation: null,
      });
      try {
        if (!this.isInternalStorePath(legacyPath)) {
          const filePath = await this.resolveExistingPath(legacyPath);
          if (filePath) await unlink(filePath);
        }
      } catch {
        /* ignore */
      }
      try {
        if (!this.isInternalStorePath(legacyMetaPath)) {
          const metaPath = await this.resolveExistingPath(legacyMetaPath);
          if (metaPath) await unlink(metaPath);
        }
      } catch {
        /* ignore */
      }
      await this.removeGenerationIfUnreferenced(k, previousGeneration);
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
    const spaFallbackEligible = !hasAssetExt && !isBackendPath(url.pathname);

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
