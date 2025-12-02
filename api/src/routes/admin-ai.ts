import { Hono } from "hono";
import type {
  AiProviderType,
  AiActionDefinition as PlatformAiActionDefinition,
  Bindings,
  TakosAiConfig,
  TakosAiDataPolicy,
  TakosConfig,
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
import { enforceAgentConfigAllowlist, getAgentConfigAllowlist } from "../lib/agent-config-allowlist";
import { getBuiltinActionDefinitions } from "../ai/actions";
import { buildRuntimeConfig, loadStoredConfig } from "../lib/config-utils";
import { persistConfigWithReloadGuard } from "../lib/config-reload";
import { assertConfigAiActionsAllowed } from "../lib/ai-action-allowlist";

type AiCapability = "chat" | "completion" | "embedding";

export type AdminAiActionDefinition = {
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

export type ActionStatus = AdminAiActionDefinition & {
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

function toAdminPolicy(actionPolicy: PlatformAiActionDefinition["dataPolicy"]): TakosAiDataPolicy {
  return {
    send_public_posts: Boolean(actionPolicy?.sendPublicPosts),
    send_community_posts: Boolean(actionPolicy?.sendCommunityPosts),
    send_dm: Boolean(actionPolicy?.sendDm),
    send_profile: Boolean(actionPolicy?.sendProfile),
    ...(actionPolicy?.notes ? { notes: actionPolicy.notes } : {}),
  };
}

function toAdminActionDefinition(
  definition: PlatformAiActionDefinition,
): AdminAiActionDefinition {
  return {
    id: definition.id,
    label: definition.label,
    description: definition.description,
    providerCapabilities: definition.providerCapabilities as AiCapability[],
    dataPolicy: toAdminPolicy(definition.dataPolicy),
  };
}

export const AI_ACTIONS: AdminAiActionDefinition[] = getBuiltinActionDefinitions().map(
  toAdminActionDefinition,
);

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
  const externalNetworkAllowed = config.requires_external_network !== false;
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
      eligible: configured && externalNetworkAllowed,
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
  actions: AdminAiActionDefinition[],
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

type ConfigSource = "stored" | "runtime";

const normalizeAllowlistInput = (value: unknown): string[] => {
  if (typeof value === "string") {
    return value
      .split(/[\n,]/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  if (Array.isArray(value)) {
    return value;
  }
  return [];
};

const sameAllowlist = (a: string[], b: string[]): boolean => {
  if (a.length !== b.length) return false;
  const setB = new Set(b);
  return a.every((item) => setB.has(item));
};

async function resolveConfigAllowlist(
  env: Bindings,
): Promise<{ config: TakosConfig; source: ConfigSource; allowlist: string[]; warnings: string[] }> {
  const stored = await loadStoredConfig(env.DB);
  const config = stored.config ?? buildRuntimeConfig(env);
  assertConfigAiActionsAllowed(config);
  const allowlist = getAgentConfigAllowlist(config);
  const source: ConfigSource = stored.config ? "stored" : "runtime";
  const warnings = stored.warnings ?? [];
  return { config, source, allowlist, warnings };
}

const applyAgentConfigAllowlist = (config: TakosConfig, allowlist: string[]): TakosConfig => ({
  ...config,
  ai: mergeTakosAiConfig(config.ai ?? {}, { agent_config_allowlist: allowlist }),
});

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
        requires_external_network: config.requires_external_network !== false,
        data_policy: config.data_policy ?? DEFAULT_TAKOS_AI_CONFIG.data_policy,
      },
      providers,
      actions,
    });
  } finally {
    await releaseStore(store);
  }
});

adminAi.get("/admin/ai/agent-config-allowlist", async (c) => {
  const resolved = await resolveConfigAllowlist(c.env as Bindings);
  return ok(c, {
    allowlist: resolved.allowlist,
    source: resolved.source,
    warnings: resolved.warnings,
  });
});

adminAi.post("/admin/ai/agent-config-allowlist", async (c) => {
  const agentGuard = guardAgentRequest(c.req, { toolId: "tool.updateTakosConfig" });
  if (!agentGuard.ok) {
    return fail(c, agentGuard.error, agentGuard.status);
  }

  const body = (await c.req.json().catch(() => ({}))) as { allowlist?: unknown };
  const incoming = getAgentConfigAllowlist({
    ai: { agent_config_allowlist: normalizeAllowlistInput(body.allowlist) },
  });

  const resolved = await resolveConfigAllowlist(c.env as Bindings);

  if (agentGuard.agentType) {
    const allowlistCheck = enforceAgentConfigAllowlist({
      agentType: agentGuard.agentType,
      allowlist: resolved.allowlist,
      changedPaths: ["ai.agent_config_allowlist"],
    });
    if (!allowlistCheck.ok) {
      return fail(c, allowlistCheck.error, allowlistCheck.status);
    }
  }

  if (sameAllowlist(incoming, resolved.allowlist)) {
    return ok(c, {
      allowlist: resolved.allowlist,
      source: resolved.source,
      updated: false,
      warnings: resolved.warnings,
    });
  }

  const nextConfig = applyAgentConfigAllowlist(resolved.config, incoming);

  try {
    const applyResult = await persistConfigWithReloadGuard({
      env: c.env as Bindings,
      nextConfig,
      previousConfig: resolved.config,
    });

    if (!applyResult.ok) {
      const reason = applyResult.reload.error || "config reload failed";
      const message = applyResult.rolledBack ? `${reason}; restored previous config` : reason;
      return fail(c, message, 500);
    }

    return ok(c, {
      allowlist: getAgentConfigAllowlist(nextConfig),
      source: "stored",
      updated: true,
      reload: applyResult.reload,
      warnings: [...resolved.warnings, ...(applyResult.reload.warnings ?? [])],
    });
  } catch (error: any) {
    const message = error?.message || "failed to update agent config allowlist";
    return fail(c, message, 400);
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
    if (agentGuard.agentType) {
      const allowlistCheck = enforceAgentConfigAllowlist({
        agentType: agentGuard.agentType,
        allowlist: getAgentConfigAllowlist({ ai: config }),
        changedPaths: ["ai.enabled_actions"],
      });
      if (!allowlistCheck.ok) {
        return fail(c, allowlistCheck.error, allowlistCheck.status);
      }
    }
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
        requires_external_network: nextConfig.requires_external_network !== false,
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
