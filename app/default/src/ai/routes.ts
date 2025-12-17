/**
 * AI Routes for Default App
 *
 * These routes handle AI actions in the App layer, using Core's AI Provider connection.
 */
import { Hono } from "hono";
import type { AppEnv } from "@takos/app-sdk/server";
import { json, error, parseBody } from "@takos/app-sdk/server";
import {
  aiActionRegistry,
  dispatchAiAction,
  buildAiProviderRegistry,
  mergeTakosAiConfig,
  DEFAULT_TAKOS_AI_CONFIG,
} from "@takos/platform/server";
import type { TakosConfig, AiProviderRegistry } from "@takos/platform/server";
import {
  registerBuiltinAiActions,
  getDefaultProviderId,
} from "./actions.js";

// Register actions on module load
registerBuiltinAiActions();

const aiRouter = new Hono<{ Bindings: AppEnv }>();

/**
 * Resolve takos config from environment
 */
const resolveConfig = (env: AppEnv): TakosConfig | null => {
  const config = (env as any).takosConfig as TakosConfig | undefined;
  return config ?? null;
};

/**
 * Map dispatch errors to HTTP status codes
 */
const mapDispatchError = (err: unknown): { status: number; message: string } => {
  const message = err instanceof Error ? err.message : String(err);
  if (/Unknown AI action/i.test(message)) return { status: 403, message: "unknown action" };
  if (/not enabled/i.test(message)) return { status: 403, message };
  if (/AI is disabled/i.test(message)) return { status: 403, message };
  if (/external network access is disabled/i.test(message)) {
    return { status: 503, message };
  }
  if (/PlanGuard/i.test(message)) {
    return { status: 402, message };
  }
  if (/AgentPolicy/i.test(message)) {
    return { status: 403, message };
  }
  if (/DataPolicyViolation/i.test(message)) return { status: 400, message };
  return { status: 500, message: "failed to run AI action" };
};

/**
 * Build AI provider registry from config
 */
const buildProviders = (env: AppEnv, aiConfig: any): { providers: AiProviderRegistry | null; warnings: string[] } => {
  try {
    const providers = buildAiProviderRegistry(aiConfig, env as any);
    return { providers, warnings: providers.warnings ?? [] };
  } catch (err: any) {
    console.warn("[ai-routes] failed to build provider registry:", err);
    return { providers: null, warnings: [err?.message ?? "failed to resolve AI providers"] };
  }
};

/**
 * Run AI action endpoint
 * POST /ai/actions/:id/run
 */
aiRouter.post("/ai/actions/:id/run", async (c) => {
  if (!c.env.auth) {
    return error("Unauthorized", 401);
  }

  const actionId = c.req.param("id")?.trim();
  if (!actionId) {
    return error("action id is required", 400);
  }

  const nodeConfig = resolveConfig(c.env);
  if (!nodeConfig) {
    return error("takos-config is not available for this node", 500);
  }

  const aiConfig = mergeTakosAiConfig(DEFAULT_TAKOS_AI_CONFIG, nodeConfig.ai ?? {});

  if (aiConfig.requires_external_network === false) {
    return error("AI external network access is disabled for this node", 503);
  }

  let input: unknown;
  try {
    input = await c.req.json();
  } catch {
    return error("invalid JSON body", 400);
  }

  const { providers, warnings } = buildProviders(c.env, aiConfig);
  if (warnings.length) {
    console.warn(`[ai-routes] provider warnings: ${warnings.join("; ")}`);
  }

  // Build context for AI action
  // Note: We cast to any because AiActionContext expects full AppAuthContext
  // but the actual handlers only use userId for their logic
  const ctx = {
    nodeConfig: { ...nodeConfig, ai: aiConfig },
    auth: {
      userId: c.env.auth.userId,
    },
    appAuth: {
      userId: c.env.auth.userId,
      sessionId: c.env.auth.sessionId,
      isAuthenticated: true,
      plan: null,
      limits: null,
    },
    providers,
    env: c.env,
  } as any;

  try {
    const result = await dispatchAiAction(aiActionRegistry, actionId, ctx, input);
    return json({
      action_id: actionId,
      provider: providers ? getDefaultProviderId(providers) ?? null : null,
      result,
    });
  } catch (err: unknown) {
    const mapped = mapDispatchError(err);
    return error(mapped.message, mapped.status);
  }
});

/**
 * List available AI actions
 * GET /ai/actions
 */
aiRouter.get("/ai/actions", async (c) => {
  if (!c.env.auth) {
    return error("Unauthorized", 401);
  }

  const actions = aiActionRegistry.listActions();
  return json({
    actions: actions.map((def) => ({
      id: def.id,
      label: def.label,
      description: def.description,
    })),
  });
});

/**
 * Summarize content
 * POST /ai/summary
 */
aiRouter.post("/ai/summary", async (c) => {
  if (!c.env.auth) {
    return error("Unauthorized", 401);
  }

  const body = await parseBody<any>(c.req.raw).catch(() => ({}));
  const text = String(body.text ?? "").trim();
  const maxSentences = body.maxSentences ?? body.max_sentences ?? 3;
  const language = body.language ?? undefined;
  const objectIds = body.objectIds ?? body.object_ids ?? undefined;

  const nodeConfig = resolveConfig(c.env);
  if (!nodeConfig) {
    return error("takos-config is not available for this node", 500);
  }

  const aiConfig = mergeTakosAiConfig(DEFAULT_TAKOS_AI_CONFIG, nodeConfig.ai ?? {});
  const { providers } = buildProviders(c.env, aiConfig);

  const ctx = {
    nodeConfig: { ...nodeConfig, ai: aiConfig },
    auth: { userId: c.env.auth.userId },
    appAuth: {
      userId: c.env.auth.userId,
      sessionId: c.env.auth.sessionId,
      isAuthenticated: true,
      plan: null,
      limits: null,
    },
    providers,
    env: c.env,
  } as any;

  try {
    const result = await dispatchAiAction(aiActionRegistry, "ai.summary", ctx, {
      text,
      maxSentences,
      language,
      objectIds,
    });
    return json(result);
  } catch (err: unknown) {
    const mapped = mapDispatchError(err);
    return error(mapped.message, mapped.status);
  }
});

/**
 * Suggest hashtags
 * POST /ai/tag-suggest
 */
aiRouter.post("/ai/tag-suggest", async (c) => {
  if (!c.env.auth) {
    return error("Unauthorized", 401);
  }

  const body = await parseBody<any>(c.req.raw).catch(() => ({}));
  const text = String(body.text ?? "").trim();
  const maxTags = body.maxTags ?? body.max_tags ?? 5;
  const objectIds = body.objectIds ?? body.object_ids ?? undefined;

  const nodeConfig = resolveConfig(c.env);
  if (!nodeConfig) {
    return error("takos-config is not available for this node", 500);
  }

  const aiConfig = mergeTakosAiConfig(DEFAULT_TAKOS_AI_CONFIG, nodeConfig.ai ?? {});
  const { providers } = buildProviders(c.env, aiConfig);

  const ctx = {
    nodeConfig: { ...nodeConfig, ai: aiConfig },
    auth: { userId: c.env.auth.userId },
    appAuth: {
      userId: c.env.auth.userId,
      sessionId: c.env.auth.sessionId,
      isAuthenticated: true,
      plan: null,
      limits: null,
    },
    providers,
    env: c.env,
  } as any;

  try {
    const result = await dispatchAiAction(aiActionRegistry, "ai.tag-suggest", ctx, {
      text,
      maxTags,
      objectIds,
    });
    return json(result);
  } catch (err: unknown) {
    const mapped = mapDispatchError(err);
    return error(mapped.message, mapped.status);
  }
});

/**
 * Translate content
 * POST /ai/translate
 */
aiRouter.post("/ai/translate", async (c) => {
  if (!c.env.auth) {
    return error("Unauthorized", 401);
  }

  const body = await parseBody<any>(c.req.raw).catch(() => ({}));
  const text = String(body.text ?? "").trim();
  const targetLanguage = String(body.targetLanguage ?? body.target_language ?? "").trim();
  const sourceLanguage = body.sourceLanguage ?? body.source_language ?? undefined;
  const objectIds = body.objectIds ?? body.object_ids ?? undefined;

  if (!targetLanguage) {
    return error("targetLanguage is required", 400);
  }

  const nodeConfig = resolveConfig(c.env);
  if (!nodeConfig) {
    return error("takos-config is not available for this node", 500);
  }

  const aiConfig = mergeTakosAiConfig(DEFAULT_TAKOS_AI_CONFIG, nodeConfig.ai ?? {});
  const { providers } = buildProviders(c.env, aiConfig);

  const ctx = {
    nodeConfig: { ...nodeConfig, ai: aiConfig },
    auth: { userId: c.env.auth.userId },
    appAuth: {
      userId: c.env.auth.userId,
      sessionId: c.env.auth.sessionId,
      isAuthenticated: true,
      plan: null,
      limits: null,
    },
    providers,
    env: c.env,
  } as any;

  try {
    const result = await dispatchAiAction(aiActionRegistry, "ai.translation", ctx, {
      text,
      targetLanguage,
      sourceLanguage,
      objectIds,
    });
    return json(result);
  } catch (err: unknown) {
    const mapped = mapDispatchError(err);
    return error(mapped.message, mapped.status);
  }
});

/**
 * AI Chat completion
 * POST /ai/chat
 */
aiRouter.post("/ai/chat", async (c) => {
  if (!c.env.auth) {
    return error("Unauthorized", 401);
  }

  const body = await parseBody<any>(c.req.raw).catch(() => ({}));
  const messages = body.messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    return error("messages array is required", 400);
  }

  const nodeConfig = resolveConfig(c.env);
  if (!nodeConfig) {
    return error("takos-config is not available for this node", 500);
  }

  const aiConfig = mergeTakosAiConfig(DEFAULT_TAKOS_AI_CONFIG, nodeConfig.ai ?? {});
  const { providers } = buildProviders(c.env, aiConfig);

  const ctx = {
    nodeConfig: { ...nodeConfig, ai: aiConfig },
    auth: { userId: c.env.auth.userId },
    appAuth: {
      userId: c.env.auth.userId,
      sessionId: c.env.auth.sessionId,
      isAuthenticated: true,
      plan: null,
      limits: null,
    },
    providers,
    env: c.env,
  } as any;

  try {
    const result = await dispatchAiAction(aiActionRegistry, "ai.chat", ctx, {
      messages,
      system: body.system,
      provider: body.provider,
      model: body.model,
      temperature: body.temperature,
      maxTokens: body.maxTokens ?? body.max_tokens,
      publicPosts: body.publicPosts ?? body.public_posts,
      communityPosts: body.communityPosts ?? body.community_posts,
      dmMessages: body.dmMessages ?? body.dm_messages,
      profile: body.profile,
    });
    return json(result);
  } catch (err: unknown) {
    const mapped = mapDispatchError(err);
    return error(mapped.message, mapped.status);
  }
});

/**
 * DM Moderator
 * POST /ai/dm-moderator
 */
aiRouter.post("/ai/dm-moderator", async (c) => {
  if (!c.env.auth) {
    return error("Unauthorized", 401);
  }

  const body = await parseBody<any>(c.req.raw).catch(() => ({}));
  const messages = body.messages;
  if (!Array.isArray(messages)) {
    return error("messages array is required", 400);
  }

  const nodeConfig = resolveConfig(c.env);
  if (!nodeConfig) {
    return error("takos-config is not available for this node", 500);
  }

  const aiConfig = mergeTakosAiConfig(DEFAULT_TAKOS_AI_CONFIG, nodeConfig.ai ?? {});
  const { providers } = buildProviders(c.env, aiConfig);

  const ctx = {
    nodeConfig: { ...nodeConfig, ai: aiConfig },
    auth: { userId: c.env.auth.userId },
    appAuth: {
      userId: c.env.auth.userId,
      sessionId: c.env.auth.sessionId,
      isAuthenticated: true,
      plan: null,
      limits: null,
    },
    providers,
    env: c.env,
  } as any;

  try {
    const result = await dispatchAiAction(aiActionRegistry, "ai.dm-moderator", ctx, {
      messages,
    });
    return json(result);
  } catch (err: unknown) {
    const mapped = mapDispatchError(err);
    return error(mapped.message, mapped.status);
  }
});

export default aiRouter;
