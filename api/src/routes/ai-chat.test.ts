import { afterEach, describe, expect, it, vi } from "vitest";
import aiChatRoutes from "./ai-chat";
import { createJWT } from "@takos/platform/server";
import { getDefaultDataFactory, setBackendDataFactory } from "../data";

const defaultFactory = getDefaultDataFactory();
const originalFetch = global.fetch;

const user = { id: "testuser", handle: "testuser" };
const jwtSecret = "secret";

const buildEnv = (overrides?: Record<string, unknown>) => ({
  INSTANCE_DOMAIN: "example.com",
  AI_ENABLED: "true",
  AI_ENABLED_ACTIONS: "ai.chat",
  AI_PROVIDERS_JSON: JSON.stringify({
    "openai-main": {
      type: "openai",
      model: "gpt-4o-mini",
      api_key_env: "OPENAI_KEY",
    },
  }),
  OPENAI_KEY: "sk-test",
  ...overrides,
});

const buildStore = () =>
  ({
    getUser: vi.fn().mockResolvedValue(user),
    getUserJwtSecret: vi.fn().mockResolvedValue(jwtSecret),
    setUserJwtSecret: vi.fn(),
    createSession: vi.fn(),
    getSession: vi.fn(),
    updateSession: vi.fn(),
    deleteSession: vi.fn(),
    disconnect: vi.fn(),
  }) as any;

afterEach(() => {
  setBackendDataFactory(defaultFactory);
  (global as any).fetch = originalFetch;
  vi.restoreAllMocks();
});

const authHeaders = async () => {
  const token = await createJWT(user.id, jwtSecret);
  return {
    Authorization: `Bearer ${token}`,
    "content-type": "application/json",
  };
};

describe("/api/ai/chat", () => {
  it("returns a chat completion from the configured provider", async () => {
    setBackendDataFactory(() => buildStore());

    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({
            choices: [{ message: { role: "assistant", content: "hi there" } }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
    (global as any).fetch = fetchMock as any;

    const res = await aiChatRoutes.request(
      "/api/ai/chat",
      {
        method: "POST",
        headers: await authHeaders(),
        body: JSON.stringify({
          messages: [{ role: "user", content: "hello" }],
        }),
      },
      buildEnv(),
    );

    expect(res.status).toBe(200);
    const json: any = await res.json();
    expect(json.ok).toBe(true);
    expect(json.data.provider).toBe("openai-main");
    expect(json.data.message.content).toBe("hi there");
    expect(fetchMock).toHaveBeenCalledOnce();
    const [, init] = fetchMock.mock.calls[0];
    expect((init as any).body).toContain("hello");
  });

  it("rejects chat when AI is disabled", async () => {
    setBackendDataFactory(() => buildStore());
    const fetchMock = vi.fn();
    (global as any).fetch = fetchMock as any;

    const res = await aiChatRoutes.request(
      "/api/ai/chat",
      {
        method: "POST",
        headers: await authHeaders(),
        body: JSON.stringify({
          messages: [{ role: "user", content: "hello" }],
        }),
      },
      buildEnv({ AI_ENABLED: "false" }),
    );

    expect(res.status).toBe(503);
    const json: any = await res.json();
    expect(json.status).toBe(503);
    expect(String(json.message)).toMatch(/disabled/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects chat when external network access is disabled", async () => {
    setBackendDataFactory(() => buildStore());
    const fetchMock = vi.fn();
    (global as any).fetch = fetchMock as any;

    const res = await aiChatRoutes.request(
      "/api/ai/chat",
      {
        method: "POST",
        headers: await authHeaders(),
        body: JSON.stringify({
          messages: [{ role: "user", content: "hello" }],
        }),
      },
      buildEnv({ AI_REQUIRES_EXTERNAL_NETWORK: "false" }),
    );

    expect(res.status).toBe(503);
    const json: any = await res.json();
    expect(json.status).toBe(503);
    expect(String(json.message)).toMatch(/network/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("blocks chat when ai.chat is not allowlisted", async () => {
    setBackendDataFactory(() => buildStore());
    const fetchMock = vi.fn();
    (global as any).fetch = fetchMock as any;

    const res = await aiChatRoutes.request(
      "/api/ai/chat",
      {
        method: "POST",
        headers: await authHeaders(),
        body: JSON.stringify({
          messages: [{ role: "user", content: "hello" }],
        }),
      },
      buildEnv({ AI_ENABLED_ACTIONS: "" }),
    );

    expect(res.status).toBe(403);
    const json: any = await res.json();
    expect(json.status).toBe(403);
    expect(String(json.message)).toMatch(/ai\.chat/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("enforces agent tool allowlist for inspectService", async () => {
    setBackendDataFactory(() => buildStore());

    const res = await aiChatRoutes.request(
      "/api/ai/chat",
      {
        method: "POST",
        headers: {
          ...(await authHeaders()),
          "x-takos-agent-type": "user",
        },
        body: JSON.stringify({
          tool: "tool.inspectService",
        }),
      },
      buildEnv(),
    );

    expect(res.status).toBe(403);
    const json: any = await res.json();
    expect(json.status).toBe(403);
    expect(typeof json.message).toBe("string");
  });

  it("blocks DM and profile payloads when AI data policy forbids them", async () => {
    setBackendDataFactory(() => buildStore());
    const fetchMock = vi.fn();
    (global as any).fetch = fetchMock as any;

    const res = await aiChatRoutes.request(
      "/api/ai/chat",
      {
        method: "POST",
        headers: await authHeaders(),
        body: JSON.stringify({
          messages: [{ role: "user", content: "summarize my inbox" }],
          dm_messages: [{ text: "secret dm" }],
          profile: { bio: "hidden" },
        }),
      },
      buildEnv({
        AI_DATA_POLICY_JSON: JSON.stringify({ send_dm: false, send_profile: false }),
      }),
    );

    expect(res.status).toBe(400);
    const json: any = await res.json();
    expect(json.status).toBe(400);
    expect(String(json.message)).toMatch(/DataPolicyViolation/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("streams responses when requested", async () => {
    setBackendDataFactory(() => buildStore());

    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("data: chunk\n\n"));
        controller.close();
      },
    });

    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(stream, {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        }),
      );
    (global as any).fetch = fetchMock as any;

    const res = await aiChatRoutes.request(
      "/api/ai/chat",
      {
        method: "POST",
        headers: await authHeaders(),
        body: JSON.stringify({
          messages: [{ role: "user", content: "hello" }],
          stream: true,
        }),
      },
      buildEnv(),
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("x-ai-provider")).toBe("openai-main");
    const text = await res.text();
    expect(text).toContain("data: chunk");
  });
});
