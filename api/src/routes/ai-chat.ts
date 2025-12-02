import { Hono } from "hono";
import type {
  AgentToolId,
  AgentType,
  AiPayloadSlices,
  Bindings,
  TakosConfig,
  Variables,
} from "@takos/platform/server";
import {
  AI_ACTIONS,
  buildActionStatuses,
  buildProviderStatuses,
} from "./admin-ai";
import {
  DEFAULT_TAKOS_AI_CONFIG,
  buildAiProviderRegistry,
  fail,
  isToolAllowedForAgent,
  mergeTakosAiConfig,
  ok,
  releaseStore,
} from "@takos/platform/server";
import { buildRuntimeConfig } from "../lib/config-utils";
import { guardAgentRequest } from "../lib/agent-guard";
import { auth } from "../middleware/auth";
import { makeData } from "../data";

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

function isOwner(user: any, env: Bindings): boolean {
  const owner = typeof env.INSTANCE_OWNER_HANDLE === "string" ? env.INSTANCE_OWNER_HANDLE.trim() : "";
  if (!owner) return true;
  return user?.id === owner || user?.handle === owner;
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

const aiChatRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

aiChatRoutes.post("/api/ai/chat", auth, async (c) => {
  const body = (await c.req.json().catch(() => null)) as ChatRequestBody | null;
  if (!body || typeof body !== "object") {
    return fail(c, "invalid payload", 400);
  }

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
    if ((toolId === "tool.inspectService" || toolId === "tool.applyCodePatch") && !isOwner(user, c.env as Bindings)) {
      return fail(c, "forbidden", 403);
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

    return fail(c, "unsupported tool", 400);
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
  let policyContext;
  try {
    policyContext = registry.prepareCall({
      payload: buildPolicyPayload(body),
      providerId,
      actionId: AI_CHAT_ACTION_ID,
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
  const baseUrl = provider.baseUrl.endsWith("/")
    ? provider.baseUrl.slice(0, -1)
    : provider.baseUrl;
  const apiUrl = `${baseUrl}/chat/completions`;
  const payload: Record<string, unknown> = {
    model,
    messages,
  };
  if (stream) payload.stream = true;

  let response: Response;
  try {
    response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...provider.headers,
      },
      body: JSON.stringify(payload),
    });
  } catch (error: any) {
    const message = error?.message || "failed to reach AI provider";
    return fail(c, message, 502);
  }

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    return fail(c, errorText || "AI provider error", response.status);
  }

  if (stream) {
    const headers = new Headers();
    headers.set(
      "content-type",
      response.headers.get("content-type") || "text/event-stream",
    );
    headers.set("x-ai-provider", provider.id);
    return new Response(response.body, { status: response.status, headers });
  }

  const json = (await response.json().catch(() => null)) as any;
  if (!json || !json.choices || !Array.isArray(json.choices)) {
    return fail(c, "invalid response from AI provider", 502);
  }

  const message = json.choices[0]?.message ?? null;
  return ok(c, {
    provider: provider.id,
    model,
    message,
    raw: json,
  });
});

export default aiChatRoutes;
