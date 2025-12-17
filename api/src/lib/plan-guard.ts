import type { AuthContext, PlanInfo } from "./auth-context-model";
import { ErrorCodes, type ErrorCode } from "./error-codes";

export type PlanGuardResult =
  | { ok: true }
  | { ok: false; status: number; code: ErrorCode; message: string; details?: Record<string, unknown> };

const hasFeature = (plan: PlanInfo | null | undefined, feature: string): boolean => {
  if (!plan) return false;
  if (!Array.isArray(plan.features)) return false;
  return plan.features.includes("*") || plan.features.includes(feature);
};

const buildError = (
  status: number,
  code: ErrorCode,
  message: string,
  details?: Record<string, unknown>,
): PlanGuardResult => ({
  ok: false,
  status,
  code,
  message,
  details,
});

const resolvePlanLimits = (auth: AuthContext | null | undefined) => auth?.limits ?? auth?.plan?.limits;

export const requirePlanFeature = (
  auth: AuthContext | null,
  feature: string,
  message?: string,
): PlanGuardResult => {
  if (hasFeature(auth?.plan, feature)) return { ok: true };
  return buildError(
    402,
    ErrorCodes.FEATURE_UNAVAILABLE,
    message || `This operation requires plan feature "${feature}"`,
    { feature, plan: auth?.plan?.name ?? "unknown" },
  );
};

export const requireAiQuota = (
  auth: AuthContext | null,
  usage?: { used?: number; requested?: number },
): PlanGuardResult => {
  const plan = auth?.plan;
  if (!hasFeature(plan, "ai")) {
    return buildError(402, ErrorCodes.AI_UNAVAILABLE, "AI features require an upgraded plan", {
      plan: plan?.name ?? "unknown",
    });
  }

  const limits = resolvePlanLimits(auth);
  const limit = limits?.aiRequests;
  if (typeof limit === "number" && limit <= 0) {
    return buildError(402, ErrorCodes.AI_UNAVAILABLE, "AI request quota is unavailable for this plan", {
      plan: plan?.name ?? "unknown",
    });
  }

  const current = usage?.used ?? 0;
  const requested = usage?.requested ?? 1;
  if (typeof limit === "number" && Number.isFinite(limit) && limit !== Number.MAX_SAFE_INTEGER) {
    if (current + requested > limit) {
      return buildError(429, ErrorCodes.AI_LIMIT_EXCEEDED, "Monthly AI request limit reached", {
        used: current,
        requested,
        limit,
      });
    }
  }

  return { ok: true };
};

export const requireFileSizeWithinPlan = (
  auth: AuthContext | null,
  size: number,
): PlanGuardResult => {
  const limit = resolvePlanLimits(auth)?.fileSize;
  if (typeof limit === "number" && Number.isFinite(limit) && limit !== Number.MAX_SAFE_INTEGER && size > limit) {
    return buildError(
      413,
      ErrorCodes.FILE_TOO_LARGE,
      `File size exceeds plan limit (${Math.floor(limit / 1024 / 1024)}MB)`,
      { size, limit },
    );
  }
  return { ok: true };
};

export const requireStorageWithinPlan = (
  auth: AuthContext | null,
  usageBytes: number,
  incomingBytes: number = 0,
): PlanGuardResult => {
  const limit = resolvePlanLimits(auth)?.storage;
  if (
    typeof limit === "number" &&
    Number.isFinite(limit) &&
    limit !== Number.MAX_SAFE_INTEGER &&
    usageBytes + incomingBytes > limit
  ) {
    return buildError(507, ErrorCodes.STORAGE_LIMIT_EXCEEDED, "Storage limit reached for current plan", {
      used: usageBytes,
      incoming: incomingBytes,
      limit,
    });
  }
  return { ok: true };
};

export const requireVfsQuota = (
  auth: AuthContext | null,
  usage: { totalSize?: number; fileCount?: number; fileSize?: number; workspaces?: number },
): PlanGuardResult => {
  const limits = resolvePlanLimits(auth);
  if (!limits) return { ok: true };

  if (
    typeof limits.vfsMaxWorkspaces === "number" &&
    Number.isFinite(limits.vfsMaxWorkspaces) &&
    limits.vfsMaxWorkspaces !== Number.MAX_SAFE_INTEGER &&
    typeof usage.workspaces === "number" &&
    usage.workspaces > limits.vfsMaxWorkspaces
  ) {
    return buildError(
      429,
      ErrorCodes.RATE_LIMIT_EXCEEDED,
      "VFS workspace limit exceeded for current plan",
      { count: usage.workspaces, limit: limits.vfsMaxWorkspaces },
    );
  }

  if (
    typeof limits.vfsMaxFileSize === "number" &&
    Number.isFinite(limits.vfsMaxFileSize) &&
    limits.vfsMaxFileSize !== Number.MAX_SAFE_INTEGER &&
    typeof usage.fileSize === "number" &&
    usage.fileSize > limits.vfsMaxFileSize
  ) {
    return buildError(
      413,
      ErrorCodes.FILE_TOO_LARGE,
      "VFS file size exceeds plan limit",
      { size: usage.fileSize, limit: limits.vfsMaxFileSize },
    );
  }

  if (
    typeof limits.vfsMaxFiles === "number" &&
    Number.isFinite(limits.vfsMaxFiles) &&
    limits.vfsMaxFiles !== Number.MAX_SAFE_INTEGER &&
    typeof usage.fileCount === "number" &&
    usage.fileCount > limits.vfsMaxFiles
  ) {
    return buildError(
      429,
      ErrorCodes.RATE_LIMIT_EXCEEDED,
      "VFS file count exceeds plan allowance",
      { count: usage.fileCount, limit: limits.vfsMaxFiles },
    );
  }

  if (
    typeof limits.vfsStorage === "number" &&
    Number.isFinite(limits.vfsStorage) &&
    limits.vfsStorage !== Number.MAX_SAFE_INTEGER &&
    typeof usage.totalSize === "number" &&
    usage.totalSize > limits.vfsStorage
  ) {
    return buildError(
      507,
      ErrorCodes.STORAGE_LIMIT_EXCEEDED,
      "VFS storage limit reached",
      { used: usage.totalSize, limit: limits.vfsStorage },
    );
  }

  return { ok: true };
};

export const requireApDeliveryQuota = (
  auth: AuthContext | null,
  usage: { minute?: number; day?: number; requested?: number },
): PlanGuardResult => {
  const limits = resolvePlanLimits(auth);
  if (!limits) return { ok: true };
  const requested = usage.requested ?? 1;

  if (
    typeof limits.apDeliveryPerMinute === "number" &&
    Number.isFinite(limits.apDeliveryPerMinute) &&
    limits.apDeliveryPerMinute !== Number.MAX_SAFE_INTEGER &&
    typeof usage.minute === "number" &&
    usage.minute + requested > limits.apDeliveryPerMinute
  ) {
    return buildError(
      429,
      ErrorCodes.RATE_LIMIT_MINUTE,
      "ActivityPub delivery per-minute limit exceeded",
      { used: usage.minute, requested, limit: limits.apDeliveryPerMinute },
    );
  }

  if (
    typeof limits.apDeliveryPerDay === "number" &&
    Number.isFinite(limits.apDeliveryPerDay) &&
    limits.apDeliveryPerDay !== Number.MAX_SAFE_INTEGER &&
    typeof usage.day === "number" &&
    usage.day + requested > limits.apDeliveryPerDay
  ) {
    return buildError(
      429,
      ErrorCodes.RATE_LIMIT_DAY,
      "ActivityPub daily delivery limit exceeded",
      { used: usage.day, requested, limit: limits.apDeliveryPerDay },
    );
  }

  return { ok: true };
};
