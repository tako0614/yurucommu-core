import { describe, expect, it } from "vitest";

import {
  assertActionsInAllowlist,
  createAiActionRegistry,
  dispatchAiAction,
  type AiActionDefinition,
} from "./action-registry.js";
import { TAKOS_CONFIG_SCHEMA_VERSION } from "../config/takos-config.js";
import type { JsonSchema, TakosConfig } from "../config/takos-config.js";

const schema: JsonSchema = { type: "object" };

function buildDefinition(id: string, dataPolicy: AiActionDefinition["dataPolicy"] = {}): AiActionDefinition {
  return {
    id,
    label: "Test Action",
    description: "Test",
    inputSchema: schema,
    outputSchema: schema,
    providerCapabilities: ["chat"],
    dataPolicy,
  };
}

function buildConfig(ai?: Partial<TakosConfig["ai"]>): TakosConfig {
  return {
    schema_version: TAKOS_CONFIG_SCHEMA_VERSION,
    distro: { name: "test", version: "1.0.0" },
    node: { url: "https://example.com" },
    ai: {
      enabled: true,
      enabled_actions: ["ai.echo"],
      data_policy: {
        send_public_posts: true,
        send_community_posts: true,
        send_dm: true,
        send_profile: true,
      },
      ...ai,
    },
  };
}

describe("AI action registry", () => {
  it("registers actions and lists normalized definitions", () => {
    const registry = createAiActionRegistry();
    const definition = buildDefinition("ai.summary", { sendPublicPosts: true });

    registry.register({ definition, handler: async () => ({ ok: true }) });

    const listed = registry.listActions();
    expect(listed).toHaveLength(1);
    expect(listed[0].dataPolicy.sendPublicPosts).toBe(true);
    expect(listed[0].dataPolicy.sendDm).toBe(false);
  });

  it("rejects duplicate registrations", () => {
    const registry = createAiActionRegistry();
    const definition = buildDefinition("ai.summary");

    registry.register({ definition, handler: async () => null });

    expect(() => registry.register({ definition, handler: async () => null })).toThrow(
      /already registered/i,
    );
  });

  it("blocks dispatch when AI is disabled", async () => {
    const registry = createAiActionRegistry();
    const definition = buildDefinition("ai.echo");

    registry.register({ definition, handler: async () => "ok" });

    await expect(
      dispatchAiAction(registry, "ai.echo", { nodeConfig: buildConfig({ enabled: false }) }, {}),
    ).rejects.toThrow(/disabled/i);
  });

  it("blocks dispatch when the action is not enabled on the node", async () => {
    const registry = createAiActionRegistry();
    const definition = buildDefinition("ai.echo");

    registry.register({ definition, handler: async () => "ok" });

    await expect(
      dispatchAiAction(
        registry,
        "ai.echo",
        { nodeConfig: buildConfig({ enabled_actions: [] }) },
        {},
      ),
    ).rejects.toThrow(/not enabled/i);
  });

  it("enforces node data policy before dispatch", async () => {
    const registry = createAiActionRegistry();
    const definition = buildDefinition("ai.echo", { sendDm: true });

    registry.register({ definition, handler: async () => "ok" });

    await expect(
      dispatchAiAction(
        registry,
        "ai.echo",
        {
          nodeConfig: buildConfig({
            data_policy: {
              send_public_posts: true,
              send_community_posts: true,
              send_dm: false,
              send_profile: true,
            },
          }),
        },
        {},
      ),
    ).rejects.toThrow(/DataPolicyViolation/i);
  });

  it("dispatches when enabled and allowed by policy", async () => {
    const registry = createAiActionRegistry();
    const definition = buildDefinition("ai.echo");

    registry.register({
      definition,
      handler: async (_ctx, input: any) => ({ echoed: input.message }),
    });

    const result = await dispatchAiAction<{ message: string }, { echoed: string }>(
      registry,
      "ai.echo",
      { nodeConfig: buildConfig() },
      { message: "hello" },
    );

    expect(result.echoed).toBe("hello");
  });

  it("accepts enabled actions that are present in the takos-profile allowlist", () => {
    expect(() =>
      assertActionsInAllowlist(["ai.echo", "ai.summary"], ["ai.summary", "ai.echo", "ai.chat"]),
    ).not.toThrow();
  });

  it("rejects enabled actions that are missing from the takos-profile allowlist", () => {
    expect(() => assertActionsInAllowlist(["ai.echo", "ai.unknown"], ["ai.echo"])).toThrow(
      /not allowed by takos-profile/i,
    );
  });
});
