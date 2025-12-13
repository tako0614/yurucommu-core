import { Hono } from "hono";
import type { PublicAccountBindings as Bindings, Variables } from "@takos/platform/server";
import { fail, ok } from "@takos/platform/server";
import { auth } from "../middleware/auth";
import {
  ensureDefaultWorkspace,
  resolveWorkspaceEnv,
  type AppWorkspaceRecord,
  type WorkspaceFileRecord,
  type WorkspaceStore,
  type WorkspaceUsage,
} from "../lib/workspace-store";
import { type AuthContext } from "../lib/auth-context-model";
import { requireVfsQuota } from "../lib/plan-guard";
import {
  ensureWithinWorkspaceLimits,
  resolveWorkspaceLimitsFromEnv,
  type WorkspaceLimitSet,
} from "../lib/workspace-limits";
import { requireHumanSession, requireWorkspacePlan } from "../lib/workspace-guard";

const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();

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

const RESERVED_WORKSPACE_IDS = new Set(["default", "demo", "ws_demo"]);

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

const normalizeWorkspaceId = (value: unknown): string =>
  typeof value === "string" ? value.trim() : "";

const normalizeCacheHash = (value: string): string =>
  value.replace(/[^A-Za-z0-9_.-]/g, "").slice(0, 128);

const globToRegExp = (pattern: string): RegExp => {
  const normalized = pattern.replace(/\\/g, "/");
  let source = "^";
  for (let i = 0; i < normalized.length; i++) {
    const ch = normalized[i];
    const next = normalized[i + 1];
    if (ch === "*" && next === "*") {
      source += ".*";
      i += 1;
      continue;
    }
    if (ch === "*") {
      source += "[^/]*";
      continue;
    }
    if (ch === "?") {
      source += "[^/]";
      continue;
    }
    if ("+.^$|()[]{}".includes(ch)) {
      source += `\\${ch}`;
      continue;
    }
    source += ch;
  }
  source += "$";
  return new RegExp(source);
};

type WorkspaceContext =
  | { ok: true; value: { workspaceId: string; store: WorkspaceStore; workspace: AppWorkspaceRecord; limits: WorkspaceLimitSet } }
  | { ok: false; response: Response };

const resolveWorkspaceContext = async (c: any, workspaceIdRaw: unknown): Promise<WorkspaceContext> => {
  const workspaceId = normalizeWorkspaceId(workspaceIdRaw);
  if (!workspaceId) {
    return { ok: false, response: fail(c as any, "workspaceId is required", 400) };
  }

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
  const store = workspaceEnv.store;
  if (!store) {
    return { ok: false, response: fail(c as any, "workspace store is not configured", 503) };
  }
  await ensureDefaultWorkspace(store);
  const workspace = await store.getWorkspace(workspaceId);
  if (!workspace) {
    return { ok: false, response: fail(c as any, "workspace not found", 404) };
  }
  const limits = resolveWorkspaceLimitsFromEnv(workspaceEnv.env);
  return { ok: true, value: { workspaceId, store, workspace, limits } };
};

const mapWorkspaceFile = (file: WorkspaceFileRecord, fallbackContent?: Uint8Array) => {
  const contentBytes = file.content ?? fallbackContent ?? new Uint8Array();
  return {
    path: file.path,
    content_type: file.content_type,
    content_hash: file.content_hash ?? null,
    storage_key: file.storage_key ?? null,
    size: file.size ?? contentBytes.byteLength,
    directory_path: (file as any).directory_path ?? undefined,
    is_cache: (file as any).is_cache ?? undefined,
    content: textDecoder.decode(contentBytes),
    created_at: file.created_at,
    updated_at: file.updated_at,
  };
};

const computeWorkspaceUsage = async (store: WorkspaceStore, workspaceId: string): Promise<WorkspaceUsage> => {
  if (typeof store.getWorkspaceUsage === "function") {
    const usage = await store.getWorkspaceUsage(workspaceId);
    if (usage) return usage;
  }
  if (typeof store.listWorkspaceFiles === "function") {
    const files = await store.listWorkspaceFiles(workspaceId);
    const totalSize = files.reduce(
      (acc, file) => acc + (file.size ?? file.content?.length ?? 0),
      0,
    );
    return { fileCount: files.length, totalSize };
  }
  return { fileCount: 0, totalSize: 0 };
};

const buildCacheControlFromLimits = (limits: WorkspaceLimitSet): string | undefined => {
  if (Number.isFinite(limits.compileCacheTtlSeconds) && limits.compileCacheTtlSeconds > 0) {
    return `public, max-age=${Math.floor(limits.compileCacheTtlSeconds)}`;
  }
  return undefined;
};

const appVfs = new Hono<{ Bindings: Bindings; Variables: Variables }>();

appVfs.use("/-/dev/vfs/*", auth, requireHumanSession, requireWorkspacePlan);

appVfs.get("/-/dev/vfs/:workspaceId", async (c) => {
  const ctx = await resolveWorkspaceContext(c, c.req.param("workspaceId"));
  if (!ctx.ok) return ctx.response;
  const { workspaceId, store, workspace, limits } = ctx.value;
  const usage = await computeWorkspaceUsage(store, workspaceId);
  const dirs =
    typeof store.listDirectories === "function"
      ? await store.listDirectories(workspaceId, "/")
      : [];

  return ok(c as any, {
    workspace_id: workspaceId,
    workspace: {
      id: workspace.id,
      status: workspace.status,
      base_revision_id: workspace.base_revision_id,
      created_at: workspace.created_at,
      updated_at: workspace.updated_at,
    },
    usage,
    limits,
    dirs,
  });
});

appVfs.get("/-/dev/vfs/:workspaceId/files", async (c) => {
  const ctx = await resolveWorkspaceContext(c, c.req.param("workspaceId"));
  if (!ctx.ok) return ctx.response;
  const { workspaceId, store } = ctx.value;
  const prefix = (c.req.query("prefix") || "").trim();
  if (prefix.includes("..")) {
    return fail(c as any, "invalid workspace file path", 400);
  }
  const files = await store.listWorkspaceFiles(workspaceId, prefix || undefined);
  const usage = await computeWorkspaceUsage(store, workspaceId);

  return ok(c as any, {
    workspace_id: workspaceId,
    prefix: prefix || undefined,
    files: files.map((f) => mapWorkspaceFile(f)),
    usage,
  });
});

appVfs.get("/-/dev/vfs/:workspaceId/files/*", async (c) => {
  const workspaceId = (c.req.param("workspaceId") || "").trim();
  const path = extractPathFromUrl(c, workspaceId, "files");
  if (!workspaceId || !path || path.includes("..")) {
    return fail(c as any, "invalid workspace file path", 400);
  }

  const ctx = await resolveWorkspaceContext(c, workspaceId);
  if (!ctx.ok) return ctx.response;
  const { store } = ctx.value;

  const file = await store.getWorkspaceFile(workspaceId, path);
  if (!file) {
    return fail(c as any, "file not found", 404);
  }

  return ok(c as any, {
    workspace_id: workspaceId,
    file: mapWorkspaceFile(file),
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

  const ctx = await resolveWorkspaceContext(c, workspaceId);
  if (!ctx.ok) return ctx.response;
  const { store, limits } = ctx.value;
  const authContext = (c.get("authContext") as AuthContext | undefined) ?? null;

  const limitCheck = await ensureWithinWorkspaceLimits(
    store,
    workspaceId,
    path,
    contentBytes.byteLength,
    limits,
  );
  if (!limitCheck.ok) {
    const quota = requireVfsQuota(authContext, {
      fileSize: contentBytes.byteLength,
      fileCount: limitCheck.usage.fileCount,
      totalSize: limitCheck.usage.totalSize,
    });
    const fallbackCode =
      limitCheck.reason === "workspace_file_too_large" ? "FILE_TOO_LARGE" : "STORAGE_LIMIT_EXCEEDED";
    const fallbackStatus = limitCheck.reason === "workspace_file_too_large" ? 413 : 507;
    const status = quota.ok ? fallbackStatus : quota.status;
    const code = quota.ok ? fallbackCode : quota.code;
    const message = quota.ok ? "workspace limit exceeded" : quota.message;
    return fail(c as any, message, status, {
      code,
      details: quota.ok
        ? { reason: limitCheck.reason, usage: limitCheck.usage, limits }
        : quota.details,
    });
  }

  const saved = await store.saveWorkspaceFile(workspaceId, path, content, contentType);
  if (!saved) {
    return fail(c as any, "failed to save file", 500);
  }

  return ok(c as any, {
    workspace_id: workspaceId,
    file: mapWorkspaceFile(saved, contentBytes),
    usage: limitCheck.usage,
  });
});

appVfs.delete("/-/dev/vfs/:workspaceId/files/*", async (c) => {
  const workspaceId = (c.req.param("workspaceId") || "").trim();
  const path = extractPathFromUrl(c, workspaceId, "files");
  if (!workspaceId || !path || path.includes("..")) {
    return fail(c as any, "invalid workspace file path", 400);
  }

  const ctx = await resolveWorkspaceContext(c, workspaceId);
  if (!ctx.ok) return ctx.response;
  const { store } = ctx.value;

  if (typeof store.deleteWorkspaceFile !== "function") {
    return fail(c as any, "workspace delete is not supported", 501);
  }
  await store.deleteWorkspaceFile(workspaceId, path);
  const usage = await computeWorkspaceUsage(store, workspaceId);
  return ok(c as any, { deleted: true, workspace_id: workspaceId, path, usage });
});

appVfs.post("/-/dev/vfs/:workspaceId/files/move", async (c) => {
  const workspaceId = (c.req.param("workspaceId") || "").trim();
  const payload = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  const from = typeof payload?.from === "string" ? payload.from : "";
  const to = typeof payload?.to === "string" ? payload.to : "";
  const fromPath = normalizeVfsPath(from);
  const toPath = normalizeVfsPath(to);
  if (!workspaceId || !fromPath || !toPath || fromPath.includes("..") || toPath.includes("..")) {
    return fail(c as any, "invalid move payload", 400);
  }

  const ctx = await resolveWorkspaceContext(c, workspaceId);
  if (!ctx.ok) return ctx.response;
  const { store, limits } = ctx.value;

  const source = await store.getWorkspaceFile(workspaceId, fromPath);
  if (!source) {
    return fail(c as any, "file not found", 404);
  }
  const size = source.size ?? source.content?.byteLength ?? 0;
  if (Number.isFinite(limits.maxFileSize) && size > limits.maxFileSize) {
    return fail(c as any, "workspace_file_too_large", 413, { code: "FILE_TOO_LARGE" });
  }

  const moved =
    typeof store.moveWorkspaceFile === "function"
      ? await store.moveWorkspaceFile(workspaceId, fromPath, toPath)
      : await (async () => {
          const copied = await store.saveWorkspaceFile(
            workspaceId,
            toPath,
            source.content,
            source.content_type ?? undefined,
          );
          if (!copied) return null;
          if (typeof store.deleteWorkspaceFile === "function") {
            await store.deleteWorkspaceFile(workspaceId, fromPath);
          }
          return copied;
        })();

  if (!moved) {
    return fail(c as any, "failed to move file", 500);
  }

  const usage = await computeWorkspaceUsage(store, workspaceId);
  return ok(c as any, { workspace_id: workspaceId, file: mapWorkspaceFile(moved), usage });
});

appVfs.post("/-/dev/vfs/:workspaceId/files/copy", async (c) => {
  const workspaceId = (c.req.param("workspaceId") || "").trim();
  const payload = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  const from = typeof payload?.from === "string" ? payload.from : "";
  const to = typeof payload?.to === "string" ? payload.to : "";
  const fromPath = normalizeVfsPath(from);
  const toPath = normalizeVfsPath(to);
  if (!workspaceId || !fromPath || !toPath || fromPath.includes("..") || toPath.includes("..")) {
    return fail(c as any, "invalid copy payload", 400);
  }

  const ctx = await resolveWorkspaceContext(c, workspaceId);
  if (!ctx.ok) return ctx.response;
  const { store, limits } = ctx.value;
  const authContext = (c.get("authContext") as AuthContext | undefined) ?? null;

  const source = await store.getWorkspaceFile(workspaceId, fromPath);
  if (!source) {
    return fail(c as any, "file not found", 404);
  }
  const size = source.size ?? source.content?.byteLength ?? 0;
  const limitCheck = await ensureWithinWorkspaceLimits(
    store,
    workspaceId,
    toPath,
    size,
    limits,
  );
  if (!limitCheck.ok) {
    const quota = requireVfsQuota(authContext, {
      fileSize: size,
      fileCount: limitCheck.usage.fileCount,
      totalSize: limitCheck.usage.totalSize,
    });
    const fallbackCode =
      limitCheck.reason === "workspace_file_too_large" ? "FILE_TOO_LARGE" : "STORAGE_LIMIT_EXCEEDED";
    const fallbackStatus = limitCheck.reason === "workspace_file_too_large" ? 413 : 507;
    const status = quota.ok ? fallbackStatus : quota.status;
    const code = quota.ok ? fallbackCode : quota.code;
    const message = quota.ok ? "workspace limit exceeded" : quota.message;
    return fail(c as any, message, status, {
      code,
      details: quota.ok
        ? { reason: limitCheck.reason, usage: limitCheck.usage, limits }
        : quota.details,
    });
  }

  const copied =
    typeof store.copyWorkspaceFile === "function"
      ? await store.copyWorkspaceFile(workspaceId, fromPath, toPath)
      : await store.saveWorkspaceFile(
          workspaceId,
          toPath,
          source.content,
          source.content_type ?? undefined,
        );

  if (!copied) {
    return fail(c as any, "failed to copy file", 500);
  }
  return ok(c as any, { workspace_id: workspaceId, file: mapWorkspaceFile(copied), usage: limitCheck.usage });
});

appVfs.delete("/-/dev/vfs/workspaces/:workspaceId", async (c) => {
  const workspaceId = (c.req.param("workspaceId") || "").trim();
  if (!workspaceId) {
    return fail(c as any, "workspaceId is required", 400);
  }
  if (RESERVED_WORKSPACE_IDS.has(workspaceId)) {
    return fail(c as any, "cannot delete reserved workspace", 400);
  }
  const ctx = await resolveWorkspaceContext(c, workspaceId);
  if (!ctx.ok) return ctx.response;
  const { store } = ctx.value;

  let deletedFiles = 0;
  if (typeof store.listWorkspaceFiles === "function" && typeof store.deleteWorkspaceFile === "function") {
    try {
      const files = await store.listWorkspaceFiles(workspaceId);
      for (const file of files) {
        try {
          await store.deleteWorkspaceFile(workspaceId, file.path);
          deletedFiles += 1;
        } catch (error) {
          console.warn("[vfs] failed to delete workspace file", error);
        }
      }
    } catch (error) {
      console.warn("[vfs] failed to list workspace files for delete", error);
    }
  }

  if (typeof (store as any).deleteWorkspace === "function") {
    try {
      await (store as any).deleteWorkspace(workspaceId);
    } catch (error) {
      console.warn("[vfs] failed to delete workspace metadata", error);
    }
  }

  return ok(c as any, {
    workspace_id: workspaceId,
    deleted: true,
    deleted_files: deletedFiles,
  });
});

const listDirectories = async (c: any, rawPath: string) => {
  const workspaceId = (c.req.param("workspaceId") || "").trim();
  const dirPath = rawPath || "/";
  if (!workspaceId || dirPath.includes("..")) {
    return fail(c as any, "invalid directory path", 400);
  }

  const ctx = await resolveWorkspaceContext(c, workspaceId);
  if (!ctx.ok) return ctx.response;
  const { store } = ctx.value;

  const now = new Date().toISOString();
  const buildFromFiles = async () => {
    if (typeof store.listWorkspaceFiles !== "function") return [];
    const files = await store.listWorkspaceFiles(workspaceId);
    const prefix = dirPath === "/" ? "" : `${normalizeVfsPath(dirPath)}/`;
    const seen = new Set<string>();
    const dirs: any[] = [];
    for (const file of files) {
      const normalizedPath = normalizeVfsPath(file.path || "");
      if (!normalizedPath.startsWith(prefix)) continue;
      const remainder = normalizedPath.slice(prefix.length);
      const segment = remainder.split("/")[0];
      if (!segment) continue;
      const full = prefix ? `${prefix}${segment}` : segment;
      const normalizedFull = normalizeVfsPath(full);
      if (!seen.has(normalizedFull)) {
        seen.add(normalizedFull);
        dirs.push(buildDirectoryInfo(workspaceId, normalizedFull, now));
      }
    }
    if (dirPath === "/" && !seen.has("/")) {
      dirs.unshift(buildDirectoryInfo(workspaceId, "/", now));
    }
    return dirs;
  };

  if (typeof store.listDirectories !== "function") {
    const dirs = await buildFromFiles();
    return ok(c as any, { workspace_id: workspaceId, path: dirPath, dirs });
  }
  const dirs = await store.listDirectories(workspaceId, dirPath);
  return ok(c as any, { workspace_id: workspaceId, path: dirPath, dirs });
};

appVfs.get("/-/dev/vfs/:workspaceId/dirs", async (c) => {
  return listDirectories(c, "/");
});

appVfs.get("/-/dev/vfs/:workspaceId/dirs/*", async (c) => {
  const workspaceId = (c.req.param("workspaceId") || "").trim();
  const rawPath = extractPathFromUrl(c, workspaceId, "dirs");
  return listDirectories(c, rawPath || "/");
});

appVfs.post("/-/dev/vfs/:workspaceId/dirs/*", async (c) => {
  const workspaceId = (c.req.param("workspaceId") || "").trim();
  const rawPath = extractPathFromUrl(c, workspaceId, "dirs");
  const dirPath = rawPath || "/";
  if (!workspaceId || dirPath.includes("..")) {
    return fail(c as any, "invalid directory path", 400);
  }

  const ctx = await resolveWorkspaceContext(c, workspaceId);
  if (!ctx.ok) return ctx.response;
  const { store } = ctx.value;

  let directory = null;
  if (typeof store.ensureDirectory === "function") {
    directory = await store.ensureDirectory(workspaceId, dirPath);
  } else if (typeof store.listDirectories === "function") {
    await store.listDirectories(workspaceId, dirPath);
    directory = buildDirectoryInfo(workspaceId, dirPath, new Date().toISOString());
  }

  if (!directory) {
    directory = buildDirectoryInfo(workspaceId, dirPath, new Date().toISOString());
  }

  return ok(c as any, { workspace_id: workspaceId, directory });
});

appVfs.delete("/-/dev/vfs/:workspaceId/dirs/*", async (c) => {
  const workspaceId = (c.req.param("workspaceId") || "").trim();
  const rawPath = extractPathFromUrl(c, workspaceId, "dirs");
  const dirPath = rawPath || "/";
  const recursive = (c.req.query("recursive") || "").toLowerCase() === "true";
  if (!workspaceId || !dirPath || dirPath.includes("..")) {
    return fail(c as any, "invalid directory path", 400);
  }

  const ctx = await resolveWorkspaceContext(c, workspaceId);
  if (!ctx.ok) return ctx.response;
  const { store } = ctx.value;

  if (typeof store.deleteDirectory === "function") {
    try {
      const result = await store.deleteDirectory(workspaceId, dirPath, { recursive });
      const usage = await computeWorkspaceUsage(store, workspaceId);
      return ok(c as any, { workspace_id: workspaceId, path: dirPath, deleted: true, recursive, ...result, usage });
    } catch (error) {
      const message = (error as Error).message;
      if (message === "directory_not_empty") {
        return fail(c as any, "directory not empty", 409);
      }
      if (message === "cannot delete root directory") {
        return fail(c as any, "cannot delete root directory", 400);
      }
      return fail(c as any, "failed to delete directory", 500);
    }
  }

  return fail(c as any, "directory delete is not supported", 501);
});

appVfs.get("/-/dev/vfs/:workspaceId/glob", async (c) => {
  const workspaceId = (c.req.param("workspaceId") || "").trim();
  const pattern = (c.req.query("pattern") || "").trim();
  if (!workspaceId || !pattern) {
    return fail(c as any, "workspaceId and pattern are required", 400);
  }

  const ctx = await resolveWorkspaceContext(c, workspaceId);
  if (!ctx.ok) return ctx.response;
  const { store } = ctx.value;

  const regex = globToRegExp(pattern.replace(/^\/+/, ""));
  const files = await store.listWorkspaceFiles(workspaceId);
  const matched = files.filter((file) => regex.test(file.path));

  return ok(c as any, { workspace_id: workspaceId, pattern, files: matched.map((f) => mapWorkspaceFile(f)) });
});

appVfs.get("/-/dev/vfs/:workspaceId/search", async (c) => {
  const workspaceId = (c.req.param("workspaceId") || "").trim();
  const query = (c.req.query("query") || c.req.query("q") || "").trim();
  const prefix = (c.req.query("prefix") || "").trim();
  const caseSensitive = (c.req.query("caseSensitive") || "").toLowerCase() === "true";
  const regexMode = (c.req.query("regex") || "").toLowerCase() === "true";
  if (!workspaceId || !query) {
    return fail(c as any, "workspaceId and query are required", 400);
  }

  const ctx = await resolveWorkspaceContext(c, workspaceId);
  if (!ctx.ok) return ctx.response;
  const { store } = ctx.value;

  const files = await store.listWorkspaceFiles(workspaceId, prefix || undefined);
  const matcher = (() => {
    if (regexMode) {
      try {
        return new RegExp(query, caseSensitive ? "" : "i");
      } catch {
        return null;
      }
    }
    const needle = caseSensitive ? query : query.toLowerCase();
    return {
      test: (text: string) => {
        const haystack = caseSensitive ? text : text.toLowerCase();
        return haystack.includes(needle);
      },
    } as Pick<RegExp, "test">;
  })();
  if (!matcher) {
    return fail(c as any, "invalid regex query", 400);
  }

  const results: Array<{ path: string; matches: number }> = [];
  for (const file of files) {
    const text = textDecoder.decode(file.content ?? new Uint8Array());
    if (!text) continue;
    if (matcher.test(text)) {
      results.push({ path: file.path, matches: 1 });
    }
    if (results.length >= 200) break;
  }

  return ok(c as any, { workspace_id: workspaceId, query, prefix: prefix || undefined, results });
});

appVfs.get("/-/dev/vfs/:workspaceId/cache/esbuild/:hash", async (c) => {
  const workspaceId = (c.req.param("workspaceId") || "").trim();
  const rawHash = (c.req.param("hash") || "").trim();
  const hash = normalizeCacheHash(rawHash);
  if (!workspaceId || !hash) {
    return fail(c as any, "workspaceId and hash are required", 400);
  }

  const ctx = await resolveWorkspaceContext(c, workspaceId);
  if (!ctx.ok) return ctx.response;
  const { store } = ctx.value;

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
    cache: mapWorkspaceFile(cached),
  });
});

appVfs.post("/-/dev/vfs/:workspaceId/cache/esbuild/:hash", async (c) => {
  const workspaceId = (c.req.param("workspaceId") || "").trim();
  const rawHash = (c.req.param("hash") || "").trim();
  const hash = normalizeCacheHash(rawHash);
  if (!workspaceId || !hash) {
    return fail(c as any, "workspaceId and hash are required", 400);
  }

  const rawBody = await c.req.text();
  const { content, contentType } = parseContentFromBody(rawBody);
  const contentBytes = textEncoder.encode(content);

  const ctx = await resolveWorkspaceContext(c, workspaceId);
  if (!ctx.ok) return ctx.response;
  const { store, limits } = ctx.value;
  const authContext = (c.get("authContext") as AuthContext | undefined) ?? null;

  const cachePath = `__cache/esbuild/${hash}.js`;
  const limitCheck = await ensureWithinWorkspaceLimits(
    store,
    workspaceId,
    cachePath,
    contentBytes.byteLength,
    limits,
  );
  if (!limitCheck.ok) {
    const quota = requireVfsQuota(authContext, {
      fileSize: contentBytes.byteLength,
      fileCount: limitCheck.usage.fileCount,
      totalSize: limitCheck.usage.totalSize,
    });
    const fallbackCode =
      limitCheck.reason === "workspace_file_too_large" ? "FILE_TOO_LARGE" : "STORAGE_LIMIT_EXCEEDED";
    const fallbackStatus = limitCheck.reason === "workspace_file_too_large" ? 413 : 507;
    const status = quota.ok ? fallbackStatus : quota.status;
    const code = quota.ok ? fallbackCode : quota.code;
    const message = quota.ok ? "workspace cache limit exceeded" : quota.message;
    return fail(c as any, message, status, {
      code,
      details: quota.ok
        ? { reason: limitCheck.reason, usage: limitCheck.usage, limits }
        : quota.details,
    });
  }

  const cacheControl = buildCacheControlFromLimits(limits);
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
    cache: mapWorkspaceFile(saved, contentBytes),
    usage: limitCheck.usage,
    cache_control: cacheControl,
  });
});

export default appVfs;
