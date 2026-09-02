/**
 * The portable binding facades a Takoserver-hosted Worker receives.
 *
 * A Worker Version published through Takoform onto a Takoserver Host does not
 * get Cloudflare's native `KVNamespace` / `D1Database` / `Queue` / `R2Bucket`
 * objects. The Host's generated entrypoint replaces `env` with an object whose
 * bindings are the exact facades named by the Interface the Version declared —
 * `edge.kv@1.0.0`, `edge.sql@1.0.0`, `edge.queue@1.0.0`, `edge.objects@1.0.0`.
 * The managed Cloudflare backend and the self-host backend project the SAME
 * facade: same methods, same option keys, same error names. Takoserver's
 * ADR 0005 states this explicitly for object storage, and its self-host wrapper
 * repeats it for KV and SQL.
 *
 * This module is a TYPE MIRROR of that contract plus the structural probes the
 * lane selector uses. It deliberately contains no behaviour: the adapters that
 * map a facade onto this repo's runtime ports live in `edge-kv.ts`,
 * `edge-sql.ts`, `edge-queue.ts`, and `edge-objects.ts`.
 *
 * Source of truth (read, do not re-derive from memory):
 *   takoserver `src/providers/cloudflare-managed-worker-wrapper.ts`
 *     — `projectEnv`, `createKvAdapter`, `createSqlAdapter`,
 *       `createQueueAdapter`, `createEdgeObjectsR2Adapter`
 *   takoserver `src/providers/selfhost-worker-wrapper.ts`
 *     — `projectEnv`, `createKvAdapter`, `createSqlAdapter`
 *
 * Every method rejects with an `Error` whose `name` is the portable error code
 * (`invalid_key`, `invalid_value`, `value_too_large`, `metadata_too_large`,
 * `invalid_cursor`, `invalid_argument`, `sql_error`, `numeric_out_of_range`,
 * `busy`, `not_found`, `precondition_failed`, `range_not_satisfiable`,
 * `invalid_body`, `message_too_large`, `batch_too_large`, `invalid_part`,
 * `already_settled`, `backend_unavailable`). The adapters let those propagate
 * unchanged so a caller sees the Host's own vocabulary.
 */

/** Limits the facades enforce. Mirrored so the adapters can fail before the
 *  round-trip instead of surfacing an opaque `invalid_*` from the Host. */
export const EDGE_KV_MAX_KEY_BYTES = 467;
export const EDGE_KV_MAX_VALUE_BYTES = 26214400;
/** `expirationTtlSeconds` is rejected outside this range by both backends. */
export const EDGE_KV_MIN_EXPIRATION_TTL_SECONDS = 60;
export const EDGE_KV_MAX_EXPIRATION_TTL_SECONDS = 315360000;
export const EDGE_KV_MAX_LIST_LIMIT = 1000;
export const EDGE_SQL_MAX_STATEMENTS = 100;
export const EDGE_SQL_MAX_PARAMETERS = 100;
export const EDGE_SQL_MAX_ROWS = 10000;
export const EDGE_SQL_MAX_COLUMNS = 100;
export const EDGE_QUEUE_MAX_MESSAGES = 100;

/** A byte string on the wire. The facades never hand out raw `Uint8Array`. */
export interface EdgeEncodedBytes {
  readonly encoding: "base64";
  readonly data: string;
}

/** Exactly what `edge.sql` accepts as a bound parameter and returns in a row. */
export type EdgeSqlValue = null | number | string | EdgeEncodedBytes;

export interface EdgeSqlStatement {
  readonly sql: string;
  readonly params?: readonly EdgeSqlValue[];
}

/**
 * One statement's result. `rows` are RECORDS keyed by result-column name, not
 * positional arrays — the single most consequential difference from D1, and the
 * reason `edge-sql.ts` has to rewrite the projection list before it can hand
 * anything to Drizzle.
 */
export interface EdgeSqlResult {
  readonly rows: readonly Readonly<Record<string, EdgeSqlValue>>[];
  readonly rowsWritten: number;
}

/** `edge.sql@1.0.0`. */
export interface EdgeSqlBinding {
  execute(
    sql: string,
    params?: readonly EdgeSqlValue[],
  ): Promise<EdgeSqlResult>;
  /** `execute` restricted to statements that write nothing. */
  query(sql: string, params?: readonly EdgeSqlValue[]): Promise<EdgeSqlResult>;
  /** All-or-none. 1..100 statements, ordered, one Host round trip. */
  transaction(
    statements: readonly EdgeSqlStatement[],
  ): Promise<readonly EdgeSqlResult[]>;
}

export interface EdgeKvPutOptions {
  readonly expirationTtlSeconds?: number;
  /** String values only; the Host projects a record of strings. */
  readonly metadata?: Record<string, string>;
}

export interface EdgeKvListOptions {
  readonly prefix?: string;
  readonly cursor?: string;
  readonly limit?: number;
}

/**
 * A listed key carries its NAME ONLY. Neither backend returns the expiration or
 * the metadata it stored, so `IKeyValueStore.list` reports those as absent on
 * this lane.
 */
export interface EdgeKvListResult {
  readonly keys: readonly { readonly name: string }[];
  readonly listComplete: boolean;
  readonly cursor?: string;
}

/** `edge.kv@1.0.0`. Values are always bytes; there is no `type` option. */
export interface EdgeKvBinding {
  get(key: string): Promise<ArrayBuffer | null>;
  getWithMetadata(key: string): Promise<{
    readonly value: ArrayBuffer;
    readonly metadata?: Record<string, string>;
  } | null>;
  put(
    key: string,
    value: string | ArrayBuffer | ArrayBufferView,
    options?: EdgeKvPutOptions,
  ): Promise<void>;
  delete(key: string): Promise<void>;
  list(options?: EdgeKvListOptions): Promise<EdgeKvListResult>;
}

export interface EdgeQueueSendOptions {
  readonly delaySeconds?: number;
}

export interface EdgeQueueBatchItem {
  readonly body: string | ArrayBuffer | ArrayBufferView;
  readonly delaySeconds?: number;
}

/**
 * `edge.queue@1.0.0` producer. Bodies are BYTES — there is no structured-clone
 * path, so a JavaScript object has to be serialized by the caller. `send`
 * returns the Host's acceptance id, which is not a provider dedupe id.
 */
export interface EdgeQueueBinding {
  send(
    body: string | ArrayBuffer | ArrayBufferView,
    options?: EdgeQueueSendOptions,
  ): Promise<string>;
  sendBatch(
    messages: readonly EdgeQueueBatchItem[],
  ): Promise<readonly string[]>;
}

/** One message as the Host hands it to a declared `queue` handler. */
export interface EdgeQueueMessage {
  readonly id: string;
  readonly timestampMillis: number;
  readonly attempts: number;
  readonly body: EdgeEncodedBytes;
  acknowledge(): void;
  /** `delaySeconds`, when given, must be >= 1. */
  retry(options?: { readonly delaySeconds?: number }): void;
}

export interface EdgeQueueBatch {
  readonly batchId: string;
  readonly queue: string;
  readonly messages: readonly EdgeQueueMessage[];
  acknowledgeAll(): void;
  retryAll(options?: { readonly delaySeconds?: number }): void;
}

export interface EdgeObjectMetadata {
  readonly etag: string;
  readonly size: number;
  readonly contentType?: string;
  readonly uploadedAtMillis?: number;
}

export interface EdgeObjectBody extends EdgeObjectMetadata {
  readonly body: ReadableStream;
  readonly partial: boolean;
  readonly range?: { readonly offset: number; readonly length: number };
}

export interface EdgeObjectListResult {
  readonly objects: readonly (EdgeObjectMetadata & { readonly key: string })[];
  readonly prefixes: readonly string[];
  readonly truncated: boolean;
  readonly cursor?: string;
}

/**
 * `edge.objects@1.0.0`. Note the fixed arities — the Host counts
 * `arguments.length`, so `get(key)` with one argument is a type error and the
 * adapter must pass `undefined` explicitly. There is no `customMetadata`, and a
 * streaming `put` requires `contentLength`.
 */
export interface EdgeObjectsBinding {
  head(key: string): Promise<EdgeObjectMetadata | null>;
  get(
    key: string,
    options:
      undefined | { readonly range?: { offset: number; length?: number } },
  ): Promise<EdgeObjectBody | null>;
  put(
    key: string,
    body: string | ArrayBuffer | ArrayBufferView | ReadableStream,
    options:
      | undefined
      | {
          readonly contentLength?: number;
          readonly contentType?: string;
        },
  ): Promise<{ readonly etag: string; readonly size: number }>;
  delete(key: string): Promise<void>;
  list(
    options:
      | undefined
      | {
          readonly prefix?: string;
          readonly delimiter?: string;
          readonly cursor?: string;
          readonly limit?: number;
        },
  ): Promise<EdgeObjectListResult>;
}

function hasMethods(value: unknown, names: readonly string[]): boolean {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  for (const name of names) {
    if (typeof record[name] !== "function") return false;
  }
  return true;
}

/**
 * Structural probes.
 *
 * Only SOME bindings can be told apart by shape, and the difference matters:
 *
 *   decisive   `DB`     — `execute`/`query`/`transaction` (facade) against
 *                         `prepare`/`batch` (D1). Disjoint method sets.
 *   decisive   `MEDIA`  — R2 carries the multipart helpers the facade omits.
 *   decisive   a queue *batch* — `acknowledgeAll` (facade) against `ackAll`
 *                         (Cloudflare `MessageBatch`).
 *   AMBIGUOUS  `KV`     — `edge.kv` and `KVNamespace` expose the same five
 *                         method names.
 *   AMBIGUOUS  a queue *producer* — both are `send`/`sendBatch`.
 *
 * That is why the lane is a DECLARED variable rather than something sniffed:
 * two of the five bindings cannot be identified at all. The declaration is then
 * cross-checked against the decisive bindings, so a Worker whose var and whose
 * bindings disagree refuses to start instead of calling `kv.get(key, {type})`
 * on a facade that would silently treat the options object as nothing.
 */
export function isEdgeSqlBinding(value: unknown): value is EdgeSqlBinding {
  return (
    hasMethods(value, ["execute", "query", "transaction"]) &&
    typeof (value as Record<string, unknown>).prepare !== "function"
  );
}

/** Cloudflare's `D1Database` is the `prepare`/`batch`/`exec` shape. */
export function isNativeD1Database(value: unknown): boolean {
  return (
    hasMethods(value, ["prepare", "batch"]) &&
    typeof (value as Record<string, unknown>).execute !== "function"
  );
}

export function isEdgeQueueBatch(value: unknown): value is EdgeQueueBatch {
  return (
    hasMethods(value, ["acknowledgeAll", "retryAll"]) &&
    Array.isArray((value as Record<string, unknown>).messages)
  );
}

export function isEdgeObjectsBinding(
  value: unknown,
): value is EdgeObjectsBinding {
  return (
    hasMethods(value, ["head", "get", "put", "delete", "list"]) &&
    // R2 exposes multipart helpers on the binding itself; the facade does not
    // give a bucket-shaped object those names.
    typeof (value as Record<string, unknown>).createMultipartUpload !==
      "function" &&
    // An already-adapted `IObjectStorage` has the same five names. The facade
    // is told apart by arity, which is part of its contract: the Host checks
    // `arguments.length`, so `get` and `list` take their options slot even when
    // it is `undefined`, while the port's `get(key)` takes one argument.
    (value as { get: (...args: unknown[]) => unknown }).get.length === 2
  );
}

/** Cloudflare's `R2Bucket`. */
export function isNativeR2Bucket(value: unknown): boolean {
  return hasMethods(value, [
    "head",
    "get",
    "put",
    "delete",
    "list",
    "createMultipartUpload",
  ]);
}

/** Decode one `{encoding:"base64"}` value into bytes. */
export function decodeEdgeBytes(value: EdgeEncodedBytes): Uint8Array {
  const binary = atob(value.data);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

/** Encode bytes into the facade's wire value. */
export function encodeEdgeBytes(bytes: Uint8Array): EdgeEncodedBytes {
  let binary = "";
  // Chunked so a large blob does not blow the argument limit of `apply`.
  const CHUNK = 0x8000;
  for (let index = 0; index < bytes.length; index += CHUNK) {
    binary += String.fromCharCode(
      ...bytes.subarray(index, Math.min(index + CHUNK, bytes.length)),
    );
  }
  return { encoding: "base64", data: btoa(binary) };
}

export function isEdgeEncodedBytes(value: unknown): value is EdgeEncodedBytes {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as EdgeEncodedBytes).encoding === "base64" &&
    typeof (value as EdgeEncodedBytes).data === "string"
  );
}
