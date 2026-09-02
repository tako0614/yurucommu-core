/**
 * `edge.objects@1.0.0` → {@link IObjectStorage}.
 *
 * The facade is deliberately narrower than R2, and the narrow spots are the
 * interesting ones:
 *
 *  - NO `customMetadata`. Only `contentType` survives a round trip. Nothing in
 *    this repo writes custom metadata, so rather than dropping it silently a
 *    caller that starts is refused.
 *  - FIXED ARITIES. The Host counts `arguments.length`, so `get`, `put`, and
 *    `list` are always called with their full argument list even when the
 *    options are absent.
 *  - A STREAMING `put` NEEDS `contentLength`. ADR 0005 is explicit that a Host
 *    enforces the declared count while streaming and never buffers a body to
 *    discover its size. `IObjectStorage.put` therefore carries an optional
 *    `contentLength`; a stream that arrives without one is buffered HERE, in
 *    the Worker, which is the honest cost of not knowing the size.
 *  - `delete` TAKES ONE KEY. The port's array form becomes a sequence of calls,
 *    which is not atomic — the same as R2's, which also has no transaction.
 *
 * AVAILABILITY: `edge.objects` is projected by the managed Cloudflare backend
 * (`createEdgeObjectsR2Adapter`). The self-host backend projects only
 * `edge.kv` and `edge.sql`, so a self-hosted Worker has no object binding and
 * the core's existing "object storage unavailable" behaviour applies.
 */

import type {
  IObjectStorage,
  ListObjectsResult,
  ObjectMetadata,
  StorageObject,
} from "./types.ts";
import type { EdgeObjectMetadata, EdgeObjectsBinding } from "./edge-facades.ts";
import { readStream } from "./shared.ts";

/** A request the facade cannot express. */
export class EdgeObjectsShapeError extends TypeError {
  constructor(message: string) {
    super(message);
    this.name = "EdgeObjectsShapeError";
  }
}

function metadataOf(value: EdgeObjectMetadata): ObjectMetadata {
  return {
    contentType: value.contentType,
    contentLength: value.size,
    etag: value.etag,
    httpMetadata: value.contentType
      ? { contentType: value.contentType }
      : undefined,
  };
}

export class EdgeObjectStorage implements IObjectStorage {
  constructor(private readonly bucket: EdgeObjectsBinding) {}

  async put(
    key: string,
    value: ReadableStream | ArrayBuffer | string,
    options?: {
      httpMetadata?: ObjectMetadata["httpMetadata"];
      customMetadata?: Record<string, string>;
      contentLength?: number;
    },
  ): Promise<void> {
    if (
      options?.customMetadata !== undefined &&
      Object.keys(options.customMetadata).length > 0
    ) {
      throw new EdgeObjectsShapeError(
        "edge.objects: customMetadata has no portable equivalent; carry the " +
          "attribute in the database row that owns the key instead",
      );
    }
    const contentType = options?.httpMetadata?.contentType;
    let body: string | ArrayBuffer | Uint8Array | ReadableStream = value;
    let contentLength = options?.contentLength;
    if (
      typeof value !== "string" &&
      !(value instanceof ArrayBuffer) &&
      contentLength === undefined
    ) {
      // No declared length and a stream: the size has to come from somewhere,
      // and the Host will not discover it. Buffering is the only remaining
      // option, so it happens where the memory cost is visible.
      body = await readStream(value as ReadableStream<Uint8Array>);
      contentLength = (body as Uint8Array).byteLength;
    }
    await this.bucket.put(key, body, {
      ...(contentLength === undefined ? {} : { contentLength }),
      ...(contentType === undefined ? {} : { contentType }),
    });
  }

  async get(key: string): Promise<StorageObject | null> {
    const found = await this.bucket.get(key, undefined);
    if (!found) return null;
    const body = found.body;
    // The facade hands out exactly one stream. `arrayBuffer`/`text`/`json` are
    // served from it, so a caller may use the body OR the helpers, never both —
    // which is also true of R2.
    const buffered = async () => await new Response(body).arrayBuffer();
    return {
      key,
      body,
      bodyUsed: false,
      httpEtag: found.etag,
      arrayBuffer: buffered,
      text: async () => new TextDecoder().decode(await buffered()),
      json: async <T>() =>
        JSON.parse(new TextDecoder().decode(await buffered())) as T,
      httpMetadata: found.contentType
        ? { contentType: found.contentType }
        : undefined,
      customMetadata: undefined,
    };
  }

  async delete(key: string | string[]): Promise<void> {
    const keys = Array.isArray(key) ? key : [key];
    for (const one of keys) await this.bucket.delete(one);
  }

  async list(options?: {
    prefix?: string;
    limit?: number;
    cursor?: string;
    delimiter?: string;
  }): Promise<ListObjectsResult> {
    const page = await this.bucket.list({
      ...(options?.prefix === undefined ? {} : { prefix: options.prefix }),
      ...(options?.delimiter === undefined
        ? {}
        : { delimiter: options.delimiter }),
      ...(options?.cursor === undefined ? {} : { cursor: options.cursor }),
      ...(options?.limit === undefined ? {} : { limit: options.limit }),
    });
    return {
      objects: page.objects.map((object) => ({
        key: object.key,
        size: object.size,
        // The Host omits the upload instant when the provider did not record
        // one; the port's `Date` is not optional, so it reads as the epoch.
        uploaded: new Date(object.uploadedAtMillis ?? 0),
        etag: object.etag,
        httpMetadata: object.contentType
          ? { contentType: object.contentType }
          : undefined,
      })),
      truncated: page.truncated,
      cursor: page.truncated ? page.cursor : undefined,
      delimitedPrefixes: [...page.prefixes],
    };
  }

  async head(key: string): Promise<ObjectMetadata | null> {
    const found = await this.bucket.head(key);
    return found ? metadataOf(found) : null;
  }
}

export function wrapEdgeObjects(bucket: EdgeObjectsBinding): IObjectStorage {
  return new EdgeObjectStorage(bucket);
}
