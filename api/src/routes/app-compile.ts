/// <reference types="@cloudflare/workers-types" />

import { Hono } from "hono";
import type { PublicAccountBindings as Bindings, Variables } from "@takos/platform/server";
import { fail, ok } from "@takos/platform/server";
import { auth } from "../middleware/auth";
import { ensureDefaultWorkspace, resolveWorkspaceEnv, type WorkspaceStore } from "../lib/workspace-store";
import { resolveWorkspaceLimitsFromEnv } from "../lib/workspace-limits";
import { requireHumanSession, requireWorkspacePlan } from "../lib/workspace-guard";
import { inspectAppScriptCode } from "../lib/app-code-inspection";
import { boolFromEnv, normalizeVfsPath, resolveCompiler } from "../lib/dev-compiler";

type CompileRequest = {
  workspaceId?: string;
  entryPath?: string;
  minify?: boolean;
  sourcemap?: boolean;
};

type CachedCompile = {
  code: string;
  sourceMap?: string;
  compiledAt: string;
  sourceHash: string;
  optionsHash: string;
  compilerVersion: string;
};

const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();

const stableStringify = (value: unknown): string => {
  const seen = new WeakSet();
  const stringify = (input: unknown): unknown => {
    if (!input || typeof input !== "object") return input;
    if (seen.has(input as object)) return null;
    seen.add(input as object);
    if (Array.isArray(input)) return input.map(stringify);
    const entries = Object.entries(input as Record<string, unknown>).sort(([a], [b]) =>
      a.localeCompare(b),
    );
    const out: Record<string, unknown> = {};
    for (const [key, val] of entries) {
      out[key] = stringify(val);
    }
    return out;
  };
  return JSON.stringify(stringify(value));
};

const sha256Hex = async (data: Uint8Array): Promise<string> => {
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
};

const hashObject = async (value: unknown): Promise<string> =>
  sha256Hex(textEncoder.encode(stableStringify(value)));

const resolveWorkspaceHash = async (db: D1Database | undefined, workspaceId: string): Promise<string> => {
  if (!db) return "";
  try {
    const rows = await db
      .prepare(
        `SELECT path, content_hash, updated_at
         FROM vfs_files
         WHERE workspace_id = ? AND is_cache = 0
         ORDER BY path`,
      )
      .bind(workspaceId)
      .all();
    const results = (rows.results ?? []) as any[];
    return await hashObject(
      results.map((row) => ({
        path: String(row.path ?? ""),
        content_hash: row.content_hash ? String(row.content_hash) : null,
        updated_at: row.updated_at ? String(row.updated_at) : null,
      })),
    );
  } catch (error) {
    console.warn("[compile] failed to compute workspace hash", error);
    return "";
  }
};

const resolveCompileCache = async (
  env: any,
  store: WorkspaceStore,
  workspaceId: string,
  cacheKey: string,
): Promise<CachedCompile | null> => {
  const kv = (env as any)?.KV as KVNamespace | undefined;
  const kvKey = `compile:${workspaceId}:${cacheKey}`;
  if (kv) {
    const cachedJson = await kv.get(kvKey, "json").catch(() => null);
    if (cachedJson && typeof cachedJson === "object" && (cachedJson as any).code) {
      return cachedJson as CachedCompile;
    }
  }

  const cachedFile =
    typeof store.getCompileCache === "function"
      ? await store.getCompileCache(workspaceId, cacheKey)
      : await store.getWorkspaceFile(workspaceId, `__cache/esbuild/${cacheKey}.js`);
  if (!cachedFile) return null;

  const code = textDecoder.decode(cachedFile.content ?? new Uint8Array());
  return {
    code,
    compiledAt: cachedFile.updated_at || new Date().toISOString(),
    sourceHash: "",
    optionsHash: "",
    compilerVersion: "unknown",
  };
};

const persistCompileCache = async (
  env: any,
  store: WorkspaceStore,
  workspaceId: string,
  cacheKey: string,
  compiled: CachedCompile,
  ttlSeconds: number,
) => {
  const kv = (env as any)?.KV as KVNamespace | undefined;
  const kvKey = `compile:${workspaceId}:${cacheKey}`;
  if (kv && Number.isFinite(ttlSeconds) && ttlSeconds > 0) {
    await kv.put(kvKey, JSON.stringify(compiled), { expirationTtl: Math.floor(ttlSeconds) }).catch(
      () => null,
    );
  }

  const cacheControl =
    Number.isFinite(ttlSeconds) && ttlSeconds > 0 ? `public, max-age=${Math.floor(ttlSeconds)}` : null;
  if (typeof store.saveCompileCache === "function") {
    await store.saveCompileCache(workspaceId, cacheKey, compiled.code, {
      contentType: "application/javascript",
      cacheControl,
    });
    return;
  }
  await store.saveWorkspaceFile(workspaceId, `__cache/esbuild/${cacheKey}.js`, compiled.code, "application/javascript", {
    cacheControl: cacheControl ?? undefined,
  });
};

const appCompile = new Hono<{ Bindings: Bindings; Variables: Variables }>();

appCompile.use("/-/dev/compile/*", auth, requireHumanSession, requireWorkspacePlan);
appCompile.use("/-/dev/compile", auth, requireHumanSession, requireWorkspacePlan);

appCompile.post("/-/dev/compile", async (c) => {
  const payload = (await c.req.json().catch(() => null)) as CompileRequest | null;
  const workspaceId = typeof payload?.workspaceId === "string" ? payload.workspaceId.trim() : "";
  const entryPath = normalizeVfsPath(typeof payload?.entryPath === "string" ? payload.entryPath : "app-main.ts");
  if (!workspaceId || !entryPath || entryPath.includes("..")) {
    return fail(c as any, "workspaceId and entryPath are required", 400);
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

  const entryFile = await store.getWorkspaceFile(workspaceId, entryPath);
  if (!entryFile) {
    return fail(c as any, "entry file not found", 404);
  }

  const sourceHashBase = entryFile.content_hash || (await sha256Hex(entryFile.content ?? new Uint8Array()));
  const workspaceHash = await resolveWorkspaceHash(workspaceEnv.env.DB as any, workspaceId);
  const sourceHash = await sha256Hex(textEncoder.encode(`${sourceHashBase}:${workspaceHash}`));

  const compileOptions = {
    target: "esnext",
    format: "esm",
    minify: payload?.minify ?? false,
    sourcemap: payload?.sourcemap ? "inline" : false,
    external: ["takos/handler"],
    loader: {
      ".ts": "ts",
      ".tsx": "tsx",
      ".json": "json",
    },
  };
  const optionsHash = await hashObject(compileOptions);

  const compiler = await resolveCompiler(workspaceEnv.env);
  const compilerVersion =
    compiler.kind === "esbuild-wasm"
      ? String((compiler as any).esbuild?.version ?? "esbuild-wasm")
      : compiler.kind;
  const cacheKey = await sha256Hex(
    textEncoder.encode(`${sourceHash}:${optionsHash}:${compilerVersion}`),
  );

  const cached = await resolveCompileCache(workspaceEnv.env, store, workspaceId, cacheKey);
  if (cached) {
    return ok(c as any, {
      workspace_id: workspaceId,
      entry_path: entryPath,
      hash: cacheKey,
      cache_hit: true,
      compiled: cached,
    });
  }

  const entryCode = textDecoder.decode(entryFile.content ?? new Uint8Array());
  const allowDangerous = boolFromEnv((workspaceEnv.env as any)?.ALLOW_DANGEROUS_APP_PATTERNS);
  const allowedImportsRaw =
    typeof (workspaceEnv.env as any)?.TAKOS_APP_ALLOWED_IMPORTS === "string"
      ? (workspaceEnv.env as any).TAKOS_APP_ALLOWED_IMPORTS
      : "@takos/platform/app";
  const allowedImports = String(allowedImportsRaw)
    .split(/[,\s]+/g)
    .map((v) => v.trim())
    .filter(Boolean);
  const inspection = inspectAppScriptCode(entryCode, { allowedImports });
  if (inspection.length > 0 && !allowDangerous) {
    return fail(
      c as any,
      `App code inspection failed: ${inspection.map((i) => i.pattern).join(", ")}`,
      400,
    );
  }
  const compiledAt = new Date().toISOString();

  let code = "";
  let sourceMap: string | undefined;

  if (compiler.kind === "esbuild-wasm") {
    const esbuild = (compiler as any).esbuild;
    const result = await esbuild.transform(entryCode, {
      loader: entryPath.endsWith(".tsx") ? "tsx" : "ts",
      target: compileOptions.target,
      format: compileOptions.format,
      minify: compileOptions.minify,
      sourcemap: compileOptions.sourcemap,
    });
    code = String(result.code ?? "");
    sourceMap = typeof result.map === "string" ? result.map : undefined;
  } else if (compiler.kind === "typescript") {
    const ts = (compiler as any).ts;
    const output = ts.transpileModule(entryCode, {
      compilerOptions: {
        target: ts.ScriptTarget.ESNext,
        module: ts.ModuleKind.ESNext,
        jsx: ts.JsxEmit.ReactJSX,
        sourceMap: Boolean(payload?.sourcemap),
      },
      fileName: entryPath,
    });
    code = output.outputText;
    sourceMap = output.sourceMapText || undefined;
  } else {
    return fail(c as any, "no compiler available", 503);
  }

  const limits = resolveWorkspaceLimitsFromEnv(workspaceEnv.env);
  const ttlSeconds = limits.compileCacheTtlSeconds;
  const compiled: CachedCompile = {
    code,
    sourceMap,
    compiledAt,
    sourceHash,
    optionsHash,
    compilerVersion,
  };
  await persistCompileCache(workspaceEnv.env, store, workspaceId, cacheKey, compiled, ttlSeconds);

  return ok(c as any, {
    workspace_id: workspaceId,
    entry_path: entryPath,
    hash: cacheKey,
    cache_hit: false,
    compiled,
  });
});

appCompile.get("/-/dev/compile/cache/:hash", async (c) => {
  const hash = (c.req.param("hash") || "").trim();
  const workspaceId = (c.req.query("workspaceId") || "").trim();
  if (!hash || !workspaceId) {
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
  if (!store) return fail(c as any, "workspace store is not configured", 503);
  await ensureDefaultWorkspace(store);
  const workspace = await store.getWorkspace(workspaceId);
  if (!workspace) return fail(c as any, "workspace not found", 404);

  const cached = await resolveCompileCache(workspaceEnv.env, store, workspaceId, hash);
  if (!cached) return fail(c as any, "cache_not_found", 404);

  return ok(c as any, { workspace_id: workspaceId, hash, compiled: cached });
});

appCompile.delete("/-/dev/compile/cache", async (c) => {
  const workspaceId = (c.req.query("workspaceId") || "").trim();
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
  if (!store) return fail(c as any, "workspace store is not configured", 503);
  await ensureDefaultWorkspace(store);
  const workspace = await store.getWorkspace(workspaceId);
  if (!workspace) return fail(c as any, "workspace not found", 404);

  if (typeof store.deleteWorkspaceFile !== "function") {
    return fail(c as any, "workspace delete is not supported", 501);
  }

  const cacheFiles = await store.listWorkspaceFiles(workspaceId, "__cache/esbuild/");
  let deleted = 0;
  for (const file of cacheFiles) {
    if (!file.path.startsWith("__cache/esbuild/")) continue;
    await store.deleteWorkspaceFile(workspaceId, file.path);
    deleted += 1;
  }

  return ok(c as any, { workspace_id: workspaceId, deleted });
});

export default appCompile;
