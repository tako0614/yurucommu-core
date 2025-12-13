/// <reference types="@cloudflare/workers-types" />

import { Hono } from "hono";
import type { PublicAccountBindings, Variables } from "@takos/platform/server";
import { HttpError } from "@takos/platform/server";
import {
  AppPreviewError,
  applyJsonPatches,
  type JsonPatchOperation,
  normalizeJsonPatchOperations,
  resolveScreenPreview,
} from "../lib/app-preview";
import { mapErrorToResponse } from "../lib/observability";
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
import defaultUiContract from "../../../schemas/ui-contract.json";
import { auth } from "../middleware/auth";
import { requireHumanSession, requireWorkspacePlan } from "../lib/workspace-guard";

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
appPreview.onError((error, c) =>
  mapErrorToResponse(error, {
    requestId: (c.get("requestId") as string | undefined) ?? undefined,
    env: c.env,
  }),
);

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
      return { contract: result.contract, issues: result.issues, source: "schemas/ui-contract.json" };
    }
    return {
      contract: defaultUiContract as UiContract,
      issues: [
        ...result.issues,
        {
          severity: "warning",
          message: "schemas/ui-contract.json not found in workspace; using default contract",
          file: "schemas/ui-contract.json",
        },
      ],
      source: "schemas/ui-contract.json",
    };
  }
  return { contract: defaultUiContract as UiContract, issues: [], source: "schemas/ui-contract.json" };
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

appPreview.use("/-/app/preview/*", auth, requireHumanSession, requireWorkspacePlan);

appPreview.post("/-/app/preview/screen", async (c) => {
  const sessionUser = getSessionUser(c);
  if (!sessionUser?.id) {
    throw new HttpError(401, "UNAUTHORIZED", "Authentication required");
  }

  const body = await parseBody(c);
  if (!body) {
    throw new HttpError(400, "INVALID_INPUT", "Invalid JSON body");
  }

  const requestedWorkspaceId = typeof body.workspaceId === "string" ? body.workspaceId.trim() : "";
  const mode: "prod" | "dev" = normalizePreviewMode(body.mode, requestedWorkspaceId);
  const workspaceId = requestedWorkspaceId || (mode === "prod" ? "prod" : "");
  const screenId = typeof body.screenId === "string" ? body.screenId.trim() : "";
  const viewMode = body.viewMode === "image" ? "image" : "json";

  if (mode === "dev" && !workspaceId) {
    throw new HttpError(400, "MISSING_REQUIRED_FIELD", "workspaceId is required", { field: "workspaceId" });
  }
  if (!screenId) {
    throw new HttpError(400, "MISSING_REQUIRED_FIELD", "screenId is required", { field: "screenId" });
  }
  // image view is handled below after manifest is resolved so we can include preview data

  const workspaceEnv = resolveWorkspaceEnv({
    env: c.env as PreviewBindings,
    mode,
    requireIsolation: mode === "dev",
  });
  if (workspaceEnv.isolation?.required && !workspaceEnv.isolation.ok) {
    throw new HttpError(503, "SERVICE_UNAVAILABLE", "Dev data isolation failed", {
      errors: workspaceEnv.isolation.errors,
    });
  }
  if (mode === "dev" && !workspaceEnv.store) {
    throw new HttpError(503, "SERVICE_UNAVAILABLE", "Workspace store unavailable");
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
      const code = status === 404 ? "NOT_FOUND" : "INVALID_INPUT";
      throw new HttpError(status, code, err.message, { reason: err.code });
    }
    console.error("app preview error", err);
    throw new HttpError(500, "INTERNAL_ERROR", "App preview failed");
  }
});

appPreview.post("/-/app/preview/screen-with-patch", async (c) => {
  const sessionUser = getSessionUser(c);
  if (!sessionUser?.id) {
    throw new HttpError(401, "UNAUTHORIZED", "Authentication required");
  }

  const body = (await parseBody(c)) as PatchPreviewBody | null;
  if (!body) {
    throw new HttpError(400, "INVALID_INPUT", "Invalid JSON body");
  }

  const requestedWorkspaceId = typeof body.workspaceId === "string" ? body.workspaceId.trim() : "";
  const mode: "prod" | "dev" = normalizePreviewMode(body.mode, requestedWorkspaceId);
  const workspaceId = requestedWorkspaceId || (mode === "prod" ? "prod" : "");
  const screenId = typeof body.screenId === "string" ? body.screenId.trim() : "";
  const viewMode = body.viewMode === "image" ? "image" : "json";

  if (mode === "dev" && !workspaceId) {
    throw new HttpError(400, "MISSING_REQUIRED_FIELD", "workspaceId is required", { field: "workspaceId" });
  }
  if (!screenId) {
    throw new HttpError(400, "MISSING_REQUIRED_FIELD", "screenId is required", { field: "screenId" });
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
    throw new HttpError(400, "MISSING_REQUIRED_FIELD", "patches is required", { field: "patches" });
  }

  let patches: JsonPatchOperation[];
  try {
    patches = normalizeJsonPatchOperations(body.patches);
  } catch (err) {
    if (err instanceof AppPreviewError) {
      throw new HttpError(400, "INVALID_INPUT", err.message, { reason: err.code });
    }
    console.error("failed to normalize patches", err);
    throw new HttpError(400, "INVALID_INPUT", "Invalid patches payload");
  }

  const workspaceEnv = resolveWorkspaceEnv({
    env: c.env as PreviewBindings,
    mode,
    requireIsolation: mode === "dev",
  });
  if (workspaceEnv.isolation?.required && !workspaceEnv.isolation.ok) {
    throw new HttpError(503, "SERVICE_UNAVAILABLE", "Dev data isolation failed", {
      errors: workspaceEnv.isolation.errors,
    });
  }
  if (mode === "dev" && !workspaceEnv.store) {
    throw new HttpError(503, "SERVICE_UNAVAILABLE", "Workspace store unavailable");
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
      const code = status === 404 ? "NOT_FOUND" : "INVALID_INPUT";
      throw new HttpError(status, code, err.message, { reason: err.code });
    }
    console.error("app preview patch error", err);
    throw new HttpError(500, "INTERNAL_ERROR", "App preview failed");
  }
});

export default appPreview;
