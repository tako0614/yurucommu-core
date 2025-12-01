import { describe, expect, it } from "vitest";
import type { TakosAiConfig } from "../config/takos-config";
import { buildAiProviderRegistry, resolveAiProviders } from "./provider-registry";

describe("resolveAiProviders", () => {
  it("resolves providers with env-backed credentials and presets", () => {
    const aiConfig: TakosAiConfig = {
      enabled: true,
      default_provider: "openai-main",
      providers: {
        "openai-main": {
          type: "openai",
          model: "gpt-5.1-mini",
          api_key_env: "OPENAI_KEY",
        },
        "gemini-main": {
          type: "gemini",
          api_key_env: "GEMINI_KEY",
        },
      },
      data_policy: {
        send_public_posts: true,
        send_dm: false,
      },
    };

    const resolution = resolveAiProviders(aiConfig, {
      OPENAI_KEY: "sk-test",
      GEMINI_KEY: "gm-key",
    });

    expect(resolution.errors).toHaveLength(0);
    expect(resolution.defaultProviderId).toBe("openai-main");

    const openai = resolution.providers.get("openai-main");
    expect(openai?.headers.Authorization).toBe("Bearer sk-test");
    expect(openai?.baseUrl).toBe("https://api.openai.com/v1");

    const gemini = resolution.providers.get("gemini-main");
    expect(gemini?.headers["x-goog-api-key"]).toBe("gm-key");

    expect(resolution.dataPolicy.sendPublicPosts).toBe(true);
    expect(resolution.dataPolicy.sendDm).toBe(false);
  });

  it("surface errors when credentials are missing", () => {
    const aiConfig: TakosAiConfig = {
      providers: {
        "openai-main": {
          type: "openai",
          api_key_env: "OPENAI_KEY",
        },
      },
    };

    const resolution = resolveAiProviders(aiConfig, {});
    expect(resolution.errors).not.toHaveLength(0);
    expect(() => buildAiProviderRegistry(aiConfig, {})).toThrow(/OPENAI_KEY/);
  });
});

describe("AiProviderRegistry redaction", () => {
  it("redacts payload slices based on combined policy", () => {
    const aiConfig: TakosAiConfig = {
      providers: {
        local: {
          type: "openai-compatible",
          base_url: "https://llm.local/v1",
          api_key_env: "LLM_KEY",
        },
      },
      data_policy: {
        send_public_posts: true,
        send_dm: false,
        send_profile: false,
      },
    };

    const registry = buildAiProviderRegistry(aiConfig, { LLM_KEY: "secret" });

    const result = registry.redact(
      {
        publicPosts: ["post"],
        communityPosts: ["community"],
        dmMessages: ["dm"],
        profile: { bio: "hi" },
      },
      {
        sendCommunityPosts: false,
        sendDm: true,
      },
    );

    expect(result.policy.sendPublicPosts).toBe(true);
    expect(result.policy.sendCommunityPosts).toBe(false);
    expect(result.policy.sendDm).toBe(false);

    expect(result.payload.publicPosts).toEqual(["post"]);
    expect(result.payload.communityPosts).toBeUndefined();
    expect(result.payload.dmMessages).toBeUndefined();
    expect(result.payload.profile).toBeUndefined();

    expect(result.redacted.map((r) => r.field)).toEqual(
      expect.arrayContaining(["communityPosts", "dmMessages", "profile"]),
    );
  });

  it("applies the redaction pipeline before executing provider calls", async () => {
    const aiConfig: TakosAiConfig = {
      providers: {
        local: {
          type: "openai-compatible",
          base_url: "https://llm.local/v1",
          api_key_env: "LLM_KEY",
        },
      },
      data_policy: {
        send_public_posts: true,
        send_community_posts: true,
        send_dm: false,
        send_profile: true,
      },
    };

    const registry = buildAiProviderRegistry(aiConfig, { LLM_KEY: "secret" });
    const payload = {
      publicPosts: ["post"],
      communityPosts: ["community"],
      dmMessages: ["dm"],
      profile: { bio: "hi" },
    };

    const redactionLog: string[][] = [];

    const result = await registry.callWithPolicy(
      {
        payload,
        actionPolicy: { sendCommunityPosts: false, sendDm: true },
        onRedaction: (res) => redactionLog.push(res.redacted.map((r) => r.field)),
      },
      async ({ provider, payload: sanitized, policy, redacted }) => {
        expect(provider.id).toBe("local");
        expect(policy.sendPublicPosts).toBe(true);
        expect(policy.sendCommunityPosts).toBe(false);
        expect(policy.sendDm).toBe(false);

        expect(sanitized.publicPosts).toEqual(["post"]);
        expect(sanitized.communityPosts).toBeUndefined();
        expect(sanitized.dmMessages).toBeUndefined();
        expect(sanitized.profile).toEqual({ bio: "hi" });

        expect(redacted.map((r) => r.field)).toEqual(
          expect.arrayContaining(["communityPosts", "dmMessages"]),
        );

        return { ok: true, sent: sanitized };
      },
    );

    expect(result.result.ok).toBe(true);
    expect(result.payload.publicPosts).toEqual(["post"]);
    expect(result.payload.communityPosts).toBeUndefined();
    expect(result.redacted.map((r) => r.field)).toEqual(
      expect.arrayContaining(["communityPosts", "dmMessages"]),
    );
    expect(redactionLog).toHaveLength(1);
    expect(redactionLog[0]).toEqual(expect.arrayContaining(["communityPosts", "dmMessages"]));
    expect(payload.dmMessages).toEqual(["dm"]);
  });
});
