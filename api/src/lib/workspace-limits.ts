import { resolvePlanFromEnv, type PlanInfo } from "./auth-context-model";
import type { WorkspaceStore, WorkspaceUsage } from "./workspace-store";

export type WorkspaceLimitSet = {
  maxWorkspaces: number;
  maxFiles: number;
  maxFileSize: number;
  totalSize: number;
  compileCacheTtlSeconds: number;
};

const UNLIMITED = Number.MAX_SAFE_INTEGER;

const DEFAULT_COMPILE_CACHE_TTL_SECONDS = 7 * 24 * 60 * 60; // 7d

const clampPositive = (value: number | undefined): number => {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return UNLIMITED;
  return value;
};

const fromPlanLimits = (plan: PlanInfo | null | undefined): WorkspaceLimitSet | null => {
  if (!plan?.limits) return null;
  return {
    maxWorkspaces: clampPositive(plan.limits.vfsMaxWorkspaces),
    maxFiles: clampPositive(plan.limits.vfsMaxFiles),
    maxFileSize: clampPositive(plan.limits.vfsMaxFileSize),
    totalSize: clampPositive(plan.limits.vfsStorage),
    compileCacheTtlSeconds: DEFAULT_COMPILE_CACHE_TTL_SECONDS,
  };
};

export const getWorkspaceLimits = (plan: PlanInfo | string | null | undefined): WorkspaceLimitSet => {
  if (plan && typeof plan !== "string") {
    const derived = fromPlanLimits(plan);
    if (derived) return derived;
  }
  return {
    maxWorkspaces: UNLIMITED,
    maxFiles: UNLIMITED,
    maxFileSize: UNLIMITED,
    totalSize: UNLIMITED,
    compileCacheTtlSeconds: DEFAULT_COMPILE_CACHE_TTL_SECONDS,
  };
};

export const resolveWorkspaceLimitsFromEnv = (env: any): WorkspaceLimitSet => {
  const plan = resolvePlanFromEnv(env);
  const limits = getWorkspaceLimits(plan);
  const ttlRaw = env?.TAKOS_VFS_COMPILE_CACHE_TTL_SECONDS ?? env?.VFS_COMPILE_CACHE_TTL_SECONDS;
  const ttl =
    typeof ttlRaw === "number"
      ? ttlRaw
      : typeof ttlRaw === "string" && ttlRaw.trim()
        ? Number(ttlRaw.trim())
        : null;
  if (typeof ttl === "number" && Number.isFinite(ttl) && ttl > 0) {
    return { ...limits, compileCacheTtlSeconds: Math.trunc(ttl) };
  }
  return limits;
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
