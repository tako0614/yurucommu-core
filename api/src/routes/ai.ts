import { Hono } from "hono";
import type { PublicAccountBindings as Bindings, TakosConfig, Variables } from "@takos/platform/server";
import {
  aiActionRegistry,
  buildAiProviderRegistry,
  dispatchAiAction,
  DEFAULT_TAKOS_AI_CONFIG,
  fail,
  mergeTakosAiConfig,
  ok,
} from "@takos/platform/server";
import { auth } from "../middleware/auth";
import { guardAgentRequest } from "../lib/agent-guard";
import { getDefaultProviderId, registerBuiltinAiActions } from "../ai/actions";
import { requireAiQuota } from "../lib/plan-guard";
import type { AuthContext } from "../lib/auth-context-model";
import { buildCoreServices } from "../lib/core-services";
import { createAiAuditLogger } from "../lib/ai-audit";
import { getAppAuthContext } from "../lib/auth-context";
import { createUsageTrackerFromEnv } from "../lib/usage-tracker";

registerBuiltinAiActions();

const ai = new Hono<{ Bindings: Bindings; Variables: Variables }>();

const resolveConfig = (c: any): TakosConfig | null => {
  const config = (c.get("takosConfig") || (c.env as any).takosConfig) as TakosConfig | undefined;
  return config ?? null;
};

const mapDispatchError = (error: unknown): { status: number; message: string } => {
  const message = error instanceof Error ? error.message : String(error);
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

ai.post("/api/ai/actions/:id/run", auth, async (c) => {
  const actionId = c.req.param("id")?.trim();
  if (!actionId) {
    return fail(c, "action id is required", 400);
  }

  const agentGuard = guardAgentRequest(c.req, { toolId: "tool.runAIAction" });
  if (!agentGuard.ok) {
    return fail(c, agentGuard.error, agentGuard.status);
  }
  // AI 使用量を追跡し、プラン制限をチェック
  const authContext = (c.get("authContext") as AuthContext | undefined) ?? null;
  const usageTracker = createUsageTrackerFromEnv(c.env as any);
  const userId = authContext?.userId ?? "anonymous";
  const currentUsage = await usageTracker.getAiUsage(userId);

  const planCheck = requireAiQuota(authContext, { used: currentUsage, requested: 1 });
  if (!planCheck.ok) {
    return fail(c, planCheck.message, planCheck.status, {
      code: planCheck.code,
      details: planCheck.details,
    });
  }

  const nodeConfig = resolveConfig(c);
  if (!nodeConfig) {
    return fail(c, "takos-config is not available for this node", 500);
  }

  const aiConfig = mergeTakosAiConfig(DEFAULT_TAKOS_AI_CONFIG, nodeConfig.ai ?? {});
  const normalizedConfig: TakosConfig = { ...nodeConfig, ai: aiConfig };

  let input: unknown;
  try {
    input = await c.req.json();
  } catch {
    return fail(c, "invalid JSON body", 400);
  }

  if (aiConfig.requires_external_network === false) {
    return fail(c, "AI external network access is disabled for this node", 503);
  }

  const services = buildCoreServices(c.env as Bindings);
  const aiAudit = createAiAuditLogger(c.env as any);
  const appAuth = getAppAuthContext(c as any);

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

  try {
    const result = await dispatchAiAction(aiActionRegistry, actionId, {
      nodeConfig: normalizedConfig,
      user: c.get("user"),
      agentType: agentGuard.agentType,
      auth: authContext ?? undefined,
      services,
      appAuth,
      env: c.env,
      aiAudit,
      providers,
    }, input);

    // 成功時に使用量を記録
    await usageTracker.recordAiRequest(userId);

    return ok(c, {
      action_id: actionId,
      provider: getDefaultProviderId(providers) ?? null,
      result,
    });
  } catch (error: unknown) {
    const mapped = mapDispatchError(error);
    return fail(c, mapped.message, mapped.status);
  }
});

export default ai;
