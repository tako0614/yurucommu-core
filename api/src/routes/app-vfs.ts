import { Hono } from "hono";
import type { PublicAccountBindings as Bindings, Variables } from "@takos/platform/server";
import { fail, ok } from "@takos/platform/server";
import { auth } from "../middleware/auth";
import { guardAgentRequest } from "../lib/agent-guard";
import { ensureDefaultWorkspace, resolveWorkspaceEnv } from "../lib/workspace-store";
import { ensureWithinWorkspaceLimits, resolveWorkspaceLimitsFromEnv } from "../lib/workspace-limits";

const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();

const requireHumanSession = async (c: any, next: () => Promise<void>) => {
  const guard = guardAgentRequest(c.req, { forbidAgents: true });
  if (!guard.ok) {
    return fail(c as any, guard.error, guard.status);
  }
  const user = c.get("user");
  if (!user?.id) {
    return fail(c as any, "authentication required", 403);
  }
  await next();
};

const normalizeVfsPath = (path: string): string => path.replace(/^\/+/, "").trim();

const extractPathFromUrl = (c: any, workspaceId: string, type: "files" | "dirs"): string => {
  const pathname = decodeURIComponent(new URL(c.req.url).pathname);
  const prefix = `/-/dev/vfs/${workspaceId}/${type}/`;
  return normalizeVfsPath(pathname.startsWith(prefix) ? pathname.slice(prefix.length) : "");
};

const parseContentFromBody = (raw: string): { content: string; contentType: string } => {
  const fallback = { content: raw, contentType: "text/plain" };
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && parsed.content !== undefined) {
      const contentType =
        typeof parsed.content_type === "string" && parsed.content_type.trim()
          ? parsed.content_type.trim()
          : "application/json";
      const content =
        typeof parsed.content === "string"
          ? parsed.content
          : parsed.content != null
            ? JSON.stringify(parsed.content)
            : "";
      return { content, contentType };
    }
  } catch {
    // fall back to raw text
  }
  return fallback;
};

const buildDirectoryInfo = (workspaceId: string, path: string, now: string) => {
  const normalized = normalizeVfsPath(path) || "/";
  const parts = normalized === "/" ? ["/"] : normalized.split("/");
  const name = parts[parts.length - 1] || "/";
  const parent =
    normalized === "/" ? null : parts.length > 1 ? parts.slice(0, -1).join("/") || "/" : "/";
  return {
    workspace_id: workspaceId,
    path: normalized,
    name,
    parent_path: parent,
    created_at: now,
    updated_at: now,
  };
};

const appVfs = new Hono<{ Bindings: Bindings; Variables: Variables }>();

appVfs.use("/-/dev/vfs/*", auth, requireHumanSession);

appVfs.get("/-/dev/vfs/:workspaceId/files/*", async (c) => {
  const workspaceId = (c.req.param("workspaceId") || "").trim();
  const path = extractPathFromUrl(c, workspaceId, "files");
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
      path: file.path,
      content_type: file.content_type,
      content_hash: file.content_hash ?? null,
      storage_key: file.storage_key ?? null,
      size: file.size ?? file.content?.length ?? 0,
      directory_path: (file as any).directory_path ?? undefined,
      content: textDecoder.decode(file.content),
      created_at: file.created_at,
      updated_at: file.updated_at,
    },
  });
});

appVfs.put("/-/dev/vfs/:workspaceId/files/*", async (c) => {
  const workspaceId = (c.req.param("workspaceId") || "").trim();
  const path = extractPathFromUrl(c, workspaceId, "files");
  if (!workspaceId || !path || path.includes("..")) {
    return fail(c as any, "invalid workspace file path", 400);
  }

  const rawBody = await c.req.text();
  const { content, contentType } = parseContentFromBody(rawBody);
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
  const limitCheck = await ensureWithinWorkspaceLimits(
    store,
    workspaceId,
    path,
    contentBytes.byteLength,
    limits,
  );
  if (!limitCheck.ok) {
    return fail(c as any, limitCheck.reason, 413);
  }

  const saved = await store.saveWorkspaceFile(workspaceId, path, content, contentType);
  if (!saved) {
    return fail(c as any, "failed to save file", 500);
  }

  return ok(c as any, {
    workspace_id: workspaceId,
    file: {
      path: saved.path,
      content_type: saved.content_type,
      content_hash: saved.content_hash ?? null,
      storage_key: saved.storage_key ?? null,
      size: saved.size ?? saved.content?.length ?? contentBytes.byteLength,
      directory_path: (saved as any).directory_path ?? undefined,
      content: textDecoder.decode(saved.content),
      created_at: saved.created_at,
      updated_at: saved.updated_at,
    },
    usage: limitCheck.usage,
  });
});

appVfs.delete("/-/dev/vfs/:workspaceId/files/*", async (c) => {
  const workspaceId = (c.req.param("workspaceId") || "").trim();
  const path = extractPathFromUrl(c, workspaceId, "files");
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
    return fail(c as any, "workspace delete is not supported", 501);
  }
  await store.deleteWorkspaceFile(workspaceId, path);
  return ok(c as any, { deleted: true, workspace_id: workspaceId, path });
});

appVfs.get("/-/dev/vfs/:workspaceId/dirs/*", async (c) => {
  const workspaceId = (c.req.param("workspaceId") || "").trim();
  const rawPath = extractPathFromUrl(c, workspaceId, "dirs");
  const dirPath = rawPath || "/";
  if (!workspaceId || dirPath.includes("..")) {
    return fail(c as any, "invalid directory path", 400);
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

  if (typeof store.listDirectories !== "function") {
    return fail(c as any, "vfs directories are not supported", 501);
  }
  const dirs = await store.listDirectories(workspaceId, dirPath);
  return ok(c as any, { workspace_id: workspaceId, path: dirPath, dirs });
});

appVfs.post("/-/dev/vfs/:workspaceId/dirs/*", async (c) => {
  const workspaceId = (c.req.param("workspaceId") || "").trim();
  const rawPath = extractPathFromUrl(c, workspaceId, "dirs");
  const dirPath = rawPath || "/";
  if (!workspaceId || dirPath.includes("..")) {
    return fail(c as any, "invalid directory path", 400);
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

  let directory = null;
  if (typeof store.ensureDirectory === "function") {
    directory = await store.ensureDirectory(workspaceId, dirPath);
  } else if (typeof store.listDirectories === "function") {
    await store.listDirectories(workspaceId, dirPath);
    directory = buildDirectoryInfo(workspaceId, dirPath, new Date().toISOString());
  }

  if (!directory) {
    return fail(c as any, "vfs directories are not supported", 501);
  }

  return ok(c as any, { workspace_id: workspaceId, directory });
});

export default appVfs;
