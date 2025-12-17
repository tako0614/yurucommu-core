import { Hono } from "hono";
import type { PublicAccountBindings as Bindings, Variables } from "@takos/platform/server";
import {
  APP_MANIFEST_SCHEMA_VERSION,
  applyPatch,
  checkSemverCompatibility,
  fail,
  nowISO,
  ok,
  releaseStore,
  TAKOS_CORE_VERSION,
} from "@takos/platform/server";
import {
  createInMemoryAppSource,
  loadAppManifest,
  parseUiContractJson,
  validateUiContractAgainstManifest,
  type AppManifestValidationIssue,
  type UiContract,
} from "@takos/platform/app";
import { makeData } from "../data";
import { guardAgentRequest } from "../lib/agent-guard";
import {
  buildAppRevisionDiff,
  renderAppRevisionDiffHtml,
  type AppRevisionRecord,
} from "../lib/app-revision-diff";
import { loadWorkspaceSnapshot, validateWorkspaceForApply } from "../lib/app-workspace";
import { ensureDefaultWorkspace, resolveWorkspaceEnv } from "../lib/workspace-store";
import { auth } from "../middleware/auth";
import { resolvePlanFromEnv } from "../lib/auth-context-model";
import { requirePlanFeature } from "../lib/plan-guard";
import {
  ensureWithinWorkspaceLimits,
  resolveWorkspaceLimitsFromEnv,
} from "../lib/workspace-limits";
import adminAppRoutes from "./admin-app";
import type {
  AppRevisionAuditDetails,
  AppRevisionAuditInput,
  AppWorkspaceStatus,
} from "../lib/types";
import defaultUiContract from "../../../schemas/ui-contract.json";
import { clearManifestRouterCache } from "../lib/manifest-routing";
import { validateWorkspaceManifest } from "../lib/app-workspace-validation";

type AuthResult =
  | { ok: true; user: string }
  | { ok: false; status: number; message: string };

function decodeBasicAuth(encoded: string): string | null {
  try {
    // Use Web standard atob (available in both Workers and Node.js 16+)
    return atob(encoded);
  } catch {
    // fall through
  }
  return null;
}

function checkAuth(c: any): AuthResult {
  const username = c.env.AUTH_USERNAME?.trim();
  const password = c.env.AUTH_PASSWORD?.trim();
  if (!username || !password) {
    return { ok: false, status: 500, message: "authentication credentials are not configured" };
  }
  const header = c.req.header("Authorization") || "";
  if (!header.startsWith("Basic ")) {
    return { ok: false, status: 401, message: "authentication required" };
  }
  const encoded = header.slice("Basic ".length).trim();
  const decoded = decodeBasicAuth(encoded);
  if (!decoded || !decoded.includes(":")) {
    return { ok: false, status: 401, message: "invalid authorization header" };
  }
  const [user, ...rest] = decoded.split(":");
  const pass = rest.join(":");
  if (user !== username || pass !== password) {
    return { ok: false, status: 401, message: "invalid credentials" };
  }
  return { ok: true, user };
}

type WorkspaceLifecycleStatus = Extract<
  AppWorkspaceStatus,
  "draft" | "validated" | "ready" | "applied"
>;

const WORKSPACE_LIFECYCLE_STATUSES: WorkspaceLifecycleStatus[] = [
  "draft",
  "validated",
  "ready",
  "applied",
];

const normalizeWorkspaceLifecycleStatus = (value: unknown): WorkspaceLifecycleStatus | null => {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return (WORKSPACE_LIFECYCLE_STATUSES as string[]).includes(normalized)
    ? (normalized as WorkspaceLifecycleStatus)
    : null;
};

const canTransitionWorkspaceStatus = (
  current: AppWorkspaceStatus,
  next: WorkspaceLifecycleStatus,
): boolean => {
  if (current === next) return true;
  if (current === "draft" && next === "validated") return true;
  if (current === "validated" && next === "ready") return true;
  if (current === "ready" && next === "applied") return true;
  return false;
};

const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();
const normalizeVfsPath = (path: string): string => path.replace(/^\/+/, "").replace(/\\/g, "/").trim();

const extractWorkspaceFilePathFromUrl = (c: any, workspaceId: string): string => {
  const pathname = decodeURIComponent(new URL(c.req.url).pathname);
  const prefix = `/-/app/workspaces/${workspaceId}/files/`;
  const raw = pathname.startsWith(prefix) ? pathname.slice(prefix.length) : "";
  return normalizeVfsPath(raw);
};

const parseContentFromBody = (raw: string): { content: string; contentType: string } => {
  const fallback = { content: raw, contentType: "text/plain" };
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && parsed.content !== undefined) {
      const contentType =
        typeof (parsed as any).content_type === "string" && (parsed as any).content_type.trim()
          ? (parsed as any).content_type.trim()
          : "application/json";
      const content =
        typeof (parsed as any).content === "string"
          ? (parsed as any).content
          : (parsed as any).content != null
            ? JSON.stringify((parsed as any).content)
            : "";
      return { content, contentType };
    }
  } catch {
    // fall back to raw text
  }
  return fallback;
};

const computeWorkspaceUsage = async (store: any, workspaceId: string) => {
  if (store && typeof store.getWorkspaceUsage === "function") {
    const usage = await store.getWorkspaceUsage(workspaceId);
    if (usage) return usage;
  }
  if (store && typeof store.listWorkspaceFiles === "function") {
    const files = await store.listWorkspaceFiles(workspaceId);
    const totalSize = files.reduce(
      (acc: number, file: any) => acc + (file.size ?? file.content?.length ?? 0),
      0,
    );
    return { fileCount: files.length, totalSize };
  }
  return { fileCount: 0, totalSize: 0 };
};

const RESERVED_WORKSPACE_IDS = new Set(["default", "demo", "ws_demo"]);

const shouldValidateWorkspaceStatus = (status: WorkspaceLifecycleStatus): boolean =>
  status === "validated" || status === "ready" || status === "applied";

const normalizeCacheHash = (value: string): string => value.replace(/[^A-Za-z0-9_.-]/g, "").slice(0, 128);

const buildSchemaCheck = (
  expected: string | null,
  actual: string | null,
  check: ReturnType<typeof checkSemverCompatibility>,
  from?: string | null,
  to?: string | null,
) => ({
  expected,
  actual,
  ...(from !== undefined ? { from } : {}),
  ...(to !== undefined ? { to } : {}),
  ok: !!check?.ok,
  warnings: check?.warnings ?? [],
  error: check?.error ?? null,
});

const recordRevisionAuditSafely = async (store: any, entry: AppRevisionAuditInput) => {
  if (!store?.recordAppRevisionAudit) return;
  try {
    await store.recordAppRevisionAudit(entry);
  } catch (error) {
    console.error("failed to record app revision audit", error);
  }
};

const markWorkspaceApplied = async (workspaceId: string | null | undefined, env: any) => {
  if (!workspaceId) return;
  const workspaceEnv = resolveWorkspaceEnv({
    env,
    mode: "dev",
    requireIsolation: true,
  });
  if (workspaceEnv.isolation?.required && !workspaceEnv.isolation.ok) {
    return;
  }
  if (!workspaceEnv.store?.updateWorkspaceStatus) return;
  try {
    await ensureDefaultWorkspace(workspaceEnv.store);
    await workspaceEnv.store.updateWorkspaceStatus(workspaceId, "applied");
  } catch (error) {
    console.warn("[app-manager] failed to update workspace status", error);
  }
};


const hasValidationErrors = (issues: AppManifestValidationIssue[]): boolean =>
  issues.some((issue) => issue.severity === "error");

const normalizeSchemaVersionValue = (manifest: Record<string, unknown>): string | undefined => {
  const raw = (manifest as any).schema_version ?? (manifest as any).schemaVersion;
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const normalizeSchemaVersionString = (value: unknown): string | null => {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (!value || typeof value !== "object") return null;
  const normalized = normalizeSchemaVersionValue(value as Record<string, unknown>);
  return normalized ?? null;
};

const normalizeScriptRef = (value: unknown): string => {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : "";
};

const parseManifestPayload = (
  raw: unknown,
): { ok: true; manifest: Record<string, unknown> } | { ok: false; error: string } => {
  let parsed = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { ok: false, error: "manifest must be valid JSON" };
    }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, error: "manifest must be an object" };
  }
  return { ok: true, manifest: parsed as Record<string, unknown> };
};

const extractHandlerNames = (payload: Record<string, unknown>): string[] => {
  const rawHandlers =
    (payload as any).handlers ??
    (payload as any).availableHandlers ??
    (payload as any).scriptHandlers;
  if (!Array.isArray(rawHandlers)) return [];
  return rawHandlers
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter((value) => value.length > 0);
};

const buildManifestFileMap = (manifest: Record<string, unknown>): Record<string, string> => {
  const files: Record<string, string> = {};
  const schemaVersion = normalizeSchemaVersionValue(manifest);
  const withSchema = (payload: Record<string, unknown>): Record<string, unknown> =>
    schemaVersion ? { schema_version: schemaVersion, ...payload } : payload;
  const root: Record<string, unknown> = {};
  if (schemaVersion !== undefined) {
    root.schema_version = schemaVersion;
  }
  if (Object.prototype.hasOwnProperty.call(manifest, "version")) {
    root.version = (manifest as any).version;
  }
  if (Object.prototype.hasOwnProperty.call(manifest, "layout")) {
    root.layout = (manifest as any).layout;
  } else {
    root.layout = { base_dir: "app" };
  }
  files["manifest.json"] = JSON.stringify(root);

  if (Object.prototype.hasOwnProperty.call(manifest, "routes")) {
    files["app/routes/manifest.json"] = JSON.stringify(withSchema({ routes: (manifest as any).routes }));
  }

  if (Object.prototype.hasOwnProperty.call(manifest, "views")) {
    const views = (manifest as any).views ?? {};
    const viewFragment: Record<string, unknown> = withSchema({});
    if (Object.prototype.hasOwnProperty.call(views, "screens")) {
      viewFragment.screens = (views as any).screens;
    }
    if (Object.prototype.hasOwnProperty.call(views, "insert")) {
      viewFragment.insert = (views as any).insert;
    } else if (Object.prototype.hasOwnProperty.call(views, "inserts")) {
      viewFragment.insert = (views as any).inserts;
    }
    files["app/views/manifest.json"] = JSON.stringify(viewFragment);
  }

  if (Object.prototype.hasOwnProperty.call(manifest, "ap")) {
    const ap = (manifest as any).ap ?? {};
    files["app/ap/manifest.json"] = JSON.stringify({ handlers: ap.handlers });
  }

  if (Object.prototype.hasOwnProperty.call(manifest, "data")) {
    files["app/data/manifest.json"] = JSON.stringify({
      collections: (manifest as any).data?.collections,
    });
  }

  if (Object.prototype.hasOwnProperty.call(manifest, "storage")) {
    files["app/storage/manifest.json"] = JSON.stringify({
      buckets: (manifest as any).storage?.buckets,
    });
  }

  return files;
};

const validateManifestWithLoader = async (
  manifest: Record<string, unknown>,
  handlerNames: string[],
): Promise<{ manifest?: any; issues: AppManifestValidationIssue[] }> => {
  const files = buildManifestFileMap(manifest);
  const source = createInMemoryAppSource(files);
  const result = await loadAppManifest({
    source,
    availableHandlers: handlerNames,
  });
  return { manifest: result.manifest, issues: result.issues };
};

type RevisionCandidateResult =
  | {
      ok: true;
      manifest: Record<string, unknown>;
      schemaVersion: string;
      scriptRef: string;
      warnings: string[];
      issues: AppManifestValidationIssue[];
      workspace: { id: string; status: string | null; validated_at: string | null } | null;
    }
  | { ok: false; response: Response };

const prepareRevisionCandidate = async (
  c: any,
  body: Record<string, unknown>,
): Promise<RevisionCandidateResult> => {
  const handlerNames = extractHandlerNames(body);
  const warnings: string[] = [];
  let issues: AppManifestValidationIssue[] = [];
  const workspaceId =
    typeof (body as any).workspaceId === "string" ? (body as any).workspaceId.trim() : "";

  let manifest: Record<string, unknown> | null = null;
  let schemaVersion: string | null = null;
  let scriptRef = "";
  let workspaceMeta: { id: string; status: string | null; validated_at: string | null } | null =
    null;

  if (workspaceId) {
    const workspaceEnv = resolveWorkspaceEnv({
      env: c.env,
      mode: "dev",
      requireIsolation: true,
    });
    if (workspaceEnv.isolation?.required && !workspaceEnv.isolation.ok) {
      return {
        ok: false,
        response: fail(
          c as any,
          workspaceEnv.isolation.errors[0] || "dev data isolation failed",
          503,
        ),
      };
    }
    await ensureDefaultWorkspace(workspaceEnv.store);
    const workspace = await loadWorkspaceSnapshot(workspaceId, {
      env: workspaceEnv.env,
      store: workspaceEnv.store,
    });
    if (!workspace) {
      return { ok: false, response: fail(c as any, "workspace not found", 404) };
    }
    const workspaceValidation = validateWorkspaceForApply(workspace);
    warnings.push(...workspaceValidation.warnings);
    issues = [...workspaceValidation.issues];
    if (!workspaceValidation.ok || !workspaceValidation.schemaVersion) {
      return {
        ok: false,
        response: c.json(
          {
            ok: false,
            error: "workspace_validation_failed",
            message: workspaceValidation.errors[0] || "workspace is not ready for apply",
            warnings,
            issues,
          },
          400 as any,
        ),
      };
    }
    manifest = workspace.manifest as Record<string, unknown>;
    schemaVersion = workspaceValidation.schemaVersion;
    scriptRef = typeof workspace.scriptRef === "string" ? workspace.scriptRef : "";
    workspaceMeta = {
      id: workspace.id,
      status: workspace.status ?? null,
      validated_at: workspace.validatedAt ?? null,
    };
  } else {
    const parsedManifest = parseManifestPayload((body as any).manifest);
    if (!parsedManifest.ok) {
      return { ok: false, response: fail(c as any, parsedManifest.error, 400) };
    }
    manifest = parsedManifest.manifest;
    schemaVersion = normalizeSchemaVersionValue(parsedManifest.manifest) ?? null;
    scriptRef = normalizeScriptRef((body as any).scriptRef);
    if (!scriptRef) {
      return { ok: false, response: fail(c as any, "scriptRef is required", 400) };
    }
  }

  const validation = await validateManifestWithLoader(
    manifest as Record<string, unknown>,
    handlerNames,
  );
  issues = [...issues, ...validation.issues];
  if (!validation.manifest || hasValidationErrors(validation.issues)) {
    return {
      ok: false,
      response: c.json(
        { ok: false, error: "manifest_validation_failed", issues: validation.issues },
        400 as any,
      ),
    };
  }

  const manifestForRevision = validation.manifest ?? manifest;
  const normalizedSchemaVersion =
    normalizeSchemaVersionValue(manifestForRevision) ?? schemaVersion ?? null;
  if (!normalizedSchemaVersion) {
    return { ok: false, response: fail(c as any, "app manifest schema_version is required", 400) };
  }

  const schemaCheck = checkSemverCompatibility(
    APP_MANIFEST_SCHEMA_VERSION,
    normalizedSchemaVersion,
    { context: "app manifest schema_version", action: "apply" },
  );
  if (!schemaCheck.ok) {
    const compatibilityError =
      schemaCheck.error && schemaCheck.error.toLowerCase().includes("not compatible")
        ? schemaCheck.error
        : schemaCheck.error
          ? `${schemaCheck.error} (not compatible)`
          : "app manifest schema_version is not compatible";
    return { ok: false, response: fail(c as any, compatibilityError, 400) };
  }
  warnings.push(...schemaCheck.warnings);
  warnings.push(
    ...validation.issues
      .filter((issue) => issue.severity === "warning" && typeof issue.message === "string")
      .map((issue) => issue.message as string),
  );

  return {
    ok: true,
    manifest: manifestForRevision as Record<string, unknown>,
    schemaVersion: normalizedSchemaVersion,
    scriptRef,
    warnings,
    issues,
    workspace: workspaceMeta,
  };
};

const appManagerRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

/** Require authenticated user for workspace operations */
const requireAuthenticatedSession = async (c: any, next: () => Promise<void>) => {
  const agentGuard = guardAgentRequest(c.req, { forbidAgents: true });
  if (!agentGuard.ok) {
    return fail(c as any, agentGuard.error, agentGuard.status);
  }
  const user = c.get("user");
  if (!user?.id) {
    return fail(c as any, "authentication required", 403);
  }
  await next();
};

const requireWorkspacePlan = async (c: any, next: () => Promise<void>) => {
  const plan = resolvePlanFromEnv(c.env as any);
  const planGuard = requirePlanFeature(
    { plan } as any,
    "app_customization",
    "App customization is not available on this plan",
  );
  if (!planGuard.ok) {
    return fail(c as any, planGuard.message, planGuard.status, {
      code: planGuard.code,
      details: planGuard.details,
    });
  }
  await next();
};

appManagerRoutes.use("/-/app/workspaces", auth, requireAuthenticatedSession);
appManagerRoutes.use("/-/app/workspaces/*", auth, requireAuthenticatedSession);
appManagerRoutes.use("/api/app/*", async (c, next) => {
  const authResult = checkAuth(c);
  if (!authResult.ok) {
    if (authResult.status === 401) {
      c.header("WWW-Authenticate", 'Basic realm="takos-api"');
    }
    return fail(c as any, authResult.message, authResult.status);
  }
  (c as any).set("authenticatedUser", authResult.user);
  await next();
});
appManagerRoutes.use("/-/app/workspaces", requireWorkspacePlan);
appManagerRoutes.use("/-/app/workspaces/*", requireWorkspacePlan);
appManagerRoutes.use("/api/app/*", requireWorkspacePlan);

appManagerRoutes.get("/api/app/revisions", async (c) => {
  const store = makeData(c.env as any, c);
  try {
    const limit = Math.min(
      100,
      Math.max(
        1,
        Number.parseInt(String(c.req.query("limit") ?? ""), 10) || 20,
      ),
    );
    const [state, revisions] = await Promise.all([
      store.getActiveAppRevision(),
      store.listAppRevisions(limit),
    ]);
    return ok(c as any, {
      active_revision_id: state?.active_revision_id ?? null,
      state,
      revisions,
    });
  } finally {
    await releaseStore(store);
  }
});

appManagerRoutes.get("/api/app/revisions/audit", async (c) => {
  const store = makeData(c.env as any, c);
  try {
    if (!store.listAppRevisionAudit) {
      return fail(c as any, "app revision audit is not supported", 501);
    }
    const limit = Math.min(
      100,
      Math.max(
        1,
        Number.parseInt(String(c.req.query("limit") ?? ""), 10) || 50,
      ),
    );
    const entries = await store.listAppRevisionAudit(limit);
    return ok(c as any, { entries, limit });
  } catch (error) {
    console.error("failed to list app revision audit", error);
    return fail(c as any, "failed to list app revision audit", 500);
  } finally {
    await releaseStore(store);
  }
});

appManagerRoutes.get("/api/app/revisions/diff", async (c) => {
  const store = makeData(c.env as any, c);
  try {
    if (!store.listAppRevisions) {
      return fail(c as any, "app revisions are not supported", 501);
    }
    const revisions = await store.listAppRevisions(2);
    if (!revisions || revisions.length === 0) {
      return fail(c as any, "no app revisions found", 404);
    }
    const newer = revisions[0];
    const older = revisions[1] ?? null;

    const diff = buildAppRevisionDiff(newer, older);
    if (!diff.ok) {
      return fail(c as any, diff.error, 500);
    }

    const format = (c.req.query("format") || "").trim().toLowerCase();
    const wantsHtml =
      format === "html" || (c.req.header("accept") || "").toLowerCase().includes("text/html");

    if (wantsHtml) {
      return c.html(renderAppRevisionDiffHtml(diff.diff));
    }

    return c.json({ ok: true, ...diff.diff });
  } catch (error) {
    console.error("failed to compute app revision diff", error);
    return fail(c as any, "failed to compute app revision diff", 500);
  } finally {
    await releaseStore(store);
  }
});

appManagerRoutes.post("/api/app/revisions/apply", async (c) => {
  const agentGuard = guardAgentRequest(c.req, { forbidAgents: true });
  if (!agentGuard.ok) {
    return fail(c as any, agentGuard.error, agentGuard.status);
  }
  const store = makeData(c.env as any, c);
  try {
    if (
      !store.createAppRevision ||
      !store.setActiveAppRevision ||
      !store.getActiveAppRevision ||
      !store.getAppRevision
    ) {
      return fail(c as any, "app revisions are not supported", 501);
    }
    const previousState = await store.getActiveAppRevision();
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const prepared = await prepareRevisionCandidate(c, body);
    if (!prepared.ok) {
      return prepared.response;
    }

    const warnings = [...prepared.warnings];
    const issues = [...prepared.issues];
    const manifestForRevision = prepared.manifest;
    const normalizedSchemaVersion = prepared.schemaVersion;
    const scriptRef = prepared.scriptRef;
    const workspaceMeta = prepared.workspace;

    const requestedId =
      typeof (body as any).revisionId === "string" && (body as any).revisionId.trim().length > 0
        ? (body as any).revisionId.trim()
        : "";
    if (requestedId) {
      const exists = await store.getAppRevision(requestedId);
      if (exists) {
        return fail(c as any, "revision already exists", 409);
      }
    }
    const author = ((body as any).author ?? {}) as Record<string, any>;
    if (author.type === "agent") {
      return fail(c as any, "AI agents cannot apply app revisions", 403);
    }
    const authorType = author.type === "agent" ? "agent" : "human";
    const authorName =
      typeof author.name === "string" && author.name.trim().length > 0
        ? author.name.trim()
        : (c as any).get("authenticatedUser");
    const saved = await store.createAppRevision({
      id: requestedId || undefined,
      schema_version: normalizedSchemaVersion,
      core_version: TAKOS_CORE_VERSION,
      manifest_snapshot: JSON.stringify(manifestForRevision),
      script_snapshot_ref: scriptRef,
      message:
        typeof (body as any).message === "string" && (body as any).message.trim().length > 0
          ? (body as any).message.trim()
          : null,
      author_type: authorType,
      author_name: authorName ?? null,
      created_at: nowISO(),
    });
    if (!saved?.id) {
      return fail(c as any, "failed to persist revision", 500);
    }
    const revisionId = saved.id;
    try {
      await store.setActiveAppRevision(revisionId);
    } catch (error: any) {
      const message = (error?.message as string | undefined) || "failed to activate revision";
      return fail(c as any, message, /version|compatible/i.test(message) ? 400 : 500);
    }
    clearManifestRouterCache();
    if (workspaceMeta?.id) {
      await markWorkspaceApplied(workspaceMeta.id, c.env);
    }
    const uniqueWarnings = Array.from(new Set(warnings));
    const state = await store.getActiveAppRevision();
    const schemaCheck = checkSemverCompatibility(
      APP_MANIFEST_SCHEMA_VERSION,
      normalizedSchemaVersion,
      { context: "app manifest schema_version", action: "apply" },
    );
    const auditTimestamp = nowISO();
    const auditDetails: AppRevisionAuditDetails = {
      performed_by: (c as any).get("authenticatedUser") ?? null,
      from_revision_id: previousState?.active_revision_id ?? null,
      to_revision_id: revisionId,
      schema_version: {
        platform: buildSchemaCheck(
          APP_MANIFEST_SCHEMA_VERSION,
          normalizedSchemaVersion,
          schemaCheck,
        ),
      },
      warnings: uniqueWarnings,
      workspace: workspaceMeta
        ? {
            id: workspaceMeta.id,
            status: workspaceMeta.status ?? null,
            validated_at: workspaceMeta.validated_at ?? null,
          }
        : null,
    };
    await recordRevisionAuditSafely(store, {
      action: "apply",
      revision_id: revisionId,
      workspace_id: workspaceMeta?.id ?? null,
      result: "success",
      details: auditDetails,
      created_at: auditTimestamp,
    });
    const audit = {
      action: "apply",
      timestamp: auditTimestamp,
      ...auditDetails,
    };
    return ok(c as any, {
      revision: saved,
      active_revision_id: state?.active_revision_id ?? revisionId,
      state,
      warnings: uniqueWarnings,
      issues,
      ...(workspaceMeta ? { workspace: workspaceMeta } : {}),
      audit,
    });
  } finally {
    await releaseStore(store);
  }
});

appManagerRoutes.post("/api/app/revisions/apply/diff", async (c) => {
  const agentGuard = guardAgentRequest(c.req, { forbidAgents: true });
  if (!agentGuard.ok) {
    return fail(c as any, agentGuard.error, agentGuard.status);
  }

  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const prepared = await prepareRevisionCandidate(c, body);
  if (!prepared.ok) {
    return prepared.response;
  }

  const store = makeData(c.env as any, c);
  try {
    if (!store.getActiveAppRevision) {
      return fail(c as any, "app revisions are not supported", 501);
    }
    const state = await store.getActiveAppRevision();
    const currentRevision = state?.revision ?? null;
    if (!currentRevision) {
      return fail(c as any, "no active app revision found", 404);
    }

    const targetRevisionId =
      typeof (body as any).revisionId === "string" && (body as any).revisionId.trim().length > 0
        ? (body as any).revisionId.trim()
        : prepared.workspace?.id ?? "next_revision";

    const candidate: AppRevisionRecord = {
      id: targetRevisionId,
      created_at: nowISO(),
      author_type: "human",
      author_name: (c as any).get("authenticatedUser") ?? null,
      message:
        typeof (body as any).message === "string" && (body as any).message.trim().length > 0
          ? (body as any).message.trim()
          : null,
      schema_version: prepared.schemaVersion,
      manifest_snapshot: JSON.stringify(prepared.manifest),
      script_snapshot_ref: prepared.scriptRef,
    };

    const diff = buildAppRevisionDiff(candidate, currentRevision);
    if (!diff.ok) {
      return fail(c as any, diff.error, 500);
    }

    const warnings = Array.from(new Set([...prepared.warnings, ...diff.diff.warnings]));
    const mergedDiff = { ...diff.diff, warnings };
    const format = (c.req.query("format") || "").trim().toLowerCase();
    const wantsHtml =
      format === "html" || (c.req.header("accept") || "").toLowerCase().includes("text/html");

    if (wantsHtml) {
      return c.html(renderAppRevisionDiffHtml(mergedDiff));
    }

    return ok(c as any, {
      diff: mergedDiff,
      active_revision_id: state?.active_revision_id ?? null,
      target_revision_id: targetRevisionId,
      warnings,
      issues: prepared.issues,
      workspace: prepared.workspace,
    });
  } finally {
    await releaseStore(store);
  }
});

appManagerRoutes.post("/api/app/revisions/:id/rollback", async (c) => {
  const agentGuard = guardAgentRequest(c.req, { forbidAgents: true });
  if (!agentGuard.ok) {
    return fail(c as any, agentGuard.error, agentGuard.status);
  }
  const revisionId = (c.req.param("id") || "").trim();
  if (!revisionId) {
    return fail(c as any, "revisionId is required", 400);
  }
  const store = makeData(c.env as any, c);
  try {
    if (!store.getAppRevision || !store.setActiveAppRevision || !store.getActiveAppRevision) {
      return fail(c as any, "app revisions are not supported", 501);
    }
    const revision = await store.getAppRevision(revisionId);
    if (!revision) {
      return fail(c as any, "revision not found", 404);
    }
    const targetSchemaVersion =
      normalizeSchemaVersionString((revision as any).schema_version ?? (revision as any).schemaVersion) ??
      normalizeSchemaVersionString(revision);
    if (!targetSchemaVersion) {
      return fail(c as any, "revision schema_version is missing", 400);
    }

    const platformCheck = checkSemverCompatibility(
      APP_MANIFEST_SCHEMA_VERSION,
      targetSchemaVersion,
      { context: "app manifest schema_version", action: "rollback" },
    );
    if (!platformCheck.ok) {
      const compatibilityError =
        platformCheck.error && platformCheck.error.toLowerCase().includes("not compatible")
          ? platformCheck.error
          : platformCheck.error
            ? `${platformCheck.error} (not compatible)`
            : "app manifest schema_version is not compatible";
      return fail(c as any, compatibilityError, 400);
    }
    const currentState = await store.getActiveAppRevision();
    const currentSchemaVersion = currentState?.revision
      ? normalizeSchemaVersionString(
          (currentState.revision as any).schema_version ?? (currentState.revision as any).schemaVersion,
        )
      : null;
    const warnings = [...platformCheck.warnings];
    const platformSchemaCheck = buildSchemaCheck(
      APP_MANIFEST_SCHEMA_VERSION,
      targetSchemaVersion,
      platformCheck,
    );
    let previousActiveSchemaCheck: NonNullable<AppRevisionAuditDetails["schema_version"]>["previous_active"] =
      null;

    if (currentSchemaVersion) {
      const compatibility = checkSemverCompatibility(
        currentSchemaVersion,
        targetSchemaVersion,
        { context: "rollback target vs current active revision", action: "rollback" },
      );
      if (!compatibility.ok) {
        const compatibilityError =
          compatibility.error && compatibility.error.toLowerCase().includes("not compatible")
            ? compatibility.error
            : compatibility.error
              ? `${compatibility.error} (not compatible)`
              : "target revision is not compatible with the current active revision";
        return fail(c as any, compatibilityError, 400);
      }
      warnings.push(...compatibility.warnings);
      previousActiveSchemaCheck = buildSchemaCheck(
        currentSchemaVersion,
        targetSchemaVersion,
        compatibility,
        currentSchemaVersion,
        targetSchemaVersion,
      );
    }

    try {
      await store.setActiveAppRevision(revisionId);
    } catch (error: any) {
      const message = (error?.message as string | undefined) || "failed to activate revision";
      return fail(c as any, message, /version|compatible/i.test(message) ? 400 : 500);
    }
    clearManifestRouterCache();
    const state = await store.getActiveAppRevision();
    const uniqueWarnings = Array.from(new Set(warnings));
    const auditTimestamp = nowISO();
    const auditDetails: AppRevisionAuditDetails = {
      performed_by: (c as any).get("authenticatedUser") ?? null,
      from_revision_id: currentState?.active_revision_id ?? null,
      to_revision_id: revisionId,
      schema_version: {
        platform: platformSchemaCheck,
        previous_active: previousActiveSchemaCheck,
      },
      warnings: uniqueWarnings,
    };
    await recordRevisionAuditSafely(store, {
      action: "rollback",
      revision_id: revisionId,
      workspace_id: null,
      result: "success",
      details: auditDetails,
      created_at: auditTimestamp,
    });
    const audit = {
      action: "rollback",
      timestamp: auditTimestamp,
      ...auditDetails,
    };
    return ok(c as any, {
      revision,
      active_revision_id: state?.active_revision_id ?? revisionId,
      state,
      warnings: uniqueWarnings,
      audit,
    });
  } finally {
    await releaseStore(store);
  }
});

appManagerRoutes.get("/-/app/workspaces", async (c) => {
  const workspaceEnv = resolveWorkspaceEnv({
    env: c.env,
    mode: "dev",
    requireIsolation: true,
  });
  if (workspaceEnv.isolation?.required && !workspaceEnv.isolation.ok) {
    return fail(
      c as any,
      workspaceEnv.isolation.errors[0] || "dev data isolation failed",
      503,
    );
  }
  if (!workspaceEnv.store) {
    return fail(c as any, "workspace store is not configured", 503);
  }
  await ensureDefaultWorkspace(workspaceEnv.store);

  const store = makeData(workspaceEnv.env as any, c);
  try {
    if (!store.listAppWorkspaces) {
      return fail(c as any, "app workspaces are not supported", 501);
    }
    const limit = Math.min(
      100,
      Math.max(
        1,
        Number.parseInt(String(c.req.query("limit") ?? ""), 10) || 20,
      ),
    );
    const workspaces = await store.listAppWorkspaces(limit);
    return c.json({ ok: true, workspaces, limit });
  } finally {
    await releaseStore(store);
  }
});

appManagerRoutes.post("/-/app/workspaces", async (c) => {
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") {
    return fail(c as any, "invalid workspace payload", 400);
  }
  const workspaceEnv = resolveWorkspaceEnv({
    env: c.env,
    mode: "dev",
    requireIsolation: true,
  });
  if (workspaceEnv.isolation?.required && !workspaceEnv.isolation.ok) {
    return fail(
      c as any,
      workspaceEnv.isolation.errors[0] || "dev data isolation failed",
      503,
    );
  }
  if (!workspaceEnv.store) {
    return fail(c as any, "workspace store is not configured", 503);
  }
  await ensureDefaultWorkspace(workspaceEnv.store);
  const planLimits = resolveWorkspaceLimitsFromEnv(workspaceEnv.env);

  const store = makeData(workspaceEnv.env as any, c);
  try {
    if (!store.createAppWorkspace) {
      return fail(c as any, "app workspaces are not supported", 501);
    }
    const requestedId =
      typeof (body as any).id === "string" && (body as any).id.trim().length > 0
        ? (body as any).id.trim()
        : "";
    const baseRevisionId =
      typeof (body as any).baseRevisionId === "string" && (body as any).baseRevisionId.trim().length > 0
        ? (body as any).baseRevisionId.trim()
        : null;
    const user = c.get("user");
    const authorName =
      typeof user?.display_name === "string" && user.display_name.trim().length > 0
        ? user.display_name.trim()
        : typeof user?.name === "string" && user.name.trim().length > 0
          ? user.name.trim()
          : typeof (body as any).authorName === "string" && (body as any).authorName.trim().length > 0
            ? (body as any).authorName.trim()
            : user?.id ?? null;

    if (
      Number.isFinite(planLimits.maxWorkspaces) &&
      planLimits.maxWorkspaces < Number.MAX_SAFE_INTEGER &&
      store.listAppWorkspaces
    ) {
      const existing = await store.listAppWorkspaces(planLimits.maxWorkspaces + 1);
      if (existing.length >= planLimits.maxWorkspaces) {
        return fail(c as any, "workspace_limit_exceeded", 403);
      }
    }

    const workspace = await store.createAppWorkspace({
      id: requestedId || undefined,
      base_revision_id: baseRevisionId,
      status: "draft",
      author_type: "human",
      author_name: authorName ?? null,
    });

    if (!workspace) {
      return fail(c as any, "failed to create workspace", 500);
    }

    return c.json({ ok: true, workspace });
  } finally {
    await releaseStore(store);
  }
});

appManagerRoutes.get("/-/app/workspaces/:id", async (c) => {
  const workspaceId = (c.req.param("id") || "").trim();
  if (!workspaceId) {
    return fail(c as any, "workspaceId is required", 400);
  }
  const workspaceEnv = resolveWorkspaceEnv({
    env: c.env,
    mode: "dev",
    requireIsolation: true,
  });
  if (workspaceEnv.isolation?.required && !workspaceEnv.isolation.ok) {
    return fail(
      c as any,
      workspaceEnv.isolation.errors[0] || "dev data isolation failed",
      503,
    );
  }
  const store = workspaceEnv.store;
  if (!store) {
    return fail(c as any, "workspace store is not configured", 503);
  }
  await ensureDefaultWorkspace(store);
  const workspace = await store.getWorkspace(workspaceId);
  if (!workspace) {
    return fail(c as any, "workspace not found", 404);
  }
  const usage = await computeWorkspaceUsage(store as any, workspaceId);
  const limits = resolveWorkspaceLimitsFromEnv(workspaceEnv.env as any);
  return c.json({ ok: true, workspace, usage, limits });
});

appManagerRoutes.put("/-/app/workspaces/:id", async (c) => {
  const workspaceId = (c.req.param("id") || "").trim();
  if (!workspaceId) {
    return fail(c as any, "workspaceId is required", 400);
  }
  const payload = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!payload || typeof payload !== "object") {
    return fail(c as any, "invalid workspace payload", 400);
  }

  const workspaceEnv = resolveWorkspaceEnv({
    env: c.env,
    mode: "dev",
    requireIsolation: true,
  });
  if (workspaceEnv.isolation?.required && !workspaceEnv.isolation.ok) {
    return fail(
      c as any,
      workspaceEnv.isolation.errors[0] || "dev data isolation failed",
      503,
    );
  }
  const store = workspaceEnv.store;
  if (!store) {
    return fail(c as any, "workspace store is not configured", 503);
  }
  await ensureDefaultWorkspace(store);

  if (typeof store.upsertWorkspace !== "function") {
    return fail(c as any, "workspace updates are not supported", 501);
  }

  const current = await store.getWorkspace(workspaceId);
  if (!current) {
    return fail(c as any, "workspace not found", 404);
  }

  const baseRevisionId =
    typeof (payload as any).baseRevisionId === "string" && (payload as any).baseRevisionId.trim().length > 0
      ? (payload as any).baseRevisionId.trim()
      : undefined;
  const authorName =
    typeof (payload as any).authorName === "string" && (payload as any).authorName.trim().length > 0
      ? (payload as any).authorName.trim()
      : undefined;

  const updated = await store.upsertWorkspace({
    id: workspaceId,
    base_revision_id: baseRevisionId ?? current.base_revision_id,
    status: current.status,
    author_type: current.author_type,
    author_name: authorName ?? current.author_name,
    created_at: current.created_at,
    updated_at: new Date().toISOString(),
  });

  if (!updated) {
    return fail(c as any, "failed to update workspace", 500);
  }

  return c.json({ ok: true, workspace: updated });
});

appManagerRoutes.post("/-/app/workspaces/:id/validate", async (c) => {
  const workspaceId = (c.req.param("id") || "").trim();
  if (!workspaceId) {
    return fail(c as any, "workspaceId is required", 400);
  }
  const workspaceEnv = resolveWorkspaceEnv({
    env: c.env,
    mode: "dev",
    requireIsolation: true,
  });
  if (workspaceEnv.isolation?.required && !workspaceEnv.isolation.ok) {
    return fail(
      c as any,
      workspaceEnv.isolation.errors[0] || "dev data isolation failed",
      503,
    );
  }
  const store = workspaceEnv.store;
  if (!store) {
    return fail(c as any, "workspace store is not configured", 503);
  }
  await ensureDefaultWorkspace(store);
  const workspace = await store.getWorkspace(workspaceId);
  if (!workspace) {
    return fail(c as any, "workspace not found", 404);
  }
  const validation = await validateWorkspaceManifest(workspaceId, workspaceEnv.env);
  const status = validation.ok ? 200 : validation.status;
  return c.json(
    {
      ok: validation.ok,
      workspace: { id: workspace.id, status: workspace.status },
      issues: validation.issues,
      status,
    },
    status as any,
  );
});

appManagerRoutes.post("/-/app/workspaces/:id/status", async (c) => {
  const workspaceId = (c.req.param("id") || "").trim();
  if (!workspaceId) {
    return fail(c as any, "workspaceId is required", 400);
  }
  const payload = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  const nextStatus = normalizeWorkspaceLifecycleStatus(payload?.status);
  if (!nextStatus) {
    return fail(c as any, "status must be one of draft, validated, ready, applied", 400);
  }

  const workspaceEnv = resolveWorkspaceEnv({
    env: c.env,
    mode: "dev",
    requireIsolation: true,
  });
  if (workspaceEnv.isolation?.required && !workspaceEnv.isolation.ok) {
    return fail(
      c as any,
      workspaceEnv.isolation.errors[0] || "dev data isolation failed",
      503,
    );
  }
  if (!workspaceEnv.store) {
    return fail(c as any, "workspace store is not configured", 503);
  }
  await ensureDefaultWorkspace(workspaceEnv.store);

  const store = makeData(workspaceEnv.env as any, c);
  try {
    if (!store.getAppWorkspace || !store.updateAppWorkspaceStatus) {
      return fail(c as any, "app workspaces are not supported", 501);
    }
    const current = await store.getAppWorkspace(workspaceId);
    if (!current) {
      return fail(c as any, "workspace not found", 404);
    }
    if (!canTransitionWorkspaceStatus(current.status, nextStatus)) {
      return fail(c as any, "invalid workspace status transition", 400);
    }

    let validationIssues: AppManifestValidationIssue[] = [];
    if (shouldValidateWorkspaceStatus(nextStatus)) {
      const validation = await validateWorkspaceManifest(workspaceId, workspaceEnv.env);
      validationIssues = validation.issues;
      if (!validation.ok) {
        return c.json(
          { ok: false, error: "workspace_validation_failed", issues: validationIssues },
          validation.status as any,
        );
      }
    }

    let snapshot: any = null;

    if (current.status === nextStatus) {
      return c.json({ ok: true, workspace: current, issues: validationIssues, snapshot });
    }

    if (typeof workspaceEnv.store.saveWorkspaceSnapshot === "function") {
      try {
        snapshot = await workspaceEnv.store.saveWorkspaceSnapshot(workspaceId, nextStatus);
      } catch (error) {
        console.warn("[workspace] failed to persist snapshot", error);
      }
    }
    const updated = await store.updateAppWorkspaceStatus(workspaceId, nextStatus);
    if (!updated) {
      return fail(c as any, "failed to update workspace status", 500);
    }
    return c.json({ ok: true, workspace: updated, issues: validationIssues, snapshot });
  } finally {
    await releaseStore(store);
  }
});

appManagerRoutes.delete("/-/app/workspaces/:id", async (c) => {
  const workspaceId = (c.req.param("id") || "").trim();
  if (!workspaceId) {
    return fail(c as any, "workspaceId is required", 400);
  }
  if (RESERVED_WORKSPACE_IDS.has(workspaceId)) {
    return fail(c as any, "cannot delete reserved workspace", 400);
  }
  const workspaceEnv = resolveWorkspaceEnv({
    env: c.env,
    mode: "dev",
    requireIsolation: true,
  });
  if (workspaceEnv.isolation?.required && !workspaceEnv.isolation.ok) {
    return fail(
      c as any,
      workspaceEnv.isolation.errors[0] || "dev data isolation failed",
      503,
    );
  }
  const store = workspaceEnv.store;
  if (!store) {
    return fail(c as any, "workspace store is not configured", 503);
  }
  await ensureDefaultWorkspace(store);
  const workspace = await store.getWorkspace(workspaceId);
  if (!workspace) {
    return fail(c as any, "workspace not found", 404);
  }

  let deletedFiles = 0;
  if (typeof store.listWorkspaceFiles === "function" && typeof store.deleteWorkspaceFile === "function") {
    try {
      const files = await store.listWorkspaceFiles(workspaceId);
      for (const file of files) {
        try {
          await store.deleteWorkspaceFile(workspaceId, file.path);
          deletedFiles += 1;
        } catch (error) {
          console.warn("[workspace] failed to delete file", error);
        }
      }
    } catch (error) {
      console.warn("[workspace] failed to list workspace files for delete", error);
    }
  }

  if (typeof (store as any).deleteWorkspace === "function") {
    try {
      await (store as any).deleteWorkspace(workspaceId);
    } catch (error) {
      console.warn("[workspace] failed to delete workspace metadata", error);
    }
  }

  const dataStore = makeData(workspaceEnv.env as any, c);
  try {
    if (dataStore.deleteAppWorkspace) {
      await dataStore.deleteAppWorkspace(workspaceId);
    }
  } finally {
    await releaseStore(dataStore);
  }

  return ok(c as any, {
    ok: true,
    deleted: true,
    workspace_id: workspaceId,
    deleted_files: deletedFiles,
  });
});

appManagerRoutes.get("/-/app/workspaces/:id/files", async (c) => {
  const workspaceId = (c.req.param("id") || "").trim();
  if (!workspaceId) {
    return fail(c as any, "workspaceId is required", 400);
  }
  const workspaceEnv = resolveWorkspaceEnv({
    env: c.env,
    mode: "dev",
    requireIsolation: true,
  });
  if (workspaceEnv.isolation?.required && !workspaceEnv.isolation.ok) {
    return fail(
      c as any,
      workspaceEnv.isolation.errors[0] || "dev data isolation failed",
      503,
    );
  }
  const store = workspaceEnv.store;
  if (!store) {
    return fail(c as any, "workspace store is not configured", 503);
  }
  await ensureDefaultWorkspace(store);
  const workspace = await store.getWorkspace(workspaceId);
  if (!workspace) {
    return fail(c as any, "workspace not found", 404);
  }
  const prefix = (c.req.query("prefix") || "").trim();
  const files = await store.listWorkspaceFiles(workspaceId, prefix || undefined);
  const mapped = files.map((file) => ({
    workspace_id: file.workspace_id,
    path: file.path,
    content_type: file.content_type,
    content_hash: file.content_hash ?? null,
    storage_key: file.storage_key ?? null,
    directory_path: (file as any).directory_path ?? undefined,
    content: textDecoder.decode(file.content),
    size: file.size ?? file.content?.length ?? 0,
    created_at: file.created_at,
    updated_at: file.updated_at,
  }));
  return ok(c as any, { workspace_id: workspaceId, files: mapped });
});

appManagerRoutes.get("/-/app/workspaces/:id/files/*", async (c) => {
  const workspaceId = (c.req.param("id") || "").trim();
  const path = extractWorkspaceFilePathFromUrl(c, workspaceId);
  if (!workspaceId || !path || path.includes("..")) {
    return fail(c as any, "invalid workspace file path", 400);
  }
  const workspaceEnv = resolveWorkspaceEnv({
    env: c.env,
    mode: "dev",
    requireIsolation: true,
  });
  if (workspaceEnv.isolation?.required && !workspaceEnv.isolation.ok) {
    return fail(
      c as any,
      workspaceEnv.isolation.errors[0] || "dev data isolation failed",
      503,
    );
  }
  const store = workspaceEnv.store;
  if (!store) {
    return fail(c as any, "workspace store is not configured", 503);
  }
  await ensureDefaultWorkspace(store);
  const workspace = await store.getWorkspace(workspaceId);
  if (!workspace) {
    return fail(c as any, "workspace not found", 404);
  }
  const file = await store.getWorkspaceFile(workspaceId, path);
  if (!file) {
    return fail(c as any, "file not found", 404);
  }
  return ok(c as any, {
    workspace_id: workspaceId,
    file: {
      workspace_id: file.workspace_id,
      path: file.path,
      content_type: file.content_type,
      content_hash: file.content_hash ?? null,
      storage_key: file.storage_key ?? null,
      directory_path: (file as any).directory_path ?? undefined,
      content: textDecoder.decode(file.content ?? new Uint8Array()),
      size: file.size ?? file.content?.length ?? 0,
      created_at: file.created_at,
      updated_at: file.updated_at,
    },
  });
});

appManagerRoutes.put("/-/app/workspaces/:id/files/*", async (c) => {
  const workspaceId = (c.req.param("id") || "").trim();
  const path = extractWorkspaceFilePathFromUrl(c, workspaceId);
  if (!workspaceId || !path || path.includes("..")) {
    return fail(c as any, "invalid workspace file path", 400);
  }
  const raw = await c.req.text();
  const parsed = parseContentFromBody(raw);
  const contentBytes = textEncoder.encode(parsed.content);

  const workspaceEnv = resolveWorkspaceEnv({
    env: c.env,
    mode: "dev",
    requireIsolation: true,
  });
  if (workspaceEnv.isolation?.required && !workspaceEnv.isolation.ok) {
    return fail(
      c as any,
      workspaceEnv.isolation.errors[0] || "dev data isolation failed",
      503,
    );
  }
  const store = workspaceEnv.store;
  if (!store) {
    return fail(c as any, "workspace store is not configured", 503);
  }
  await ensureDefaultWorkspace(store);
  const workspace = await store.getWorkspace(workspaceId);
  if (!workspace) {
    return fail(c as any, "workspace not found", 404);
  }

  const planLimits = resolveWorkspaceLimitsFromEnv(workspaceEnv.env as any);
  const limitCheck = await ensureWithinWorkspaceLimits(
    store as any,
    workspaceId,
    path,
    contentBytes.byteLength,
    planLimits,
  );
  if (!limitCheck.ok) {
    return fail(c as any, limitCheck.reason, 413);
  }

  const saved = await store.saveWorkspaceFile(workspaceId, path, parsed.content, parsed.contentType);
  if (!saved) {
    return fail(c as any, "failed to save workspace file", 500);
  }

  return ok(c as any, {
    workspace_id: workspaceId,
    file: {
      path: saved.path,
      content_type: saved.content_type,
      content_hash: saved.content_hash ?? null,
      storage_key: saved.storage_key ?? null,
      size: saved.size ?? saved.content?.length ?? contentBytes.byteLength,
      created_at: saved.created_at,
      updated_at: saved.updated_at,
      content: textDecoder.decode(saved.content ?? new Uint8Array()),
    },
    usage: limitCheck.usage,
  });
});

appManagerRoutes.delete("/-/app/workspaces/:id/files/*", async (c) => {
  const workspaceId = (c.req.param("id") || "").trim();
  const path = extractWorkspaceFilePathFromUrl(c, workspaceId);
  if (!workspaceId || !path || path.includes("..")) {
    return fail(c as any, "invalid workspace file path", 400);
  }

  const workspaceEnv = resolveWorkspaceEnv({
    env: c.env,
    mode: "dev",
    requireIsolation: true,
  });
  if (workspaceEnv.isolation?.required && !workspaceEnv.isolation.ok) {
    return fail(
      c as any,
      workspaceEnv.isolation.errors[0] || "dev data isolation failed",
      503,
    );
  }
  const store = workspaceEnv.store;
  if (!store) {
    return fail(c as any, "workspace store is not configured", 503);
  }
  await ensureDefaultWorkspace(store);
  const workspace = await store.getWorkspace(workspaceId);
  if (!workspace) {
    return fail(c as any, "workspace not found", 404);
  }
  if (typeof store.deleteWorkspaceFile !== "function") {
    return fail(c as any, "workspace file deletion is not supported", 501);
  }
  const existed = await store.getWorkspaceFile(workspaceId, path);
  if (!existed) {
    return fail(c as any, "file not found", 404);
  }
  await store.deleteWorkspaceFile(workspaceId, path);
  const usage = await computeWorkspaceUsage(store as any, workspaceId);
  return ok(c as any, { workspace_id: workspaceId, path, deleted: true, usage });
});

appManagerRoutes.post("/-/app/workspaces/:id/files", async (c) => {
  const workspaceId = (c.req.param("id") || "").trim();
  if (!workspaceId) {
    return fail(c as any, "workspaceId is required", 400);
  }
  const payload = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  const path =
    typeof payload?.path === "string" && payload.path.trim().length > 0
      ? payload.path.trim()
      : "";
  if (!path) {
    return fail(c as any, "path is required", 400);
  }
  const content =
    typeof payload?.content === "string"
      ? payload.content
      : payload?.content != null
        ? JSON.stringify(payload.content)
        : "";
  const contentBytes = textEncoder.encode(content);
  const contentType =
    typeof payload?.content_type === "string" && payload.content_type.trim().length > 0
      ? payload.content_type.trim()
      : "application/json";

  const workspaceEnv = resolveWorkspaceEnv({
    env: c.env,
    mode: "dev",
    requireIsolation: true,
  });
  if (workspaceEnv.isolation?.required && !workspaceEnv.isolation.ok) {
    return fail(
      c as any,
      workspaceEnv.isolation.errors[0] || "dev data isolation failed",
      503,
    );
  }
  const store = workspaceEnv.store;
  if (!store) {
    return fail(c as any, "workspace store is not configured", 503);
  }
  await ensureDefaultWorkspace(store);
  const workspace = await store.getWorkspace(workspaceId);
  if (!workspace) {
    return fail(c as any, "workspace not found", 404);
  }

  const planLimits = resolveWorkspaceLimitsFromEnv(workspaceEnv.env as any);
  const limitCheck = await ensureWithinWorkspaceLimits(
    store,
    workspaceId,
    path,
    contentBytes.byteLength,
    planLimits,
  );
  if (!limitCheck.ok) {
    return fail(c as any, limitCheck.reason, 413);
  }

  const saved = await store.saveWorkspaceFile(workspaceId, path, content, contentType);
  if (!saved) {
    return fail(c as any, "failed to save workspace file", 500);
  }

  return ok(c as any, {
    workspace_id: workspaceId,
    file: {
      path: saved.path,
      content_type: saved.content_type,
      content_hash: saved.content_hash ?? null,
      storage_key: saved.storage_key ?? null,
      size: saved.size ?? saved.content?.length ?? contentBytes.byteLength,
      created_at: saved.created_at,
      updated_at: saved.updated_at,
      content: textDecoder.decode(saved.content),
    },
    usage: limitCheck.usage,
  });
});

appManagerRoutes.get("/-/app/workspaces/:id/cache/esbuild/:hash", async (c) => {
  const workspaceId = (c.req.param("id") || "").trim();
  const rawHash = (c.req.param("hash") || "").trim();
  const hash = normalizeCacheHash(rawHash);
  if (!workspaceId || !hash) {
    return fail(c as any, "workspaceId and hash are required", 400);
  }
  const workspaceEnv = resolveWorkspaceEnv({
    env: c.env,
    mode: "dev",
    requireIsolation: true,
  });
  if (workspaceEnv.isolation?.required && !workspaceEnv.isolation.ok) {
    return fail(
      c as any,
      workspaceEnv.isolation.errors[0] || "dev data isolation failed",
      503,
    );
  }
  const store = workspaceEnv.store;
  if (!store) {
    return fail(c as any, "workspace store is not configured", 503);
  }
  await ensureDefaultWorkspace(store);
  const workspace = await store.getWorkspace(workspaceId);
  if (!workspace) {
    return fail(c as any, "workspace not found", 404);
  }

  const cached =
    typeof store.getCompileCache === "function"
      ? await store.getCompileCache(workspaceId, hash)
      : await store.getWorkspaceFile(workspaceId, `__cache/esbuild/${hash}.js`);
  if (!cached) {
    return fail(c as any, "cache_not_found", 404);
  }

  return ok(c as any, {
    workspace_id: workspaceId,
    hash,
    cache: {
      path: cached.path,
      content_type: cached.content_type,
      content_hash: cached.content_hash ?? null,
      storage_key: cached.storage_key ?? null,
      size: cached.size ?? cached.content?.length ?? 0,
      content: textDecoder.decode(cached.content),
      updated_at: cached.updated_at,
    },
  });
});

appManagerRoutes.post("/-/app/workspaces/:id/cache/esbuild/:hash", async (c) => {
  const workspaceId = (c.req.param("id") || "").trim();
  const rawHash = (c.req.param("hash") || "").trim();
  const hash = normalizeCacheHash(rawHash);
  if (!workspaceId || !hash) {
    return fail(c as any, "workspaceId and hash are required", 400);
  }
  const payload = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!payload || typeof payload !== "object") {
    return fail(c as any, "invalid cache payload", 400);
  }
  const content =
    typeof payload?.content === "string"
      ? payload.content
      : payload?.content != null
        ? JSON.stringify(payload.content)
        : "";
  const contentType =
    typeof payload?.content_type === "string" && payload.content_type.trim().length > 0
      ? payload.content_type.trim()
      : "application/javascript";
  const contentBytes = textEncoder.encode(content);

  const workspaceEnv = resolveWorkspaceEnv({
    env: c.env,
    mode: "dev",
    requireIsolation: true,
  });
  if (workspaceEnv.isolation?.required && !workspaceEnv.isolation.ok) {
    return fail(
      c as any,
      workspaceEnv.isolation.errors[0] || "dev data isolation failed",
      503,
    );
  }
  const store = workspaceEnv.store;
  if (!store) {
    return fail(c as any, "workspace store is not configured", 503);
  }
  await ensureDefaultWorkspace(store);
  const workspace = await store.getWorkspace(workspaceId);
  if (!workspace) {
    return fail(c as any, "workspace not found", 404);
  }

  const limits = resolveWorkspaceLimitsFromEnv(workspaceEnv.env);
  const cachePath = `__cache/esbuild/${hash}.js`;
  const limitCheck = await ensureWithinWorkspaceLimits(
    store,
    workspaceId,
    cachePath,
    contentBytes.byteLength,
    limits,
  );
  if (!limitCheck.ok) {
    return fail(c as any, limitCheck.reason, 413);
  }

  const cacheControl =
    Number.isFinite(limits.compileCacheTtlSeconds) && limits.compileCacheTtlSeconds > 0
      ? `public, max-age=${Math.floor(limits.compileCacheTtlSeconds)}`
      : undefined;

  const saved =
    typeof store.saveCompileCache === "function"
      ? await store.saveCompileCache(workspaceId, hash, content, { contentType, cacheControl })
      : await store.saveWorkspaceFile(workspaceId, cachePath, content, contentType, {
          cacheControl,
        });
  if (!saved) {
    return fail(c as any, "failed to persist cache", 500);
  }

  return ok(c as any, {
    workspace_id: workspaceId,
    hash,
    cache: {
      path: saved.path,
      content_type: saved.content_type,
      content_hash: saved.content_hash ?? null,
      storage_key: saved.storage_key ?? null,
      size: saved.size ?? saved.content?.length ?? contentBytes.byteLength,
      updated_at: saved.updated_at,
      content: textDecoder.decode(saved.content),
    },
    usage: limitCheck.usage,
    cache_control: cacheControl,
  });
});

appManagerRoutes.post("/-/app/workspaces/:id/apply-patch", auth, requireAuthenticatedSession, async (c) => {
  const agentGuard = guardAgentRequest(c.req, { toolId: "tool.applyCodePatch" });
  if (!agentGuard.ok) {
    return fail(c as any, agentGuard.error, agentGuard.status);
  }

  const workspaceId = (c.req.param("id") || "").trim();
  if (!workspaceId) {
    return fail(c as any, "workspaceId is required", 400);
  }

  const payload = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!payload || typeof payload !== "object") {
    return fail(c as any, "invalid payload", 400);
  }

  const patches = Array.isArray(payload.patches) ? payload.patches : [];
  if (patches.length === 0) {
    return fail(c as any, "patches array is required and must not be empty", 400);
  }

  const workspaceEnv = resolveWorkspaceEnv({
    env: c.env,
    mode: "dev",
    requireIsolation: true,
  });

  if (workspaceEnv.isolation?.required && !workspaceEnv.isolation.ok) {
    return fail(
      c as any,
      workspaceEnv.isolation.errors[0] || "dev data isolation failed",
      503,
    );
  }

  const store = workspaceEnv.store;
  if (!store) {
    return fail(c as any, "workspace store is not configured", 503);
  }

  await ensureDefaultWorkspace(store);
  const workspace = await store.getWorkspace(workspaceId);
  if (!workspace) {
    return fail(c as any, "workspace not found", 404);
  }

  if (workspace.status === "applied") {
    return fail(c as any, "cannot apply patches to an already applied workspace", 400);
  }

  type PatchEntry = {
    path?: string;
    content?: string;
    diff?: string;
  };

  const results: Array<{ path: string; success: boolean; error?: string }> = [];

  for (const patch of patches) {
    const patchEntry = patch as PatchEntry;
    const filePath =
      typeof patchEntry.path === "string" && patchEntry.path.trim().length > 0
        ? patchEntry.path.trim()
        : "";

    if (!filePath) {
      results.push({ path: "", success: false, error: "patch entry missing path" });
      continue;
    }

    if (filePath.toLowerCase().startsWith("prod/") || filePath.toLowerCase().includes("/prod/")) {
      results.push({
        path: filePath,
        success: false,
        error: "cannot apply patches to prod environment files",
      });
      continue;
    }

    const newContent =
      typeof patchEntry.content === "string"
        ? patchEntry.content
        : patchEntry.content != null
          ? JSON.stringify(patchEntry.content)
          : null;

    if (newContent === null && !patchEntry.diff) {
      results.push({
        path: filePath,
        success: false,
        error: "patch entry must provide either content or diff",
      });
      continue;
    }

    let contentToSave = newContent;

    if (patchEntry.diff && typeof patchEntry.diff === "string") {
      const existingFile = await store.getWorkspaceFile(workspaceId, filePath);
      if (!existingFile) {
        results.push({
          path: filePath,
          success: false,
          error: "cannot apply diff to non-existent file",
        });
        continue;
      }

      // Apply the diff using the platform utility
      const existingContent = textDecoder.decode(existingFile.content);
      const patchResult = applyPatch(existingContent, patchEntry.diff);

      if (!patchResult.success && patchResult.error) {
        results.push({
          path: filePath,
          success: false,
          error: patchResult.error,
        });
        continue;
      }

      contentToSave = patchResult.content;
    }

    try {
      const contentType =
        filePath.endsWith(".json")
          ? "application/json"
          : filePath.endsWith(".ts") || filePath.endsWith(".tsx")
            ? "text/typescript"
            : filePath.endsWith(".js") || filePath.endsWith(".jsx")
              ? "text/javascript"
              : "text/plain";

      const saved = await store.saveWorkspaceFile(
        workspaceId,
        filePath,
        contentToSave!,
        contentType,
      );

      if (saved) {
        results.push({ path: filePath, success: true });
      } else {
        results.push({ path: filePath, success: false, error: "failed to save file" });
      }
    } catch (error: any) {
      results.push({
        path: filePath,
        success: false,
        error: error?.message || "unknown error",
      });
    }
  }

  const successCount = results.filter((r) => r.success).length;
  const failureCount = results.filter((r) => !r.success).length;

  return ok(c as any, {
    tool: "tool.applyCodePatch",
    workspace_id: workspaceId,
    applied: successCount,
    failed: failureCount,
    results,
  });
});

appManagerRoutes.route("/", adminAppRoutes);

export default appManagerRoutes;
