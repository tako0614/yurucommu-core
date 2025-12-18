import { describe, expect, it, vi } from "vitest";
import appRpcRoutes from "./app-rpc";

const mockChatCompletion = vi.fn();
const mockEmbed = vi.fn();

vi.mock("@takos/platform/server", async () => {
  const actual = await vi.importActual<any>("@takos/platform/server");
  return {
    ...actual,
    chatCompletion: (...args: any[]) => mockChatCompletion(...args),
    embed: (...args: any[]) => mockEmbed(...args),
  };
});

function createMockKv() {
  const store = new Map<string, string>();
  return {
    async get(key: string, type?: "text") {
      const value = store.get(key) ?? null;
      if (!value) return null;
      if (type === "text") return value;
      return value;
    },
    async put(key: string, value: string) {
      store.set(key, value);
    },
    async delete(key: string) {
      store.delete(key);
    },
    async list({ prefix }: { prefix: string; cursor?: string }) {
      const keys = Array.from(store.keys())
        .filter((name) => name.startsWith(prefix))
        .map((name) => ({ name }));
      return { keys };
    },
  };
}

const postRpc = async (env: any, payload: unknown) => {
  return appRpcRoutes.fetch(
    new Request("http://takos.internal/-/internal/app-rpc", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-takos-app-rpc-token": env.TAKOS_APP_RPC_TOKEN,
      },
      body: JSON.stringify(payload),
    }),
    env,
    {} as any,
  );
};

describe("/-/internal/app-rpc", () => {
  it("rejects db collections outside app:* namespace", async () => {
    const env: any = { TAKOS_APP_RPC_TOKEN: "test-token" };
    const res = await postRpc(env, { kind: "db", collection: "core:notes", method: "get", args: [] });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toMatchObject({ ok: false });
    expect(body.error.message).toMatch(/app:/);
  });

  it("rejects dangerous db method names", async () => {
    const env: any = { TAKOS_APP_RPC_TOKEN: "test-token" };
    const res = await postRpc(env, { kind: "db", collection: "app:notes", method: "__proto__", args: [] });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toMatchObject({ ok: false });
  });

  it("rejects dangerous services path segments", async () => {
    const env: any = { TAKOS_APP_RPC_TOKEN: "test-token" };
    const res = await postRpc(env, { kind: "services", path: ["__proto__", "x"], args: [] });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toMatchObject({ ok: false });
  });

  it("rejects calling disallowed services", async () => {
    const env: any = { TAKOS_APP_RPC_TOKEN: "test-token" };
    const res = await postRpc(env, { kind: "services", path: ["auth", "login"], args: [] });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body).toMatchObject({ ok: false });
  });

  it("supports storage put/getText for app:* buckets", async () => {
    const env: any = { TAKOS_APP_RPC_TOKEN: "test-token", APP_STATE: createMockKv() };
    const putRes = await postRpc(env, {
      kind: "storage",
      bucket: "app:assets",
      method: "put",
      args: ["hello.txt", { encoding: "utf8", data: "hello" }, { contentType: "text/plain" }],
    });
    expect(putRes.status).toBe(200);
    const getRes = await postRpc(env, {
      kind: "storage",
      bucket: "app:assets",
      method: "getText",
      args: ["hello.txt"],
    });
    expect(getRes.status).toBe(200);
    const body = await getRes.json();
    expect(body).toMatchObject({ ok: true, result: "hello" });
  });

  it("accepts any token from TAKOS_APP_RPC_TOKEN list (rotation)", async () => {
    const env: any = { TAKOS_APP_RPC_TOKEN: "old-token, new-token", APP_STATE: createMockKv() };
    const res = await appRpcRoutes.fetch(
      new Request("http://takos.internal/-/internal/app-rpc", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-takos-app-rpc-token": "new-token",
        },
        body: JSON.stringify({ kind: "storage", bucket: "app:assets", method: "list", args: [{ prefix: "" }] }),
      }),
      env,
      {} as any,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true });
  });

  it("rejects workspaceId unless mode is dev", async () => {
    const env: any = { TAKOS_APP_RPC_TOKEN: "test-token", APP_STATE: createMockKv() };
    const res = await postRpc(env, {
      kind: "storage",
      bucket: "app:assets",
      method: "list",
      args: [{ prefix: "" }],
      workspaceId: "ws_prod",
      mode: "prod",
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toMatchObject({ ok: false });
    expect(body.error.message).toMatch(/workspaceId/);
  });

  it("redacts stack traces outside development", async () => {
    const env: any = { TAKOS_APP_RPC_TOKEN: "test-token", ENVIRONMENT: "production" };
    const res = await postRpc(env, {
      kind: "storage",
      bucket: "app:assets",
      method: "list",
      args: [{ prefix: "" }],
    });
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body).toMatchObject({ ok: false });
    expect(body.error.stack).toBeUndefined();
  });

  it("includes stack traces in development", async () => {
    const env: any = { TAKOS_APP_RPC_TOKEN: "test-token", ENVIRONMENT: "development" };
    const res = await postRpc(env, {
      kind: "storage",
      bucket: "app:assets",
      method: "list",
      args: [{ prefix: "" }],
    });
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body).toMatchObject({ ok: false });
    expect(typeof body.error.stack).toBe("string");
  });

  it("rejects AI calls when unauthenticated", async () => {
    const env: any = {
      TAKOS_APP_RPC_TOKEN: "test-token",
      takosConfig: { schema_version: "3.0", distro: "oss", ai: { enabled: true } },
    };
    const res = await postRpc(env, {
      kind: "ai",
      method: "chat.completions.create",
      args: [{ model: "x", messages: [] }],
      auth: { userId: null, isAuthenticated: false },
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body).toMatchObject({ ok: false });
  });

  it("returns 503 when AI external network is disabled", async () => {
    const env: any = {
      TAKOS_APP_RPC_TOKEN: "test-token",
      takosConfig: {
        schema_version: "3.0",
        distro: "oss",
        ai: { enabled: true, requires_external_network: false },
      },
    };
    const res = await postRpc(env, {
      kind: "ai",
      method: "chat.completions.create",
      args: [{ model: "x", messages: [] }],
      auth: { userId: "user123", isAuthenticated: true, plan: { name: "pro", limits: {}, features: [] }, limits: {} },
    });
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body).toMatchObject({ ok: false });
  });

  it("passes tools options through AI RPC", async () => {
    mockChatCompletion.mockReset();
    mockChatCompletion.mockResolvedValueOnce({
      id: "chatcmpl_1",
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: "", tool_calls: [{ id: "call_1" }] },
          finishReason: "tool_calls",
        },
      ],
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    });

    const env: any = {
      TAKOS_APP_RPC_TOKEN: "test-token",
      takosConfig: {
        schema_version: "3.0",
        distro: "oss",
        ai: {
          enabled: true,
          default_provider: "openai",
          providers: {
            openai: { type: "openai", api_key_env: "AI_OPENAI_API_KEY" },
          },
        },
      },
      AI_OPENAI_API_KEY: "test",
    };

    const res = await postRpc(env, {
      kind: "ai",
      method: "chat.completions.create",
      args: [
        {
          model: "x",
          messages: [{ role: "user", content: "hi" }],
          tools: [{ type: "function", function: { name: "tool.echo" } }],
          tool_choice: "auto",
          response_format: { type: "json_object" },
        },
      ],
      auth: {
        userId: "user123",
        isAuthenticated: true,
        plan: { name: "pro", limits: { aiRequests: Number.MAX_SAFE_INTEGER }, features: ["ai"] },
        limits: { aiRequests: Number.MAX_SAFE_INTEGER },
      },
    });

    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body).toMatchObject({ ok: true });

    expect(mockChatCompletion).toHaveBeenCalledTimes(1);
    const callArgs = mockChatCompletion.mock.calls[0];
    const options = callArgs[2] ?? {};
    expect(options.tools).toEqual([{ type: "function", function: { name: "tool.echo" } }]);
    expect(options.toolChoice).toBe("auto");
    expect(options.responseFormat).toEqual({ type: "json_object" });

    expect(body.result?.choices?.[0]?.message?.tool_calls).toBeTruthy();
  });

  it("rejects outbound rpc when disabled", async () => {
    const env: any = { TAKOS_APP_RPC_TOKEN: "test-token" };
    const res = await postRpc(env, { kind: "outbound", url: "https://example.com" });
    expect(res.status).toBe(403);
  });

  it("rejects outbound rpc during authenticated requests", async () => {
    const env: any = { TAKOS_APP_RPC_TOKEN: "test-token", TAKOS_OUTBOUND_RPC_ENABLED: "true" };
    const res = await postRpc(env, {
      kind: "outbound",
      url: "https://example.com",
      auth: { userId: "u1", isAuthenticated: true },
    });
    expect(res.status).toBe(403);
  });

  it("performs outbound fetch for background jobs when enabled", async () => {
    const originalFetch = globalThis.fetch;
    const fetchMock = vi.fn(async () => new Response("ok", { status: 200, headers: { "x-test": "1" } }));
    // @ts-ignore
    globalThis.fetch = fetchMock;

    const env: any = { TAKOS_APP_RPC_TOKEN: "test-token", TAKOS_OUTBOUND_RPC_ENABLED: "true" };
    const res = await postRpc(env, {
      kind: "outbound",
      url: "https://remote.example/test",
      init: { method: "POST", headers: { "content-type": "text/plain" }, body: { encoding: "utf8", data: "hi" } },
      auth: null,
    });
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body).toMatchObject({ ok: true });
    expect(body.result?.status).toBe(200);
    expect(body.result?.headers?.["x-test"]).toBe("1");
    expect(body.result?.body?.encoding).toBe("base64");
    expect(typeof body.result?.body?.data).toBe("string");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // @ts-ignore
    globalThis.fetch = originalFetch;
  });

  it("records AP delivery usage when outbound metering header is present", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-01-02T03:04:05.000Z"));

    const kvStore = new Map<string, string>();
    const kv = {
      get: vi.fn(async (key: string) => kvStore.get(key) ?? null),
      put: vi.fn(async (key: string, value: string) => {
        kvStore.set(key, value);
      }),
    };

    const originalFetch = globalThis.fetch;
    const fetchMock = vi.fn(async (_url: string, init: any) => {
      const headers = new Headers(init?.headers);
      expect(headers.get("x-takos-meter-ap-delivery")).toBeNull();
      return new Response("ok", { status: 200 });
    });
    // @ts-ignore
    globalThis.fetch = fetchMock;

    const env: any = { TAKOS_APP_RPC_TOKEN: "test-token", TAKOS_OUTBOUND_RPC_ENABLED: "true", APP_STATE: kv };
    const res = await postRpc(env, {
      kind: "outbound",
      url: "https://remote.example/test",
      init: { headers: { "x-takos-meter-ap-delivery": "2" } },
      auth: { userId: "u1", isAuthenticated: false },
    });
    expect(res.status).toBe(200);

    expect(kvStore.get("usage:u1:ap:day:2025-01-02")).toBe("2");
    expect(kvStore.get("usage:u1:ap:minute:2025-01-02-0304")).toBe("2");

    // @ts-ignore
    globalThis.fetch = originalFetch;
    vi.useRealTimers();
  });

  it("rate limits outbound when limit is zero", async () => {
    const env: any = {
      TAKOS_APP_RPC_TOKEN: "test-token",
      TAKOS_OUTBOUND_RPC_ENABLED: "true",
      OUTBOUND_RATE_LIMIT_PER_MINUTE: "0",
    };
    const res = await postRpc(env, { kind: "outbound", url: "https://remote.example/test", auth: null });
    expect(res.status).toBe(429);
  });
});
