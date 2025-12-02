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
  env: any,
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

function escapeXml(str: string | null | undefined): string {
  if (!str) return "";
  return String(str).replace(/[&<>'"]/g, (ch) => {
    switch (ch) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      case "'":
        return "&#39;";
      default:
        return ch;
    }
  });
}

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
  // image view is handled below after manifest is resolved so we can include preview data

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
      manifest as any,
      uiContract.contract,
      uiContract.source,
    );
    const combinedContractWarnings = [...uiContract.issues, ...contractWarnings];

    const preview = resolveScreenPreview(manifest as any, screenId);
    const resolvedWorkspaceId = manifest.id ?? workspaceId;
    if (viewMode === "image") {
      const texts: string[] = [];
      (function collect(node: any) {
        if (!node || typeof node !== "object") return;
        if (node?.props?.text) texts.push(String(node.props.text));
        const children = Array.isArray(node.children) ? node.children : [];
        for (const ch of children) collect(ch);
      })(preview.resolvedTree);

      const labelLines = texts.length ? texts : [`Screen: ${preview.screenId}`];
      const svgLines = labelLines.map((t, i) => `<text x='16' y='${36 + i * 24}' font-size='20' fill='#222'>${escapeXml(t)}</text>`).join("");
      const svg = `<?xml version="1.0" encoding="UTF-8"?>\n` +
        `<svg xmlns='http://www.w3.org/2000/svg' width='${body.width ?? 800}' height='${Math.max(150, 24 * labelLines.length + 60)}'>` +
        `<rect width='100%' height='100%' fill='#fff' stroke='#ccc'/>` +
        svgLines +
        `</svg>`;
      const headers = { 'content-type': 'image/svg+xml' };
      return new Response(svg, { status: 200, headers });
    }

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
    // Minimal image preview implementation for patched manifests
    const svg = `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<svg xmlns='http://www.w3.org/2000/svg' width='${body.width ?? 800}' height='${body.height ?? 600}'>` +
      `<rect width='100%' height='100%' fill='#fff' stroke='#ccc'/>` +
      `<text x='16' y='36' font-size='20' fill='#222'>Screen (patched): ${screenId}</text>` +
      `</svg>`;
    const headers = { 'content-type': 'image/svg+xml' };
    return new Response(svg, { status: 200, headers });
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
      patchedManifest as any,
      uiContract.contract,
      uiContract.source,
    );
    const combinedContractWarnings = [...uiContract.issues, ...contractWarnings];
    const preview = resolveScreenPreview(patchedManifest as any, screenId);
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
