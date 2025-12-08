import { resolvePlanFromEnv, type PlanInfo } from "./auth-context-model";
import type { WorkspaceStore, WorkspaceUsage } from "./workspace-store";

export type WorkspaceLimitSet = {
  maxWorkspaces: number;
  maxFiles: number;
  maxFileSize: number;
  totalSize: number;
  compileCacheTtlSeconds: number;
};

const KB = 1024;
const MB = 1024 * KB;
const GB = 1024 * MB;
const UNLIMITED = Number.MAX_SAFE_INTEGER;

const LIMITS_BY_PLAN: Record<string, WorkspaceLimitSet> = {
  free: {
    maxWorkspaces: 1,
    maxFiles: 100,
    maxFileSize: 100 * KB,
    totalSize: 10 * MB,
    compileCacheTtlSeconds: 60 * 60, // 1h
  },
  pro: {
    maxWorkspaces: 5,
    maxFiles: 1_000,
    maxFileSize: 1 * MB,
    totalSize: 100 * MB,
    compileCacheTtlSeconds: 24 * 60 * 60, // 24h
  },
  business: {
    maxWorkspaces: 20,
    maxFiles: 10_000,
    maxFileSize: 10 * MB,
    totalSize: 1 * GB,
    compileCacheTtlSeconds: 7 * 24 * 60 * 60, // 7d
  },
  "self-hosted": {
    maxWorkspaces: UNLIMITED,
    maxFiles: UNLIMITED,
    maxFileSize: UNLIMITED,
    totalSize: UNLIMITED,
    compileCacheTtlSeconds: 7 * 24 * 60 * 60,
  },
};

const clampPositive = (value: number | undefined): number => {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return UNLIMITED;
  return value;
};

const fromPlanLimits = (plan: PlanInfo | null | undefined): WorkspaceLimitSet | null => {
  if (!plan?.limits) return null;
  const ttl =
    LIMITS_BY_PLAN[plan.name]?.compileCacheTtlSeconds ??
    LIMITS_BY_PLAN["self-hosted"].compileCacheTtlSeconds;
  return {
    maxWorkspaces: clampPositive(plan.limits.vfsMaxWorkspaces),
    maxFiles: clampPositive(plan.limits.vfsMaxFiles),
    maxFileSize: clampPositive(plan.limits.vfsMaxFileSize),
    totalSize: clampPositive(plan.limits.vfsStorage),
    compileCacheTtlSeconds: ttl,
  };
};

export const getWorkspaceLimits = (plan: PlanInfo | string | null | undefined): WorkspaceLimitSet => {
  if (plan && typeof plan !== "string") {
    const derived = fromPlanLimits(plan);
    if (derived) return derived;
  }
  const name = typeof plan === "string" ? plan : plan?.name ?? "self-hosted";
  return LIMITS_BY_PLAN[name] ?? LIMITS_BY_PLAN["self-hosted"];
};

export const resolveWorkspaceLimitsFromEnv = (env: any): WorkspaceLimitSet => {
  const plan = resolvePlanFromEnv(env);
  return getWorkspaceLimits(plan);
};

export type WorkspaceLimitCheck =
  | { ok: true; usage: WorkspaceUsage }
  | { ok: false; reason: string; usage: WorkspaceUsage };

export async function ensureWithinWorkspaceLimits(
  store: WorkspaceStore,
  workspaceId: string,
  path: string,
  size: number,
  limits: WorkspaceLimitSet,
): Promise<WorkspaceLimitCheck> {
  const usage =
    (await store.getWorkspaceUsage?.(workspaceId)) ?? {
      fileCount: 0,
      totalSize: 0,
    };

  const stat = store.statWorkspaceFile ? await store.statWorkspaceFile(workspaceId, path) : null;
  const existingSize = stat?.size ?? 0;
  const isNewFile = !stat;

  const nextFileCount = usage.fileCount + (isNewFile ? 1 : 0);
  const nextTotalSize = usage.totalSize - existingSize + size;

  if (Number.isFinite(limits.maxFileSize) && size > clampPositive(limits.maxFileSize)) {
    return {
      ok: false,
      reason: "workspace_file_too_large",
      usage,
    };
  }

  if (Number.isFinite(limits.maxFiles) && nextFileCount > clampPositive(limits.maxFiles)) {
    return {
      ok: false,
      reason: "workspace_file_limit_exceeded",
      usage,
    };
  }

  if (Number.isFinite(limits.totalSize) && nextTotalSize > clampPositive(limits.totalSize)) {
    return {
      ok: false,
      reason: "workspace_storage_limit_exceeded",
      usage,
    };
  }

  return { ok: true, usage: { fileCount: nextFileCount, totalSize: nextTotalSize } };
}
