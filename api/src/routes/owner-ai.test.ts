import { describe, expect, it } from "vitest";
import {
  AI_ACTIONS,
  buildActionStatuses,
  buildProviderStatuses,
} from "./owner-ai";
import { DEFAULT_TAKOS_AI_CONFIG, mergeTakosAiConfig } from "@takos/platform/server";

const baseConfig = mergeTakosAiConfig(DEFAULT_TAKOS_AI_CONFIG, {
  enabled: true,
  providers: {
    "openai-main": {
      type: "openai",
      api_key_env: "OPENAI_KEY",
    },
  },
});

describe("admin AI helpers", () => {
  it("marks providers as configured only when the API key env var is present", () => {
    const providersMissingKey = buildProviderStatuses(baseConfig, {});
    expect(providersMissingKey[0].configured).toBe(false);
    expect(providersMissingKey[0].eligible).toBe(false);

    const providersWithKey = buildProviderStatuses(baseConfig, { OPENAI_KEY: "sk-test" });
    expect(providersWithKey[0].configured).toBe(true);
    expect(providersWithKey[0].eligible).toBe(true);
  });

  it("marks providers as ineligible when external network access is disabled", () => {
    const config = mergeTakosAiConfig(baseConfig, { requires_external_network: false });
    const providers = buildProviderStatuses(config, { OPENAI_KEY: "sk-test" });
    expect(providers[0].configured).toBe(true);
    expect(providers[0].eligible).toBe(false);
  });

  it("blocks DM actions when node policy forbids DM sharing", () => {
    const config = mergeTakosAiConfig(baseConfig, {
      enabled_actions: ["ai.dm-moderator"],
      data_policy: { send_dm: false },
    });
    const providers = buildProviderStatuses(config, { OPENAI_KEY: "sk-test" });
    const actions = buildActionStatuses(AI_ACTIONS, config, providers);
    const dm = actions.find((action) => action.id === "ai.dm-moderator");

    expect(dm?.enabled).toBe(true);
    expect(dm?.eligible).toBe(false);
    expect(dm?.blocked_reasons).toContain("send_dm_blocked");
  });

  it("activates eligible actions when allowlisted", () => {
    const config = mergeTakosAiConfig(baseConfig, {
      enabled_actions: ["ai.summary"],
    });
    const providers = buildProviderStatuses(config, { OPENAI_KEY: "sk-test" });
    const actions = buildActionStatuses(AI_ACTIONS, config, providers);
    const summary = actions.find((action) => action.id === "ai.summary");

    expect(summary?.eligible).toBe(true);
    expect(summary?.active).toBe(true);
    expect(summary?.blocked_reasons.length).toBe(0);
  });
});
