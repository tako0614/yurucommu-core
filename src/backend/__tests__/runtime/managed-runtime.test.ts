import { describe, expect, test } from "bun:test";

import {
  ManagedRuntimeGatewayError,
  createManagedRuntimeKeyValueStore,
  createManagedRuntimeObjectStorage,
  createManagedRuntimeQueueProducer,
  type ManagedRuntimeGateway,
} from "../../runtime/managed-runtime.ts";

function materialization() {
  return {
    contract: "takosumi.managed-runtime-connection/v1",
    gateway: {
      binding: "YURUCOMMU_MANAGED_RUNTIME",
      transport: "fetch",
    },
    connections: [
      {
        alias: "delivery",
        authority: {
          workspaceId: "ws_example",
          subject: "capsule:cap_example",
          resourceId: "tkrn:ws_example:Queue:queue",
          resourceKind: "Queue",
          resourceGeneration: 3,
          permissions: ["takosumi.managed-runtime.invoke"],
          interfaceId: "if_queue",
          interfaceBindingId: "ifb_queue",
          interfaceResolvedRevision: 4,
          audience: "https://runtime.example.test/v1/resources",
          capabilityRef: "secret:runtime/capability/queue",
        },
      },
      {
        alias: "cache",
        authority: {
          workspaceId: "ws_example",
          subject: "capsule:cap_example",
          resourceId: "tkrn:ws_example:KeyValueStore:cache",
          resourceKind: "KeyValueStore",
          resourceGeneration: 2,
          permissions: ["takosumi.managed-runtime.invoke"],
          interfaceId: "if_cache",
          interfaceBindingId: "ifb_cache",
          interfaceResolvedRevision: 2,
          audience: "https://runtime.example.test/v1/resources",
          capabilityRef: "secret:runtime/capability/cache",
        },
      },
      {
        alias: "media",
        authority: {
          workspaceId: "ws_example",
          subject: "capsule:cap_example",
          resourceId: "tkrn:ws_example:ObjectBucket:media",
          resourceKind: "ObjectBucket",
          resourceGeneration: 2,
          permissions: ["takosumi.managed-runtime.invoke"],
          interfaceId: "if_media",
          interfaceBindingId: "ifb_media",
          interfaceResolvedRevision: 2,
          audience: "https://runtime.example.test/v1/resources",
          capabilityRef: "secret:runtime/capability/media",
        },
      },
    ],
  };
}

describe("managed runtime queue producer", () => {
  test("sends provider-neutral JSON messages through the exact gateway authority", async () => {
    const requests: Request[] = [];
    const gateway: ManagedRuntimeGateway = {
      async fetch(request) {
        requests.push(request);
        return Response.json({ accepted: true, messageId: "msg_1" });
      },
    };
    const queue = createManagedRuntimeQueueProducer<{ id: string }>({
      materialization: materialization(),
      gateway,
      alias: "delivery",
      idempotencyKey: () => "yurucommu.queue:test-send",
    });

    await queue.send({ id: "delivery_1" }, { delaySeconds: 12 });

    expect(requests).toHaveLength(1);
    const request = requests[0]!;
    expect(request.method).toBe("POST");
    expect(new URL(request.url).pathname).toBe(
      "/v1/resources/tkrn%3Aws_example%3AQueue%3Aqueue/queue/messages",
    );
    expect(request.headers.get("idempotency-key")).toBe(
      "yurucommu.queue:test-send",
    );
    expect(
      request.headers.get("x-takosumi-managed-runtime-capability-ref"),
    ).toBe("secret:runtime/capability/queue");
    expect(await request.json()).toEqual({
      message: { type: "json", body: { id: "delivery_1" } },
      delaySeconds: 12,
    });
  });

  test("preserves per-message and default batch delay semantics", async () => {
    let captured: Request | undefined;
    const queue = createManagedRuntimeQueueProducer<string>({
      materialization: materialization(),
      gateway: {
        async fetch(request) {
          captured = request;
          return Response.json({ accepted: true });
        },
      },
      alias: "delivery",
      idempotencyKey: () => "yurucommu.queue:test-batch",
    });

    await queue.sendBatch([{ body: "one" }, { body: "two", delaySeconds: 9 }], {
      delaySeconds: 3,
    });

    expect(new URL(captured!.url).pathname).toBe(
      "/v1/resources/tkrn%3Aws_example%3AQueue%3Aqueue/queue/messages/batch",
    );
    expect(await captured!.json()).toEqual({
      messages: [
        { message: { type: "json", body: "one" } },
        {
          message: { type: "json", body: "two" },
          delaySeconds: 9,
        },
      ],
      defaultDelaySeconds: 3,
    });
  });

  test("fails closed on authority mismatch and never invokes the gateway", () => {
    let invoked = false;
    const invalid = materialization();
    invalid.connections[0]!.authority.resourceKind = "KeyValueStore";
    invalid.connections[0]!.authority.resourceId =
      "tkrn:ws_example:KeyValueStore:queue";

    expect(() =>
      createManagedRuntimeQueueProducer({
        materialization: invalid,
        gateway: {
          async fetch() {
            invoked = true;
            return Response.json({ accepted: true });
          },
        },
        alias: "delivery",
      }),
    ).toThrow("connection_authority_mismatch");
    expect(invoked).toBe(false);
  });

  test("surfaces retryability without retrying or falling back", async () => {
    let attempts = 0;
    const queue = createManagedRuntimeQueueProducer({
      materialization: materialization(),
      gateway: {
        async fetch() {
          attempts += 1;
          return Response.json(
            { error: "managed_runtime_busy" },
            { status: 503 },
          );
        },
      },
      alias: "delivery",
      idempotencyKey: () => "yurucommu.queue:test-fail",
    });

    try {
      await queue.send({ id: "delivery_1" });
      throw new Error("expected managed runtime failure");
    } catch (error) {
      expect(error).toBeInstanceOf(ManagedRuntimeGatewayError);
      expect(error).toMatchObject({
        code: "managed_runtime_busy",
        status: 503,
        retryable: true,
      });
    }
    expect(attempts).toBe(1);
  });

  test("bounds gateway response bodies before JSON parsing", async () => {
    const queue = createManagedRuntimeQueueProducer({
      materialization: materialization(),
      gateway: {
        async fetch() {
          return new Response("x".repeat(65), {
            headers: { "content-length": "65" },
          });
        },
      },
      alias: "delivery",
      idempotencyKey: () => "yurucommu.queue:test-large",
      maxResponseBytes: 64,
    });

    await expect(queue.send({ id: "delivery_1" })).rejects.toMatchObject({
      code: "managed_runtime_response_too_large",
      status: 502,
      retryable: false,
    });
  });
});

describe("managed runtime data adapters", () => {
  test("KV preserves TTL and metadata and returns the portable list shape", async () => {
    const requests: Request[] = [];
    const kv = createManagedRuntimeKeyValueStore({
      materialization: materialization(),
      gateway: {
        async fetch(request) {
          requests.push(request.clone());
          const url = new URL(request.url);
          if (request.method === "PUT" || request.method === "DELETE") {
            return Response.json({ ok: true });
          }
          if (url.pathname.endsWith("/kv/keys")) {
            return Response.json({
              keys: [
                {
                  name: "rate:user",
                  expiration: 123,
                  metadata: { source: "rate-limit" },
                },
              ],
              cursor: "next",
            });
          }
          return new Response('{"count":1}', {
            headers: { "content-type": "application/json" },
          });
        },
      },
      alias: "cache",
      idempotencyKey: () => "yurucommu.kv:test",
    });

    await kv.put("rate:user", '{"count":1}', {
      expirationTtl: 60,
      metadata: { source: "rate-limit" },
    });
    expect(
      requests[0]!.headers.get("x-takosumi-managed-runtime-kv-expiration-ttl"),
    ).toBe("60");
    expect(
      JSON.parse(
        decodeURIComponent(
          requests[0]!.headers.get("x-takosumi-managed-runtime-kv-metadata")!,
        ),
      ),
    ).toEqual({ source: "rate-limit" });
    expect(await requests[0]!.text()).toBe('{"count":1}');
    expect(
      await kv.get<{ count: number }>("rate:user", { type: "json" }),
    ).toEqual({ count: 1 });
    expect(await kv.list({ prefix: "rate:" })).toEqual({
      keys: [
        {
          name: "rate:user",
          expiration: 123,
          metadata: { source: "rate-limit" },
        },
      ],
      list_complete: false,
      cursor: "next",
    });
    await kv.delete("rate:user");
    expect(requests[3]!.method).toBe("DELETE");
    expect(JSON.stringify(requests)).not.toContain("cloudflare");
  });

  test("ObjectBucket preserves content metadata and exposes the runtime storage contract", async () => {
    const requests: Request[] = [];
    const storage = createManagedRuntimeObjectStorage({
      materialization: materialization(),
      gateway: {
        async fetch(request) {
          requests.push(request.clone());
          const url = new URL(request.url);
          if (request.method === "PUT" || request.method === "DELETE") {
            return Response.json({ ok: true });
          }
          if (url.pathname.endsWith("/objects")) {
            return Response.json({
              objects: [
                {
                  key: "images/one.png",
                  size: 5,
                  uploaded: "2026-07-29T00:00:00.000Z",
                  etag: "etag",
                },
              ],
              truncated: false,
            });
          }
          return new Response(request.method === "HEAD" ? null : "image", {
            headers: {
              "content-type": "image/png",
              "content-length": "5",
              etag: '"etag"',
              "x-takosumi-object-custom-metadata": encodeURIComponent(
                JSON.stringify({ owner: "capsule" }),
              ),
            },
          });
        },
      },
      alias: "media",
      idempotencyKey: () => "yurucommu.object:test",
    });

    await storage.put("images/one.png", "image", {
      httpMetadata: { contentType: "image/png" },
      customMetadata: { owner: "capsule" },
    });
    expect(requests[0]!.headers.get("content-type")).toBe("image/png");
    expect(
      JSON.parse(
        decodeURIComponent(
          requests[0]!.headers.get("x-takosumi-object-custom-metadata")!,
        ),
      ),
    ).toEqual({ owner: "capsule" });

    const object = await storage.get("images/one.png");
    expect(object?.httpMetadata?.contentType).toBe("image/png");
    expect(object?.customMetadata).toEqual({ owner: "capsule" });
    expect(await object?.text()).toBe("image");
    expect(await storage.head("images/one.png")).toMatchObject({
      contentLength: 5,
      customMetadata: { owner: "capsule" },
    });
    expect(await storage.list({ prefix: "images/" })).toMatchObject({
      objects: [
        {
          key: "images/one.png",
          size: 5,
          uploaded: new Date("2026-07-29T00:00:00.000Z"),
        },
      ],
      truncated: false,
    });
    await storage.delete("images/one.png");
    expect(requests.at(-1)!.method).toBe("DELETE");
  });
});
