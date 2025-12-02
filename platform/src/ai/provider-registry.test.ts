import { describe, expect, it, vi } from "vitest";
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

  it("blocks provider usage when external network access is disabled", () => {
    const aiConfig: TakosAiConfig = {
      requires_external_network: false,
      providers: {
        local: {
          type: "openai-compatible",
          base_url: "https://llm.local/v1",
          api_key_env: "LLM_KEY",
        },
      },
    };

    const registry = buildAiProviderRegistry(aiConfig, { LLM_KEY: "secret" });
    expect(() => registry.require()).toThrow(/external network access is disabled/i);
  });
});

describe("AiProviderRegistry policy enforcement", () => {
  it("blocks and logs when payload slices violate combined policy", async () => {
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
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(
      registry.callWithPolicy(
        {
          payload: {
            publicPosts: ["post"],
            communityPosts: ["community"],
            dmMessages: ["dm"],
            profile: { bio: "hi" },
          },
          actionPolicy: { sendCommunityPosts: false, sendDm: true },
          actionId: "ai.summary",
        },
        async () => ({ ok: true }),
      ),
    ).rejects.toThrow(/DataPolicyViolation/i);

    expect(warnSpy).toHaveBeenCalled();
    const [message, data] = warnSpy.mock.calls[0] as [string, Record<string, unknown>];
    expect(message).toContain("ai-policy");
    expect(data).toMatchObject({
      blocked_fields: expect.arrayContaining(["sendCommunityPosts", "sendDm", "sendProfile"]),
      actionId: "ai.summary",
      providerId: "local",
    });

    warnSpy.mockRestore();
  });

  it("redacts disallowed slices and executes when no violations are present", async () => {
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
      communityPosts: [] as unknown[],
      profile: { bio: "hi" },
    };

    const redactionLog: string[][] = [];

    const result = await registry.callWithPolicy(
      {
        payload,
        actionPolicy: { sendCommunityPosts: false, sendDm: false },
        onRedaction: (res) => redactionLog.push(res.redacted.map((r) => String(r.field))),
      },
      async ({ provider, payload: sanitized, policy, redacted }) => {
        expect(provider.id).toBe("local");
        expect(policy.sendPublicPosts).toBe(true);
        expect(policy.sendCommunityPosts).toBe(false);
        expect(policy.sendDm).toBe(false);

        expect(sanitized.publicPosts).toEqual(["post"]);
        expect(sanitized.communityPosts).toBeUndefined();
        expect(sanitized.profile).toEqual({ bio: "hi" });

        expect(redacted.map((r) => String(r.field))).toEqual(expect.arrayContaining(["communityPosts"]));

        return { ok: true, sent: sanitized };
      },
    );

    expect(result.result.ok).toBe(true);
    expect(result.payload.publicPosts).toEqual(["post"]);
    expect(result.payload.communityPosts).toBeUndefined();
    expect(result.redacted.map((r) => String(r.field))).toEqual(expect.arrayContaining(["communityPosts"]));
    expect(redactionLog).toHaveLength(1);
    expect(redactionLog[0]).toEqual(expect.arrayContaining(["communityPosts"]));
  });
});
