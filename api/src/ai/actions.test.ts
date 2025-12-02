import { describe, expect, it } from "vitest";
import {
  TAKOS_CONFIG_SCHEMA_VERSION,
  createAiActionRegistry,
  dispatchAiAction,
  type TakosConfig,
} from "@takos/platform/server";
import { builtinAiActions, registerBuiltinAiActions } from "./actions";

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
});
