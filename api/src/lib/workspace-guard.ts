import { fail } from "@takos/platform/server";
import { guardAgentRequest } from "./agent-guard";
import { resolvePlanFromEnv, type AuthContext } from "./auth-context-model";
import { requirePlanFeature } from "./plan-guard";

/**
 * Ensures the caller is an authenticated human (not an agent) session.
 */
export const requireHumanSession = async (c: any, next: () => Promise<void>) => {
  const guard = guardAgentRequest(c.req, { forbidAgents: true });
  if (!guard.ok) {
    return fail(c as any, guard.error, guard.status);
  }
  const user = c.get("user");
  if (!user?.id) {
    return fail(c as any, "authentication required", 403);
  }
  await next();
};

/**
 * Verifies the active plan allows App customization / VFS operations.
 */
export const requireWorkspacePlan = async (c: any, next: () => Promise<void>) => {
  const authContext = (c.get("authContext") as AuthContext | null) ?? null;
  const fallbackContext = { plan: resolvePlanFromEnv(c.env as any) };
  const guard = requirePlanFeature(
    (authContext ?? (fallbackContext as any)) as AuthContext | null,
    "app_customization",
    "App customization is not available on this plan",
  );
  if (!guard.ok) {
    return fail(c as any, guard.message, guard.status, {
      code: guard.code,
      details: guard.details,
    });
  }
  await next();
};
