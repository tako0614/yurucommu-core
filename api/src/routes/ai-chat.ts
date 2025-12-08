import { Hono } from "hono";
import type {
  AgentToolId,
  AgentType,
  AiPayloadSlices,
  Bindings,
  TakosConfig,
  Variables,
} from "@takos/platform/server";
import type { CoreServices } from "@takos/platform/app/services";
import {
  AI_ACTIONS,
  buildActionStatuses,
  buildProviderStatuses,
} from "./ai-config";
import {
  DEFAULT_TAKOS_AI_CONFIG,
  buildAiProviderRegistry,
  fail,
  isToolAllowedForAgent,
  mergeTakosAiConfig,
  ok,
  releaseStore,
  aiActionRegistry,
  dispatchAiAction,
  chatCompletion,
  chatCompletionStream,
} from "@takos/platform/server";
import type { ChatMessage as AdapterChatMessage } from "@takos/platform/server";
import { buildRuntimeConfig } from "../lib/config-utils";
import { guardAgentRequest } from "../lib/agent-guard";
import { auth } from "../middleware/auth";
import { makeData } from "../data";
import { requireAiQuota } from "../lib/plan-guard";
import type { AuthContext } from "../lib/auth-context-model";
import { buildCoreServices } from "../lib/core-services";
import { createAiAuditLogger, type AiAuditLogger } from "../lib/ai-audit";
import { getAppAuthContext } from "../lib/auth-context";

type ChatRole = "user" | "assistant" | "system";

type ChatMessage = {
  role: ChatRole;
  content: string;
};

type ChatRequestBody = {
  messages?: ChatMessage[];
  stream?: boolean;
  provider?: string;
  model?: string;
  temperature?: number;
  max_tokens?: number;
  tool?: AgentToolId | { id?: AgentToolId };
  service?: string;
  dm_messages?: unknown;
  profile?: unknown;
  public_posts?: unknown;
  community_posts?: unknown;
};

const ALL_TOOLS: AgentToolId[] = [
  "tool.describeNodeCapabilities",
  "tool.inspectService",
  "tool.updateTakosConfig",
  "tool.applyCodePatch",
  "tool.runAIAction",
];

const AI_CHAT_ACTION_ID = "ai.chat";

function normalizeMessages(input: any): ChatMessage[] {
  if (!Array.isArray(input)) return [];
  const allowedRoles = new Set<ChatRole>(["user", "assistant", "system"]);
  const normalized: ChatMessage[] = [];
  for (const item of input) {
    if (!item || typeof item !== "object") continue;
    const roleRaw = typeof item.role === "string" ? item.role.trim().toLowerCase() : "";
    const content = typeof item.content === "string" ? item.content : "";
    if (!content || !allowedRoles.has(roleRaw as ChatRole)) continue;
    normalized.push({ role: roleRaw as ChatRole, content });
  }
  return normalized;
}

function normalizeToolId(raw: unknown): AgentToolId | null {
  if (!raw) return null;
  if (typeof raw === "string") {
    const trimmed = raw.trim() as AgentToolId;
    return ALL_TOOLS.includes(trimmed) ? trimmed : null;
  }
  if (typeof raw === "object" && raw && "id" in raw && typeof (raw as any).id === "string") {
    const trimmed = (raw as any).id.trim() as AgentToolId;
    return ALL_TOOLS.includes(trimmed) ? trimmed : null;
  }
  return null;
}

function isAuthenticated(user: any): boolean {
  return !!user?.id;
}

function listAllowedTools(agentType: AgentType): AgentToolId[] {
  return ALL_TOOLS.filter((tool) => isToolAllowedForAgent(agentType, tool));
}

function resolveConfig(c: any): TakosConfig {
  const fromContext = (c.get("takosConfig") as TakosConfig | undefined) ??
    (c.env as any).takosConfig;
  if (fromContext) return fromContext;
  return buildRuntimeConfig(c.env as Bindings);
}

function buildPolicyPayload(body: ChatRequestBody): AiPayloadSlices {
  return {
    publicPosts: body.public_posts,
    communityPosts: body.community_posts,
    dmMessages: body.dm_messages,
    profile: body.profile,
  };
}

const hasPayloadSlice = (value: unknown): boolean => {
  if (value === undefined || value === null) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "string") return value.trim().length > 0;
  if (typeof value === "object") return Object.keys(value as Record<string, unknown>).length > 0;
  return true;
};

function sanitizeProvider(provider: { id: string; type: string; baseUrl: string; model?: string | null }) {
  return {
    id: provider.id,
    type: provider.type,
    base_url: provider.baseUrl,
    model: provider.model ?? null,
  };
}

async function handleDescribeNode(
  c: any,
  agentType: AgentType,
  aiConfig: any,
  env: Record<string, string | undefined>,
) {
  const providers = buildProviderStatuses(aiConfig, env);
  const actions = buildActionStatuses(AI_ACTIONS, aiConfig, providers);
  const registry = buildAiProviderRegistry(aiConfig, env);
  return ok(c, {
    tool: "tool.describeNodeCapabilities",
    agent_type: agentType,
    allowed_tools: listAllowedTools(agentType),
    ai: {
      enabled: aiConfig.enabled !== false,
      requires_external_network: aiConfig.requires_external_network !== false,
      default_provider: registry.getDefaultProviderId() ?? null,
      data_policy: registry.getDataPolicy(),
      providers: registry.list().map((provider) => sanitizeProvider(provider)),
      warnings: registry.warnings,
    },
    providers,
    actions,
    distro: (c.get("takosConfig") as TakosConfig | undefined)?.distro ?? null,
  });
}

async function handleInspectService(c: any, service: string, env: Bindings) {
  if (service && service !== "database") {
    return fail(c, "unknown service", 404);
  }
  const store = makeData(env as any, c);
  try {
    const methodNames = Object.entries(store)
      .filter(([, value]) => typeof value === "function")
      .map(([name]) => name)
      .sort();
    return ok(c, {
      tool: "tool.inspectService",
      service: "database",
      methods: methodNames,
    });
  } finally {
    await releaseStore(store);
  }
}

async function handleRunAIAction(
  c: any,
  body: ChatRequestBody,
  agentType: AgentType,
  aiConfig: any,
  services: CoreServices,
  authContext: AuthContext | null,
  aiAudit: AiAuditLogger,
) {
  const actionId = typeof body.service === "string" ? body.service.trim() : "";
  if (!actionId) {
    return fail(c, "action id is required for tool.runAIAction", 400);
  }

  const enabledActions = new Set((aiConfig.enabled_actions ?? []).map((id: string) => id.trim()));
  if (!enabledActions.has(actionId)) {
    return fail(c, `AI action "${actionId}" is not enabled for this node`, 403);
  }

  if (aiConfig.requires_external_network === false) {
    return fail(c, "AI external network access is disabled for this node", 503);
  }

  let providers;
  try {
    providers = buildAiProviderRegistry(aiConfig, c.env as any);
    if (providers.warnings?.length) {
      console.warn(`[ai] provider warnings: ${providers.warnings.join("; ")}`);
    }
  } catch (error: any) {
    const message = error?.message || "failed to resolve AI providers";
    return fail(c, message, 400);
  }

  const nodeConfig: TakosConfig = {
    ...(c.get("takosConfig") as TakosConfig | undefined ?? buildRuntimeConfig(c.env as Bindings)),
    ai: aiConfig,
  };

  let input: unknown;
  try {
    input = typeof body.dm_messages === "object" && body.dm_messages !== null
      ? body.dm_messages
      : typeof body.public_posts === "object" && body.public_posts !== null
        ? body.public_posts
        : typeof body.community_posts === "object" && body.community_posts !== null
          ? body.community_posts
          : typeof body.profile === "object" && body.profile !== null
            ? body.profile
            : {};
  } catch {
    return fail(c, "invalid input payload", 400);
  }

  try {
    const result = await dispatchAiAction(aiActionRegistry, actionId, {
      nodeConfig,
      user: c.get("user"),
      agentType,
      auth: authContext ?? undefined,
      services,
      appAuth: getAppAuthContext(c),
      env: c.env,
      aiAudit,
      providers,
    }, input);

    return ok(c, {
      tool: "tool.runAIAction",
      action_id: actionId,
      result,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    if (/Unknown AI action/i.test(message)) {
      return fail(c, "unknown action", 403);
    }
    if (/not enabled/i.test(message)) {
      return fail(c, message, 403);
    }
    if (/PlanGuard/i.test(message)) {
      return fail(c, message, 402);
    }
    if (/AgentPolicy/i.test(message)) {
      return fail(c, message, 403);
    }
    if (/DataPolicyViolation/i.test(message)) {
      return fail(c, message, 400);
    }
    return fail(c, "failed to run AI action", 500);
  }
}

const aiChatRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

aiChatRoutes.post("/api/ai/chat", auth, async (c) => {
  const body = (await c.req.json().catch(() => null)) as ChatRequestBody | null;
  if (!body || typeof body !== "object") {
    return fail(c, "invalid payload", 400);
  }
  const authContext = (c.get("authContext") as AuthContext | undefined) ?? null;
  const planCheck = requireAiQuota(authContext);
  const services = buildCoreServices(c.env as Bindings);
  const aiAudit = createAiAuditLogger(c.env as any);

  const toolId = normalizeToolId(body.tool);
  if (toolId) {
    const agentGuard = guardAgentRequest(c.req, { toolId });
    if (!agentGuard.ok) {
      return fail(c, agentGuard.error, agentGuard.status);
    }
    if (!agentGuard.agentType) {
      return fail(c, "agent type header is required for tool calls", 400);
    }

    const user = c.get("user");
    if ((toolId === "tool.inspectService" || toolId === "tool.applyCodePatch" || toolId === "tool.updateTakosConfig") && !isAuthenticated(user)) {
      return fail(c, "authentication required", 403);
    }

    const config = mergeTakosAiConfig(
      DEFAULT_TAKOS_AI_CONFIG,
      resolveConfig(c).ai ?? {},
    );

    if (toolId === "tool.describeNodeCapabilities") {
      return handleDescribeNode(
        c,
        agentGuard.agentType,
        config,
        c.env as Record<string, string | undefined>,
      );
    }

    if (toolId === "tool.inspectService") {
      const service = typeof body.service === "string" ? body.service.trim() : "database";
      return handleInspectService(c, service || "database", c.env as Bindings);
    }

    if (toolId === "tool.runAIAction") {
      if (!planCheck.ok) {
        return fail(c, planCheck.message, planCheck.status, {
          code: planCheck.code,
          details: planCheck.details,
        });
      }
      return handleRunAIAction(c, body, agentGuard.agentType, config, services, authContext, aiAudit);
    }

    if (toolId === "tool.applyCodePatch") {
      return fail(c, "tool.applyCodePatch must be called via /-/app/workspaces/:id/apply-patch endpoint", 400);
    }

    return fail(c, "unsupported tool", 400);
  }

  if (!planCheck.ok) {
    return fail(c, planCheck.message, planCheck.status);
  }

  const messages = normalizeMessages(body.messages);
  if (!messages.length) {
    return fail(c, "messages are required", 400);
  }

  const takosConfig = resolveConfig(c);
  const aiConfig = mergeTakosAiConfig(DEFAULT_TAKOS_AI_CONFIG, takosConfig.ai ?? {});
  if (aiConfig.enabled === false) {
    return fail(c, "AI is disabled for this node", 503);
  }
  if (aiConfig.requires_external_network === false) {
    return fail(c, "AI external network access is disabled for this node", 503);
  }

  const enabledActions = new Set((aiConfig.enabled_actions ?? []).map((id) => id.trim()));
  if (!enabledActions.has(AI_CHAT_ACTION_ID)) {
    return fail(c, `AI action "${AI_CHAT_ACTION_ID}" is not enabled for this node`, 403);
  }

  let registry;
  try {
    registry = buildAiProviderRegistry(aiConfig, c.env as any);
  } catch (error: any) {
    const message = error?.message || "AI provider configuration error";
    return fail(c, message, 400);
  }

  const providerId = typeof body.provider === "string" && body.provider.trim()
    ? body.provider.trim()
    : undefined;
  const policyPayload = buildPolicyPayload(body);
  const actionPolicy = {
    sendPublicPosts: hasPayloadSlice(policyPayload.publicPosts),
    sendCommunityPosts: hasPayloadSlice(policyPayload.communityPosts),
    sendDm: hasPayloadSlice(policyPayload.dmMessages),
    sendProfile: hasPayloadSlice(policyPayload.profile),
  };
  let policyContext;
  try {
    policyContext = registry.prepareCall({
      payload: policyPayload,
      providerId,
      actionPolicy,
      actionId: AI_CHAT_ACTION_ID,
      onViolation: (report) => {
        aiAudit?.({
          actionId: AI_CHAT_ACTION_ID,
          providerId: report.providerId ?? providerId ?? "(unknown)",
          model: body.model ?? null,
          policy: report.policy,
          redacted: [],
          agentType: null,
          userId: authContext?.userId ?? null,
          status: "blocked",
          error: "DataPolicyViolation",
        });
      },
    });
  } catch (error: any) {
    const message = error?.message || "AI provider configuration error";
    return fail(c, message, 400);
  }
  const provider = policyContext.provider;

  const model =
    (typeof body.model === "string" && body.model.trim()) || provider.model;
  if (!model) {
    return fail(c, "model is required for chat completions", 400);
  }

  const stream = body.stream === true;

  // Convert messages to adapter format
  const adapterMessages: AdapterChatMessage[] = messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  const completionOptions = {
    model,
    temperature: typeof body.temperature === "number" ? body.temperature : undefined,
    maxTokens: typeof body.max_tokens === "number" ? body.max_tokens : undefined,
  };

  try {
    await aiAudit?.({
      actionId: AI_CHAT_ACTION_ID,
      providerId: provider.id,
      model,
      policy: policyContext.policy,
      redacted: policyContext.redacted,
      agentType: null,
      userId: authContext?.userId ?? null,
      status: "attempt",
    });

    if (stream) {
      // Use the new streaming adapter
      const streamResult = await chatCompletionStream(provider, adapterMessages, completionOptions);

      await aiAudit?.({
        actionId: AI_CHAT_ACTION_ID,
        providerId: streamResult.provider ?? provider.id,
        model: streamResult.model ?? model,
        policy: policyContext.policy,
        redacted: policyContext.redacted,
        agentType: null,
        userId: authContext?.userId ?? null,
        status: "success",
      });

      const headers = new Headers();
      headers.set("content-type", "text/event-stream");
      headers.set("cache-control", "no-cache");
      headers.set("connection", "keep-alive");
      headers.set("x-ai-provider", streamResult.provider ?? provider.id);
      headers.set("x-ai-model", streamResult.model ?? model);

      return new Response(streamResult.stream, { status: 200, headers });
    }

    // Use the new non-streaming adapter
    const result = await chatCompletion(provider, adapterMessages, completionOptions);

    await aiAudit?.({
      actionId: AI_CHAT_ACTION_ID,
      providerId: result.provider ?? provider.id,
      model: result.model ?? model,
      policy: policyContext.policy,
      redacted: policyContext.redacted,
      agentType: null,
      userId: authContext?.userId ?? null,
      status: "success",
    });

    return ok(c, {
      provider: result.provider,
      model: result.model,
      message: result.choices[0]?.message ?? null,
      usage: result.usage ?? null,
      raw: result.raw,
    });
  } catch (error: any) {
    aiAudit?.({
      actionId: AI_CHAT_ACTION_ID,
      providerId: provider.id,
      model,
      policy: policyContext.policy,
      redacted: policyContext.redacted,
      agentType: null,
      userId: authContext?.userId ?? null,
      status: "error",
      error: error instanceof Error ? error.message : String(error),
    });
    const message = error?.message || "failed to reach AI provider";
    // Check if it's a provider-specific error with status code
    const statusMatch = message.match(/\((\d{3})\)/);
    const status = statusMatch ? parseInt(statusMatch[1], 10) : 502;
    return fail(c, message, status >= 400 && status < 600 ? status : 502);
  }
});

export default aiChatRoutes;
