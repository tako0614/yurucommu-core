import { Hono } from "hono";
import {
  AppPreviewError,
  applyJsonPatches,
  type JsonPatchOperation,
  normalizeJsonPatchOperations,
  resolveScreenPreview,
} from "../lib/app-preview";
import { loadWorkspaceManifest } from "../lib/workspace-store";

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

type PreviewBindings = {
  APP_PREVIEW_TOKEN?: string;
};

const appPreview = new Hono<{ Bindings: PreviewBindings }>();

const parseBody = async (c: any): Promise<PreviewBody | null> => {
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== "object") return null;
  return body as PreviewBody;
};

const requirePreviewAccess = (c: any) => {
  const env = (c?.env ?? {}) as PreviewBindings;
  const token = env.APP_PREVIEW_TOKEN?.trim();
  if (!token) return true;
  const provided = c.req.header("x-app-preview-token")?.trim();
  return provided === token;
};

appPreview.post("/admin/app/preview/screen", async (c) => {
  if (!requirePreviewAccess(c)) {
    return c.json({ ok: false, error: "unauthorized" }, 401);
  }

  const body = await parseBody(c);
  if (!body) {
    return c.json({ ok: false, error: "invalid_json" }, 400);
  }

  const mode = body.mode === "prod" ? "prod" : "dev";
  const workspaceId = typeof body.workspaceId === "string" ? body.workspaceId.trim() : "";
  const screenId = typeof body.screenId === "string" ? body.screenId.trim() : "";
  const viewMode = body.viewMode === "image" ? "image" : "json";

  if (!workspaceId) {
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

  try {
    const manifest = await loadWorkspaceManifest(workspaceId);
    if (!manifest) {
      throw new AppPreviewError("workspace_not_found", `Workspace not found: ${workspaceId}`);
    }

    const preview = resolveScreenPreview(manifest, screenId);
    return c.json({
      ok: true,
      mode,
      workspaceId,
      screenId: preview.screenId,
      viewMode: "json",
      resolvedTree: preview.resolvedTree,
      warnings: preview.warnings,
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

appPreview.post("/admin/app/preview/screen-with-patch", async (c) => {
  if (!requirePreviewAccess(c)) {
    return c.json({ ok: false, error: "unauthorized" }, 401);
  }

  const body = (await parseBody(c)) as PatchPreviewBody | null;
  if (!body) {
    return c.json({ ok: false, error: "invalid_json" }, 400);
  }

  const mode = body.mode === "prod" ? "prod" : "dev";
  const workspaceId = typeof body.workspaceId === "string" ? body.workspaceId.trim() : "";
  const screenId = typeof body.screenId === "string" ? body.screenId.trim() : "";
  const viewMode = body.viewMode === "image" ? "image" : "json";

  if (!workspaceId) {
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

  try {
    const manifest = await loadWorkspaceManifest(workspaceId);
    if (!manifest) {
      throw new AppPreviewError("workspace_not_found", `Workspace not found: ${workspaceId}`);
    }

    const patchedManifest = applyJsonPatches(manifest, patches);
    const preview = resolveScreenPreview(patchedManifest, screenId);
    return c.json({
      ok: true,
      mode,
      workspaceId,
      screenId: preview.screenId,
      viewMode: "json",
      resolvedTree: preview.resolvedTree,
      warnings: preview.warnings,
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
