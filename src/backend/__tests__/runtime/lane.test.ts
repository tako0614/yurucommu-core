import { describe, expect, test } from "bun:test";
import type { MessageBatch } from "@cloudflare/workers-types";

import {
  DEFAULT_RUNTIME_LANE,
  RUNTIME_LANE_VAR,
  RuntimeLaneError,
  assertRuntimeLaneBindings,
  resolveRuntimeLane,
  wrapRuntimeBindings,
  wrapRuntimeMessageBatch,
  wrapPortableBindings,
} from "../../runtime/lane.ts";
import { wrapEdgeObjectsAsBucket } from "../../runtime/edge-objects.ts";
import worker from "../../public.ts";
import {
  encodeEdgeBytes,
  isEdgeObjectsBinding,
  isEdgeSqlBinding,
  isNativeD1Database,
  isNativeR2Bucket,
  type EdgeQueueBatch,
} from "../../runtime/edge-facades.ts";

// --- binding doubles -------------------------------------------------------
// Each one carries only the method names that make it identifiable, because
// identification is the whole subject of this file.

const edgeSql = () => ({
  execute: async () => ({ rows: [], rowsWritten: 0 }),
  query: async () => ({ rows: [], rowsWritten: 0 }),
  transaction: async () => [],
});

const nativeD1 = () => ({
  prepare: () => ({}),
  batch: async () => [],
  exec: async () => ({}),
  dump: async () => new ArrayBuffer(0),
});

const edgeKv = () => ({
  get: async () => null,
  getWithMetadata: async () => null,
  put: async () => {},
  delete: async () => {},
  list: async () => ({ keys: [], listComplete: true }),
});

const nativeKv = () => ({
  // Structurally IDENTICAL to `edgeKv` — that is the point.
  get: async () => null,
  getWithMetadata: async () => null,
  put: async () => {},
  delete: async () => {},
  list: async () => ({ keys: [], list_complete: true }),
});

// The REAL `edge.objects@1.0.0` facade, not a reduced one: Takoserver's
// `createObjectsAdapter` projects the multipart calls as well, which is exactly
// why a bucket binding tells you nothing about the lane.
const edgeObjects = () => ({
  head: async () => null,
  get: async (_key: string, _options: unknown) => null,
  put: async () => ({ etag: "e", size: 0 }),
  delete: async () => {},
  list: async () => ({ objects: [], prefixes: [], truncated: false }),
  createMultipartUpload: async () => ({ uploadId: "u" }),
  uploadPart: async () => ({ partNumber: 1, etag: "e" }),
  completeMultipartUpload: async () => ({ etag: "e", size: 0 }),
  abortMultipartUpload: async () => {},
});

const nativeR2 = () => ({
  head: async () => null,
  get: async () => null,
  put: async () => ({}),
  delete: async () => {},
  list: async () => ({ objects: [], truncated: false }),
  createMultipartUpload: async () => ({}),
  resumeMultipartUpload: () => ({}),
});

const edgeQueue = () => ({
  send: async () => "id",
  sendBatch: async () => ["id"],
});

const nativeQueue = () => ({ send: async () => {}, sendBatch: async () => {} });

describe("runtime lane declaration", () => {
  test("an absent declaration is the Cloudflare lane", () => {
    expect(resolveRuntimeLane(undefined)).toBe(DEFAULT_RUNTIME_LANE);
    expect(resolveRuntimeLane(null)).toBe("cloudflare");
    expect(resolveRuntimeLane("")).toBe("cloudflare");
  });

  test("accepts the value a wrapper-host deployment sets", () => {
    // A self-host or managed Workers-for-Platforms deployment sets
    // YURUCOMMU_RUNTIME_LANE = "portable".
    expect(resolveRuntimeLane("portable")).toBe("portable");
    expect(resolveRuntimeLane("  portable  ")).toBe("portable");
    expect(resolveRuntimeLane("cloudflare")).toBe("cloudflare");
  });

  test("refuses a lane it has never heard of rather than defaulting", () => {
    // The lane names the binding shape, so the retired IaC-flavoured spelling
    // is not an alias for it: a deployment still declaring it must be fixed,
    // not silently served with a guessed binding shape.
    for (const declared of ["takoform-v1", "takoform-v2"]) {
      expect(() => resolveRuntimeLane(declared)).toThrow(RuntimeLaneError);
      expect(() => resolveRuntimeLane(declared)).toThrow(
        /not a runtime lane this build supports/,
      );
    }
    expect(() => resolveRuntimeLane(7)).toThrow(RuntimeLaneError);
  });
});

describe("binding identification", () => {
  test("the database binding is decisive in both directions", () => {
    expect(isEdgeSqlBinding(edgeSql())).toBe(true);
    expect(isEdgeSqlBinding(nativeD1())).toBe(false);
    expect(isNativeD1Database(nativeD1())).toBe(true);
    expect(isNativeD1Database(edgeSql())).toBe(false);
  });

  test("the bucket binding is AMBIGUOUS: the facade is R2's method set on purpose", () => {
    // Both probes answer `true` for both objects. That is not a defect in the
    // probes — `edge.objects@1.0.0` is deliberately method-for-method a bucket
    // so an app written against R2 ports over unchanged. 4.1.0 read the
    // identity as a discriminator and refused every self-hosted deployment.
    expect(isNativeR2Bucket(nativeR2())).toBe(true);
    expect(isNativeR2Bucket(edgeObjects())).toBe(true);
    expect(isEdgeObjectsBinding(edgeObjects())).toBe(true);
  });

  test("the ambiguity now reaches the ANSWERS, not only the call names", async () => {
    // The calls always matched; the results did not. Takoserver's `get` hands
    // back a plain `{etag, size, contentType?, body, partial}` record, so
    // `await (await env.MEDIA.get(k)).text()` — legal R2 — threw on the
    // portable lane. `wrapEdgeObjectsAsBucket` closes that: the members an app
    // reads off an `R2ObjectBody` are all there, and the Interface's promise
    // that R2-shaped code ports over unchanged holds for the answers too.
    const bucket = wrapEdgeObjectsAsBucket({
      ...edgeObjects(),
      get: async (key: string, _options: unknown) => ({
        etag: `${key}-etag`,
        size: 5,
        contentType: "text/plain",
        body: new Response("bytes" as unknown as BodyInit).body!,
        partial: false,
      }),
    } as never);
    const object = (await bucket.get("k"))!;
    for (const member of [
      "key",
      "size",
      "etag",
      "httpEtag",
      "uploaded",
      "httpMetadata",
      "customMetadata",
      "bodyUsed",
      "body",
    ]) {
      expect(member in object).toBe(true);
    }
    for (const method of [
      "text",
      "json",
      "arrayBuffer",
      "blob",
      "writeHttpMetadata",
    ]) {
      expect(
        typeof (object as unknown as Record<string, unknown>)[method],
      ).toBe("function");
    }
    expect(await object.text()).toBe("bytes");
  });

  test("the KV and queue bindings CANNOT be told apart, which is why the lane is declared", () => {
    const shape = (value: object) =>
      Object.keys(value)
        .filter((key) => typeof (value as never)[key] === "function")
        .sort();
    expect(shape(edgeKv())).toEqual(shape(nativeKv()));
    expect(shape(edgeQueue())).toEqual(shape(nativeQueue()));
  });
});

describe("lane and bindings must agree", () => {
  test("accepts a matched portable-facade deployment", () => {
    expect(() =>
      assertRuntimeLaneBindings("portable", {
        DB: edgeSql(),
        MEDIA: edgeObjects(),
      }),
    ).not.toThrow();
  });

  test("accepts a matched Cloudflare deployment", () => {
    expect(() =>
      assertRuntimeLaneBindings("cloudflare", {
        DB: nativeD1(),
        MEDIA: nativeR2(),
      }),
    ).not.toThrow();
  });

  test("refuses the portable lane declared over raw Cloudflare bindings", () => {
    expect(() =>
      assertRuntimeLaneBindings("portable", { DB: nativeD1() }),
    ).toThrow(/native D1Database/);
  });

  test("accepts a bucket binding on the portable lane whatever shape it has", () => {
    // The self-host facade carries the multipart calls, so a shape test would
    // reject it as "a native R2Bucket" — the boot failure DEFECT 5 recorded.
    // The declared lane decides MEDIA; nothing about the object does.
    for (const MEDIA of [edgeObjects(), nativeR2(), undefined]) {
      expect(() =>
        assertRuntimeLaneBindings("portable", { DB: edgeSql(), MEDIA }),
      ).not.toThrow();
    }
  });

  test("wraps a facade bucket as edge.objects once the lane says portable", () => {
    const env = wrapPortableBindings({
      DB: edgeSql(),
      KV: edgeKv(),
      MEDIA: edgeObjects(),
    } as never) as Record<string, unknown>;
    // The `ObjectStore` port, not the binding passing through: the port has no
    // `head` and no multipart calls, so their absence proves the adapter ran.
    const media = env.MEDIA as Record<string, unknown>;
    expect(typeof media.get).toBe("function");
    expect(typeof media.put).toBe("function");
    expect(typeof media.delete).toBe("function");
    expect(media.head).toBeUndefined();
    expect(media.createMultipartUpload).toBeUndefined();
  });

  test("refuses a facade that arrived without its lane declared", () => {
    expect(() =>
      assertRuntimeLaneBindings("cloudflare", { DB: edgeSql() }),
    ).toThrow(RuntimeLaneError);
    expect(() =>
      assertRuntimeLaneBindings("cloudflare", { DB: edgeSql() }),
    ).toThrow(new RegExp(RUNTIME_LANE_VAR));
  });

  test("refuses a database binding that is neither", () => {
    expect(() => assertRuntimeLaneBindings("cloudflare", { DB: {} })).toThrow(
      /neither a D1Database nor/,
    );
    expect(() => assertRuntimeLaneBindings("portable", { DB: {} })).toThrow(
      /requires env\.DB to be the/,
    );
  });
});

describe("wrapRuntimeBindings", () => {
  const portableEnv = () => ({
    YURUCOMMU_RUNTIME_LANE: "portable",
    APP_URL: "https://example.test",
    ENCRYPTION_KEY: "k",
    DB: edgeSql(),
    KV: edgeKv(),
    MEDIA: edgeObjects(),
    DELIVERY_QUEUE: edgeQueue(),
    DELIVERY_DLQ: edgeQueue(),
  });

  test("builds every runtime port from the facades", () => {
    const env = wrapRuntimeBindings(portableEnv() as never) as Record<
      string,
      unknown
    >;
    expect(env.DB_INSTANCE).toBeDefined();
    expect(typeof (env.KV as { get: unknown }).get).toBe("function");
    expect(typeof (env.MEDIA as { get: unknown }).get).toBe("function");
    expect(typeof (env.DELIVERY_QUEUE as { send: unknown }).send).toBe(
      "function",
    );
    expect(typeof (env.DELIVERY_DLQ as { send: unknown }).send).toBe(
      "function",
    );
    // Plain variables, including the lane marker itself, pass through.
    expect(env.APP_URL).toBe("https://example.test");
    expect(env.YURUCOMMU_RUNTIME_LANE).toBe("portable");
    // The raw bindings do not survive into app-visible Env.
    expect(env.DB).toBeUndefined();
  });

  test("leaves an unbound optional binding unbound", () => {
    const bindings = portableEnv() as Record<string, unknown>;
    delete bindings.MEDIA;
    delete bindings.DELIVERY_QUEUE;
    delete bindings.DELIVERY_DLQ;
    const env = wrapPortableBindings(bindings as never) as Record<
      string,
      unknown
    >;
    expect(env.MEDIA).toBeUndefined();
    expect(env.DELIVERY_QUEUE).toBeUndefined();
    expect(env.DELIVERY_DLQ).toBeUndefined();
    expect(env.KV).toBeDefined();
  });

  test("wraps native bindings when no lane is declared", () => {
    const env = wrapRuntimeBindings({
      APP_URL: "https://example.test",
      DB: nativeD1(),
      KV: nativeKv(),
    } as never) as Record<string, unknown>;
    expect(env.DB_INSTANCE).toBeDefined();
    expect(env.KV).toBeDefined();
  });

  test("refuses to start when the declaration and the bindings disagree", () => {
    expect(() =>
      wrapRuntimeBindings({
        YURUCOMMU_RUNTIME_LANE: "portable",
        DB: nativeD1(),
        KV: nativeKv(),
      } as never),
    ).toThrow(RuntimeLaneError);

    expect(() =>
      wrapRuntimeBindings({
        DB: edgeSql(),
        KV: edgeKv(),
      } as never),
    ).toThrow(RuntimeLaneError);

    expect(() =>
      wrapRuntimeBindings({
        YURUCOMMU_RUNTIME_LANE: "somewhere-else",
        DB: edgeSql(),
        KV: edgeKv(),
      } as never),
    ).toThrow(/not a runtime lane this build supports/);
  });
});

describe("wrapRuntimeMessageBatch", () => {
  const facadeBatch = (): EdgeQueueBatch => ({
    batchId: "b",
    queue: "yurucommu-delivery",
    messages: [
      {
        id: "m",
        timestampMillis: 1,
        attempts: 1,
        body: encodeEdgeBytes(new TextEncoder().encode('{"n":1}')),
        acknowledge: () => {},
        retry: () => {},
      },
    ],
    acknowledgeAll: () => {},
    retryAll: () => {},
  });

  const cloudflareBatch = () =>
    ({
      queue: "yurucommu-delivery",
      messages: [
        {
          id: "m",
          timestamp: new Date(1),
          body: { n: 1 },
          attempts: 1,
          ack: () => {},
          retry: () => {},
        },
      ],
      ackAll: () => {},
      retryAll: () => {},
    }) as unknown as MessageBatch<{ n: number }>;

  test("adapts each lane's own batch", () => {
    const portable = wrapRuntimeMessageBatch<{ n: number }>(
      facadeBatch(),
      "portable",
    );
    expect(portable.queue).toBe("yurucommu-delivery");
    expect(portable.messages[0]!.body).toEqual({ n: 1 });

    const native = wrapRuntimeMessageBatch<{ n: number }>(cloudflareBatch());
    expect(native.messages[0]!.body).toEqual({ n: 1 });
  });

  test("refuses a batch from the other lane", () => {
    expect(() =>
      wrapRuntimeMessageBatch(cloudflareBatch(), "portable"),
    ).toThrow(RuntimeLaneError);
    expect(() => wrapRuntimeMessageBatch(facadeBatch(), "cloudflare")).toThrow(
      RuntimeLaneError,
    );
  });
});

describe("the published Worker export", () => {
  const portableBindings = () => ({
    YURUCOMMU_RUNTIME_LANE: "portable",
    APP_URL: "https://example.test",
    DB: edgeSql(),
    KV: edgeKv(),
  });

  // A queue name the app does not own: `handleYurucommuQueueBatch` settles the
  // batch and returns, which is enough to prove the whole portable path — lane
  // resolution, batch adaptation, and binding wrapping — ran.
  const foreignBatch = (settle: () => void): EdgeQueueBatch => ({
    batchId: "b",
    queue: "not-a-yurucommu-queue",
    messages: [],
    acknowledgeAll: settle,
    retryAll: () => {},
  });

  test("routes a portable queue event through the portable lane", async () => {
    let settled = false;
    await worker.queue(
      foreignBatch(() => {
        settled = true;
      }),
      portableBindings() as never,
    );
    expect(settled).toBe(true);
  });

  test("refuses a portable queue event when the lane is not declared", async () => {
    const bindings = portableBindings() as Record<string, unknown>;
    delete bindings.YURUCOMMU_RUNTIME_LANE;
    await expect(
      worker.queue(
        foreignBatch(() => {}),
        bindings as never,
      ),
    ).rejects.toThrow(RuntimeLaneError);
  });
});
