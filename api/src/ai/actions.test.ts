import { afterEach, describe, expect, it, vi } from "vitest";
import {
  TAKOS_CONFIG_SCHEMA_VERSION,
  createAiActionRegistry,
  dispatchAiAction,
  type TakosConfig,
} from "@takos/platform/server";
import { builtinAiActions, registerBuiltinAiActions } from "./actions";

const originalFetch = global.fetch;

const buildConfig = (
  enabledActions: string[],
  aiOverrides: Partial<TakosConfig["ai"]> = {},
): TakosConfig => ({
  schema_version: TAKOS_CONFIG_SCHEMA_VERSION,
  distro: { name: "test", version: "0.0.0" },
  node: { url: "https://example.com" },
  ai: {
    enabled: true,
    enabled_actions: enabledActions,
    data_policy: {
      send_public_posts: true,
      send_community_posts: true,
      send_dm: true,
      send_profile: false,
    },
    ...aiOverrides,
  },
});

afterEach(() => {
  (global as any).fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("builtin AI actions", () => {
  it("registers all built-ins without duplicating entries", () => {
    const registry = createAiActionRegistry();
    registerBuiltinAiActions(registry);
    registerBuiltinAiActions(registry);
    const ids = registry.listActions().map((action) => action.id);

    for (const action of builtinAiActions) {
      expect(ids).toContain(action.definition.id);
    }
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("dispatches summary when enabled and blocks when disabled on the node", async () => {
    const registry = createAiActionRegistry();
    registerBuiltinAiActions(registry);
    const config = buildConfig(["ai.summary"]);

    const summary = await dispatchAiAction(
      registry,
      "ai.summary",
      { nodeConfig: config },
      { text: "Hello world. This is a small document for testing summaries." },
    );
    expect((summary as any).summary.length).toBeGreaterThan(0);

    await expect(
      dispatchAiAction(
        registry,
        "ai.summary",
        { nodeConfig: buildConfig([]) },
        { text: "Should fail" },
      ),
    ).rejects.toThrow(/not enabled/i);
  });

  it("enforces node data policy for dm moderation", async () => {
    const registry = createAiActionRegistry();
    registerBuiltinAiActions(registry);
    const config = buildConfig(["ai.dm-moderator"], {
      data_policy: { send_public_posts: true, send_dm: false },
    });

    await expect(
      dispatchAiAction(
        registry,
        "ai.dm-moderator",
        { nodeConfig: config },
        { messages: [{ text: "Potentially harmful message" }] },
      ),
    ).rejects.toThrow(/DataPolicyViolation/i);
  });

  it("dispatches ai.chat using the configured provider", async () => {
    const registry = createAiActionRegistry();
    registerBuiltinAiActions(registry);
    const config = buildConfig(["ai.chat"]);

    const provider = {
      id: "openai-main",
      type: "openai",
      baseUrl: "https://example.com/v1",
      model: "gpt-test",
      apiKey: "sk-test",
      headers: {},
      requiresExternalNetwork: false,
    };

    const providers = {
      prepareCall: vi.fn().mockReturnValue({
        provider,
        payload: {},
        policy: {},
        redacted: [],
      }),
    } as any;

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "chatcmpl-1",
          object: "chat.completion",
          created: 0,
          model: "gpt-test",
          choices: [{ index: 0, message: { role: "assistant", content: "pong" }, finish_reason: "stop" }],
          usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    (global as any).fetch = fetchMock as any;

    const result = await dispatchAiAction(
      registry,
      "ai.chat",
      { nodeConfig: config, providers },
      { messages: [{ role: "user", content: "ping" }] },
    );

    expect((result as any).provider).toBe("openai-main");
    expect((result as any).model).toBe("gpt-test");
    expect((result as any).message?.content).toBe("pong");
    expect((result as any).usedAi).toBe(true);
    expect(fetchMock).toHaveBeenCalled();
    expect(providers.prepareCall).toHaveBeenCalled();
  });
});
