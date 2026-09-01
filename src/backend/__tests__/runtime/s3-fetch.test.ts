import { describe, expect, test } from "bun:test";

import {
  createS3FetchObjectStore,
  S3FetchObjectStoreError,
  type S3ObjectFetcher,
} from "../../runtime/s3-fetch.ts";

// Frozen cross-contract fixture: Takoserver's bucket-scoped Fetcher accepts
// customer requests only at this synthetic origin. Keep this literal local so
// Core cannot silently drift by importing the provider implementation.
const TAKOSERVER_S3_FETCHER_ORIGIN = "https://s3.invalid";
const REJECTION_SECRETS = [
  "https://private-s3.example.test/customer-bucket",
  "AKIA-REJECTION-ACCESS-KEY",
  "rejection-secret-token-value",
  "objects/private-rejection-key.png",
] as const;

function fetcher(
  handler: (request: Request) => Promise<Response> | Response,
): S3ObjectFetcher {
  return {
    async fetch(request) {
      return await handler(request);
    },
  };
}

function backendRejection(): Error {
  const [endpoint, accessKey, token, key] = REJECTION_SECRETS;
  const error = new Error(
    `request to ${endpoint} for ${key} failed with ${accessKey} ${token}`,
  ) as Error & Record<string, unknown>;
  error.endpoint = endpoint;
  error.accessKey = accessKey;
  error.token = token;
  error.key = key;
  error.cause = {
    authorization: `Bearer ${token}`,
    endpoint,
  };
  return error;
}

async function captureError(action: () => Promise<unknown>): Promise<unknown> {
  let thrown: unknown;
  try {
    await action();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeDefined();
  return thrown;
}

function inspectRecursively(value: unknown, seen = new Set<object>()): unknown {
  if (
    value === null ||
    (typeof value !== "object" && typeof value !== "function")
  ) {
    return value;
  }
  if (seen.has(value)) return "[Circular]";
  seen.add(value);

  const inspected: Record<string, unknown> = {};
  for (const property of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, property);
    if (!descriptor || !("value" in descriptor)) continue;
    const name =
      typeof property === "symbol"
        ? `[${String(property.description ?? property)}]`
        : property;
    inspected[name] = inspectRecursively(descriptor.value, seen);
  }
  return inspected;
}

function expectNoRejectionSecrets(thrown: unknown): void {
  const representations = [
    String(thrown),
    JSON.stringify(thrown),
    JSON.stringify(inspectRecursively(thrown)),
  ];
  for (const representation of representations) {
    for (const secret of REJECTION_SECRETS) {
      expect(representation).not.toContain(secret);
    }
  }
}

describe("bucket-scoped S3 Fetcher object store", () => {
  test("encodes keys and sends PutObject without consuming a stream body", async () => {
    let captured: Request | undefined;
    let pulls = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        controller.enqueue(new Uint8Array([1, 2, 3]));
        controller.close();
      },
    });
    const store = createS3FetchObjectStore(
      fetcher((request) => {
        captured = request;
        return new Response(null, { status: 200 });
      }),
    );

    await store.put("folder/../a b?/#%/日本", body, {
      contentType: "application/octet-stream",
    });

    // Bun may prime a Request body stream once while constructing the
    // Fetch-compatible request. The adapter must not drain it (one pull is
    // the runtime's framing, not an eager adapter read).
    expect(pulls).toBeLessThanOrEqual(1);
    expect(captured?.method).toBe("PUT");
    expect(new URL(captured!.url).pathname).toBe(
      "/folder/%252E%252E/a%20b%3F/%23%25/%E6%97%A5%E6%9C%AC",
    );
    expect(captured?.headers.get("content-type")).toBe(
      "application/octet-stream",
    );
    expect(captured?.headers.get("content-length")).toBeNull();
    expect(new URL(captured!.url).origin).toBe(TAKOSERVER_S3_FETCHER_ORIGIN);
    expect(captured?.url).not.toContain("bucket");
    expect(captured?.url).not.toContain("credential");
  });

  test("keeps GetObject lazy and preserves bounded response metadata", async () => {
    let pulls = 0;
    const source = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        controller.enqueue(new TextEncoder().encode("hello"));
        controller.close();
      },
    });
    const response = new Response(source, {
      status: 200,
      headers: {
        "content-type": "text/plain",
        "content-length": "5",
        etag: '"abc"',
      },
    });
    const primedPulls = pulls;
    const store = createS3FetchObjectStore(fetcher(() => response));

    const object = await store.get("hello.txt");
    expect(object).toMatchObject({
      key: "hello.txt",
      contentType: "text/plain",
      etag: '"abc"',
      byteLength: 5,
    });
    expect(pulls).toBeGreaterThanOrEqual(primedPulls);
    expect(pulls).toBeLessThanOrEqual(primedPulls + 1);
    expect(await new Response(object!.body).text()).toBe("hello");
    expect(pulls).toBe(1);
  });

  test("maps a missing GetObject to null and cancels the response body", async () => {
    let cancelled = false;
    const missingBody = new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true;
      },
    });
    const store = createS3FetchObjectStore(
      fetcher(() => new Response(missingBody, { status: 404 })),
    );

    expect(await store.get("missing")).toBeNull();
    expect(cancelled).toBe(true);
  });

  test("rejects non-success responses without reading or cloning their body", async () => {
    let pulls = 0;
    let cancelled = false;
    const errorBody = new ReadableStream<Uint8Array>({
      pull() {
        pulls += 1;
      },
      cancel() {
        cancelled = true;
      },
    });
    const errorResponse = new Response(errorBody, { status: 503 });
    const primedPulls = pulls;
    const store = createS3FetchObjectStore(fetcher(() => errorResponse));

    await expect(store.get("busy")).rejects.toMatchObject({
      operation: "get",
      code: "s3_response_unexpected_status",
      status: 503,
    });
    expect(pulls).toBeGreaterThanOrEqual(primedPulls);
    expect(pulls).toBeLessThanOrEqual(primedPulls + 1);
    expect(cancelled).toBe(true);
  });

  test("normalizes every Fetcher rejection without retaining backend diagnostics", async () => {
    const cases = [
      {
        operation: "put",
        code: "s3_fetcher_put_rejected",
        invoke: (store: ReturnType<typeof createS3FetchObjectStore>) =>
          store.put(REJECTION_SECRETS[3], "body"),
      },
      {
        operation: "get",
        code: "s3_fetcher_get_rejected",
        invoke: (store: ReturnType<typeof createS3FetchObjectStore>) =>
          store.get(REJECTION_SECRETS[3]),
      },
      {
        operation: "delete",
        code: "s3_fetcher_delete_rejected",
        invoke: (store: ReturnType<typeof createS3FetchObjectStore>) =>
          store.delete(REJECTION_SECRETS[3]),
      },
    ] as const;

    for (const testCase of cases) {
      const store = createS3FetchObjectStore(
        fetcher(() => Promise.reject(backendRejection())),
      );
      const thrown = await captureError(() => testCase.invoke(store));

      expect(thrown).toBeInstanceOf(S3FetchObjectStoreError);
      expect(thrown).toMatchObject({
        name: "S3FetchObjectStoreError",
        operation: testCase.operation,
        code: testCase.code,
        message: testCase.code,
        status: undefined,
      });
      expect(Object.prototype.hasOwnProperty.call(thrown, "cause")).toBe(false);
      expectNoRejectionSecrets(thrown);
    }
  });

  test("normalizes lazy GetObject read and cancel rejections", async () => {
    let rejectRead: (() => void) | undefined;
    const rejectedReadBody = new ReadableStream<Uint8Array>({
      start(controller) {
        rejectRead = () => controller.error(backendRejection());
      },
    });
    const readStore = createS3FetchObjectStore(
      fetcher(() => new Response(rejectedReadBody, { status: 200 })),
    );
    const readObject = await readStore.get("lazy-read");
    rejectRead?.();
    const readFailure = await captureError(async () =>
      new Response(readObject!.body).arrayBuffer(),
    );
    expect(readFailure).toBeInstanceOf(S3FetchObjectStoreError);
    expect(readFailure).toMatchObject({
      operation: "get",
      code: "s3_response_body_read_failed",
      message: "s3_response_body_read_failed",
    });
    expect(Object.prototype.hasOwnProperty.call(readFailure, "cause")).toBe(
      false,
    );
    expectNoRejectionSecrets(readFailure);

    const rejectedCancelBody = new ReadableStream<Uint8Array>({
      cancel() {
        return Promise.reject(backendRejection());
      },
    });
    const cancelStore = createS3FetchObjectStore(
      fetcher(() => new Response(rejectedCancelBody, { status: 200 })),
    );
    const cancelObject = await cancelStore.get("lazy-cancel");
    const cancelFailure = await captureError(() =>
      cancelObject!.body!.cancel("caller stopped"),
    );
    expect(cancelFailure).toBeInstanceOf(S3FetchObjectStoreError);
    expect(cancelFailure).toMatchObject({
      operation: "get",
      code: "s3_response_body_cancel_failed",
      message: "s3_response_body_cancel_failed",
    });
    expect(Object.prototype.hasOwnProperty.call(cancelFailure, "cause")).toBe(
      false,
    );
    expectNoRejectionSecrets(cancelFailure);
  });

  test("deletes each key in a batch with DeleteObject semantics", async () => {
    const requests: Request[] = [];
    const store = createS3FetchObjectStore(
      fetcher((request) => {
        requests.push(request);
        return new Response(null, { status: 204 });
      }),
    );

    await store.delete(["one", "nested/two"]);

    expect(requests.map((request) => request.method)).toEqual([
      "DELETE",
      "DELETE",
    ]);
    expect(requests.map((request) => new URL(request.url).pathname)).toEqual([
      "/one",
      "/nested/two",
    ]);
    expect(requests.every((request) => request.body === null)).toBe(true);
  });

  test("attempts every distinct batch delete and aggregates ordered failures", async () => {
    const attemptedPaths: string[] = [];
    const store = createS3FetchObjectStore(
      fetcher((request) => {
        const path = new URL(request.url).pathname;
        attemptedPaths.push(path);
        const status = path === "/fails-first" ? 500 : 503;
        return new Response(null, {
          status: path === "/succeeds-later" ? 204 : status,
        });
      }),
    );

    let failure: unknown;
    try {
      await store.delete([
        "fails-first",
        "succeeds-later",
        "fails-first",
        "fails-last",
      ]);
    } catch (error) {
      failure = error;
    }

    expect(attemptedPaths).toEqual([
      "/fails-first",
      "/succeeds-later",
      "/fails-last",
    ]);
    expect(failure).toBeInstanceOf(AggregateError);
    if (!(failure instanceof AggregateError)) {
      throw new Error("expected AggregateError");
    }
    expect(failure.message).toBe("s3_batch_delete_failed");
    expect(failure.errors).toHaveLength(2);
    expect(failure.errors[0]).toBeInstanceOf(S3FetchObjectStoreError);
    expect(failure.errors[0]).toMatchObject({
      operation: "delete",
      code: "s3_response_unexpected_status",
      status: 500,
    });
    expect(failure.errors[1]).toMatchObject({
      operation: "delete",
      code: "s3_response_unexpected_status",
      status: 503,
    });
  });

  test("preserves the direct delete error contract for a single key", async () => {
    const store = createS3FetchObjectStore(
      fetcher(() => new Response(null, { status: 502 })),
    );

    await expect(store.delete("one")).rejects.toMatchObject({
      operation: "delete",
      code: "s3_response_unexpected_status",
      status: 502,
    });
  });

  test("batch delete aggregates only normalized Fetcher rejections", async () => {
    const attemptedPaths: string[] = [];
    const laterKey = "objects/later-private-rejection-key.png";
    const store = createS3FetchObjectStore(
      fetcher((request) => {
        attemptedPaths.push(new URL(request.url).pathname);
        return Promise.reject(backendRejection());
      }),
    );

    const thrown = await captureError(() =>
      store.delete([REJECTION_SECRETS[3], laterKey, REJECTION_SECRETS[3]]),
    );

    expect(attemptedPaths).toEqual([
      "/objects/private-rejection-key%2Epng",
      "/objects/later-private-rejection-key%2Epng",
    ]);
    expect(thrown).toBeInstanceOf(AggregateError);
    if (!(thrown instanceof AggregateError)) {
      throw new Error("expected AggregateError");
    }
    expect(thrown.message).toBe("s3_batch_delete_failed");
    expect(thrown.errors).toHaveLength(2);
    for (const error of thrown.errors) {
      expect(error).toBeInstanceOf(S3FetchObjectStoreError);
      expect(error).toMatchObject({
        operation: "delete",
        code: "s3_fetcher_delete_rejected",
        message: "s3_fetcher_delete_rejected",
        status: undefined,
      });
      expect(Object.prototype.hasOwnProperty.call(error, "cause")).toBe(false);
    }
    expectNoRejectionSecrets(thrown);
    expect(JSON.stringify(inspectRecursively(thrown))).not.toContain(laterKey);
  });

  test("rejects malformed or over-limit response lengths", async () => {
    const malformed = createS3FetchObjectStore(
      fetcher(
        () =>
          new Response("ignored", {
            status: 200,
            headers: { "content-length": "not-a-number" },
          }),
      ),
      { maxObjectBytes: 8 },
    );
    await expect(malformed.get("bad-length")).rejects.toBeInstanceOf(
      S3FetchObjectStoreError,
    );

    const tooLarge = createS3FetchObjectStore(
      fetcher(
        () =>
          new Response("012345678", {
            status: 200,
            headers: { "content-length": "9" },
          }),
      ),
      { maxObjectBytes: 8 },
    );
    await expect(tooLarge.get("large")).rejects.toMatchObject({
      code: "s3_response_object_too_large",
    });
  });
});
