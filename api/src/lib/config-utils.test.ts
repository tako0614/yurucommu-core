import { describe, expect, it } from "vitest";
import { TAKOS_CONFIG_SCHEMA_VERSION } from "@takos/platform/server";
import {
  buildRuntimeConfig,
  checkDistroCompatibility,
  diffConfigs,
  stripSecretsFromConfig,
} from "./config-utils";

describe("config utils", () => {
  it("strips secrets while keeping env references", () => {
    const stripped: string[] = [];
    const config = {
      schema_version: TAKOS_CONFIG_SCHEMA_VERSION,
      distro: { name: "takos-oss", version: "1.0.0" },
      node: { url: "https://example.com" },
      ai: {
        providers: {
          main: {
            type: "openai",
            api_key_env: "OPENAI_API_KEY",
            api_key: "should-be-removed",
          },
        },
      },
      custom: {
        auth_password: "secret-password",
        nested: { token: "hidden", visible: "ok" },
      },
    };

    const sanitized = stripSecretsFromConfig(config, stripped);

    expect((sanitized.ai?.providers as any).main.api_key).toBeUndefined();
    expect((sanitized.ai?.providers as any).main.api_key_env).toBe("OPENAI_API_KEY");
    expect(sanitized.custom?.["auth_password"]).toBeUndefined();
    expect((sanitized.custom as any).nested.token).toBeUndefined();
    expect((sanitized.custom as any).nested.visible).toBe("ok");
    expect(stripped).toContain("ai.providers.main.api_key");
    expect(stripped).toContain("custom.auth_password");
    expect(stripped).toContain("custom.nested.token");
  });

  it("checks distro compatibility and warns on minor or patch differences", () => {
    const current = { name: "takos-oss", version: "1.0.0" };
    const patch = checkDistroCompatibility(current, { name: "takos-oss", version: "1.0.2" });
    expect(patch.ok).toBe(true);
    expect(patch.warnings.length).toBe(1);

    const minor = checkDistroCompatibility(current, { name: "takos-oss", version: "1.1.0" });
    expect(minor.ok).toBe(true);
    expect(minor.warnings.length).toBeGreaterThan(0);

    const major = checkDistroCompatibility(current, { name: "takos-oss", version: "2.0.0" });
    expect(major.ok).toBe(false);
    expect(major.error).toContain("major version mismatch");

    const forced = checkDistroCompatibility(current, { name: "takos-oss", version: "2.0.0" }, true);
    expect(forced.ok).toBe(true);
    expect(forced.warnings.some((msg) => msg.includes("forced import"))).toBe(true);
  });

  it("builds runtime config from env with defaults", () => {
    const env: any = {
      INSTANCE_DOMAIN: "node.example.com",
      DISTRO_NAME: "takos-oss",
      DISTRO_VERSION: "1.0.0",
    };

    const config = buildRuntimeConfig(env);

    expect(config.schema_version).toBe(TAKOS_CONFIG_SCHEMA_VERSION);
    expect(config.node.url).toBe("https://node.example.com");
    expect(config.node.registration?.mode).toBe("invite-only");
    expect(config.distro.name).toBe("takos-oss");
    expect(config.distro.version).toBe("1.0.0");
    expect(config.ai?.agent_config_allowlist).toEqual([]);
  });

  it("reads AI agent config allowlist from env", () => {
    const env: any = {
      INSTANCE_DOMAIN: "node.example.com",
      DISTRO_NAME: "takos-oss",
      DISTRO_VERSION: "1.0.0",
      AI_AGENT_CONFIG_ALLOWLIST: "ai.enabled_actions,custom.flag",
    };

    const config = buildRuntimeConfig(env);

    expect(config.ai?.agent_config_allowlist).toEqual(["ai.enabled_actions", "custom.flag"]);
  });

  it("produces added/removed/changed entries for config diffs", () => {
    const current = {
      schema_version: TAKOS_CONFIG_SCHEMA_VERSION,
      distro: { name: "takos-oss", version: "1.0.0" },
      node: { url: "https://old.example.com", default_language: "en" },
      ai: { enabled_actions: ["ai.summary"] },
    };

    const incoming = {
      schema_version: TAKOS_CONFIG_SCHEMA_VERSION,
      distro: { name: "takos-oss", version: "1.0.0" },
      node: { url: "https://new.example.com" },
      ai: { enabled_actions: ["ai.summary", "ai.qa"] },
      custom: { featureFlag: true },
    };

    const diff = diffConfigs(current, incoming);
    const paths = diff.map((entry) => entry.path);

    expect(paths).toContain("node.url");
    expect(paths).toContain("node.default_language");
    expect(paths).toContain("ai.enabled_actions");
    expect(paths).toContain("custom.featureFlag");

    const urlChange = diff.find((entry) => entry.path === "node.url");
    expect(urlChange?.change).toBe("changed");
    expect(urlChange?.previous).toBe("https://old.example.com");
    expect(urlChange?.next).toBe("https://new.example.com");

    const removedLanguage = diff.find((entry) => entry.path === "node.default_language");
    expect(removedLanguage?.change).toBe("removed");
    expect(removedLanguage?.previous).toBe("en");

    const addedFlag = diff.find((entry) => entry.path === "custom.featureFlag");
    expect(addedFlag?.change).toBe("added");
    expect(addedFlag?.next).toBe(true);
  });
});
