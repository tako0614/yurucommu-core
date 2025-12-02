/// <reference types="@cloudflare/workers-types" />

import { Hono } from "hono";
import type { PublicAccountBindings, Variables } from "@takos/platform/server";
import {
  AppPreviewError,
  applyJsonPatches,
  type JsonPatchOperation,
  normalizeJsonPatchOperations,
  resolveScreenPreview,
} from "../lib/app-preview";
import {
  ensureDefaultWorkspace,
  loadWorkspaceManifest,
  loadWorkspaceUiContract,
  resolveWorkspaceEnv,
} from "../lib/workspace-store";
import {
  validateUiContractAgainstManifest,
  type AppManifestValidationIssue,
  type UiContract,
} from "@takos/platform/app";
import defaultUiContract from "../../../takos-ui-contract.json";
import { auth } from "../middleware/auth";
import { isOwnerUser } from "../lib/owner-auth";

type PreviewBody = {
  mode?: string;
  workspaceId?: string;
  screenId?: string;
  viewMode?: string;
  width?: number;
  height?: number;
};

type PatchPreviewBody = PreviewBody & {
  patches?: unknown;
};

type PreviewBindings = PublicAccountBindings & { workspaceStore?: any };

const appPreview = new Hono<{ Bindings: PreviewBindings; Variables: Variables }>();

const getSessionUser = (c: any) => c.get("sessionUser") ?? c.get("user") ?? null;

const formatIssue = (issue: AppManifestValidationIssue): string => {
  const location = [issue.file, issue.path].filter(Boolean).join("#");
  return `${issue.message}${location ? ` [${location}]` : ""}`;
};

const loadUiContractForPreview = async (
  workspaceId: string,
  mode: "prod" | "dev",
  env: PreviewBindings,
): Promise<{ contract: UiContract | null; issues: AppManifestValidationIssue[]; source?: string }> => {
  if (mode === "dev") {
    const result = await loadWorkspaceUiContract(workspaceId, { mode, env });
    if (result.contract) {
      return { contract: result.contract, issues: result.issues, source: "takos-ui-contract.json" };
    }
    return {
      contract: defaultUiContract as UiContract,
      issues: [
        ...result.issues,
        {
          severity: "warning",
          message: "takos-ui-contract.json not found in workspace; using default contract",
          file: "takos-ui-contract.json",
        },
      ],
      source: "takos-ui-contract.json",
    };
  }
  return { contract: defaultUiContract as UiContract, issues: [], source: "takos-ui-contract.json" };
};

const normalizePreviewMode = (mode: unknown, workspaceId?: string): "prod" | "dev" => {
  const normalizedMode = typeof mode === "string" ? mode.trim().toLowerCase() : "";
  const normalizedWorkspaceId = typeof workspaceId === "string" ? workspaceId.trim().toLowerCase() : "";

  if (["prod", "production", "prod-preview", "prod_preview"].includes(normalizedMode)) {
    return "prod";
  }
  if (["dev", "preview", "previews", "workspace", "development"].includes(normalizedMode)) {
    return "dev";
  }
  if (["prod", "production"].includes(normalizedWorkspaceId)) {
    return "prod";
  }
  return "dev";
};

const parseBody = async (c: any): Promise<PreviewBody | null> => {
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== "object") return null;
  return body as PreviewBody;
};

appPreview.use("/-/app/preview/*", auth);

appPreview.post("/-/app/preview/screen", async (c) => {
  const sessionUser = getSessionUser(c);
  if (!isOwnerUser(sessionUser, c.env as PreviewBindings)) {
    return c.json({ ok: false, error: "owner_session_required" }, 403);
  }

  const body = await parseBody(c);
  if (!body) {
    return c.json({ ok: false, error: "invalid_json" }, 400);
  }

  const requestedWorkspaceId = typeof body.workspaceId === "string" ? body.workspaceId.trim() : "";
  const mode: "prod" | "dev" = normalizePreviewMode(body.mode, requestedWorkspaceId);
  const workspaceId = requestedWorkspaceId || (mode === "prod" ? "prod" : "");
  const screenId = typeof body.screenId === "string" ? body.screenId.trim() : "";
  const viewMode = body.viewMode === "image" ? "image" : "json";

  if (mode === "dev" && !workspaceId) {
    return c.json({ ok: false, error: "workspace_required" }, 400);
  }
  if (!screenId) {
    return c.json({ ok: false, error: "screen_required" }, 400);
  }
  if (viewMode === "image") {
    return c.json(
      {
        ok: false,
        error: "view_mode_not_supported",
        message: "image viewMode is not implemented; use viewMode=json",
      },
      400,
    );
  }

  const workspaceEnv = resolveWorkspaceEnv({
    env: c.env as PreviewBindings,
    mode,
    requireIsolation: mode === "dev",
  });
  if (workspaceEnv.isolation?.required && !workspaceEnv.isolation.ok) {
    return c.json(
      {
        ok: false,
        error: "dev_data_isolation_failed",
        details: workspaceEnv.isolation.errors,
      },
      503,
    );
  }
  if (mode === "dev" && !workspaceEnv.store) {
    return c.json({ ok: false, error: "workspace_store_unavailable" }, 503);
  }

  try {
    if (mode === "dev") {
      await ensureDefaultWorkspace(workspaceEnv.store);
    }
    const manifest = await loadWorkspaceManifest(workspaceId, {
      env: workspaceEnv.env,
      store: workspaceEnv.store,
      mode,
    });
    if (!manifest) {
      throw new AppPreviewError(
        "workspace_not_found",
        `Workspace not found: ${workspaceId || requestedWorkspaceId || "prod"}`,
      );
    }

    const uiContract = await loadUiContractForPreview(workspaceId, mode, workspaceEnv.env);
    const contractWarnings = validateUiContractAgainstManifest(
      manifest,
      uiContract.contract,
      uiContract.source,
    );
    const combinedContractWarnings = [...uiContract.issues, ...contractWarnings];

    const preview = resolveScreenPreview(manifest, screenId);
    const resolvedWorkspaceId = manifest.id ?? workspaceId;
    return c.json({
      ok: true,
      mode,
      workspaceId: resolvedWorkspaceId,
      screenId: preview.screenId,
      viewMode: "json",
      resolvedTree: preview.resolvedTree,
      warnings: [...combinedContractWarnings.map(formatIssue), ...preview.warnings],
      contractWarnings: combinedContractWarnings,
      width: typeof body.width === "number" ? body.width : undefined,
      height: typeof body.height === "number" ? body.height : undefined,
    });
  } catch (err) {
    if (err instanceof AppPreviewError) {
      const status =
        err.code === "workspace_not_found" || err.code === "screen_not_found" ? 404 : 400;
      return c.json({ ok: false, error: err.code, message: err.message }, status);
    }
    console.error("app preview error", err);
    return c.json({ ok: false, error: "unexpected_error" }, 500);
  }
});

appPreview.post("/-/app/preview/screen-with-patch", async (c) => {
  const sessionUser = getSessionUser(c);
  if (!isOwnerUser(sessionUser, c.env as PreviewBindings)) {
    return c.json({ ok: false, error: "owner_session_required" }, 403);
  }

  const body = (await parseBody(c)) as PatchPreviewBody | null;
  if (!body) {
    return c.json({ ok: false, error: "invalid_json" }, 400);
  }

  const requestedWorkspaceId = typeof body.workspaceId === "string" ? body.workspaceId.trim() : "";
  const mode: "prod" | "dev" = normalizePreviewMode(body.mode, requestedWorkspaceId);
  const workspaceId = requestedWorkspaceId || (mode === "prod" ? "prod" : "");
  const screenId = typeof body.screenId === "string" ? body.screenId.trim() : "";
  const viewMode = body.viewMode === "image" ? "image" : "json";

  if (mode === "dev" && !workspaceId) {
    return c.json({ ok: false, error: "workspace_required" }, 400);
  }
  if (!screenId) {
    return c.json({ ok: false, error: "screen_required" }, 400);
  }
  if (viewMode === "image") {
    return c.json(
      {
        ok: false,
        error: "view_mode_not_supported",
        message: "image viewMode is not implemented; use viewMode=json",
      },
      400,
    );
  }
  if (body.patches === undefined) {
    return c.json({ ok: false, error: "patches_required" }, 400);
  }

  let patches: JsonPatchOperation[];
  try {
    patches = normalizeJsonPatchOperations(body.patches);
  } catch (err) {
    if (err instanceof AppPreviewError) {
      return c.json({ ok: false, error: err.code, message: err.message }, 400);
    }
    console.error("failed to normalize patches", err);
    return c.json({ ok: false, error: "invalid_request" }, 400);
  }

  const workspaceEnv = resolveWorkspaceEnv({
    env: c.env as PreviewBindings,
    mode,
    requireIsolation: mode === "dev",
  });
  if (workspaceEnv.isolation?.required && !workspaceEnv.isolation.ok) {
    return c.json(
      {
        ok: false,
        error: "dev_data_isolation_failed",
        details: workspaceEnv.isolation.errors,
      },
      503,
    );
  }
  if (mode === "dev" && !workspaceEnv.store) {
    return c.json({ ok: false, error: "workspace_store_unavailable" }, 503);
  }

  try {
    if (mode === "dev") {
      await ensureDefaultWorkspace(workspaceEnv.store);
    }
    const manifest = await loadWorkspaceManifest(workspaceId, {
      env: workspaceEnv.env,
      store: workspaceEnv.store,
      mode,
    });
    if (!manifest) {
      throw new AppPreviewError(
        "workspace_not_found",
        `Workspace not found: ${workspaceId || requestedWorkspaceId || "prod"}`,
      );
    }

    const patchedManifest = applyJsonPatches(manifest, patches);
    const uiContract = await loadUiContractForPreview(workspaceId, mode, workspaceEnv.env);
    const contractWarnings = validateUiContractAgainstManifest(
      patchedManifest,
      uiContract.contract,
      uiContract.source,
    );
    const combinedContractWarnings = [...uiContract.issues, ...contractWarnings];
    const preview = resolveScreenPreview(patchedManifest, screenId);
    const resolvedWorkspaceId = manifest.id ?? workspaceId;
    return c.json({
      ok: true,
      mode,
      workspaceId: resolvedWorkspaceId,
      screenId: preview.screenId,
      viewMode: "json",
      resolvedTree: preview.resolvedTree,
      warnings: [...combinedContractWarnings.map(formatIssue), ...preview.warnings],
      contractWarnings: combinedContractWarnings,
      patchesApplied: patches.length,
      width: typeof body.width === "number" ? body.width : undefined,
      height: typeof body.height === "number" ? body.height : undefined,
    });
  } catch (err) {
    if (err instanceof AppPreviewError) {
      const status =
        err.code === "workspace_not_found" || err.code === "screen_not_found" ? 404 : 400;
      return c.json({ ok: false, error: err.code, message: err.message }, status);
    }
    console.error("app preview patch error", err);
    return c.json({ ok: false, error: "unexpected_error" }, 500);
  }
});

export default appPreview;
