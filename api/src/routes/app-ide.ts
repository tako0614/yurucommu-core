/// <reference types="@cloudflare/workers-types" />

import { Hono } from "hono";
import type { PublicAccountBindings as Bindings, Variables } from "@takos/platform/server";
import { fail, ok } from "@takos/platform/server";
import { auth } from "../middleware/auth";
import { requireHumanSession, requireWorkspacePlan } from "../lib/workspace-guard";
import { boolFromEnv, normalizeVfsPath, resolveCompiler } from "../lib/dev-compiler";
import { ensureDefaultWorkspace, resolveWorkspaceEnv } from "../lib/workspace-store";
import { inspectAppScriptCode } from "../lib/app-code-inspection";

const handlerDts = `declare module "takos/handler" {
  export type {
    TakosApp,
    AppEnv,
    AppStorage,
    OpenAICompatibleClient,
    AuthInfo,
    AppInfo,
    InstanceInfo,
    ObjectService,
    ActorService,
    NotificationService,
    TakosObject,
    TakosActor,
    TakosNotification
  } from "@takos/app-sdk/server";
}
`;

const manifestDts = `declare module "takos/manifest" {
  export type { AppManifest, AppEntry } from "@takos/app-sdk/server";
}
`;

const appIde = new Hono<{ Bindings: Bindings; Variables: Variables }>();
const textDecoder = new TextDecoder();

appIde.use("/-/dev/ide/*", auth, requireHumanSession, requireWorkspacePlan);

appIde.get("/-/dev/ide/types", async (c) => {
  return ok(c as any, {
    files: [
      { path: "takos/handler.d.ts", content: handlerDts },
      { path: "takos/manifest.d.ts", content: manifestDts },
    ],
  });
});

type IdePosition = { offset: number } | { line: number; column: number };

const resolveIdeFile = async (
  c: any,
  payload: { workspaceId?: string; path?: string; content?: string } | null,
): Promise<
  | {
      ok: true;
      path: string;
      content: string;
      env: any;
      allowDangerous: boolean;
      allowedImports: string[];
    }
  | { ok: false; response: Response }
> => {
  const path = normalizeVfsPath(typeof payload?.path === "string" ? payload.path : "app-main.ts");
  if (!path || path.includes("..")) return { ok: false, response: fail(c, "path is required", 400) };

  let content = typeof payload?.content === "string" ? payload.content : null;
  let env = c.env as any;

  if (content == null) {
    const workspaceId = typeof payload?.workspaceId === "string" ? payload.workspaceId.trim() : "";
    if (!workspaceId) return { ok: false, response: fail(c, "workspaceId or content is required", 400) };

    const workspaceEnv = resolveWorkspaceEnv({
      env: c.env,
      mode: "dev",
      requireIsolation: true,
    });
    if (workspaceEnv.isolation?.required && !workspaceEnv.isolation.ok) {
      return {
        ok: false,
        response: fail(c, workspaceEnv.isolation.errors[0] || "dev data isolation failed", 503),
      };
    }
    const store = workspaceEnv.store;
    if (!store) return { ok: false, response: fail(c, "workspace store is not configured", 503) };
    await ensureDefaultWorkspace(store);
    const workspace = await store.getWorkspace(workspaceId);
    if (!workspace) return { ok: false, response: fail(c, "workspace not found", 404) };

    const file = await store.getWorkspaceFile(workspaceId, path);
    if (!file) return { ok: false, response: fail(c, "file not found", 404) };

    content = textDecoder.decode(file.content ?? new Uint8Array());
    env = workspaceEnv.env as any;
  }

  const allowDangerous = boolFromEnv(env?.ALLOW_DANGEROUS_APP_PATTERNS);
  const allowedImportsRaw =
    typeof env?.TAKOS_APP_ALLOWED_IMPORTS === "string" ? env.TAKOS_APP_ALLOWED_IMPORTS : "@takos/platform/app";
  const allowedImports = String(allowedImportsRaw)
    .split(/[,\s]+/g)
    .map((v) => v.trim())
    .filter(Boolean);

  return { ok: true, path, content, env, allowDangerous, allowedImports };
};

const resolveIdeOffset = async (
  ts: any,
  path: string,
  content: string,
  position: IdePosition | null | undefined,
): Promise<number | null> => {
  if (!position || typeof position !== "object") return null;
  if ("offset" in position) {
    const offset = (position as any).offset;
    return Number.isInteger(offset) && offset >= 0 ? offset : null;
  }
  if ("line" in position && "column" in position) {
    const line = (position as any).line;
    const column = (position as any).column;
    if (!Number.isInteger(line) || !Number.isInteger(column) || line < 1 || column < 1) return null;
    const sourceFile = ts.createSourceFile(path, content, ts.ScriptTarget.ESNext, true);
    const pos = ts.getPositionOfLineAndCharacter(sourceFile, line - 1, column - 1);
    return Number.isInteger(pos) && pos >= 0 ? pos : null;
  }
  return null;
};

const createIdeLanguageService = (ts: any, files: Record<string, string>) => {
  const versions = new Map(Object.keys(files).map((name) => [name, 1]));
  const snapshots = new Map(
    Object.entries(files).map(([name, content]) => [name, ts.ScriptSnapshot.fromString(content)]),
  );
  const serviceHost: any = {
    getScriptFileNames: () => Object.keys(files),
    getScriptVersion: (fileName: string) => String(versions.get(fileName) ?? 1),
    getScriptSnapshot: (fileName: string) => snapshots.get(fileName) ?? undefined,
    getCurrentDirectory: () => "/",
    getCompilationSettings: () => ({
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.ESNext,
      jsx: ts.JsxEmit.ReactJSX,
      moduleResolution: ts.ModuleResolutionKind.Bundler ?? ts.ModuleResolutionKind.NodeNext,
      noLib: true,
      types: [],
      strict: false,
      skipLibCheck: true,
    }),
    getDefaultLibFileName: () => "lib.d.ts",
    fileExists: (fileName: string) => snapshots.has(fileName),
    readFile: (fileName: string) => files[fileName],
    readDirectory: () => [],
  };
  const registry = ts.createDocumentRegistry();
  return ts.createLanguageService(serviceHost, registry);
};

// The following endpoints provide a stable surface for Web IDE integration.
// MVP returns empty results; Monaco/TS language service can be layered on later.
appIde.post("/-/dev/ide/diagnostics", async (c) => {
  const payload = (await c.req.json().catch(() => null)) as
    | { workspaceId?: string; path?: string; content?: string }
    | null;

  const resolved = await resolveIdeFile(c, payload);
  if (!resolved.ok) return resolved.response;
  const { path, content, env, allowDangerous, allowedImports } = resolved;

  const diagnostics: Array<{
    message: string;
    severity: "error" | "warning" | "info";
    path?: string;
    code?: string | number;
    line?: number;
    column?: number;
    source?: string;
  }> = [];

  const inspection = inspectAppScriptCode(content, { allowedImports });
  for (const item of inspection) {
    diagnostics.push({
      message: `App code inspection failed: ${item.pattern}`,
      severity: allowDangerous ? "warning" : "error",
      code: "DANGEROUS_APP_PATTERN",
      path,
      source: "takos/app-code-inspection",
    });
  }

  const compiler = await resolveCompiler(env);
  if (compiler.kind === "esbuild-wasm") {
    try {
      await compiler.esbuild.transform(content, {
        loader: path.endsWith(".tsx") ? "tsx" : "ts",
        target: "esnext",
        format: "esm",
        sourcemap: false,
      });
    } catch (error: any) {
      const errors: any[] = Array.isArray(error?.errors) ? error.errors : [];
      for (const item of errors) {
        diagnostics.push({
          message: String(item?.text ?? error?.message ?? "compile error"),
          severity: "error",
          code: item?.id ?? "ESBUILD_ERROR",
          path: typeof item?.location?.file === "string" ? item.location.file : path,
          line: Number.isFinite(item?.location?.line) ? item.location.line : undefined,
          column: Number.isFinite(item?.location?.column) ? item.location.column + 1 : undefined,
          source: "esbuild",
        });
      }
      if (errors.length === 0 && error?.message) {
        diagnostics.push({
          message: String(error.message),
          severity: "error",
          code: "ESBUILD_ERROR",
          path,
          source: "esbuild",
        });
      }
    }
  } else if (compiler.kind === "typescript") {
    const ts = compiler.ts as any;
    const output = ts.transpileModule(content, {
      compilerOptions: {
        target: ts.ScriptTarget.ESNext,
        module: ts.ModuleKind.ESNext,
        jsx: ts.JsxEmit.ReactJSX,
      },
      fileName: path,
      reportDiagnostics: true,
    });

    const raw: any[] = Array.isArray(output?.diagnostics) ? output.diagnostics : [];
    for (const diag of raw) {
      const message = ts.flattenDiagnosticMessageText(diag?.messageText, "\n");
      const category = typeof diag?.category === "number" ? diag.category : ts.DiagnosticCategory.Error;
      const severity =
        category === ts.DiagnosticCategory.Error
          ? "error"
          : category === ts.DiagnosticCategory.Warning
            ? "warning"
            : "info";
      const fileName = typeof diag?.file?.fileName === "string" ? diag.file.fileName : path;
      let line: number | undefined;
      let column: number | undefined;
      if (diag?.file && typeof diag?.start === "number") {
        const pos = diag.file.getLineAndCharacterOfPosition(diag.start);
        line = pos.line + 1;
        column = pos.character + 1;
      }
      diagnostics.push({
        message,
        severity,
        code: typeof diag?.code === "number" ? diag.code : undefined,
        path: fileName,
        line,
        column,
        source: "typescript",
      });
    }
  } else {
    diagnostics.push({
      message: "No compiler available for diagnostics",
      severity: "info",
      code: "NO_COMPILER",
      path,
      source: "takos",
    });
  }

  return ok(c as any, { diagnostics });
});
appIde.post("/-/dev/ide/completions", async (c) => {
  const payload = (await c.req.json().catch(() => null)) as
    | { workspaceId?: string; path?: string; content?: string; position?: IdePosition }
    | null;
  const resolved = await resolveIdeFile(c, payload);
  if (!resolved.ok) return resolved.response;
  const { path, content } = resolved;

  try {
    const ts = await import("typescript");
    const offset = await resolveIdeOffset(ts, path, content, payload?.position ?? null);
    if (offset == null) return fail(c as any, "position is required", 400);

    const service = createIdeLanguageService(ts, {
      [path]: content,
      "takos/handler.d.ts": handlerDts,
      "takos/manifest.d.ts": manifestDts,
    });
    const result = service.getCompletionsAtPosition(path, offset, {});
    const entries: any[] = Array.isArray(result?.entries) ? result.entries : [];

    return ok(c as any, {
      items: entries.slice(0, 200).map((entry) => ({
        label: String(entry?.name ?? ""),
        kind: typeof entry?.kind === "string" ? entry.kind : "unknown",
        sortText: typeof entry?.sortText === "string" ? entry.sortText : undefined,
      })),
    });
  } catch {
    return ok(c as any, { items: [] });
  }
});

appIde.post("/-/dev/ide/hover", async (c) => {
  const payload = (await c.req.json().catch(() => null)) as
    | { workspaceId?: string; path?: string; content?: string; position?: IdePosition }
    | null;
  const resolved = await resolveIdeFile(c, payload);
  if (!resolved.ok) return resolved.response;
  const { path, content } = resolved;

  try {
    const ts = await import("typescript");
    const offset = await resolveIdeOffset(ts, path, content, payload?.position ?? null);
    if (offset == null) return fail(c as any, "position is required", 400);

    const service = createIdeLanguageService(ts, {
      [path]: content,
      "takos/handler.d.ts": handlerDts,
      "takos/manifest.d.ts": manifestDts,
    });
    const info = service.getQuickInfoAtPosition(path, offset);
    if (!info) return ok(c as any, { hover: null });

    const display = ts.displayPartsToString(info.displayParts || []);
    const doc = ts.displayPartsToString(info.documentation || []);
    return ok(c as any, { hover: { contents: [display, doc].filter(Boolean).join("\n") } });
  } catch {
    return ok(c as any, { hover: null });
  }
});

appIde.post("/-/dev/ide/definition", async (c) => {
  const payload = (await c.req.json().catch(() => null)) as
    | { workspaceId?: string; path?: string; content?: string; position?: IdePosition }
    | null;
  const resolved = await resolveIdeFile(c, payload);
  if (!resolved.ok) return resolved.response;
  const { path, content } = resolved;

  try {
    const ts = await import("typescript");
    const offset = await resolveIdeOffset(ts, path, content, payload?.position ?? null);
    if (offset == null) return fail(c as any, "position is required", 400);

    const service = createIdeLanguageService(ts, {
      [path]: content,
      "takos/handler.d.ts": handlerDts,
      "takos/manifest.d.ts": manifestDts,
    });
    const defs = service.getDefinitionAtPosition(path, offset) ?? [];
    const locations = defs
      .filter((d: any) => typeof d?.fileName === "string" && typeof d?.textSpan?.start === "number")
      .slice(0, 50)
      .map((d: any) => ({ path: d.fileName, offset: d.textSpan.start }));
    return ok(c as any, { locations });
  } catch {
    return ok(c as any, { locations: [] });
  }
});

appIde.post("/-/dev/ide/references", async (c) => {
  const payload = (await c.req.json().catch(() => null)) as
    | { workspaceId?: string; path?: string; content?: string; position?: IdePosition }
    | null;
  const resolved = await resolveIdeFile(c, payload);
  if (!resolved.ok) return resolved.response;
  const { path, content } = resolved;

  try {
    const ts = await import("typescript");
    const offset = await resolveIdeOffset(ts, path, content, payload?.position ?? null);
    if (offset == null) return fail(c as any, "position is required", 400);

    const service = createIdeLanguageService(ts, {
      [path]: content,
      "takos/handler.d.ts": handlerDts,
      "takos/manifest.d.ts": manifestDts,
    });
    const refs = service.getReferencesAtPosition(path, offset) ?? [];
    const locations = refs
      .filter((r: any) => typeof r?.fileName === "string" && typeof r?.textSpan?.start === "number")
      .slice(0, 200)
      .map((r: any) => ({ path: r.fileName, offset: r.textSpan.start }));
    return ok(c as any, { locations });
  } catch {
    return ok(c as any, { locations: [] });
  }
});

export default appIde;
