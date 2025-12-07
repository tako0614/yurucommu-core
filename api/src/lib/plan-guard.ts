import type { AuthContext, PlanInfo } from "./auth-context-model";

export type PlanGuardResult = { ok: true } | { ok: false; status: number; message: string };

const hasFeature = (plan: PlanInfo | null | undefined, feature: string): boolean => {
  if (!plan) return false;
  if (!Array.isArray(plan.features)) return false;
  return plan.features.includes("*") || plan.features.includes(feature);
};

export const requirePlanFeature = (
  auth: AuthContext | null,
  feature: string,
  message?: string,
): PlanGuardResult => {
  if (hasFeature(auth?.plan, feature)) return { ok: true };
  return {
    ok: false,
    status: 402,
    message: message || `This operation requires plan feature "${feature}"`,
  };
};

export const requireAiQuota = (auth: AuthContext | null): PlanGuardResult => {
  const plan = auth?.plan;
  if (!hasFeature(plan, "ai")) {
    return {
      ok: false,
      status: 402,
      message: "AI features require an upgraded plan",
    };
  }

  if (typeof plan?.limits?.aiRequests === "number" && plan.limits.aiRequests <= 0) {
    return {
      ok: false,
      status: 402,
      message: "AI request quota is unavailable for this plan",
    };
  }

  return { ok: true };
};

export const requireFileSizeWithinPlan = (
  auth: AuthContext | null,
  size: number,
): PlanGuardResult => {
  const limit = auth?.plan?.limits?.fileSize;
  if (typeof limit === "number" && size > limit) {
    return {
      ok: false,
      status: 413,
      message: `File size exceeds plan limit (${Math.floor(limit / 1024 / 1024)}MB)`,
    };
  }
  return { ok: true };
};
