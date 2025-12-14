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
  BUILTIN_AGENT_TOOL_IDS,
  createAgentTools,
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
import { createAiAuditLogger, createAgentToolAuditLogger, type AiAuditLogger } from "../lib/ai-audit";
import { getAppAuthContext } from "../lib/auth-context";
import { ensureAiCallAllowed } from "../lib/ai-rate-limit";
import { createUsageTrackerFromEnv } from "../lib/usage-tracker";

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
  input?: unknown;
  service?: string;
  dm_messages?: unknown;
  profile?: unknown;
  public_posts?: unknown;
  community_posts?: unknown;
};

const ALL_TOOLS: AgentToolId[] = [...BUILTIN_AGENT_TOOL_IDS];

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

function getRequestId(c: any): string | null {
  const candidates = [
    c.req.header("x-request-id"),
    c.req.header("cf-ray"),
  ];
  for (const value of candidates) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function getClientIp(c: any): string | null {
  const candidates = [
    c.req.header("cf-connecting-ip"),
    c.req.header("x-forwarded-for"),
  ];
  for (const value of candidates) {
    if (typeof value !== "string") continue;
    const first = value.split(",")[0]?.trim();
    if (first) return first;
  }
  return null;
}

function isToolAllowedByConfig(aiConfig: any, toolId: AgentToolId): boolean {
  const raw = aiConfig?.agent_tool_allowlist;
  const allowlist = Array.isArray(raw) ? raw.map((v) => String(v ?? "").trim()).filter(Boolean) : [];
  if (!allowlist.length) return true;
  if (allowlist.includes("*")) return true;
  return allowlist.includes(toolId);
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
  const services = buildCoreServices(c.env as Bindings);
  const aiAudit = createAiAuditLogger(c.env as any);
  const toolAudit = createAgentToolAuditLogger(c.env as any);
  const usageTracker = createUsageTrackerFromEnv(c.env as any);
  const usageUserId = authContext?.userId ?? "anonymous";

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
    if ((toolId === "tool.applyCodePatch" || toolId === "tool.updateTakosConfig") && !isAuthenticated(user)) {
      return fail(c, "authentication required", 403);
    }

    const config = mergeTakosAiConfig(
      DEFAULT_TAKOS_AI_CONFIG,
      resolveConfig(c).ai ?? {},
    );

    if (!isToolAllowedByConfig(config, toolId)) {
      return fail(c, `agent is not allowed to call ${toolId} on this node`, 403);
    }

    const toolInput = (body.input && typeof body.input === "object" && body.input !== null) ? body.input : {};
    const toolCtx = {
      auth: {
        userId: authContext?.userId ?? null,
        isAuthenticated: isAuthenticated(user),
        plan: authContext ? {
          name: authContext.plan?.name ?? "self-hosted",
          limits: {
            storage: authContext.limits?.storage,
            fileSize: authContext.limits?.fileSize,
            aiRequests: authContext.limits?.aiRequests,
          },
          features: authContext.plan?.features ?? ["*"],
        } : undefined,
        agentType: agentGuard.agentType,
      },
      nodeConfig: resolveConfig(c),
      services,
      env: c.env as any,
    } as const;

    if (toolId === "tool.describeNodeCapabilities") {
      const started = Date.now();
      try {
        const res = await handleDescribeNode(
          c,
          agentGuard.agentType,
          config,
          c.env as Record<string, string | undefined>,
        );
        await toolAudit({
          toolId,
          status: "success",
          agentType: agentGuard.agentType,
          userId: authContext?.userId ?? null,
          durationMs: Date.now() - started,
          requestId: getRequestId(c),
          ip: getClientIp(c),
        });
        return res;
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        await toolAudit({
          toolId,
          status: "error",
          agentType: agentGuard.agentType,
          userId: authContext?.userId ?? null,
          message,
          durationMs: Date.now() - started,
          requestId: getRequestId(c),
          ip: getClientIp(c),
        });
        throw error;
      }
    }

    if (toolId === "tool.inspectService") {
      const service = typeof body.service === "string" ? body.service.trim() : "database";
      const started = Date.now();
      try {
        const res = await handleInspectService(c, service || "database", c.env as Bindings);
        await toolAudit({
          toolId,
          status: "success",
          agentType: agentGuard.agentType,
          userId: authContext?.userId ?? null,
          durationMs: Date.now() - started,
          requestId: getRequestId(c),
          ip: getClientIp(c),
        });
        return res;
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        await toolAudit({
          toolId,
          status: "error",
          agentType: agentGuard.agentType,
          userId: authContext?.userId ?? null,
          message,
          durationMs: Date.now() - started,
          requestId: getRequestId(c),
          ip: getClientIp(c),
        });
        throw error;
      }
    }

    if (toolId === "tool.runAIAction") {
      const currentUsage = await usageTracker.getAiUsage(usageUserId);
      const planCheck = requireAiQuota(authContext, { used: currentUsage, requested: 1 });
      if (!planCheck.ok) {
        return fail(c, planCheck.message, planCheck.status, {
          code: planCheck.code,
          details: planCheck.details,
        });
      }

      const rateLimit = await ensureAiCallAllowed(c.env as any, authContext, { agentType: agentGuard.agentType });
      if (!rateLimit.ok) {
        return fail(c, rateLimit.message, rateLimit.status, { code: rateLimit.code, details: rateLimit.details });
      }

      const started = Date.now();
      try {
        const res = await handleRunAIAction(c, body, agentGuard.agentType, config, services, authContext, aiAudit);
        if ((res as any)?.status && (res as any).status < 400) {
          await usageTracker.recordAiRequest(usageUserId);
          await toolAudit({
            toolId,
            status: "success",
            agentType: agentGuard.agentType,
            userId: authContext?.userId ?? null,
            durationMs: Date.now() - started,
            requestId: getRequestId(c),
            ip: getClientIp(c),
          });
        } else {
          await toolAudit({
            toolId,
            status: "error",
            agentType: agentGuard.agentType,
            userId: authContext?.userId ?? null,
            message: `tool returned status ${(res as any)?.status ?? "(unknown)"}`,
            durationMs: Date.now() - started,
            requestId: getRequestId(c),
            ip: getClientIp(c),
          });
        }
        return res;
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        await toolAudit({
          toolId,
          status: "error",
          agentType: agentGuard.agentType,
          userId: authContext?.userId ?? null,
          message,
          durationMs: Date.now() - started,
          requestId: getRequestId(c),
          ip: getClientIp(c),
        });
        throw error;
      }
    }

    if (toolId === "tool.applyCodePatch") {
      return fail(c, "tool.applyCodePatch must be called via /-/app/workspaces/:id/apply-patch endpoint", 400);
    }

    const tools = createAgentTools({
      actionRegistry: aiActionRegistry,
      auditLog: async (event) => {
        await toolAudit({
          toolId: event.tool,
          status: event.success ? "success" : "error",
          agentType: event.agentType ?? null,
          userId: event.userId ?? null,
          message: event.message ?? null,
          requestId: getRequestId(c),
          ip: getClientIp(c),
        });
      },
    });

    try {
      if (toolId === "tool.getTimeline") {
        const input = toolInput as any;
        const result = await tools.getTimeline(toolCtx as any, {
          type: input.type ?? "home",
          limit: input.limit,
          cursor: input.cursor,
          only_media: input.only_media,
          include_direct: input.include_direct,
          visibility: input.visibility,
        });
        return ok(c, { tool: toolId, data: result });
      }

      if (toolId === "tool.getPost") {
        const input = toolInput as any;
        const result = await tools.getPost(toolCtx as any, {
          id: String(input.id ?? ""),
          includeThread: input.includeThread ?? input.include_thread ?? false,
        });
        return ok(c, { tool: toolId, data: result });
      }

      if (toolId === "tool.getUser") {
        const input = toolInput as any;
        const result = await tools.getUser(toolCtx as any, { id: String(input.id ?? "") });
        return ok(c, { tool: toolId, data: result });
      }

      if (toolId === "tool.searchPosts") {
        const input = toolInput as any;
        const result = await tools.searchPosts(toolCtx as any, {
          query: String(input.query ?? ""),
          limit: input.limit,
          offset: input.offset,
        });
        return ok(c, { tool: toolId, data: result });
      }

      if (toolId === "tool.searchUsers") {
        const input = toolInput as any;
        const result = await tools.searchUsers(toolCtx as any, {
          query: String(input.query ?? ""),
          limit: input.limit,
          offset: input.offset,
          local_only: input.local_only,
        });
        return ok(c, { tool: toolId, data: result });
      }

      if (toolId === "tool.getNotifications") {
        const input = toolInput as any;
        const result = await tools.getNotifications(toolCtx as any, { since: input.since });
        return ok(c, { tool: toolId, data: result });
      }

      if (toolId === "tool.getDmThreads") {
        const input = toolInput as any;
        const result = await tools.getDmThreads(toolCtx as any, { limit: input.limit, offset: input.offset });
        return ok(c, { tool: toolId, data: result });
      }

      if (toolId === "tool.getDmMessages") {
        const input = toolInput as any;
        const result = await tools.getDmMessages(toolCtx as any, {
          thread_id: String(input.thread_id ?? input.threadId ?? ""),
          limit: input.limit,
          offset: input.offset,
          since_id: input.since_id,
          max_id: input.max_id,
        });
        return ok(c, { tool: toolId, data: result });
      }

      if (toolId === "tool.createPost") {
        const input = toolInput as any;
        const result = await tools.createPost(toolCtx as any, {
          content: String(input.content ?? ""),
          visibility: input.visibility,
          community_id: input.community_id ?? null,
          reply_to: input.reply_to ?? null,
          media_ids: input.media_ids,
          sensitive: input.sensitive,
          spoiler_text: input.spoiler_text ?? null,
          poll: input.poll ?? null,
        });
        return ok(c, { tool: toolId, data: result });
      }

      if (toolId === "tool.follow") {
        const input = toolInput as any;
        const result = await tools.follow(toolCtx as any, {
          targetUserId: String(input.targetUserId ?? input.target_user_id ?? input.target_id ?? ""),
        });
        return ok(c, { tool: toolId, data: result });
      }

      if (toolId === "tool.unfollow") {
        const input = toolInput as any;
        const result = await tools.unfollow(toolCtx as any, {
          targetUserId: String(input.targetUserId ?? input.target_user_id ?? input.target_id ?? ""),
        });
        return ok(c, { tool: toolId, data: result });
      }

      if (toolId === "tool.getBookmarks") {
        const input = toolInput as any;
        const result = await tools.getBookmarks(toolCtx as any, { limit: input.limit, offset: input.offset });
        return ok(c, { tool: toolId, data: result });
      }

      return fail(c, "unsupported tool", 400);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      if (/not allowed/i.test(message)) return fail(c, message, 403);
      if (/Authentication required/i.test(message)) return fail(c, message, 403);
      if (/Core services are not available/i.test(message)) return fail(c, message, 503);
      return fail(c, message || "tool failed", 400);
    }
  }

  const currentUsage = await usageTracker.getAiUsage(usageUserId);
  const planCheck = requireAiQuota(authContext, { used: currentUsage, requested: 1 });
  if (!planCheck.ok) {
    return fail(c, planCheck.message, planCheck.status);
  }

  const rateLimit = await ensureAiCallAllowed(c.env as any, authContext, { agentType: null });
  if (!rateLimit.ok) {
    return fail(c, rateLimit.message, rateLimit.status, { code: rateLimit.code, details: rateLimit.details });
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

      await usageTracker.recordAiRequest(usageUserId);
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

    await usageTracker.recordAiRequest(usageUserId);
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
