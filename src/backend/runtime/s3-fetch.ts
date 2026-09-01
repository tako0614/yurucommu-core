import type {
  ObjectStore,
  ObjectStoreBody,
  ObjectStoreObject,
  ObjectStorePutOptions,
} from "./types.ts";

/**
 * The host supplies a Fetch-compatible capability that is already scoped to
 * one object bucket. The adapter never receives (or needs) an endpoint,
 * bucket name, region, or credential.
 */
export interface S3ObjectFetcher {
  fetch(request: Request): Promise<Response>;
}

export interface S3FetchObjectStoreOptions {
  /** Maximum number of bytes a GET may expose to the application. */
  readonly maxObjectBytes?: number;
}

export type S3FetchObjectOperation = "put" | "get" | "delete";

/** An S3 protocol failure without response-body or endpoint details. */
export class S3FetchObjectStoreError extends Error {
  constructor(
    readonly operation: S3FetchObjectOperation,
    readonly code: string,
    readonly status?: number,
  ) {
    super(code);
    this.name = "S3FetchObjectStoreError";
  }
}

const SYNTHETIC_ORIGIN = "https://s3.invalid";
const DEFAULT_MAX_OBJECT_BYTES = 64 * 1024 * 1024;
const MAX_HEADER_VALUE_LENGTH = 8 * 1024;
const FETCH_REJECTION_CODES: Record<S3FetchObjectOperation, string> = {
  put: "s3_fetcher_put_rejected",
  get: "s3_fetcher_get_rejected",
  delete: "s3_fetcher_delete_rejected",
};

/**
 * Adapt a bucket-scoped S3 HTTP Fetcher to the core's provider-neutral object
 * store contract.
 *
 * The URL is intentionally synthetic. A host-owned Fetcher receives the
 * request and supplies the actual endpoint and credentials internally; no
 * provider materialization can escape through this public adapter.
 */
export function createS3FetchObjectStore(
  fetcher: S3ObjectFetcher,
  options: S3FetchObjectStoreOptions = {},
): ObjectStore {
  if (!fetcher || typeof fetcher.fetch !== "function") {
    throw new TypeError("s3_fetcher_invalid");
  }
  const maxObjectBytes = options.maxObjectBytes ?? DEFAULT_MAX_OBJECT_BYTES;
  assertMaxObjectBytes(maxObjectBytes);

  return new S3FetchObjectStore(fetcher, maxObjectBytes);
}

class S3FetchObjectStore implements ObjectStore {
  constructor(
    private readonly fetcher: S3ObjectFetcher,
    private readonly maxObjectBytes: number,
  ) {}

  async put(
    key: string,
    value: ObjectStoreBody,
    options?: ObjectStorePutOptions,
  ): Promise<void> {
    const headers = new Headers();
    if (options?.contentType !== undefined) {
      setBoundedHeader(headers, "content-type", options.contentType, "put");
    }
    const byteLength = knownBodyLength(value);
    if (byteLength !== undefined) {
      headers.set("content-length", String(byteLength));
    }

    const response = await fetchFromS3(
      this.fetcher,
      new Request(objectUrl(key), {
        method: "PUT",
        headers,
        body: value as BodyInit,
      }),
      "put",
    );
    await expectSuccess(response, "put");
  }

  async get(key: string): Promise<ObjectStoreObject | null> {
    const response = await fetchFromS3(
      this.fetcher,
      new Request(objectUrl(key), { method: "GET" }),
      "get",
    );
    if (response.status === 404) {
      await cancelBody(response);
      return null;
    }
    await expectSuccess(response, "get", false);

    let byteLength: number | undefined;
    let contentType: string | undefined;
    let etag: string | undefined;
    try {
      byteLength = parseContentLength(
        response.headers.get("content-length"),
        this.maxObjectBytes,
        "get",
        response.status,
      );
      contentType = boundedHeader(
        response.headers,
        "content-type",
        "get",
        response.status,
      );
      etag = boundedHeader(response.headers, "etag", "get", response.status);
    } catch (error) {
      await cancelBody(response);
      throw error;
    }
    return {
      key,
      body:
        response.body === null
          ? null
          : boundedBody(response.body, this.maxObjectBytes, "get"),
      ...(contentType === undefined ? {} : { contentType }),
      ...(etag === undefined ? {} : { etag }),
      ...(byteLength === undefined ? {} : { byteLength }),
    };
  }

  async delete(key: string | readonly string[]): Promise<void> {
    const isBatch = typeof key !== "string";
    const keys = [...new Set(isBatch ? key : [key])];
    const failures: S3FetchObjectStoreError[] = [];
    for (const entry of keys) {
      try {
        const response = await fetchFromS3(
          this.fetcher,
          new Request(objectUrl(entry), { method: "DELETE" }),
          "delete",
        );
        await expectSuccess(response, "delete");
      } catch (error) {
        failures.push(
          error instanceof S3FetchObjectStoreError
            ? error
            : new S3FetchObjectStoreError(
                "delete",
                "s3_delete_operation_failed",
              ),
        );
      }
    }
    if (failures.length === 0) return;
    if (!isBatch) {
      throw failures[0];
    }
    throw new AggregateError(failures, "s3_batch_delete_failed");
  }
}

async function fetchFromS3(
  fetcher: S3ObjectFetcher,
  request: Request,
  operation: S3FetchObjectOperation,
): Promise<Response> {
  try {
    return await fetcher.fetch(request);
  } catch {
    // Never retain the supplied rejection as `cause` or copy any of its text:
    // the host Fetcher may contain endpoint and credential diagnostics.
    throw new S3FetchObjectStoreError(
      operation,
      FETCH_REJECTION_CODES[operation],
    );
  }
}

function objectUrl(key: string): string {
  return `${SYNTHETIC_ORIGIN}/${key
    .split("/")
    .map(encodePathSegment)
    .join("/")}`;
}

/** Encode every path segment, including dot segments, so URL normalization
 * cannot reinterpret a user key as traversal. */
function encodePathSegment(value: string): string {
  const encoded = encodeURIComponent(value).replace(
    /[.!'()*]/gu,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  // URL parsers normalize `%2E`/`%2E%2E` path segments as traversal before a
  // Fetcher sees the request. Double-escape only those complete segments so
  // the host can decode the wire path without losing the key boundary.
  return value === "." || value === ".."
    ? encoded.replace(/%2E/gu, "%252E")
    : encoded;
}

function knownBodyLength(value: ObjectStoreBody): number | undefined {
  if (value instanceof Blob) return value.size;
  if (value instanceof ArrayBuffer) return value.byteLength;
  if (typeof value === "string") {
    return new TextEncoder().encode(value).byteLength;
  }
  return undefined;
}

async function expectSuccess(
  response: Response,
  operation: S3FetchObjectOperation,
  cancelSuccessfulBody = true,
): Promise<void> {
  if (response.status >= 200 && response.status < 300) {
    if (cancelSuccessfulBody) await cancelBody(response);
    return;
  }
  await cancelBody(response);
  throw new S3FetchObjectStoreError(
    operation,
    "s3_response_unexpected_status",
    response.status,
  );
}

async function cancelBody(response: Response): Promise<void> {
  await response.body?.cancel().catch(() => undefined);
}

function boundedHeader(
  headers: Headers,
  name: string,
  operation: S3FetchObjectOperation,
  status: number,
): string | undefined {
  const value = headers.get(name);
  if (value === null || value.length === 0) return undefined;
  if (value.length > MAX_HEADER_VALUE_LENGTH) {
    throw new S3FetchObjectStoreError(
      operation,
      "s3_response_header_too_large",
      status,
    );
  }
  return value;
}

function setBoundedHeader(
  headers: Headers,
  name: string,
  value: string,
  operation: S3FetchObjectOperation,
): void {
  if (value.length > MAX_HEADER_VALUE_LENGTH) {
    throw new S3FetchObjectStoreError(operation, "s3_request_header_too_large");
  }
  headers.set(name, value);
}

function parseContentLength(
  value: string | null,
  maxObjectBytes: number,
  operation: S3FetchObjectOperation,
  status: number,
): number | undefined {
  if (value === null) return undefined;
  if (
    value.length > MAX_HEADER_VALUE_LENGTH ||
    !/^\d+$/u.test(value) ||
    !Number.isSafeInteger(Number(value))
  ) {
    throw new S3FetchObjectStoreError(
      operation,
      "s3_response_content_length_invalid",
      status,
    );
  }
  const parsed = Number(value);
  if (parsed > maxObjectBytes) {
    throw new S3FetchObjectStoreError(
      operation,
      "s3_response_object_too_large",
      status,
    );
  }
  return parsed;
}

function boundedBody(
  stream: ReadableStream<Uint8Array>,
  maxObjectBytes: number,
  operation: S3FetchObjectOperation,
): ReadableStream<Uint8Array> {
  const reader = stream.getReader();
  let size = 0;
  let finished = false;
  const release = (): void => {
    if (finished) return;
    finished = true;
    try {
      reader.releaseLock();
    } catch {
      // The bounded adapter owns no useful diagnostic at this boundary. A
      // lock-release failure after read/cancel completion must not surface a
      // provider error or retain its cause.
    }
  };

  return new ReadableStream<Uint8Array>(
    {
      async pull(controller) {
        try {
          const result = await reader.read();
          if (result.done) {
            controller.close();
            release();
            return;
          }
          size += result.value.byteLength;
          if (size > maxObjectBytes) {
            await reader
              .cancel("s3_response_object_too_large")
              .catch(() => undefined);
            controller.error(
              new S3FetchObjectStoreError(
                operation,
                "s3_response_object_too_large",
              ),
            );
            release();
            return;
          }
          controller.enqueue(result.value);
        } catch {
          controller.error(
            new S3FetchObjectStoreError(
              operation,
              "s3_response_body_read_failed",
            ),
          );
          release();
        }
      },
      async cancel() {
        try {
          // Do not forward an arbitrary caller reason into a provider-owned
          // stream, and never retain a provider rejection as cause/text.
          await reader.cancel("s3_response_body_cancelled");
        } catch {
          throw new S3FetchObjectStoreError(
            operation,
            "s3_response_body_cancel_failed",
          );
        } finally {
          release();
        }
      },
    },
    { highWaterMark: 0 },
  );
}

function assertMaxObjectBytes(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError("s3_object_response_limit_invalid");
  }
}
