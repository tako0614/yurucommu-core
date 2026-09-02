/**
 * `edge.objects@1.0.0` → {@link ObjectStore}.
 *
 * The facade is deliberately narrower than R2, and the narrow spots are the
 * interesting ones:
 *
 *  - NO CUSTOM METADATA. Only `contentType` survives a round trip, which is
 *    also all the provider-neutral {@link ObjectStorePutOptions} carries.
 *  - FIXED ARITIES. The Host counts `arguments.length`, so `get` and `put` are
 *    always called with their full argument list even when the options are
 *    absent.
 *  - A STREAMING `put` NEEDS `contentLength`. ADR 0005 is explicit that a Host
 *    enforces the declared count while streaming and never buffers a body to
 *    discover its size. Every body shape but a bare `ReadableStream` already
 *    knows its length — a `Blob` (the shape media uploads hand over), an
 *    `ArrayBuffer`, a string — so the length is declared and the bytes stream
 *    through. A stream that arrives without a knowable length is buffered
 *    HERE, in the Worker, which is the honest cost of not knowing the size.
 *  - `delete` TAKES ONE KEY. The port's array form becomes a sequence of calls,
 *    which is not atomic — the same as R2's, which also has no transaction.
 *  - NO ENUMERATION OR HEAD. The port does not carry them, so neither does the
 *    adapter, even though the Host projects both.
 *
 * AVAILABILITY: `edge.objects` is projected by the managed Cloudflare backend
 * (`createEdgeObjectsR2Adapter`). The self-host backend projects only
 * `edge.kv` and `edge.sql`, so a self-hosted Worker has no object binding and
 * the core's existing "object storage unavailable" behaviour applies.
 */

import type {
  ObjectStore,
  ObjectStoreBody,
  ObjectStoreObject,
  ObjectStorePutOptions,
} from "./types.ts";
import type { EdgeObjectsBinding } from "./edge-facades.ts";
import { readStream } from "./shared.ts";

/** A request or response the facade cannot express. */
export class EdgeObjectsShapeError extends TypeError {
  constructor(message: string) {
    super(message);
    this.name = "EdgeObjectsShapeError";
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

export class EdgeObjectStorage implements ObjectStore {
  constructor(private readonly bucket: EdgeObjectsBinding) {}

  async put(
    key: string,
    value: ObjectStoreBody,
    options?: ObjectStorePutOptions,
  ): Promise<void> {
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
    await this.bucket.put(key, body, {
      contentLength,
      ...(contentType === undefined ? {} : { contentType }),
    });
  }

  async get(key: string): Promise<ObjectStoreObject | null> {
    const found = await this.bucket.get(key, undefined);
    if (!found) return null;
    if (found.partial) {
      // No range was asked for, so a partial body would be a truncated object
      // served as if it were whole. Refuse rather than hand the caller bytes
      // that do not add up to the object.
      await found.body.cancel().catch(() => undefined);
      throw new EdgeObjectsShapeError(
        "edge.objects: the Host returned a partial body for an unranged get",
      );
    }
    return {
      key,
      body: found.body as ReadableStream<Uint8Array>,
      ...(found.contentType === undefined
        ? {}
        : { contentType: found.contentType }),
      etag: found.etag,
      byteLength: found.size,
    };
  }

  async delete(key: string | readonly string[]): Promise<void> {
    const keys = typeof key === "string" ? [key] : [...new Set(key)];
    for (const one of keys) await this.bucket.delete(one);
  }
}

export function wrapEdgeObjects(bucket: EdgeObjectsBinding): ObjectStore {
  return new EdgeObjectStorage(bucket);
}
