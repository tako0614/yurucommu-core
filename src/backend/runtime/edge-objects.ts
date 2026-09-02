/**
 * `edge.objects@1.0.0` → an R2-shaped bucket, and → {@link ObjectStore}.
 *
 * ## What the Host hands over, and what R2 hands over
 *
 * Takoserver's facade is method-for-method a bucket (`head`, `get`, `put`,
 * `delete`, `list`, plus the four multipart calls), which is the whole point of
 * the Interface: an app written against R2 is supposed to port over unchanged.
 * The RESULT objects were not: the facade's `get()` answers with a plain record
 * of `{etag, size, contentType?, body, partial, range?}`, while a native
 * `R2ObjectBody` also carries `text()`, `json()`, `arrayBuffer()`, `blob()`,
 * `key`, `httpEtag`, `uploaded`, `httpMetadata` and `writeHttpMetadata()`. So
 * the facade WAS distinguishable from R2 — by exactly the members an app is
 * most likely to reach for. `await (await env.MEDIA.get(k)).text()`, which is
 * legal R2, threw `o.text is not a function` on the portable lane.
 *
 * The wire contract is Takoserver's (ADR 0005) and does not move. This module
 * closes the gap on THIS side: {@link EdgeObjectsBucket} wraps the binding and
 * returns objects that carry R2's members, so R2-shaped app code compiles and
 * runs against either host.
 *
 * ## The parity rule
 *
 * PROVIDED, with R2's names and R2's semantics: `key`, `size`, `etag`,
 * `httpEtag`, `httpMetadata`, `customMetadata`, `range`, `writeHttpMetadata()`,
 * and on a body answer `body`, `bodyUsed`, `arrayBuffer()`, `text()`, `json()`,
 * `blob()`. The four body helpers and `bodyUsed` are a real `Response`'s, so a
 * second read REJECTS with a `TypeError` exactly as R2's do rather than
 * replaying a cached value, and reading `body` directly also marks the object
 * used.
 *
 * BEST EFFORT: `uploaded`. The Host's `head` and `list` carry
 * `uploadedAtMillis`, so it is a `Date` there. Its `get` and `put` do NOT —
 * both Takoserver wrapper backends build their answer without it on purpose —
 * so it is `undefined` there rather than invented. It is `Date | undefined`
 * everywhere so one type describes all four.
 *
 * NOT PROVIDED, because the wire carries nothing to derive them from:
 * `version`, `checksums`, `storageClass`. `customMetadata` is present and
 * always `undefined`: ADR 0005 gives `edge.objects` no custom metadata at all,
 * so "absent" is the true answer rather than a missing member.
 *
 * `etag` is the Host's etag VERBATIM and is opaque: the self-host wrapper sends
 * a bare hex digest (R2's unquoted `etag` spelling) and the managed wrapper
 * forwards R2's quoted `httpEtag`. This facade does not rewrite it, because
 * that value is what every conditional request on either host must echo back.
 * `httpEtag` is derived: the same value, quoted when it was not already, which
 * is the header-safe spelling R2 guarantees.
 *
 * ## The narrow spots of the facade itself, which parity does not widen
 *
 *  - NO CUSTOM METADATA. Only `contentType` survives a round trip, which is
 *    also all the provider-neutral {@link ObjectStorePutOptions} carries.
 *  - FIXED ARITIES. The Host counts `arguments.length`, so every call passes
 *    its full argument list even when the options slot is absent.
 *  - A STREAMING `put` NEEDS `contentLength`. ADR 0005 is explicit that a Host
 *    enforces the declared count while streaming and never buffers a body to
 *    discover its size. Every body shape but a bare `ReadableStream` already
 *    knows its length — a `Blob` (the shape media uploads hand over), an
 *    `ArrayBuffer`, a string — so the length is declared and the bytes stream
 *    through. A stream that arrives without a knowable length is buffered
 *    HERE, in the Worker, which is the honest cost of not knowing the size.
 *  - `delete` TAKES ONE KEY. The bucket's array form becomes a sequence of
 *    calls, which is not atomic — the same as R2's, which also has no
 *    transaction.
 *  - AN UNRANGED `get` MUST NOT BE PARTIAL. A truncated body served as a whole
 *    object is a silent corruption, so the bytes are dropped and the call
 *    throws.
 *
 * AVAILABILITY: BOTH wrapper backends project `edge.objects`. The managed
 * Cloudflare backend does it over provider-private R2
 * (`createEdgeObjectsR2Adapter`); the self-host backend realizes its own object
 * store for a Version's `bucketBindings` and projects the same facade, byte for
 * byte. A Worker on the `portable` lane therefore receives `env.MEDIA` on
 * either host. What still leaves `MEDIA` unbound is a Version that declared no
 * bucket at all, and the core's existing "object storage unavailable" (503)
 * behaviour is what applies then.
 */

import type {
  ObjectStore,
  ObjectStoreBody,
  ObjectStoreObject,
  ObjectStorePutOptions,
} from "./types.ts";
import type {
  EdgeObjectBody,
  EdgeObjectMetadata,
  EdgeObjectsBinding,
} from "./edge-facades.ts";
import { readStream } from "./shared.ts";

/** A request or response the facade cannot express. */
export class EdgeObjectsShapeError extends TypeError {
  constructor(message: string) {
    super(message);
    this.name = "EdgeObjectsShapeError";
  }
}

/**
 * R2's `R2HTTPMetadata`, restricted to the one field `edge.objects` carries.
 *
 * The other five R2 fields (`contentLanguage`, `contentDisposition`,
 * `contentEncoding`, `cacheControl`, `cacheExpiry`) are absent on every answer
 * because the Interface never accepted them on `put`.
 */
export interface EdgeObjectHttpMetadata {
  readonly contentType?: string;
}

/** A byte range the Host actually served, in R2's `R2Range` spelling. */
export interface EdgeObjectRange {
  readonly offset: number;
  readonly length: number;
}

/**
 * R2's `R2Object` over `edge.objects@1.0.0`: what `head`, `put` and a `list`
 * entry answer with.
 */
export interface EdgeR2Object {
  readonly key: string;
  readonly size: number;
  /** The Host's etag verbatim. Opaque; quoting differs by backend. */
  readonly etag: string;
  /** The same etag in R2's header-safe quoted spelling. */
  readonly httpEtag: string;
  /** A `Date` on `head` and `list`; `undefined` on `get` and `put`. */
  readonly uploaded: Date | undefined;
  readonly httpMetadata: EdgeObjectHttpMetadata;
  /** Always `undefined`: `edge.objects` has no custom metadata (ADR 0005). */
  readonly customMetadata: undefined;
  /** Present only on a ranged `get`. */
  readonly range?: EdgeObjectRange;
  /** Writes the metadata this object carries onto response headers. */
  writeHttpMetadata(headers: Headers): void;
}

/** R2's `R2ObjectBody`: an {@link EdgeR2Object} whose bytes came with it. */
export interface EdgeR2ObjectBody extends EdgeR2Object {
  readonly body: ReadableStream<Uint8Array>;
  readonly bodyUsed: boolean;
  arrayBuffer(): Promise<ArrayBuffer>;
  text(): Promise<string>;
  json<T = unknown>(): Promise<T>;
  blob(): Promise<Blob>;
}

/** R2's `R2Objects`: one page of {@link EdgeObjectsBucket.list}. */
export interface EdgeR2Objects {
  readonly objects: readonly EdgeR2Object[];
  readonly truncated: boolean;
  readonly cursor?: string;
  /** R2's name for the common prefixes a `delimiter` collapsed. */
  readonly delimitedPrefixes: readonly string[];
}

export interface EdgeObjectsGetOptions {
  readonly range?: { readonly offset: number; readonly length?: number };
}

export interface EdgeObjectsListOptions {
  readonly prefix?: string;
  readonly delimiter?: string;
  readonly cursor?: string;
  readonly limit?: number;
}

/** R2 quotes its `httpEtag`; the Host's etag may or may not already be quoted. */
function httpEtagOf(etag: string): string {
  if (etag.length >= 2 && etag.startsWith('"') && etag.endsWith('"')) {
    return etag;
  }
  return `"${etag}"`;
}

function writeContentType(
  contentType: string | undefined,
  headers: Headers,
): void {
  // R2 writes only the fields its `httpMetadata` actually holds, so an object
  // stored without a content type leaves the caller's headers alone.
  if (contentType !== undefined) headers.set("content-type", contentType);
}

/**
 * R2's `R2Object`. Metadata only: `head`, `put` and every `list` entry.
 */
class EdgeR2ObjectMetadata implements EdgeR2Object {
  readonly key: string;
  readonly size: number;
  readonly etag: string;
  readonly httpEtag: string;
  readonly uploaded: Date | undefined;
  readonly httpMetadata: EdgeObjectHttpMetadata;
  readonly customMetadata: undefined = undefined;
  readonly range?: EdgeObjectRange;

  constructor(
    key: string,
    metadata: {
      readonly etag: string;
      readonly size: number;
      readonly contentType?: string;
      readonly uploadedAtMillis?: number;
    },
    range?: EdgeObjectRange,
  ) {
    this.key = key;
    this.size = metadata.size;
    this.etag = metadata.etag;
    this.httpEtag = httpEtagOf(metadata.etag);
    this.uploaded =
      metadata.uploadedAtMillis === undefined
        ? undefined
        : new Date(metadata.uploadedAtMillis);
    this.httpMetadata =
      metadata.contentType === undefined
        ? {}
        : { contentType: metadata.contentType };
    if (range !== undefined) this.range = range;
  }

  writeHttpMetadata(headers: Headers): void {
    writeContentType(this.httpMetadata.contentType, headers);
  }
}

/**
 * R2's `R2ObjectBody`.
 *
 * The bytes are held in a `Response`, which is where the body semantics come
 * from rather than being re-implemented: `bodyUsed` flips the moment the stream
 * is disturbed — including by a caller that read `body` itself — and a second
 * `text()` / `json()` / `arrayBuffer()` / `blob()` REJECTS with a `TypeError`
 * instead of replaying the first read. That is R2's own behaviour (workerd's
 * `R2ObjectBody` refuses a disturbed body the same way the `Body` mixin does),
 * so a caller cannot tell the two apart by consuming twice.
 */
class EdgeR2ObjectWithBody
  extends EdgeR2ObjectMetadata
  implements EdgeR2ObjectBody
{
  readonly #response: Response;

  constructor(
    key: string,
    metadata: {
      readonly etag: string;
      readonly size: number;
      readonly contentType?: string;
      readonly uploadedAtMillis?: number;
    },
    body: ReadableStream<Uint8Array>,
    range?: EdgeObjectRange,
  ) {
    super(key, metadata, range);
    // The content type rides along so `blob()` answers with a typed Blob, the
    // way a Blob read off any other HTTP body does.
    this.#response = new Response(
      body as unknown as BodyInit,
      metadata.contentType === undefined
        ? undefined
        : { headers: { "content-type": metadata.contentType } },
    );
  }

  get body(): ReadableStream<Uint8Array> {
    // A `Response` built from a stream always has one.
    return this.#response.body as ReadableStream<Uint8Array>;
  }

  get bodyUsed(): boolean {
    return this.#response.bodyUsed;
  }

  arrayBuffer(): Promise<ArrayBuffer> {
    return this.#response.arrayBuffer();
  }

  text(): Promise<string> {
    return this.#response.text();
  }

  json<T = unknown>(): Promise<T> {
    return this.#response.json() as Promise<T>;
  }

  blob(): Promise<Blob> {
    return this.#response.blob();
  }
}

/**
 * The byte length of a body the Host can be told up front, or `undefined` for
 * a bare stream whose size only the producer knows.
 */
function knownBodyLength(value: ObjectStoreBody): number | undefined {
  if (value instanceof Blob) return value.size;
  if (value instanceof ArrayBuffer) return value.byteLength;
  if (typeof value === "string") {
    return new TextEncoder().encode(value).byteLength;
  }
  return undefined;
}

/**
 * `edge.objects@1.0.0` as a bucket whose answers are R2's.
 *
 * The calls are the facade's (its option names, its ceilings, its error
 * vocabulary); the results are R2-shaped, so app code written against
 * `R2Bucket` reads them unchanged. See the parity rule at the top of this file
 * for what is provided, what is best effort, and what the wire cannot supply.
 */
export class EdgeObjectsBucket {
  constructor(private readonly binding: EdgeObjectsBinding) {}

  async head(key: string): Promise<EdgeR2Object | null> {
    const found: EdgeObjectMetadata | null = await this.binding.head(key);
    if (!found) return null;
    return new EdgeR2ObjectMetadata(key, found);
  }

  async get(
    key: string,
    options?: EdgeObjectsGetOptions,
  ): Promise<EdgeR2ObjectBody | null> {
    const range = options?.range;
    // Fixed arity: the Host counts `arguments.length`, so the options slot is
    // always passed, even when it is empty.
    const found: EdgeObjectBody | null = await this.binding.get(
      key,
      range === undefined ? undefined : { range },
    );
    if (!found) return null;
    if (found.partial && range === undefined) {
      // No range was asked for, so a partial body would be a truncated object
      // served as if it were whole. Refuse rather than hand the caller bytes
      // that do not add up to the object.
      await found.body.cancel().catch(() => undefined);
      throw new EdgeObjectsShapeError(
        "edge.objects: the Host returned a partial body for an unranged get",
      );
    }
    return new EdgeR2ObjectWithBody(
      key,
      found,
      found.body as ReadableStream<Uint8Array>,
      found.range,
    );
  }

  async put(
    key: string,
    value: ObjectStoreBody,
    options?: ObjectStorePutOptions,
  ): Promise<EdgeR2Object> {
    const contentType = options?.contentType;
    let contentLength = knownBodyLength(value);
    // The facade's body slot has no `Blob`. A Blob's stream carries the same
    // bytes and its size is already known, so it goes over as a declared-length
    // stream rather than being buffered.
    let body: string | ArrayBuffer | Uint8Array | ReadableStream =
      value instanceof Blob ? value.stream() : value;
    if (contentLength === undefined) {
      // No knowable length and a stream: the size has to come from somewhere,
      // and the Host will not discover it. Buffering is the only remaining
      // option, so it happens where the memory cost is visible.
      const buffered = await readStream(body as ReadableStream<Uint8Array>);
      body = buffered;
      contentLength = buffered.byteLength;
    }
    const stored = await this.binding.put(key, body, {
      contentLength,
      ...(contentType === undefined ? {} : { contentType }),
    });
    // The Host's `put` answers with `{etag, size}` and nothing else, so the
    // returned object's `uploaded` is absent — see the parity rule above.
    return new EdgeR2ObjectMetadata(key, {
      etag: stored.etag,
      size: stored.size,
      ...(contentType === undefined ? {} : { contentType }),
    });
  }

  async delete(key: string | readonly string[]): Promise<void> {
    const keys = typeof key === "string" ? [key] : [...new Set(key)];
    for (const one of keys) await this.binding.delete(one);
  }

  async list(options?: EdgeObjectsListOptions): Promise<EdgeR2Objects> {
    const page = await this.binding.list(options);
    return {
      objects: page.objects.map(
        (entry) => new EdgeR2ObjectMetadata(entry.key, entry),
      ),
      truncated: page.truncated,
      ...(page.cursor === undefined ? {} : { cursor: page.cursor }),
      // R2 calls the common prefixes a delimiter collapsed `delimitedPrefixes`.
      delimitedPrefixes: page.prefixes,
    };
  }
}

/**
 * The provider-neutral {@link ObjectStore} over the same bucket.
 *
 * This is the port the core's own routes speak, and it stays deliberately
 * narrower than R2 — flat metadata, no enumeration, no separate head — so app
 * code does not grow a dependency on a vendor object shape. Code that WANTS R2
 * takes {@link EdgeObjectsBucket} instead; both run the same adapter, so the
 * media path proves it.
 */
export class EdgeObjectStorage implements ObjectStore {
  readonly #bucket: EdgeObjectsBucket;

  constructor(bucket: EdgeObjectsBinding) {
    this.#bucket = new EdgeObjectsBucket(bucket);
  }

  async put(
    key: string,
    value: ObjectStoreBody,
    options?: ObjectStorePutOptions,
  ): Promise<void> {
    await this.#bucket.put(key, value, options);
  }

  async get(key: string): Promise<ObjectStoreObject | null> {
    const found = await this.#bucket.get(key);
    if (!found) return null;
    return {
      key: found.key,
      body: found.body,
      ...(found.httpMetadata.contentType === undefined
        ? {}
        : { contentType: found.httpMetadata.contentType }),
      etag: found.etag,
      byteLength: found.size,
    };
  }

  async delete(key: string | readonly string[]): Promise<void> {
    await this.#bucket.delete(key);
  }
}

/** Wrap an `edge.objects@1.0.0` binding as an R2-shaped bucket. */
export function wrapEdgeObjectsAsBucket(
  bucket: EdgeObjectsBinding,
): EdgeObjectsBucket {
  return new EdgeObjectsBucket(bucket);
}

/** Wrap an `edge.objects@1.0.0` binding as the provider-neutral port. */
export function wrapEdgeObjects(bucket: EdgeObjectsBinding): ObjectStore {
  return new EdgeObjectStorage(bucket);
}
