import type { AppManifestValidationIssue } from "@takos/platform/app";
import { APP_MANIFEST_SCHEMA_VERSION, checkSemverCompatibility } from "@takos/platform/server";
import type { AppWorkspaceStatus } from "./types";
import {
  ensureDefaultWorkspace,
  loadWorkspaceManifest,
  resolveWorkspaceEnv,
  type WorkspaceStore,
} from "./workspace-store";

export type WorkspaceSnapshot = {
  id: string;
  status: AppWorkspaceStatus;
  manifest: Record<string, unknown>;
  scriptRef: string;
  validatedAt?: string | null;
  validationIssues?: AppManifestValidationIssue[];
};

export type WorkspaceValidationResult = {
  ok: boolean;
  schemaVersion?: string;
  warnings: string[];
  errors: string[];
  issues: AppManifestValidationIssue[];
};

export type WorkspaceLoaderOptions = {
  env?: any;
  store?: WorkspaceStore | null;
};

type WorkspaceLoader =
  | ((
      workspaceId: string,
      options?: WorkspaceLoaderOptions,
    ) => Promise<WorkspaceSnapshot | null> | WorkspaceSnapshot | null)
  | null;

const normalizeStatus = (value: unknown): AppWorkspaceStatus =>
  value === "draft" ||
  value === "validated" ||
  value === "testing" ||
  value === "ready" ||
  value === "applied"
    ? value
    : "validated";

const normalizeSchemaVersion = (manifest: Record<string, unknown>): string | null => {
  const raw = (manifest as any).schema_version ?? (manifest as any).schemaVersion;
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const normalizeScriptRef = (manifest: Record<string, unknown>): string => {
  const raw = (manifest as any).scriptRef ?? (manifest as any).script_ref;
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (trimmed.length > 0) return trimmed;
  }
  return "";
};

const buildDefaultLoader = (): NonNullable<WorkspaceLoader> => {
  return async (workspaceId: string, options?: WorkspaceLoaderOptions) => {
    const resolution = resolveWorkspaceEnv({
      env: options?.env as any,
      store: options?.store ?? null,
      mode: "dev",
      requireIsolation: true,
    });

    if (resolution.isolation?.required && !resolution.isolation.ok) {
      return null;
    }

    const store = resolution.store;

    if (!store && !workspaceId) {
      return null;
    }

    if (store) {
      await ensureDefaultWorkspace(store);
    }

    const workspace = store ? await store.getWorkspace(workspaceId) : null;
    if (!workspace) {
      return null;
    }

    const manifest =
      (await loadWorkspaceManifest(workspaceId, {
        mode: "dev",
        env: resolution.env,
        store: store ?? undefined,
      })) ?? null;
    if (!manifest) return null;
    const normalizedManifest: Record<string, unknown> = {
      routes: [],
      ap: { handlers: [] },
      data: { collections: {} },
      storage: { buckets: {} },
      ...manifest,
    };
    return {
      id: workspaceId,
      status: normalizeStatus(workspace.status),
      manifest: normalizedManifest,
      scriptRef: normalizeScriptRef(normalizedManifest),
      validatedAt: (manifest as any).validatedAt ?? (manifest as any).validated_at ?? null,
      validationIssues: Array.isArray((manifest as any).validationIssues)
        ? ((manifest as any).validationIssues as AppManifestValidationIssue[])
        : [],
    };
  };
};

let workspaceLoader: WorkspaceLoader = buildDefaultLoader();

export function setWorkspaceLoader(loader: WorkspaceLoader): void {
  workspaceLoader = loader ?? buildDefaultLoader();
}

export async function loadWorkspaceSnapshot(
  workspaceId: string,
  options?: WorkspaceLoaderOptions,
): Promise<WorkspaceSnapshot | null> {
  if (!workspaceLoader) return null;
  const snapshot = await workspaceLoader(workspaceId, options);
  return snapshot ?? null;
}

export function validateWorkspaceForApply(workspace: WorkspaceSnapshot | null): WorkspaceValidationResult {
  const warnings: string[] = [];
  const errors: string[] = [];
  const issues: AppManifestValidationIssue[] = Array.isArray(workspace?.validationIssues)
    ? [...(workspace?.validationIssues as AppManifestValidationIssue[])]
    : [];

  if (!workspace) {
    return { ok: false, warnings, errors: ["workspace not found"], issues };
  }

  const manifest = workspace.manifest;
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    return { ok: false, warnings, errors: ["workspace manifest is missing or invalid"], issues };
  }

  if (!workspace.scriptRef || typeof workspace.scriptRef !== "string") {
    errors.push("workspace is missing scriptRef");
  }

  if (workspace.status !== "validated" && workspace.status !== "ready") {
    errors.push(`workspace status must be validated or ready (got "${workspace.status}")`);
  }

  const schemaVersion = normalizeSchemaVersion(manifest);
  if (!schemaVersion) {
    issues.push({
      severity: "error",
      message: "app manifest schema_version is required",
    });
  } else {
    const versionCheck = checkSemverCompatibility(APP_MANIFEST_SCHEMA_VERSION, schemaVersion, {
      context: "app manifest schema_version",
      action: "apply",
    });
    if (!versionCheck.ok) {
      errors.push(versionCheck.error || "app manifest schema_version is not compatible");
    }
    warnings.push(...versionCheck.warnings);
  }

  const ok = errors.length === 0 && !issues.some((issue) => issue.severity === "error");

  return {
    ok,
    schemaVersion: schemaVersion ?? undefined,
    warnings,
    errors,
    issues,
  };
}
