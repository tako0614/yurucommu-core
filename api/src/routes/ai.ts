import { Hono } from "hono";
import type { PublicAccountBindings as Bindings, TakosConfig, Variables } from "@takos/platform/server";
import {
  aiActionRegistry,
  buildAiProviderRegistry,
  dispatchAiAction,
  fail,
  ok,
} from "@takos/platform/server";
import { auth } from "../middleware/auth";
import { guardAgentRequest } from "../lib/agent-guard";
import { getDefaultProviderId, registerBuiltinAiActions } from "../ai/actions";

registerBuiltinAiActions();

const ai = new Hono<{ Bindings: Bindings; Variables: Variables }>();

const resolveConfig = (c: any): TakosConfig | null => {
  const config = (c.get("takosConfig") || (c.env as any).takosConfig) as TakosConfig | undefined;
  return config ?? null;
};

const mapDispatchError = (error: unknown): { status: number; message: string } => {
  const message = error instanceof Error ? error.message : String(error);
  if (/Unknown AI action/i.test(message)) return { status: 404, message: "unknown action" };
  if (/not enabled/i.test(message)) return { status: 403, message };
  if (/AI is disabled/i.test(message)) return { status: 403, message };
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

  const nodeConfig = resolveConfig(c);
  if (!nodeConfig) {
    return fail(c, "takos-config is not available for this node", 500);
  }

  let input: unknown;
  try {
    input = await c.req.json();
  } catch {
    return fail(c, "invalid JSON body", 400);
  }

  let providers;
  try {
    providers = buildAiProviderRegistry(nodeConfig.ai, c.env as any);
    if (providers.warnings?.length) {
      console.warn(`[ai] provider warnings: ${providers.warnings.join("; ")}`);
    }
  } catch (error: any) {
    const message = error?.message || "failed to resolve AI providers";
    return fail(c, message, 400);
  }

  try {
    const result = await dispatchAiAction(aiActionRegistry, actionId, {
      nodeConfig,
      user: c.get("user"),
      agentType: agentGuard.agentType,
      providers,
    }, input);
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
