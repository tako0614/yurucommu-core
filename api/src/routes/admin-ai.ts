import { Hono } from "hono";
import type {
  AiProviderType,
  Bindings,
  TakosAiConfig,
  TakosAiDataPolicy,
  Variables,
} from "@takos/platform/server";
import {
  DEFAULT_TAKOS_AI_CONFIG,
  fail,
  mergeTakosAiConfig,
  ok,
  releaseStore,
} from "@takos/platform/server";
import { auth } from "../middleware/auth";
import { makeData } from "../data";
import { guardAgentRequest } from "../lib/agent-guard";
import { recordConfigAudit } from "../lib/config-audit";

type AiCapability = "chat" | "completion" | "embedding";

export type AiActionDefinition = {
  id: string;
  label: string;
  description: string;
  providerCapabilities: AiCapability[];
  dataPolicy: TakosAiDataPolicy;
};

export type ProviderStatus = {
  id: string;
  type: AiProviderType;
  model?: string | null;
  base_url?: string | null;
  api_key_env?: string;
  configured: boolean;
  eligible: boolean;
  capabilities: AiCapability[];
};

export type ActionStatus = AiActionDefinition & {
  enabled: boolean;
  eligible: boolean;
  active: boolean;
  blocked_reasons: string[];
  allowed_providers: string[];
};

const PROVIDER_CAPABILITIES: Record<AiProviderType, AiCapability[]> = {
  openai: ["chat", "completion", "embedding"],
  claude: ["chat"],
  gemini: ["chat", "completion", "embedding"],
  openrouter: ["chat", "completion", "embedding"],
  "openai-compatible": ["chat", "completion"],
};

export const AI_ACTIONS: AiActionDefinition[] = [
  {
    id: "ai.summary",
    label: "Summarize content",
    description: "Summarize public posts or timelines into a concise digest.",
    providerCapabilities: ["chat"],
    dataPolicy: { send_public_posts: true, send_dm: false },
  },
  {
    id: "ai.tag-suggest",
    label: "Hashtag suggestions",
    description: "Suggest tags for a draft post based on its text and media descriptions.",
    providerCapabilities: ["chat"],
    dataPolicy: { send_public_posts: true, send_dm: false },
  },
  {
    id: "ai.dm-moderator",
    label: "DM safety review",
    description: "Review or summarize DM conversations for safety or moderation support.",
    providerCapabilities: ["chat"],
    dataPolicy: { send_dm: true },
  },
];

function normalizeConfig(config?: Partial<TakosAiConfig>): TakosAiConfig {
  return mergeTakosAiConfig(DEFAULT_TAKOS_AI_CONFIG, config ?? {});
}

function isAdminUser(c: any): boolean {
  const user = c.get("user");
  const owner = typeof c.env.INSTANCE_OWNER_HANDLE === "string"
    ? c.env.INSTANCE_OWNER_HANDLE.trim()
    : "";
  if (!owner) return true;
  return Boolean(user && (user.id === owner || user.handle === owner));
}

export function buildProviderStatuses(
  config: TakosAiConfig,
  env: Record<string, unknown>,
): ProviderStatus[] {
  const providers = config.providers ?? {};
  return Object.entries(providers).map(([id, provider]) => {
    const capabilities = PROVIDER_CAPABILITIES[provider.type] ?? [];
    const apiKeyEnv =
      typeof provider.api_key_env === "string" && provider.api_key_env.trim().length
        ? provider.api_key_env.trim()
        : "";
    const configured = Boolean(apiKeyEnv && (env as any)[apiKeyEnv]);
    return {
      id,
      type: provider.type,
      model: provider.model ?? null,
      base_url: provider.base_url ?? null,
      api_key_env: apiKeyEnv || undefined,
      configured,
      eligible: configured,
      capabilities,
    };
  });
}

function dataPolicyBlocks(
  actionPolicy: TakosAiDataPolicy,
  nodePolicy: TakosAiDataPolicy | undefined,
): string[] {
  const reasons: string[] = [];
  const node = nodePolicy ?? DEFAULT_TAKOS_AI_CONFIG.data_policy ?? {};
  if (actionPolicy.send_public_posts && node.send_public_posts === false) {
    reasons.push("send_public_posts_blocked");
  }
  if (actionPolicy.send_dm && node.send_dm !== true) {
    reasons.push("send_dm_blocked");
  }
  return reasons;
}

export function buildActionStatuses(
  actions: AiActionDefinition[],
  config: TakosAiConfig,
  providers: ProviderStatus[],
): ActionStatus[] {
  const enabledActions = new Set((config.enabled_actions ?? []).map((id) => id.trim()));
  const nodePolicy = config.data_policy ?? DEFAULT_TAKOS_AI_CONFIG.data_policy ?? {};
  const aiEnabled = config.enabled !== false;

  return actions.map((action) => {
    const blocked_reasons: string[] = [];
    if (!aiEnabled) blocked_reasons.push("ai_disabled");

    const capabilityMatches = providers.filter((provider) =>
      provider.eligible &&
      action.providerCapabilities.every((cap) => provider.capabilities.includes(cap)),
    );

    if (!capabilityMatches.length) {
      blocked_reasons.push("no_provider");
    }

    blocked_reasons.push(...dataPolicyBlocks(action.dataPolicy, nodePolicy));

    const eligible = blocked_reasons.length === 0;
    const enabled = enabledActions.has(action.id);

    return {
      ...action,
      enabled,
      eligible,
      active: enabled && eligible,
      blocked_reasons,
      allowed_providers: capabilityMatches.map((provider) => provider.id),
    };
  });
}

const adminAi = new Hono<{ Bindings: Bindings; Variables: Variables }>();

adminAi.use("/admin/ai/*", auth, async (c, next) => {
  if (!isAdminUser(c)) {
    return fail(c, "forbidden", 403);
  }
  await next();
});

adminAi.get("/admin/ai", async (c) => {
  const store = makeData(c.env as any, c);
  const supportsAiConfig =
    typeof (store as any).getAiConfig === "function" &&
    (typeof (store as any).setAiEnabledActions === "function" ||
      typeof (store as any).updateAiConfig === "function");
  if (!supportsAiConfig) {
    await releaseStore(store);
    return fail(c, "AI configuration is not supported by this node", 501);
  }

  try {
    const config = normalizeConfig(await (store as any).getAiConfig());
    const providers = buildProviderStatuses(config, c.env as any);
    const actions = buildActionStatuses(AI_ACTIONS, config, providers);
    return ok(c, {
      ai: {
        enabled: config.enabled !== false,
        default_provider: config.default_provider ?? null,
        enabled_actions: config.enabled_actions ?? [],
        data_policy: config.data_policy ?? DEFAULT_TAKOS_AI_CONFIG.data_policy,
      },
      providers,
      actions,
    });
  } finally {
    await releaseStore(store);
  }
});

adminAi.post("/admin/ai/actions/:id/toggle", async (c) => {
  const actionId = c.req.param("id");
  const body = (await c.req.json().catch(() => ({}))) as { enabled?: boolean };
  const enable = body.enabled !== false;
  const agentGuard = guardAgentRequest(c.req, { toolId: "tool.updateTakosConfig" });
  if (!agentGuard.ok) {
    return fail(c, agentGuard.error, agentGuard.status);
  }

  const store = makeData(c.env as any, c);
  const updater =
    (store as any).setAiEnabledActions ||
    ((actions: string[]) => (store as any).updateAiConfig?.({ enabled_actions: actions }));

  const user = c.get("user") as any;
  const supportsAiConfig = typeof (store as any).getAiConfig === "function" && typeof updater === "function";
  if (!supportsAiConfig) {
    await releaseStore(store);
    return fail(c, "AI configuration is not supported by this node", 501);
  }

  if (!AI_ACTIONS.find((action) => action.id === actionId)) {
    await releaseStore(store);
    return fail(c, "unknown action id", 404);
  }

  try {
    const config = normalizeConfig(await (store as any).getAiConfig());
    const wasEnabled = new Set(config.enabled_actions ?? []).has(actionId);
    const actionsSet = new Set(config.enabled_actions ?? []);
    if (enable) {
      actionsSet.add(actionId);
    } else {
      actionsSet.delete(actionId);
    }
    const nextConfig = normalizeConfig(
      await updater(Array.from(actionsSet.values())),
    );
    const providers = buildProviderStatuses(nextConfig, c.env as any);
    const actions = buildActionStatuses(AI_ACTIONS, nextConfig, providers);
    await recordConfigAudit((c.env as Bindings).DB, {
      action: "ai_action_toggle",
      actorId: user?.id ?? null,
      actorHandle: user?.handle ?? null,
      agentType: agentGuard.agentType ?? null,
      details: {
        action_id: actionId,
        before_enabled: wasEnabled,
        after_enabled: enable,
        enabled_actions: nextConfig.enabled_actions ?? [],
      },
    });
    return ok(c, {
      ai: {
        enabled: nextConfig.enabled !== false,
        default_provider: nextConfig.default_provider ?? null,
        enabled_actions: nextConfig.enabled_actions ?? [],
        data_policy: nextConfig.data_policy ?? DEFAULT_TAKOS_AI_CONFIG.data_policy,
      },
      providers,
      actions,
    });
  } finally {
    await releaseStore(store);
  }
});

export default adminAi;
