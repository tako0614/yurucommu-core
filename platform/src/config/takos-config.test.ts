import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import type { TakosConfig } from "./takos-config.js";
import {
  TAKOS_CONFIG_SCHEMA_VERSION,
  loadTakosConfig,
  parseTakosConfig,
  validateTakosConfig,
  DEFAULT_TAKOS_AI_CONFIG,
  mergeTakosAiConfig,
} from "./takos-config.js";

function createValidConfig(): TakosConfig {
  return {
    schema_version: TAKOS_CONFIG_SCHEMA_VERSION,
    distro: { name: "takos-distro-standard", version: "1.0.0" },
    node: {
      url: "https://node.example.com",
      instance_name: "Example Node",
      default_language: "ja-JP",
      registration: { mode: "invite-only" as const },
    },
    ui: {
      theme: "standard",
      accent_color: "#0080ff",
      logo_url: "/static/logo.svg",
      allow_custom_css: false,
    },
    activitypub: {
      federation_enabled: true,
      blocked_instances: ["spam.example"],
      outbox_signing: { require_http_signatures: true },
    },
    ai: {
      enabled: true,
      default_provider: "openai-main",
      enabled_actions: ["ai.summary"],
      providers: {
        "openai-main": {
          type: "openai",
          base_url: "https://api.openai.com/v1",
          model: "gpt-5.1-mini",
          api_key_env: "OPENAI_API_KEY",
        },
      },
      data_policy: { send_public_posts: true, send_dm: false },
      agent_config_allowlist: ["ai.enabled_actions"],
    },
    custom: { feature_flag: true },
  };
}

describe("takos-config loader", () => {
  it("parses a valid config payload", () => {
    const config = createValidConfig();
    const parsed = parseTakosConfig(JSON.stringify(config));

    expect(parsed.schema_version).toBe(TAKOS_CONFIG_SCHEMA_VERSION);
    expect(parsed.node.url).toBe(config.node.url);
    expect(parsed.ai?.providers?.["openai-main"]?.type).toBe("openai");
    expect(parsed.activitypub?.blocked_instances).toEqual(["spam.example"]);
  });

  it("rejects unknown provider types", () => {
    const config = createValidConfig();
    config.ai = {
      ...config.ai,
      providers: { bad: { type: "vendor-x" } as any },
    };

    const result = validateTakosConfig(config);
    expect(result.ok).toBe(false);
    expect(result.errors.some((message) => message.includes("ai.providers.bad.type"))).toBe(true);
  });

  it("validates agent config allowlist entries", () => {
    const validConfig = createValidConfig();
    validConfig.ai = {
      ...validConfig.ai,
      agent_config_allowlist: ["ai.enabled_actions", "custom.flag"],
    };
    const valid = validateTakosConfig(validConfig);
    expect(valid.ok).toBe(true);

    const invalidConfig = createValidConfig();
    invalidConfig.ai = {
      ...invalidConfig.ai,
      agent_config_allowlist: ["   ", 123 as any],
    };
    const invalid = validateTakosConfig(invalidConfig);
    expect(invalid.ok).toBe(false);
    expect(invalid.errors.some((message) => message.includes("agent_config_allowlist"))).toBe(true);
  });

  it("loads from a file path", async () => {
    const dir = await mkdtemp(join(tmpdir(), "takos-config-"));
    const filePath = join(dir, "takos-config.json");
    const config = createValidConfig();

    await writeFile(filePath, JSON.stringify(config), "utf-8");
    const loaded = await loadTakosConfig(filePath);

    expect(loaded.distro.name).toBe(config.distro.name);
    expect(loaded.ui?.accent_color).toBe("#0080ff");

    await rm(dir, { recursive: true, force: true });
  });

  it("merges AI config with defaults and deduplicates actions", () => {
    const merged = mergeTakosAiConfig(
      {
        ai_feature_flag: true,
        enabled_actions: ["ai.summary", "ai.summary", "ai.tag-suggest"],
        data_policy: { send_public_posts: true },
        agent_config_allowlist: ["ai.enabled_actions", " ai.enabled_actions "],
      } as any,
      {
        enabled: true,
        enabled_actions: ["ai.moderation"],
        data_policy: { send_dm: true },
        agent_config_allowlist: ["custom.ai.toggle", "ai.enabled_actions"],
      },
    );

    expect(merged.enabled).toBe(true);
    expect(merged.enabled_actions).toEqual(["ai.summary", "ai.tag-suggest", "ai.moderation"]);
    expect(merged.data_policy).toEqual({ ...DEFAULT_TAKOS_AI_CONFIG.data_policy, send_public_posts: true, send_dm: true });
    expect(merged.agent_config_allowlist).toEqual(["custom.ai.toggle", "ai.enabled_actions"]);
  });
});
